import type { Transport } from "$/resources/transport";

export class HealthResource {
	constructor(private readonly transport: Transport) {}

	async ping(): Promise<{ ok: true; time: string }> {
		const res = await this.transport.request<{ ok: true; time: string }>({
			method: "GET",
			path: "/v1/health/ping",
			retryable: true,
		});
		return res.data;
	}
}
