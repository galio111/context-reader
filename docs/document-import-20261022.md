# Original document reading acceptance

Status: production accepted as `20261022T180600`; real-account import, full translation and fresh-browser replay passed.
Final parent: `20261022T175300`; source: `f6b074db224531f15eda49646e7a1f4b2048db68`. Public connectivity and server state match.

Initial accepted import parent: `20261022T171700`; source: `41005eba857101429a96eb1aef975c5b11f6af27`. Initial parent was `20261018T172000`. The cumulative startup release `20261022T173700` retained this feature and is the replay-fix parent.

## Behavior

Text PDFs and Word `.docx` can be imported from the real article panel. Live login is required; accepted imports save to My Articles and use normal protocol-2 sync. The private original is served only to its owner. PDF pages preserve columns, typography, figures and equations; Word preserves document layout as supported by browser rendering. Source editing is disabled; original download remains available. No OCR was enabled.

Word/phrase selection uses the existing contextual explanation pipeline. Full translation starts on explicit action, preserves original pages, labels PDF page boundaries and caches translated blocks. The supplied 11-page paper extracts approximately 51k characters / 184 blocks, within the complete-context budget. Longer documents use bounded target-centred context with opening definitions; every target remains translatable.

## Acceptance evidence

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

20 MB per source, 150 PDF pages, 300k extracted characters. Scans/insufficient text, encrypted PDFs, old `.doc`, macro/embedded-object DOCX are not supported. PDF extraction follows content-stream order with geometric line grouping; irregular/untagged documents can need a better source export. DOCX complex layout, fonts and pagination can differ from Microsoft Word; export to PDF for the strongest fidelity. Binary documents need a network connection. Browser device emulation does not replace physical phone/Safari or user's final visual acceptance. Article deletion currently retains private source bytes conservatively for shared/recoverable references.
