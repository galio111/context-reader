# Context Reader

Context Reader is a Next.js app for importing English text or public webpages and reading them with Chinese context-aware explanations, full-article translation, vocabulary capture, and Anki export. OCR infrastructure remains in the project, but the shipped Home V2 currently exposes only paste and URL import.

Production URL: `https://context-reader-ten.vercel.app`

## Features

- Paste an English article and enter plain-text reading mode.
- Import a public article URL, preserve headings, paragraphs, lists, quotes, meaningful images, and inline upper/lower annotations, and exclude navigation, citations, related stories, recommendation modules, comments, and other page chrome from the reading body.
- Save imported URL articles with their rich layout metadata so reopening from the homepage restores the same layout.
- Edit saved article text directly in the reading canvas, with global reading-session undo/redo controls and the same typography classes used by reading mode. Explicit blank lines are preserved. Editing disables word lookup; imported images remain read-only but can be removed as whole image blocks.
- Persist article edits in browser storage, merge duplicate and legacy recovery-copy records into one logical article, record each article's latest open time, expose saved articles once each from the first-screen top menu in most-recently-opened order, and jump from the in-reader vocabulary drawer to a matching word in another saved article.
- Click an imported article image to enlarge it. The image viewer uses cursor-anchored mouse-wheel zoom within a fit-to-window range so the full image remains visible, without internal viewer scrollbars or background article scrolling.
- Keep the existing OCR routes and image-viewer layout-word support available for future use, but do not expose image upload on the shipped `/home-v2` homepage. Automatic OCR for images inside URL-imported articles remains disabled.
- Click English words without sending the full article to AI.
- Use the standalone dictionary inside the `/home-v2` start-reading spread or as the reader sidebar's third tool when no source sentence exists. It accepts one English word or a phrase of up to eight words and streams the final dictionary UI as ordered structured blocks: pronunciation, senses, usage distinctions, collocations, word family, synonyms, common mistakes, and a memory hint appear progressively without a completion-time layout swap. Its query and latest result are shared between the homepage and reader, survive same-tab mode switches and reloads through `sessionStorage`, then disappear when that browser tab closes. Standalone results can be saved as context-free vocabulary entries. Their Anki card keeps English alone on the front; the back is a formatted study view with Chinese senses, IPA, click-to-play US/UK pronunciation, usage points, collocations, synonyms, word family, examples, mistakes, and memory guidance.
- Explain only `word`, `sentence`, `previousSentence`, and `nextSentence`.
- Stream word explanations in the final explanation-panel shape while the full structured explanation continues generating. The completed stream's visible fields are merged into the durable explanation so progressive output, completed display, and cache replay remain identical; action controls appear after both requests complete.
- Cache explanations in `localStorage` by `word + sentence` and sync signed-in users' cache objects across devices. Public-recommendation preload data seeds only missing cache keys, so it never replaces a user's regenerated explanation.
- Translate the full article from the reading view's right sidebar after the user clicks the sidebar's start button. Full-article translation runs one text block at a time, appends and persists every completed block immediately, sends the full article as context for each request, and continues running if the user switches tools or temporarily opens another article. A refresh, another signed-in browser, or a later return to the recommendation resumes from the durable account-synced result even when the article was never saved locally; public preload data fills only a missing whole-article cache. Temporary provider throttling, overload, timeout, or network interruption waits and retries without discarding completed work. After text editing, unchanged blocks retain their translations while the panel marks changed blocks for selective refresh; circular regenerate clears the matching whole-article and per-block caches before forcing a fresh translation of every current block.
- Save vocabulary entries as compressed `localStorage` data with transparent compatibility for existing uncompressed notebooks.
- Play US and UK word pronunciations in the explanation panel and vocabulary notebook using browser speech synthesis.
- Keep vocabulary entries in newest-added-first order after both local saves and account sync. Article-derived entries may carry a durable public-recommendation id and title, allowing the source action to open that recommendation and highlight the original sentence without requiring a local article save. Older entries without source metadata lazily search the current recommendation inventory once and backfill the match. The notebook virtualizes measured content-height cards, uses a prebuilt sorted prefix index instead of rescanning the whole collection on every search keystroke, and keeps extended fields behind per-entry disclosure. Standalone entries render usage as separate points and isolate collocations, synonyms, word family, examples, mistakes, and memory guidance. The Home Menu freezes hover-detail changes during active list scrolling, and hidden homepage animation work stays paused while the notebook is open.
- Add recommendation candidates from browser-local saved articles, pasted articles, public URLs, or the reviewed-source crawler in `/admin`; URL and crawler intake share the same article-boundary cleanup, then candidates and published recommendations open in the real reader with lookup, vocabulary, translation, saving, and in-place body editing. Reader edits write back to the matching candidate or published row.
- Preload cached explanations and full-article translations for public recommended articles.
- Server-render the homepage recommendation list so recommendations are visible on first paint, then prefetch visible recommendation details so opening one feels close to reopening a local saved article.
- Use `/home-v2` as the shipped homepage; `/` redirects to it, and every home-return surface, account logout return, PWA start, and offline-home link resolves to `/home-v2`. The homepage begins as a digital hardback on a full-height scroll track that exists from first paint, so the scrollbar never appears only after opening. The same scroll position continuously seeks both opening and closing poses, allowing wheel direction to reverse the exact current frame without timer locks or flashes. The front cover remains a fixed-width hard board whose moving hinge and full-board rotation reveal separately translating page and back-cover blocks; it is never stretched into the open spread. One fixed book scene moves through a blank-left/developer-foreword-right spread, the real context demo plus a right page that defaults to standalone dictionary lookup, and the server-rendered recommendation catalogue. Only the closed-cover entry keeps the foreword blank through the cover endpoint and a short visual pause before revealing its title glyphs, semantic copy blocks, and signature. Once an inner-page turn begins, the foreword becomes a fully printed page: backward turns include its complete text in the moving paper snapshot and never render or replay it after landing. Directory jumps always bend one direct source-to-target sheet, even when skipping a chapter. Paste and URL import remain same-page tabs; “Continue reading” appears only when history exists, and homepage image upload remains absent. The former full preference chapter is now a recommendation-page dialog for stage, reading intensity, and interests. The recommendation spread keeps the central spine, marks that the list updates daily, uses CET-4-and-above inventory as the default pool, and refreshes immediately after personalization. Reading-history-based level inference is a future requirement and must remain manually adjustable. The selected B hybrid engine keeps a custom cover, spine, page blocks and back board mounted continuously, while the MIT `page-flip` package bends a single non-interactive DOM snapshot sheet containing the outgoing and incoming spreads. Wawa R3F is a visual reference only. Narrow desktop keeps a 1160 px minimum spread with symmetric edge crop rather than a distorted narrow book. At `760px` and below, Home V2 uses normal single-column vertical scrolling with discrete chapter states and does not mount the WebGL ambient field or curved snapshot page-turn engine; a static cover treatment preserves the visual identity without scroll-linked frame work. The original desktop cursor-letter trail stays visibly above the book, controls, forms, and overlays while masking only currently visible reading and explanation content, then disappears inside the reader. Editable fields always retain normal visible text selection.
- Home V2 page turns auto-finish the current sheet after a brief input idle instead of leaving it suspended halfway. The last scroll direction decides the adjacent endpoint; any new wheel, touch, or scroll-key intent cancels the settle and retakes the exact current frame. On desktop, wheel input over a scrollable book page stays inside that page first. Reaching the workbench bottom or recommendation top starts a 520 ms idle boundary guard: continuous wheel or trackpad inertia cannot immediately turn the book, while the first same-direction gesture after the pause can. Click-driven cover and directory turns use the same short, capped, interruptible scroll timeline instead of browser-native smooth-scroll timing.
- Install as a PWA and reopen the cached app shell while offline.
- Open the vocabulary notebook from either the homepage or the reading view.
- On mobile, keep the article visually primary and expose explanation, full-article translation, standalone lookup, vocabulary, and lower-frequency article actions through a fixed tap-only tool dock and resizable bottom sheet. Anki import remains desktop-only; opening the translation sheet never starts translation automatically.
- Use `/guide` for a newcomer-oriented explanation of the product, the first-reading workflow, context learning versus isolated word lists, a three-step Anki/AnkiConnect setup assistant, daily study guidance, and grouped FAQs.
- Export vocabulary as CSV or import vocabulary entries to Anki through browser-side AnkiConnect, with click-to-play US/UK pronunciation buttons on card backs.
- Use unverified phone-identifier + six-digit numeric-password accounts, a ten-lookups-per-day guest trial, separate lookup/deep-reading quotas, cross-device learning-data sync, `/account/usage`, and the unified `/admin` console. Admin presents ordinary-user quotas in Chinese, hides developer safety limits and inactive price experiments, and includes both the private user-feedback inbox and a developer-only error/Bug inbox with detailed diagnostics. User-facing failures distinguish offline/network, unsupported input, account/quota, and site/provider problems instead of exposing raw fetch errors. No SMS is sent, and online payment remains disabled while pricing is tested.

## Setup

```bash
npm install
```

Create `.env.local` from the example:

```bash
cp .env.local.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.local.example .env.local
```

Then fill in:

```env
DEEPSEEK_API_KEY=your_real_deepseek_api_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TRANSLATION_MODEL=
DEEPSEEK_FALLBACK_MODELS=
DEEPSEEK_FALLBACK_BASE_URL=
DEEPSEEK_FALLBACK_API_KEY=
DEEPSEEK_FALLBACK_MODEL=
OPENAI_API_KEY=your_openai_api_key
OPENAI_OCR_MODEL=gpt-4o-mini
OCR_PROVIDER=zhipu
ZHIPU_API_KEY=your_zhipu_api_key
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_OCR_MODEL=glm-4.6v-flash
ADMIN_PASSWORD=change_me_to_a_long_admin_password
ADMIN_SESSION_SECRET=change_me_to_a_random_session_secret
CRON_SECRET=change_me_to_a_separate_random_cron_secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
ACCOUNT_COOKIE_SECRET=change_me_to_an_independent_random_32_byte_secret
ERROR_ALERT_SMTP_HOST=
ERROR_ALERT_SMTP_PORT=465
ERROR_ALERT_SMTP_USER=
ERROR_ALERT_SMTP_PASSWORD=
ERROR_ALERT_FROM=
RESEND_API_KEY=
```

OCR routes and the dormant legacy image-import path support `OCR_PROVIDER=zhipu` or `OCR_PROVIDER=openai`, but `/home-v2` currently exposes no image upload. For Zhipu, set `ZHIPU_API_KEY`; for OpenAI, set `OPENAI_API_KEY`. If `OCR_PROVIDER` is omitted, the provider layer uses Zhipu when `ZHIPU_API_KEY` exists, otherwise OpenAI when `OPENAI_API_KEY` exists. OCR for images embedded in URL-imported articles is still gated off in the reader. Do not commit `.env.local`.

The `DEEPSEEK_TRANSLATION_MODEL` override applies only to full-article translation. `DEEPSEEK_FALLBACK_MODELS` is a comma-separated fallback model list on the primary provider; `DEEPSEEK_FALLBACK_BASE_URL`, `DEEPSEEK_FALLBACK_API_KEY`, and `DEEPSEEK_FALLBACK_MODEL` configure an optional secondary provider for structured word explanations. Leave optional fallback values blank to disable that path.

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ACCOUNT_COOKIE_SECRET` are required for the complete admin/account system. Run both `docs/public-articles-supabase.sql` and `docs/account-usage-supabase.sql`. The visible beta flow registers a nickname, mainland-China phone identifier, and six-digit numeric password without sending SMS. The server maps the phone to a reserved internal Auth email and Supabase hashes the password; the internal email is never a user-facing identity. Legacy email OTP routes remain available but hidden. If email login returns, custom SMTP and a template containing `{{ .Token }}` are still required for public delivery. See `docs/account-usage-plan.md` for product rules, quotas, sync conflict behavior, and rollout gates.

Automatic site/API error reports are always stored first in the private `context-reader-feedback` bucket and shown at `/admin?section=errors`. To also email each deduplicated fault to the developer address, configure either `ERROR_ALERT_SMTP_HOST`, `ERROR_ALERT_SMTP_PORT`, `ERROR_ALERT_SMTP_USER`, and `ERROR_ALERT_SMTP_PASSWORD`, or `RESEND_API_KEY` plus `ERROR_ALERT_FROM`. SMTP port 465 uses TLS. Do not reuse the public-login SMTP template or commit mail credentials.

Use an independent random `ADMIN_SESSION_SECRET` of at least 32 characters. A long unique `ADMIN_PASSWORD` is strongly recommended, though the application no longer enforces a twelve-character minimum. `ADMIN_SESSION_VERSION` defaults to `1`; incrementing it invalidates all existing admin cookies after a suspected leak. The Supabase SQL enables RLS and revokes browser-role table access, so it must be applied to existing databases as well as new ones.

## Security

All API requests pass through route-aware throttling. Paid AI/OCR routes have tighter minute and daily buckets plus per-instance concurrency caps; admin login allows five attempts per fifteen minutes. JSON and multipart bodies are read with hard byte limits before parsing, and oversized or chunked uploads return `413`. URL import and image proxy/OCR use DNS-pinned outbound connections, block private, loopback, link-local, metadata and reserved addresses, revalidate every redirect, limit redirects and stream remote bodies with hard caps. Admin mutations require a same-origin browser request, sessions use `HttpOnly`, `Secure`, `SameSite=Strict` `__Host-` cookies in production, and admin responses are private/no-store.

The app also sends CSP, HSTS, clickjacking, MIME-sniffing, referrer and permissions headers, hides the framework header, and keeps public-article PWA caches to seven days and fifty entries. The built-in limiter is intentionally a second line of defense because Vercel instances do not share memory. Before high-traffic promotion, enable a Vercel WAF or distributed Redis/KV rate rule and configure a hard provider spending alert/limit; those external controls may have separate pricing.

## Development

```bash
npm run dev
```

Open the URL printed by Next.js, usually `http://localhost:3000`.

## API Test

With the dev server running, send a POST request to `/api/explain-word`:

```json
{
  "word": "addressed",
  "sentence": "He addressed the issue carefully.",
  "previousSentence": "The team found several problems.",
  "nextSentence": "Their solution worked well."
}
```

If the API key is missing, the route returns a clear error instead of exposing secrets to the browser.

DeepSeek explanation, full-article translation, sentence-question, and summary routes default to `deepseek-v4-pro` with thinking disabled. `DEEPSEEK_MODEL` can still override the model when needed.

Word explanation cache entries are durable browser data. On a cache miss, the completed stream's visible fields are merged into the structured response and that merged result is cached. Progressive output, completed display, and cache replay therefore use the same content and field order. Common collocations include concise Chinese translations in parentheses. Regenerating an explanation also replaces a matching vocabulary entry (same selected word or phrase and source sentence) while preserving its identity, creation time, and Anki import record.

## Main Routes

- `/api/explain-word` explains a word or short phrase from sentence context.
- `/api/explain-word-stream` streams fixed-label text for progressive rendering; its completed visible fields are merged into the durable explanation.
- `/api/dictionary` provides a detailed context-free lookup for one English word or a phrase of up to eight words and charges the normal generated-lookup allowance.
- `/api/translate-article` translates article text blocks into Chinese for the reading view's full-article translation sidebar.
- `/api/ask-sentence` answers follow-up questions about the selected sentence.
- `/api/summarize-article` creates a short Chinese summary for saved article lists.
- `/api/import-url` imports public HTML articles into structured reading blocks and returns description plus cover-image candidates when available.
- `/api/ocr-image` extracts text from an uploaded image up to 8MB.
- `/api/ocr-image-layout` detects clickable word boxes from an uploaded image, data URL, or remote image URL.
- `/api/ocr-image-url` extracts text from a remote image URL; automatic calls for imported article images remain disabled in the reader.
- `/api/download-image` proxies a remote image as a validated attachment up to 20MB for the image viewer's download action.
- `/api/anki/*` supports Anki model/deck helpers; note creation still depends on local AnkiConnect from the browser.
- `/api/public-articles` lists public recommended articles.
- `/api/public-articles/[id]` reads one public article and its preloaded explanations and full-article translations.
- `/api/auth/*` registers and signs in phone + numeric-password accounts, keeps legacy email OTP/hosted-login compatibility, reads the current session, and logs out through server-managed HttpOnly cookies.
- `/api/account/sync` reads and compare-and-swap merges versioned learning objects; `/api/account/export` downloads account data and recent usage actions; `/api/account/vocabulary-repair` performs an authenticated, idempotent cleanup of historical duplicate vocabulary rows.
- `/api/usage/cache-lookup` charges cached guest lookups while leaving registered cache hits free.
- `/api/admin/article-classification` assigns a Chinese learner difficulty, CEFR reference, audience stages, interest topics, reading time, timeliness, and Chinese summary; it falls back to local readability rules if DeepSeek is unavailable.
- `/api/admin/article-candidates` saves `published=false` candidates, lists them, batch-publishes selected ready candidates, and deletes drafts. `/api/admin/article-covers` uploads reviewed cover files to the public Supabase Storage bucket.
- `/api/admin/*` handles candidate review/publishing, account and quota controls, the private feedback inbox, and detailed automatic error records. Access accepts either the server-verified developer account (`plan_id=admin`) or the legacy password-admin session; same-origin checks still protect writes.
- `/account/usage` is the member usage view; `/account/repair-vocabulary` runs the signed-in vocabulary repair; `/admin` combines public recommendations with the administrator account and quota console.

## Public Recommendations

Assign the owner's account to the `admin` plan, then use the homepage account/Menu entry to open `/admin`; `ADMIN_PASSWORD` remains a recovery login. Build a candidate from a browser-local saved article, pasted text, or a public URL. All three sources use the same metadata editor. Classification is system-owned; the admin checks the article, generated summary, and cover, then saves to the candidate list. Candidate and published rows open the exact production `ReaderView`, so lookup, vocabulary saving, translation, local article saving, and in-place editing work normally. Saving a Reader edit updates that candidate or public recommendation; title, summary, classification, and cover remain editable in the Admin metadata flow. Publication exists only in the candidate list. Automatic discovery is collapsed below the main workflow and accepts a topic, optional difficulty, and target inventory; it reads the reviewed NASA, ScienceDaily, Smithsonian Magazine, Aeon, Literary Hub, and NPR Technology RSS/Atom feeds, deduplicates source URLs, imports the full article, and saves at most two new candidates per run. A daily Vercel Cron run rotates through the six topics and targets six reviewed-or-pending articles per topic. Neither manual nor scheduled discovery publishes automatically.

All intake modes can save an incomplete candidate, but publishing requires a cover. Candidate rows reuse `public_articles` with `published=false`; classification and cover metadata are stored in `imported_article.recommendation`, so the public table needs no destructive migration. Selected ready candidates can be published in a batch. Publishing a candidate that matches an existing public source updates that article instead of creating a duplicate. Cache refresh for an already-public article is a maintenance action on that public row, not a second local-article publishing flow. Set a long random `CRON_SECRET` in Vercel Production before enabling the schedule in `vercel.json`.

Visitors do not need to log in. They can open public recommended articles from the homepage. The recommendation list is fetched during the server render, so it should appear immediately when the homepage loads. If the service worker has cached the app and public article API responses, those pages can reopen offline. A browser that previously verified a signed-in account keeps a minimal local identity snapshot and shows an always-visible offline banner instead of presenting that person as logged out. The snapshot grants access only to that account's browser-local saved articles, vocabulary, explanations, and translations; it never grants Admin, quota, or API authorization. Offline users can keep reading, save an article locally, and add or edit vocabulary for later sync. Previously cached explanations, standalone dictionary results, and full translations can reopen from local browser data. New AI explanations, new standalone dictionary generation, new full-article translations, URL imports, image OCR, feedback submission, cloud sync, usage reads, and new summaries still require network access.

## Pronunciation And Anki

The explanation panel and vocabulary notebook always show compact `美音` / `英音` pronunciation buttons. Supported browsers use runtime `SpeechSynthesis` voices without creating audio files; unsupported browsers keep the controls visible and explain the capability limitation after the user taps one.

Anki card backs use Anki native TTS replay controls for US and UK pronunciation. The UK control requests `en_GB` and lets Anki select an installed British English voice instead of requiring a hard-coded voice name. During import, Context Reader also tries to set the target deck's audio `autoplay` option to `false` through AnkiConnect, so pronunciation is clicked rather than played automatically.

Cloze-card fronts show the cloze sentence, a large visual gap, then the target word or phrase's exact current-context translation from the latest generated explanation. No basic meaning, full-sentence translation, fallback text, or added label is substituted into this hint.

## ChatGPT Project Context

The public repository is `galio111/context-reader`. The preferred ChatGPT workflow is to connect GitHub from ChatGPT Settings → Plugins (called Apps in OpenAI's help documentation), authorize this repository, then invoke `@GitHub` and ask it to read `AGENTS.md` plus the relevant files before discussing the project. ChatGPT's GitHub connection is a read/search context source; use Codex for local edits, validation, commits, deployment, and pushes.

GitHub reflects only committed and pushed files. It does not include local uncommitted work, browser `localStorage`, Codex memory, private Vercel/Supabase state, or secrets. At a milestone, reconcile code, docs, and memory first, then validate and push. `docs/gpt-brief.md` remains the curated fallback for product intent and hard boundaries when the connector is unavailable or the repository has not finished indexing.

## Deployment

After changing Context Reader code, run the production build and deploy the fixed production alias unless the work is explicitly local-only:

```powershell
npm.cmd run build
```

Use the production alias for user-facing links:

```powershell
npm.cmd exec -- vercel --prod --yes
```

Deployment is complete only when Vercel reports `Aliased https://context-reader-ten.vercel.app`.
