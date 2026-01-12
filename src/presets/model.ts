import { z } from "zod";

export namespace PresetsModel {
	export const availablePresetsSchema = z.enum(["base"]);
	export type AvailablePresets = z.infer<typeof availablePresetsSchema>;
}
