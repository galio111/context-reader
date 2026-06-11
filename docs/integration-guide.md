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
OCR_PROVIDER=zhipu
ZHIPU_API_KEY=...
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_OCR_MODEL=glm-4.6v-flash
OPENAI_API_KEY=...
OPENAI_OCR_MODEL=gpt-4o-mini
ADMIN_PASSWORD=...
ADMIN_SESSION_SECRET=...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

Image OCR is currently disabled in the UI and API routes. The provider framework is retained for future use. If OCR is re-enabled, set either `OCR_PROVIDER=zhipu` with `ZHIPU_API_KEY`, or `OCR_PROVIDER=openai` with `OPENAI_API_KEY`.

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are needed for `/admin`, public recommendations, and preloaded public explanations. Run `docs/public-articles-supabase.sql` in Supabase before publishing.

## Public Recommendations

Visitors read public recommendations directly from the homepage. The homepage receives the initial recommendation list from the server render, so it should not show an empty recommendation area while waiting for a browser-side fetch.

Admins open `/admin`, log in with `ADMIN_PASSWORD`, then publish saved local articles to Supabase. The admin page supports:

- publishing a single local saved article,
- selecting specific local articles and publishing only those,
- merging cached explanations into an existing public article instead of duplicating it,
- deleting public recommendations.

`GET /api/public-articles` lists public articles. `GET /api/public-articles/[id]` returns one article with preloaded explanations. Admin writes use `/api/admin/public-articles` and require the admin session cookie.

## Offline Behavior

The production site is a PWA. After a browser opens the site online once, the app shell can reopen offline. Public article API responses are cached network-first, so articles already loaded by that browser can reopen offline. New AI explanations, URL import, and summary generation require network access. OCR is currently disabled.

## URL Import

`POST /api/import-url`

```json
{
  "url": "https://example.com/article"
}
```

Returns an `article` object with `title`, `url`, `siteName`, plain `text`, and structured `blocks`. Text blocks may include optional `inline` segments; when present, segment `baseline` can be `sup` or `sub` so clients can render original upper/lower annotations while still using plain `text` for search and explanation context. Image blocks can later store `ocrText` after the reader calls `/api/ocr-image-url`. The route works best on publicly accessible HTML pages. Login walls, strong anti-bot rules, and fully dynamic pages can fail.

## OCR

`POST /api/ocr-image`

This route is retained for future image OCR but currently returns 503 while `IMAGE_OCR_ENABLED` is `false`. When enabled, send multipart form data with one `image` file. The route returns:

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

This route is retained for future imported-article image OCR but currently returns 503 while `IMAGE_OCR_ENABLED` is `false`. When enabled, it fetches a remote imported-article image server-side, sends it to the configured vision model, and returns:

```json
{
  "text": "Extracted English text..."
}
```

The reader no longer shows the OCR text layer while OCR is disabled. Imported article images still render and can be opened in the enlarged image viewer. If OCR is re-enabled, the text layer is separate from the image pixels; positioned image-word overlays would require a future OCR response with word bounding boxes.

## Anki

Anki import depends on local browser access to AnkiConnect:

- Anki must be open.
- AnkiConnect must be installed.
- `http://127.0.0.1:8765` should respond with version 6.
- CORS must include `https://context-reader-ten.vercel.app`.
