// src/types.ts

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

export type ReportSectionSelection = {
	id: string;
	enabled?: boolean;
	order?: number;
	params?: Record<string, JsonValue>;
	titleOverride?: string;
};

export type ReportOutput =
	| { type: "markdown"; sections?: ReportSectionSelection[] }
	| { type: "sections"; sections?: ReportSectionSelection[] };

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
	media: MediaRef;
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

export type SectionsReport = ReportBase & {
	output: { type: "sections" };
	sections: Array<{
		id: string;
		title: string;
		content: JsonValue;
		data?: JsonValue;
	}>;
};

export type Report = MarkdownReport | SectionsReport;

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

export type WaitOptions = {
	timeoutMs?: number; // default: 5 min
	pollIntervalMs?: number; // default: 1000 (used as base)
	maxPollIntervalMs?: number; // default: 10000
	onEvent?: (event: JobEvent) => void;
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
