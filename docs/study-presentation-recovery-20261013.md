# Study presentation recovery

Production accepted `20261013T233500`, parent `20261013T230800`, source `4ed49a47f7d891cc73bb3fdb94d1301b92979113`. Public connectivity and stable server state agree.

The presentation API previously collapsed all queue rejections into a generic 409. The client refreshed once while retaining the rejected card, so a newly due learning step could repeatedly block a displayed review. Normal queue changes surfaced as an unexplained red error.

Presentation rejections now carry `presentation_changed`. Refresh clears the rejected display pin and selects from the authoritative queue. Repeated transitions and transient presentation transport failures retry with a 750 ms to 15 s backoff; timers are cancelled on effect cleanup. Account authorization failures remain actionable. Valid displayed questions remain stable, and no recovery path creates an answer or bypasses version/token checks.

Read-only production inspection found all 1,724 gggg cards. The 23:18:06 answer exists; a prior learning step became due at 23:18:04. This supports the reproduced timing race, though the old endpoint did not preserve the specific original rejection reason. No real account records were changed.

Regression coverage includes a newly due higher-priority card, two consecutive presentation conflicts without alerts, recovery to an enabled answer control, no invented review, all six RPC rejection conditions, and existing durable save/duplicate/refresh tests.

Local validation: 62 Study tests, 139 architecture tests, 90 critical tests and release contracts passed. Release safety passed with two Windows symlink-capability skips; Linux CI exercises those paths. Production builds and exact-source [CI](https://github.com/galio111/context-reader/actions/runs/38423038943) passed.

Chrome at 1440px with keyboard and 390px with reduced motion recovered after two consecutive presentation rejections, enabled the answer control, and produced no alerts, page errors or fabricated answers. These used isolated browser contexts with controlled API fixtures. Public HTTPS acceptance separately verified real learning-priority/not-due rejections, unchanged memory, three committed answers, duplicate idempotence, refresh durability, new-word counts, account sync and Admin/anonymous authorization boundaries. The temporary QA account was removed. Receipt times of 80–88 ms were measured from the production host, not the user's network.

Seven-service health passed. Backup `context-reader-20261013T083905Z.dump` passed checksum and isolated 39-public-table restore. Current and parent accepted images exist; all five backend start times are unchanged. Only app/caddy restarted. Evidence is in `docs/evidence/study-presentation-1013/`. Existing open pages need one reload to receive this client update. Physical-device and user acceptance remain separate gates.
