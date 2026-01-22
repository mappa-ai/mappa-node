import type { UserConfig } from "tsdown";

export default {
	entry: "src/index.ts",
	dts: true,
	platform: "node",
	format: ["esm", "cjs"],
	minify: false,
	sourcemap: true,
} satisfies UserConfig;
