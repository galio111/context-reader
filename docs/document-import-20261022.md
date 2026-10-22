# Original document reading acceptance

Status: implementation complete; production acceptance pending.
Parent: `20261018T172000` / `c815e349bbfa544e4068308273813a16c511874f`.

## Behavior

Text PDFs and Word `.docx` can be imported from the real article panel. Live login is required; accepted imports save to My Articles and use normal protocol-2 sync. The private original is served only to its owner. PDF pages preserve columns, typography, figures and equations; Word preserves document layout as supported by browser rendering. Source editing is disabled; original download remains available. No OCR was enabled.

Word/phrase selection uses the existing contextual explanation pipeline. Full translation starts on explicit action, preserves original pages, labels PDF page boundaries and caches translated blocks. The supplied 11-page paper extracts approximately 51k characters / 184 blocks, within the complete-context budget. Longer documents use bounded target-centred context with opening definitions; every target remains translatable.

## Evidence so far

- Browser: supplied PDF original-page screenshot, exact conjugate click context, zero page errors.
- DOCX: actual two-page Word fixture with title, table and explicit page break rendered; zero page errors.
- Unit: file signature/ZIP expansion/macro rejection, stable page IDs, column order, line joins and late-document context.
- Existing critical regressions: 90 passed. Release contracts passed.
- Production build passed before final hardening; final build/production checks are tracked below.

## Limits

20 MB per source, 150 PDF pages, 300k extracted characters. Scans/insufficient text, encrypted PDFs, old `.doc`, macro/embedded-object DOCX are not supported. PDF extraction follows content-stream order with geometric line grouping; irregular/untagged documents can need a better source export. DOCX complex layout, fonts and pagination can differ from Microsoft Word; export to PDF for the strongest fidelity. Binary documents need a network connection. Browser device emulation does not replace physical phone/Safari or user's final visual acceptance. Article deletion currently retains private source bytes conservatively for shared/recoverable references.
