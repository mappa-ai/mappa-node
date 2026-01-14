// src/Mappa.ts

import { type Telemetry, Transport } from "$/resources/transport";
import { FeedbackResource } from "./resources/feedback";
import { FilesResource } from "./resources/files";
import { HealthResource } from "./resources/health";
import { JobsResource } from "./resources/jobs";
import { ReportsResource } from "./resources/reports";
import { WebhooksResource } from "./resources/webhooks";

export type MappaClientOptions = {
	apiKey: string;
	baseUrl?: string; // default: https://api.mappa.ai
	timeoutMs?: number; // default: 30_000 (upload/job creation). Waiting handled via jobs.wait
	maxRetries?: number; // default: 2
	defaultHeaders?: Record<string, string>;
	fetch?: typeof fetch;
	userAgent?: string;
	telemetry?: Telemetry;
};

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
