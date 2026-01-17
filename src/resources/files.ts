import { MappaError } from "$/errors";
import type { Transport } from "$/resources/transport";
import type {
	FileDeleteReceipt,
	MediaFile,
	MediaObject,
	RetentionLockResult,
} from "$/types";

export type UploadRequest = {
	file: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
	/**
	 * Optional override.
	 * If omitted, the SDK will try to infer it from `file.type` (Blob) and then from `filename`.
	 */
	contentType?: string;
	filename?: string;
	idempotencyKey?: string;
	requestId?: string;
	signal?: AbortSignal;
};

export type ListFilesOptions = {
	/** Max files per page (1-100, default 20) */
	limit?: number;
	/** Pagination cursor from previous response */
	cursor?: string;
	/** Include soft-deleted files (default false) */
	includeDeleted?: boolean;
	requestId?: string;
	signal?: AbortSignal;
};

export type ListFilesResponse = {
	files: MediaFile[];
	cursor?: string;
	hasMore: boolean;
};

/**
 * Uses multipart/form-data for uploads.
 *
 * If you need resumable uploads, add a dedicated resumable protocol.
 */
export class FilesResource {
	constructor(private readonly transport: Transport) {}

	async upload(req: UploadRequest): Promise<MediaObject> {
		if (typeof FormData === "undefined") {
			throw new MappaError(
				"FormData is not available in this runtime; cannot perform multipart upload",
			);
		}

		const derivedContentType = inferContentType(req.file, req.filename);
		const contentType = req.contentType ?? derivedContentType;
		if (!contentType) {
			throw new MappaError(
				"contentType is required when it cannot be inferred from file.type or filename",
			);
		}

		const filename = req.filename ?? inferFilename(req.file) ?? "upload";
		const filePart = await toFormDataPart(req.file, contentType);

		const form = new FormData();
		// Server expects multipart fields:
		// - file: binary
		// - contentType: string (may be used for validation/normalization)
		// - filename: string (optional)
		form.append("file", filePart, filename);
		form.append("contentType", contentType);
		if (req.filename) form.append("filename", req.filename);

		const res = await this.transport.request<MediaObject>({
			method: "POST",
			path: "/v1/files",
			body: form,
			idempotencyKey: req.idempotencyKey,
			requestId: req.requestId,
			signal: req.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * Retrieve metadata for a single uploaded file.
	 *
	 * @example
	 * const file = await mappa.files.get("media_abc123");
	 * console.log(file.processingStatus); // "COMPLETED"
	 */
	async get(
		mediaId: string,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<MediaFile> {
		if (!mediaId) throw new MappaError("mediaId is required");

		const res = await this.transport.request<MediaFile>({
			method: "GET",
			path: `/v1/files/${encodeURIComponent(mediaId)}`,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * List uploaded files with cursor pagination.
	 *
	 * @example
	 * const page1 = await mappa.files.list({ limit: 10 });
	 * if (page1.hasMore) {
	 *   const page2 = await mappa.files.list({ limit: 10, cursor: page1.cursor });
	 * }
	 */
	async list(opts?: ListFilesOptions): Promise<ListFilesResponse> {
		const query: Record<string, string> = {};
		if (opts?.limit !== undefined) query.limit = String(opts.limit);
		if (opts?.cursor) query.cursor = opts.cursor;
		if (opts?.includeDeleted !== undefined)
			query.includeDeleted = String(opts.includeDeleted);

		const res = await this.transport.request<ListFilesResponse>({
			method: "GET",
			path: "/v1/files",
			query,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * Iterate over all files, automatically handling pagination.
	 *
	 * @example
	 * for await (const file of mappa.files.listAll()) {
	 *   console.log(file.mediaId);
	 * }
	 *
	 * // Or collect all
	 * const allFiles = [];
	 * for await (const file of mappa.files.listAll({ limit: 50 })) {
	 *   allFiles.push(file);
	 * }
	 */
	async *listAll(
		opts?: Omit<ListFilesOptions, "cursor">,
	): AsyncIterable<MediaFile> {
		let cursor: string | undefined;
		let hasMore = true;

		while (hasMore) {
			const page = await this.list({ ...opts, cursor });
			for (const file of page.files) {
				yield file;
			}
			cursor = page.cursor;
			hasMore = page.hasMore;
		}
	}

	/**
	 * Lock or unlock a file's retention to prevent/allow automatic deletion.
	 *
	 * @example
	 * // Prevent automatic deletion
	 * await mappa.files.setRetentionLock("media_abc", true);
	 *
	 * // Allow automatic deletion
	 * await mappa.files.setRetentionLock("media_abc", false);
	 */
	async setRetentionLock(
		mediaId: string,
		locked: boolean,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<RetentionLockResult> {
		if (!mediaId) throw new MappaError("mediaId is required");

		const res = await this.transport.request<RetentionLockResult>({
			method: "PATCH",
			path: `/v1/files/${encodeURIComponent(mediaId)}/retention`,
			body: { lock: locked },
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	async delete(
		mediaId: string,
		opts?: {
			idempotencyKey?: string;
			requestId?: string;
			signal?: AbortSignal;
		},
	): Promise<FileDeleteReceipt> {
		if (!mediaId) throw new MappaError("mediaId is required");

		const res = await this.transport.request<FileDeleteReceipt>({
			method: "DELETE",
			path: `/v1/files/${encodeURIComponent(mediaId)}`,
			idempotencyKey: opts?.idempotencyKey,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}
}

function inferContentType(
	file: UploadRequest["file"],
	filename?: string,
): string | undefined {
	if (typeof Blob !== "undefined" && file instanceof Blob) {
		if (file.type) return file.type;
	}
	if (filename) return contentTypeFromFilename(filename);
	return undefined;
}

function inferFilename(file: UploadRequest["file"]): string | undefined {
	if (typeof Blob !== "undefined" && file instanceof Blob) {
		const anyBlob = file as unknown as { name?: unknown };
		if (typeof anyBlob.name === "string" && anyBlob.name) return anyBlob.name;
	}
	return undefined;
}

function contentTypeFromFilename(filename: string): string | undefined {
	const i = filename.lastIndexOf(".");
	if (i < 0) return undefined;
	const ext = filename.slice(i + 1).toLowerCase();

	// Small built-in map to avoid an extra dependency.
	// Add more as needed.
	switch (ext) {
		case "mp4":
			return "video/mp4";
		case "mov":
			return "video/quicktime";
		case "webm":
			return "video/webm";
		case "mp3":
			return "audio/mpeg";
		case "wav":
			return "audio/wav";
		case "m4a":
			return "audio/mp4";
		case "png":
			return "image/png";
		case "jpg":
		case "jpeg":
			return "image/jpeg";
		case "gif":
			return "image/gif";
		case "webp":
			return "image/webp";
		case "pdf":
			return "application/pdf";
		case "json":
			return "application/json";
		case "txt":
			return "text/plain";
		default:
			return undefined;
	}
}

async function toFormDataPart(
	file: UploadRequest["file"],
	contentType: string,
): Promise<Blob> {
	// Blob: ensure the part has the intended type.
	if (typeof Blob !== "undefined" && file instanceof Blob) {
		if (file.type === contentType) return file;
		// TS in this repo is configured without DOM lib, so `Blob#slice` isn't typed.
		// Most runtimes support it; we call it via an `any` cast.
		const slicer = file as unknown as {
			slice?: (start?: number, end?: number, contentType?: string) => Blob;
		};
		if (typeof slicer.slice === "function") {
			return slicer.slice(
				0,
				(file as unknown as { size?: number }).size,
				contentType,
			);
		}
		return file;
	}

	// ArrayBuffer / Uint8Array
	if (file instanceof ArrayBuffer)
		return new Blob([file], { type: contentType });
	if (file instanceof Uint8Array)
		return new Blob([file], { type: contentType });

	// ReadableStream<Uint8Array>
	if (typeof ReadableStream !== "undefined" && file instanceof ReadableStream) {
		// Most runtimes (Node 18+/Bun/modern browsers) can convert stream -> Blob via Response.
		if (typeof Response === "undefined") {
			throw new MappaError(
				"ReadableStream upload requires Response to convert stream to Blob",
			);
		}

		const blob = await new Response(file).blob();
		return blob.slice(0, blob.size, contentType);
	}

	throw new MappaError("Unsupported file type for upload()");
}
