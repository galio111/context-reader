# Context Reader Integration Guide

## Production

Use the fixed production URL:

```text
https://context-reader.com
```

Do not treat Vercel deployment snapshot URLs as user-facing URLs. `https://context-reader-ten.vercel.app` is retained only as a rollback/reference origin.

Production uses the versioned Docker workflow under `ops/mainland/`: Caddy fronts the Next.js app and the private Supabase-compatible PostgreSQL/Auth/REST/Storage services. Supabase Cloud is a frozen rollback copy and is never a production request path. The compatibility variable names remain, but production Compose must set `SUPABASE_URL=http://supabase-api:8000`, take the service-role credential from the self-hosted stack, and expose `backendMode: "mainland_internal"`. Keep real credentials only in the server-side ignored environment files.

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
CRON_SECRET=...
SUPABASE_URL=http://supabase-api:8000
SUPABASE_PUBLIC_URL=https://context-reader.com
SUPABASE_SERVICE_ROLE_KEY=... # self-hosted service role; Compose supplies this from SERVICE_ROLE_KEY
ACCOUNT_COOKIE_SECRET=...
VOLCENGINE_TTS_APP_ID=...
VOLCENGINE_TTS_ACCESS_TOKEN=...
VOLCENGINE_TTS_CLUSTER=volcano_tts
VOLCENGINE_TTS_ENDPOINT=https://openspeech.bytedance.com/api/v1/tts
VOLCENGINE_TTS_US_VOICE=en_female_amanda_mars_bigtts
VOLCENGINE_TTS_UK_VOICE=en_female_emily_mars_bigtts
```

OCR routes and the dormant legacy image-import path can use either `OCR_PROVIDER=zhipu` with `ZHIPU_API_KEY`, or `OCR_PROVIDER=openai` with `OPENAI_API_KEY`. The shipped root homepage exposes no image upload, and automatic OCR for images embedded in URL-imported articles remains gated off in the reader.

`DEEPSEEK_TRANSLATION_MODEL` overrides only full-article translation. `DEEPSEEK_FALLBACK_MODELS` is a comma-separated model list used for supported retries on the primary provider. Structured word explanations can also use `DEEPSEEK_FALLBACK_BASE_URL` with optional `DEEPSEEK_FALLBACK_API_KEY` and `DEEPSEEK_FALLBACK_MODEL`. Empty fallback values disable the secondary-provider path.

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, the internal compatibility `SUPABASE_URL`, and the self-hosted `SUPABASE_SERVICE_ROLE_KEY` are needed for `/admin`, public recommendations, preloaded word explanations, and preloaded full-article translations. `CRON_SECRET` is required for the scheduled recommendation crawler. `SITE_SMTP_HOST`, `SITE_SMTP_PORT`, `SITE_SMTP_USER`, `SITE_SMTP_PASSWORD`, `SITE_SMTP_FROM`, and `SITE_NOTIFICATION_EMAIL_TO` configure its successful-completion email; these values remain server-only and the SMTP authorization code must never enter Git, logs, or command arguments. Use a long unique admin password; only the independent session secret has an enforced minimum of 32 characters. Increment `ADMIN_SESSION_VERSION` to revoke every existing admin cookie. Run the complete `docs/public-articles-supabase.sql` against the active mainland PostgreSQL database before publishing and after security/schema updates; it creates the three tables, enables RLS, and revokes direct access from browser roles and `PUBLIC`.

For accounts and usage, also set an independent `ACCOUNT_COOKIE_SECRET` and run `docs/account-usage-supabase.sql`. The visible beta flow uses `/api/auth/phone-register` and `/api/auth/phone-login`: the server maps a mainland-China phone identifier to a reserved internal Auth email, marks it unverified, and uses a six-digit numeric password as the Supabase Auth password. It sends no SMS and the internal email must never be displayed. Legacy email OTP remains available in code; if exposed publicly later, configure custom SMTP and make the template include `{{ .Token }}`. The service-role key is server-only. Do not create a `NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY`. Optional cost-rate overrides are `DEEPSEEK_CACHE_HIT_USD_PER_MILLION`, `DEEPSEEK_CACHE_MISS_USD_PER_MILLION`, and `DEEPSEEK_OUTPUT_USD_PER_MILLION`.

Cloud US/UK pronunciation requires `VOLCENGINE_TTS_APP_ID` and `VOLCENGINE_TTS_ACCESS_TOKEN` from a Volcengine Speech application. Amanda (`en_female_amanda_mars_bigtts`) is the default US voice and Emily (`en_female_emily_mars_bigtts`) is the default UK voice; the cluster, endpoint, and both voice ids remain overridable. The access token is server-only. `/api/pronunciation` accepts only a bounded English word or short phrase, and caches the returned MP3 by normalized text, accent, provider, and voice in the private `context-reader-pronunciation` Supabase Storage bucket. The server creates that bucket on first use when the service role has Storage permission.

Automatic error diagnostics use the existing private `context-reader-feedback` Storage bucket. `/api/error-reports` accepts bounded same-origin browser reports, while server routes call the same store directly; both deduplicate by operation, endpoint, status/code, category, day, and release. `/api/admin/error-reports` is server-authorized and supplies `/admin?section=errors`. Configure `ERROR_ALERT_SMTP_HOST`, `ERROR_ALERT_SMTP_PORT` (normally `465`), `ERROR_ALERT_SMTP_USER`, `ERROR_ALERT_SMTP_PASSWORD`, and optional `ERROR_ALERT_FROM` to email alerts to the fixed developer address. As an alternative, set `RESEND_API_KEY` and `ERROR_ALERT_FROM`. Storage is written before email delivery, repeated alerts are suppressed for fifteen minutes, and an unconfigured or failed email channel remains visible on the Admin record.

Production requests receive security headers and pass through bounded-body, same-origin, throttling, SSRF, and concurrency controls. The built-in rate store is per application process, so it reduces accidental bursts and simple abuse but is not a distributed quota. For a broader launch, add a reverse-proxy/cloud-firewall rule or an atomic Redis/KV limiter and an upstream provider spending cap. Review the external service's pricing before enabling it.

## Accounts, Usage, and Sync

Sync response pages are capped by serialized byte size. Protocol 2 performs a one-time snapshot bootstrap (active payloads first, then lightweight tombstone metadata) and then reads only rows after an opaque `(updated_at, kind, object_key)` cursor. The browser stores only versions, deletion flags, and stable payload hashes in its sync manifest; it does not refetch all historical objects to decide what changed. `/admin` does not auto-sync learning data; normal client tabs share a Web Lock so only one tab writes account versions at a time.

The browser talks only to Context Reader server routes; it never receives the Supabase service-role key or a public Supabase client key. `/api/auth/phone-register` creates the nickname + phone + numeric-password account and `/api/auth/phone-login` signs it in. The legacy `/api/auth/request-otp`, `/api/auth/verify-otp`, and `/api/auth/adopt-session` routes remain for email compatibility but are hidden from the current UI. `/api/auth/session` reads or refreshes the seven-day server-managed account session and `/api/auth/logout` requires a successful final sync before clearing account-associated local data.

Guests receive separate `Asia/Shanghai` day pools: ten article word/phrase lookups, five standalone dictionary lookups, two pasted-text imports and two URL imports. Cache hits, failed requests, timely cancellations and refunded work do not count. Parallel `/api/explain-word` and `/api/explain-word-stream` calls share `x-context-action-id`, producing one visible quota action while preserving separate upstream execution records. Admin can change all four guest allowances without resetting already-used units.

`GET/POST /api/account/sync` transfers versioned article, vocabulary, explanation, translation, reading-state, and preference objects. `GET ?protocol=2&bootstrap=active|deleted` establishes one bounded snapshot; `GET ?protocol=2&cursor=...` returns only later keyset-ordered changes. The old offset form remains a rollout compatibility path. Writes use expected server versions and return `409` on conflict; the client serializes concurrent callers, takes a cross-tab Web Lock, sends one object per kind/key, advances its cursor/manifest only after a successful merge, and retries conflicts up to three times. Local events debounce for about 800 ms; visible tabs pull about every 15 seconds and on focus/visibility return. Manual sync exposes waiting, receiving, merging, uploading, item counts, and elapsed time. Articles are merged by normalized body and legacy recovery lineage, retain one canonical original id, preserve the newest open time, and tombstone every duplicate id; recovery copies must not remain visible. The API converts legacy recovery-id article uploads into tombstones so stale tabs cannot recreate them, and the homepage refreshes its saved list immediately after a cloud merge. Vocabulary is normalized and deduplicated by word plus source sentence, redundant recovery ids are deleted through tombstones, and genuinely ambiguous same-id vocabulary conflicts are retained only in a separate local recovery store. Authenticated `POST /api/account/vocabulary-repair`, exposed at `/account/repair-vocabulary`, provides an idempotent server-side cleanup for historical duplicate and recovery rows. `GET /api/account/export` downloads the member's account, objects, and usage actions. `/account/usage` shows member balances; the “账号与用量” section of `/admin` manages plans, status, bonus limits, global allowances, invitation codes, usage resets, and temporary password resets. Payment remains disabled.

`POST /api/account/invitation-code` requires a live signed-in account and accepts the privately issued code. `GET/POST/PATCH /api/admin/invitation-codes` lists, creates and revokes codes under the existing server-verified Admin boundary. The database stores only a SHA-256 hash and non-secret last-four hint; plaintext is returned once when Admin creates the code. `ops/mainland/migrate-invitation-codes.sql` adds the table, the `invite` entitlement source and the transactional `redeem_invitation_code` RPC. One code grants Basic, Plus or Max for the configured number of days beginning at redemption. Codes may also have a separate redemption deadline. Active grants never stack; after expiry the session resolves to Free and the account may redeem another code.

The production database, secrets, Auth, and sync are active. Phone + password removes SMTP as a beta-launch blocker, but phone ownership is not verified and lost passwords require an administrator reset. Public email login remains unfinished until custom SMTP and a Supabase template containing `{{ .Token }}` are verified with a non-team address.

## Public Recommendations

Visitors read public recommendations directly from the homepage. The server render loads both article summaries and the independent `homepage_publication_curation` setting, so publication does not automatically place an article in the visitor showcase. The external-publication header's guest preference is browser-local; the account-scoped reading level/interests are transported as protocol-2 `preferences/homepage-recommendation-preferences`. Login must not overwrite an existing account preference with the current guest choice or reflow the page mid-journey.

The primary Admin entry is a signed-in account whose server-verified entitlement is `admin`; the homepage/Menu exposes `/admin` only for that account. `ADMIN_PASSWORD` remains a recovery login, not the normal developer-account path. After authorization, the admin page supports:

- equal paste and URL intake modes,
- URL extraction of structured content, meaningful inline images, description, and cover candidates,
- automatic Chinese-learner classification with an editable result,
- saving incomplete candidates with `published=false`, while blocking publication until a cover is present,
- selecting specific ready candidates and publishing only those,
- merging cached explanations and full-article translation caches into an existing public article instead of duplicating it,
- deleting public recommendations,
- reviewing detailed automatic site/API/provider/client errors, marking them resolved, reopening them, or deleting their private records.

`GET /api/public-articles` lists public articles. `GET /api/public-articles/[id]` returns one article with preloaded word explanations and full-article translation caches. `GET /api/admin/article-candidates` returns active and rejected queues; `POST` saves/publishes, `PATCH` rejects or restores without losing crawler deduplication, and `DELETE` remains an explicit destructive maintenance action. Publishing accepts the editorial category plus featured flag and atomically follows successful publication by prepending the article to global `推荐` and placing it in that category. `POST /api/admin/article-classification` classifies content, `POST /api/admin/article-covers` uploads cover files, and its protected `PATCH` action localizes selected or all legacy candidate and published external media. Candidate creation deduplicates canonical URL, normalized title and stable body identity before inserting. Remote candidate covers and body images are fetched during candidate save through the pinned-DNS safe fetcher, normalized to bounded WebP files with Sharp, and stored under content-addressed keys in the active public Storage bucket. Failure never leaves a browser external URL: an unavailable cover is cleared to a text-edition card, an unavailable body-image block is removed, and the English text remains eligible for review and publication. A source article with no meaningful image is intentionally valid. Ordinary user URL intake returns text first and localizes selected images after Reader opens; Admin/crawler extraction receives the same cleaned text immediately, while durable candidate saving still completes its first-party-or-omit media contract before the candidate row is accepted. Direct origin fetch is preferred; `images.weserv.nl` is only a server-side ingestion fallback for public sources that mainland egress or anti-hotlink rules cannot fetch directly, with TIME using it first because its static CDN is known to time out. The original URL passes private-network/DNS checks before proxy construction, downloaded bytes still pass size, pixel and Sharp checks, and stored article data receives only the resulting first-party Storage URL. `ops/mainland/repair-public-covers.py --id ARTICLE_ID` repairs candidate and published inventory; `ops/mainland/repair-saved-article-images.py` repairs versioned account article objects with compare-and-swap semantics. `GET/PATCH/POST /api/admin/article-crawler` exposes the crawler state, saves the daily enabled/time/count controls, starts manual runs, and sends an explicit test email. Manual crawler requests send `topic`, `difficulty`, `maxNewArticles` from one to six, and `inventoryScope`; they intentionally add up to that many new candidates regardless of existing inventory while preserving URL/title/body deduplication and all import/classification checks. Admin writes require the admin session cookie.

On the mainland server, `context-reader-recommendations.timer` wakes every five minutes and calls `GET /api/cron/recommendations` with `Authorization: Bearer $CRON_SECRET`. The application compares the current Asia/Shanghai time with the Admin-configured time, skips disabled/not-due/already-completed dates, and runs at most once per Shanghai day. A scheduled success records counts and sends one summary email; manual runs do not send that completion email. `vercel.json` keeps the former fixed `19:00 UTC` schedule only for rollback and must not run alongside the mainland timer.

## Offline Behavior

The production site is a PWA. After a browser opens the site online once, the app shell can reopen offline. Public article API responses are cached network-first, so articles already loaded by that browser can reopen offline. A previously verified account is represented offline by a minimal local snapshot containing its user id, nickname, and last verification time. This snapshot only unlocks the same browser's local articles, vocabulary, and caches; server authorization, Admin visibility, plan, and quota always require a live verified session. The persistent offline banner states what remains available.

Offline remembered accounts can read and save local articles, update local vocabulary, and replay cached explanations, standalone dictionary results, and full translations. New AI explanations, standalone dictionary generation, new full-article translations, URL import, feedback submission, summary generation, cloud sync, and usage reads require network access. `GET /api/auth/session` returns `503` when its account dependencies are unavailable so the client preserves the offline identity instead of misclassifying the user as a guest. `GET /api/connectivity` is an uncached same-origin reachability probe used by the persistent banner; account checks time out, distinguish a network outage from an account-service outage, retry while the page is visible, and provide explicit checking and recovery feedback.

## URL Import

`POST /api/import-url`

```json
{
  "url": "https://example.com/article"
}
```

Returns an `article` object with `title`, `url`, `siteName`, plain `text`, structured `blocks`, and optional `byline`, `publishedTime`, and `language`, plus `metadata.description` and up to twelve `metadata.coverCandidates`. Cover candidates prefer Open Graph and Twitter metadata, then meaningful article images. Remote scripts are never executed. The response does not wait for selected image blocks to be downloaded or stored, so image failure cannot fail an otherwise valid text import.

The importer compares Mozilla Readability with article-semantic DOM candidates instead of trusting one extractor. It removes explicit hidden/inert/ARIA-hidden content and high-confidence advertising, sponsored, navigation, related-card, newsletter, sharing, comment, author-card and embedded media-control modules. Raw iframe/embed strings, generic Download/Transcript controls, caption toggles, standalone photo credits, trailing editor credits and site legal boilerplate are also excluded. Repeated link-dense teaser cards and images whose link target is another article are omitted; ordinary inline citations remain. A standalone advertisement label is removed unless the surrounding article is substantively about advertising. The shared trailing-boundary sanitizer only activates after sufficient article content and also recognizes explicit `-end-` markers, so media contacts or related sections can be excluded without truncating the article body.

Text blocks may include optional `inline` segments; segment `baseline` can be `sup` or `sub`. List items include optional `listStyle`, `listLevel`, and `listOrdinal`. Table blocks contain `table.caption` and ordered `rows`; cells preserve text, header status, row/column scope, and bounded `rowSpan`/`colSpan`. Image blocks preserve source `width`, `height`, and captions when available. After Reader opens, the client posts the fresh article and its short-lived, source-bound image token to the rate-limited `/api/article-images/localize` route. External images may render transiently when the current network can reach them, but they do not gate the text. Their stored or fallback aspect ratio reserves the final layout; successful first-party replacements therefore do not reflow the article. Failed fresh-import images are removed and reported calmly while the text remains intact. Saving stays available during this work, and a completed result also patches a copy saved before localization finished. The reader gives wide tables a local horizontal scroller on narrow screens and still tokenizes cell text for contextual lookup. Imported tables and images stay read-only during in-canvas editing but may be deleted whole. Backward-compatible `ocrText`, `layoutWords`, and `layoutError` metadata remain accepted, while automatic OCR for URL-imported images stays disabled. Login walls, strong anti-bot rules, and fully dynamic pages can still fail.

## Standalone Dictionary

`POST /api/dictionary`

`POST /api/dictionary-stream`

```json
{
  "query": "take in"
}
```

The query may be a Chinese word/short phrase, one English word, or an English phrase of at most eight words. `/api/dictionary-stream` returns newline-delimited JSON events in final display order, and the accumulated event model is the durable `DictionaryResult`. The first event labels the direction as `en_to_cn` or `cn_to_en`; English input also receives `valid`, `inflection`, or `misspelled`. English-to-Chinese keeps the rich contract: bilingual senses and examples, a `verbForms` event when the entry can be a verb, concrete usage guidance, 3-6 common collocations, reasonable word-family and synonym rows, genuine mistakes, and a credible memory hint. For Chinese-to-English, the Chinese query remains the visible headword. Each streamed sense is one candidate English expression with its own IPA, part of speech/register, short usage note, and bilingual example; senses with the same part of speech stay adjacent so the client can render explicit part-of-speech groups, and the final usage event compares how to choose among candidates. One candidate is valid when it is genuinely sufficient, while multiple candidates must be returned when ordinary contexts call for different English choices. Chinese-to-English skips the English-to-Chinese word-family, collocation, synonym, verb-form, and memory sections. Both directions share the existing DeepSeek defaults, one-unit usage action, concurrency guard, execution ledger, durable cache, recent-first history, account sync, and offline replay behavior. The UI regenerate action issues the same request with a fresh action id while bypassing local cache.

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

Valid block types are `heading`, `subheading`, `paragraph`, `quote`, `list-item`, `caption`, and `table`. A table's flattened text uses newline-delimited rows and ` | `-delimited cells for translation context while the durable imported block retains the structured grid. The route sanitizes oversized input and calls DeepSeek with the current default model. In the app UI, long articles are translated one text block at a time so the first completed paragraph appears immediately and later paragraphs continue appending after it. Every completed block immediately updates the merged partial result and per-block cache in browser `localStorage`; incomplete work resumes from missing blocks after a refresh or later return. The route returns structured temporary-error codes for provider throttling, overload, timeout, and connectivity failures so the client can queue and back off without losing progress, while quota, balance, and configuration failures remain explicit. Admin publishing uploads the matching full-article translation cache to Supabase when the article hash matches.

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

The reader starts this request in parallel with `/api/explain-word` on cache misses. Streamed text fills the final `ExplanationPanel` visual tree progressively. After both requests finish, the client parses the stream's fixed labels, merges those visible fields into the structured response, caches the merged explanation, and leaves the completed stream text in place. It does not swap in a separately generated visible result. Progressive output, completed display, and cache replay therefore keep identical content, field order, spacing, and wrapping width. A stable scrollbar gutter prevents the action controls from changing text width when they appear. The structured response supplies hidden fields such as Anki metadata, and action controls unlock only after both requests complete. The structured route retries one transient network, timeout, HTTP 429/5xx, or empty JSON-mode response; persistent failures are stored in Admin with separate HTTP, timeout, transport, empty-content, and parse codes.

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

`POST /api/ocr-image-layout` accepts either the same multipart upload, a JSON data URL, or a JSON remote `url`. It returns `words` with `text`, percentage `x/y/width/height`, and `lineText`. The dormant legacy image-import path can call text and layout OCR in parallel, preserve the original image, and use the word boxes for click-to-explain when layout detection succeeds; it is not exposed on the root homepage. Plain OCR text remains the fallback reading body for any compatible stored legacy image article.

Automatic OCR for images inside URL-imported articles remains disabled in `ReaderView`; stored legacy OCR/layout metadata is still accepted. Imported images can be enlarged, cursor-anchored zoomed, and downloaded. Anonymous `POST /api/article-images/localize` accepts only the explicit `freshImport` path used immediately after extraction and removes failed image blocks; authenticated calls lazily repair external image blocks in a historical browser-local saved article and keep failures retryable, while the protected Admin migration repairs synced cloud objects. Remote downloads for legacy data use `GET /api/download-image?url=...&filename=...`, which validates image content and enforces a 20MB limit.

## Anki

Anki import depends on local browser access to AnkiConnect:

- Anki must be open.
- AnkiConnect must be installed.
- `http://127.0.0.1:8765` should respond with version 6.
- CORS must include `https://context-reader.com`; include `https://context-reader-ten.vercel.app` too only when maintaining rollback compatibility.

The public `/guide` route provides the user-facing setup flow. It detects the current device, links to the official Anki desktop download, copies AnkiConnect add-on code `2055492159`, tests the local connection, and reveals a targeted troubleshooting list plus a copyable production-origin configuration when the check fails. Clipboard copying falls back to a temporary selectable field for restricted browsers. A webpage cannot silently install desktop software or operate Anki before AnkiConnect exists, so the guide describes this as a three-step assisted setup rather than a literal one-click install.

Context Reader creates or updates its Anki note templates during import. Cloze-card fronts show the cloze sentence first, then a large gap, then only the target word or phrase's exact current-context translation from the latest generated explanation. The hint does not include the basic meaning, full-sentence translation, fallback text, or an added label. New notes attach the same cloud-generated US and UK MP3 files used by the website to `AudioUS` and `AudioUK`; each card back plays the media field first and keeps Anki native `en_US`/`en_GB` TTS as a compatibility fallback when cloud audio is unavailable. Standalone English queries use `basic_en_to_cn`: the front remains English-only, while the formatted back includes Chinese senses and the complete study detail. Standalone Chinese queries use `basic_cn_to_en_dictionary`: the front contains the Chinese cue and the back contains the primary English expression, all returned alternatives, IPA, both pronunciation controls, candidate usage notes, examples, concise choice guidance, and any genuine mistake warning. `ensureModel` refreshes either template before a later import.

IPA ownership is explicit across explanation, standalone dictionary, vocabulary and Anki data. New provider results write `phoneticFor` with the exact English form described by `phonetic`; English-to-Chinese requests require it to equal the selected/query form rather than `lemma`. UI and export code shows IPA only when that ownership matches `Word`. Anki backs render `原型` and `当前词音标` as separate rows, and their US/UK audio always uses `Word`. Legacy rows without `phoneticFor` remain readable, but an IPA is considered safe only when normalized `Word` and `Lemma` are identical; otherwise regenerate the lookup before expecting IPA in the UI, CSV, or a new Anki note.

Context Reader does not bulk-upgrade legacy Anki cards. For each future vocabulary import it retries transient pronunciation failures and creates the note only after both cloud MP3 files are ready, so every successful new import contains `AudioUS` and `AudioUK`. A persistent provider or network failure creates no partial card and can be retried later. AnkiConnect writes each file into desktop Anki's media collection, after which normal AnkiWeb media sync makes the identical recordings available in AnkiMobile and AnkiDroid. Context Reader still tries to set the target deck config's `autoplay` option to `false`, so pronunciation plays only when the user clicks it. If deck config writes are unavailable, note import continues and audio autoplay can be disabled manually in Anki's deck options.

The notebook treats a stored `ankiNoteId` as the normal import receipt. When it opens, it also silently checks the configured local deck for Context Reader cards whose `CreatedAt` and `Word` fields match a local entry that lacks that receipt. Matching cards are marked as imported locally without creating another Anki note, which repairs an interrupted browser-side receipt write while keeping the visible `导入未导入` count accurate.
