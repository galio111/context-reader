# Automatic editorial publication — current contract

Current revision: 2026-09-21 recovery from the failed uncapped trial. Production remains paused until this revision passes its release and live acceptance checks. Deployment identity and final evidence are recorded in product-journey.md.

## Quantity, balance and budget

Target about 30 new homepage publications per Shanghai day; minimum success threshold 25. CNY 1 is a soft spending target once 25 articles are available; CNY 1.50 is the hard request-reservation ceiling, including rejected, failed and unknown-result requests. The previous uncapped trial and automatic Jev adoption are superseded. Do not reset the incident day's ledger to conceal past spend.

Category, actual difficulty and source diversity affect ranking and source priority; there are no 18/18, category or per-source publication caps. A 3–5 article deviation is acceptable and is not a reason to reject a qualified article. Supply can still skew: expose actual distributions rather than invent labels. CET6/postgraduate and IELTS/TOEFL foundation remain the same preference tier. School labels remain available; lower-level sources are skipped in this automatic pipeline and genuinely low-level articles do not count. Manual candidates and existing quality-approved school publications remain intact.

## One Flash audit

Automatic discovery uses one bounded deepseek-flash call with the COMPLETE ordered article and all actual images (up to 12 images / 65,000 text characters; larger material stays for manual intake). The same JSON result supplies category, topic, linguistic difficulty/CEFR, summary, completeness, contamination, caption pairing, independent readability, promotional intent and image relevance. Two integer body-block references support the category; brittle verbatim quotations are no longer required. Types, ranges, missing decisions and inconsistent difficulty fail closed. Medium confidence does not force Pro. No automatic Pro escalation or repeated model voting; uncertainty stays pending. Jev is not called.

Deterministic extraction, minimum 401 English words, original-page completeness comparison, readable and fully stored images, source date and duplicate checks remain mandatory. Audit policy v3 additionally requires sourceCompletenessVerified, exact content hash and an approval under 48 hours. Storage may change image URLs but not the audited text/block projection. Exact-content audit cache lasts 24 hours; it cannot approve edited content or replace freshness checks.

## Extraction experience

Versioned publisher rules remove inspected standalone furniture: ScienceAlert subscription artwork, Nieman posted/share/footer boundary, Popular Science related-module heading and column promotion. Rules are host-scoped, preserve quotes/captions/tables and require substantive content after removal. No model-generated regex or arbitrary prose deletion is executed. Unrecognized contamination remains pending; it is not repeatedly sent to Pro.

The source/ordered-block-template profile records distinct successful URLs and failures; five distinct clean samples mark the profile verified, any held sample resets it. Profiles support future rule maintenance and expose recurring failures. They do NOT currently waive the original-page comparison or integrated content check: source layout can change, and the combined check adds no extra model request. Do not advertise this as an autonomous selector-learning engine or permanent exemption from quality checks.

## Scheduling and accounting

Database lease serializes bounded source batches. Up to three URL attempts per batch; obvious videos/films/APOD/shorts are filtered before occupying paid slots. Eligible, already-paid v3 candidates are published first. Verified non-lower sources rotate with category/difficulty priority; at most four visits, two consecutive empty batches retire a source for the day. Identical held content is not automatically re-reviewed.

The systemd driver immediately processes the next running batch after 2 seconds, yields after a bounded session, and the timer resumes 30 seconds after inactivity. Daily processing stops at 30, CNY 1 after minimum 25, hard budget, 90 minutes, attempt limit, source exhaustion, three provider/schema failures in sequence, or 18 no-progress batches. Every stopped outcome requests a completion/shortfall email; failed email delivery can retry without restarting paid work.

Durable pre-request reservation and per-request journal include article URL/hash, model, stage, timing, HTTP status, cached/input/output tokens, settled estimated CNY/USD, unknown reserve and final audit outcome. Invalid JSON or business validation cannot erase settled usage. Batch outcomes are append-only by source/visit, not overwritten. Estimates remain distinct from provider invoices.

Emails include actual publication count, category/topic/difficulty counts, attempts, all pipeline spending, provider/stage totals, tokens and unknown reserves. No Jev accuracy claim is made. Quality, future supply and model accuracy are never guaranteed by passing unit tests alone.

## Incident and verification

2026-09-21 incident: 22 publications, 484 DeepSeek requests costing an estimated CNY 4.646368; 80 failed Jev requests; 26 approved middle-tier candidates blocked by a hard quota. Classification consumed CNY 3.219879 and 148/245 results failed local validation. Full evidence is retained privately under artifacts/editorial-incident-20260921. Do not repeat deletion or silently alter the historical bill.

Recovery acceptance includes real paid multi-source article audits, negative/repair cases, fresh original-page extraction, production build, policy/budget tests, safe deployment, public identity/homepage/Admin/account boundaries and timer verification. Full multi-day supply remains a runtime observation, not a finite-test guarantee.
