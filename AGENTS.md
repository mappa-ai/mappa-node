# AGENTS.md

## Purpose
- Provide build/test/lint commands for agents.
- Summarize repo conventions and coding style.
- Apply to entire repo unless overridden.

## Stack
- TypeScript (ESM, Node 18+).
- Bun for tests.
- Biome for formatting/lint.
- tsdown for builds.

## Quick Commands
- Install deps: `bun install` or `npm install` (Bun preferred).
- Build: `bun run build` (runs `tsdown`).
- Typecheck: `bun run typecheck`.
- Lint/format check: `bun run check` (Biome).
- Auto-fix: `bun run check:fix`.
- Full local gate: `bun run lazycheck`.

## Tests
- Run all tests: `bun run test`.
- Run a single file: `bun test tests/integration.test.ts`.
- Run a single test case: `bun test tests/integration.test.ts --test-name "health.ping"` (Bun filter).
- Test runtime: `bun test` uses `bun:test` APIs.

## Repo Layout
- `src/` library source (ESM).
- `src/resources/` API resource clients.
- `src/utils/` shared helpers.
- `tests/` Bun integration tests and test server.
- `tsdown.config.ts` build config.
- `tsconfig.json` strict TS settings; path alias `$/*` -> `src/*`.

## Import Conventions
- Use ESM import syntax only.
- Prefer `import type` for type-only imports.
- Keep type imports with other imports (no separate block required).
- Use path alias `$/*` for intra-src imports (see `tsconfig.json`).
- Use relative imports in tests (`../src/...`).
- Avoid unused imports (TS `noUnusedLocals` on).

## Formatting
- Use Biome defaults (tabs for indentation).
- Double quotes for strings.
- Trailing commas in multiline objects/arrays.
- Semicolons are used.
- Keep lines reasonably short; wrap long argument lists.
- Keep blank lines between logical sections.

## Types and APIs
- Prefer `type` aliases for shapes and unions.
- Use explicit return types for exported functions.
- Use `satisfies` for config objects (`tsdown.config.ts`).
- Prefer `Record<string, ...>` for dictionaries.
- Avoid `any`; use `unknown` and narrow.
- Use `Required<Pick<...>>` and `Omit<...>` for option composition.

## Naming
- Classes and types use `PascalCase`.
- Functions, variables, and methods use `camelCase`.
- Constants use `camelCase` unless module-level static config.
- Boolean helpers use `is/has/should` prefix.
- Resource classes are `XResource` and exposed via `Mappa`.

## Error Handling
- Throw SDK-specific errors from `src/errors.ts`.
- Include `requestId` when available.
- Use `MappaError` for client-side validation.
- Map HTTP errors via `Transport` (`ApiError`, `AuthError`, etc.).
- Preserve original causes with `cause` when relevant.
- Avoid swallowing errors; rethrow after logging in tests.

## HTTP/Transport Patterns
- Build URLs with `buildUrl` and pass `query` objects.
- Add `Idempotency-Key` for idempotent requests.
- Use `retryable` flag to allow retries.
- Respect `Retry-After` on 429.
- Use `AbortController` for timeouts and caller cancellation.

## Resource Patterns
- Resource methods accept typed request objects.
- Return typed responses; avoid `any`.
- Keep resources focused on a single endpoint family.
- Use helper methods to share polling/streaming logic.

## Testing Style
- Use `bun:test` (`describe`, `test`, `expect`).
- Prefer integration tests with `TestApiServer`.
- Keep tests deterministic and fast (short timeouts).
- Use `beforeAll/afterAll` to manage server lifecycle.
- Use `beforeEach` to reset server state.
- Assert request headers and paths.

## Documentation Style
- Public API surfaces use JSDoc blocks.
- Keep JSDoc succinct with `@defaultValue` when relevant.
- Prefer docstrings on exported classes and functions.

## Misc Conventions
- Use `const` by default; `let` only when reassigned.
- Avoid one-letter variable names.
- Use `readonly` on class fields.
- Avoid side-effectful imports.
- Keep helper functions near usage.
- Do not add new dependencies without discussion.

## Adding New Tests
- Put new tests in `tests/` with `.test.ts` suffix.
- Use the existing `TestApiServer` for HTTP behaviors.
- Ensure new tests pass with `bun test`.

## Build Output
- Build emits to `dist/` via `tsdown`.
- Do not edit `dist/` directly.

## Lint/Format Workflow
- Run `bun run check` before committing.
- If formatting changes are needed, run `bun run check:fix`.
- Keep formatting changes minimal and localized.

## Agent Notes
- No Cursor/Copilot rules found in repo.
- If new AGENTS.md files appear in subdirs, follow them.
- Update this file if tooling changes.

## Common Tasks
- Add new API resource: `src/resources/<name>.ts` + export in `src/Mappa.ts`.
- Export public types from `src/types.ts` and re-export in `src/index.ts`.
- Add error classes to `src/errors.ts` and re-export in `src/index.ts`.

## Example Single-Test Run
- `bun test tests/integration.test.ts --test-name "maps 401 to AuthError"`

## Versioning
- Package is ESM (`"type": "module"`).
- Builds produce both ESM/CJS via `tsdown`.

## Release Checklist (local)
- `bun run check`
- `bun run typecheck`
- `bun run test`
- `bun run build`

## Donts
- Do not commit `dist/` changes.
- Do not bypass validation for API keys.
- Do not silently ignore `ApiError` details.
- Do not introduce Node-only APIs without guard.
