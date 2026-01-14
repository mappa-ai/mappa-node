// src/errors.ts

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

export class RateLimitError extends ApiError {
	override name = "RateLimitError";
	retryAfterMs?: number;
}

export class AuthError extends ApiError {
	override name = "AuthError";
}

export class ValidationError extends ApiError {
	override name = "ValidationError";
}

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
