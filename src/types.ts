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

export type ReportOutputType = "markdown" | "json";

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
	| ReportOutputForType<"json">;

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

export type ReportCreateJobRequest = {
	subject?: Subject;
	/**
	 * Reference to already-uploaded media.
	 *
	 * Note: Report job creation requires a `mediaId`. To start from a remote URL or local bytes,
	 * use helper methods like `reports.createJobFromUrl()` / `reports.createJobFromFile()`.
	 */
	media: MediaIdRef;
	output: ReportOutput;
	options?: {
		language?: string;
		timezone?: string;
		includeMetrics?: boolean;
		includeRawModelOutput?: boolean;
	};
	idempotencyKey?: string;
	requestId?: string;
};

export type ReportBase = {
	id: string;
	createdAt: string;
	subject?: Subject;
	media: { url?: string; mediaId?: string };
	usage?: Usage;
	metrics?: Record<string, JsonValue>;
	raw?: JsonValue;
};

export type MarkdownReport = ReportBase & {
	output: { type: "markdown" };
	markdown: string;
};

export type JsonReport = ReportBase & {
	output: { type: "json" };
	sections: Array<{
		section_title: string;
		section_content: JsonValue;
	}>;
};

export type Report = MarkdownReport | JsonReport;

export type ReportJobReceipt = {
	jobId: string;
	status: "queued" | "running";
	stage?: JobStage;
	estimatedWaitSec?: number;
	requestId?: string;
	handle?: ReportRunHandle;
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

export type FileDeleteReceipt = {
	mediaId: string;
	deleted: true;
};

/**
 * Options for long-polling job completion.
 */
export type WaitOptions = {
	/**
	 * Maximum time to wait before failing.
	 *
	 * @defaultValue 300000
	 */
	timeoutMs?: number;

	/**
	 * Initial polling interval.
	 *
	 * @defaultValue 1000
	 */
	pollIntervalMs?: number;

	/**
	 * Maximum polling interval used with exponential backoff.
	 *
	 * @defaultValue 10000
	 */
	maxPollIntervalMs?: number;

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
export type ReportRunHandle = {
	jobId: string;
	stream(opts?: {
		signal?: AbortSignal;
		onEvent?: (e: JobEvent) => void;
	}): AsyncIterable<JobEvent>;
	wait(opts?: WaitOptions): Promise<Report>;
	cancel(): Promise<Job>;
	job(): Promise<Job>;
	report(): Promise<Report | null>;
};
