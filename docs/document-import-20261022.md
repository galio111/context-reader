# Original document reading acceptance

Status: fidelity UI deployed as `20261022T192000`, parent `20261022T182100`, source `bd91fdc379c50fae31af0c06eefbae18ef393394`. Real-account verification found missing original-source metadata; source-preservation follow-up and account repair pending.

Initial accepted import parent: `20261022T171700`; source: `41005eba857101429a96eb1aef975c5b11f6af27`. Initial parent was `20261018T172000`. The cumulative startup release `20261022T173700` retained this feature and is the replay-fix parent.

## Behavior

Text PDFs and Word `.docx` can be imported from the real article panel. Live login is required; accepted imports save to My Articles and use normal protocol-2 sync. The private original is served only to its owner. PDF pages preserve columns, typography, figures and equations; Word preserves document layout as supported by browser rendering. Source editing is disabled; original download remains available. No OCR was enabled.

Word/phrase selection uses the existing contextual explanation pipeline. Source PDF pages, including images, vectors and stored annotation appearances, are rendered directly; transparent text adds selection. Failed original loads retry and then expose an explicit original retry, never a replacement plain-text article. Fit width and actual 100% (96 CSS pixels per inch) are separate controls.

Full translation starts on explicit action, preserves original pages and stable saved block IDs, labels PDF page boundaries and caches translated blocks. Academic body selection excludes repeated page furniture, front matter and reference/back matter. Captions have a separate optional scope; the sidebar defaults to Chinese reading with optional source comparison and page jumps. For this paper: 51 body blocks, 6 captions, 127 excluded; historical 184-block caches remain stored and unchanged blocks replay without a new provider request. The supplied 11-page paper extracts approximately 51k characters / 184 blocks, within the complete-context budget. Longer documents use bounded target-centred context with opening definitions; every target remains translatable.

Body and caption jobs share the full selected reading context in original order, but translate and charge only their chosen targets. Switching scopes does not cancel existing jobs.

## Current correction evidence

- Real application browser rendered all 11 pages, saved page screenshots and checked image-bearing pages against independent original renders. Chemistry diagrams, experiment photos, figure labels and typography are present. Original supplied PDF has no annotation objects; figure labels are source artwork.
- Body/caption scopes replay 51/6 cached translations, zero new translation requests and zero browser errors. Actual 100% width is 793.6875 CSS px for a 595.276pt page. Refresh and 390px reduced-motion rendering passed.
- A separate source annotation fixture retained a highlight, rectangle markup and comment icon. Popup comment interaction was not added; this paper itself has no annotation objects.
- Nine focused import/scope tests and all 139 architecture regressions passed. Original bytes and saved blocks are not rewritten.
- Production fresh-account verification reproduced the user's plain-text display: the cloud article no longer contained `importedArticle.document`, so Reader chose the ordinary text path. Source bytes were intact. The exact historical writer is not known. Older serializers can drop unknown document fields, and unprotected sync accepted that loss.
- Follow-up: server sync preserves the existing read-only document body, descriptor and stable blocks while allowing metadata/progress updates. Owner/key-scoped reads retain the caller's CAS version; deletion tombstones remain ordinary deletes. Duplicate merging prefers a document-bearing record over a richer plain-text projection. Tests cover legacy field loss, duplicate merge, owner scope, CAS rejection and deletion.
- Signed-in core APIs on release 192000 passed; provider ledger confirmed DeepSeek Flash. Initial browser acceptance correctly failed at missing PDF pages, so this release alone is not the completed user-visible correction.
- CI initially failed because the accepted parent added a fourth stale-refresh argument to the bounded catalogue cache and the static egress regex expected exactly three arguments. Developer-only guard commit `d9384dc` accepts the known optional true argument while retaining TTL/capacity checks. Its complete CI run passed: https://github.com/galio111/context-reader/actions/runs/39770155299.

## Initial release acceptance evidence

- Browser: supplied PDF original-page screenshot, exact conjugate click context, zero page errors.
- DOCX: actual two-page Word fixture with title, table and explicit page break rendered; zero page errors.
- Unit: file signature/ZIP expansion/macro rejection, stable page IDs, column order, line joins and late-document context.
- Existing critical regressions: 90 passed. Release contracts passed.
- Production build passed. All 139 architecture regressions pass, including delayed same-owner translation cache arrival without a new provider action.
- Cumulative source `f6b074db224531f15eda49646e7a1f4b2048db68` passed [GitHub CI](https://github.com/galio111/context-reader/actions/runs/39760519454): architecture, account storage, critical reading, provider charge, study recovery, old-page assets, durable answers, release contracts, egress and production build.
- Public browser imported the supplied paper into gggg: `article-1792662150324`, 11 pages, 184 blocks, 51,273 characters. The exact article was independently read from cloud storage and found in a fresh browser's My Articles.
- All 184 translations were generated and independently verified in the cloud article cache. Original PDF download SHA256 matches the supplied file. Exact conjugate lookup passed with zero browser page errors.
- Anonymous original access returned 401, other-account access 404, owner access 200/private/no-store; non-admin access 401, malformed files 400 and cross-origin upload 403. Real DOCX import and translation passed in a disposable account, subsequently removed with its private original.
- Health passed, backend container IDs unchanged, accepted rollback images retained. A fresh database backup `context-reader-20261022T094720Z.dump` restored into an isolated database with all 40 tables.
- Fresh-session replay exposed a mounted-reader gap: learning articles arrive before historical caches, but same-owner cache merges did not rebind translation state. The follow-up listens only for relevant cloud merge events and retains active job authority; it does not initiate translation or alter saved results.
- Final public release `20261022T180600` / parent `20261022T175300` passed fresh-browser My Articles → original PDF → 184/184 translated-block replay, with zero new translation requests and zero page errors. Page 4, refresh restoration and 390px viewport were inspected. The isolated test session was signed out; the user's existing browser/session was untouched.
- Final health passed after removing untagged build intermediates. Five backend identities stayed unchanged; accepted parent image `sha256:f62e33db92f9e7d0268476a9179777e09b8e5d30f7e17d78c247c3922fdfcd60` remains available. Actual rollback was not performed. Aborted `20261022T170500` and lock-rejected `20261022T180000` never became accepted releases.

## Limits

20 MB per source, 150 PDF pages, 300k extracted characters. Scans/insufficient text, encrypted PDFs, old `.doc`, macro/embedded-object DOCX are not supported. Body/caption classification uses conservative heuristics and can require refinement for other layouts; it never removes anything from the original pages. PDF extraction follows content-stream order with geometric line grouping; irregular/untagged documents can need a better source export. DOCX complex layout, fonts and pagination can differ from Microsoft Word; export to PDF for the strongest fidelity. Binary documents need a network connection. Browser device emulation does not replace physical phone/Safari or user's final visual acceptance. Article deletion currently retains private source bytes conservatively for shared/recoverable references.
