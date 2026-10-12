# Independent architecture equivalence audit — 2026-10-12

This review is performed in a separate worktree by the audit agent. Implementation-side claims are not acceptance evidence. The accepted production source is `4d0d91106087951d8d4271b46a328c0908f869d3`, release `20261012T135500`, parent `20261010T223500`. The audit preserves that source's actual behavior and current contracts, including retired Anki controls, retained historical Anki data, the current homepage, and current password policy.

## Baseline evidence

The complete existing Node test inventory was run with the repository's server-context loader and `tsx`, with file concurrency 3: **458 tests; 453 pass, 5 fail, 0 skip**. The command included all `tests/*.test.ts`, `.tsx`, and `.mjs`, including critical, CET, dictionary, provider fallback/billing, translation, media, loading, study, IndexedDB and account-sync suites.

The five pre-existing failures must never be described as newly passing or caused by this refactor:

| Test file | Exact test name | Baseline failure |
| --- | --- | --- |
| `capacity-regressions.test.ts` | compact catalogue preserves article identity, preference/category order and Admin originals | Expected preview data URL, actual `undefined` |
| `jev-calibration.test.ts` | mail exposes provider totals and subtraction without calling agreement ground truth accuracy | Old `¥0.3000` mail assertion does not match actual report |
| `model-routing.test.ts` | quantity cannot conceal a missing category while current affairs may exceed the old ceiling | Old supply-completion assertion |
| `quota-diagnostics.test.ts` | an exhausted pool takes precedence over a merely low pool | Old `查词与问答剩余 6 / 30` copy expectation, actual empty string |
| `quota-diagnostics.test.ts` | stream EOF with missing fields cannot finalize a quota reservation | Test VM does not define `performance` |

The baseline production build completed successfully. Static precompression reported 141 assets, 5,778,699 raw bytes and 1,484,368 Brotli bytes. These are build-artifact sizes, not a real-user page-speed measurement.

The independent browser fixture intercepts every API request, contains no real session or production writes, and exercises the actual production JavaScript and Reader UI. It imports a deterministic 432-paragraph article, scrolls to the middle, returns to the top, and checks stable block counts, no horizontal overflow and no uncaught page errors. Desktop also checks dictionary/import overlay order, Escape recovery and Reader return to the workbench. The matrix is 1440×1000 day, 390×844 day, 1440×1000 night/reduced-motion, and 390×844 night/reduced-motion. All four production-baseline scenarios passed. Day/night is asserted from the actual rendered theme, not inferred from the test name.

Separate independent persistence/translation tests found **one existing actionable race**: an aborted old translation response can arrive after a successful forced regeneration and overwrite durable cache with the old result while the job snapshot still displays the new result. The other three tests (legacy migration/cold reopen/removal, detached ordered block-cache identity, failed regeneration preserving completed translations) passed. The race is preserved as a failing baseline regression test and must pass in the candidate.

## Acceptance matrix

| Surface | Required compatibility | Independent evidence / boundary |
| --- | --- | --- |
| Reader model | Plain paragraphs, blank lines, headings, lists, quotes, images/captions, tables, inline superscript/subscript, exact token IDs/context and source indexing | Model differential tests plus browser long-article fixture; candidate pending |
| Reader interaction/UI | Same markup, text, layout, day/night, desktop/mobile, nearby token hydration and return position | Matched screenshots/DOM geometry across baseline and candidate; candidate pending |
| Contextual lookup | Correct original word/sentence context, streamed fields, sentence translation, follow-up and one-charge provider fallback | Existing critical/provider tests; live signed-in smoke belongs to release coordinator |
| Standalone dictionary | History replay only, no cache-miss regeneration, POS/IPA grouping, audio preservation | Existing history/replay/pronunciation tests; lexical listening remains a human boundary |
| Translation | Explicit start, complete source blocks, background continuation, progressive ordering, retained cache on failure, no stale-force overwrite | Existing batching/background tests and four independent tests; live billing/provider smoke belongs to release coordinator |
| Storage/sync | Exact keys and record formats, legacy migration, cold reopen, deletion, account boundaries, lost-write recovery, unrelated data preserved | IndexedDB/sync/account suites plus independent cache tests |
| Vocabulary/study | IDs, creation times, imported Anki data, scheduler behavior, review/rewards and source jumps | Existing scheduler/profile/CET/account tests plus candidate vocabulary review |
| CET | All activity/history/formatting/timer/scoring/listening/selection contracts | Existing CET suites; physical listening/device acceptance is separate |
| Homepage/media | Real SSR inventory, category/filter/order, entry/return, original covers and protected animation | Existing media/loading/discovery tests; no visual redesign authorized |
| Account/Admin/security | Same routes, authorization, quotas, sync protocol, internal backend, private Admin data | Existing critical/contracts; production read-only boundary checks and signed-in release smoke |
| Deployment | Clean cumulative source, exact parent/release, public connectivity, health, backup/rollback evidence | Release coordinator; not established by this audit's build |
| Performance | Measurable improvement in changed hot paths without quality or feature sacrifice | Repeated controlled before/after experiments; no claim of universal website speedup |

## Reproducible commands and evidence

`scripts/architecture-equivalence-browser.mjs` accepts `AUDIT_BASE`, `AUDIT_OUTPUT` and `PLAYWRIGHT_PACKAGE`. It blocks service workers and mocks all API calls. It records screenshots, requested API paths, uncaught errors, block text/tag/heights and token counts. Browser timings are diagnostic only unless the same compiled environment and workload are compared.

Raw local evidence is under `artifacts/architecture-audit/`: `baseline-tests.log`, `baseline-build.log`, `baseline-translation-independent.log`, `baseline-browser/`, and the same-fixture localhost baseline/candidate directories. These artifacts contain synthetic test data and must be retained separately before removing the worktree.

Status: baseline recorded; candidate review and deployment acceptance pending. No statement here establishes whole-site mathematical equivalence or physical-device/user visual acceptance.
