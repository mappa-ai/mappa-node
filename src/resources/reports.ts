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

/**
 * Runtime validation for the public `MediaRef` union.
 *
 * `MediaRef` is part of the SDK's public surface and can be constructed from
 * untyped input at runtime. We defensively validate it here to:
 *
 * - enforce that exactly one of `{ url }` or `{ mediaId }` is provided
 * - provide actionable errors early (before making a network call)
 */
function validateMedia(media: MediaRef): void {
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

/**
 * Request shape for {@link ReportsResource.createJobFromFile}.
 *
 * This helper performs two API calls as one logical operation:
 * 1) Upload bytes via `files.upload()` (multipart)
 * 2) Create a report job via {@link ReportsResource.createJob} using the returned `{ mediaId }`
 *
 * Differences vs {@link ReportCreateJobRequest}:
 * - `media` is derived from the upload result and therefore omitted.
 * - `idempotencyKey` applies to the *whole* upload + create-job sequence.
 * - `requestId` is forwarded to both requests for end-to-end correlation.
 *
 * Abort behavior:
 * - `signal` (from {@link UploadRequest}) is applied to the upload request.
 *   Job creation only runs after a successful upload.
 */
export type ReportCreateJobFromFileRequest = Omit<
	ReportCreateJobRequest,
	"media" | "idempotencyKey" | "requestId"
> &
	Omit<UploadRequest, "filename"> & {
		/**
		 * Optional filename to attach to the upload.
		 *
		 * When omitted, the upload layer may infer it (e.g. from a `File` object).
		 */
		filename?: string;
		/**
		 * Idempotency for the upload + job creation sequence.
		 */
		idempotencyKey?: string;
		/**
		 * Optional request correlation ID forwarded to both the upload and the job creation call.
		 */
		requestId?: string;
	};

/**
 * Reports API resource.
 *
 * Responsibilities:
 * - Create report jobs (`POST /v1/reports/jobs`).
 * - Fetch reports by report ID (`GET /v1/reports/:reportId`).
 * - Fetch reports by job ID (`GET /v1/reports/by-job/:jobId`).
 *
 * Convenience helpers:
 * - {@link ReportsResource.createJobFromFile} orchestrates `files.upload()` + {@link ReportsResource.createJob}.
 * - {@link ReportsResource.generate} / {@link ReportsResource.generateFromFile} are script-friendly wrappers that
 *   create a job, wait for completion, and then fetch the final report.
 *
 * For production systems, prefer `createJob*()` plus webhooks or streaming job events rather than blocking waits.
 */
export class ReportsResource {
	constructor(
		private readonly transport: Transport,
		private readonly jobs: JobsResource,
		private readonly files: {
			upload: (req: UploadRequest) => Promise<MediaObject>;
		},
	) {}

	/**
	 * Create a new report job.
	 *
	 * Behavior:
	 * - Validates {@link MediaRef} at runtime (must provide exactly one of `{ url }` or `{ mediaId }`).
	 * - Applies an idempotency key: uses `req.idempotencyKey` when provided; otherwise generates a best-effort default.
	 * - Forwards `req.requestId` to the transport for end-to-end correlation.
	 *
	 * The returned receipt includes a {@link ReportRunHandle} (`receipt.handle`) which can be used to:
	 * - stream job events
	 * - wait for completion and fetch the final report
	 * - cancel the job, or fetch job/report metadata
	 */
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
