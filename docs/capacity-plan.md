# 1,000 DAU capacity and regression contract

The original 1,000-DAU workload measurements below describe release `20260922T074500`, parent `20260922T072500`, source `9aa9b225ac85811e2733fec430bfb373b37d793b`. The specified mixed workload passed a repeat, but strict unrestricted capacity acceptance was **not complete**: simultaneous cold downloads exceeded the threshold and one initial mixed request timed out. Follow-up work for three simultaneous visitors, including real desktop/mobile Chrome checks and the current release identity, is recorded in [cold-start-performance.md](cold-start-performance.md). That narrower acceptance does not certify arbitrary 1,000-DAU traffic.

1,000 DAU is a workload target, not a fixed concurrent-user guarantee. Planning assumptions: 20 minutes per reader across ten active hours, about 33 average readers and 100 at a 3x peak. The bounded public mixed probe models 100 online readers, 60 generated dictionary lookups/minute, 20 article opens/minute and five fresh homepage arrivals/minute. It does not include signed-in synchronization and cannot certify all possible 1,000-DAU workloads.

## Preserved behavior

- All published catalogue entries, source/title/summary, covers, category and personalized ordering remain available. Compact homepage/API summaries omit only Admin review evidence; Admin and full detail retain it.
- Reader, imports, editing/undo, save, translation, vocabulary/Anki, Menu/account, dictionary, offline identity and protocol-2 synchronization remain intact. No authorization or quota cache is introduced.
- Reader/dictionary/Menu bundles load on demand. Once first opened, Menu stays mounted when closed so existing local UI state survives.
- Showcase recordings load when their section is playing/visible; subsequent pause, loop, tab changes and replay remain. Ballpit, media layouts, reduced motion and navigation are unchanged.

## Capacity controls

Public catalogue and curation reads have 30-second process-local caches. Published details share in-flight reads and retain at most 64 entries / 24 MiB for 30 seconds; errors are not cached. Mutation paths invalidate public reads immediately. A generation fence prevents an older pending read from repopulating a cleared cache. External SQL/editorial processes are bounded by the short TTL; the existing five-minute Next summary cache still uses its original revalidation tag. These caches assume the current single app process and never authorize private data.

All user-facing AI routes share `AI_MAX_CONCURRENCY` (default 16, bounded 4..32). Interactive waiters use FIFO handoff, at most 48 queued and a 2.5-second wait. Translation/summary acquire a background sub-budget of one quarter of total, at most four, before entering the shared pool; background admission waits at most eight seconds per stage and retains at most 16 background waiters. Cancellation removes waiters and failed admission refunds reservations. Provider spending, user quotas and IP rate limits remain enforced. A larger value is not an upstream throughput promise.

## Verification

Experience failure is any busy/error response, article download above three seconds, homepage core-resource download above five seconds, or AI first content above five seconds. Streaming completion must contain the expected done event, not merely return HTTP 200. Cold-resource time is not LCP or interactivity, and omits images/fonts/late imports.

89 critical regressions, five focused cache/concurrency/catalogue tests, TypeScript, local/server production builds, release contracts and static egress audit passed. Full tests use `node --import ./scripts/editorial-server-hook.mjs --import tsx --test tests/*.test.ts tests/*.test.tsx`: the final cumulative source passes 222/224. Two existing editorial-mail expectations fail (`editorial-repair` old 35-article target, `jev-calibration` old cost wording). Both also failed on the unmodified starting parent. A third pre-existing malformed-provider diagnostic failure was fixed by the merged model-control release. Assertions were not weakened.

Production acceptance includes exact release/parent identity, public catalogue/detail parity, actual AI streaming, isolated test-account login/save/sync, Admin boundary and read checks, all service health, backup restore and rollback image availability. Browser automation was unavailable during initial validation; desktop/mobile visual verification must be marked incomplete until actually performed. The short mixed test is not an hours-long soak or a signed-in 100-user benchmark.

Baseline evidence: [first production boundary test](capacity-test-20260922.md). Local evidence and repeatable probe results belong in `artifacts/capacity-1000-dau/` outside release archives.

## Measured production results

All measurements below used the exact accepted release above. Durations are client-observed downloads, not browser rendering measurements.

| Check | Result |
| --- | --- |
| Catalogue parity at this historical release | All 426 ids/order and reader-visible fields preserved; all ids were server-rendered; detail retains editorial evidence. The later cold-start release server-renders exact initial showcases and progressively retrieves the complete unchanged inventory. |
| Catalogue JSON | 1,142,103 → 542,150 uncompressed bytes (52.5% smaller) |
| Homepage HTML + initial JS/CSS | 914,677 → 741,565 wire bytes against the immediate parent (18.9% smaller); images/fonts/late imports excluded |
| 16 simultaneous real AI queries | 16 completed with done events, no busy response; maximum completion 6.01 s |
| 64 simultaneous article reads | All valid HTTP 200; P95 2.83 s, maximum 3.14 s: strict 3 s gate fails |
| Two simultaneous cold resource downloads | 4.57 s and 8.73 s: strict 5 s gate fails |
| First 120-second mixed run | 120 AI / 40 article / 10 cold actions; one AI client timeout at 30 s; remaining actions passed |
| Same mixed profile repeated | All 170 actions passed; AI first-content P95 1.49 s, completion P95 6.35 s; article P95 0.26 s; cold maximum 4.74 s |

The initial timeout's proxy log shows an incomplete response and client cancellation about 3.06 seconds into proxy processing, at the client's deadline. This suggests connection/transport delay but does not establish a root cause. The initial probe discarded partial-response timing on exceptions; it now preserves headers, first content, action/request identifiers and partial events, while keeping the same 30-second deadline and failure thresholds. No application change or threshold relaxation occurred between the two mixed runs. Both outcomes remain evidence; a successful repeat does not erase an intermittent failure.

Authenticated login, save/read and protocol-2 stale-write rejection passed with isolated synthetic accounts; both accounts were then deleted by exact id/name/time predicates. Anonymous sync/Admin access returned 401; authenticated Admin session/accounts/articles/automation reads passed. Legacy homepage redirects preserve the query string. All seven services were healthy, backup restoration verified 16 tables, and the accepted parent rollback image existed. Only app/caddy were recreated. Browser interaction checks were incomplete at that stage because the browser connector failed; subsequent direct Chrome checks are recorded in the cold-start report.

The current host is four CPU cores / approximately 4 GiB RAM with a documented 3 Mbps public uplink. Mixed-load samples did not show CPU/RAM exhaustion. This does not prove bandwidth is the sole cause, but delivery remains a measured constraint after payload reduction. 1,000 DAU at the stated reading mix is a planning target supported by a short successful run, **not a guaranteed maximum or a completed launch-capacity certification**. Remaining acceptance: improve/measure public delivery capacity, repeat cold bursts from multiple networks, run a sustained mixed workload including authenticated sync/import/translation, and complete desktop/mobile interaction verification. Do not increase purchased infrastructure or relax protections automatically.
