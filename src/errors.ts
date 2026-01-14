/**
 * Base error type for all SDK-raised errors.
 *
 * When available, {@link MappaError.requestId} can be used to correlate a failure
 * with server logs/support.
 */
export class MappaError extends Error {
	override name = "MappaError";
	requestId?: string;
	code?: string;

	constructor(
		message: string,
		opts?: { requestId?: string; code?: string; cause?: unknown },
	) {
		super(message);
		this.requestId = opts?.requestId;
		this.code = opts?.code;
		this.cause = opts?.cause;
	}
}

/**
 * Error returned when the API responds with a non-2xx status.
 */
export class ApiError extends MappaError {
	override name = "ApiError";
	status: number;
	details?: unknown;

	constructor(
		message: string,
		opts: {
			status: number;
			requestId?: string;
			code?: string;
			details?: unknown;
		},
	) {
		super(message, { requestId: opts.requestId, code: opts.code });
		this.status = opts.status;
		this.details = opts.details;
	}
}

/**
 * Error returned for HTTP 429 responses.
 *
 * If provided by the server, {@link RateLimitError.retryAfterMs} indicates when
 * it is safe to retry.
 */
export class RateLimitError extends ApiError {
	override name = "RateLimitError";
	retryAfterMs?: number;
}

/**
 * Error returned for authentication/authorization failures (typically 401/403).
 */
export class AuthError extends ApiError {
	override name = "AuthError";
}

/**
 * Error returned when the server rejects a request as invalid (typically 422).
 */
export class ValidationError extends ApiError {
	override name = "ValidationError";
}

/**
 * Error thrown by polling helpers when a job reaches the "failed" terminal state.
 */
export class JobFailedError extends MappaError {
	override name = "JobFailedError";
	jobId: string;

	constructor(
		jobId: string,
		message: string,
		opts?: { requestId?: string; code?: string; cause?: unknown },
	) {
		super(message, opts);
		this.jobId = jobId;
	}
}

/**
 * Error thrown by polling helpers when a job reaches the "canceled" terminal state.
 */
export class JobCanceledError extends MappaError {
	override name = "JobCanceledError";
	jobId: string;

	constructor(
		jobId: string,
		message: string,
		opts?: { requestId?: string; cause?: unknown },
	) {
		super(message, opts);
		this.jobId = jobId;
	}
}
