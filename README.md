# Mappa Node SDK

A lightweight JavaScript/TypeScript client for the Mappa API.

## Installation

```bash
npm install mappa-node
# or
yarn add mappa-node
# or
pnpm install mappa-node
# or
bun add mappa-node
```

## Requirements

- A valid Mappa API key.

## Authentication

Set the `MAPPA_API_KEY` environment variable or pass the key directly:

```bash
export MAPPA_API_KEY="your-api-key"
```

```ts
import { Mappa } from "mappa-node";

const client = new Mappa("your-api-key");
```

## Usage

### Instantiate the client

```ts
import { Mappa } from "mappa-node";

const mappa = new Mappa(); // Reads MAPPA_API_KEY by default
```

### Generate a behavior profile from a remote URL

```ts
await mappa.generateTextReport({
  inputMedia: {
    kind: "url",
    url: "https://example.com/media.mp3",
  },
  targetSpeaker: { strategy: "dominant" },
});
```

### Generate a behavior profile from an uploaded file

```ts
const file = new File([buffer], "sample.wav", { type: "audio/wav" });

await mappa.generateTextReport({
  inputMedia: {
    kind: "file",
    file,
  },
  targetSpeaker: {
    strategy: "magic_hint",
    hint: "the person being interviewed",
  },
});
```

The method returns:

```ts
{
  behaviorProfile: string;
  entityId: string;
}
```

## License

MIT
