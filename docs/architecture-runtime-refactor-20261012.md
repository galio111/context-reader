# Reading runtime refactor: implementation evidence

Status: implementation and local verification complete; integration build, independent browser review and production acceptance belong to the release coordinator. This report does not claim deployment or whole-site performance improvements.

Baseline: accepted release `20261012T135500`, source `4d0d91106087951d8d4271b46a328c0908f869d3`.

## Boundaries

- `lib/readerDocumentModel.ts` compiles the existing imported/plain article representation and owns document-scoped token reuse and derived lookup/source indexes. `ReaderView` retains UI, gestures, editing, history and viewport lifecycle. Every JSX node and all CSS stay unchanged. Token identities, paragraph numbering, explicit blank paragraphs, inline superscript/subscript, table cells, image captions and disabled OCR semantics match the accepted source.
- `lib/translationCacheRepository.ts` owns full-article and block cache access. Production `LearningStorage` reads only requested records and writes one bucket delta through `updateRecords`. The facade in `lib/cache.ts`, bucket names, body-sensitive block identities, sync notifications, legacy `Storage` JSON format, account archives and IndexedDB schema remain compatible. No secondary in-memory account cache is introduced.
- `lib/articleTranslationTransport.ts` owns streaming, retries, countdown and reader cleanup; `lib/articleTranslationProgress.ts` owns ordered progress accumulation. `articleTranslationJobs.ts` coordinates billing, public-cache replay and persistent progress. A streamed item updates the existing progress map and looks up its source block in constant time, without rebuilding an article-wide block map per item.
- Runtime translation jobs and subscriptions are owner-scoped. Owner changes cancel/discard prior jobs immediately; generation/owner guards reject late stream chunks and delayed `/start` responses. Cancellation during `/start` records intent, waits for its confirmed action id and settles once. Switching a panel or unmounting a subscriber continues the job as before. Regeneration preserves previous visible translations until replacements arrive.

The server APIs, provider selection/fallback, billing schema, publishing workflow, images/quality/motion and homepage are unchanged. This is a bounded rewrite of core runtime responsibilities, not a claim that every application module has been rewritten. `ReaderView` remains substantial (4,749 → 4,542 lines); future extractions still need their own preservation evidence.

## Reproducible checks

```powershell
node --import tsx scripts/benchmark-architecture-runtime.mjs 4d0d91106087951d8d4271b46a328c0908f869d3
npm.cmd run test:critical
node_modules/.bin/tsx.cmd --test tests/architecture-runtime.test.ts tests/translation-job-ownership.test.ts tests/translation-background.test.ts tests/article-translation-batching.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
```

The benchmark extracts and executes the old compiler from the specified Git revision. It checks 22 mixed/plain/generated documents by deep equality across all pre-existing model fields and compares all 264 Reader JSX nodes verbatim. The oracle and raw results are written under ignored `artifacts/architecture-runtime/`.

The regression suite verifies mixed content/source-index equivalence, 600-block token reuse and pruning, same-id/changed-text cache misses, returned-value mutation isolation, JSON compatibility, 2,500 unrelated stored rows surviving individual writes/deletes and IndexedDB reopen, no whole-bucket reads on indexed hot paths, non-destructive progress replacement, split UTF-8/NDJSON streams and reader release. Job tests cover late old streams after force, a delayed start across A → B → A, delayed-start settlement using the server id, completed-job/subscriber isolation between accounts, and the existing background retry/one-action contract.

The two existing source-shape regression checks now inspect the extracted document/transport module for the original assertions and additionally verify that Reader/jobs call those modules. Assertions were moved with their implementation; they were not removed or relaxed.

## Local CPU measurements

Representative rerun on this Windows machine, median of 10 measured samples after 3 warmups. Each cold sample uses a new token cache; refresh samples reuse the document cache. These measurements exclude network, provider latency, React rendering and physical-device behavior.

| Work | Before | After |
| --- | ---: | ---: |
| 100-block document compilation | 5.436 ms | 2.629 ms |
| 100-block metadata refresh | 3.808 ms | 1.240 ms |
| 600-block document compilation | 34.021 ms | 16.978 ms |
| 600-block metadata refresh | 36.024 ms | 7.602 ms |
| 1,200-block document compilation | 83.575 ms | 39.858 ms |
| 1,200-block metadata refresh | 78.823 ms | 17.528 ms |
| 50 single-block reads with 5,001 historical translations | 116.066 ms | 0.077 ms |
| One changed-block write with the same history | 19.452 ms | 0.009 ms |

The history fixture has 637,827 serialized characters. The asymptotic change is the durable evidence: indexed block operations no longer reconstruct/parse/rewrite unrelated history; long documents no longer clear their own token cache at 400 blocks; repeated sentence normalization and separate token-array passes are consolidated.

Local critical suite: 90/90 passed. Focused runtime/ownership/background/batching suite: 12/12 passed. TypeScript `--noEmit --incremental false` passed. Final independent review, whole-app build, deployed signed-in smoke and physical-device/user acceptance must be recorded separately.
