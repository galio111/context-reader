# Daily review budget

Status: implemented; production verification pending. Parent: `20261026T204500` / `b70a1b4db87562c72303a5191af4751c3a072e06`.

Default 40 distinct old words per Shanghai day; repeated attempts stay within the same word slot. Existing new-word order remains unchanged. Settings allow 1–300; the learner can explicitly add ten for today. Done means the selected old words have completed their required steps, not merely been shown. The completion surface offers reading or continuing new words; backlog is in collapsed details.

Selection preserves existing budget membership and all old words answered today, even after undo. On a new day, one fifth of vacant slots goes to oldest due words, the rest to lowest FSRS retrievability. This avoids purely random debt handling while preserving some oldest-word service. It is a policy heuristic, not a proof of optimal recall. Finite budgets cannot preserve identical retention for unlimited vocabulary growth. Due dates, stability, difficulty, versions and reviews are never rewritten by planning. Raw forecasts still describe due inventory, not a predicted 40-word schedule.

Previously begun Learning/Relearning count as old words, but reward new_ids classification is preserved independently. Actual introductions in the day's ledger determine which repeats remain new. Lowering the budget after more words were already answered preserves those answers and admits no additional old words. Extra expires at Shanghai midnight. A disconnected device with independently changed plans can contribute additional already-completed words when it reconnects; history wins over dropping answers to enforce a number.

Pre-release gggg snapshot (2026-10-27 23:30 Shanghai): 1,742 cards, 353 ready old words, 1,021 untouched new words; selection chose 40 old words and left 313 old words waiting without changing any card memory. Counts will change with real time and actual answers. No gggg answers are fabricated for acceptance.

Validation: 86 existing+budget study tests and 90 critical regressions passed before final refinements; production build passed. Isolated PostgreSQL test verifies legacy-plan reduction, forty saved answers, duplicate-safe extra settings, budget reduction preserving history, and revoked browser-role RPC privileges. Final results are recorded below after public acceptance.

Rollback: old app and RPC names remain. The additive budget RPC can remain installed during rollback. No destructive schema or history migration is required.
