import { Presets } from "$/presets";
import { withRetry } from "$/utils/with-retry";
import { MappaModel } from "./model";

/**
 * Client for the Mappa API that provides access to presets and can generate a synchronous behavior profile report
 * from either an uploaded media file or a remote media URL.
 */
export class Mappa {
	private readonly apiKey: string;
	private readonly apiBaseUrl = "https://api.mappa.ai";
	private readonly apiVersion = "v1";
	readonly presets = new Presets();

	/**
	 * Initializes the client with an API key sourced from arguments or the environment.
	 */
	constructor(apiKey?: string) {
		if (
			!apiKey &&
			typeof process !== "undefined" &&
			process.env &&
			process.env.MAPPA_API_KEY?.trim() !== ""
		) {
			this.apiKey = process.env.MAPPA_API_KEY || "";
		}

		this.apiKey = apiKey || "";

		if (this.apiKey.trim() === "") {
			throw new Error("Mappa API key is required");
		}
	}

	/**
	 * Generates a synchronous behavior profile report from either an uploaded media file or a remote media URL.
	 */
	async generateTextReport(body: MappaModel.GenerateReportInput) {
		let response: Response;
		if (body.inputMedia.kind === "file") {
			const formData = new FormData();

			formData.append("file", body.inputMedia.file);
			formData.append(
				"metadata",
				JSON.stringify({
					mode: "sync",
					output: "behavior_profile",
					target: body.targetSpeaker,
				}),
			);

			response = await withRetry(() =>
				fetch(`${this.apiBaseUrl}/${this.apiVersion}/analyze/file`, {
					method: "POST",
					headers: {
						"Mappa-Api-Key": this.apiKey,
					},
					body: formData,
				}),
			);
		} else {
			const url = new URL(body.inputMedia.url);
			response = await withRetry(() =>
				fetch(`${this.apiBaseUrl}/${this.apiVersion}/analyze/url`, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"Mappa-Api-Key": this.apiKey,
					},
					body: JSON.stringify({
						url: url.href,
						mode: "sync",
						output: "behavior_profile",
						target: body.targetSpeaker,
					}),
				}),
			);
		}

		if (!response.ok) {
			const errorMessage = `Mappa API request failed with status ${response.status}: ${await response.text().catch(() => "Unable to retrieve error message")}`;
			console.error(errorMessage);
			throw new Error(errorMessage);
		}

		const rawResult = await response.json();
		const parsedResult = MappaModel.generateReportOutputSchema.parse(rawResult);

		const output = parsedResult.outputs;
		if (!output)
			throw new Error(
				"No outputs found in the response, error occurred during analysis.",
			);

		return {
			behaviorProfile: output.behavior_profile,
			entityId: output.entity_id,
		};
	}
}
