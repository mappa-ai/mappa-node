// src/resources/feedback.ts

import type { Transport } from "$/resources/transport";
import type { FeedbackReceipt } from "$/types";

export type FeedbackCreateRequest = {
	reportId?: string;
	jobId?: string;
	rating: "thumbs_up" | "thumbs_down" | "1" | "2" | "3" | "4" | "5";
	tags?: string[];
	comment?: string;
	corrections?: Array<{ path: string; expected?: unknown; observed?: unknown }>;
	idempotencyKey?: string;
	requestId?: string;
	signal?: AbortSignal;
};

export class FeedbackResource {
	constructor(private readonly transport: Transport) {}

	async create(req: FeedbackCreateRequest): Promise<FeedbackReceipt> {
		if (!!req.reportId === !!req.jobId)
			throw new Error("Provide exactly one of reportId or jobId");

		const res = await this.transport.request<FeedbackReceipt>({
			method: "POST",
			path: "/v1/feedback",
			body: req,
			idempotencyKey: req.idempotencyKey,
			requestId: req.requestId,
			signal: req.signal,
			retryable: true,
		});

		return res.data;
	}

	// Optional: policy() endpoint recommended for transparency.
	// async policy(): Promise<FeedbackPolicy> { ... }
}
