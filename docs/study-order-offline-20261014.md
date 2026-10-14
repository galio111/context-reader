# Study order, offline journal and consistent counts

## Status

Accepted production `20261014T111000`, parent `20261013T233500`, source `9218f41dc8d34e8466d2dff72badd5a796ffbc49`, at 2026-10-14 03:10:04 UTC. Public connectivity, accepted state and the stable locked entrypoint agree. Exact reviewed delta: 36 files. Later documentation commits do not change the deployed source identity. No gggg learning data was edited for diagnosis or tests.

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
- Local/server builds, 11 release contracts, nine release-safety tests and exact-source [CI](https://github.com/galio111/context-reader/actions/runs/38504301456) passed.
- Public API tests with a temporary account passed protocol-2 vocabulary sync, duplicate retry, undo, settings, export and authorization boundaries. Receipt: 1,767 bytes / 104 ms; duplicate: 97 ms. The temporary account was removed.
- Real Chrome with a separate temporary account and no API mocks passed actual offline answer/undo, stable restored card, no network warning, reconnect persistence, offline settings/reload and export. Three original events persisted; zero page errors. The temporary account was removed.
- Controlled deployed UI passed desktop/390px reduced motion, default/mixed ordering, interval changes, offline old-old-new, undo, reconnect and reload. The old page held across cutover opened Reader with unchanged document timeOrigin and no failed static assets; that reading fixture intercepted business APIs.
- Recovery Admin read-only session/models/study/accounts returned 200. Seven-service health passed; five backend identities and start times remained unchanged. Only app/caddy recreated.
- Backup `20261014T031213Z` passed SHA verification and isolated 40-table restore. Current and direct-parent rollback images are available. Standard image retention completed; root disk is 71%.
- Local evidence is under `artifacts/study-order-release-20261014/` in the shared repository. Physical devices, other browsers and final user visual acceptance remain open.

## Recovery

Migration `docs/study-offline-v1-migration.sql` is additive; old v3 RPCs remain. Rolling back the app must retain `study_local_events` and local IndexedDB journals. Do not delete queued events or reset imported progress. Pending offline events require a compatible app to resume. Physical-device and user visual acceptance remain open.
