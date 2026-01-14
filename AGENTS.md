# AGENTS.md — mappa-node SDK

This file is the single source of truth for how contributors and automated agents should work in this repository.

## Mission

Build the best-in-class Node/TypeScript SDK for the Mappa Behavioral Engine API.

Success criteria:

- **Excellent DX**: one-liner happy paths, strong types, clear errors.
- **Stability**: minimal breaking changes, predictable behavior.
- **Correctness**: consistent request/response shapes, robust retries, safe defaults.
- **Observability**: request IDs, idempotency keys, and telemetry hooks.

## Repository overview

- `src/Mappa.ts` — main client class; wires resources and transport.
- `src/resources/transport.ts` — HTTP transport, retries, telemetry, idempotency.
- `src/resources/files.ts` — file uploads (`multipart/form-data`).
- `src/resources/reports.ts` — report APIs + best-in-class helpers (`createJobFromFile`, `generateFromFile`).
- `src/resources/jobs.ts` — job lifecycle (stream/wait/cancel).
- `src/types.ts` — public SDK request/response types.
- `src/errors.ts` — typed error hierarchy.

## Public API design principles

### 1) Keep the core API model clean

- Prefer expressing API contracts with explicit request types.
- Avoid overloading the same method to use multiple transports (e.g. JSON vs multipart) if it bloats the public surface.

Example:

- `reports.createJob({ media: { mediaId } | { url }, ... })` stays clean.
- Provide helpers like `reports.createJobFromFile()` to orchestrate upload + createJob.

### 2) Best-in-class upload DX

- `files.upload({ file, filename?, contentType? })`
- `contentType` is optional; infer from `Blob.type` first, then from `filename` when possible.
- Always send a **multipart file part** with an intrinsic per-part content type.

### 3) Errors must be actionable

- Throw typed error classes from `src/errors.ts`.
- Include `requestId` (from `x-request-id`) in error payloads.
- Validation errors should make it obvious which field is wrong.

### 4) Idempotency and retries

- Transport supports `idempotencyKey` and `retryable` requests.
- Don’t retry non-idempotent requests unless the endpoint/server contract is explicitly idempotent.
- File uploads are currently marked retryable; be mindful of one-shot streams.

## Code style & conventions

- TypeScript, ESM (`"type": "module"`).
- Formatting/linting: **Biome**.
- Prefer small, composable resource classes under `src/resources/*`.
- Keep comments in English.
- Runtime validation is acceptable where types are part of the public surface and user input can be untyped.

## Commands

- Lint/format check:
  - `bun run check`
- Auto-fix lint/format:
  - `bun run check:fix`
- Typecheck:
  - `bun run typecheck`
- Build:
  - `bun run build`
- Tests:
  - `bun test` (may report “No tests found” if none exist)

## Implementation notes (important)

### Transport and multipart

- `Transport.request()` must not force `Content-Type: application/json` when the body is `FormData`.
- Let the runtime’s `fetch` set the correct multipart boundary.

### Cross-runtime support

This SDK targets modern runtimes (Node 18+/Bun/modern browsers).

- If `FormData` is not available, `files.upload()` should throw a clear error.
- For `ReadableStream` inputs, conversion to `Blob` uses `new Response(stream).blob()`.

## Release checklist

- `bun run check`
- `bun run typecheck`
- `bun run build`
- Update `README.md` examples if public behavior changes.
- Ensure any breaking change is documented and versioned appropriately.

## PR checklist

- Public API additions have types exported (or are reachable via `Mappa`).
- Documentation updated for new DX helpers.
- New behavior has at least one usage example (README or minimal test).
- No accidental breaking changes (types and runtime behavior).

