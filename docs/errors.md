# Errors & retries

Errors happen. Mappa gives you typed errors and a smooth retry story.

## Error types

The SDK throws:
- `ApiError` — non-2xx responses.
- `AuthError` — 401/403.
- `ValidationError` — 422.
- `RateLimitError` — 429 with `retryAfterMs`.
- `JobFailedError` / `JobCanceledError` — job helpers.
- `MappaError` — client-side validation or constraints.

## Friendly handling example

```ts
import {
  ApiError,
  AuthError,
  MappaError,
  RateLimitError,
  ValidationError,
} from "@mappa-ai/mappa-node";

try {
  await mappa.reports.generateFromUrl({
    url: "https://example.com/media.mp3",
    output: { type: "markdown", template: "general_report" },
  });

  // Example with required template params
  await mappa.reports.generateFromUrl({
    url: "https://example.com/interview.mp3",
    output: {
      type: "markdown",
      template: "hiring_report",
      templateParams: {
        roleTitle: "Customer Success Manager",
        roleDescription: "Own onboarding and renewal conversations.",
        companyCulture: "Curious, candid, customer-obsessed.",
      },
    },
  });
} catch (err) {
  if (err instanceof AuthError) {
    console.error("Auth error", err.requestId);
    throw err;
  }

  if (err instanceof RateLimitError) {
    console.error("Rate limited; retry after", err.retryAfterMs);
    throw err;
  }

  if (err instanceof ValidationError) {
    console.error("Invalid request", err.details);
    throw err;
  }

  if (err instanceof ApiError) {
    console.error("API error", err.status, err.code, err.requestId);
    throw err;
  }

  if (err instanceof MappaError) {
    console.error("Client error", err.message);
    throw err;
  }

  throw err;
}
```

## Retries in practice

Retries are enabled for safe requests by default. You can:
- Pass `idempotencyKey` to make POSTs retry-safe.
- Set `maxRetries: 0` to disable retries.

```ts
const mappaNoRetries = mappa.withOptions({ maxRetries: 0 });
```

If you want perfect control, build your own retry logic and set `maxRetries: 0`.