/**
 * JSON-serializable value.
 *
 * Used throughout the SDK for message payloads, webhook data, and server-provided
 * metadata where the exact shape is not known at compile time.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| { [k: string]: JsonValue }
	| JsonValue[];

export type MediaRef =
	| { url: string; contentType?: string; filename?: string }
	| { mediaId: string };

/**
 * A reference to an already-uploaded media object.
 */
export type MediaIdRef = { mediaId: string };

export type ReportTemplateId =
	| "sales_playbook"
	| "general_report"
	| "hiring_report"
	| "profile_alignment";

export type ReportTemplateParamsMap = {
	sales_playbook: Record<string, never>;
	general_report: Record<string, never>;
	hiring_report: {
		roleTitle: string;
		roleDescription: string;
		companyCulture: string;
	};
	profile_alignment: {
		idealProfile: string;
	};
};

export type ReportOutputType = "markdown" | "json" | "pdf" | "url";

type ReportOutputEntry<
	OutputType extends ReportOutputType,
	Template extends ReportTemplateId,
> = ReportTemplateParamsMap[Template] extends Record<string, never>
	? {
			type: OutputType;
			template: Template;
			templateParams?: ReportTemplateParamsMap[Template];
		}
	: {
			type: OutputType;
			template: Template;
			templateParams: ReportTemplateParamsMap[Template];
		};

type ReportOutputForType<OutputType extends ReportOutputType> =
	| ReportOutputEntry<OutputType, "sales_playbook">
	| ReportOutputEntry<OutputType, "general_report">
	| ReportOutputEntry<OutputType, "hiring_report">
	| ReportOutputEntry<OutputType, "profile_alignment">;

export type ReportOutput =
	| ReportOutputForType<"markdown">
	| ReportOutputForType<"json">
	| ReportOutputForType<"pdf">
	| ReportOutputForType<"url">;

/**
 * Report output configuration constrained to a specific output type.
 * When T is a specific literal like "markdown", only markdown output configs are allowed.
 * When T is the full union (ReportOutputType), all output configs are allowed.
 *
 * @example
 * ```typescript
 * type MarkdownOutput = ReportOutputFor<"markdown">; // Only markdown configs
 * type AnyOutput = ReportOutputFor<ReportOutputType>; // All configs (same as ReportOutput)
 * ```
 */
export type ReportOutputFor<T extends ReportOutputType> = T extends "markdown"
	? ReportOutputForType<"markdown">
	: T extends "json"
		? ReportOutputForType<"json">
		: T extends "pdf"
			? ReportOutputForType<"pdf">
			: T extends "url"
				? ReportOutputForType<"url">
				: ReportOutput;

export type TargetStrategy =
	| "dominant"
	| "timerange"
	| "entity_id"
	| "magic_hint";

export type TargetOnMiss = "fallback_dominant" | "error";

export type TargetTimeRange = {
	/**
	 * Start time in seconds.
	 * When omitted, starts from the beginning.
	 */
	startSeconds?: number;
	/**
	 * End time in seconds.
	 * When omitted, goes until the end.
	 */
	endSeconds?: number;
};

type TargetBase = {
	/**
	 * Behavior when the entity is not found.
	 */
	onMiss?: TargetOnMiss;
	/**
	 * Tags to apply to the selected entity after job completion.
	 *
	 * Tags must be 1-64 characters, alphanumeric with underscores and hyphens only.
	 * Maximum 10 tags per request.
	 *
	 * @example ["interviewer", "sales-rep", "round-1"]
	 */
	tags?: string[];
	/**
	 * Exclude speakers whose entities have ANY of these tags from selection.
	 *
	 * Useful for filtering out known interviewers, hosts, etc.
	 *
	 * @example ["interviewer", "host"]
	 */
	excludeTags?: string[];
};

export type TargetDominant = TargetBase & {
	strategy: "dominant";
};

export type TargetTimeRangeStrategy = TargetBase & {
	strategy: "timerange";
	timeRange: TargetTimeRange;
};

export type TargetEntityId = TargetBase & {
	strategy: "entity_id";
	entityId: string;
};

export type TargetMagicHint = TargetBase & {
	strategy: "magic_hint";
	hint: string;
};

export type TargetSelector =
	| TargetDominant
	| TargetTimeRangeStrategy
	| TargetEntityId
	| TargetMagicHint;

export type TargetStrategyMap = {
	dominant: TargetDominant;
	timerange: TargetTimeRangeStrategy;
	entity_id: TargetEntityId;
	magic_hint: TargetMagicHint;
};

export type TargetFor<Strategy extends TargetStrategy> =
	TargetStrategyMap[Strategy];

export type Usage = {
	creditsUsed: number;
	creditsDiscounted?: number;
	creditsNetUsed: number;
	durationMs?: number;
	modelVersion?: string;
};

export type JobStage =
	| "uploaded"
	| "queued"
	| "transcoding"
	| "extracting"
	| "scoring"
	| "rendering"
	| "finalizing";

export type JobStatus =
	| "queued"
	| "running"
	| "succeeded"
	| "failed"
	| "canceled";

export type JobCreditReservation = {
	reservedCredits: number | null;
	reservationStatus: "active" | "released" | "applied" | null;
};

export type Job = {
	id: string;
	type: "report.generate";
	status: JobStatus;
	stage?: JobStage;
	progress?: number; // 0..1
	createdAt: string;
	updatedAt: string;
	reportId?: string;
	usage?: Usage;
	credits?: JobCreditReservation;
	releasedCredits?: number | null;
	error?: {
		code: string;
		message: string;
		details?: JsonValue;
		retryable?: boolean;
	};
	requestId?: string;
};

export type JobEvent =
	| { type: "status"; job: Job }
	| { type: "stage"; stage: JobStage; progress?: number; job: Job }
	| { type: "log"; message: string; ts: string }
	| { type: "terminal"; job: Job };

export type Subject = {
	id?: string;
	externalRef?: string;
	metadata?: Record<string, JsonValue>;
};

export type WebhookConfig = {
	url: string;
	headers?: Record<string, string>;
};

export type ReportCreateJobRequest<
	T extends ReportOutputType = ReportOutputType,
> = {
	subject?: Subject;
	/**
	 * Reference to already-uploaded media.
	 *
	 * Note: Report job creation requires a `mediaId`. To start from a remote URL or local bytes,
	 * use helper methods like `reports.createJobFromUrl()` / `reports.createJobFromFile()`.
	 */
	media: MediaIdRef;
	output: ReportOutputFor<T>;
	/**
	 * Select the target entity for analysis.
	 *
	 * @defaultValue `{ strategy: "dominant" }` - analyzes the dominant speaker
	 */
	target?: TargetSelector;
	options?: {
		language?: string;
		timezone?: string;
		includeMetrics?: boolean;
		includeRawModelOutput?: boolean;
	};
	/**
	 * Webhook to call when the job completes or fails.
	 *
	 * @example
	 * webhook: {
	 *   url: "https://example.com/webhooks/mappa",
	 *   headers: { "X-Custom-Header": "value" }
	 * }
	 */
	webhook?: WebhookConfig;
	idempotencyKey?: string;
	requestId?: string;
};

export type ReportBase = {
	id: string;
	createdAt: string;
	jobId?: string;
	subject?: Subject;
	media: { url?: string; mediaId?: string };
	entity: {
		id: string;
		tags: string[];
	};
	usage?: Usage;
	metrics?: Record<string, JsonValue>;
	raw?: JsonValue;
};

export type MarkdownReport = ReportBase & {
	output: { type: "markdown"; template: ReportTemplateId };
	markdown: string;
};

export type JsonReport = ReportBase & {
	output: { type: "json"; template: ReportTemplateId };
	sections: Array<{
		section_title: string;
		section_content: JsonValue;
	}>;
};

export type PdfReport = ReportBase & {
	output: { type: "pdf"; template: ReportTemplateId };
	markdown: string;
	pdfUrl: string;
};

export type UrlReport = ReportBase & {
	output: { type: "url"; template: ReportTemplateId };
	markdown: string;
	sections: Array<{
		section_title: string;
		section_content: JsonValue;
	}>;
	reportUrl: string;
};

export type Report = MarkdownReport | JsonReport | PdfReport | UrlReport;

/**
 * Maps an output type to its corresponding report type.
 * Used for type-safe inference in generate methods.
 *
 * @example
 * ```typescript
 * type R = ReportForOutputType<"markdown">; // MarkdownReport
 * type R = ReportForOutputType<"json">;     // JsonReport
 * type R = ReportForOutputType<ReportOutputType>; // Report (union)
 * ```
 */
export type ReportForOutputType<T extends ReportOutputType> =
	T extends "markdown"
		? MarkdownReport
		: T extends "json"
			? JsonReport
			: T extends "pdf"
				? PdfReport
				: T extends "url"
					? UrlReport
					: Report;

export type ReportJobReceipt<T extends ReportOutputType = ReportOutputType> = {
	jobId: string;
	status: "queued" | "running";
	stage?: JobStage;
	estimatedWaitSec?: number;
	requestId?: string;
	handle?: ReportRunHandle<T>;
};

export type FeedbackReceipt = {
	id: string;
	createdAt: string;
	target: { reportId?: string; jobId?: string };
	rating: "thumbs_up" | "thumbs_down" | "1" | "2" | "3" | "4" | "5";
	tags?: string[];
	comment?: string;
	credits: {
		eligible: boolean;
		reason?: string;
		discountApplied: number;
		netUsed: number;
	};
};

export type MediaObject = {
	mediaId: string;
	createdAt: string;
	contentType: string;
	filename?: string;
	sizeBytes?: number;
};

export type MediaProcessingStatus =
	| "PENDING"
	| "PROCESSING"
	| "COMPLETED"
	| "FAILED";

export type MediaRetention = {
	expiresAt: string | null;
	daysRemaining: number | null;
	locked: boolean;
};

export type MediaFile = {
	mediaId: string;
	createdAt: string;
	contentType: string;
	filename: string | null;
	sizeBytes: number | null;
	durationSeconds: number | null;
	processingStatus: MediaProcessingStatus;
	lastUsedAt: string | null;
	retention: MediaRetention;
};

export type FileDeleteReceipt = {
	mediaId: string;
	deleted: true;
};

export type RetentionLockResult = {
	mediaId: string;
	retentionLock: boolean;
	message: string;
};

export type CursorPaginationParams = {
	limit?: number;
	cursor?: string;
};

export type OffsetPaginationParams = {
	limit?: number;
	offset?: number;
};

export type CursorPage<T> = {
	data: T[];
	cursor?: string;
	hasMore: boolean;
};

export type OffsetPage<T> = {
	data: T[];
	pagination: {
		limit: number;
		offset: number;
		total: number;
	};
};

export type CreditBalance = {
	balance: number;
	reserved: number;
	available: number;
};

export type CreditTransactionType =
	| "PURCHASE"
	| "SUBSCRIPTION_GRANT"
	| "PROMO_GRANT"
	| "USAGE"
	| "REFUND"
	| "FEEDBACK_DISCOUNT"
	| "ADJUSTMENT"
	| "EXPIRATION";

export type CreditTransaction = {
	id: string;
	type: CreditTransactionType;
	amount: number;
	createdAt: string;
	effectiveAt: string;
	expiresAt: string | null;
	jobId: string | null;
	job?: {
		id: string;
		status: string;
		createdAt: string;
	};
};

export type CreditUsage = {
	jobId: string;
	creditsUsed: number;
	creditsDiscounted?: number;
	creditsNetUsed: number;
	durationMs?: number;
	modelVersion?: string;
};

/**
 * Options for waiting on job completion.
 */
export type WaitOptions = {
	/**
	 * Maximum time to wait before failing.
	 *
	 * @defaultValue 300000
	 */
	timeoutMs?: number;

	/**
	 * Optional callback invoked on meaningful job state transitions.
	 */
	onEvent?: (event: JobEvent) => void;

	/**
	 * Abort signal used to cancel waiting.
	 */
	signal?: AbortSignal;
};

// Forward decl to avoid circular imports; implemented in reports resource.
export type ReportRunHandle<T extends ReportOutputType = ReportOutputType> = {
	jobId: string;
	stream(opts?: {
		signal?: AbortSignal;
		onEvent?: (e: JobEvent) => void;
	}): AsyncIterable<JobEvent>;
	wait(opts?: WaitOptions): Promise<ReportForOutputType<T>>;
	cancel(): Promise<Job>;
	job(): Promise<Job>;
	report(): Promise<ReportForOutputType<T> | null>;
};

/**
 * Type guard for MarkdownReport.
 */
export function isMarkdownReport(report: Report): report is MarkdownReport {
	return report.output.type === "markdown";
}

/**
 * Type guard for JsonReport.
 */
export function isJsonReport(report: Report): report is JsonReport {
	return report.output.type === "json";
}

/**
 * Type guard for PdfReport.
 */
export function isPdfReport(report: Report): report is PdfReport {
	return report.output.type === "pdf";
}

/**
 * Type guard for UrlReport.
 */
export function isUrlReport(report: Report): report is UrlReport {
	return report.output.type === "url";
}

export type Entity = {
	id: string;
	tags: string[];
	createdAt: string;
	mediaCount: number;
	lastSeenAt: string | null;
};

export type EntityTagsResult = {
	entityId: string;
	tags: string[];
};

export type ListEntitiesOptions = CursorPaginationParams & {
	/**
	 * Filter entities by tags.
	 * Entities must have ALL specified tags (AND logic).
	 */
	tags?: string[];
};

export type ListEntitiesResponse = {
	entities: Entity[];
	cursor?: string;
	hasMore: boolean;
};

/**
 * Type guard to check if a report has entity information.
 * Always returns true since entity is always present in reports.
 */
export function hasEntity(report: Report): report is Report & {
	entity: { id: string; tags: string[] };
} {
	return report.entity !== undefined && report.entity !== null;
}
