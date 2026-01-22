import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import type { ReportCompletedData, ReportFailedData } from "../src/index";
import { Mappa } from "../src/index";

/**
 * Compute HMAC-SHA256 signature matching the API's format.
 * This mirrors the behavioral-engine's WebhookService.computeSignature().
 */
function computeSignature(
	payload: string,
	timestamp: string,
	secret: string,
): string {
	const signedPayload = `${timestamp}.${payload}`;
	return createHmac("sha256", secret).update(signedPayload).digest("hex");
}

/**
 * Create a signature header in the format the API sends.
 */
function createSignatureHeader(
	payload: string,
	secret: string,
	timestamp?: number,
): string {
	const ts = timestamp ?? Math.floor(Date.now() / 1000);
	const sig = computeSignature(payload, ts.toString(), secret);
	return `t=${ts},v1=${sig}`;
}

describe("webhooks", () => {
	const client = new Mappa({ apiKey: "test-key" });
	const secret = "whsec_test_secret_key_12345";

	describe("verifySignature", () => {
		test("accepts valid signature", async () => {
			const payload = JSON.stringify({
				type: "report.completed",
				timestamp: new Date().toISOString(),
				data: { jobId: "job_123", reportId: "rep_456", status: "succeeded" },
			});

			const sigHeader = createSignatureHeader(payload, secret);

			const result = await client.webhooks.verifySignature({
				payload,
				headers: { "mappa-signature": sigHeader },
				secret,
			});

			expect(result.ok).toBe(true);
		});

		test("accepts valid signature with case-insensitive header name", async () => {
			const payload = JSON.stringify({
				type: "report.completed",
				timestamp: new Date().toISOString(),
				data: { jobId: "job_123", reportId: "rep_456", status: "succeeded" },
			});

			const sigHeader = createSignatureHeader(payload, secret);

			const result = await client.webhooks.verifySignature({
				payload,
				headers: { "Mappa-Signature": sigHeader },
				secret,
			});

			expect(result.ok).toBe(true);
		});

		test("rejects missing signature header", async () => {
			const payload = JSON.stringify({ type: "test", timestamp: "2024-01-01" });

			await expect(
				client.webhooks.verifySignature({
					payload,
					headers: {},
					secret,
				}),
			).rejects.toThrow("Missing mappa-signature header");
		});

		test("rejects invalid signature format", async () => {
			const payload = JSON.stringify({ type: "test", timestamp: "2024-01-01" });

			await expect(
				client.webhooks.verifySignature({
					payload,
					headers: { "mappa-signature": "invalid-format" },
					secret,
				}),
			).rejects.toThrow("Invalid signature format");
		});

		test("rejects expired timestamp", async () => {
			const payload = JSON.stringify({ type: "test", timestamp: "2024-01-01" });
			const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
			const sigHeader = createSignatureHeader(payload, secret, oldTimestamp);

			await expect(
				client.webhooks.verifySignature({
					payload,
					headers: { "mappa-signature": sigHeader },
					secret,
				}),
			).rejects.toThrow("Signature timestamp outside tolerance");
		});

		test("rejects future timestamp outside tolerance", async () => {
			const payload = JSON.stringify({ type: "test", timestamp: "2024-01-01" });
			const futureTimestamp = Math.floor(Date.now() / 1000) + 600; // 10 minutes in future
			const sigHeader = createSignatureHeader(payload, secret, futureTimestamp);

			await expect(
				client.webhooks.verifySignature({
					payload,
					headers: { "mappa-signature": sigHeader },
					secret,
				}),
			).rejects.toThrow("Signature timestamp outside tolerance");
		});

		test("rejects wrong signature", async () => {
			const payload = JSON.stringify({ type: "test", timestamp: "2024-01-01" });
			const sigHeader = createSignatureHeader(payload, "wrong_secret");

			await expect(
				client.webhooks.verifySignature({
					payload,
					headers: { "mappa-signature": sigHeader },
					secret,
				}),
			).rejects.toThrow("Invalid signature");
		});

		test("rejects tampered payload", async () => {
			const originalPayload = JSON.stringify({
				type: "test",
				timestamp: "2024-01-01",
			});
			const sigHeader = createSignatureHeader(originalPayload, secret);

			const tamperedPayload = JSON.stringify({
				type: "test",
				timestamp: "2024-01-02",
			});

			await expect(
				client.webhooks.verifySignature({
					payload: tamperedPayload,
					headers: { "mappa-signature": sigHeader },
					secret,
				}),
			).rejects.toThrow("Invalid signature");
		});

		test("accepts custom tolerance", async () => {
			const payload = JSON.stringify({ type: "test", timestamp: "2024-01-01" });
			const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 6.6 minutes ago
			const sigHeader = createSignatureHeader(payload, secret, oldTimestamp);

			// Default tolerance (300s) should reject
			await expect(
				client.webhooks.verifySignature({
					payload,
					headers: { "mappa-signature": sigHeader },
					secret,
				}),
			).rejects.toThrow("Signature timestamp outside tolerance");

			// Custom tolerance (600s) should accept
			const result = await client.webhooks.verifySignature({
				payload,
				headers: { "mappa-signature": sigHeader },
				secret,
				toleranceSec: 600,
			});

			expect(result.ok).toBe(true);
		});
	});

	describe("parseEvent", () => {
		test("parses report.completed event", () => {
			const payload = JSON.stringify({
				type: "report.completed",
				timestamp: "2024-01-15T10:30:00.000Z",
				data: {
					jobId: "job_abc123",
					reportId: "rep_def456",
					status: "succeeded",
				},
			});

			const event = client.webhooks.parseEvent<ReportCompletedData>(payload);

			expect(event.type).toBe("report.completed");
			expect(event.timestamp).toBe("2024-01-15T10:30:00.000Z");
			expect(event.data.jobId).toBe("job_abc123");
			expect(event.data.reportId).toBe("rep_def456");
			expect(event.data.status).toBe("succeeded");
		});

		test("parses report.failed event", () => {
			const payload = JSON.stringify({
				type: "report.failed",
				timestamp: "2024-01-15T10:30:00.000Z",
				data: {
					jobId: "job_abc123",
					status: "failed",
					error: {
						code: "processing_failed",
						message: "Failed to process document",
					},
				},
			});

			const event = client.webhooks.parseEvent<ReportFailedData>(payload);

			expect(event.type).toBe("report.failed");
			expect(event.timestamp).toBe("2024-01-15T10:30:00.000Z");
			expect(event.data.jobId).toBe("job_abc123");
			expect(event.data.status).toBe("failed");
			expect(event.data.error.code).toBe("processing_failed");
			expect(event.data.error.message).toBe("Failed to process document");
		});

		test("rejects non-object payload", () => {
			expect(() => client.webhooks.parseEvent("null")).toThrow(
				"Invalid webhook payload: not an object",
			);

			expect(() => client.webhooks.parseEvent('"string"')).toThrow(
				"Invalid webhook payload: not an object",
			);

			// Note: Arrays pass the isObject check but fail on type field validation
			expect(() => client.webhooks.parseEvent("[]")).toThrow(
				"Invalid webhook payload: type must be a string",
			);
		});

		test("rejects missing type field", () => {
			const payload = JSON.stringify({
				timestamp: "2024-01-15T10:30:00.000Z",
				data: {},
			});

			expect(() => client.webhooks.parseEvent(payload)).toThrow(
				"Invalid webhook payload: type must be a string",
			);
		});

		test("rejects missing timestamp field", () => {
			const payload = JSON.stringify({
				type: "report.completed",
				data: {},
			});

			expect(() => client.webhooks.parseEvent(payload)).toThrow(
				"Invalid webhook payload: timestamp must be a string",
			);
		});

		test("handles missing data field gracefully", () => {
			const payload = JSON.stringify({
				type: "unknown.event",
				timestamp: "2024-01-15T10:30:00.000Z",
			});

			const event = client.webhooks.parseEvent(payload);

			expect(event.type).toBe("unknown.event");
			expect(event.timestamp).toBe("2024-01-15T10:30:00.000Z");
			expect(event.data).toBeUndefined();
		});

		test("rejects invalid JSON", () => {
			expect(() => client.webhooks.parseEvent("{invalid}")).toThrow();
		});
	});

	describe("end-to-end verification and parsing", () => {
		test("verifies and parses a complete webhook request", async () => {
			// Simulate what the API sends
			const eventPayload = {
				type: "report.completed",
				timestamp: new Date().toISOString(),
				data: {
					jobId: "job_integration_test",
					reportId: "rep_integration_test",
					status: "succeeded" as const,
				},
			};

			const payloadString = JSON.stringify(eventPayload);
			const sigHeader = createSignatureHeader(payloadString, secret);

			// Verify signature first
			const verifyResult = await client.webhooks.verifySignature({
				payload: payloadString,
				headers: { "mappa-signature": sigHeader },
				secret,
			});
			expect(verifyResult.ok).toBe(true);

			// Then parse the event
			const event =
				client.webhooks.parseEvent<ReportCompletedData>(payloadString);
			expect(event.type).toBe("report.completed");
			expect(event.data.jobId).toBe("job_integration_test");
		});
	});
});
