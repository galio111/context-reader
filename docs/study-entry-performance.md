# Study entry performance and notebook ordering

## Current behavior

StudyPanel retains a verified account's snapshot. Account synchronization runs independently of entry: first-load controls require an authoritative snapshot, but never wait for the entire account sync. Reopening within 30 seconds reuses the snapshot immediately; older data refreshes in the background. Every re-entry still requests a server presentation token, and a version/deletion conflict refreshes and retries once.

Background responses use mutation epochs and server timestamps to reject stale state. Vocabulary merge events and debounced local upload completion invalidate the plan. Settings merge only their returned settings, without rewinding the snapshot clock. The accepted durable answer outbox, cross-tab reconciliation, Shanghai-day recovery, FSRS, rewards, Anki records and compact database entry projection remain intact.

Pending outbox answers hide their own cards while the initial snapshot loads. Whichever authoritative response first supplies a complete snapshot ends the initial wait, including an outbox confirmation that beats start. A late initial request cannot clear a later foreground operation's busy state. Subsequent refreshes wait for pending answers to settle. Legacy session answers migrate with their original ids.

Within prepare/start, reconciliation's already-read vocabulary is reused by the final snapshot. Cards and settings are reread after the plan operation for concurrent-device changes. There is no shared account cache or database migration.

The notebook has three upper-right display orders: 收藏顺序 (default, original createdAt, oldest first), 字母 A–Z (case-insensitive English collation), and 随机 (reshuffle on every click). With at least two filtered entries each shuffle changes their order. New entries append to the existing random order. Sorting is local and does not change saved records or the FSRS queue.

Above 100 entries, the notebook renders the viewport plus eight overscan rows. Each row uses its actual measured height, including long meanings, masking and viewport changes; 76px is only an initial estimate. The existing dialog remains the scroll container. Per-id keys retain reveal state, list semantics expose positions/count, and memoized content avoids unnecessary parent-timer rendering. Smaller lists retain normal document flow. Closing a detail restores its connected opener without scrolling.

## Evidence and limits

Public baseline release 20261013T031701 had 1,724 entries in the largest account. Read-only start stages used 29 internal REST calls and 16.8 MB, excluding authentication and write RPCs; the browser snapshot was 4.07 MB JSON / approximately 946 KB gzip. Three server observations were 496 / 4,232 / 1,975 ms. These are dated, variable observations from before the inherited compact projection.

The browser comparison uses real deployed assets with synthetic API delays: first start 500 ms, account sync 5 seconds, later starts 2.5 seconds. Baseline first enabled controls took 5,017 ms and warm re-entry 2,524 ms. Two accepted-release public runs measured first controls at 702 / 729 ms, warm re-entry at 120 / 19 ms with zero start requests, and 2,000-word random reordering at 63 / 44 ms, including click and two animation frames. Only ten long-meaning mobile rows were mounted.

Both public runs passed all three orders, repeated/keyboard shuffle, masking identity, variable-height mobile geometry, final-row reachability, search for an unmounted entry, Tab traversal beyond the initial rendered range, detail focus return, stale-background/save races, local-word refresh, version/deleted-card recovery, failed background reads and outbox recovery, with zero page errors. An earlier full-page recovery run exceeded its 10-second element wait; later full-document recovery samples were 5.562 and 14.467 seconds including navigation. Cold page loading remains a limitation and is distinct from warmed study entry.

The 1,200-entry real route/store fixture reduces vocabulary reads from six pages to three and retains fresh card versions. Tests cover creation timestamps, stable ties, 10,000-entry permutations, both initial-snapshot/outbox race directions, duplicate-answer and cross-tab/midnight recovery. Seventy-one targeted and 90 critical tests, nine release contracts, local/server builds and the egress guard passed. Exact-source [GitHub Actions](https://github.com/galio111/context-reader/actions/runs/38360148231) passed architecture/account/reading, provider billing, contracts, egress and production build.

The older study-refinement-browser script has a baseline-identical obsolete flourish-button selector failure; its full suite is not claimed to pass. The dedicated entry/race script and actual React queue tests provide the current regression coverage. No model generation is involved.

Automatic approval review rejected temporary QA-account creation (blocked by policy); this task created no account and submitted no real user answer. Live new-answer writes for this release remain unverified. Mocked public-browser behavior and real route/store fixtures do not replace that missing check. Physical devices, other browsers and the user's final visual assessment also remain open.

## Accepted release

Production release 20261013T145900, parent 20261013T063535, source 516a1724697f5b60de7e6281aafd737cab3d4f48. The stable entrypoint accepted the exact 43-file cumulative delta; public connectivity, manifest and release state agree with mainland_internal. Evidence is under docs/evidence/study-entry-1013/.

Only app/caddy were recreated. All five backend container ids, start times and images stayed unchanged. Anonymous study/sync/Admin reads return 401; recovery Admin's four reads return 200. Health passes. The latest 20261013T063139Z backup passed SHA and an isolated 39-table restore with no verifier database left behind. Current and direct-parent rollback images remain available. The existing guarded image-retention script removed older application tags after a disk-threshold warning; final disk usage is 67%.

The source commit above is the deployed application identity. Later documentation/evidence commits do not change it.
