import { MappaError } from "$/errors";
import type { UploadRequest } from "$/resources/files";
import type { JobsResource } from "$/resources/jobs";
import type { Transport } from "$/resources/transport";
import type {
	JobEvent,
	MediaIdRef,
	MediaObject,
	Report,
	ReportCreateJobRequest,
	ReportJobReceipt,
	ReportRunHandle,
	WaitOptions,
} from "$/types";
import { randomId } from "$/utils";

/**
 * Runtime validation for the internal `MediaIdRef` requirement.
 *
 * The public API server expects a `mediaId` when creating a report job.
 * Use helpers like `createJobFromFile` / `createJobFromUrl` to start from bytes or a URL.
 */
function validateMedia(media: MediaIdRef): void {
	const m = media as unknown;
	const isObj = (v: unknown): v is Record<string, unknown> =>
		v !== null && typeof v === "object";

	if (!isObj(m)) throw new MappaError("media must be an object");

	// Report job creation only supports already-uploaded media references.
	// Use `createJobFromFile` / `createJobFromUrl` to start from bytes or a remote URL.
	if ((m as { url?: unknown }).url !== undefined) {
		throw new MappaError(
			"media.url is not supported; pass { mediaId } or use createJobFromUrl()",
		);
	}

	const mediaId = (m as { mediaId?: unknown }).mediaId;
	if (typeof mediaId !== "string" || !mediaId) {
		throw new MappaError("media.mediaId must be a non-empty string");
	}
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
 * Request shape for {@link ReportsResource.createJobFromUrl}.
 *
 * This helper performs two API calls as one logical operation:
 * 1) Download bytes from a remote URL using `fetch()`
 * 2) Upload bytes via `files.upload()` and then create a report job via {@link ReportsResource.createJob}
 *
 * Differences vs {@link ReportCreateJobRequest}:
 * - `media` is derived from the upload result and therefore omitted.
 * - `idempotencyKey` applies to the *whole* download + upload + create-job sequence.
 * - `requestId` is forwarded to both upload and job creation calls.
 */
export type ReportCreateJobFromUrlRequest = Omit<
	ReportCreateJobRequest,
	"media" | "idempotencyKey" | "requestId"
> & {
	url: string;
	contentType?: string;
	filename?: string;
	idempotencyKey?: string;
	requestId?: string;
	signal?: AbortSignal;
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
 * - {@link ReportsResource.createJobFromUrl} downloads a remote URL, uploads it, then calls {@link ReportsResource.createJob}.
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
		private readonly fetchImpl: typeof fetch,
	) {}

	/**
	 * Create a new report job.
	 *
	 * Behavior:
	 * - Validates {@link MediaIdRef} at runtime (must provide `{ mediaId }`).
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
	 * Upload a file and create a report job in one call.
	 *
	 * Keeps `createJob()` strict about `media: { mediaId }` while offering a
	 * convenient helper when you start from raw bytes.
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

	/**
	 * Download a file from a URL, upload it, and create a report job.
	 *
	 * Recommended when starting from a remote URL because report job creation
	 * only accepts `media: { mediaId }`.
	 *
	 * Workflow:
	 * 1) `fetch(url)`
	 * 2) Validate the response (2xx) and derive `contentType`
	 * 3) `files.upload({ file: Blob, ... })`
	 * 4) `createJob({ media: { mediaId }, ... })`
	 *
	 * Verification / safety:
	 * - Only allows `http:` and `https:` URLs.
	 * - Requires a resolvable `contentType` (from `req.contentType` or response header).
	 */
	async createJobFromUrl(
		req: ReportCreateJobFromUrlRequest,
	): Promise<ReportJobReceipt> {
		const {
			url,
			contentType: contentTypeOverride,
			filename,
			idempotencyKey,
			requestId,
			signal,
			...rest
		} = req;

		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new MappaError("url must be a valid URL");
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			throw new MappaError("url must use http: or https:");
		}

		const res = await this.fetchImpl(parsed.toString(), { signal });
		if (!res.ok) {
			throw new MappaError(`Failed to download url (status ${res.status})`);
		}

		const derivedContentType = res.headers.get("content-type") ?? undefined;
		const contentType = contentTypeOverride ?? derivedContentType;
		if (!contentType) {
			throw new MappaError(
				"contentType is required when it cannot be inferred from the download response",
			);
		}

		if (typeof Blob === "undefined") {
			throw new MappaError(
				"Blob is not available in this runtime; cannot download and upload from url",
			);
		}

		const blob = await res.blob();
		const upload = await this.files.upload({
			file: blob,
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
			throw new MappaError("Job receipt is missing handle");
		}
		return receipt.handle.wait(opts?.wait);
	}

	/**
	 * Convenience wrapper: createJobFromFile + wait + get.
	 * Use for scripts; for production prefer createJobFromFile + webhooks/stream.
	 */
	async generateFromFile(
		req: ReportCreateJobFromFileRequest,
		opts?: { wait?: WaitOptions },
	): Promise<Report> {
		const receipt = await this.createJobFromFile(req);
		if (!receipt.handle) throw new MappaError("Job receipt is missing handle");
		return receipt.handle.wait(opts?.wait);
	}

	/**
	 * Convenience wrapper: createJobFromUrl + wait + get.
	 * Use for scripts; for production prefer createJobFromUrl + webhooks/stream.
	 */
	async generateFromUrl(
		req: ReportCreateJobFromUrlRequest,
		opts?: { wait?: WaitOptions },
	): Promise<Report> {
		const receipt = await this.createJobFromUrl(req);
		if (!receipt.handle) throw new MappaError("Job receipt is missing handle");
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
					throw new MappaError(
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
		// Deterministic keys can be added later; random avoids accidental duplicates on retries.
		return randomId("idem");
	}
}
