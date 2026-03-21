# Cloudflare Workers + Durable Objects Reference

How this project uses Cloudflare, and what matters for development and deployment.

Source: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [DO lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [Error handling](https://developers.cloudflare.com/durable-objects/best-practices/error-handling/).

## Architecture recap

The Worker serves static assets (React app) and routes `/api/*` to Hono. The `/api/stream` endpoint upgrades to a WebSocket and proxies to a singleton `ExplorerDO` (identified by `idFromName("global")`).

The ExplorerDO runs a continuous exploration loop using alarms. Each alarm fires one exploration step (Tavily search + LLM call), broadcasts the result to all connected WebSocket clients, and schedules the next alarm. When no viewers are connected, it stops.

## Workers limits (relevant subset)

| Limit | Free | Paid |
|---|---|---|
| Requests | 100K/day | Unlimited |
| CPU time per request | 10ms | 30s default, up to 5min |
| Memory per isolate | 128MB | 128MB |
| Subrequests per invocation | 50 | 10,000 |
| Worker bundle size (compressed) | 3MB | 10MB |
| Worker startup time | 1s | 1s |

**CPU time** counts only active JS execution. Time spent waiting on `fetch()`, storage calls, and other I/O does not count. Our exploration step does ~2 fetch calls (search API + LLM API) with minimal CPU between them. The 30s default is more than enough.

**Duration (wall time)** has no hard limit for HTTP requests while the client stays connected. Alarm handlers have a 15-minute wall time limit. Our steps take ~13s wall time, well within that.

## Durable Objects limits

| Limit | Value |
|---|---|
| CPU per request/alarm | 30s default, configurable to 5min |
| Storage per DO (SQLite) | 10GB |
| Storage per account (SQLite, paid) | Unlimited |
| Max DO classes per account | 500 (paid) / 100 (free) |
| Soft throughput limit | ~1,000 req/s per DO |
| WebSocket message size | 32 MiB |
| Max columns per SQLite table | 100 |

## Alarms

- One alarm per DO at a time. `setAlarm()` overwrites any existing alarm.
- Guaranteed at-least-once execution.
- Retried on exception with exponential backoff (starting at 2s, up to 6 retries).
- 15-minute wall time limit per alarm invocation.
- Each `setAlarm()` is billed as one row written (SQLite) or one write unit (KV).

**For our design:** Each exploration step runs in one alarm. The alarm does search + LLM (two fetches, ~13s wall time), broadcasts results, then calls `setAlarm()` for the next step. This is within limits and keeps each alarm self-contained.

**Retry caution:** If an alarm exhausts all 6 retries (e.g., extended API outage), it stops permanently. The current code should catch errors and schedule a new alarm with delay rather than letting exceptions bubble up and consume retry attempts.

## Hibernation lifecycle

A Durable Object transitions through these states:

1. **Active, in-memory** - Handling requests/events.
2. **Idle, in-memory, hibernateable** - All handlers done, eligible for hibernation.
3. **Idle, in-memory, non-hibernateable** - Handlers done but something prevents hibernation.
4. **Hibernated** - Removed from memory. WebSocket connections stay alive on the Cloudflare edge.
5. **Inactive** - Fully removed from host process. Cold start on next request.

**Hibernation requires ALL of these:**
- No `setTimeout` / `setInterval` callbacks pending.
- No in-progress `fetch()` calls being awaited.
- No WebSocket Standard API usage (must use Hibernation API: `ctx.acceptWebSocket()`).
- No request/event still being processed.

**Timing:**
- Eligible idle DO hibernates after ~10 seconds.
- Non-hibernateable idle DO is evicted after 70-140 seconds.

**Critical:** When a DO hibernates, ALL in-memory state is discarded. The constructor runs again on wake-up. Only persisted storage and WebSocket attachments survive.

### What this means for ExplorerDO

Between alarm firings, the DO should be hibernation-eligible (no pending fetches, no setTimeout, using Hibernation WebSocket API). This is good for cost. But it means the in-memory `ExplorerState` (cards, eventBuffer, query, step) will be lost if the DO hibernates between alarms.

Currently the alarm is scheduled with very short delays (100ms between steps), so hibernation is unlikely during an active round. But during the 5-second pause between rounds, or if an error delays the next alarm by 10+ seconds, the DO could hibernate and lose its state.

## Pricing (Workers Paid plan, $5/month base)

### Compute

| | Included | Overage |
|---|---|---|
| Requests | 1M/month | $0.15 per million |
| Duration | 400,000 GB-s | $12.50 per million GB-s |

**WebSocket billing:**
- Each WebSocket connection creation = 1 request.
- Incoming messages use a 20:1 ratio (100 messages = 5 billed requests).
- Outgoing messages are free.
- Protocol-level pings (keepalive) are free and don't wake the DO from hibernation.
- `setWebSocketAutoResponse()` messages don't incur wall-clock charges.

**Duration billing:**
- Billed for wall-clock time while active OR idle-but-non-hibernateable.
- NOT billed while hibernation-eligible (even before actually hibernating) or while hibernated.
- Duration is billed at 128MB regardless of actual memory usage.

### Storage (SQLite)

| | Included | Overage |
|---|---|---|
| Rows read | 25B/month | $0.001 per million |
| Rows written | 50M/month | $1.00 per million |
| Stored data | 5 GB-month | $0.20 per GB-month |

### Cost estimate for our use case

The ExplorerDO runs a singleton. Each exploration step fires one alarm (~13s wall time). Between steps (100ms gap), the DO is eligible for hibernation and not billed for duration.

For a round of 12 steps:
- Duration: ~12 * 13s = 156s of active time = 156 * 128MB/1GB = 19.97 GB-s
- Requests: 12 alarm invocations + WebSocket messages (minimal)

A month of continuous exploration (~200 rounds/day):
- Duration: 200 * 20 GB-s * 30 = 120,000 GB-s (within the 400K included)
- Requests: well within 1M included
- Storage: minimal (event buffer, current state)

**Estimated cost: $5/month (just the base plan fee).** We'd need very heavy usage to exceed included limits.

## Wrangler configuration notes

### Storage backend

The `migrations` section in `wrangler.jsonc` determines the storage backend:
- `new_classes` creates a KV-backed DO (legacy).
- `new_sqlite_classes` creates a SQLite-backed DO (recommended).

SQLite is recommended for all new DOs, is the only option on the free plan, and has better pricing. **Our current config uses `new_classes`, which should be `new_sqlite_classes`.**

### CPU limit

The default 30s CPU time is configurable:
```jsonc
{
  "limits": {
    "cpu_ms": 300000  // 5 minutes max
  }
}
```

We don't need to change the default. Our steps use negligible CPU.

### Secrets

Set via wrangler CLI (not in code, not in wrangler.jsonc):
```bash
wrangler secret put TAVILY_API_KEY
wrangler secret put ZAI_API_KEY
```

For local dev, use `.dev.vars`:
```
TAVILY_API_KEY=...
ZAI_API_KEY=...
```

This file should be in `.gitignore`.

## Shutdown behavior

Durable Objects shut down on:
- Code deployments (disconnects all WebSockets).
- Inactivity (follows lifecycle states above).
- Runtime updates (Cloudflare-initiated, ~30s grace period for in-flight requests).

**No shutdown hooks exist.** Design for state to be persisted incrementally, not saved on exit. Storage writes are fast and synchronous.

**WebSocket disconnects on deploy:** Every deploy restarts all DOs, killing WebSocket connections. Clients must handle reconnection. The frontend's WebSocket hook should implement automatic reconnection with backoff.

## Error handling

Exceptions from DOs propagate to the calling Worker. Key properties:
- `.retryable` = true: Transient error, safe to retry if idempotent.
- `.overloaded` = true: DO is overloaded, do NOT retry (makes it worse).
- `.remote` = true: Exception originated in user code (vs. infrastructure).

After an exception, the `DurableObjectStub` may be broken. Create a new one for subsequent requests. (Not relevant for our singleton WebSocket pattern, but good to know.)

## Issues in current code

These are things to fix in subsequent PRs:

1. **Migration backend:** `wrangler.jsonc` uses `new_classes` (KV-backed). Should be `new_sqlite_classes` (SQLite-backed). This affects pricing and is required for free plan support.

2. **In-memory state not persisted:** `ExplorerState` lives only in memory. If the DO hibernates between alarms (10s pause between rounds) or restarts (deploy, runtime update), all state is lost: event buffer, current query, step counter. New viewers after a restart get no history. Fix: persist critical state to DO storage, restore in constructor.

3. **Alarm error handling:** The `alarm()` handler catches errors and broadcasts them, but then calls `scheduleNext(10000)`. If the error is persistent (API down for hours), each alarm invocation will throw and consume a retry. After 6 retries, the alarm stops permanently. Fix: catch errors inside `alarm()` and explicitly call `setAlarm()` for retry rather than letting exceptions propagate.

4. **No WebSocket auto-response for pings:** The client sends JSON `{"type":"ping"}` and the DO responds manually. This keeps the DO awake. Should use `ctx.setWebSocketAutoResponse()` for protocol-level or application-level keepalive so pings don't prevent hibernation.

5. **WebSocket reconnection:** The frontend needs to handle disconnects gracefully (deploy-triggered, network issues, hibernation edge cases). Should implement reconnection with exponential backoff.
