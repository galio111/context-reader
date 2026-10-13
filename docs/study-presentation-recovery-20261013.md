# Study presentation recovery

Candidate based on accepted release `20261013T230800` (`1f2205985a9f0cc1b4f470555b9cfd109a7a88e1`). Production verification pending.

The presentation API previously collapsed all queue rejections into a generic 409. The client refreshed once while retaining the rejected card, so a newly due learning step could repeatedly block a displayed review. Normal queue changes surfaced as an unexplained red error.

Presentation rejections now carry `presentation_changed`. Refresh clears the rejected display pin and selects from the authoritative queue. Repeated transitions and transient presentation transport failures retry with a 750 ms to 15 s backoff; timers are cancelled on effect cleanup. Account authorization failures remain actionable. Valid displayed questions remain stable, and no recovery path creates an answer or bypasses version/token checks.

Read-only production inspection found all 1,724 gggg cards. The 23:18:06 answer exists; a prior learning step became due at 23:18:04. This supports the reproduced timing race, though the old endpoint did not preserve the specific original rejection reason. No real account records were changed.

Regression coverage includes a newly due higher-priority card, two consecutive presentation conflicts without alerts, recovery to an enabled answer control, no invented review, all six RPC rejection conditions, and existing durable save/duplicate/refresh tests.

Local validation: 62 Study tests, 139 architecture tests, 90 critical tests and release contracts passed. Release safety passed with two Windows symlink-capability skips; Linux CI exercises those paths. Final production build and public acceptance evidence will be recorded after cutover.
