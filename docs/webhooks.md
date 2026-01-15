# Webhooks

Webhooks are the “send me a postcard” option. Mappa calls your server when a job finishes.

## Verify signatures

You’ll receive a `mappa-signature` header shaped like:

```
mappa-signature: t=1700000000,v1=<hex>
```

Verify it like this (Express example):

```ts
import express from "express";
import { Mappa } from "@mappa-ai/mappa-node";

const app = express();

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

    if (event.type === "report.completed") {
      // event.data contains the Mappa payload.
    }

    res.status(200).send("ok");
  },
);
```

## Raw body tips

- Express: use `express.text({ type: "*/*" })`
- Fastify: enable `rawBody`
- Next.js App Router: read `await req.text()` before parsing

## Suggested flow

1. Verify signature.
2. Parse event.
3. Dispatch by `event.type`.
4. Store or forward results.

Webhooks keep your API lean and your users happy.