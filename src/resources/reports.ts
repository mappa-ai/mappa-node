import type { UploadRequest } from "$/resources/files";
import type { JobsResource } from "$/resources/jobs";
import type { Transport } from "$/resources/transport";
import type {
	JobEvent,
	MediaObject,
	MediaRef,
	Report,
	ReportCreateJobRequest,
	ReportJobReceipt,
	ReportRunHandle,
	WaitOptions,
} from "$/types";
import { randomId } from "$/utils";

function validateMedia(media: MediaRef): void {
	// We validate at runtime because MediaRef is part of the public SDK surface and
	// can be constructed from untyped user input.
	const m = media as unknown;
	const isObj = (v: unknown): v is Record<string, unknown> =>
		v !== null && typeof v === "object";

	if (!isObj(m)) throw new Error("media must be an object");

	const hasUrl = (m as { url?: unknown }).url !== undefined;
	const hasMediaId = (m as { mediaId?: unknown }).mediaId !== undefined;
	if (hasUrl === hasMediaId) {
		throw new Error("media must be exactly one of {url} or {mediaId}");
	}
	if (hasUrl && typeof (m as { url?: unknown }).url !== "string")
		throw new Error("media.url must be a string");
	if (hasMediaId && typeof (m as { mediaId?: unknown }).mediaId !== "string")
		throw new Error("media.mediaId must be a string");
}

export type ReportCreateJobFromFileRequest = Omit<
	ReportCreateJobRequest,
	"media" | "idempotencyKey" | "requestId"
> &
	Omit<UploadRequest, "filename"> & {
		filename?: string;
		/**
		 * Idempotency for the upload + job creation sequence.
		 */
		idempotencyKey?: string;
		requestId?: string;
	};

export class ReportsResource {
	constructor(
		private readonly transport: Transport,
		private readonly jobs: JobsResource,
		private readonly files: {
			upload: (req: UploadRequest) => Promise<MediaObject>;
		},
	) {}

	async createJob(req: ReportCreateJobRequest): Promise<ReportJobReceipt> {
		validateMedia(req.media);

		const idempotencyKey =
			req.idempotencyKey ?? this.defaultIdempotencyKey(req);

		const res = await this.transport.request<Omit<ReportJobReceipt, "handle">>({
			method: "POST",
			path: "/v1/reports/jobs",
			body: req,
			idempotencyKey,
			requestId: req.requestId,
			retryable: true,
		});

		const receipt: ReportJobReceipt = {
			...res.data,
			requestId: res.requestId ?? res.data.requestId,
		};

		receipt.handle = this.makeHandle(receipt.jobId);
		return receipt;
	}

	/**
	 * Best-in-class DX: Upload a file and create a report job in one call.
	 *
	 * This keeps `createJob()` clean (it always accepts `media: {mediaId}|{url}`),
	 * while providing a one-liner for the common "I have bytes" workflow.
	 */
	async createJobFromFile(
		req: ReportCreateJobFromFileRequest,
	): Promise<ReportJobReceipt> {
		const {
			file,
			contentType,
			filename,
			idempotencyKey,
			requestId,
			signal,
			...rest
		} = req;

		const upload = await this.files.upload({
			file,
			contentType,
			filename,
			idempotencyKey,
			requestId,
			signal,
		});

		return this.createJob({
			...(rest as Omit<ReportCreateJobRequest, "media">),
			media: { mediaId: upload.mediaId },
			idempotencyKey,
			requestId,
		});
	}

	async get(
		reportId: string,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<Report> {
		const res = await this.transport.request<Report>({
			method: "GET",
			path: `/v1/reports/${encodeURIComponent(reportId)}`,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	async getByJob(
		jobId: string,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<Report | null> {
		const res = await this.transport.request<Report | null>({
			method: "GET",
			path: `/v1/reports/by-job/${encodeURIComponent(jobId)}`,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});
		return res.data;
	}

	/**
	 * Convenience wrapper: createJob + wait + get
	 * Use for scripts; for production prefer createJob + webhooks/stream.
	 */
	async generate(
		req: ReportCreateJobRequest,
		opts?: { wait?: WaitOptions },
	): Promise<Report> {
		const receipt = await this.createJob(req);
		if (!receipt.handle) {
			throw new Error("Job receipt is missing handle");
		}
		return receipt.handle.wait(opts?.wait);
	}

	/**
	 * Best-in-class DX: createJobFromFile + wait + get.
	 * Use for scripts; for production prefer createJobFromFile + webhooks/stream.
	 */
	async generateFromFile(
		req: ReportCreateJobFromFileRequest,
		opts?: { wait?: WaitOptions },
	): Promise<Report> {
		const receipt = await this.createJobFromFile(req);
		if (!receipt.handle) throw new Error("Job receipt is missing handle");
		return receipt.handle.wait(opts?.wait);
	}

	makeHandle(jobId: string): ReportRunHandle {
		const self = this;
		return {
			jobId,
			stream: (opts?: {
				signal?: AbortSignal;
				onEvent?: (e: JobEvent) => void;
			}) => self.jobs.stream(jobId, opts),
			async wait(opts?: WaitOptions): Promise<Report> {
				const terminal = await self.jobs.wait(jobId, opts);
				if (!terminal.reportId)
					throw new Error(
						`Job ${jobId} succeeded but no reportId was returned`,
					);
				return self.get(terminal.reportId);
			},
			cancel: () => self.jobs.cancel(jobId),
			job: () => self.jobs.get(jobId),
			report: () => self.getByJob(jobId),
		};
	}

	private defaultIdempotencyKey(_req: ReportCreateJobRequest): string {
		// Best-in-class: deterministic keys can be added later; random still prevents accidental duplicates on retries.
		return randomId("idem");
	}
}
