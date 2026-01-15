# SDK guide

This guide focuses on practical SDK usage in Node.js or TypeScript.

## Create a client

```ts
import { Mappa } from "@mappa-ai/mappa-node";

const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
});
```

## Create a job (recommended)

```ts
const receipt = await mappa.reports.createJob({
  media: { mediaId: "media_..." },
  output: { type: "markdown", template: "general_report" },
  target: { strategy: "dominant" },
  options: { language: "en", timezone: "UTC" },
  idempotencyKey: "report:customer_123:2026-01-14",
});
```

## Template-driven outputs

Pick a template and supply its parameters (if required). You can also
choose a target speaker when multiple entities are present.

```ts
const report = await mappa.reports.generateFromUrl({
  url: "https://example.com/media.mp3",
  output: {
    type: "markdown",
    template: "hiring_report",
    templateParams: {
      roleTitle: "Customer Success Manager",
      roleDescription: "Own onboarding and renewal conversations.",
      companyCulture: "Curious, candid, customer-obsessed.",
    },
  },
  target: {
    strategy: "timerange",
    timeRange: { startSeconds: 120, endSeconds: 900 },
    onMiss: "fallback_dominant",
  },
});
```

For profile alignment:

```ts
const report = await mappa.reports.generateFromUrl({
  url: "https://example.com/media.mp3",
  output: {
    type: "json",
    template: "profile_alignment",
    templateParams: {
      idealProfile: "High empathy, structured thinking, clear communication.",
    },
  },
});
```


## Wait for completion

```ts
const report = await receipt.handle!.wait({
  timeoutMs: 10 * 60_000,
  onEvent: (event) => {
    if (event.type === "stage") {
      console.log("stage", event.stage, event.progress);
    }
  },
});
```

## Stream job events

```ts
const handle = mappa.reports.makeHandle("job_...");

for await (const event of handle.stream()) {
  if (event.type === "terminal") break;
}
```

## Cancel waits or streams

```ts
const controller = new AbortController();

setTimeout(() => controller.abort(), 5_000);

const report = await receipt.handle!.wait({
  signal: controller.signal,
});
```

## Configure retries and timeouts

```ts
const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
  timeoutMs: 30_000,
  maxRetries: 2,
});

const noRetries = mappa.withOptions({ maxRetries: 0 });
```

## Send feedback

```ts
await mappa.feedback.create({
  reportId: "report_...",
  rating: "thumbs_up",
  tags: ["quality"],
  comment: "Accurate summary",
});
```

## TypeScript tips

The SDK exports helpful types such as `Report`, `ReportOutput`, and `WaitOptions`.
Use `report.output.type` and `report.output.template` to narrow outputs safely.
