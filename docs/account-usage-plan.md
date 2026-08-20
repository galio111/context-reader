# Account, Sync, and Usage Plan

Status: application code, production environment variables, and Auth are configured on the mainland self-hosted Supabase-compatible backend. The managed Supabase project remains intact for rollback. The visible beta flow uses an unverified mainland-China phone identifier plus nickname and a six-digit numeric password, with no SMS or email required. Email OTP remains hidden and still requires custom SMTP before it can be offered publicly.

## Product principles

1. Reading comes first. Opening the homepage, entering an article, switching articles, editing, and an in-progress stream are never interrupted by account prompts.
2. Ask at the restricted action. Login appears only when a guest exhausts lookup trial or tries to save, use vocabulary/Anki, request private full translation, or generate a summary.
3. One user action is one visible charge. Parallel structured and streaming lookup requests share an idempotent action id; backend executions still record their real token usage separately.
4. Never charge guests or registered users for cache hits, failures, timeouts, or timely cancellations. Guest article lookup, standalone dictionary, pasted-text import and URL import use separate server-managed pools.
5. The cloud is authoritative after login, but migration never silently discards local data. Version conflicts are refetched and merged. Article conflicts collapse into one canonical article and discarded ids become tombstones, so visible recovery copies must not remain; vocabulary is normalized and deduplicated by word plus source sentence, while a genuinely ambiguous same-id vocabulary conflict is retained in a separate local recovery store instead of appearing as another notebook entry.
6. Quotas are product configuration, not UI constants. Ordinary-user allowances are editable from the “账号与用量” section of `/admin`; raw metric keys, fixed period internals, developer safety allowances, and unconnected price experiments are hidden from the daily management UI. Payment is deliberately not connected. The public account page replaces plan names with “公开测试中” and hides every price/purchase/upgrade surface unless the owner later enables `NEXT_PUBLIC_COMMERCIAL_UI=enabled` and rebuilds. Remaining counts, point totals, progress bars, and reset times stay hidden behind the separate `NEXT_PUBLIC_USAGE_DETAILS_UI` switch while enforcement continues on the server.
7. Collect the minimum. Analytics stores identity, entitlement, quota actions, route/model, provider tokens, estimated cost, status and error code—not full private article text.

## User state matrix

| Capability | Guest | Free account | Paid / invite | Admin |
|---|---:|---:|---:|---:|
| Paste, URL import, read public recommendations | Yes | Yes | Yes | Yes |
| Word/phrase explanation | 10/day | 30/day | Plan allowance | High safety allowance |
| Cached word explanation | Counts | Free | Free | Free |
| Save article / vocabulary / Anki | Login prompt | Synced | Synced | Synced |
| Private translation / summary / OCR | Login prompt | Deep points | Deep points | High allowance |
| Admin-prepublished translation | Yes | Yes | Yes | Yes |
| Cross-device sync | No | Yes | Yes | Yes |

## Quota model

- `guest_lookup`: one cached or generated lookup, including regenerate.
- `lookup_generation`: one generated lookup or sentence follow-up. A parallel structured + stream pair is one quota action and two provider execution records.
- `deep_reading`: about one point per 1,000 requested characters; summary has a two-point minimum; OCR is five points per image.
- Defaults: guest 10/day; free 30 lookups/day + 20 deep points/month; Basic ¥5 80/day + 150/month; Plus ¥10 200/day + 500/month; Max ¥30 600/day + 2,000/month.
- Prices are internal hypotheses. Online payment and refunds are not active; admins may assign quota levels during testing, but public users do not see price cards or paid-plan names.

## Data model

- Supabase-compatible Auth: phone-identifier + numeric-password identity and refresh session. The phone is mapped server-side to a reserved internal email; it is explicitly unverified and the password is hashed by Auth.
- `account_profiles`, `user_entitlements`: profile, status and plan.
- `quota_plans`, `quota_plan_limits`, `account_settings`: editable global configuration.
- `guest_identities`: signed anonymous cookie identity, hashed last IP and status.
- `usage_actions`, `usage_counters`: idempotent visible charge and atomic counter.
- `usage_executions`: every upstream call, tokens, estimated micro-USD and outcome.
- `user_data_objects`: versioned article, vocabulary and cache objects.
- `admin_audit_logs`: plan, status and quota administration history.

## Key interactions

- Registration uses nickname + mainland-China phone identifier + six-digit numeric password; later login uses phone + password. No SMS is sent and the phone is not proof of ownership. Access and refresh cookies are HttpOnly, Secure in production and SameSite=Lax; the refresh cookie lasts 7 days.
- A browser's first sync captures one server snapshot, downloads active payloads plus lightweight tombstone metadata, supplements them with local data, and uploads with expected versions. Later syncs use an opaque `(updated_at, kind, object_key)` cursor and a local version/hash manifest, so unchanged objects and old deletion payloads are not transferred again. Version conflicts refresh the cursor/manifest and retry up to three times.
- Durable local changes schedule an upload after about 800 ms. While a signed-in page is visible, remote changes are checked about every 15 seconds and immediately on focus or visibility return; a suspended or offline browser catches up when it becomes active again.
- Vocabulary sync keeps one canonical entry per normalized word and source sentence, merges the most complete generated fields and Anki import record, and sends tombstones for redundant cloud recovery ids.
- Explicit logout first requires a successful sync, then clears account-associated local caches. A sync failure stops logout instead of risking data loss.
- `/account/usage` shows simple remaining allowances. The “账号与用量” section of `/admin` explains and edits guest/free/Basic/Plus/Max limits in Chinese, shows a recent execution/cost summary, assigns user plans, handles suspension, hides rarely used per-user bonuses under progressive disclosure, and can issue a one-time displayed temporary password for phone accounts. Admin-plan limits and payment price controls stay out of the main UI.

## Risks and phased release

- Database counters are global, but the built-in IP limiter is per application instance. Add a mainland WAF or distributed limiter before larger promotion.
- Phone + password avoids an email-delivery dependency for the beta, but the phone identifier can be claimed by someone else and has no self-service recovery. Keep registration rate limits, explain the limitation, and add stronger verification before broad promotion. If email login is re-enabled, configure custom SMTP, add `{{ .Token }}` to the template, and verify a non-team address first.
- Keep the service-role credential server-only; never expose it as `NEXT_PUBLIC_*`.
- Cost is an estimate. Default rates follow the official DeepSeek V4 Pro/Flash price page checked 2026-07-14 and can be overridden when prices change.
- Protocol 2 sync is cursor-based and byte-bounded. The legacy offset reader remains temporarily compatible during rollout, but new clients must never return to downloading the account's complete object history on every sync.
- Tombstones are retained for correctness. Compact them only after the mainland backend has a documented retention window and per-client acknowledgement/high-watermark rule; row-count pressure alone is not permission to delete them.

Release phases:

1. Run `docs/account-usage-supabase.sql`, set secrets, and smoke-test phone/password registration and login plus cross-device sync in two browsers.
2. Invite test: manually assign tiers and tune quotas using real token/cost and failure data.
3. Public test: keep payment disabled; validate guest conversion, cost, storage and abuse.
4. Billing: add payment webhooks, entitlement expiry, terms/invoices and legally reviewed refund rules only after pricing evidence.

On a fresh project, apply both `docs/public-articles-supabase.sql` and `docs/account-usage-supabase.sql`.
