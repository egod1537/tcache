# AI response cache policy

## Current behavior

The AI Job runner normalizes each request, reads its session-scoped Redis key,
and either reuses the stored result or calls the selected provider. A validated
successful result is written with `EX` before the Job completes. A cache hit
does not call the provider or extend the entry's expiration. Failed, malformed,
cancelled, and timed-out responses do not become cache entries. Unusable existing
entries are treated as misses. Redis command errors fail the Job with
`CACHE_ERROR`. Requests received while Redis is reconnecting return 503 without
queuing a later provider call.

The Redis key is `tcache:ai:cache:ai:v1:<sha256>`. It hashes stable serialization
of the session owner and normalized generation input: provider, model, prompt
version, system prompt, ordered messages, context, generation options, tools,
and response schema. Object keys are sorted and array order is preserved. The
cache control flag is excluded. The API issues a session cookie when needed and
derives the owner from that cookie; sending a `sessionOwner` in the request body
cannot select another session or an unscoped public cache. Job list, result,
status, SSE, and cancel use the same ownership boundary. This cookie identifies
the Job session; deployment authentication and authorization remain separate.

## Where to cache

| Target                                        | Policy and key                                                                                                                                                                     | TTL and invalidation                                                                                                                                                           | Isolation and expected effect                                                                                            |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Static knowledge retrieval                    | **First priority when retrieval exists.** Cache results separately from generation. Key on source/index version, normalized query, retrieval parameters, locale, and access scope. | Start with a 1-hour maximum or the source's shorter freshness limit. Advance the index or permission version on updates; invalidate on source withdrawal or access revocation. | Share only public or identically authorized results. Saves repeat retrieval work; a generation call may still be needed. |
| Identical AI generation                       | **Enable** for stable, non-sensitive requests that can reuse the same result in one session. Use the full generation key above.                                                    | Default `AI_CACHE_DEFAULT_TTL_SECONDS=3600`. Use a shorter deployment TTL where appropriate. Change prompt/data versions when their semantics change.                          | No cross-session reuse. A hit saves one generation invocation and its response wait.                                     |
| Personal chat or Trip context                 | **Limited use.** Opt out by default for personal data. For approved, non-sensitive snapshots, keep the session and exact context/data version in the key.                          | Disable caching if freshness requires a tighter bound than the configured TTL. Change the context version after an edit.                                                       | Treat both Redis values and Job results as session-private. Reuse is generally lower as context changes.                 |
| Live, sensitive, or rapidly changing requests | **Disable** with `"cache": { "enabled": false }`. Avoid submitting data that must not be retained to the current Job API.                                                          | No response-cache read or write. Job retention is separate.                                                                                                                    | No cache savings. Prioritize freshness and limit sensitive data retention.                                               |

For requests grounded in external data, pass an explicit version in the API's
`context`, for example `{"datasetVersion":"guide-index-2026-11-22-r2"}`. A change
produces a new key through the existing context path. The cache cannot detect
upstream knowledge changes without a changed input or version. Old entries
expire under their original TTL. There is no knowledge system, retrieval cache,
automatic purge, or per-request TTL override in this implementation. Use
`cache.enabled=false` for a forced fresh call; it neither deletes existing
entries nor disables Job persistence. Review Redis access and
`AI_JOB_TTL_SECONDS` (default 86,400) before allowing sensitive requests. This
policy does not alter the API's current default cache flag.

## Measured response reuse

Measured 2026-11-22 on runtime commit `2aff6bdb48778008583012af25d1ba811216be75`.
Environment: Apple M3 arm64 / Darwin 25.3.0, Node v26.0.0, Redis
8.2.1 in a dedicated non-persistent Unix socket, real HTTP Job API on
loopback, built-in Mock (500 ms delay), model `mock-ai-v1`. Samples were
sequential from HTTP POST through the first successful result GET, with 5 ms
result polling, a 3-second response TTL, and a 300-second Job TTL. Two warm-up
requests were excluded. Percentiles use nearest rank.

| Sample                 | Count | p50 (ms) | p95 (ms) |
| ---------------------- | ----: | -------: | -------: |
| Cache miss             |    60 |   512.25 |   520.83 |
| Cache hit              |   180 |     9.06 |    19.80 |
| Cache disabled control |    20 |   509.95 |        — |

Sixty distinct inputs were each run once cold and then repeated three times in
the same session. All hits used the same key and returned the same provider
payload as the corresponding miss. The cohort hit rate was **180/240 (75%)**,
with **60 measured Mock invocations** and **180 avoided invocations**. The
separate cache-disabled control invoked the Mock 20 times for 20 requests.
The same 240 requests without caching would require 240 invocations by that
control behavior. If a comparable paid generation averaged cost C per
invocation, the illustration would be 240 × C without caching versus 60 × C
with caching, or 180 × C avoided, before Redis and other service costs. This
run made zero external provider calls and incurred zero provider charges.
No vendor unit price or production savings was measured.

Additional controls read a Redis TTL of 2994 ms before expiry, then observed a
miss with the same key after expiration. Changing only context.datasetVersion
changed the key and missed. Identical content submitted without a session
cookie received a new session and missed even with a sessionOwner field in the
body. The second session and a cookie-less reader both received 404 for the
first session's result.

The hit rate describes the deliberately repeated test workload, not production
traffic. The Mock adapter's fixed generation delay dominates the miss
measurements. These figures measure client-observed completion and include HTTP,
Redis, scheduling, and result polling. They do not predict vendor or production
latency.

Run from the repository root with installed dependencies, Node.js 22+,
`redis-server` on PATH (or `REDIS_SERVER` set to a local executable), and the
server build available. The runner starts its own temporary Redis with
persistence disabled and binds HTTP to loopback. It uses only the built-in Mock,
produces per-request samples as JSON, and stops its resources on exit.

```sh
pnpm --filter @tcache/common build
pnpm --filter @tcache/server build
node ai/server/ai-cache-measurement.mjs > cache-measurement.json
```
