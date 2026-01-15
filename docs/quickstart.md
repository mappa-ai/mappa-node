# Quickstart

Let’s go from “hello” to “report” in a few minutes.

## 1) Install

```bash
npm install @mappa-ai/mappa-node
# or
bun add @mappa-ai/mappa-node
```

## 2) Add your API key

```bash
export MAPPA_API_KEY="your-api-key"
```

## 3) Create a report from a URL

```ts
import { Mappa } from "@mappa-ai/mappa-node";

const mappa = new Mappa({
  apiKey: process.env.MAPPA_API_KEY!,
});

const report = await mappa.reports.generateFromUrl({
  url: "https://example.com/media.mp3",
  output: { type: "markdown" },
});

if (report.output.type === "markdown") {
  console.log(report.markdown);
}
```

## 4) Your first win ✅

If you see Markdown output, you’ve got liftoff. From here, you can switch to job-based workflows for production, stream progress, or set up webhooks.

Next: [Core concepts](concepts.md).