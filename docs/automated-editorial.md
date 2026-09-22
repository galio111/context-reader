# Automatic editorial publication — current contract

Current revision: 2026-09-21 recovery from the failed uncapped trial. Accepted production 20260921T083200 (parent 20260921T082100, source 0bd89991e42b36b33b116fbf374d3a8fd480d8bb). Runtime restored for 2026-09-22 06:00 Shanghai; the stopped incident day remains suspended with its ledger intact. Deployment identity and final evidence are recorded in product-journey.md.

## Prepared revision 2026-09-22 (not yet deployed)

The accepted production identity above still describes the 30-article Flash-only release. The following new policy and model controls are implemented and locally tested, awaiting private MiMo/TypeSafe key entry, real-provider acceptance and cumulative deployment. See [model-control.md](model-control.md).

## Quantity, balance and budget

Target 60 publications, acceptable total 55–70 with all four categories constrained to 13–17. Because 4 × 17 = 68, the effective maximum is 68. Publish up to 60 when every category has at least 13; continue toward 68 only to fill a deficient category. Overflow approved candidates remain candidates. A day is successful only when total and category criteria both pass; exhausted supply, budget or time is a reported shortfall. The hard reservation ceiling remains CNY 1.50 including failed/unknown requests. A soft CNY 1 stop is allowed only after the full minimum distribution is satisfied. Difficulty remains a ranking preference, not a hard quota. School reading stays excluded from new automatic publications; manual workflows remain available.

## Configurable combined audit

The new server-owned model routes choose editorial primary/fallback and an independent vision route. If both editorial choices support images, a combined text/image/classification call avoids duplicate work. If either is text-only, one text call and one vision call are required. Defaults remain DeepSeek Flash, no automatic editorial fallback. Provider failures may invoke the configured backup once, within the same persistent daily budget. Input/policy failures and incomplete streamed responses are not bypassed by switching vendors.

Jev is independently disabled by default and uses the official TypeSafe endpoint with TYPESAFE_API_KEY. When enabled, a single typed request evaluates four text defects: incomplete, contamination, mediaDependent and promotional. Probabilities <=0.10 or >=0.90 are decisive; intermediate values defer only the uncertain checks to the main model. A decisive defect stops before the expensive generative audit. Confident clean checks are omitted from the main-model output schema and merged in code. No image decisions, summary writing or complex linguistic difficulty are delegated to Jev. Source completeness and deterministic checks remain required. These thresholds are routing policy, not measured accuracy; live Jev quality cannot be claimed until actual-key testing.

Deterministic extraction, minimum 401 English words, original-page completeness comparison, readable and fully stored images, source date and duplicate checks remain mandatory. Audit policy v3 additionally requires sourceCompletenessVerified, exact content hash and an approval under 48 hours. Storage may change image URLs but not the audited text/block projection. Exact-content audit cache lasts 24 hours; it cannot approve edited content or replace freshness checks.

## Extraction experience

Versioned publisher rules remove inspected standalone furniture: ScienceAlert subscription artwork, Nieman posted/share/footer boundary, Popular Science related-module heading and column promotion. Rules are host-scoped, preserve quotes/captions/tables and require substantive content after removal. No model-generated regex or arbitrary prose deletion is executed. Unrecognized contamination remains pending; it is not repeatedly sent to Pro.

The source/ordered-block-template profile records distinct successful URLs and failures; five distinct clean samples mark the profile verified, any held sample resets it. Profiles support future rule maintenance and expose recurring failures. They do NOT currently waive the original-page comparison or integrated content check: source layout can change, and the combined check adds no extra model request. Do not advertise this as an autonomous selector-learning engine or permanent exemption from quality checks.

## Scheduling and accounting

Database lease serializes bounded source batches. Up to three URL attempts per batch; obvious videos/films/APOD/shorts are filtered before occupying paid slots. Eligible, already-paid v3 candidates are published first. Verified non-lower sources rotate with category/difficulty priority; at most six visits, two consecutive empty batches retire a source for the day. Identical held content is not automatically re-reviewed.

The systemd driver immediately processes the next running batch after 2 seconds, yields after a bounded session, and the timer resumes 30 seconds after inactivity. Daily processing stops at 60 with balanced categories (or up to 68 while filling gaps), CNY 1 after the full 55/category minimum, hard budget, 90 minutes, attempt limit, source exhaustion, three provider/schema failures in sequence, or 18 no-progress batches. Every stopped outcome requests a completion/shortfall email; failed email delivery can retry without restarting paid work.

Durable pre-request reservation and per-request journal include article URL/hash, model, stage, timing, HTTP status, cached/input/output tokens, settled estimated CNY/USD, unknown reserve and final audit outcome. Invalid JSON or business validation cannot erase settled usage. Batch outcomes are append-only by source/visit, not overwritten. Estimates remain distinct from provider invoices.

Emails include actual publication count, category/topic/difficulty counts, attempts, all pipeline spending, provider/stage totals, tokens and unknown reserves. No Jev accuracy claim is made. Quality, future supply and model accuracy are never guaranteed by passing unit tests alone.

## Incident and verification

2026-09-21 incident: 22 publications, 484 DeepSeek requests costing an estimated CNY 4.646368; 80 failed Jev requests; 26 approved middle-tier candidates blocked by a hard quota. Classification consumed CNY 3.219879 and 148/245 results failed local validation. Full evidence is retained privately under artifacts/editorial-incident-20260921. Do not repeat deletion or silently alter the historical bill.

Recovery acceptance includes real paid multi-source article audits, negative/repair cases, fresh original-page extraction, production build, policy/budget tests, safe deployment, public identity/homepage/Admin/account boundaries and timer verification. Full multi-day supply remains a runtime observation, not a finite-test guarantee.
