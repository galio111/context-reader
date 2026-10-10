# Daily editorial shuffle

Status: implemented and locally verified; production acceptance pending.

After each completed daily publication run, shuffle today's selections and older published articles independently in all five homepage categories. Today remains first; preserve existing current-day featured choices, selection timestamps, and the recommendation whitelist. Single-source manual discovery remains candidate-only. Normal source batches and hourly feed discovery do not trigger sorting. New publications from a later recovery receive one new final shuffle.

Order and its day/publication-set receipt commit atomically with compare-and-swap. The day ledger marks sorting complete only afterward. Retries after a crash reuse the receipt, and ordinary completed-day ticks avoid inventory work. No models are called. Existing finished days receive one catch-up pass after deployment.

Live preflight found 1690 published articles, including 545 explicitly classified as science. Topic ordering previously persisted only 500 ids, so the per-topic bound is now 10000. Recommendation whitelist retention remains 500; excluded recommendations are never reinserted. Public cache invalidation applies the new order to SSR.

Local verification: 109 critical/editorial tests, eight provider fallback/billing tests, nine release contracts, egress audit and production build passed. The strengthened final nine-test shuffle/runtime run verifies both day groups, all categories, CAS conflict recovery, repeated-run stability, new recovery/day handling, bounded conflict failure, mail-independent finalization and a 1200-item historical topic library. The inherited build has unrelated lint warnings.

Production checks will compare real before/after category orders, inventory, completion receipt, repeat stability, unchanged editorial spending and accepted email, public SSR and article replay; then verify signed-in reading core, account/sync/Admin boundaries, seven services, isolated backup restore and parent rollback image.
