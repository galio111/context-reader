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

Six separate independent persistence/translation tests found **three existing actionable races or isolation failures**: an aborted old translation response can overwrite durable cache after successful forced regeneration; a completed job snapshot remains visible when another account opens the same article key; and an A→B→A owner change can revive a pending old response. The other three tests (legacy migration/cold reopen/removal, detached ordered block-cache identity, failed regeneration preserving completed translations) passed. All three failures are preserved as baseline regression tests and must pass in the candidate.

## Acceptance matrix

| Surface | Required compatibility | Independent evidence / boundary |
| --- | --- | --- |
| Reader model | Plain paragraphs, blank lines, headings, lists, quotes, images/captions, tables, inline superscript/subscript, exact token IDs/context and source indexing | Independent baseline-expression differential: 4 cases passed; implementation oracle independently rerun: 22 documents and 264 JSX nodes unchanged |
| Reader interaction/UI | Same markup, text, layout, day/night, desktop/mobile, nearby token hydration and return position | 432-paragraph fixture, matched screenshots/DOM geometry; final continuous matrix recorded below |
| Contextual lookup | Correct original word/sentence context, streamed fields, sentence translation, follow-up and one-charge provider fallback | Existing critical/provider tests; live signed-in smoke belongs to release coordinator |
| Standalone dictionary | History replay only, no cache-miss regeneration, POS/IPA grouping, audio preservation | Existing history/replay/pronunciation tests; lexical listening remains a human boundary |
| Translation | Explicit start, complete source blocks, background continuation, progressive ordering, retained cache on failure, no stale-force overwrite | Existing batching/background tests and six independent tests; mounted guest-login/account-switch browser; live billing/provider smoke belongs to release coordinator |
| Storage/sync | Exact keys and record formats, legacy migration, cold reopen, deletion, account boundaries, lost-write recovery, unrelated data preserved | IndexedDB/sync/account suites plus independent cache tests |
| Vocabulary/study | IDs, creation times, imported Anki data, scheduler behavior, review/rewards and source jumps | Existing scheduler/profile/CET/account tests plus candidate vocabulary review |
| CET | All activity/history/formatting/timer/scoring/listening/selection contracts | Existing CET suites; physical listening/device acceptance is separate |
| Homepage/media | Real SSR inventory, category/filter/order, entry/return, original covers and protected animation | Existing media/loading/discovery tests; no visual redesign authorized |
| Account/Admin/security | Same routes, authorization, quotas, sync protocol, internal backend, private Admin data | Existing critical/contracts; production read-only boundary checks and signed-in release smoke |
| Deployment | Clean cumulative source, exact parent/release, public connectivity, health, backup/rollback evidence | Release coordinator; not established by this audit's build |
| Performance | Measurable improvement in changed hot paths without quality or feature sacrifice | Repeated controlled before/after experiments; no claim of universal website speedup |

## Reproducible commands and evidence

`scripts/architecture-equivalence-browser.mjs` accepts `AUDIT_BASE`, `AUDIT_OUTPUT` and `PLAYWRIGHT_PACKAGE`. It blocks service workers and mocks all API calls. It records screenshots, requested API paths, uncaught errors, block text/tag/heights and token counts. The extended fixture clicks a real Reader token and checks its exact word, source sentence and both neighboring sentences. Desktop additionally edits the real contentEditable canvas, saves, reopens editing, undoes and redoes across the save, and preserves blank paragraphs. Browser timings are diagnostic only unless the same compiled environment and workload are compared.

`scripts/audit-reader-document-model.ts` evaluates the actual old Reader `useMemo` initializers from the accepted Git source, compares all renderable blocks/token indexes with the candidate, and asserts that every Reader JSX root has identical syntax. Fixtures include mixed block kinds, legacy image/OCR metadata, tables, inline superscript/subscript, explicit blank paragraphs, source sentence duplicates, edited/reordered blocks and a document above the old 400-block cache threshold. `scripts/audit-architecture-visuals.mjs` compares same-machine baseline/candidate DOM geometry and decoded screenshot pixels; Reader start/middle/return requires exact zero-pixel differences.

Raw local evidence is under `artifacts/architecture-audit/`: `baseline-tests.log`, `baseline-build.log`, `baseline-translation-independent.log`, `baseline-browser/`, and the same-fixture localhost baseline/candidate directories. These artifacts contain synthetic test data and must be retained separately before removing the worktree.

No statement here establishes whole-site mathematical equivalence or physical-device/user visual acceptance. Deployment acceptance belongs to the release coordinator and must include the public release/parent identity.

## Independent candidate findings

The account-transition candidate at audit source `874f8316d1bf2894c4d3f27669d24a06244e659f` passed its own production build. Its full Node inventory produced **487 tests, 482 pass, the exact same 5 baseline failures, 0 skip**. The additional tests passed; the old failures were not edited away. The subsequent static-loading fix requires the final supplemental evidence below.

The audit caught and required fixes for the three independently reproduced baseline translation races, a new mounted-Reader login subscription regression, and the asynchronous archive/restore interval where the persisted owner still names the previous account. Source review and runtime tests verify cancellation before archive waits, no new jobs during preparation, delayed `/start` settlement using the actual server action id, no old stream writes after force/account replacement, and clearing subscriptions/display on owner changes. The full browser script uses the real AccountProvider, Reader and translation controls with mocked network: guest → login A → refresh account B retains the same Reader mount, clears A's translation and displays B's new result. It passed without page errors; the baseline leaves A's result visible after the account switch.

An initial fourth cold-browser scenario failed with a stylesheet MIME error and an uncaught `Event`. This failure was retained and investigated, not suppressed. Native HTTP requests without Playwright interception proved the old Brotli rewrite shared the ordinary API limiter: the 121st stylesheet request in a minute returned HTTP 429 and JSON `site_rate_limit`. This explains the earlier baseline static-chunk failures as well. The release includes a bounded separate static-read budget; the real HTTP and repeated browser checks below are required before acceptance.

The dependency guard preserves the implementation's direct import contracts and independently adds vocabulary persistence, pure model/progress effects and traversal of all reachable internal static import/re-export edges. No cycles or reverse dependency into Reader/routes were found. Type-only and third-party internals are outside this graph. `npm run test:architecture` is the executable command for future changes; it uses the server-context loader and combines boundaries with observable persistence, ownership, recovery and critical regressions.

## Independent performance measurements

The same audit worktree reran both baseline and candidate implementations. These are controlled CPU measurements, not claims about whole-site or provider/network latency.

| Work | Before | After |
| --- | ---: | ---: |
| Read 1,500 vocabulary entries, median over 60 warm reads | 17.355 ms | 0.241 ms |
| Vocabulary warm-read p95 | 20.173 ms | 0.463 ms |
| Compile 600 Reader blocks | 39.456 ms | 19.943 ms |
| Refresh 600 Reader blocks with the same document cache | 38.268 ms | 9.988 ms |
| Compile 1,200 Reader blocks | 83.159 ms | 41.179 ms |
| Refresh 1,200 Reader blocks | 80.184 ms | 17.802 ms |
| 50 single-block translation reads among 5,001 records | 114.019 ms | 0.062 ms |
| One changed-block translation write among 5,001 records | 17.049 ms | 0.010 ms |

The changes preserve the record keys and stored shapes. Snapshot mutation, raw sync replacement, account switch, storage adapter replacement, IndexedDB reopen and historical Anki fields are covered by behavior tests. Tests also confirm that individual translation operations do not reconstruct unrelated stored history.

## Final release-candidate acceptance

The audit candidate including the static-loading correction is source `09df553bc8cf66e2ccdaa9f99a4a91da5f73e9d8`. The independent complete inventory rerun produced **493 tests, 488 pass, 5 fail, 0 skip** in 155.43 seconds. All five failures are the exact baseline failures listed above; 35 added tests pass. The separate static limit/encoding run passed 8/8, and all nine release contracts passed. The independent final production build passed (141 precompressed assets; 5,783,986 raw bytes; 1,485,782 Brotli bytes).

`scripts/audit-static-loading.mjs` uses native HTTP against a fresh local production server, without browser request mocks. All 240 Brotli CSS responses were HTTP 200 with correct MIME, immutable cache and security headers. The next 120 ordinary missing API reads retained their normal 404 response, request 121 was still HTTP 429 with limit 120, and another CSS read remained HTTP 200 after the API allowance was exhausted. Unit tests independently retain the 600/minute static ceiling and existing AI/Auth/Admin limits. The script rejects non-local targets so this load probe cannot accidentally target production.

The four-scenario browser matrix passed **twice consecutively (8/8)** on that same server after the HTTP probe, with **zero page errors and zero failed network requests**. All article block text, heights, token hydration and exact selected word/neighbor contexts match. Desktop edit → save → reopen → undo/redo and explicit blank paragraphs pass. Every screenshot waits for the final lookup example field, so normal-motion text reveal cannot be mistaken for a layout change. Guest login and account switch in the mounted Reader were rerun against this final build and passed.

Of the 22 final before/after screenshots, **21 have zero changed pixels**, including all Reader start/middle/return, contextual lookup, dictionary, mobile and reduced-motion captures. The desktop-day workbench differs at 2,656 pixels (0.1844%); inspecting the difference image shows only the existing infinite floating-letter animation at different frames. The second run again has 21 exact matches, with 2,329 workbench animation pixels differing (0.1617%). The earlier same-machine local baseline also matches all 12 Reader screenshots exactly. Actual desktop/mobile/day/night images were inspected, not just inferred from source. This preserves the existing UI; it does not claim user acceptance of every animation or physical-device interaction.

The original failing browser attempts and their MIME/429 diagnosis remain in the evidence, alongside the successful final runs. Stable lookup baseline screenshots use the accepted production source before deployment, with every API intercepted by the same synthetic fixture; the earlier localhost baseline provides independent exact Reader geometry/pixel confirmation. No production account or data was changed by these browser checks.

**Independent verdict:** no newly failing covered behavior, architectural boundary violation or unexplained UI difference remains in this candidate. The five pre-existing test failures remain explicit. Real provider billing, the signed-in public smoke, deployment identity and backup/rollback acceptance belong to the release coordinator. Cross-browser engines, physical mobile gestures, pronunciation listening, every permutation of the 121 documented scenarios and final human visual acceptance are not established by this audit.

Raw screenshots/logs and synthetic request traces are preserved outside the disposable worktree at `artifacts/architecture-audit-1012-independent/`. The key files are `candidate-release-tests.log`, `candidate-static-final-build.log`, `static-loading/result.json`, `baseline-stable-browser/result.json`, `candidate-stable-browser/result.json`, `candidate-stable-browser-repeat/result.json`, `visual-final/result.json`, `visual-repeat/result.json`, `candidate-reader-login-final/result.json` and the retained failed attempts. A compact machine-readable result is in `docs/architecture-refactor/evidence/independent-summary.json`.
