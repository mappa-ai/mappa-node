import { FeedbackResource } from "$/resources/feedback";
import { FilesResource } from "$/resources/files";
import { HealthResource } from "$/resources/health";
import { JobsResource } from "$/resources/jobs";
import { ReportsResource } from "$/resources/reports";
import { type Telemetry, Transport } from "$/resources/transport";
import { WebhooksResource } from "$/resources/webhooks";

/**
 * Options for constructing a {@link Mappa} client.
 */
export type MappaClientOptions = {
	/**
	 * API key used for authenticating requests.
	 */
	apiKey: string;

	/**
	 * Base URL for the Mappa API.
	 *
	 * @defaultValue "https://api.mappa.ai"
	 */
	baseUrl?: string;

	/**
	 * Per-request timeout, in milliseconds.
	 *
	 * Note: this timeout applies to individual HTTP attempts (including retries).
	 * Long-running workflows should use {@link JobsResource.wait} through
	 * {@link ReportsResource.makeHandle} instead.
	 *
	 * @defaultValue 30000
	 */
	timeoutMs?: number;

	/**
	 * Maximum number of retries performed by the transport for retryable requests.
	 *
	 * @defaultValue 2
	 */
	maxRetries?: number;

	/**
	 * Headers that will be sent with every request.
	 */
	defaultHeaders?: Record<string, string>;

	/**
	 * Custom fetch implementation (useful for polyfills, instrumentation, or tests).
	 */
	fetch?: typeof fetch;

	/**
	 * Overrides the User-Agent header.
	 */
	userAgent?: string;

	/**
	 * Telemetry hooks called on request/response/error.
	 */
	telemetry?: Telemetry;
};

/**
 * Main SDK client.
 *
 * Exposes resource namespaces ({@link Mappa.files}, {@link Mappa.reports}, etc.)
 * and configures a shared HTTP transport.
 */
export class Mappa {
	public readonly files: FilesResource;
	public readonly jobs: JobsResource;
	public readonly reports: ReportsResource;
	public readonly feedback: FeedbackResource;
	public readonly webhooks: WebhooksResource;
	public readonly health: HealthResource;

	private readonly transport: Transport;
	private readonly opts: Required<
		Pick<MappaClientOptions, "apiKey" | "baseUrl" | "timeoutMs" | "maxRetries">
	> &
		Omit<MappaClientOptions, "apiKey" | "baseUrl" | "timeoutMs" | "maxRetries">;

	constructor(options: MappaClientOptions) {
		if (!options.apiKey) throw new Error("apiKey is required");

		const baseUrl = options.baseUrl ?? "https://api.mappa.ai";
		const timeoutMs = options.timeoutMs ?? 30_000;
		const maxRetries = options.maxRetries ?? 2;

		this.opts = {
			...options,
			apiKey: options.apiKey,
			baseUrl,
			timeoutMs,
			maxRetries,
		};

		this.transport = new Transport({
			apiKey: options.apiKey,
			baseUrl,
			timeoutMs,
			maxRetries,
			defaultHeaders: options.defaultHeaders,
			fetch: options.fetch,
			telemetry: options.telemetry,
			userAgent: options.userAgent,
		});

		this.files = new FilesResource(this.transport);
		this.jobs = new JobsResource(this.transport);
		this.reports = new ReportsResource(this.transport, this.jobs);
		this.feedback = new FeedbackResource(this.transport);
		this.webhooks = new WebhooksResource();
		this.health = new HealthResource(this.transport);
	}

	withOptions(overrides: Partial<MappaClientOptions>): Mappa {
		return new Mappa({
			...this.opts,
			...overrides,
			apiKey: overrides.apiKey ?? this.opts.apiKey,
		});
	}

	close(): void {
		// If you later add keep-alive agents or SSE connections, close them here.
	}
}
