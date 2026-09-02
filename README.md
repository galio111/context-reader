# Context Reader

Context Reader is a Next.js reading tool for importing real English articles and understanding them with Chinese context-aware explanations, full-article translation, vocabulary capture and Anki export.

- Production: `https://context-reader.com`
- Primary route: `/`; legacy `/home-v2` links permanently redirect to the root and preserve query parameters
- Rollback/reference: `https://context-reader-ten.vercel.app`
- Stack: Next.js 15, React 19, TypeScript, DeepSeek, local-first browser data and a mainland self-hosted Supabase-compatible PostgreSQL/Auth/REST/Storage backend
- Production data boundary: all account, sync, recommendation and object-storage traffic stays inside the mainland Docker network; Supabase Cloud is a frozen rollback copy only and is never a live request target

The reader is the product center. Article text remains visually primary while lookup, translation, vocabulary, saving, recommendations and account tools support the reading flow.

## Current Product State

### Reading

- Paste English text or import a public article URL.
- Preserve headings, paragraphs, lists, quotes, meaningful images and supported inline annotations while filtering navigation, related stories, author cards, media controls, credits, comments and other site chrome.
- Enter Reader as soon as text extraction succeeds; meaningful images keep stable reserved space while they are localized in the background, and a failed image never fails the text import.
- Click a word or deliberately select a phrase to receive a context-aware Chinese explanation.
- Run a standalone Chinese↔English dictionary for short inputs.
- Open the homepage dictionary as a fixed left-docked desktop work surface or a bottom-docked mobile sheet; its results scroll independently instead of restoring a draggable floating position.
- Start full-article translation from the reader sidebar; one upstream stream normally carries the article while completed blocks still appear and persist paragraph by paragraph.
- Edit article text directly in the reading canvas with session-level undo/redo. Imported images remain read-only blocks that can be removed whole.
- Enlarge imported images, zoom around the pointer, use stored layout-word overlays and download validated remote images.

### Learning Data

- Save articles and vocabulary locally, then synchronize versioned objects after login.
- Preserve source sentence, contextual meaning, phonetics, generated study fields and Anki import state.
- Export CSV or import complete notes through browser-side AnkiConnect.
- Use identical cloud-generated US/UK pronunciation audio across browsers and new Anki cards.
- Merge duplicate/recovery article records into one logical article and keep saved articles ordered by latest open time.

### Accounts And Offline

- Public beta registration uses nickname + mainland-China phone identifier + six-digit numeric password without SMS or phone-ownership verification.
- Guest trials use separate Shanghai-day pools: 10 article lookups, 5 standalone dictionary lookups, 2 pasted-text imports and 2 URL imports. Cache hits, failures and timely cancellations do not consume them; Admin can change all four allowances.
- Registered plans expose separate Shanghai-month summary and full-translation allowances. A new full-translation job costs one action regardless of paragraph count; replay is free, regeneration costs another. A curated prepublished translation costs one action on the member's first click but creates no DeepSeek execution.
- Saving generates a summary only when that article has no valid one. A curated public article reuses its reviewed Chinese summary without a DeepSeek call while still consuming one plan summary action; once saved, the action becomes `已保存` and there is no second summary-generation control.
- Admin can generate a unique single-use Basic, Plus, or Max invitation code with a redemption deadline, post-redemption duration and private note. A signed-in user redeems it from Menu; the account then shows the granted limits and expiry, returns to Free at expiry, and can redeem a new code.
- Registration may continue to a skippable reading-profile step. English level and interests personalize only the default recommendation order; birth year and gender are optional demographic fields and can be cleared.
- Protocol-2 sync uses a bounded bootstrap, opaque change cursor, compare-and-swap versions and tombstones instead of downloading full history repeatedly.
- Offline mode reopens only the last verified account's browser-local articles, vocabulary and caches. It never restores Admin, plan, quota or server authorization.
- Online payment is not connected. Commercial labels and detailed usage counters remain hidden unless their explicit build-time flags are enabled.

### Recommendations And Admin

- `/` receives recommendation summaries during server rendering; article bodies load only on intent/open.
- The homepage external-publication header includes a persistent personalization control for guests and members. Guests reach a bottom “登录查看更多” action without losing the following homepage sections; signed-in users may expand the remaining library in place with category and search. The redundant difficulty selector has been removed.
- `/admin` accepts saved, pasted, URL-imported and crawler-discovered candidates. Its daily editorial workbench combines the real Reader, autosaved metadata, previous/next navigation, expandable candidate/published drawers and one-step URL intake. On desktop the inspector stays left while lookup, vocabulary, saved articles and queue controls stay right; on mobile the top row is `返回后台 / 文章设置 / 精选 / 候选 / Menu`, and each queue opens as a top-down list. The crawler uses reviewed RSS/Atom sources, including business/economy feeds, records a source publication time for future candidates when available, and never auto-publishes.
- Selecting a candidate publishes it and applies three independent editorial choices: topic-column featured, recommendation-pool membership and recommendation featured. The recommendation pool is an authoritative Admin whitelist: an unchecked article never returns through a whole-inventory fallback. The collapsed window targets one featured card plus three complete rows; text-only cards never fill those three rows and are woven later through the expanded library. Rejected candidates remain undoable records and are excluded from rediscovery.
- Candidate and published articles open in the real `ReaderView`, including lookup, translation, saving and in-place body editing.
- Candidate media is localized to first-party WebP during intake. If a remote image cannot be stored it is omitted instead of hotlinked; genuinely no-image articles remain publishable and use an intentional text-edition card.
- If a published article already has a reviewed cover but duplicate cleanup left its body with no image, the same cover is restored as its leading article media by an idempotent, backup-verified maintenance script.
- Server-authorized Admin also manages accounts, separate summary/translation quotas, DAU/WAU/30-day MAU, per-user article usage, invitation codes, password resets, private feedback and detailed product/site error records. A published article can directly upload its complete current-body translation when one exists; candidates reuse a complete cache automatically on publication and have no separate translation-entry flow.

### OCR

OCR routes and compatibility data remain in the repository, but OCR is not a current user-facing feature. No shipped page exposes image upload, and URL-imported article images do not trigger automatic OCR.

## Homepage Design Status

Mainland production runs the connected `HomeRedesign` review baseline: it keeps Ballpit as the brand surface, removes page turns, and connects SSR recommendations, personalization, import, Menu, Reader, account state and Admin curation. Complex motion, Chinese copy and several return paths are still explicitly unaccepted; see the implementation audit before describing the redesign as complete.

Do not create a separate `/home-lab` or a static mock homepage. Iterate on the real root homepage. Read `docs/home-redesign-current-decisions.md` first for the latest accepted choices, then `docs/home-v2-implementation-contract.md` for detailed current/target status and the three-part technical, visual and product-experience acceptance process.

## Setup

```powershell
npm install
Copy-Item .env.local.example .env.local
npm run dev
```

Open the URL printed by Next.js, normally `http://localhost:3000`.

The complete environment reference lives in `.env.local.example` and `docs/integration-guide.md`. Important groups are:

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TRANSLATION_MODEL=
DEEPSEEK_FALLBACK_MODELS=
DEEPSEEK_FALLBACK_BASE_URL=
DEEPSEEK_FALLBACK_API_KEY=
DEEPSEEK_FALLBACK_MODEL=

SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ACCOUNT_COOKIE_SECRET=
ADMIN_PASSWORD=
ADMIN_SESSION_SECRET=
ADMIN_SESSION_VERSION=1
CRON_SECRET=

VOLCENGINE_TTS_APP_ID=
VOLCENGINE_TTS_ACCESS_TOKEN=
VOLCENGINE_TTS_CLUSTER=volcano_tts
VOLCENGINE_TTS_ENDPOINT=https://openspeech.bytedance.com/api/v1/tts
VOLCENGINE_TTS_US_VOICE=en_female_amanda_mars_bigtts
VOLCENGINE_TTS_UK_VOICE=en_female_emily_mars_bigtts

OCR_PROVIDER=zhipu
ZHIPU_API_KEY=
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_OCR_MODEL=glm-4.6v-flash
OPENAI_API_KEY=
OPENAI_OCR_MODEL=gpt-4o-mini
```

Do not commit `.env.local` or any production credential. Apply both `docs/public-articles-supabase.sql` and `docs/account-usage-supabase.sql` for a fresh compatible backend.

### Local Development Identity

On `localhost`/`127.0.0.1`, an ignored `.env.development.local` may use `LOCAL_DEVELOPER_USER_ID`, `LOCAL_DEVELOPER_PHONE` and `LOCAL_DEVELOPER_NICKNAME` to attach `next dev` to one real account through normal sync. This shortcut never runs in production builds or non-loopback requests and never grants Admin without the matching server-side entitlement.

Without usable backend credentials, loopback development falls back to browser-local learning data. That mode supports local reading state but does not grant Admin or cross-device sync.

## Main Routes

| Route | Purpose |
|---|---|
| `/` | Canonical homepage and recommendation entry |
| `/home-v2` | Compatibility redirect to `/`, preserving query parameters |
| `/guide` | New-user and AnkiConnect setup guide |
| `/account/usage` | Account status and usage |
| `/admin` | Server-authorized recommendations, accounts, feedback and error console |
| `/api/import-url` | Safe, conservative text-first webpage extraction; selected images are localized to bounded first-party WebP assets after Reader opens |
| `/api/explain-word*` | Context explanation, structured and streaming |
| `/api/dictionary*` | Standalone bidirectional dictionary |
| `/api/translate-article` | Batched streaming full-article translation with progressive block events |
| `/api/pronunciation` | Cached cloud pronunciation audio |
| `/api/public-articles*` | Public recommendation summaries/details |
| `/api/auth/*` | Phone/password beta auth and legacy email compatibility |
| `/api/account/*` | Learning-data sync, export and repair |
| `/api/admin/*` | Server-authorized content and operations |

See `docs/integration-guide.md` and `docs/architecture.md` for payloads, security and data-flow details.

## Security Summary

Server routes enforce bounded request bodies, route-aware throttling, AI concurrency limits, same-origin admin writes and generic public errors. Outbound URL/image reads pin verified DNS, block private/reserved networks, recheck redirects and cap streamed bodies. Admin/account cookies are HttpOnly and production-secure. Browser roles have no direct access to server-only or public-content tables.

The in-process limiter is a second line of defense, not a distributed public-traffic control. Before broader promotion, add a mainland platform/distributed rate limit or provider spending cap.

## Documentation

- `AGENTS.md` — concise rules and hard boundaries for coding agents.
- `PRODUCT.md` — durable product purpose and design principles.
- `docs/home-redesign-current-decisions.md` — canonical current homepage redesign decisions and superseded directions.
- `docs/home-redesign-interview-archive.md` — structured user choices and material supplements from completed design rounds.
- `docs/home-v2-implementation-contract.md` — homepage current state, accepted redesign and visual verification contract.
- `docs/product-journey.md` — chronological UI, feature, infrastructure and decision history.
- `docs/architecture.md` — internal flows and invariants.
- `docs/integration-guide.md` — environment, API and external integration guide.
- `docs/gpt-brief.md` — compact portable context when a conversation cannot read the repository.
- `docs/account-usage-plan.md` — auth, quota and sync product rules.
- `docs/mainland-deployment-and-migration-plan.md` — mainland production, backup and rollback boundaries.
- `docs/manual-site-regression-checklist.md` — the owner's weekly, monthly and post-release browser test checklist.

Final-state docs are edited in place. Historical narrative belongs only in `docs/product-journey.md` so normal project context stays lean.

## Build And Deployment

Documentation-only changes need no build or deployment. For user-facing code:

```powershell
npm.cmd run build
```

Then use the cumulative versioned workflow under `ops/mainland/`. Package only a clean dedicated integration worktree with `package-release.py`; its manifest must name the exact active production parent, source commit and reviewed file delta. The stable server deploy guard serializes releases and rejects stale parents, missing protected behavior or undeclared files. A routine release recreates only `app` and `caddy` with `--no-deps`; PostgreSQL, Auth, REST, Storage and the internal gateway stay running. Verify `https://context-reader.com/api/connectivity` reports the exact new release identity, then check the affected product, account sync, Admin, health, backup and rollback gates. Keep the current and direct-parent accepted application images for runtime and rollback; the daily image-prune timer may remove only older Context Reader tags and unused dangling layers. See `docs/release-governance.md`.
