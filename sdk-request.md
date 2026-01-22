# SDK Request: SSE Job Status Streaming

## Background

The current SDK uses polling to wait for job completion (`jobs.wait()` and `jobs.stream()`). This causes rate limit errors when jobs take time to process, as the SDK hits `GET /v1/jobs/:jobId` repeatedly.

The behavioral-engine now exposes a new SSE endpoint: `GET /v1/jobs/:jobId/stream` that streams real-time job status updates over a single held connection.

## New Server Endpoint

### `GET /v1/jobs/:jobId/stream`

**Response:** `text/event-stream` (Server-Sent Events)

**Query Parameters:**
- `timeout` (optional): Stream timeout in milliseconds. Default: `300000` (5 min), Max: `300000`

**Headers:**
- `Authorization: Bearer <api_key>` (required)
- `Last-Event-ID` (optional): For resumption after reconnect

### Event Format

```
id: <monotonic_event_id>
event: <event_type>
data: <json_payload>

```

### Event Types

#### `status`
Emitted when job status changes.

```json
{
  "status": "running",
  "stage": "extracting",
  "progress": 0.45,
  "job": { /* full job object */ }
}
```

#### `stage`
Emitted when job processing stage changes.

```json
{
  "stage": "rendering",
  "progress": 0.8,
  "job": { /* full job object */ }
}
```

#### `terminal`
Emitted when job reaches final state. Stream closes after this event.

```json
{
  "status": "succeeded",
  "reportId": "rpt_xxx",
  "job": { /* full job object */ }
}
```

Or on failure:

```json
{
  "status": "failed",
  "error": {
    "code": "processing_failed",
    "message": "Media processing failed"
  },
  "job": { /* full job object */ }
}
```

#### `heartbeat`
Emitted every 15 seconds to keep connection alive.

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

#### `error`
Emitted if job not found (instead of HTTP 404, since SSE is already streaming).

```json
{
  "code": "not_found",
  "message": "Job not found"
}
```

---

## Required SDK Changes

### 1. Add SSE Streaming to Transport

**File:** `src/resources/transport.ts`

Add a new method for SSE streaming:

```typescript
interface SSEStreamOptions {
  signal?: AbortSignal;
  lastEventId?: string;
}

interface SSEEvent<T = unknown> {
  id?: string;
  event: string;
  data: T;
}

async *streamSSE<T>(
  path: string,
  opts?: SSEStreamOptions
): AsyncGenerator<SSEEvent<T>>
```

**Implementation details:**

1. Use native `fetch` with streaming response body (not `EventSource` - that's browser-only)
2. Parse SSE format manually from the `ReadableStream`
3. Set headers:
   - `Accept: text/event-stream`
   - `Cache-Control: no-cache`
   - `Authorization: Bearer <api_key>`
   - `Last-Event-ID: <id>` (if provided)
4. Handle connection errors by throwing (no silent fallback)

**SSE Parser Logic:**

```typescript
// SSE format:
// id: <id>\n
// event: <type>\n
// data: <json>\n
// \n

const lines: string[] = [];
for await (const chunk of response.body) {
  const text = decoder.decode(chunk);
  const parts = text.split('\n');
  
  for (const part of parts) {
    if (part === '') {
      // Empty line = end of event
      if (lines.length > 0) {
        yield parseEvent(lines);
        lines.length = 0;
      }
    } else {
      lines.push(part);
    }
  }
}
```

### 2. Refactor `JobsResource.stream()`

**File:** `src/resources/jobs.ts`

Replace the current polling implementation with SSE:

```typescript
async *stream(
  jobId: string,
  opts?: { signal?: AbortSignal; onEvent?: (e: JobEvent) => void }
): AsyncIterable<JobEvent> {
  const maxRetries = 3;
  let lastEventId: string | undefined;
  let retries = 0;

  while (retries < maxRetries) {
    try {
      const stream = this.transport.streamSSE<JobStreamEventData>(
        `/v1/jobs/${encodeURIComponent(jobId)}/stream`,
        { signal: opts?.signal, lastEventId }
      );

      for await (const sseEvent of stream) {
        lastEventId = sseEvent.id;
        
        // Handle error event (job not found)
        if (sseEvent.event === 'error') {
          throw new MappaError(sseEvent.data.message);
        }

        // Map SSE event to JobEvent
        const jobEvent = this.mapSSEToJobEvent(sseEvent);
        opts?.onEvent?.(jobEvent);
        yield jobEvent;

        // Exit on terminal event
        if (sseEvent.event === 'terminal') {
          return;
        }
        
        // Reset retry counter on successful event
        retries = 0;
      }
      
      // Stream ended without terminal event (timeout)
      // Reconnect with last event ID
      retries++;
      await this.backoff(retries);
      
    } catch (error) {
      if (opts?.signal?.aborted) throw error;
      
      retries++;
      if (retries >= maxRetries) {
        throw error; // Throw after max retries (no silent fallback)
      }
      
      await this.backoff(retries);
    }
  }

  throw new MappaError(`Failed to stream job ${jobId} after ${maxRetries} retries`);
}

private mapSSEToJobEvent(sseEvent: SSEEvent): JobEvent {
  switch (sseEvent.event) {
    case 'status':
      return { type: 'status', job: sseEvent.data.job };
    case 'stage':
      return { 
        type: 'stage', 
        stage: sseEvent.data.stage, 
        progress: sseEvent.data.progress,
        job: sseEvent.data.job 
      };
    case 'terminal':
      return { type: 'terminal', job: sseEvent.data.job };
    case 'heartbeat':
      // Skip heartbeats in public API (internal keep-alive)
      return null; // Filter out in the generator
    default:
      return { type: 'status', job: sseEvent.data.job };
  }
}

private async backoff(attempt: number): Promise<void> {
  const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
  const jitter = delay * 0.5 * Math.random();
  await new Promise(r => setTimeout(r, delay + jitter));
}
```

### 3. Refactor `JobsResource.wait()`

**File:** `src/resources/jobs.ts`

Simplify to use `stream()` internally:

```typescript
async wait(jobId: string, opts?: WaitOptions): Promise<Job> {
  const timeoutMs = opts?.timeoutMs ?? 5 * 60_000;
  const controller = new AbortController();
  
  // Set up timeout
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  // Combine signals if user provided one
  if (opts?.signal) {
    opts.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    for await (const event of this.stream(jobId, { 
      signal: controller.signal,
      onEvent: opts?.onEvent 
    })) {
      if (event.type === 'terminal') {
        const job = event.job;
        
        if (job.status === 'succeeded') {
          return job;
        }
        if (job.status === 'failed') {
          throw new JobFailedError(jobId, job.error?.message ?? 'Job failed', {
            requestId: job.requestId,
            code: job.error?.code,
            cause: job.error,
          });
        }
        if (job.status === 'canceled') {
          throw new JobCanceledError(jobId, 'Job canceled', {
            requestId: job.requestId,
            cause: job.error,
          });
        }
      }
    }

    throw new JobFailedError(
      jobId,
      `Timed out waiting for job ${jobId} after ${timeoutMs}ms`,
      { cause: { jobId, timeoutMs } }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 4. Remove Old Polling Code

The following can be removed from `src/resources/jobs.ts`:
- The polling `while (true)` loop in the old `wait()` implementation
- The polling logic in the old `stream()` implementation
- The `backoffMs`, `jitter` usage in the polling context (keep for reconnection backoff)

### 5. Update Types (if needed)

**File:** `src/types.ts`

The existing `JobEvent` type should work. Verify it includes:

```typescript
export type JobEvent =
  | { type: "status"; job: Job }
  | { type: "stage"; stage: JobStage; progress?: number; job: Job }
  | { type: "log"; message: string; ts: string }
  | { type: "terminal"; job: Job };
```

---

## Testing

### Manual Test

```bash
# Start the server
infisical run -- bun run dev

# Create a job and stream its status
curl -N -H "Authorization: Bearer <api_key>" \
  "http://localhost:3000/v1/jobs/<job_id>/stream"
```

### Integration Test

Update `tests/integration.test.ts` to verify:

1. `reports.generateFromFile()` completes without rate limit errors
2. `jobs.stream()` yields expected events
3. `jobs.wait()` returns the final job on success
4. Reconnection works with `Last-Event-ID`

---

## Error Handling

**Critical:** Do NOT fall back to polling silently. If SSE fails, throw an error.

Rationale: The rate limit issue will cause silent failures that are hard to debug. It's better to fail fast and let the user know SSE is required.

**Reconnection:** Retry up to 3 times with exponential backoff before throwing. Use `Last-Event-ID` for resumption to avoid missing events.

---

## Migration Notes

- The public API of `jobs.stream()` and `jobs.wait()` remains unchanged
- Existing code using these methods will automatically benefit from SSE
- The `WaitOptions` interface remains the same
- The `onEvent` callback continues to work as before
