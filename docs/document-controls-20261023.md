# Personal document reading recovery

Production was rolled back from `20261023T213500` to the previously accepted `20261023T185600` at 2026-10-23 13:53 UTC after the user reported blank pages across browsers. The retained image was restored under the deployment lock; only app/Caddy were recreated. The original files, saved articles and learning records were not deleted. An actual gggg Edge check subsequently opened the older 11-page SCM paper successfully (12.262 s cold opening). This restored readability, not the requested WPS-level performance.

The recovery source is deployed; release identity and remaining performance acceptance are recorded below. The user explicitly requires real-document opening, scrolling, zooming, reopening and selection to approach their same-device WPS experience. A passing build, API response or isolated screenshot is not that acceptance. Physical WPS equivalence has not been demonstrated by the automated browser measurements.

## Import and persistence

The supplied IJBM paper is a valid 19,687,887-byte, 16-page PDF. Production middleware had truncated uploads at its default 10 MiB boundary. The application, middleware and private bucket now agree on 50 MiB, with 500 PDF pages and one million extracted characters. The Storage service's existing global 50 MiB ceiling is unchanged. Larger sources still exceed this supported limit.

Its extracted text contains 11 NUL characters that PostgreSQL JSONB rejects. Document-only extraction, selection and server sync normalize NUL/unpaired surrogates while preserving valid scientific Unicode, CAS versions, owner protections and deletion tombstones. The source PDF is unchanged. gggg's pending article was accepted with HTTP 200/server version 1, and it is present in My Articles. Private source SHA-256 remains `2d53aca13095a8538b541b97934b7590346494e97b04cb0bc8b7ae1342d1c5e3`; owner range reads return 206 and anonymous reads 401.

## Reading changes

- Import completes local original caching before opening the reader. An owner-checked memory copy prevents a second download and survives PDF.js buffer transfer through defensive copies.
- The follow-up uses validated 1 MiB authenticated ranges, with parallel adjacent-header and tail-index reads. After first paint, two bounded background readers fill the original cache while visible pages share the same pending requests. It never starts a competing unbounded whole-file HTTP stream or eager PDF.js getData call. Read chunks persist; a complete reconstructed original makes later opening local. Failed required requests terminate instead of leaving PDF.js waiting indefinitely.
- Private cache storage is bounded to 1 GiB on disk and 128 MiB in memory. A small size index replaces repeated scans of all binary originals; cache version migration preserves existing bytes. Optional persistence failure does not discard the source or block reading.
- Versioned public PDF runtime, fonts and decoder assets use immutable HTTP caching. Private documents remain authenticated and are never placed in shared HTTP caches. The PDF worker response explicitly permits bundled WASM decoders while retaining the prohibition on JavaScript eval.
- Visibility observes a sized page section, not an empty zero-height paint host. The first page is eligible immediately. Page dimensions update on zoom even when distant pages are not being rendered.
- Completed canvases remain visible during zoom and scrolling. Both cloud and local papers up to 24 pages prepare bounded source canvases after the first page; distant pages avoid building selection DOM. Reading positions receive priority over queued preparation.
- The source canvas and PDF.js native text layer are separate. A prepared canvas that is already sharp enough is reused when selection becomes available; the same page is not rasterized again merely because it entered the viewport. Expensive upgrades wait while scrolling. Native text selection keeps word expansion, sentence-only translation above five words, and punctuation no-op behavior.
- Zoom controls pin at visual-viewport top (zero extra 80px offset). The horizontal control stays at the bottom of the visible document area, above the mobile dock and any open translation sheet. Highlight coordinates account for retained-frame scaling.

Ordinary pasted/URL articles retain their existing interaction behavior. Word retains its isolated frame and previously accepted Safari selection bridge. Original PDF images, vectors and annotation appearances remain source-rendered.

## Evidence and remaining acceptance

The earlier streaming candidate passed limited fixtures but still took 20.565 s in a public Chrome cold opening and 42.323 s in a later WebKit run. It did not satisfy the user's performance requirement and was rolled back after their reports. These timings must not be presented as a successful performance release.

Recovery regressions cover 160 architecture/document checks, cache migration, account boundaries, transferred buffers, overlapping range reads, repeated cache use and malformed range responses. Isolated Edge checks use both the original 1,788,008-byte SCM paper and the 19,687,887-byte IJBM paper. The large local import makes zero original downloads. Native source text was checked with Construction double-click, a partial-word drag expanding to the complete word, and the six-word selection Construction of double network hydrogels using producing translation-only output. Controls and mobile hit testing also cover an open translation sheet.

Development and production performance logs are separate; different instrumentation runs are not interchangeable benchmarks. Final production measurements, public verification, source CI, health and backup evidence are recorded below. Physical Mac Safari and direct WPS side-by-side comparison remain unperformed.

Production-build local fixtures: large-paper Edge first frame 2.550 s and WebKit 4.798 s with zero original re-downloads; all source pages prepared in 7.223/11.922 s. A separate authenticated-range fixture opened in 2.032 s and refreshed in 1.526 s with zero new ranges and no speculative whole-file transfer. These isolate rendering/cache behavior and exclude real upload/cloud latency. Scroll measurements vary with active translation UI and instrumentation; they do not establish native WPS parity.

## Production recovery: 20261023T231000

Deployed through the stable locked entrypoint at 2026-10-23 15:18 UTC. Public release 20261023T231000, parent 20261023T185600, source eb55b6d08f048c4e1810bf455ec9ee0ecbaa2d9b match the reviewed 33-file cumulative package. Source CI 39975346053, 160 architecture/document regressions, local/server builds and protected release contracts pass. Distant prepared canvases survive zoom without rasterization; rapid zoom clicks coalesce for 120 ms while the existing frame scales immediately. Bundled ICC profiles and scoped worker WASM CSP retain source color decoding.

Final local production-build large-paper checks: Edge first frame 2.422 s, WebKit 4.820 s, no original re-download. Exact double-click, partial-word completion, six-word translation-only behavior, retained distant canvases, floating controls and mobile sheet hit testing pass in both engines. The range fixture opened in 2.017 s and refreshed in 2.100 s, with zero new ranges and zero whole-file streaming. Scroll probes found no missing canvases; Edge p95 was 6.2 ms (maximum 42.3 ms), WebKit p95 73 ms (maximum 105 ms). Headless rAF measurements are diagnostic, not physical-device WPS equivalence.

Actual gggg public Edge checks opened both existing articles without reimport: 16-page IJBM cold 19.690 s / cached refresh 4.377 s; older 11-page SCM cold 17.627 s / cached refresh 2.313 s. Both refreshes issued zero new PDF ranges. Original/source boundary, immutable runtime headers, WASM CSP, zoom and mobile controls pass. These cold network timings remain too slow for the stated target; WPS-level performance acceptance is explicitly OPEN. The user confirmed the temporary rollback displayed pages but was still very laggy; the user subsequently rejected this recovery because cold opening and pages 4/5 still showed prolonged blank areas. Cloud-open pages had not received the local-original all-page preparation path. This remains an active incident. Physical Mac Safari and native WPS side-by-side remain untested.

Live contextual explanation, standalone dictionary and full translation returned Chinese output with HTTP 200; execution records prove successful deepseek-flash routing for all three. Source SHA-256/19,687,887-byte integrity remains unchanged. The five persistent backend container IDs are unchanged. Post-release health passes after removing only this release's unused, untagged builder/dependency images; disk use returned to 82%. Current and parent accepted images remain. Fresh backup context-reader-20261023T134747Z.dump passed SHA verification and isolated 40-table restore. The earlier rollback to 185600 was actually exercised. Evidence is retained outside Git in D:/codex_test/release-artifacts/document-controls-1023/evidence/recovery; private account/session data is excluded.


## Follow-up after pages 4/5 remained blank

User rejected the 231000 release with the actual 16-page IJBM paper: first-page wait and later pages 4/5 still blank. This exposed a test/implementation gap: all-page preparation was gated to full local originals, so cloud-open range documents remained lazy. The follow-up removes that condition, reduces serial round trips using 1 MiB ranges and header/tail prefetch, and fills the complete private original cache with two bounded workers after first paint. The original source, annotation appearances, selection and zoom behavior are preserved.

A temporary linearized-copy experiment reduced an artificial one-second-RTT cold opening only from 6.878 s to 6.307 s; it is not shipped or substituted for the original. The selected read-ahead implementation on the same source and artificial delay opens in 3.296 s, reaches page 4 in 253 ms and page 5 in 2.386 s, prepares all 16 pages by 11.396 s, and refreshes in 1.520 s with zero new PDF requests. Actual pixel samples on pages 4/5 prove source content rather than empty canvas elements. These are isolated Edge measurements; public follow-up and WPS/user acceptance remain separate gates.


## Follow-up production: 20261023T234000 — cold performance gate still open

Accepted 2026-10-23 15:44:43 UTC, parent 20261023T231000, source 4f3aa8eea09cdc5a92173c4e65adbefbab80e7e6. Reviewed delta: 10 files. Source CI 39979589968, 160 architecture/document tests, production builds and release contracts pass. This ships 1 MiB deduplicated parallel read-ahead, complete original cache reconstruction and cloud/local all-page preparation for papers up to 24 pages.

Real gggg public Edge, existing 19,687,887-byte 16-page IJBM: first page 19.705 s; jump to page 4 24 ms, page 5 13.604 s; all pages 78.988 s; cached refresh 3.187 s; My Articles reopen 1.133 s. Refresh/reopen issue zero new document requests. Complete cache SHA matches the original. Existing 11-page SCM: cold 17.197 s, all pages 17.512 s, cached refresh 2.228 s, reopen 1.153 s. These are diagnostic runs, not a distribution or a WPS comparison.

An isolated Edge process with --no-proxy-server (no global VPN/proxy changes) measured large-paper first page 24.724 s, page five 13.569 s, all pages 82.748 s, cached reopen 1.035 s. During transfer server eth0 outbound averaged 3.08 Mbps over ten seconds. Project purchase/capacity records specify 3 Mbps; current billing-console configuration has not been independently inspected. At 3 Mbps the original's bytes alone require approximately 52.5 seconds, before runtime, request and rendering costs. This is a measured major constraint, not proof that every remaining delay has one cause.

Local production-build fixtures with artificial one-second request latency remain separate: Edge first 3.296 s, page four 253 ms, page five 2.386 s, all 11.396 s, refresh 1.520 s; WebKit first 4.775 s, page four 344 ms, page five 1.553 s, all 13.833 s, refresh 2.121 s. No physical Safari or side-by-side WPS acceptance was performed.

Live contextual explanation, dictionary and article translation passed with successful deepseek-flash ledger evidence. Health passed; persistent backend container IDs unchanged; fresh context-reader-20261023T154549Z.dump SHA and isolated 40-table restore passed. Disk 84%, 6.4 GB free after narrowly verified unused builder cleanup; accepted rollback images retained. Evidence is outside Git under D:/codex_test/release-artifacts/document-controls-1023/evidence/read-ahead/. No original was replaced or reimported.

The user's cold-opening/continuous-reading hard gate remains open. Proposed next step: authenticated private object-storage delivery bypassing the app host's constrained uplink, with exact pricing and authorization before new billable resources. See [delivery proposal](document-delivery-plan-20261023.md).
