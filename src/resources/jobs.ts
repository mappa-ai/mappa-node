import {
	JobCanceledError,
	JobFailedError,
	MappaError,
	StreamError,
} from "$/errors";
import type { SSEEvent, Transport } from "$/resources/transport";
import type { Job, JobEvent, JobStage, WaitOptions } from "$/types";
import { makeAbortError } from "../utils";

/**
 * SSE event data shape from the server's job stream endpoint.
 */
type JobStreamEventData = {
	status?: string;
	stage?: string;
	progress?: number;
	job: Job;
	reportId?: string;
	error?: { code: string; message: string };
	timestamp?: string; // for heartbeat
};

export class JobsResource {
	constructor(private readonly transport: Transport) {}

	async get(
		jobId: string,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<Job> {
		const res = await this.transport.request<Job>({
			method: "GET",
			path: `/v1/jobs/${encodeURIComponent(jobId)}`,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	async cancel(
		jobId: string,
		opts?: {
			idempotencyKey?: string;
			requestId?: string;
			signal?: AbortSignal;
		},
	): Promise<Job> {
		const res = await this.transport.request<Job>({
			method: "POST",
			path: `/v1/jobs/${encodeURIComponent(jobId)}/cancel`,
			idempotencyKey: opts?.idempotencyKey,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	/**
	 * Wait for a job to reach a terminal state.
	 *
	 * Uses SSE streaming internally for efficient real-time updates.
	 */
	async wait(jobId: string, opts?: WaitOptions): Promise<Job> {
		const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
		const controller = new AbortController();

		// Set up timeout
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		// Combine signals if user provided one
		if (opts?.signal) {
			if (opts.signal.aborted) {
				clearTimeout(timeoutId);
				throw makeAbortError();
			}
			opts.signal.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
		}

		try {
			for await (const event of this.stream(jobId, {
				signal: controller.signal,
				onEvent: opts?.onEvent,
			})) {
				if (event.type === "terminal") {
					const job = event.job;

					if (job.status === "succeeded") {
						return job;
					}
					if (job.status === "failed") {
						throw new JobFailedError(
							jobId,
							job.error?.message ?? "Job failed",
							{
								requestId: job.requestId,
								code: job.error?.code,
								cause: job.error,
							},
						);
					}
					if (job.status === "canceled") {
						throw new JobCanceledError(jobId, "Job canceled", {
							requestId: job.requestId,
							cause: job.error,
						});
					}
				}
			}

			// Stream ended without terminal event (timeout or unexpected close)
			throw new JobFailedError(
				jobId,
				`Timed out waiting for job ${jobId} after ${timeoutMs}ms`,
				{
					cause: { jobId, timeoutMs },
				},
			);
		} finally {
			clearTimeout(timeoutId);
		}
	}

	/**
	 * Stream job events via SSE.
	 *
	 * Yields events as they arrive from the server. Use `AbortSignal` to cancel streaming.
	 * Automatically handles reconnection with `Last-Event-ID` for up to 3 retries.
	 */
	async *stream(
		jobId: string,
		opts?: { signal?: AbortSignal; onEvent?: (e: JobEvent) => void },
	): AsyncIterable<JobEvent> {
		const maxRetries = 3;
		let lastEventId: string | undefined;
		let retries = 0;

		while (retries < maxRetries) {
			try {
				const sseStream = this.transport.streamSSE<JobStreamEventData>(
					`/v1/jobs/${encodeURIComponent(jobId)}/stream`,
					{ signal: opts?.signal, lastEventId },
				);

				for await (const sseEvent of sseStream) {
					lastEventId = sseEvent.id;

					// Handle error event (job not found, etc.)
					if (sseEvent.event === "error") {
						const errorData = sseEvent.data;
						throw new MappaError(
							errorData.error?.message ?? "Unknown SSE error",
							{ code: errorData.error?.code },
						);
					}

					// Skip heartbeat events (internal keep-alive)
					if (sseEvent.event === "heartbeat") {
						continue;
					}

					// Map SSE event to JobEvent
					const jobEvent = this.mapSSEToJobEvent(sseEvent);
					if (jobEvent) {
						opts?.onEvent?.(jobEvent);
						yield jobEvent;

						// Exit on terminal event
						if (sseEvent.event === "terminal") {
							return;
						}
					}

					// Reset retry counter on successful event
					retries = 0;
				}

				// Stream ended without terminal event (server timeout)
				// Reconnect with last event ID
				retries++;
				if (retries < maxRetries) {
					await this.backoff(retries);
				}
			} catch (error) {
				// If aborted, rethrow immediately
				if (opts?.signal?.aborted) {
					throw error;
				}

				retries++;
				if (retries >= maxRetries) {
					// Wrap in StreamError with recovery metadata
					throw new StreamError(
						`Stream connection failed for job ${jobId} after ${maxRetries} retries`,
						{
							jobId,
							lastEventId,
							retryCount: retries,
							cause: error,
						},
					);
				}

				await this.backoff(retries);
			}
		}

		throw new StreamError(
			`Failed to get status for job ${jobId} after ${maxRetries} retries`,
			{
				jobId,
				lastEventId,
				retryCount: maxRetries,
			},
		);
	}

	/**
	 * Map an SSE event to a JobEvent.
	 */
	private mapSSEToJobEvent(
		sseEvent: SSEEvent<JobStreamEventData>,
	): JobEvent | null {
		const data = sseEvent.data;

		switch (sseEvent.event) {
			case "status":
				return { type: "status", job: data.job };
			case "stage":
				return {
					type: "stage",
					stage: data.stage as JobStage,
					progress: data.progress,
					job: data.job,
				};
			case "terminal":
				return { type: "terminal", job: data.job };
			default:
				// Unknown event type, treat as status update
				return { type: "status", job: data.job };
		}
	}

	/**
	 * Exponential backoff with jitter for reconnection.
	 */
	private async backoff(attempt: number): Promise<void> {
		const delay = Math.min(1000 * 2 ** attempt, 10000);
		const jitter = delay * 0.5 * Math.random();
		await new Promise((r) => setTimeout(r, delay + jitter));
	}
}
