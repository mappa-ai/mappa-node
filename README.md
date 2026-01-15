# Mappa Node SDK [WIP - DO NOT USE YET]

[![npm version](https://img.shields.io/npm/v/@mappa-ai/mappa-node.svg)](https://www.npmjs.com/package/@mappa-ai/mappa-node)
![license](https://img.shields.io/npm/l/@mappa-ai/mappa-node.svg)

Official JavaScript/TypeScript SDK for the **Mappa API**.

- Works in **Node.js 18+** (and modern runtimes with `fetch`, `crypto`, `AbortController`).
- **Typed** end-to-end (requests, replies, errors).
- Built-in **retries**, **idempotency**, and **job helpers** (polling + streaming).
- Simple **webhook signature verification**.

---

## Installation

```bash
npm install @mappa-ai/mappa-node
# or
yarn add @mappa-ai/mappa-node
# or
pnpm add @mappa-ai/mappa-node
# or
bun add @mappa-ai/mappa-node
```

---

## Quickstart

Create a report from a remote media URL and wait for completion:

```ts
import { Mappa } from "@mappa-ai/mappa-node";

const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
});

// One-liner for remote URLs: download -> upload -> create job -> wait -> fetch report
const report = await mappa.reports.generateFromUrl({
  url: "https://example.com/media.mp3",
  output: { type: "markdown" },
});

if (report.output.type === "markdown") {
  console.log(report.markdown);
}
```

---

## Authentication

Pass the API key when constructing the client:

```ts
import { Mappa } from "@mappa-ai/mappa-node";

const mappa = new Mappa({ apiKey: "YOUR_MAPPA_API_KEY" });
```

Recommended: load the key from environment variables:

```bash
export MAPPA_API_KEY="your-api-key"
```

```ts
const mappa = new Mappa({ apiKey: process.env.MAPPA_API_KEY! });
```

---

## Configuration

The client supports per-instance configuration:

```ts
import { Mappa } from "@mappa-ai/mappa-node";

const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
  baseUrl: "https://api.mappa.ai", // default
  timeoutMs: 30_000, // default; per HTTP attempt
  maxRetries: 2, // default
  defaultHeaders: {
    "X-My-App": "my-service",
  },
});
```

### Request tracing

The SDK sets `X-Request-Id` on every request. You can supply your own `requestId`
per call to correlate logs across your system and Mappa support.

### Idempotency

Most write APIs accept `idempotencyKey`. If you do not provide one, the SDK
generates a best-effort key per request. For long-running workflows, it is best
practice to supply a stable key per logical operation.

Example:

```ts
await mappa.reports.createJob({
  media: { mediaId: "media_..." },
  output: { type: "markdown" },
  idempotencyKey: "report:customer_123:2026-01-14",
  requestId: "req_customer_123",
});
```

### Retries

Retries are enabled for retryable requests (GETs and idempotent writes). Use
`maxRetries: 0` to disable retries globally, or pass your own `idempotencyKey`
to make POST retries safe.

Create a derived client with overrides:

```ts
const mappaNoRetries = mappa.withOptions({ maxRetries: 0 });
```

### Timeouts vs long-running jobs

`timeoutMs` is a **per-request** timeout (including each retry attempt).
For long-running work, create a job and use `jobs.wait(...)` or `reports.makeHandle(jobId)`.

### Cancelling waits

Use `AbortController` to cancel polling or streaming when your app shuts down
or the user navigates away.

```ts
const controller = new AbortController();

setTimeout(() => controller.abort(), 10_000);

const receipt = await mappa.reports.createJob({
  media: { mediaId: "media_..." },
  output: { type: "markdown" },
});

try {
  const report = await receipt.handle!.wait({
    signal: controller.signal,
  });
  console.log(report.id);
} catch (err) {
  if (err instanceof Error && err.name === "AbortError") {
    console.log("wait canceled");
  }
}
```

Streaming with cancellation:

```ts
const controller = new AbortController();

const handle = mappa.reports.makeHandle("job_...");

setTimeout(() => controller.abort(), 5_000);

for await (const event of handle.stream({ signal: controller.signal })) {
  if (event.type === "terminal") break;
}
```

---

## Core concepts

### Reports are asynchronous

In the underlying architecture we do a series of transformations and
ML inference, which can take time.
To accommodate this, creating a report returns a **job receipt**. You can:

- **Wait** (poll) until completion.
- **Stream** job events.
- **Use webhooks** so your server is notified when work is done.

### Media input

Report job creation accepts **already-uploaded** media references:

- `{ mediaId: string }`

If you want a one-liner starting from something else:

- Remote URLs: `reports.createJobFromUrl()` / `reports.generateFromUrl()` (download client-side → upload → create job)
- Local bytes: `reports.createJobFromFile()` / `reports.generateFromFile()` (upload → create job)

---

## Creating reports

### 1) Create a job (recommended for production)

If you already have an uploaded `mediaId`, use `createJob()`:

```ts
const receipt = await mappa.reports.createJob({
  media: { mediaId: "media_..." },
  output: { type: "markdown" },
  subject: {
    externalRef: "customer_123",
    metadata: { plan: "pro" },
  },
  options: {
    language: "en",
    timezone: "UTC",
  },
  // Optional: provide your own idempotency key for safe retries.
  idempotencyKey: "report:customer_123:2026-01-14",
});

console.log(receipt.jobId);
```

If you’re starting from a remote URL, use `createJobFromUrl()`:

```ts
const receiptFromUrl = await mappa.reports.createJobFromUrl({
  url: "https://example.com/media.mp3",
  output: { type: "markdown" },
  subject: {
    externalRef: "customer_123",
    metadata: { plan: "pro" },
  },
  options: {
    language: "en",
    timezone: "UTC",
  },
  idempotencyKey: "report:customer_123:2026-01-14",
});

console.log(receiptFromUrl.jobId);
```

### 2) Wait for completion (polling)

```ts
const report = await receipt.handle!.wait({
  timeoutMs: 10 * 60_000,
  onEvent: (e) => {
    if (e.type === "stage") {
      console.log("stage", e.stage, e.progress);
    }
  },
});
```

### 3) Stream job events

`jobs.stream(jobId)` yields state transitions.

```ts
if (report.output.type === "sections") {
  for (const section of report.sections) {
    console.log(section.id, section.title);
  }
}
```

Type narrowing helpers:

```ts
if (report.output.type === "markdown") {
  console.log(report.markdown);
}
```

---

## Feedback

Use `mappa.feedback.create()` to share ratings or corrections. Provide exactly
one of `reportId` or `jobId`.

```ts
await mappa.feedback.create({
  reportId: "report_...",
  rating: "thumbs_up",
  tags: ["quality"],
  comment: "Accurate summary",
});
```

---

## Errors


The SDK throws typed errors:

- `ApiError` for non-2xx responses
- `AuthError` for 401/403
- `ValidationError` for 422
- `RateLimitError` for 429 (may include `retryAfterMs`)
- `JobFailedError` / `JobCanceledError` from polling helpers
- `MappaError` for client-side validation or runtime constraints

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
    output: { type: "markdown" },
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

---

## Webhooks

Use `mappa.webhooks.verifySignature()` to verify incoming webhook events.

Tips for raw body handling:
- Express: `express.text({ type: "*/*" })`
- Fastify: use `rawBody` (enable `bodyLimit` and `rawBody`)
- Next.js (App Router): read `await req.text()` before parsing
- Node 18+ or modern runtimes are required for WebCrypto

The SDK expects a header shaped like:

```http
mappa-signature: t=1700000000,v1=<hex>
```

And verifies the HMAC-SHA256 signature of:

```ts
${t}.${rawBody}
```

Example (Express):

```ts
import express from "express";
import { Mappa } from "@mappa-ai/mappa-node";

const app = express();

// IMPORTANT: you must keep the raw body for signature verification.
app.post(
  "/webhooks/mappa",
  express.text({ type: "*/*" }),
  async (req, res) => {
    const mappa = new Mappa({ apiKey: process.env.MAPPA_API_KEY! });

    await mappa.webhooks.verifySignature({
      payload: req.body,
      headers: req.headers as Record<string, string | string[] | undefined>,
      secret: process.env.MAPPA_WEBHOOK_SECRET!,
      toleranceSec: 300,
    });

    const event = mappa.webhooks.parseEvent(req.body);

    // Example: handle event types.
    switch (event.type) {
      case "report.completed":
        // event.data contains the payload from Mappa.
        break;
      default:
        break;
    }

    res.status(200).send("ok");
  },
);
```

---

## Telemetry hooks

You can hook into request/response/error events:

```ts
import { Mappa } from "@mappa-ai/mappa-node";

const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
  telemetry: {
    onRequest: ({ method, url, requestId }) => {
      console.log("request", method, url, requestId);
    },
    onResponse: ({ status, url, durationMs, requestId }) => {
      console.log("response", status, url, durationMs, requestId);
    },
    onError: ({ url, requestId, error }) => {
      console.log("error", url, requestId, error);
    },
  },
});
```

---

## TypeScript

Everything is typed. Common types are exported and `Report` is a discriminated
union on `report.output.type`.

```ts
import type {
  Report,
  Job,
  ReportCreateJobRequest,
  ReportOutput,
  WaitOptions,
} from "@mappa-ai/mappa-node";
```

---

## License

MIT
