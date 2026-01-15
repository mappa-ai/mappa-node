# Core concepts

Mappa is a behavioral engine that works in **jobs**. You ask for a report, Mappa does a sequence of transformations, and you receive the result when it’s ready.

## Jobs are the heartbeat

When you create a report, you get back a **job receipt**. That receipt can:
- **Wait** (poll) until the job finishes.
- **Stream** job events in real time.
- **Pair with webhooks** so your server gets notified.

## Media input

Mappa accepts media in a few friendly ways:
- **Already uploaded**: `{ mediaId: "media_..." }`
- **Remote URL**: `createJobFromUrl()` or `generateFromUrl()`
- **Local file**: `createJobFromFile()` or `generateFromFile()`

## Output types

Reports are typed and depend on `report.output.type`. Common types include:
- `markdown` — ready-to-render summaries.
- `json` — structured sections for UI.

Each report is generated with a **template** so Mappa knows which behavioral lens to apply.

Use TypeScript to narrow results safely:

```ts
if (report.output.type === "markdown") {
  console.log(report.markdown);
}
```

```ts
if (report.output.type === "json") {
  for (const section of report.sections) {
    console.log(section.section_title, section.section_content);
  }
}
```

## The async rhythm

Think of it like brewing coffee:
1. Start the job.
2. Let it work.
3. Enjoy the results.

This rhythm keeps your app responsive and your users happy.