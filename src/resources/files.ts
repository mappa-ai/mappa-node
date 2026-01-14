import type { Transport } from "$/resources/transport";
import type { MediaObject } from "$/types";

export type UploadRequest = {
	file: Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;
	contentType: string;
	filename?: string;
	idempotencyKey?: string;
	requestId?: string;
	signal?: AbortSignal;
};

/**
 * Best-in-class note: This is a JSON-only placeholder.
 * In production you likely want multipart/form-data or resumable multipart uploads.
 */
export class FilesResource {
	constructor(private readonly transport: Transport) {}

	async upload(req: UploadRequest): Promise<MediaObject> {
		// TODO: implement multipart/form-data or resumable protocol.
		// Placeholder: expects server accepts base64 payload.
		const bytesBase64 = await toBase64(req.file);

		const res = await this.transport.request<MediaObject>({
			method: "POST",
			path: "/v1/files",
			body: {
				bytesBase64,
				contentType: req.contentType,
				filename: req.filename,
			},
			idempotencyKey: req.idempotencyKey,
			requestId: req.requestId,
			signal: req.signal,
			retryable: true,
		});

		return res.data;
	}
}

async function toBase64(file: UploadRequest["file"]): Promise<string> {
	// Blob (browser) path
	if (typeof Blob !== "undefined" && file instanceof Blob) {
		const buf = await file.arrayBuffer();
		return base64FromBytes(new Uint8Array(buf));
	}

	// ArrayBuffer
	if (file instanceof ArrayBuffer) return base64FromBytes(new Uint8Array(file));

	// Uint8Array
	if (file instanceof Uint8Array) return base64FromBytes(file);

	// ReadableStream<Uint8Array>
	if (typeof ReadableStream !== "undefined" && file instanceof ReadableStream) {
		const reader = file.getReader();
		const chunks: Uint8Array[] = [];
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) chunks.push(value);
		}
		const total = chunks.reduce((s, c) => s + c.byteLength, 0);
		const merged = new Uint8Array(total);
		let off = 0;
		for (const c of chunks) {
			merged.set(c, off);
			off += c.byteLength;
		}
		return base64FromBytes(merged);
	}

	throw new Error("Unsupported file type for upload()");
}

function base64FromBytes(bytes: Uint8Array): string {
	// Browser-safe base64
	let binary = "";
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
	}
	return btoa(binary);
}
