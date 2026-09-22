# 1,000 DAU capacity and regression contract

Implementation prepared; production and post-release measurements must be recorded before claiming acceptance.

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

Run critical regressions, focused cache/concurrency/catalogue tests, TypeScript, production build, release contracts and static egress audit. Full tests use `node --require ./scripts/editorial-server-hook.cjs --import tsx --test tests/*.test.ts tests/*.test.tsx`. Three existing failures were reproduced on the unmodified 20260922T070500 parent: two outdated editorial-mail expectations and malformed-provider-response diagnostic classification. Do not weaken those assertions or describe the full suite as passing.

Production acceptance includes exact release/parent identity, public catalogue/detail parity, actual AI streaming, isolated test-account login/save/sync, Admin boundary and read checks, all service health, backup restore and rollback image availability. Browser automation was unavailable during initial validation; desktop/mobile visual verification must be marked incomplete until actually performed. The short mixed test is not an hours-long soak or a signed-in 100-user benchmark.

Baseline evidence: [first production boundary test](capacity-test-20260922.md). Local evidence and repeatable probe results belong in `artifacts/capacity-1000-dau/` outside release archives.
