import { MappaError } from "$/errors";
import type { Transport } from "$/resources/transport";
import type { CreditBalance, CreditTransaction, CreditUsage } from "$/types";

export type ListTransactionsOptions = {
	/** Max transactions per page (1-100, default 50) */
	limit?: number;
	/** Offset for pagination (default 0) */
	offset?: number;
	requestId?: string;
	signal?: AbortSignal;
};

export type ListTransactionsResponse = {
	transactions: CreditTransaction[];
	pagination: {
		limit: number;
		offset: number;
		total: number;
	};
};

/**
 * Credits API resource.
 *
 * Provides methods to manage and query credit balances, transaction history,
 * and job-specific credit usage.
 */
export class CreditsResource {
	constructor(private readonly transport: Transport) {}

	/**
	 * Get the current credit balance for your team.
	 *
	 * @example
	 * const balance = await mappa.credits.getBalance();
	 * console.log(`Available: ${balance.available} credits`);
	 */
	async getBalance(opts?: {
		requestId?: string;
		signal?: AbortSignal;
	}): Promise<CreditBalance> {
		const res = await this.transport.request<CreditBalance>({
			method: "GET",
			path: "/v1/credits/balance",
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * List credit transactions with offset pagination.
	 *
	 * @example
	 * const { transactions, pagination } = await mappa.credits.listTransactions({ limit: 25 });
	 * console.log(`Showing ${transactions.length} of ${pagination.total}`);
	 */
	async listTransactions(
		opts?: ListTransactionsOptions,
	): Promise<ListTransactionsResponse> {
		const query: Record<string, string> = {};
		if (opts?.limit !== undefined) query.limit = String(opts.limit);
		if (opts?.offset !== undefined) query.offset = String(opts.offset);

		const res = await this.transport.request<ListTransactionsResponse>({
			method: "GET",
			path: "/v1/credits/transactions",
			query,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * Iterate over all transactions, automatically handling pagination.
	 *
	 * @example
	 * for await (const tx of mappa.credits.listAllTransactions()) {
	 *   console.log(`${tx.type}: ${tx.amount}`);
	 * }
	 */
	async *listAllTransactions(
		opts?: Omit<ListTransactionsOptions, "offset">,
	): AsyncIterable<CreditTransaction> {
		let offset = 0;
		const limit = opts?.limit ?? 50;

		while (true) {
			const page = await this.listTransactions({ ...opts, limit, offset });
			for (const tx of page.transactions) {
				yield tx;
			}

			offset += page.transactions.length;
			if (offset >= page.pagination.total) {
				break;
			}
		}
	}

	/**
	 * Get credit usage details for a completed job.
	 *
	 * @example
	 * const usage = await mappa.credits.getJobUsage("job_xyz");
	 * console.log(`Net credits used: ${usage.creditsNetUsed}`);
	 */
	async getJobUsage(
		jobId: string,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<CreditUsage> {
		if (!jobId) throw new MappaError("jobId is required");

		const res = await this.transport.request<CreditUsage>({
			method: "GET",
			path: `/v1/credits/usage/${encodeURIComponent(jobId)}`,
			requestId: opts?.requestId,
			signal: opts?.signal,
			retryable: true,
		});

		return res.data;
	}

	/**
	 * Check if the team has enough available credits for an operation.
	 *
	 * @example
	 * if (await mappa.credits.hasEnough(100)) {
	 *   await mappa.reports.createJob(...);
	 * }
	 */
	async hasEnough(
		credits: number,
		opts?: { requestId?: string; signal?: AbortSignal },
	): Promise<boolean> {
		const balance = await this.getBalance(opts);
		return balance.available >= credits;
	}

	/**
	 * Get the number of available credits (balance - reserved).
	 *
	 * @example
	 * const available = await mappa.credits.getAvailable();
	 * console.log(`You can spend ${available} credits`);
	 */
	async getAvailable(opts?: {
		requestId?: string;
		signal?: AbortSignal;
	}): Promise<number> {
		const balance = await this.getBalance(opts);
		return balance.available;
	}
}
