# Account, Sync, and Usage Plan

Status: application code, production environment variables, and Auth are configured on the mainland self-hosted Supabase-compatible backend. The managed Supabase project remains intact for rollback. The visible beta flow uses an unverified mainland-China phone identifier plus nickname and a six-digit numeric password, with no SMS or email required. Email OTP remains hidden and still requires custom SMTP before it can be offered publicly.

## Product principles

1. Reading comes first. Opening the homepage, entering an article, switching articles, editing, and an in-progress stream are never interrupted by account prompts.
2. Ask at the restricted action. Login appears only when a guest exhausts lookup trial or tries to save, use vocabulary/Anki, request private full translation, or generate a summary.
3. One user action is one visible charge. Contextual lookup uses the stream first and calls the structured route only as a fallback, with one idempotent action id across either path; backend executions still record the real upstream work.
4. Never charge guests or registered users for ordinary cache hits, validation failures, work cancelled before completion, or provider failures that do not yield a completed response. Two deliberate exceptions exist: the first click on a published curated full-translation cache consumes one action while recording zero DeepSeek cost, and a standalone dictionary request whose upstream response completed but was structurally incomplete remains charged because the provider cost was incurred. The latter records a failed execution and a durable warning without an alert email. Timely explicit cancellation still refunds. Guest article lookup, standalone dictionary, pasted-text import and URL import use separate server-managed pools.
5. The cloud is authoritative after login, but migration never silently discards local data. Version conflicts are refetched and merged. Article conflicts collapse into one canonical article and discarded ids become tombstones, so visible recovery copies must not remain; vocabulary is normalized and deduplicated by word plus source sentence, while a genuinely ambiguous same-id vocabulary conflict is retained in a separate local recovery store instead of appearing as another notebook entry.
6. Quotas are product configuration, not UI constants. Ordinary-user allowances are editable from the “账号与用量” section of `/admin`; raw metric keys, fixed period internals, developer safety allowances, and unconnected price experiments are hidden from the daily management UI. Payment is deliberately not connected. The public account page replaces plan names with “公开测试中” and hides every price/purchase/upgrade surface unless the owner later enables `NEXT_PUBLIC_COMMERCIAL_UI=enabled` and rebuilds. Remaining counts, point totals, progress bars, and reset times stay hidden behind the separate `NEXT_PUBLIC_USAGE_DETAILS_UI` switch while enforcement continues on the server. An active invitation grant is the exception: its real plan, allowances and expiry are always shown so the tester knows what was redeemed.
7. Collect the minimum. Analytics stores identity, entitlement, quota actions, route/model, provider tokens, estimated cost, status and error code—not full private article text.

## User state matrix

| Capability | Guest | Free account | Paid / invite | Admin |
|---|---:|---:|---:|---:|
| Paste, URL import, read public recommendations | Yes | Yes | Yes | Yes |
| Word/phrase explanation | 10/day | 30/day | Plan allowance | High safety allowance |
| Cached word explanation | Counts | Free | Free | Free |
| Save article / vocabulary / Anki | Login prompt | Synced | Synced | Synced |
| Private translation / summary / OCR | Login prompt | Separate monthly actions | Separate monthly actions | High allowance |
| Admin-prepublished translation | Login prompt | First click counts once | First click counts once | High allowance |
| Cross-device sync | No | Yes | Yes | Yes |

## Quota model

- `guest_lookup`: one cached or generated lookup, including regenerate.
- `lookup_generation`: one generated lookup or sentence follow-up. Contextual lookup is stream-first; the structured route is used only if the stream cannot produce a complete result, and both paths share one action id.
- `article_summary`: one monthly action when the first save generates a summary. Re-saving the same article version reuses the saved summary; there is no user-facing summary-regeneration action.
- `full_article_translation`: one monthly action for each user-started whole-article translation job, independent of the number of streaming provider batches. Reopening the same account's cached result is free; explicit regeneration charges a new action. A first curated-cache click charges one action but creates no provider execution. Normal articles use one upstream streaming batch with the article context sent once; only oversized articles need a small number of bounded batches.
- Defaults: guest pools remain 10 article lookups, 5 dictionary lookups, 2 text imports and 2 URL imports per Shanghai day. Registered defaults are Free 30 lookups/day + 10 summaries/month + 1 full translation/month; Basic 80 + 75 + 5; Plus 200 + 250 + 20; Max 600 + 1,000 + 60. Every allowance may be set to zero in Admin.
- `deep_reading` remains only as a legacy compatibility metric for old clients and dormant OCR code; new summary and full-translation work never consumes it.
- Prices are internal hypotheses. Online payment and refunds are not active; admins may assign quota levels during testing, but public users do not see price cards or paid-plan names.

## Data model

- Supabase-compatible Auth: phone-identifier + numeric-password identity and refresh session. The phone is mapped server-side to a reserved internal email; it is explicitly unverified and the password is hashed by Auth.
- `account_profiles`, `user_entitlements`: profile, status and plan.
- `invitation_codes`: SHA-256 code hash, non-secret hint, granted plan, post-redemption duration, optional redemption deadline, private note, redemption owner/time and grant expiry. Plaintext is returned only in the Admin creation response.
- `quota_plans`, `quota_plan_limits`, `account_settings`: editable global configuration.
- `guest_identities`: signed anonymous cookie identity, hashed last IP and status.
- `usage_actions`, `usage_counters`: idempotent visible charge, body-version metadata and atomic counter.
- `usage_executions`: every upstream call, tokens, estimated micro-USD and outcome.
- `account_activity_days`: one service-only Shanghai-day presence row per account or guest identity, used for real DAU, seven-day WAU and rolling 30-day MAU.
- `user_data_objects`: versioned article, vocabulary and cache objects.
- `admin_audit_logs`: plan, status and quota administration history.

## Key interactions

- Registration uses nickname + mainland-China phone identifier + six-digit numeric password; later login uses phone + password. No SMS is sent and the phone is not proof of ownership. Access and refresh cookies are HttpOnly, Secure in production and SameSite=Lax; the refresh cookie lasts 7 days.
- A browser's first sync captures one server snapshot, downloads active payloads plus lightweight tombstone metadata, supplements them with local data, and uploads with expected versions. Later syncs use an opaque `(updated_at, kind, object_key)` cursor and a local version/hash manifest, so unchanged objects and old deletion payloads are not transferred again. Version conflicts refresh the cursor/manifest and retry up to three times.
- Durable local changes schedule an upload after about 800 ms. While a signed-in page is visible, remote changes are checked about every 15 seconds and immediately on focus or visibility return; a suspended or offline browser catches up when it becomes active again.
- Vocabulary sync keeps one canonical entry per normalized word and source sentence, merges the most complete generated fields and Anki import record, and sends tombstones for redundant cloud recovery ids.
- Explicit logout first requires a successful sync, then clears account-associated local caches. A sync failure stops logout instead of risking data loss.
- `/account/usage` shows simple remaining allowances. The Menu also exposes invitation redemption. The “账号与用量” section of `/admin` has a sticky section directory, true DAU/WAU/30-day MAU, editable guest/free/Basic/Plus/Max limits, invitation codes, account controls and per-user/per-article action details. Its cost view deliberately separates summary actions, full-translation actions and curated-cache hits: user charges and generated articles are action counts, while DeepSeek requests, tokens, failures and estimated CNY cost come from the execution ledger. Curated cache reports hit count, distinct articles, avoided calls and actual model cost zero. Estimates use DeepSeek's direct CNY rates, including all-weekend off-peak billing from 2026-08-23, while the provider console remains the authority for actual account deductions.
- Invitation redemption is login-only and transactionally locks the hashed code before updating `user_entitlements`. A code can be redeemed once. An account with a still-active invitation or another active non-Free entitlement cannot replace it; after expiry the entitlement resolves to Free and a new code may be redeemed.
- `public.consume_usage` serves every quota metric, including legacy article lookup and standalone dictionary. A replacement migration must be proven on a verified isolated backup restore with `ops/mainland/verify-usage-contracts.sql`, which invokes every configured metric and repeats an action id; a new-feature-only migration check is not sufficient.

## Risks and phased release

- Database counters are global, but the built-in IP limiter is per application instance. Add a mainland WAF or distributed limiter before larger promotion.
- Phone + password avoids an email-delivery dependency for the beta, but the phone identifier can be claimed by someone else and has no self-service recovery. Keep registration rate limits, explain the limitation, and add stronger verification before broad promotion. If email login is re-enabled, configure custom SMTP, add `{{ .Token }}` to the template, and verify a non-team address first.
- Keep the service-role credential server-only; never expose it as `NEXT_PUBLIC_*`.
- Cost is an estimate. Each DeepSeek execution is recalculated from its own timestamp, model and cache hit/miss/output tokens. Historical calls keep the pre-2026-08-17 rate; later calls use DeepSeek's Beijing-time peak/off-peak V4 Pro/Flash schedule checked 2026-08-29. Complete explicit environment overrides still take precedence.
- Protocol 2 sync is cursor-based and byte-bounded. The legacy offset reader remains temporarily compatible during rollout, but new clients must never return to downloading the account's complete object history on every sync.
- Tombstones are retained for correctness. Compact them only after the mainland backend has a documented retention window and per-client acknowledgement/high-watermark rule; row-count pressure alone is not permission to delete them.

Release phases:

1. Run `docs/account-usage-supabase.sql`, set secrets, and smoke-test phone/password registration and login plus cross-device sync in two browsers.
2. Invite test: privately issue unique invitation codes, observe redemption, expiry, cost and failure data, and tune plan quotas.
3. Public test: keep payment disabled; validate guest conversion, cost, storage and abuse.
4. Billing: add payment webhooks, entitlement expiry, terms/invoices and legally reviewed refund rules only after pricing evidence.

On a fresh project, apply both `docs/public-articles-supabase.sql` and `docs/account-usage-supabase.sql`.
