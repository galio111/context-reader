# Study order, offline journal and consistent counts

## Status

Candidate based on accepted production `20261013T233500`, parent `20261013T230800`, source `4ed49a47f7d891cc73bb3fdb94d1301b92979113`. The first candidate 20261014T110000 was deliberately stopped before cutover after finding a daily-category projection mismatch; the correction counts first answers, prior learning and ordinary reviews exactly as study_daily_stats_v3. Production release identity and post-cutover evidence remain pending. No gggg learning data was edited for diagnosis or tests.

## Behavior

- Default review-first; optional mixed order defaults to five distinct completed old words per new word, configurable 1–100. Newly introduced words and their later steps never count toward the next interval. Undo reverses the contribution.
- Keep the displayed eligible card pinned while timers, local durable commits and background snapshots arrive. Wait for the answer journal to advance before selecting the next card.
- Today's forecast uses exactly the current plan's remaining non-new words, including short steps; repetitions count once. Future days remain estimates.
- Account-scoped IndexedDB snapshot and ordered immutable events enable offline answers, new study, timed steps, undo and settings. Online retry runs silently every 15 seconds and on reconnect. A lost response reuses the same event id. The server recomputes FSRS and commits under a per-account lock; browser roles cannot call the ledger RPC. Export includes original events.
- First use requires downloading the account snapshot. Undownloaded audio, new AI content, server rewards and authorization still require network. Storage failure remains visible. Full browser cache eviction and offline first navigation are not covered by the learning journal.

## Diagnosis

Read-only gggg snapshot on 2026-10-14: 93 ordinary reviews due now, 22 due later that Shanghai day outside the fixed current plan, six relearning cards. The previous chart counted 121 while the current plan had 99 remaining. Earlier screenshot 193/164 has not been reconstructed from historical state.

## Validation

- 68 Study tests passed, including offline reopen, lost response, exactly-once retry, account isolation, concurrent IndexedDB writes, failed local persistence, undo/timed arrival and mixed intervals.
- 139 architecture/account/reading regressions passed.
- Isolated `context_reader_study_1005` SQL transaction passed duplicate-event, id reuse, owner isolation, version conflict, undo and browser-role assertions; fixtures rolled back.
- Real compiled UI with controlled API fixture passed desktop settings, 390px reduced-motion layout, offline old-old-new sequence, stable undo, reconnect and reload. Screenshots and JSON: `artifacts/study-offline-browser` (local evidence only; not packaged).
- Final build, release contracts, exact-source CI, production API/browser checks, additive migration, health, backup restore and rollback evidence pending.

## Recovery

Migration `docs/study-offline-v1-migration.sql` is additive; old v3 RPCs remain. Rolling back the app must retain `study_local_events` and local IndexedDB journals. Do not delete queued events or reset imported progress. Pending offline events require a compatible app to resume. Physical-device and user visual acceptance remain open.
