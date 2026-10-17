# Daily due reconciliation

Status: candidate, not yet accepted. Parent `20261016T161500`, source parent `8a2693a3c2c9492b3ac72021a01dddf5c414af5b`.

The old graph mixed whole-day forecasts with a fixed plan built from exact timestamps and a daily cap. Read-only gggg reconstruction found 96 remaining + 97 next-day due = 193, but only 156 included, excluding 37 evening cards. This release uses Shanghai-day inventory and uncapped daily Review membership; short learning steps retain their timing. Tomorrow shows tomorrow-only due words; overdue words appear today. With no intervening answers or collection changes, tomorrow remaining equals today's unfinished plus tomorrow due. FSRS answers can legitimately change the forecast.

No card or history migration. Additive RPCs only; existing plan IDs are unioned when read/started. Legacy settings remain stored. Old RPCs and the parent image remain available for rollback. Do not replay migrations that change old RPC definitions.

Validation: 77 study tests, 90 critical regressions, release contracts, production build; isolated SQL verifies plan-only repair, evening readiness, exact short steps, next-day rejection, idempotent offline save, exact undo and role restrictions. Controlled Chrome desktop/390px reduced-motion checks exercise evening reviews, forecast, mixed ordering, offline answers, undo and reconnect without page errors. Backups and public acceptance recorded after cutover.

References: https://docs.ankiweb.net/stats.html#future-due and https://docs.ankiweb.net/deck-options.html#maximum-reviewsday distinguish due inventory from workload limits. This product follows the requested full inventory rather than concealing debt behind a workload cap.
