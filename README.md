# Context Reader

Context Reader is a Next.js app for importing English text, public webpages, or images and reading them with Chinese context-aware explanations, full-article translation, vocabulary capture, and Anki export.

Production URL: `https://context-reader-ten.vercel.app`

## Features

- Paste an English article and enter plain-text reading mode.
- Import a public article URL, preserve headings, paragraphs, lists, quotes, meaningful images, and inline upper/lower annotations, and exclude navigation, citations, related stories, recommendation modules, comments, and other page chrome from the reading body.
- Save imported URL articles with their rich layout metadata so reopening from the homepage restores the same layout.
- Edit saved article text directly in the reading canvas, with global reading-session undo/redo controls and the same typography classes used by reading mode. Explicit blank lines are preserved. Editing disables word lookup; imported images remain read-only but can be removed as whole image blocks.
- Persist article edits in browser storage, merge duplicate and legacy recovery-copy records into one logical article, record each article's latest open time, expose saved articles once each from the first-screen top menu in most-recently-opened order, and jump from the in-reader vocabulary drawer to a matching word in another saved article.
- Click an imported article image to enlarge it. The image viewer uses cursor-anchored mouse-wheel zoom within a fit-to-window range so the full image remains visible, without internal viewer scrollbars or background article scrolling.
- Upload an English screenshot or scan from the homepage. Text OCR and layout-word detection run in parallel; the original image is preserved, and detected word boxes can be clicked in the image viewer. Automatic OCR for images inside URL-imported articles remains disabled.
- Click English words without sending the full article to AI.
- Use the standalone dictionary inside the `/home-v2` start-reading spread when no source sentence exists. It accepts one English word or a phrase of up to eight words and returns IPA, senses, usage distinctions, collocations, word family, synonyms, common mistakes, and a memory hint without replacing the current book spread.
- Explain only `word`, `sentence`, `previousSentence`, and `nextSentence`.
- Stream word explanations in the final explanation-panel shape while the full structured explanation continues generating. The completed stream's visible fields are merged into the durable explanation so progressive output, completed display, and cache replay remain identical; action controls appear after both requests complete.
- Cache explanations in `localStorage` by `word + sentence`.
- Translate the full article from the reading view's right sidebar after the user clicks the sidebar's start button. Full-article translation runs one text block at a time, appends completed blocks as they return, sends the full article as context for each request, caches results per text block in `localStorage`, and continues running if the user switches back to word explanations or temporarily opens another article. After text editing, unchanged blocks retain their translations while the panel marks changed blocks for selective refresh; circular regenerate forces a fresh full-article translation without reusing old translation caches.
- Save vocabulary entries as compressed `localStorage` data with transparent compatibility for existing uncompressed notebooks.
- Play US and UK word pronunciations in the explanation panel and vocabulary notebook using browser speech synthesis.
- Keep vocabulary entries in newest-added-first order after both local saves and account sync. The notebook virtualizes measured content-height cards, keeps extended fields behind per-entry disclosure, and pauses hidden homepage animation work while it is open so large notebooks remain responsive.
- Add recommendation candidates from browser-local saved articles, pasted articles, public URLs, or the reviewed-source crawler in `/admin`; URL and crawler intake share the same article-boundary cleanup, then candidates and published recommendations open in the real reader with lookup, vocabulary, translation, saving, and in-place body editing. Reader edits write back to the matching candidate or published row.
- Preload cached explanations and full-article translations for public recommended articles.
- Server-render the homepage recommendation list so recommendations are visible on first paint, then prefetch visible recommendation details so opening one feels close to reopening a local saved article.
- Use an immersive four-screen homepage that teaches click-to-explain and horizontal phrase selection, keeps the third screen exclusively for server-rendered recommendations, accelerates and locks desktop wheel navigation into the adjacent screen in both directions at scene boundaries, and keeps paste/URL plus the shared Menu available on the first screen. The same right-side Staggered Menu runs on `/` and `/home-v2`; layered panels and menu items enter sequentially while the closed Menu trigger remains unchanged. Hovering its `保存文章` option opens a scrollable saved-article list to the left, while the developer-only `admin后台` entry depends on the verified account entitlement. Long pasted text can expand into a desktop hover/focus preview, while returning from an article skips the first-visit loader and restores the homepage with both demonstrations complete.
- Use `/home-v2` as the approved primary homepage and future homepage implementation target; `/` remains the legacy homepage during migration. The primary homepage begins as a digital hardback on a full-height scroll track that exists from first paint, so the scrollbar never appears only after opening. The same scroll position continuously seeks both opening and closing poses, allowing wheel direction to reverse the exact current frame without timer locks or flashes. One fixed book scene moves through a blank-left/developer-foreword-right spread, the real context demo plus a right page that defaults to standalone dictionary lookup, and the server-rendered recommendation catalogue. Directory jumps always bend one direct source-to-target sheet, even when skipping a chapter. Paste and URL import remain same-page tabs; “Continue reading” appears only when history exists, and homepage image upload remains absent. The former full preference chapter is now a recommendation-page dialog for stage, reading intensity, and interests. The recommendation spread keeps the central spine, marks that the list updates daily, uses CET-4-and-above inventory as the default pool, and refreshes immediately after personalization. Reading-history-based level inference is a future requirement and must remain manually adjustable. The selected B hybrid engine keeps a custom cover, spine, page blocks and back board mounted continuously, while the MIT `page-flip` package bends a single non-interactive DOM snapshot sheet containing the outgoing and incoming spreads. Wawa R3F is a visual reference only. Narrow desktop keeps a 1160 px minimum spread with symmetric edge crop rather than a distorted narrow book; mobile falls back to a single-page edge pass. The original desktop cursor-letter trail stays visibly above the book, controls, forms, and overlays while masking only reading and explanation content, then disappears inside the reader. Editable fields always retain normal visible text selection.
- Install as a PWA and reopen the cached app shell while offline.
- Open the vocabulary notebook from either the homepage or the reading view.
- Use `/guide` for a newcomer-oriented explanation of the product, the first-reading workflow, context learning versus isolated word lists, a three-step Anki/AnkiConnect setup assistant, daily study guidance, and grouped FAQs.
- Export vocabulary as CSV or import vocabulary entries to Anki through browser-side AnkiConnect, with click-to-play US/UK pronunciation buttons on card backs.
- Use unverified phone-identifier + six-digit numeric-password accounts, a ten-lookups-per-day guest trial, separate lookup/deep-reading quotas, cross-device learning-data sync, `/account/usage`, and the unified `/admin` console. Admin presents ordinary-user quotas in Chinese, hides developer safety limits and inactive price experiments, and includes the private user-feedback inbox. No SMS is sent, and online payment remains disabled while pricing is tested.

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
```

Homepage image reading is enabled and supports `OCR_PROVIDER=zhipu` or `OCR_PROVIDER=openai`. For Zhipu, set `ZHIPU_API_KEY`; for OpenAI, set `OPENAI_API_KEY`. If `OCR_PROVIDER` is omitted, the app uses Zhipu when `ZHIPU_API_KEY` exists, otherwise OpenAI when `OPENAI_API_KEY` exists. OCR for images embedded in URL-imported articles is still gated off in the reader. Do not commit `.env.local`.

The `DEEPSEEK_TRANSLATION_MODEL` override applies only to full-article translation. `DEEPSEEK_FALLBACK_MODELS` is a comma-separated fallback model list on the primary provider; `DEEPSEEK_FALLBACK_BASE_URL`, `DEEPSEEK_FALLBACK_API_KEY`, and `DEEPSEEK_FALLBACK_MODEL` configure an optional secondary provider for structured word explanations. Leave optional fallback values blank to disable that path.

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `ACCOUNT_COOKIE_SECRET` are required for the complete admin/account system. Run both `docs/public-articles-supabase.sql` and `docs/account-usage-supabase.sql`. The visible beta flow registers a nickname, mainland-China phone identifier, and six-digit numeric password without sending SMS. The server maps the phone to a reserved internal Auth email and Supabase hashes the password; the internal email is never a user-facing identity. Legacy email OTP routes remain available but hidden. If email login returns, custom SMTP and a template containing `{{ .Token }}` are still required for public delivery. See `docs/account-usage-plan.md` for product rules, quotas, sync conflict behavior, and rollout gates.

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
- `/api/admin/*` handles candidate review/publishing, account and quota controls, and the private feedback inbox. Access accepts either the server-verified developer account (`plan_id=admin`) or the legacy password-admin session; same-origin checks still protect writes.
- `/account/usage` is the member usage view; `/account/repair-vocabulary` runs the signed-in vocabulary repair; `/admin` combines public recommendations with the administrator account and quota console.

## Public Recommendations

Assign the owner's account to the `admin` plan, then use the homepage account/Menu entry to open `/admin`; `ADMIN_PASSWORD` remains a recovery login. Build a candidate from a browser-local saved article, pasted text, or a public URL. All three sources use the same metadata editor. Classification is system-owned; the admin checks the article, generated summary, and cover, then saves to the candidate list. Candidate and published rows open the exact production `ReaderView`, so lookup, vocabulary saving, translation, local article saving, and in-place editing work normally. Saving a Reader edit updates that candidate or public recommendation; title, summary, classification, and cover remain editable in the Admin metadata flow. Publication exists only in the candidate list. Automatic discovery is collapsed below the main workflow and accepts a topic, optional difficulty, and target inventory; it reads the reviewed NASA, ScienceDaily, Smithsonian Magazine, Aeon, Literary Hub, and NPR Technology RSS/Atom feeds, deduplicates source URLs, imports the full article, and saves at most two new candidates per run. A daily Vercel Cron run rotates through the six topics and targets six reviewed-or-pending articles per topic. Neither manual nor scheduled discovery publishes automatically.

All intake modes can save an incomplete candidate, but publishing requires a cover. Candidate rows reuse `public_articles` with `published=false`; classification and cover metadata are stored in `imported_article.recommendation`, so the public table needs no destructive migration. Selected ready candidates can be published in a batch. Publishing a candidate that matches an existing public source updates that article instead of creating a duplicate. Cache refresh for an already-public article is a maintenance action on that public row, not a second local-article publishing flow. Set a long random `CRON_SECRET` in Vercel Production before enabling the schedule in `vercel.json`.

Visitors do not need to log in. They can open public recommended articles from the homepage. The recommendation list is fetched during the server render, so it should appear immediately when the homepage loads. If the service worker has cached the app and public article API responses, those pages can reopen offline. Previously cached explanations and full translations can reopen from local browser data. New AI explanations, new full-article translations, URL imports, image OCR, and new summaries still require network access.

## Pronunciation And Anki

The explanation panel and vocabulary notebook always show compact `美音` / `英音` pronunciation buttons. Supported browsers use runtime `SpeechSynthesis` voices without creating audio files; unsupported browsers keep the controls visible and explain the capability limitation after the user taps one.

Anki card backs use Anki native TTS replay controls for US and UK pronunciation. The UK control requests `en_GB` and lets Anki select an installed British English voice instead of requiring a hard-coded voice name. During import, Context Reader also tries to set the target deck's audio `autoplay` option to `false` through AnkiConnect, so pronunciation is clicked rather than played automatically.

Cloze-card fronts show the cloze sentence, a large visual gap, then the target word or phrase's exact current-context translation from the latest generated explanation. No basic meaning, full-sentence translation, fallback text, or added label is substituted into this hint.

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
