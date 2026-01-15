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
				output: { type: "markdown" },
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
				output: { type: "markdown" },
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
			output: { type: "markdown" },
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
				output: { type: "markdown" },
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
				output: { type: "markdown" },
			});
		} catch (err) {
			thrown = err;
		}

		expect(thrown).toBeInstanceOf(ValidationError);
		const e = thrown as ValidationError;
		expect(e.status).toBe(422);
	});
});
