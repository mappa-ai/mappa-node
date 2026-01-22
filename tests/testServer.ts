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

	// Mock data for files
	private mediaFiles: Map<string, unknown> = new Map();
	private retentionLocks: Map<string, boolean> = new Map();

	// Mock data for credits
	private creditBalance = { balance: 1000, reserved: 100, available: 900 };
	private transactions: unknown[] = this.generateMockTransactions();

	// Mock data for entities
	private entities: Map<
		string,
		{
			id: string;
			tags: string[];
			createdAt: string;
			mediaCount: number;
			lastSeenAt: string | null;
		}
	> = new Map();
	private entityTags: Map<string, Set<string>> = new Map();

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
		this.mediaFiles.clear();
		this.retentionLocks.clear();
		this.creditBalance = { balance: 1000, reserved: 100, available: 900 };
		this.transactions = this.generateMockTransactions();
		this.entities.clear();
		this.entityTags.clear();
		this.initializeMockEntities();
	}

	private generateMockTransactions(): unknown[] {
		// Generate 150 mock transactions for pagination testing
		const transactions: unknown[] = [];
		const types = [
			"PURCHASE",
			"USAGE",
			"SUBSCRIPTION_GRANT",
			"REFUND",
			"FEEDBACK_DISCOUNT",
		];

		for (let i = 0; i < 150; i++) {
			transactions.push({
				id: `tx_${i + 1}`,
				type: types[i % types.length],
				amount: i % 2 === 0 ? 100 : -50,
				createdAt: new Date(Date.now() - i * 1000 * 60 * 60).toISOString(),
				effectiveAt: new Date(Date.now() - i * 1000 * 60 * 60).toISOString(),
				expiresAt:
					i % 3 === 0
						? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
						: null,
				jobId: i % 5 === 0 ? `job_${randomUUID()}` : null,
			});
		}

		return transactions;
	}

	private initializeMockEntities(): void {
		// Create mock entities for testing
		const mockEntities = [
			{
				id: "entity_1",
				tags: ["interviewer", "sales-rep"],
				createdAt: new Date(
					Date.now() - 30 * 24 * 60 * 60 * 1000,
				).toISOString(),
				mediaCount: 5,
				lastSeenAt: new Date(
					Date.now() - 1 * 24 * 60 * 60 * 1000,
				).toISOString(),
			},
			{
				id: "entity_2",
				tags: ["candidate", "round-1"],
				createdAt: new Date(
					Date.now() - 20 * 24 * 60 * 60 * 1000,
				).toISOString(),
				mediaCount: 3,
				lastSeenAt: new Date(
					Date.now() - 2 * 24 * 60 * 60 * 1000,
				).toISOString(),
			},
			{
				id: "entity_3",
				tags: ["interviewer"],
				createdAt: new Date(
					Date.now() - 15 * 24 * 60 * 60 * 1000,
				).toISOString(),
				mediaCount: 10,
				lastSeenAt: new Date(
					Date.now() - 0.5 * 24 * 60 * 60 * 1000,
				).toISOString(),
			},
			{
				id: "entity_4",
				tags: [],
				createdAt: new Date(
					Date.now() - 10 * 24 * 60 * 60 * 1000,
				).toISOString(),
				mediaCount: 1,
				lastSeenAt: new Date(
					Date.now() - 3 * 24 * 60 * 60 * 1000,
				).toISOString(),
			},
		];

		for (const entity of mockEntities) {
			this.entities.set(entity.id, entity);
			this.entityTags.set(entity.id, new Set(entity.tags));
		}
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

		if (req.method === "GET" && path === "/v1/files") {
			// GET /v1/files (list)
			const limit = Number.parseInt(u.searchParams.get("limit") ?? "20", 10);
			const cursor = u.searchParams.get("cursor");

			// Generate mock files
			const totalFiles = 25;
			const files: unknown[] = [];

			let startIdx = 0;
			if (cursor) {
				startIdx = Number.parseInt(cursor, 10);
			}

			for (let i = startIdx; i < Math.min(startIdx + limit, totalFiles); i++) {
				files.push({
					mediaId: `media_${i + 1}`,
					createdAt: new Date(Date.now() - i * 1000 * 60).toISOString(),
					contentType: "audio/wav",
					filename: `test-file-${i + 1}.wav`,
					sizeBytes: 1024 * (i + 1),
					durationSeconds: 30 + i,
					processingStatus: "COMPLETED",
					lastUsedAt: new Date(Date.now() - i * 1000 * 30).toISOString(),
					retention: {
						expiresAt: new Date(
							Date.now() + 180 * 24 * 60 * 60 * 1000,
						).toISOString(),
						daysRemaining: 180,
						locked: this.retentionLocks.get(`media_${i + 1}`) ?? false,
					},
				});
			}

			const hasMore = startIdx + limit < totalFiles;
			const nextCursor = hasMore ? String(startIdx + limit) : undefined;

			return this.json(
				200,
				{
					files,
					cursor: nextCursor,
					hasMore,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (
			req.method === "GET" &&
			path.startsWith("/v1/files/") &&
			!path.includes("/retention")
		) {
			// GET specific file
			const mediaId = decodeURIComponent(path.slice("/v1/files/".length));
			const file =
				this.mediaFiles.get(mediaId) ??
				(this.lastUploadedMediaId === mediaId
					? {
							mediaId,
							createdAt: new Date().toISOString(),
							contentType: "audio/wav",
							filename: "test.wav",
							sizeBytes: 1024,
							durationSeconds: 30,
							processingStatus: "COMPLETED",
							lastUsedAt: new Date().toISOString(),
							retention: {
								expiresAt: new Date(
									Date.now() + 180 * 24 * 60 * 60 * 1000,
								).toISOString(),
								daysRemaining: 180,
								locked: this.retentionLocks.get(mediaId) ?? false,
							},
						}
					: null);

			if (!file) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "File not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			return this.json(200, file, {
				"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
			});
		}

		if (req.method === "PATCH" && path.includes("/retention")) {
			const mediaId = decodeURIComponent(
				path.slice("/v1/files/".length).replace("/retention", ""),
			);
			const body = record.json as { lock?: boolean } | undefined;

			if (!this.lastUploadedMediaId || mediaId !== this.lastUploadedMediaId) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "File not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const locked = body?.lock ?? false;
			this.retentionLocks.set(mediaId, locked);

			return this.json(
				200,
				{
					mediaId,
					retentionLock: locked,
					message: locked
						? "Retention lock enabled"
						: "Retention lock disabled",
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

		// SSE endpoint for job streaming
		if (req.method === "GET" && path.match(/^\/v1\/jobs\/[^/]+\/stream$/)) {
			const jobId = decodeURIComponent(
				path.slice("/v1/jobs/".length).replace("/stream", ""),
			);
			const reportId = this.jobToReportId.get(jobId);
			const lastEventId = req.headers.get("Last-Event-ID");

			if (!reportId) {
				// Return SSE error event for not found
				return this.sseResponse([
					{
						id: "1",
						event: "error",
						data: {
							error: { code: "not_found", message: "Job not found" },
						},
					},
				]);
			}

			const calls = (this.jobCalls.get(jobId) ?? 0) + 1;
			this.jobCalls.set(jobId, calls);

			const baseJob = {
				id: jobId,
				type: "report.generate",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				requestId: req.headers.get("x-request-id") ?? randomUUID(),
			};

			// If reconnecting with Last-Event-ID, or after first call, return terminal
			if (lastEventId || calls >= 2) {
				return this.sseResponse([
					{
						id: "2",
						event: "terminal",
						data: {
							status: "succeeded",
							reportId,
							job: {
								...baseJob,
								status: "succeeded",
								stage: "finalizing",
								reportId,
							},
						},
					},
				]);
			}

			// First call: return status event followed by terminal
			return this.sseResponse([
				{
					id: "1",
					event: "status",
					data: {
						status: "running",
						stage: "extracting",
						progress: 0.25,
						job: {
							...baseJob,
							status: "running",
							stage: "extracting",
							progress: 0.25,
						},
					},
				},
				{
					id: "2",
					event: "terminal",
					data: {
						status: "succeeded",
						reportId,
						job: {
							...baseJob,
							status: "succeeded",
							stage: "finalizing",
							reportId,
						},
					},
				},
			]);
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

		if (req.method === "GET" && path === "/v1/credits/balance") {
			return this.json(200, this.creditBalance, {
				"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
			});
		}

		if (req.method === "GET" && path === "/v1/credits/transactions") {
			const limit = Number.parseInt(u.searchParams.get("limit") ?? "50", 10);
			const offset = Number.parseInt(u.searchParams.get("offset") ?? "0", 10);

			const paginatedTransactions = this.transactions.slice(
				offset,
				offset + limit,
			);

			return this.json(
				200,
				{
					transactions: paginatedTransactions,
					pagination: {
						limit,
						offset,
						total: this.transactions.length,
					},
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "GET" && path.startsWith("/v1/credits/usage/")) {
			const jobId = decodeURIComponent(path.slice("/v1/credits/usage/".length));

			if (!this.jobToReportId.has(jobId)) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Job not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			return this.json(
				200,
				{
					jobId,
					creditsUsed: 100,
					creditsDiscounted: 10,
					creditsNetUsed: 90,
					durationMs: 5000,
					modelVersion: "v1.0.0",
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		// Entity endpoints
		if (req.method === "GET" && path === "/v1/entities") {
			const limit = Number.parseInt(u.searchParams.get("limit") ?? "20", 10);
			const cursor = u.searchParams.get("cursor");
			const tagsParam = u.searchParams.get("tags");

			// Parse tags filter
			const filterTags = tagsParam ? tagsParam.split(",") : [];

			// Get all entities
			let allEntities = Array.from(this.entities.values());

			// Filter by tags if provided (entities must have ALL specified tags)
			if (filterTags.length > 0) {
				allEntities = allEntities.filter((entity) => {
					return filterTags.every((tag) => entity.tags.includes(tag));
				});
			}

			// Apply cursor pagination
			let startIdx = 0;
			if (cursor) {
				const cursorIdx = allEntities.findIndex((e) => e.id === cursor);
				if (cursorIdx >= 0) {
					startIdx = cursorIdx + 1;
				}
			}

			const paginatedEntities = allEntities.slice(startIdx, startIdx + limit);
			const hasMore = startIdx + limit < allEntities.length;
			const nextCursor = hasMore
				? paginatedEntities[paginatedEntities.length - 1]?.id
				: undefined;

			return this.json(
				200,
				{
					entities: paginatedEntities,
					cursor: nextCursor,
					hasMore,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (
			req.method === "GET" &&
			path.startsWith("/v1/entities/") &&
			!path.includes("/tags")
		) {
			const entityId = decodeURIComponent(path.slice("/v1/entities/".length));
			const entity = this.entities.get(entityId);

			if (!entity) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Entity not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			return this.json(200, entity, {
				"x-request-id": req.headers.get("x-request-id") ?? randomUUID(),
			});
		}

		if (req.method === "POST" && path.includes("/tags")) {
			const entityId = decodeURIComponent(
				path.slice("/v1/entities/".length).replace("/tags", ""),
			);
			const entity = this.entities.get(entityId);

			if (!entity) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Entity not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const body = record.json as { tags?: string[] } | undefined;
			const tagsToAdd = body?.tags ?? [];

			// Add tags (idempotent)
			const currentTags = this.entityTags.get(entityId) ?? new Set();
			for (const tag of tagsToAdd) {
				currentTags.add(tag);
			}
			this.entityTags.set(entityId, currentTags);

			// Update entity tags
			const updatedTags = Array.from(currentTags).sort();
			entity.tags = updatedTags;

			return this.json(
				200,
				{
					entityId,
					tags: updatedTags,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "DELETE" && path.includes("/tags")) {
			const entityId = decodeURIComponent(
				path.slice("/v1/entities/".length).replace("/tags", ""),
			);
			const entity = this.entities.get(entityId);

			if (!entity) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Entity not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const body = record.json as { tags?: string[] } | undefined;
			const tagsToRemove = body?.tags ?? [];

			// Remove tags (idempotent)
			const currentTags = this.entityTags.get(entityId) ?? new Set();
			for (const tag of tagsToRemove) {
				currentTags.delete(tag);
			}
			this.entityTags.set(entityId, currentTags);

			// Update entity tags
			const updatedTags = Array.from(currentTags).sort();
			entity.tags = updatedTags;

			return this.json(
				200,
				{
					entityId,
					tags: updatedTags,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
		}

		if (req.method === "PUT" && path.includes("/tags")) {
			const entityId = decodeURIComponent(
				path.slice("/v1/entities/".length).replace("/tags", ""),
			);
			const entity = this.entities.get(entityId);

			if (!entity) {
				return this.json(
					404,
					{ error: { code: "not_found", message: "Entity not found" } },
					{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
				);
			}

			const body = record.json as { tags?: string[] } | undefined;
			const newTags = body?.tags ?? [];

			// Replace all tags
			const currentTags = new Set(newTags);
			this.entityTags.set(entityId, currentTags);

			// Update entity tags
			const updatedTags = Array.from(currentTags).sort();
			entity.tags = updatedTags;

			return this.json(
				200,
				{
					entityId,
					tags: updatedTags,
				},
				{ "x-request-id": req.headers.get("x-request-id") ?? randomUUID() },
			);
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
			entity: {
				id: "entity_test_speaker",
				tags: ["test-speaker"],
			},
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

	/**
	 * Create an SSE response with the given events.
	 */
	private sseResponse(
		events: Array<{ id: string; event: string; data: unknown }>,
	): Response {
		const body = events
			.map(
				(e) =>
					`id: ${e.id}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`,
			)
			.join("");

		return new Response(body, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
			},
		});
	}
}
