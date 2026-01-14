/**
 * Mappa Node SDK
 *
 * This module is the public entrypoint for the package. It re-exports:
 * - {@link Mappa} (the main client)
 * - Error types from {@link "$/errors"}
 * - Public TypeScript types from {@link "$/types"}
 */
export * from "$/errors";
export { Mappa } from "$/Mappa";
export type * from "$/types";
