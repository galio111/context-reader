# Reading runtime refactor: implementation evidence

Status: implementation and local verification complete; integration build, independent browser review and production acceptance belong to the release coordinator. This report does not claim deployment or whole-site performance improvements.

Baseline: accepted release `20261012T135500`, source `4d0d91106087951d8d4271b46a328c0908f869d3`.

## Boundaries

- `lib/readerDocumentModel.ts` compiles the existing imported/plain article representation and owns document-scoped token reuse and derived lookup/source indexes. `ReaderView` retains UI, gestures, editing, history and viewport lifecycle. Every JSX node and all CSS stay unchanged. Token identities, paragraph numbering, explicit blank paragraphs, inline superscript/subscript, table cells, image captions and disabled OCR semantics match the accepted source.
- `lib/translationCacheRepository.ts` owns full-article and block cache access. Production `LearningStorage` reads only requested records and writes one bucket delta through `updateRecords`. The facade in `lib/cache.ts`, bucket names, body-sensitive block identities, sync notifications, legacy `Storage` JSON format, account archives and IndexedDB schema remain compatible. No secondary in-memory account cache is introduced.
- `lib/articleTranslationTransport.ts` owns streaming, retries, countdown and reader cleanup; `lib/articleTranslationProgress.ts` owns ordered progress accumulation. `articleTranslationJobs.ts` coordinates billing, public-cache replay and persistent progress. A streamed item updates the existing progress map and looks up its source block in constant time, without rebuilding an article-wide block map per item.
- Runtime translation jobs and subscriptions are owner-scoped. Owner changes cancel/discard prior jobs immediately; generation/owner guards reject late stream chunks and delayed `/start` responses. Cancellation during `/start` records intent, waits for its confirmed action id and settles once. Switching a panel or unmounting a subscriber continues the job as before. Regeneration preserves previous visible translations until replacements arrive.
- `components/useReaderTranslationSession.ts` binds a mounted Reader to the prepared storage owner and the account identity together. Login may complete without remounting Reader, so storage-owner events rebind the job subscription. Either ordering of account-context and storage preparation is supported; mismatches display no private translations. Prior translations remain available as stale content only across edits within the same owner. Owner transitions, including an A → B → A transition inside one React batch, discard the old display state.

The server APIs, provider selection/fallback, billing schema, publishing workflow, images/quality/motion and homepage are unchanged. This is a bounded rewrite of core runtime responsibilities, not a claim that every application module has been rewritten. `ReaderView` remains substantial; future extractions still need their own preservation evidence.

## Public interfaces and change ownership

| Interface | Responsibility | Must remain outside this layer |
| --- | --- | --- |
| `createReaderDocumentModel(article, imported, imageOcr, tokenCache, ocrEnabled)` | Compile document blocks and stable token/source indexes; retain only active token-cache keys | React state, layout, storage, network and account authorization |
| `createTranslationCacheRepository(storage, changed)` | Read/write/delete full-article or block records with existing content keys and mutation notifications | Rendering, provider requests, billing or a second account cache |
| `LearningStorage.updateRecords(bucket, values, deleteIds)` | Apply one bucket delta through the existing persistence/owner checks | Translation identity, account selection and feature-specific interpretation |
| `requestArticleTranslation(blocks, signal, contextBlocks, actionId, onRetry, onTranslation)` | Transport the already-authorized action; retry missing blocks and release stream resources | Starting/settling usage, cache writes, React state or provider-policy changes |
| `createArticleTranslationProgress(blocks, initial)` | Maintain ordered immutable snapshots and constant-time replacement/index lookups | Storage, timers, network or UI |
| `startArticleTranslationJob` / snapshot / subscription | Coordinate the existing action lifecycle, owner isolation, durable progress and cache publication | Component layout or account authentication decisions |
| `useReaderTranslationSession(key, blocks, expectedOwner)` | Subscribe the mounted view to its ready owner's job and cache; preserve same-owner edit state | Starting paid work automatically or canceling a job when a tool panel changes |
| Vocabulary repository read/write interfaces | Decode, normalize and detach owner-specific persisted snapshots behind the existing vocabulary facade | Reader/Study rendering, vocabulary domain actions or transport policy |

`tests/architecture-boundaries.test.ts` guards the direct import edges of these layers, pure model/progress effects, and the complete reachable internal static runtime dependency graph (including re-exports) for cycles or reverse edges into Reader/routes. Type-only dependencies and third-party package internals are excluded; this does not claim that the entire pre-existing application is cycle-free. The checks deliberately force a dependency decision to be reviewed when a future change adds an edge; they complement behavior tests rather than proving correctness by file layout. Existing facades and type contracts remain the supported entry points, so a view edit does not require edits to persistence or provider transport.

The direction is UI → session/task orchestration → transport/progress/repositories → shared data utilities. Changing an allowed dependency requires reviewing its responsibility and behavior contract; moving an effect into a helper does not justify bypassing the boundary. A future visual change should not require edits to persistent record representation or provider request handling.

## Reproducible checks

```powershell
npm.cmd run test:architecture
node --import tsx scripts/benchmark-architecture-runtime.mjs 4d0d91106087951d8d4271b46a328c0908f869d3
npm.cmd run test:critical
node_modules/.bin/tsx.cmd --test tests/architecture-runtime.test.ts tests/translation-job-ownership.test.ts tests/translation-background.test.ts tests/article-translation-batching.test.ts
node_modules/.bin/tsx.cmd --test tests/reader-translation-session.test.tsx tests/architecture-boundaries.test.ts
node_modules/.bin/tsc.cmd --noEmit --incremental false
```

`test:architecture` uses the repository's server-context test loader and runs dependency guards, mixed Reader content, detached vocabulary snapshots, cache compatibility, translation cancellation/late-response ownership, mounted Reader login, background tasks, IndexedDB recovery, sync, logout, account isolation and the critical suite. It has no browser-runtime installation or machine-specific path requirement. Feature-specific CET/media/loading/provider suites and release checks remain required when affected.

For independent document compatibility, `node --import tsx scripts/audit-reader-document-model.ts` executes the accepted baseline expressions and compares mixed content, blank lines, table/caption/inline offsets and source indices. UI review uses the identical before/after browser fixture and `node scripts/audit-architecture-visuals.mjs`; the explicitly recorded baseline may be updated only after accepting a release with evidence.

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

Local critical suite: 90/90 passed. Focused runtime/ownership/background/batching suite: 12/12 passed. Mounted React login/account-switch regression: 1/1 passed. Import-boundary guards: 2/2 passed. TypeScript `--noEmit --incremental false` passed. Final independent review, whole-app build, deployed signed-in smoke and physical-device/user acceptance must be recorded separately. Account-storage preparation and archive transitions remain owned by `accountSyncClient`; its asynchronous transition boundary must be reviewed independently of the mounted-view hook.
