# Context Reader Integration Guide

## Production

Use the fixed production URL:

```text
https://context-reader-ten.vercel.app
```

Do not treat Vercel deployment snapshot URLs as user-facing URLs.

## Environment Variables

```env
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TRANSLATION_MODEL=
DEEPSEEK_FALLBACK_MODELS=
DEEPSEEK_FALLBACK_BASE_URL=
DEEPSEEK_FALLBACK_API_KEY=
DEEPSEEK_FALLBACK_MODEL=
OCR_PROVIDER=zhipu
ZHIPU_API_KEY=...
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_OCR_MODEL=glm-4.6v-flash
OPENAI_API_KEY=...
OPENAI_OCR_MODEL=gpt-4o-mini
ADMIN_PASSWORD=...
ADMIN_SESSION_SECRET=...
ADMIN_SESSION_VERSION=1
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ACCOUNT_COOKIE_SECRET=...
```

Homepage image reading is enabled. Configure either `OCR_PROVIDER=zhipu` with `ZHIPU_API_KEY`, or `OCR_PROVIDER=openai` with `OPENAI_API_KEY`. Automatic OCR for images embedded in URL-imported articles remains gated off in the reader even though the OCR routes are available.

`DEEPSEEK_TRANSLATION_MODEL` overrides only full-article translation. `DEEPSEEK_FALLBACK_MODELS` is a comma-separated model list used for supported retries on the primary provider. Structured word explanations can also use `DEEPSEEK_FALLBACK_BASE_URL` with optional `DEEPSEEK_FALLBACK_API_KEY` and `DEEPSEEK_FALLBACK_MODEL`. Empty fallback values disable the secondary-provider path.

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are needed for `/admin`, public recommendations, preloaded word explanations, and preloaded full-article translations. Use a long unique password; only the independent session secret has an enforced minimum of 32 characters. Increment `ADMIN_SESSION_VERSION` to revoke every existing admin cookie. Run the complete `docs/public-articles-supabase.sql` in Supabase before publishing and after security/schema updates; it creates the three tables, enables RLS, and revokes direct access from browser roles and `PUBLIC`.

For accounts and usage, also set an independent `ACCOUNT_COOKIE_SECRET` and run `docs/account-usage-supabase.sql`. The visible beta flow uses `/api/auth/phone-register` and `/api/auth/phone-login`: the server maps a mainland-China phone identifier to a reserved internal Auth email, marks it unverified, and uses a six-digit PIN as the Supabase Auth password. It sends no SMS and the internal email must never be displayed. Legacy email OTP remains available in code; if exposed publicly later, configure custom SMTP and make the template include `{{ .Token }}`. The service-role key is server-only. Do not create a `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`. Optional cost-rate overrides are `DEEPSEEK_CACHE_HIT_USD_PER_MILLION`, `DEEPSEEK_CACHE_MISS_USD_PER_MILLION`, and `DEEPSEEK_OUTPUT_USD_PER_MILLION`.

Production requests receive security headers and pass through bounded-body, same-origin, throttling, SSRF, and concurrency controls. The built-in rate store is per Vercel instance, so it reduces accidental bursts and simple abuse but is not a distributed quota. For a broader launch, add Vercel WAF rate limiting or an atomic Redis/KV limiter and an upstream provider spending cap. Review the external service's pricing before enabling it.

## Accounts, Usage, and Sync

Sync response pages are capped by serialized byte size so large accounts stay below Vercel's function response ceiling. `/admin` does not auto-sync learning data; normal client tabs share a Web Lock so only one tab writes account versions at a time.

The browser talks only to Context Reader server routes; it never receives the Supabase service-role key or a public Supabase client key. `/api/auth/phone-register` creates the nickname + phone + PIN account and `/api/auth/phone-login` signs it in. The legacy `/api/auth/request-otp`, `/api/auth/verify-otp`, and `/api/auth/adopt-session` routes remain for email compatibility but are hidden from the current UI. `/api/auth/session` reads or refreshes the seven-day server-managed account session and `/api/auth/logout` requires a successful final sync before clearing account-associated local data.

Guests receive ten word/phrase lookups per `Asia/Shanghai` day. Cached guest lookups call `/api/usage/cache-lookup` and count; authenticated cache hits, failed requests, timely cancellations, and refunded work do not. Parallel `/api/explain-word` and `/api/explain-word-stream` calls share `x-context-action-id`, producing one visible quota action while preserving separate upstream execution records.

`GET/POST /api/account/sync` transfers versioned article, vocabulary, explanation, translation, reading-state, and preference objects. Server reads are paginated past Supabase's default 1,000-row cap up to the route's 20,000-object limit. Writes use expected server versions and return `409` on conflict; the client serializes concurrent callers, takes a cross-tab Web Lock, sends one object per kind/key, refetches the complete version list, merges, and retries up to three times. Articles are merged by normalized body and legacy recovery lineage, retain one canonical original id, preserve the newest open time, and tombstone every duplicate id; recovery copies must not remain visible. The API converts legacy recovery-id article uploads into tombstones so stale tabs cannot recreate them, and the homepage refreshes its saved list immediately after a cloud merge. Vocabulary is normalized and deduplicated by word plus source sentence, redundant recovery ids are deleted through tombstones, and genuinely ambiguous same-id vocabulary conflicts are retained only in a separate local recovery store. Authenticated `POST /api/account/vocabulary-repair`, exposed at `/account/repair-vocabulary`, provides an idempotent server-side cleanup for historical duplicate and recovery rows. `GET /api/account/export` downloads the member's account, objects, and usage actions. `/account/usage` shows member balances; the “账号与用量” section of `/admin` manages plans, status, bonus limits, global allowances, usage resets, and temporary PIN resets. Payment remains disabled.

The production database, secrets, Auth, and sync are active. Phone + PIN removes SMTP as a beta-launch blocker, but phone ownership is not verified and lost PINs require an administrator reset. Public email login remains unfinished until custom SMTP and a Supabase template containing `{{ .Token }}` are verified with a non-team address.

## Public Recommendations

Visitors read public recommendations directly from the homepage. The homepage receives the initial recommendation list from the server render, so it should not show an empty recommendation area while waiting for a browser-side fetch.

Admins open `/admin`, log in with `ADMIN_PASSWORD`, then publish saved local articles to Supabase. The admin page supports:

- publishing a single local saved article,
- selecting specific local articles and publishing only those,
- merging cached explanations and full-article translation caches into an existing public article instead of duplicating it,
- deleting public recommendations.

`GET /api/public-articles` lists public articles. `GET /api/public-articles/[id]` returns one article with preloaded word explanations and full-article translation caches. Admin writes use `/api/admin/public-articles` and require the admin session cookie.

## Offline Behavior

The production site is a PWA. After a browser opens the site online once, the app shell can reopen offline. Public article API responses are cached network-first, so articles already loaded by that browser can reopen offline. Previously cached explanations and full translations can reopen from local browser data. New AI explanations, new full-article translations, URL import, image OCR, and summary generation require network access.

## URL Import

`POST /api/import-url`

```json
{
  "url": "https://example.com/article"
}
```

Returns an `article` object with `title`, `url`, `siteName`, plain `text`, and structured `blocks`. The importer removes high-confidence embedded page UI such as personalization, follow, account-preference, and alert prompts. A standalone advertisement label is also removed unless the article context is substantively about advertising. Text blocks may include optional `inline` segments; when present, segment `baseline` can be `sup` or `sub` so clients can render original upper/lower annotations while still using plain `text` for search and explanation context. Image blocks preserve source `width` and `height` when the page provides them, which lets the reader reserve image space before loading; they can also retain backward-compatible `ocrText`, `layoutWords`, and `layoutError` metadata, but the reader does not automatically OCR URL-imported images. The route works best on publicly accessible HTML pages. Login walls, strong anti-bot rules, and fully dynamic pages can fail.

## Full-Article Translation

`POST /api/translate-article`

```json
{
  "blocks": [
    {
      "id": "paragraph-0",
      "type": "paragraph",
      "text": "The warning came too late, but the crew still changed course."
    }
  ]
}
```

Returns id-aligned Chinese translations:

```json
{
  "translations": [
    {
      "id": "paragraph-0",
      "translation": "警告来得太晚了，但船员们仍然改变了航向。"
    }
  ]
}
```

Valid block types are `heading`, `subheading`, `paragraph`, `quote`, and `list-item`. The route sanitizes oversized input and calls DeepSeek with the current default model. In the app UI, long articles are translated one text block at a time so the first completed paragraph appears immediately and later paragraphs continue appending after it. The panel estimates remaining time from completed blocks, and the merged result is cached in browser `localStorage`. Admin publishing uploads the matching full-article translation cache to Supabase when the article hash matches.

## Word Explanation Stream

`POST /api/explain-word-stream`

Uses the same request shape as `/api/explain-word` but returns a `text/plain` stream for progressive display:

```text
原型：address
音标：/əˈdres/
词性：动词
难度：基础
基础释义：处理；应对
当前语境含义：在当前句中表示认真处理某个问题
当前句子翻译：他认真处理了这个问题。
用法说明：常用于正式语境，表示着手解决问题。
常见搭配：address a problem; address an issue
英文例句：She addressed the concern before the meeting ended.
例句中文翻译：她在会议结束前回应了这个担忧。
```

The reader starts this request in parallel with `/api/explain-word` on cache misses. Streamed text fills the final `ExplanationPanel` visual tree progressively. After both requests finish, the client parses the stream's fixed labels, merges those visible fields into the structured response, caches the merged explanation, and leaves the completed stream text in place. It does not swap in a separately generated visible result. Progressive output, completed display, and cache replay therefore keep identical content, field order, spacing, and wrapping width. A stable scrollbar gutter prevents the action controls from changing text width when they appear. The structured response supplies hidden fields such as Anki metadata, and action controls unlock only after both requests complete.

The merged explanation is cached in browser `localStorage` by selected word or phrase plus source sentence. Common collocations use `English phrase（中文释义）` formatting. Clicking the circular regenerate control makes the latest merged result authoritative; if a matching vocabulary entry exists, its generated fields are replaced while its id, creation time, and Anki import record remain unchanged.

## OCR

`POST /api/ocr-image`

Send multipart form data with one `image` file. The route returns:

```json
{
  "text": "Extracted English text..."
}
```

Images over 8MB are rejected. Provider selection is handled by `lib/visionOcr.ts`.

`POST /api/ocr-image-url`

```json
{
  "url": "https://example.com/image.jpg"
}
```

It fetches a remote image server-side, sends it to the configured vision model, and returns:

```json
{
  "text": "Extracted English text..."
}
```

`POST /api/ocr-image-layout` accepts either the same multipart upload, a JSON data URL, or a JSON remote `url`. It returns `words` with `text`, percentage `x/y/width/height`, and `lineText`. Homepage image reading calls text and layout OCR in parallel, preserves the original image, and uses the word boxes for click-to-explain when layout detection succeeds. Plain OCR text is the fallback reading body.

Automatic OCR for images inside URL-imported articles remains disabled in `ReaderView`; stored legacy OCR/layout metadata is still accepted. Imported images can be enlarged, cursor-anchored zoomed, and downloaded. Remote downloads use `GET /api/download-image?url=...&filename=...`, which validates image content and enforces a 20MB limit.

## Anki

Anki import depends on local browser access to AnkiConnect:

- Anki must be open.
- AnkiConnect must be installed.
- `http://127.0.0.1:8765` should respond with version 6.
- CORS must include `https://context-reader-ten.vercel.app`.

Context Reader creates or updates its Anki note templates during import. Cloze-card fronts show the cloze sentence first, then a large gap, then only the target word or phrase's exact current-context translation from the latest generated explanation. The hint does not include the basic meaning, full-sentence translation, fallback text, or an added label. Card backs include Anki native US and UK TTS replay controls. The UK control requests `en_GB` without hard-coded voice names, so Anki can select an installed British voice across operating systems.

No audio files are downloaded or stored in Anki media for this feature. During import, Context Reader tries to set the target deck config's `autoplay` option to `false` through AnkiConnect, so pronunciation should play only when the user clicks the replay control. If deck config writes are unavailable in the user's Anki setup, disable audio autoplay manually in Anki's deck options.
