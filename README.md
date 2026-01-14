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

const report = await mappa.reports.generate({
  media: { url: "https://example.com/media.mp3" },
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

Create a derived client with overrides:

```ts
const mappaNoRetries = mappa.withOptions({ maxRetries: 0 });
```

### Timeouts vs long-running jobs

`timeoutMs` is a **per-request** timeout (including each retry attempt).
For long-running work, create a job and use `jobs.wait(...)` or `reports.makeHandle(jobId)`.

---

## Core concepts

### Reports are asynchronous

Creating a report returns a **job receipt**. You can:

- **Wait** (poll) until completion.
- **Stream** job events.
- **Use webhooks** so your server is notified when work is done.

### Media input

When creating a report, `media` must be exactly one of:

- `{ url: string }` (Mappa fetches the media)
- `{ mediaId: string }` (reference a previously uploaded file)

---

## Creating reports

### 1) Create a job (recommended for production)

```ts
const receipt = await mappa.reports.createJob({
  media: { url: "https://example.com/media.mp3" },
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
for await (const e of receipt.handle!.stream()) {
  if (e.type === "status") console.log("status", e.job.status);
  if (e.type === "stage") console.log("stage", e.stage, e.progress);
  if (e.type === "terminal") console.log("done", e.job.status);
}
```

### 4) Fetch a report later

```ts
const reportById = await mappa.reports.get("report_id");

const reportByJob = await mappa.reports.getByJob(receipt.jobId);
```

---

## Uploading files

If you need to upload media first, use `files.upload()` and then reference it by `mediaId`.

```ts
const media = await mappa.files.upload({
  file: new Uint8Array([/* ... */]),
  contentType: "audio/wav",
  filename: "sample.wav",
});

const report = await mappa.reports.generate({
  media: { mediaId: media.mediaId },
  output: { type: "markdown" },
});
```

Notes:

- `files.upload()` currently uses a JSON base64 transport. It’s suitable for small files.
- For large files, prefer a direct URL when possible.

---

## Report outputs

`output` controls the format:

### Markdown

```ts
const report = await mappa.reports.generate({
  media: { url: "https://example.com/media.mp3" },
  output: { type: "markdown" },
});

if (report.output.type === "markdown") {
  console.log(report.markdown);
}
```

### Sections

```ts
const report = await mappa.reports.generate({
  media: { url: "https://example.com/media.mp3" },
  output: {
    type: "sections",
    sections: [
      { id: "summary" },
      { id: "insights", params: { detail: "high" } },
    ],
  },
});

if (report.output.type === "sections") {
  for (const section of report.sections) {
    console.log(section.id, section.title);
  }
}
```

---

## Errors

The SDK throws typed errors:

- `ApiError` for non-2xx responses
- `AuthError` for 401/403
- `ValidationError` for 422
- `RateLimitError` for 429 (may include `retryAfterMs`)
- `JobFailedError` / `JobCanceledError` from polling helpers

```ts
import {
  ApiError,
  AuthError,
  RateLimitError,
  ValidationError,
} from "@mappa-ai/mappa-node";

try {
  await mappa.reports.generate({
    media: { url: "https://example.com/media.mp3" },
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

  throw err;
}
```

---

## Webhooks

Use `mappa.webhooks.verifySignature()` to verify incoming webhook events.

The SDK expects a header shaped like:

```
mappa-signature: t=1700000000,v1=<hex>
```

And verifies the HMAC-SHA256 signature of:

```
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

Everything is typed. Common types are exported:

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
