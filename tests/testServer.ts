import { randomUUID } from "node:crypto";

type RequestFormData = Awaited<ReturnType<Request["formData"]>>;

export type RecordedRequest = {
	method: string;
	path: string;
	url: string;
	headers: Headers;
	json?: unknown;
	formData?: RequestFormData;
};

export type TestApiState = {
	/** Number of times /v1/health/ping should fail with 500 before succeeding. */
	failPingCount: number;
	/** Number of times /v1/health/ping should respond with 429 before succeeding. */
	rateLimitPingCount: number;
};

export class TestApiServer {
	private server?: ReturnType<typeof Bun.serve>;
	public readonly requests: RecordedRequest[] = [];
	public state: TestApiState = { failPingCount: 0, rateLimitPingCount: 0 };

	private jobCalls: Map<string, number> = new Map();
	private jobToReportId: Map<string, string> = new Map();
	private lastUploadedMediaId: string | undefined;

	start(): void {
		if (this.server) return;

		this.server = Bun.serve({
			port: 0,
			fetch: (req) => this.handle(req),
		});
	}

	stop(): void {
		this.server?.stop(true);
		this.server = undefined;
	}

	reset(): void {
		this.requests.length = 0;
		this.state = { failPingCount: 0, rateLimitPingCount: 0 };
		this.jobCalls.clear();
		this.jobToReportId.clear();
		this.lastUploadedMediaId = undefined;
	}

	get baseUrl(): string {
		if (!this.server) throw new Error("Test server is not started");
		return `http://127.0.0.1:${this.server.port}`;
	}

	private async handle(req: Request): Promise<Response> {
		const u = new URL(req.url);
		const path = u.pathname;

		// Record request basics early.
		const record: RecordedRequest = {
			method: req.method,
			path,
			url: req.url,
			headers: req.headers,
		};

		// Parse bodies for endpoints we care about.
		if (
			req.method !== "GET" &&
			req.method !== "HEAD" &&
			(req.headers.get("content-type") ?? "").includes("application/json")
		) {
			try {
				record.json = await req.json();
			} catch {
				// Ignore parse errors; tests will assert where needed.
			}
		}

		if (
			(req.headers.get("content-type") ?? "").includes("multipart/form-data")
		) {
			try {
				record.formData = await req.formData();
			} catch {
				// Ignore parse errors.
			}
		}

		this.requests.push(record);

		// Test fixtures are publicly accessible (used by createJobFromUrl which should not
		// forward API credentials to arbitrary remote servers).
		if (req.method === "GET" && path.startsWith("/fixtures/")) {
			return new Response(new Uint8Array([1, 2, 3, 4]), {
				status: 200,
				headers: {
					"content-type": "audio/wav",
					"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
				},
			});
		}

		// Simple auth expectation for integration tests.
		const apiKey = req.headers.get("Mappa-Api-Key");
		if (apiKey !== "test-api-key") {
			return this.json(
				401,
				{ error: { code: "unauthorized", message: "Unauthorized" } },
				{
					"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
				},
			);
		}

		if (req.method === "GET" && path === "/v1/health/ping") {
			if (this.state.rateLimitPingCount > 0) {
				this.state.rateLimitPingCount -= 1;
				return this.json(
					429,
					{ error: { code: "rate_limited", message: "Rate limited" } },
					{
						"retry-after": "0",
						"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
					},
				);
			}
			if (this.state.failPingCount > 0) {
				this.state.failPingCount -= 1;
				return this.json(
					500,
					{ error: { code: "internal", message: "Temporary error" } },
					{
						"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
					},
				);
			}
			return this.json(
				200,
				{ ok: true, time: new Date().toISOString() },
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "POST" && path === "/v1/files") {
			const fd = record.formData;
			if (!fd) {
				return this.json(
					422,
					{ error: { code: "bad_form", message: "Expected multipart form" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const file = fd.get("file");
			const contentType = fd.get("contentType");
			const filename = fd.get("filename");

			if (!(file instanceof Blob) || typeof contentType !== "string") {
				return this.json(
					422,
					{
						error: {
							code: "invalid_upload",
							message: "Missing required upload fields",
						},
					},
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const mediaId = `media_${randomUUID()}`;
			this.lastUploadedMediaId = mediaId;

			return this.json(
				200,
				{
					mediaId,
					createdAt: new Date().toISOString(),
					contentType,
					...(typeof filename === "string" && filename ? { filename } : {}),
					sizeBytes: file.size,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "DELETE" && path.startsWith("/v1/files/")) {
			const mediaId = decodeURIComponent(path.slice("/v1/files/".length));
			if (!this.lastUploadedMediaId || mediaId !== this.lastUploadedMediaId) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "File not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			this.lastUploadedMediaId = undefined;
			return this.json(
				200,
				{ mediaId, deleted: true },
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "POST" && path === "/v1/reports/jobs") {
			const body = record.json as
				| { media?: { mediaId?: unknown; url?: unknown } }
				| undefined;

			const mediaId =
				body?.media && "mediaId" in body.media ? body.media.mediaId : undefined;
			const url =
				body?.media && "url" in body.media ? body.media.url : undefined;

			// Report job creation only accepts already-uploaded media references.
			if (url !== undefined) {
				return this.json(
					422,
					{
						error: {
							code: "invalid_media",
							message:
								"media.url is not supported; upload first and pass media.mediaId",
						},
					},
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			if (mediaId !== undefined && typeof mediaId !== "string") {
				return this.json(
					422,
					{
						error: {
							code: "invalid_media",
							message: "media.mediaId must be a string",
						},
					},
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			if (mediaId) {
				if (!this.lastUploadedMediaId || mediaId !== this.lastUploadedMediaId) {
					return this.json(
						422,
						{
							error: {
								code: "unknown_media",
								message: "Unexpected mediaId",
							},
						},
						{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
					);
				}
			}

			const jobId = `job_${randomUUID()}`;
			const reportId = `report_${randomUUID()}`;

			this.jobCalls.set(jobId, 0);
			this.jobToReportId.set(jobId, reportId);

			return this.json(
				200,
				{
					jobId,
					status: "queued",
					stage: "queued",
					estimatedWaitSec: 1,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (
			req.method === "POST" &&
			path.endsWith("/cancel") &&
			path.startsWith("/v1/jobs/")
		) {
			const jobId = decodeURIComponent(
				path.slice("/v1/jobs/".length).replace(/\/cancel$/, ""),
			);
			const reportId = this.jobToReportId.get(jobId);
			if (!reportId) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Job not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}
			return this.json(
				200,
				{
					id: jobId,
					type: "report.generate",
					status: "canceled",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					requestId: req.headers.get("x-request-id") ?? randomUUID(),
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "GET" && path.startsWith("/v1/jobs/")) {
			const jobId = decodeURIComponent(path.slice("/v1/jobs/".length));
			const calls = (this.jobCalls.get(jobId) ?? 0) + 1;
			this.jobCalls.set(jobId, calls);

			const reportId = this.jobToReportId.get(jobId);
			if (!reportId) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Job not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const base = {
				id: jobId,
				type: "report.generate",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				requestId: req.headers.get("x-request-id") ?? randomUUID(),
			} as const;

			if (calls < 2) {
				return this.json(
					200,
					{
						...base,
						status: "running",
						stage: "extracting",
						progress: 0.25,
					},
					{ "x-request-id": base.requestId },
				);
			}

			return this.json(
				200,
				{
					...base,
					status: "succeeded",
					stage: "finalizing",
					reportId,
				},
				{ "x-request-id": base.requestId },
			);
		}

		if (req.method === "GET" && path.startsWith("/v1/reports/by-job/")) {
			const jobId = decodeURIComponent(
				path.slice("/v1/reports/by-job/".length),
			);
			const reportId = this.jobToReportId.get(jobId);
			if (!reportId) return this.json(200, null, {});
			return this.json(200, this.makeMarkdownReport(reportId, jobId), {
				"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
			});
		}

		if (req.method === "GET" && path.startsWith("/v1/reports/")) {
			const reportId = decodeURIComponent(path.slice("/v1/reports/".length));
			return this.json(200, this.makeMarkdownReport(reportId), {
				"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
			});
		}

		return this.json(
			404,
			{ error: { code: "not_found", message: `No route for ${path}` } },
			{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
		);
	}

	private makeMarkdownReport(reportId: string, jobId?: string): unknown {
		return {
			id: reportId,
			createdAt: new Date().toISOString(),
			media: jobId
				? { mediaId: this.lastUploadedMediaId }
				: { url: "https://example.com" },
			output: {
				type: "markdown",
				template: "general_report",
			},
			markdown: "# Test Report\n\nHello from integration tests.",
			...(jobId ? { jobId } : {}),
		};
	}

	private json(
		status: number,
		data: unknown,
		headers?: Record<string, string>,
	): Response {
		return new Response(JSON.stringify(data), {
			status,
			headers: {
				"content-type": "application/json",
				...(headers ?? {}),
			},
		});
	}
}
