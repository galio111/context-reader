# PDF translation batches and sentence layout

Status: candidate, based on accepted production 20261112T121900 / source 69d399c3324a650b4827c6e366bb733e3410f0b0. Not deployed yet.

The November 13 report exposed two independent causes: document jobs bypassed the existing article batcher and submitted exactly one target per request; a double-spaced manuscript exceeded the source extractor's line-continuation spacing and retained each line as a paragraph. The November 11 native PDF sentence-selection fix did not introduce this policy. The single-target document rule was recorded in the October 28 cost repair.

Translation-only compilation now joins consecutive same-page unfinished sentences, preserves labels, headings, captions, terminal sentences, lexical hyphens and source blocks, and gives joined targets distinct IDs. No stored article, original PDF or lookup selection is rewritten. All jobs use the existing 10-target / 5,000-character batcher. Completed targets still stream into exact source-keyed caches, and retries request missing targets only. Background remains bounded to 4,000 characters / 24 blocks. Sidebar document spacing is compacted.

Private 42-page manuscript: 765 old body targets become 178 targets in 18 requests. The 57,125 source characters remain intact, with 587 joining spaces added. These counts are measured; latency/cost savings require the actual regeneration, not a numerical guarantee. Source text, translations and credentials stay outside Git.

At the user's request the exact active galioo job was cancelled through the existing refund RPC; server status is cancelled and the provider execution count stabilized at 414. Already-dispatched work may complete once; subsequent requests reject the closed action. No old caches were deleted.

Validation: 52 focused document, selection, batching, cache, timeout and ownership regressions pass, including actual PDF-job batching (10/10/5 targets with one usage action). Critical regressions, protected release contracts, release safety and production build pass. Admin publishing and public cache replay use the same target compiler. Production candidate: 20261114T000312; public acceptance and complete regeneration remain pending.
