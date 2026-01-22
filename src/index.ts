/**
 * Mappa Node SDK
 *
 * This module is the public entrypoint for the package. It re-exports:
 * - {@link Mappa} (the main client)
 * - Error types from {@link "$/errors"}
 * - Public TypeScript types from {@link "$/types"}
 */
export * from "$/errors";
export { Mappa } from "$/Mappa";
export type {
	ReportCompletedData,
	ReportCompletedEvent,
	ReportFailedData,
	ReportFailedEvent,
	WebhookEvent,
	WebhookEventType,
} from "$/resources/webhooks";
export type * from "$/types";
export {
	hasEntity,
	isJsonReport,
	isMarkdownReport,
	isPdfReport,
	isUrlReport,
} from "$/types";

import { InsufficientCreditsError, MappaError, StreamError } from "$/errors";

/**
 * Type guard for catching SDK errors.
 */
export function isMappaError(err: unknown): err is MappaError {
	return err instanceof MappaError;
}

/**
 * Type guard for insufficient credits errors.
 *
 * @example
 * ```typescript
 * try {
 *   await mappa.reports.createJob({ ... });
 * } catch (err) {
 *   if (isInsufficientCreditsError(err)) {
 *     console.log(`Need ${err.required} credits, have ${err.available}`);
 *   }
 * }
 * ```
 */
export function isInsufficientCreditsError(
	err: unknown,
): err is InsufficientCreditsError {
	return err instanceof InsufficientCreditsError;
}

/**
 * Type guard for stream connection errors.
 *
 * Use this to detect streaming failures and access recovery metadata
 * like `jobId`, `lastEventId`, and `retryCount`.
 *
 * @example
 * ```typescript
 * try {
 *   await mappa.reports.generate({ ... });
 * } catch (err) {
 *   if (isStreamError(err)) {
 *     console.log(`Stream failed for job ${err.jobId}`);
 *     console.log(`Last event ID: ${err.lastEventId}`);
 *     console.log(`Retries attempted: ${err.retryCount}`);
 *   }
 * }
 * ```
 */
export function isStreamError(err: unknown): err is StreamError {
	return err instanceof StreamError;
}
