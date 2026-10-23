# Personal document reading update

Candidate based on production `20261023T185600`; public acceptance is pending.

The supplied IJBM hydrogel PDF is a valid 19,687,887-byte, 16-page PDF. Production logs identified Next middleware truncating the upload at its default 10 MiB boundary before multipart parsing. The transport allowance now follows the shared document limit plus multipart overhead. The supported limits are 50 MiB, 500 pages and one million extracted characters; private Storage buckets are upgraded in place to the same byte limit, preserving their privacy and existing objects. The existing Storage service's global 50 MiB limit is unchanged. Browser original caching holds at most 100 MiB.

Imported PDF and Word readers keep zoom controls at the top of their visible reading column and a keyboard-accessible horizontal control at the bottom when enlarged. Controls remain scoped to the document column and disappear when the document is outside the viewport. Fit-width removes the horizontal control. Ordinary article readers retain their behavior.

PDF pages retain completed canvases when leaving the prefetch region. Zoom immediately scales the retained canvas and selection layer, then atomically swaps a complete sharper frame. A 3,000-pixel prefetch margin and a visible-page-priority queue with two active render jobs reduce blank regions and avoid starting all neighbouring rasterizations at once. Per-page rasterization is bounded to six million pixels. Extremely large zooms may therefore soften; initial uncached pages still require loading and rendering. This is not a promise of zero loading on arbitrary documents or hardware.

AGENTS.md records the user's current personal-use priority: optimize the developer account's actual reading, research and study flow instead of hypothetical multi-user scale. Authentication, private originals and study-record integrity remain intact.

Local evidence: original PDF passed actual Next middleware and multipart validation (local Storage was deliberately unconfigured); 155 architecture/document checks passed, followed by the added queue-priority/cancellation regression; production build passed; eight provider regressions passed. Chrome and WebKit rendered the real PDF, retained the prior frame during zoom, verified controls at two scroll depths, keyboard horizontal movement, fit-width and 390px reduced-motion layout with no page errors. A physical Mac Safari remains untested.
