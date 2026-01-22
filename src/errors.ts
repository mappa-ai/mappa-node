/**
 * Symbol for custom Node.js inspect formatting.
 * Ensures errors display nicely in console.log, REPL, and debuggers.
 */
const customInspect = Symbol.for("nodejs.util.inspect.custom");

/**
 * Formats error details for display.
 */
function formatDetails(details: unknown, indent = "  "): string {
	if (details === undefined || details === null) return "";
	try {
		const json = JSON.stringify(details, null, 2);
		// Indent each line for nested display
		return json.split("\n").join(`\n${indent}`);
	} catch {
		return String(details);
	}
}

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

	override toString(): string {
		const lines = [`${this.name}: ${this.message}`];
		if (this.code) lines.push(`  Code: ${this.code}`);
		if (this.requestId) lines.push(`  Request ID: ${this.requestId}`);
		return lines.join("\n");
	}

	[customInspect](): string {
		return this.toString();
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

	override toString(): string {
		const lines = [`${this.name}: ${this.message}`];
		lines.push(`  Status: ${this.status}`);
		if (this.code) lines.push(`  Code: ${this.code}`);
		if (this.requestId) lines.push(`  Request ID: ${this.requestId}`);
		if (this.details !== undefined && this.details !== null) {
			lines.push(`  Details: ${formatDetails(this.details)}`);
		}
		return lines.join("\n");
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

	override toString(): string {
		const lines = [`${this.name}: ${this.message}`];
		lines.push(`  Status: ${this.status}`);
		if (this.retryAfterMs !== undefined) {
			lines.push(`  Retry After: ${this.retryAfterMs}ms`);
		}
		if (this.code) lines.push(`  Code: ${this.code}`);
		if (this.requestId) lines.push(`  Request ID: ${this.requestId}`);
		return lines.join("\n");
	}
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
 * Error returned when the account lacks sufficient credits (HTTP 402).
 *
 * Use {@link InsufficientCreditsError.required} and {@link InsufficientCreditsError.available}
 * to inform users how many credits are needed.
 *
 * @example
 * ```typescript
 * try {
 *   await mappa.reports.createJob({ ... });
 * } catch (err) {
 *   if (err instanceof InsufficientCreditsError) {
 *     console.log(`Need ${err.required} credits, have ${err.available}`);
 *   }
 * }
 * ```
 */
export class InsufficientCreditsError extends ApiError {
	override name = "InsufficientCreditsError";
	/** Credits required for the operation */
	required: number;
	/** Credits currently available */
	available: number;

	constructor(
		message: string,
		opts: {
			status: number;
			requestId?: string;
			code?: string;
			details?: { required?: number; available?: number };
		},
	) {
		super(message, opts);
		this.required = opts.details?.required ?? 0;
		this.available = opts.details?.available ?? 0;
	}

	override toString(): string {
		const lines = [`${this.name}: ${this.message}`];
		lines.push(`  Status: ${this.status}`);
		lines.push(`  Required: ${this.required} credits`);
		lines.push(`  Available: ${this.available} credits`);
		if (this.code) lines.push(`  Code: ${this.code}`);
		if (this.requestId) lines.push(`  Request ID: ${this.requestId}`);
		return lines.join("\n");
	}
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

	override toString(): string {
		const lines = [`${this.name}: ${this.message}`];
		lines.push(`  Job ID: ${this.jobId}`);
		if (this.code) lines.push(`  Code: ${this.code}`);
		if (this.requestId) lines.push(`  Request ID: ${this.requestId}`);
		return lines.join("\n");
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

	override toString(): string {
		const lines = [`${this.name}: ${this.message}`];
		lines.push(`  Job ID: ${this.jobId}`);
		if (this.requestId) lines.push(`  Request ID: ${this.requestId}`);
		return lines.join("\n");
	}
}
