# Daily due reconciliation

Status: accepted production `20261017T123000`, parent `20261016T161500`, exact source `a5d699e43a162033641d99b33bd2da63313f0847`, accepted at 2026-10-17 04:34:24 UTC. Public connectivity and server accepted state agree. Later documentation commits do not change the shipped source.

The old graph mixed whole-day forecasts with a fixed plan built from exact timestamps and a daily cap. Read-only gggg reconstruction found 96 remaining + 97 next-day due = 193, but only 156 included, excluding 37 evening cards. This release uses Shanghai-day inventory and uncapped daily Review membership; short learning steps retain their timing. Tomorrow shows tomorrow-only due words; overdue words appear today. With no intervening answers or collection changes, tomorrow remaining equals today's unfinished plus tomorrow due. FSRS answers can legitimately change the forecast.

No card or history migration. Additive RPCs only; existing plan IDs are unioned when read/started. Legacy settings remain stored. Old RPCs and the parent image remain available for rollback. Do not replay migrations that change old RPC definitions.

Validation: 77 study tests, 90 critical regressions, release contracts, production build; isolated SQL verifies plan-only repair, evening readiness, exact short steps, next-day rejection, idempotent offline save, exact undo and role restrictions. Controlled Chrome desktop/390px reduced-motion checks exercise evening reviews, forecast, mixed ordering, offline answers, undo and reconnect without page errors. Backups and public acceptance recorded after cutover.

References: https://docs.ankiweb.net/stats.html#future-due and https://docs.ankiweb.net/deck-options.html#maximum-reviewsday distinguish due inventory from workload limits. This product follows the requested full inventory rather than concealing debt behind a workload cap.

## Acceptance evidence

- gggg after plan repair: 156 due today = 156 in today's plan; 55 due tomorrow. Old plan gained the 37 missing evening cards. Under unchanged scheduling, 156 unfinished + 55 due becomes 211 next day. Figures are an acceptance snapshot, not fixed product numbers.
- The additive migration transaction checked complete row digests for every study card, review and daily plan: unchanged. Account repair held the account advisory lock and verified all gggg card rows and review ledger rows remained byte-equivalent; only current plan membership was repaired. No real-account test answers.
- Public real QA verified evening Review presentation and saved receipt, lost-response duplicate idempotence, all three learning categories, account/sync, offline event/undo/export, anonymous rejection and ordinary-user Admin denial. Temporary QA accounts removed. The older receipt helper initially failed to delete its QA account because of a signup billing-grant FK; exact-account cleanup and helper correction completed, then the full acceptance reran successfully. No real billing rows were touched.
- Public controlled Chrome browser repeated desktop, 390px reduced-motion, evening review and forecast, mixed ordering, offline save/undo/reconnect with zero page errors. These use isolated mocked study data; actual authenticated APIs were separately tested above. Physical-device/Safari acceptance is not claimed.
- Recovery Admin checks and health passed. Parent accepted image exists. All five backend container start times are unchanged; only app/caddy recreated. SHA-verified isolated 40-table backup restore passed before release; post-release SHA-verified 40-table restore also passed; see post-restore-and-state.log.
- Evidence retained locally under `artifacts/study-day-release-1017/`: connectivity.json, migration.log, account-plan-verification.log, public-receipt.json, public-offline.json, browser-local/, browser-public/, operations.log and backend-before/after.txt. Build/test logs are `artifacts/study-day-*.log`.
