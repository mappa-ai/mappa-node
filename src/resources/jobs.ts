import type { Transport } from "$/resources/transport";
import type { Job, JobEvent, WaitOptions } from "$/types";
import { JobCanceledError, JobFailedError } from "../errors";
import { backoffMs, jitter, nowMs } from "../utils";

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

	async wait(jobId: string, opts?: WaitOptions): Promise<Job> {
		const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
		const basePoll = opts?.pollIntervalMs ?? 1000;
		const maxPoll = opts?.maxPollIntervalMs ?? 10_000;

		const start = nowMs();
		let attempt = 0;
		let lastStage: string | undefined;
		let lastStatus: string | undefined;

		while (true) {
			if (opts?.signal?.aborted) throw new Error("Aborted");

			const job = await this.get(jobId, { signal: opts?.signal });

			// Emit useful events only when something changes
			if (job.status !== lastStatus) {
				lastStatus = job.status;
				opts?.onEvent?.({ type: "status", job });
			}
			if (job.stage && job.stage !== lastStage) {
				lastStage = job.stage;
				opts?.onEvent?.({
					type: "stage",
					stage: job.stage,
					progress: job.progress,
					job,
				});
			}

			if (job.status === "succeeded") {
				opts?.onEvent?.({ type: "terminal", job });
				return job;
			}
			if (job.status === "failed") {
				opts?.onEvent?.({ type: "terminal", job });
				throw new JobFailedError(jobId, job.error?.message ?? "Job failed", {
					requestId: job.requestId,
					code: job.error?.code,
					cause: job.error,
				});
			}
			if (job.status === "canceled") {
				opts?.onEvent?.({ type: "terminal", job });
				throw new JobCanceledError(jobId, "Job canceled", {
					requestId: job.requestId,
					cause: job.error,
				});
			}

			if (nowMs() - start > timeoutMs) {
				throw new Error(
					`Timed out waiting for job ${jobId} after ${timeoutMs}ms`,
				);
			}

			attempt += 1;
			const sleep = jitter(backoffMs(attempt, basePoll, maxPoll));
			await new Promise((r) => setTimeout(r, sleep));
		}
	}

	/**
	 * Best-in-class: public stream API.
	 * If you add SSE later, keep this signature and switch implementation internally.
	 * For now, it yields events based on polling.
	 */
	async *stream(
		jobId: string,
		opts?: { signal?: AbortSignal; onEvent?: (e: JobEvent) => void },
	): AsyncIterable<JobEvent> {
		let lastStage: string | undefined;
		let lastStatus: string | undefined;

		while (true) {
			if (opts?.signal?.aborted) return;

			const job = await this.get(jobId, { signal: opts?.signal });

			if (job.status !== lastStatus) {
				lastStatus = job.status;
				const e: JobEvent = { type: "status", job };
				opts?.onEvent?.(e);
				yield e;
			}

			if (job.stage && job.stage !== lastStage) {
				lastStage = job.stage;
				const e: JobEvent = {
					type: "stage",
					stage: job.stage,
					progress: job.progress,
					job,
				};
				opts?.onEvent?.(e);
				yield e;
			}

			if (
				job.status === "succeeded" ||
				job.status === "failed" ||
				job.status === "canceled"
			) {
				const e: JobEvent = { type: "terminal", job };
				opts?.onEvent?.(e);
				yield e;
				return;
			}

			await new Promise((r) => setTimeout(r, 1000));
		}
	}
}
