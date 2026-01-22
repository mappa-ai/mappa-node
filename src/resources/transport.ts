import {
	ApiError,
	AuthError,
	InsufficientCreditsError,
	MappaError,
	RateLimitError,
	ValidationError,
} from "$/errors";
import {
	backoffMs,
	getHeader,
	hasAbortSignal,
	jitter,
	makeAbortError,
	randomId,
} from "$/utils";

/**
 * Options for SSE streaming.
 */
export type SSEStreamOptions = {
	signal?: AbortSignal;
	lastEventId?: string;
};

/**
 * A parsed SSE event.
 */
export type SSEEvent<T = unknown> = {
	id?: string;
	event: string;
	data: T;
};

export type Telemetry = {
	onRequest?: (ctx: {
		method: string;
		url: string;
		requestId?: string;
	}) => void;
	onResponse?: (ctx: {
		status: number;
		url: string;
		requestId?: string;
		durationMs: number;
	}) => void;
	onError?: (ctx: { url: string; requestId?: string; error: unknown }) => void;
};

export type TransportOptions = {
	apiKey: string;
	baseUrl: string;
	timeoutMs: number;
	maxRetries: number;
	defaultHeaders?: Record<string, string>;
	fetch?: typeof fetch;
	telemetry?: Telemetry;
	userAgent?: string;
};

export type RequestOptions = {
	method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
	path: string;
	query?: Record<string, string | number | boolean | undefined>;
	headers?: Record<string, string | undefined>;
	body?: unknown;
	idempotencyKey?: string;
	requestId?: string;
	signal?: AbortSignal;
	// treat as safe to retry (typically true for GET and for idempotent POSTs)
	retryable?: boolean;
};

export type TransportResponse<T> = {
	data: T;
	status: number;
	requestId?: string;
	headers: Headers;
};

function buildUrl(
	baseUrl: string,
	path: string,
	query?: RequestOptions["query"],
): string {
	const u = new URL(
		path.replace(/^\//, ""),
		baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
	);
	if (query) {
		for (const [k, v] of Object.entries(query)) {
			if (v === undefined) continue;
			u.searchParams.set(k, String(v));
		}
	}
	return u.toString();
}

async function readBody(
	res: Response,
): Promise<{ parsed: unknown; text: string }> {
	const text = await res.text();
	if (!text) return { parsed: null, text: "" };
	try {
		return { parsed: JSON.parse(text), text };
	} catch {
		return { parsed: text, text };
	}
}

function coerceApiError(res: Response, parsed: unknown): ApiError {
	const requestId = res.headers.get("x-request-id") ?? undefined;

	// Expecting an error envelope like:
	// { error: { code, message, details } } OR { code, message, details }
	let code: string | undefined;
	let message = `Request failed with status ${res.status}`;
	let details: unknown = parsed;

	if (typeof parsed === "string") {
		message = parsed;
	} else if (parsed && typeof parsed === "object") {
		const p = parsed as Record<string, unknown>;
		const err = (p.error ?? p) as unknown;
		if (err && typeof err === "object") {
			const e = err as Record<string, unknown>;
			if (typeof e.message === "string") message = e.message;
			if (typeof e.code === "string") code = e.code;
			if ("details" in e) details = e.details;
		}
	}

	if (res.status === 401 || res.status === 403)
		return new AuthError(message, {
			status: res.status,
			requestId,
			code,
			details,
		});
	if (res.status === 422)
		return new ValidationError(message, {
			status: res.status,
			requestId,
			code,
			details,
		});

	if (res.status === 402 && code === "insufficient_credits") {
		return new InsufficientCreditsError(message, {
			status: res.status,
			requestId,
			code,
			details: details as { required?: number; available?: number },
		});
	}

	if (res.status === 429) {
		const e = new RateLimitError(message, {
			status: res.status,
			requestId,
			code,
			details,
		});
		const ra = res.headers.get("retry-after");
		if (ra) {
			const sec = Number(ra);
			if (Number.isFinite(sec) && sec >= 0) e.retryAfterMs = sec * 1000;
		}
		return e;
	}

	return new ApiError(message, {
		status: res.status,
		requestId,
		code,
		details,
	});
}

function shouldRetry(
	opts: RequestOptions,
	err: unknown,
): { retry: boolean; retryAfterMs?: number } {
	if (!opts.retryable) return { retry: false };

	// Retry on RateLimitError / 5xx / network failures
	if (err instanceof RateLimitError)
		return { retry: true, retryAfterMs: err.retryAfterMs };
	if (err instanceof ApiError)
		return { retry: err.status >= 500 && err.status <= 599 };
	// fetch throws TypeError on network failure in many runtimes
	if (err instanceof TypeError) return { retry: true };
	return { retry: false };
}

export class Transport {
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly opts: TransportOptions) {
		this.fetchImpl = opts.fetch ?? fetch;
	}

	/**
	 * Stream SSE events from a given path.
	 *
	 * Uses native `fetch` with streaming response body (not browser-only `EventSource`).
	 * Parses SSE format manually from the `ReadableStream`.
	 */
	async *streamSSE<T>(
		path: string,
		opts?: SSEStreamOptions,
	): AsyncGenerator<SSEEvent<T>> {
		const url = buildUrl(this.opts.baseUrl, path);
		const requestId = randomId("req");

		const headers: Record<string, string> = {
			Accept: "text/event-stream",
			"Cache-Control": "no-cache",
			"Mappa-Api-Key": this.opts.apiKey,
			"X-Request-Id": requestId,
			...(this.opts.userAgent ? { "User-Agent": this.opts.userAgent } : {}),
			...(this.opts.defaultHeaders ?? {}),
		};

		if (opts?.lastEventId) {
			headers["Last-Event-ID"] = opts.lastEventId;
		}

		const controller = new AbortController();
		const timeout = setTimeout(
			() => controller.abort(makeAbortError()),
			this.opts.timeoutMs,
		);

		// Combine signals: if caller aborts, abort our controller
		if (hasAbortSignal(opts?.signal)) {
			const signal = opts?.signal;
			if (signal?.aborted) {
				clearTimeout(timeout);
				throw makeAbortError();
			}
			signal?.addEventListener(
				"abort",
				() => controller.abort(makeAbortError()),
				{ once: true },
			);
		}

		this.opts.telemetry?.onRequest?.({ method: "GET", url, requestId });

		let res: Response;
		try {
			res = await this.fetchImpl(url, {
				method: "GET",
				headers,
				signal: controller.signal,
			});
		} catch (err) {
			clearTimeout(timeout);
			this.opts.telemetry?.onError?.({ url, requestId, error: err });
			throw err;
		}

		if (!res.ok) {
			clearTimeout(timeout);
			const { parsed } = await readBody(res);
			const apiErr = coerceApiError(res, parsed);
			this.opts.telemetry?.onError?.({ url, requestId, error: apiErr });
			throw apiErr;
		}

		if (!res.body) {
			clearTimeout(timeout);
			throw new MappaError("SSE response has no body");
		}

		try {
			yield* this.parseSSEStream<T>(res.body);
		} finally {
			clearTimeout(timeout);
		}
	}

	/**
	 * Parse SSE events from a ReadableStream.
	 *
	 * SSE format:
	 * ```
	 * id: <id>
	 * event: <type>
	 * data: <json>
	 *
	 * ```
	 * Each event is terminated by an empty line.
	 */
	private async *parseSSEStream<T>(
		body: ReadableStream<Uint8Array>,
	): AsyncGenerator<SSEEvent<T>> {
		const decoder = new TextDecoder();
		const reader = body.getReader();
		let buffer = "";

		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete events (separated by double newline)
				const events = buffer.split("\n\n");
				// Keep the last incomplete chunk in buffer
				buffer = events.pop() ?? "";

				for (const eventText of events) {
					if (!eventText.trim()) continue;

					const event = this.parseSSEEvent<T>(eventText);
					if (event) {
						yield event;
					}
				}
			}

			// Process any remaining data in buffer
			if (buffer.trim()) {
				const event = this.parseSSEEvent<T>(buffer);
				if (event) {
					yield event;
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	/**
	 * Parse a single SSE event from text.
	 */
	private parseSSEEvent<T>(text: string): SSEEvent<T> | null {
		const lines = text.split("\n");
		let id: string | undefined;
		let event = "message"; // default event type per SSE spec
		let data = "";

		for (const line of lines) {
			if (line.startsWith("id:")) {
				id = line.slice(3).trim();
			} else if (line.startsWith("event:")) {
				event = line.slice(6).trim();
			} else if (line.startsWith("data:")) {
				// Append to data (SSE allows multiple data lines)
				if (data) data += "\n";
				data += line.slice(5).trim();
			}
			// Ignore retry: and comments (lines starting with :)
		}

		if (!data) return null;

		let parsedData: T;
		try {
			parsedData = JSON.parse(data) as T;
		} catch {
			// If data is not valid JSON, return it as-is (cast to T)
			parsedData = data as unknown as T;
		}

		return { id, event, data: parsedData };
	}

	async request<T>(req: RequestOptions): Promise<TransportResponse<T>> {
		const url = buildUrl(this.opts.baseUrl, req.path, req.query);

		const requestId = req.requestId ?? randomId("req");
		const headers: Record<string, string> = {
			"Mappa-Api-Key": this.opts.apiKey,
			"X-Request-Id": requestId,
			...(this.opts.userAgent ? { "User-Agent": this.opts.userAgent } : {}),
			...(this.opts.defaultHeaders ?? {}),
		};

		if (req.idempotencyKey) headers["Idempotency-Key"] = req.idempotencyKey;
		if (req.headers) {
			for (const [k, v] of Object.entries(req.headers)) {
				if (v !== undefined) headers[k] = v;
			}
		}

		const isFormData =
			typeof FormData !== "undefined" && req.body instanceof FormData;
		const hasBody = req.body !== undefined;

		if (hasBody && !isFormData) headers["Content-Type"] = "application/json";

		const body =
			req.body === undefined
				? undefined
				: isFormData
					? (req.body as FormData)
					: JSON.stringify(req.body);

		const maxRetries = Math.max(0, this.opts.maxRetries);
		const startedAt = Date.now();

		for (let attempt = 1; attempt <= 1 + maxRetries; attempt++) {
			const controller = new AbortController();
			const timeout = setTimeout(
				() => controller.abort(makeAbortError()),
				this.opts.timeoutMs,
			);

			// Combine signals: if caller aborts, abort our controller
			if (hasAbortSignal(req.signal)) {
				const signal = req.signal;
				if (!signal) {
					// Type guard safety: hasAbortSignal should imply this is defined.
					clearTimeout(timeout);
					throw new Error("Unexpected: abort signal missing");
				}
				if (signal.aborted) {
					clearTimeout(timeout);
					throw makeAbortError();
				}
				signal.addEventListener(
					"abort",
					() => controller.abort(makeAbortError()),
					{ once: true },
				);
			}

			this.opts.telemetry?.onRequest?.({ method: req.method, url, requestId });

			try {
				const res = await this.fetchImpl(url, {
					method: req.method,
					headers,
					body,
					signal: controller.signal,
				});

				const durationMs = Date.now() - startedAt;
				const serverRequestId =
					getHeader(res.headers, "x-request-id") ?? requestId;

				if (!res.ok) {
					const { parsed } = await readBody(res);
					const apiErr = coerceApiError(res, parsed);

					this.opts.telemetry?.onError?.({
						url,
						requestId: serverRequestId,
						error: apiErr,
					});

					const decision = shouldRetry(req, apiErr);
					if (
						attempt <= maxRetries + 1 &&
						decision.retry &&
						attempt <= maxRetries
					) {
						const base =
							decision.retryAfterMs ?? jitter(backoffMs(attempt, 500, 4000));
						await new Promise((r) => setTimeout(r, base));
						continue;
					}

					throw apiErr;
				}

				const ct = res.headers.get("content-type") ?? "";
				let data: unknown;
				if (ct.includes("application/json")) {
					data = (await res.json()) as unknown;
				} else {
					data = await res.text();
				}

				this.opts.telemetry?.onResponse?.({
					status: res.status,
					url,
					requestId: serverRequestId,
					durationMs,
				});
				return {
					data: data as T,
					status: res.status,
					requestId: serverRequestId,
					headers: res.headers,
				};
			} catch (err) {
				this.opts.telemetry?.onError?.({ url, requestId, error: err });

				const decision = shouldRetry(req, err);
				if (attempt <= maxRetries && decision.retry) {
					const sleep =
						decision.retryAfterMs ?? jitter(backoffMs(attempt, 500, 4000));
					await new Promise((r) => setTimeout(r, sleep));
					continue;
				}
				throw err;
			} finally {
				clearTimeout(timeout);
			}
		}

		// unreachable
		throw new Error("Unexpected transport exit");
	}
}
