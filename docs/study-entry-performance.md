# Study entry performance

## Behavior

The verified account's mounted StudyPanel retains its server snapshot. The initial start request controls first-load availability; account synchronization runs independently and cannot keep the answer buttons disabled after that snapshot arrives. Reopening within 30 seconds of an accepted snapshot reuses it immediately. Older snapshots refresh in the background without acquiring the answer mutation lock. Every re-entry still requests a server presentation token; a version conflict refreshes the state and retries presentation once.

Vocabulary merge events request a background plan refresh. Local vocabulary changes debounce a vocabulary sync and refresh after it completes, including push-only updates. Pending answers keep their original request ID and block background replacement until saved or resolved. A recovered pending answer can still load its initial snapshot. Shanghai-day changes retain their existing mandatory plan refresh.

Background reads carry an authority epoch. Starting/finishing mutations and accepting a newer foreground snapshot invalidate older reads; invalidated reads are retried after pending writes settle. Settings merge only their returned settings into the latest snapshot. Server authorization, version/presentation checks, FSRS scheduling, review priority, rewards and Anki records are unchanged.

The implementation cumulatively retains accepted release `20261013T063535`'s durable answer outbox, cross-tab reconciliation, Shanghai-day recovery and compact database entry projection. Pending answers hide only their own cards; they do not prevent the initial snapshot from loading. Whichever authoritative response first supplies a complete snapshot ends the initial wait, including an outbox confirmation that beats `start`. A late initial request cannot clear a later foreground operation's busy state. Subsequent background replacement still waits for pending answers to settle. Legacy session answers migrate without changing their ids.

Within a single prepare/start request, reconciliation returns its already-read vocabulary to the final snapshot. Cards and settings are still reread after the plan operation to observe concurrent device changes. There is no shared account cache or database migration.

The notebook has three local display orders in its upper-right controls: 收藏顺序 (default, original `createdAt`, oldest first), 字母 A–Z (case-insensitive English collation), and 随机 (reshuffle on every click). With at least two visible entries each shuffle changes their order, including filtered lists. Sorting never fetches a snapshot or changes saved records, Anki data or FSRS queues. New words append to an existing random order. Memoized rows retain per-entry reveal state and avoid rebuilding their contents during reordering; the notebook does not rerender on each parent timer tick.

Lists above 100 entries render only the viewport and an eight-row overscan through the existing virtualizer dependency. Every rendered row is measured at its real height, including long meanings, masking and viewport changes. The existing dialog remains the scroll container; list semantics expose the total count and each row's position. Smaller lists use normal flow. The 2,000-entry browser comparison went from 513 ms for a full-DOM production reorder to 62 ms with measured rows in development; final production evidence is recorded separately below.

The repeated development run measured 68 ms and passed a 35-row keyboard traversal beyond the original mounted range, search for an unmounted word, long-meaning mobile geometry, final-row reachability and detail-close focus return. StudyDialog explicitly restores its connected opener without changing the scroll position on unmount.

The final production build measured first enabled controls at 974 ms, warm re-entry at 21 ms with zero start requests, and the 2,000-entry random action at 48 ms (including the click and two animation frames). All race, keyboard, search, masking, variable-height mobile, final-row and focus-return checks passed with zero page errors. These use controlled synthetic API delays; they are not a real-account or every-device latency guarantee.

## Measurements and verification

Read-only production baseline on 2026-10-13, release `20261013T031701`: the largest vocabulary contained 1,724 entries. The start read stages used 29 internal REST calls and 16.8 MB, excluding authentication and the write RPC. Its browser snapshot was 4.07 MB JSON, approximately 946 KB gzip. Three read-only samples took 496 / 4,232 / 1,975 ms; these are variable server observations, not a fixed latency promise.

The browser comparison uses the actual page with synthetic APIs: first start delayed 500 ms, account sync delayed 5 seconds, subsequent starts delayed 2.5 seconds. Baseline enabled the first card after 5,017 ms and re-entry after 2,524 ms. Updated measurements were 733 ms and 48 ms respectively, with no start request on warm re-entry. Exact measurements and race results are in `docs/evidence/study-entry-1013/`. These controlled timings isolate UI blocking; physical-device/network latency can differ.

`scripts/study-entry-performance.mjs` covers warm re-entry, 390px layout, review during a delayed stale response, new-word sync invalidation, version/deleted-card conflict recovery, failed background reads, pending-answer recovery, all three display orders, repeated keyboard shuffle, masking identity and actual 2,000-row DOM reordering. `tests/study-entry-loading.test.ts` exercises the actual route/store against a 1,200-entry paginated fixture: vocabulary reads decrease from six pages to three while the final card versions stay fresh. `tests/study-vocabulary-order.test.ts` checks original timestamps, stable ties, repeated permutations and 10,000 unique entries. All 56 study/lookup/UI-design regressions, 90 critical regressions, nine release contracts and the egress guard passed. No model generation is involved.

The older `study-refinement-browser.mjs` passes its source-return and settings scenarios, then fails its outdated `flourish` button selector in the vocabulary masking check on both baseline production and this implementation. This is not claimed as a passing full suite. The dedicated entry/race browser script passes with no page errors.

First navigation still requires account verification, code download and a server snapshot. Large initial snapshots remain a future opportunity for versioned entry deltas; removing saved detailed explanations is not an acceptable shortcut.

## Release status

Candidate `20261013T144700` from source `45003613286324096020e05c332db8523285bc5c` was rejected before cutover because a concurrent accepted release advanced the parent from `20261013T031701` to `20261013T063535` (source `c95525c24986fb1c48ff11240a8f14fa9d7db636`). The new accepted source was merged explicitly; no manifest parent was edited to bypass the guard. The merged implementation passed 71 targeted tests, 90 critical regressions, nine release contracts and the full controlled browser checks, including initial recovery while an outbox write is held. The inverse race, an outbox snapshot arriving before a held initial start, also passes the real React regression.

Implementation and controlled validation are complete; production acceptance is pending exact public release identity and operations verification. Automatic approval review rejected temporary QA-account creation (`blocked by policy`); no account was created or changed. Live new-answer writes using a real account therefore remain unverified. Mocked browser behavior and real route/store fixtures are distinct from that missing check.
