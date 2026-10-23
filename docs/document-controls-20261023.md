# Personal document reading recovery

Production was rolled back from `20261023T213500` to the previously accepted `20261023T185600` at 2026-10-23 13:53 UTC after the user reported blank pages across browsers. The retained image was restored under the deployment lock; only app/Caddy were recreated. The original files, saved articles and learning records were not deleted. An actual gggg Edge check subsequently opened the older 11-page SCM paper successfully (12.262 s cold opening). This restored readability, not the requested WPS-level performance.

The current source is a recovery candidate; final acceptance and release identity are recorded below. The user explicitly requires real-document opening, scrolling, zooming, reopening and selection to approach their same-device WPS experience. A passing build, API response or isolated screenshot is not that acceptance. Physical WPS equivalence has not been demonstrated by the automated browser measurements.

## Import and persistence

The supplied IJBM paper is a valid 19,687,887-byte, 16-page PDF. Production middleware had truncated uploads at its default 10 MiB boundary. The application, middleware and private bucket now agree on 50 MiB, with 500 PDF pages and one million extracted characters. The Storage service's existing global 50 MiB ceiling is unchanged. Larger sources still exceed this supported limit.

Its extracted text contains 11 NUL characters that PostgreSQL JSONB rejects. Document-only extraction, selection and server sync normalize NUL/unpaired surrogates while preserving valid scientific Unicode, CAS versions, owner protections and deletion tombstones. The source PDF is unchanged. gggg's pending article was accepted with HTTP 200/server version 1, and it is present in My Articles. Private source SHA-256 remains `2d53aca13095a8538b541b97934b7590346494e97b04cb0bc8b7ae1342d1c5e3`; owner range reads return 206 and anonymous reads 401.

## Reading changes

- Import completes local original caching before opening the reader. An owner-checked memory copy prevents a second download and survives PDF.js buffer transfer through defensive copies.
- Cold originals use validated 256 KiB authenticated ranges. Only needed chunks are fetched; overlapping reads share a request. Read chunks persist for refresh/reopen. The previous speculative whole-original download and eager PDF.js getData path are removed. Failed requests terminate instead of leaving PDF.js waiting indefinitely.
- Private cache storage is bounded to 1 GiB on disk and 128 MiB in memory. A small size index replaces repeated scans of all binary originals; cache version migration preserves existing bytes. Optional persistence failure does not discard the source or block reading.
- Versioned public PDF runtime, fonts and decoder assets use immutable HTTP caching. Private documents remain authenticated and are never placed in shared HTTP caches. The PDF worker response explicitly permits bundled WASM decoders while retaining the prohibition on JavaScript eval.
- Visibility observes a sized page section, not an empty zero-height paint host. The first page is eligible immediately. Page dimensions update on zoom even when distant pages are not being rendered.
- Completed canvases remain visible during zoom and scrolling. Local papers up to 24 pages prepare bounded source canvases after the first page; distant pages avoid building selection DOM. Reading positions receive priority over queued preparation.
- The source canvas and PDF.js native text layer are separate. A prepared canvas that is already sharp enough is reused when selection becomes available; the same page is not rasterized again merely because it entered the viewport. Expensive upgrades wait while scrolling. Native text selection keeps word expansion, sentence-only translation above five words, and punctuation no-op behavior.
- Zoom controls pin at visual-viewport top (zero extra 80px offset). The horizontal control stays at the bottom of the visible document area, above the mobile dock and any open translation sheet. Highlight coordinates account for retained-frame scaling.

Ordinary pasted/URL articles retain their existing interaction behavior. Word retains its isolated frame and previously accepted Safari selection bridge. Original PDF images, vectors and annotation appearances remain source-rendered.

## Evidence and remaining acceptance

The earlier streaming candidate passed limited fixtures but still took 20.565 s in a public Chrome cold opening and 42.323 s in a later WebKit run. It did not satisfy the user's performance requirement and was rolled back after their reports. These timings must not be presented as a successful performance release.

Recovery regressions cover 160 architecture/document checks, cache migration, account boundaries, transferred buffers, overlapping range reads, repeated cache use and malformed range responses. Isolated Edge checks use both the original 1,788,008-byte SCM paper and the 19,687,887-byte IJBM paper. The large local import makes zero original downloads. Native source text was checked with Construction double-click, a partial-word drag expanding to the complete word, and the six-word selection Construction of double network hydrogels using producing translation-only output. Controls and mobile hit testing also cover an open translation sheet.

Development and production performance logs are separate; different instrumentation runs are not interchangeable benchmarks. Final production measurements, public verification, source CI, health and backup evidence remain to be added after acceptance. Physical Mac Safari and direct WPS side-by-side comparison remain unperformed.

Production-build local fixtures: large-paper Edge first frame 2.550 s and WebKit 4.798 s with zero original re-downloads; all source pages prepared in 7.223/11.922 s. A separate authenticated-range fixture opened in 2.032 s and refreshed in 1.526 s with zero new ranges and no speculative whole-file transfer. These isolate rendering/cache behavior and exclude real upload/cloud latency. Scroll measurements vary with active translation UI and instrumentation; they do not establish native WPS parity.
