import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import type { MediaIdRef } from "../src/index";
import {
	AuthError,
	isJsonReport,
	isMarkdownReport,
	isPdfReport,
	isUrlReport,
	Mappa,
	RateLimitError,
	ValidationError,
} from "../src/index";

import { TestApiServer } from "./testServer";

const api = new TestApiServer();

describe("SDK integration", () => {
	beforeAll(() => api.start());
	afterAll(() => api.stop());
	beforeEach(() => api.reset());

	test("health.ping sends auth and returns payload", async () => {
		const client = new Mappa({ apiKey: "test-api-key", baseUrl: api.baseUrl });

		const res = await client.health.ping();

		expect(res.ok).toBe(true);
		expect(typeof res.time).toBe("string");

		const req = api.requests.at(-1);
		expect(req?.path).toBe("/v1/health/ping");
		expect(req?.headers.get("Mappa-Api-Key")).toBe("test-api-key");
		expect(req?.headers.get("x-request-id")).toBeTruthy();
	});

	test("transport retries retryable requests on 500", async () => {
		api.state.failPingCount = 1;

		const client = new Mappa({
			apiKey: "test-api-key",
			baseUrl: api.baseUrl,
			maxRetries: 2,
			// Keep tests fast.
			timeoutMs: 5_000,
		});

		const res = await client.health.ping();
		expect(res.ok).toBe(true);

		const pingCalls = api.requests.filter((r) => r.path === "/v1/health/ping");
		expect(pingCalls.length).toBe(2);
	});

	test("transport retries retryable requests on 429 and respects Retry-After", async () => {
		api.state.rateLimitPingCount = 1;

		const client = new Mappa({
			apiKey: "test-api-key",
			baseUrl: api.baseUrl,
			maxRetries: 2,
			// Keep tests fast.
			timeoutMs: 5_000,
		});

		const res = await client.health.ping();
		expect(res.ok).toBe(true);

		const pingCalls = api.requests.filter((r) => r.path === "/v1/health/ping");
		expect(pingCalls.length).toBe(2);
	});

	test("maps 429 to RateLimitError when retries are exhausted", async () => {
		api.state.rateLimitPingCount = 1;

		const client = new Mappa({
			apiKey: "test-api-key",
			baseUrl: api.baseUrl,
			maxRetries: 0,
			timeoutMs: 5_000,
		});

		let thrown: unknown;
		try {
			await client.health.ping();
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(RateLimitError);
		const e = thrown as RateLimitError;
		expect(e.status).toBe(429);
		expect(e.retryAfterMs).toBe(0);
	});

	test("maps 401 to AuthError", async () => {
		const client = new Mappa({ apiKey: "wrong-key", baseUrl: api.baseUrl });

		let thrown: unknown;
		try {
			await client.health.ping();
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(AuthError);
		const e = thrown as AuthError;
		expect(e.status).toBe(401);
		expect(e.requestId).toBeTruthy();
	});

	test("files.upload uses multipart/form-data and returns mediaId", async () => {
		const client = new Mappa({ apiKey: "test-api-key", baseUrl: api.baseUrl });

		const media = await client.files.upload({
			file: new Uint8Array([1, 2, 3, 4]),
			contentType: "application/octet-stream",
			filename: "sample.bin",
			requestId: "req_upload_1",
		});

		expect(media.mediaId).toMatch(/^media_/);
		expect(media.contentType).toBe("application/octet-stream");
		expect(media.filename).toBe("sample.bin");
		expect(typeof media.createdAt).toBe("string");

		const req = api.requests.findLast((r) => r.path === "/v1/files");
		expect(req).toBeTruthy();
		expect(req?.headers.get("x-request-id")).toBe("req_upload_1");
		expect(req?.headers.get("content-type") ?? "").toContain(
			"multipart/form-data",
		);

		const fd = req?.formData;
		expect(fd?.get("contentType")).toBe("application/octet-stream");
		const filePart = fd?.get("file");
		expect(filePart instanceof Blob).toBe(true);
	});

	test("files.delete deletes an uploaded file", async () => {
		const client = new Mappa({ apiKey: "test-api-key", baseUrl: api.baseUrl });

		const media = await client.files.upload({
			file: new Uint8Array([1, 2, 3]),
			contentType: "application/octet-stream",
			filename: "to-delete.bin",
		});

		const receipt = await client.files.delete(media.mediaId, {
			requestId: "req_delete_1",
		});

		expect(receipt.deleted).toBe(true);
		expect(receipt.mediaId).toBe(media.mediaId);

		const delReq = api.requests.findLast((r) =>
			r.path.startsWith("/v1/files/"),
		);
		expect(delReq?.method).toBe("DELETE");
		expect(delReq?.headers.get("x-request-id")).toBe("req_delete_1");
	});

	test("reports.generateFromFile uploads then waits and returns report", async () => {
		const client = new Mappa({
			apiKey: "test-api-key",
			baseUrl: api.baseUrl,
			maxRetries: 0,
		});

		const report = await client.reports.generateFromFile(
			{
				file: new Uint8Array([9, 9, 9]),
				contentType: "audio/wav",
				filename: "audio.wav",
				output: { type: "markdown", template: "general_report" },
			},
			{
				wait: {
					// Keep tests fast.
					pollIntervalMs: 10,
					maxPollIntervalMs: 20,
					timeoutMs: 2_000,
				},
			},
		);

		expect(report.output.type).toBe("markdown");
		if (report.output.type === "markdown") {
			const markdownReport = report as Extract<
				typeof report,
				{ output: { type: "markdown" } }
			>;
			expect(markdownReport.markdown).toContain("Test Report");
		}

		// Consumer-relevant behavior: upload -> job creation -> polling -> report fetch.
		const paths = api.requests.map((r) => r.path);
		expect(paths).toContain("/v1/files");
		expect(paths).toContain("/v1/reports/jobs");
		expect(paths.some((p) => p.startsWith("/v1/jobs/"))).toBe(true);
		expect(paths.some((p) => p.startsWith("/v1/reports/"))).toBe(true);
	});

	test("reports.generateFromUrl downloads, uploads, waits and returns report", async () => {
		const client = new Mappa({
			apiKey: "test-api-key",
			baseUrl: api.baseUrl,
			maxRetries: 0,
		});

		const report = await client.reports.generateFromUrl(
			{
				url: `${api.baseUrl}/fixtures/sample.wav`,
				contentType: "audio/wav",
				filename: "sample.wav",
				output: { type: "markdown", template: "general_report" },
			},
			{
				wait: {
					pollIntervalMs: 10,
					maxPollIntervalMs: 20,
					timeoutMs: 2_000,
				},
			},
		);

		expect(report.output.type).toBe("markdown");
		if (report.output.type === "markdown") {
			const markdownReport = report as Extract<
				typeof report,
				{ output: { type: "markdown" } }
			>;
			expect(markdownReport.markdown).toContain("Test Report");
		}

		const paths = api.requests.map((r) => r.path);
		// download endpoint is part of the test server and is called via fetch()
		expect(paths).toContain("/fixtures/sample.wav");
		expect(paths).toContain("/v1/files");
		expect(paths).toContain("/v1/reports/jobs");
		expect(paths.some((p) => p.startsWith("/v1/jobs/"))).toBe(true);
		expect(paths.some((p) => p.startsWith("/v1/reports/"))).toBe(true);
	});

	test("reports.createJobFromUrl downloads, uploads then creates a job", async () => {
		const client = new Mappa({
			apiKey: "test-api-key",
			baseUrl: api.baseUrl,
			maxRetries: 0,
		});

		const receipt = await client.reports.createJobFromUrl({
			url: `${api.baseUrl}/fixtures/sample.wav`,
			contentType: "audio/wav",
			filename: "sample.wav",
			output: { type: "markdown", template: "general_report" },
		});

		expect(receipt.jobId).toMatch(/^job_/);

		const paths = api.requests.map((r) => r.path);
		// download endpoint is part of the test server and is called via fetch()
		expect(paths).toContain("/fixtures/sample.wav");
		expect(paths).toContain("/v1/files");
		expect(paths).toContain("/v1/reports/jobs");
	});

	test("reports.createJob rejects url media", async () => {
		const client = new Mappa({ apiKey: "test-api-key", baseUrl: api.baseUrl });

		let thrown: unknown;
		try {
			await client.reports.createJob({
				// Force a runtime validation error: createJob only accepts { mediaId }.
				media: { url: "https://example.com/file.wav" } as unknown as MediaIdRef,
				output: { type: "markdown", template: "general_report" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeTruthy();
	});

	test("maps 422 to ValidationError", async () => {
		const client = new Mappa({ apiKey: "test-api-key", baseUrl: api.baseUrl });

		let thrown: unknown;
		try {
			await client.reports.createJob({
				media: { mediaId: "media_does_not_exist" },
				output: { type: "markdown", template: "general_report" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ValidationError);
		const e = thrown as ValidationError;
		expect(e.status).toBe(422);
	});

	describe("files resource", () => {
		test("files.get returns file metadata", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			// Upload a file first
			const upload = await client.files.upload({
				file: new Uint8Array([1, 2, 3]),
				contentType: "audio/wav",
				filename: "test.wav",
			});

			const file = await client.files.get(upload.mediaId);

			expect(file.mediaId).toBe(upload.mediaId);
			expect(file.contentType).toBe("audio/wav");
			expect(file.processingStatus).toBe("COMPLETED");
			expect(file.retention).toBeDefined();
			expect(file.retention.locked).toBe(false);
		});

		test("files.list returns paginated files", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const page1 = await client.files.list({ limit: 10 });

			expect(page1.files.length).toBe(10);
			expect(page1.hasMore).toBe(true);
			expect(page1.cursor).toBeDefined();
		});

		test("files.list handles cursor pagination", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const page1 = await client.files.list({ limit: 10 });
			const page2 = await client.files.list({
				limit: 10,
				cursor: page1.cursor,
			});

			expect(page2.files.length).toBe(10);
			expect(page2.files[0]?.mediaId).not.toBe(page1.files[0]?.mediaId);
		});

		test("files.listAll iterates all files", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const allFiles = [];
			for await (const file of client.files.listAll({ limit: 10 })) {
				allFiles.push(file);
			}

			expect(allFiles.length).toBe(25); // Test server has 25 files
		});

		test("files.setRetentionLock locks retention", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const upload = await client.files.upload({
				file: new Uint8Array([1, 2, 3]),
				contentType: "audio/wav",
			});

			const result = await client.files.setRetentionLock(upload.mediaId, true);

			expect(result.mediaId).toBe(upload.mediaId);
			expect(result.retentionLock).toBe(true);
			expect(result.message).toContain("enabled");
		});

		test("files.setRetentionLock unlocks retention", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const upload = await client.files.upload({
				file: new Uint8Array([1, 2, 3]),
				contentType: "audio/wav",
			});

			await client.files.setRetentionLock(upload.mediaId, true);
			const result = await client.files.setRetentionLock(upload.mediaId, false);

			expect(result.retentionLock).toBe(false);
			expect(result.message).toContain("disabled");
		});
	});

	describe("credits resource", () => {
		test("credits.getBalance returns balance info", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const balance = await client.credits.getBalance();

			expect(balance.balance).toBe(1000);
			expect(balance.reserved).toBe(100);
			expect(balance.available).toBe(900);
		});

		test("credits.listTransactions returns paginated transactions", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const result = await client.credits.listTransactions({ limit: 25 });

			expect(result.transactions.length).toBe(25);
			expect(result.pagination.limit).toBe(25);
			expect(result.pagination.offset).toBe(0);
			expect(result.pagination.total).toBe(150);
		});

		test("credits.listTransactions respects offset", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const page1 = await client.credits.listTransactions({
				limit: 25,
				offset: 0,
			});
			const page2 = await client.credits.listTransactions({
				limit: 25,
				offset: 25,
			});

			expect(page2.transactions[0]?.id).not.toBe(page1.transactions[0]?.id);
		});

		test("credits.listAllTransactions iterates all transactions", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const allTx = [];
			for await (const tx of client.credits.listAllTransactions({
				limit: 50,
			})) {
				allTx.push(tx);
			}

			expect(allTx.length).toBe(150);
		});

		test("credits.getJobUsage returns usage for job", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			// Create a job first
			const upload = await client.files.upload({
				file: new Uint8Array([1, 2, 3]),
				contentType: "audio/wav",
			});

			const receipt = await client.reports.createJob({
				media: { mediaId: upload.mediaId },
				output: { type: "markdown", template: "general_report" },
			});

			const usage = await client.credits.getJobUsage(receipt.jobId);

			expect(usage.jobId).toBe(receipt.jobId);
			expect(usage.creditsUsed).toBe(100);
			expect(usage.creditsNetUsed).toBe(90);
		});

		test("credits.hasEnough returns true when sufficient", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const hasEnough = await client.credits.hasEnough(500);

			expect(hasEnough).toBe(true);
		});

		test("credits.hasEnough returns false when insufficient", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const hasEnough = await client.credits.hasEnough(1000);

			expect(hasEnough).toBe(false); // available is 900
		});

		test("credits.getAvailable returns available credits", async () => {
			const client = new Mappa({
				apiKey: "test-api-key",
				baseUrl: api.baseUrl,
			});

			const available = await client.credits.getAvailable();

			expect(available).toBe(900);
		});
	});

	describe("type guards", () => {
		test("isMarkdownReport identifies markdown reports", () => {
			const report = {
				id: "report_1",
				createdAt: new Date().toISOString(),
				media: { mediaId: "media_1" },
				output: { type: "markdown" as const, template: "general_report" },
				markdown: "# Test",
			};

			expect(isMarkdownReport(report)).toBe(true);
			expect(isJsonReport(report)).toBe(false);
			expect(isPdfReport(report)).toBe(false);
			expect(isUrlReport(report)).toBe(false);
		});

		test("isJsonReport identifies json reports", () => {
			const report = {
				id: "report_1",
				createdAt: new Date().toISOString(),
				media: { mediaId: "media_1" },
				output: { type: "json" as const, template: "general_report" },
				sections: [],
			};

			expect(isJsonReport(report)).toBe(true);
			expect(isMarkdownReport(report)).toBe(false);
			expect(isPdfReport(report)).toBe(false);
			expect(isUrlReport(report)).toBe(false);
		});

		test("isPdfReport identifies pdf reports", () => {
			const report = {
				id: "report_1",
				createdAt: new Date().toISOString(),
				media: { mediaId: "media_1" },
				output: { type: "pdf" as const, template: "general_report" },
				markdown: "# Test",
				pdfUrl: "https://example.com/report.pdf",
			};

			expect(isPdfReport(report)).toBe(true);
			expect(isMarkdownReport(report)).toBe(false);
			expect(isJsonReport(report)).toBe(false);
			expect(isUrlReport(report)).toBe(false);
		});

		test("isUrlReport identifies url reports", () => {
			const report = {
				id: "report_1",
				createdAt: new Date().toISOString(),
				media: { mediaId: "media_1" },
				output: { type: "url" as const, template: "general_report" },
				reportUrl: "https://example.com/report",
			};

			expect(isUrlReport(report)).toBe(true);
			expect(isMarkdownReport(report)).toBe(false);
			expect(isJsonReport(report)).toBe(false);
			expect(isPdfReport(report)).toBe(false);
		});
	});
});
