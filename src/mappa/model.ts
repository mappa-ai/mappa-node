import { z } from "zod";
import { PresetsModel } from "$/presets/model";

export namespace MappaModel {
	export const generateReportInputSchema = z.object({
		inputMedia: z.discriminatedUnion("kind", [
			z.object({
				kind: z.literal("file"),
				file: z
					.file()
					.mime(["video/*", "audio/*"], {
						message:
							"Invalid file type, only audio and video files are allowed",
					})
					.describe("The audio file to be processed"),
			}),
			z.object({
				kind: z.literal("url"),
				url: z
					.url()
					.describe("The URL of the audio or video file to be processed"),
			}),
		]),
		targetSpeaker: z
			.discriminatedUnion("strategy", [
				z.object({
					strategy: z
						.literal("dominant")
						.describe("Select the speaker who speaks the most in the audio"),
				}),
				z.object({
					strategy: z
						.literal("magic_hint")
						.describe("Use a hint to identify the target speaker"),
					hint: z
						.string()
						.describe(
							"A hint to help identify the target speaker, e.g., 'the interviewer', 'the CEO', 'the person being interviewed",
						),
				}),
			])
			.default({ strategy: "dominant" })
			.describe(
				"Strategy for target extraction, this is useful when there are multiple speakers in the audio",
			),
		template: PresetsModel.availablePresetsSchema,
	});
	export type GenerateReportInput = z.infer<typeof generateReportInputSchema>;

	export const generateReportOutputSchema = z.object({
		outputs: z
			.object({
				entity_id: z
					.string()
					.describe("The unique identifier for the analyzed entity"),
				behavior_profile: z
					.string()
					.describe("The generated behavior profile report"),
			})
			.array()
			.transform((o) => o[0] ?? null),
	});
	export type GenerateReportOutput = z.infer<typeof generateReportOutputSchema>;
}
