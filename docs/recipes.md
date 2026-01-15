# Recipes

A handful of copy/paste helpers for real-world workflows.

## Upload → create job → wait

```ts
const receipt = await mappa.reports.createJobFromUrl({
  url: "https://example.com/media.mp3",
  output: { type: "markdown" },
});

const report = await receipt.handle!.wait();
```

## Use streaming for progress

```ts
const handle = mappa.reports.makeHandle("job_...");

for await (const event of handle.stream()) {
  if (event.type === "stage") {
    console.log(event.stage, event.progress);
  }

  if (event.type === "terminal") {
    break;
  }
}
```

## Add request tracing

```ts
const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
  telemetry: {
    onRequest: ({ method, url, requestId }) => {
      console.log("request", method, url, requestId);
    },
    onResponse: ({ status, url, durationMs, requestId }) => {
      console.log("response", status, url, durationMs, requestId);
    },
  },
});
```

## Webhook event router

```ts
const event = mappa.webhooks.parseEvent(payload);

switch (event.type) {
  case "report.completed":
    // event.data contains report details.
    break;
  default:
    break;
}
```

## Generate from local file

```ts
const report = await mappa.reports.generateFromFile({
  file: new File([bytes], "audio.mp3"),
  output: { type: "markdown" },
});
```

## Handle timeouts gracefully

```ts
const controller = new AbortController();

setTimeout(() => controller.abort(), 5_000);

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

Use these as templates and remix them for your app.