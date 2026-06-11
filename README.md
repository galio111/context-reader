# Context Reader

Context Reader is a Next.js app for reading English articles and clicking words to get Chinese context-aware explanations from the DeepSeek API.

Production URL: `https://context-reader-ten.vercel.app`

## Features

- Paste an English article and enter plain-text reading mode.
- Import a public article URL and preserve extracted structure such as headings, paragraphs, lists, quotes, images, and inline upper/lower annotations.
- Save imported URL articles with their rich layout metadata so reopening from the homepage restores the same layout.
- Click an imported article image to enlarge it.
- Image OCR code is retained but currently disabled in the UI and API routes.
- Click English words without sending the full article to AI.
- Explain only `word`, `sentence`, `previousSentence`, and `nextSentence`.
- Cache explanations in `localStorage` by `word + sentence`.
- Save vocabulary entries in `localStorage`.
- Publish local saved articles to a public recommendation list from `/admin`.
- Preload cached explanations for public recommended articles.
- Server-render the homepage recommendation list so recommendations are visible on first paint.
- Install as a PWA and reopen the cached app shell while offline.
- Open the vocabulary notebook from either the homepage or the reading view.
- Export vocabulary as CSV or import vocabulary entries to Anki through browser-side AnkiConnect.

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
OPENAI_API_KEY=your_openai_api_key
OPENAI_OCR_MODEL=gpt-4o-mini
OCR_PROVIDER=zhipu
ZHIPU_API_KEY=your_zhipu_api_key
ZHIPU_BASE_URL=https://open.bigmodel.cn/api/paas/v4
ZHIPU_OCR_MODEL=glm-4.6v-flash
ADMIN_PASSWORD=change_me_to_a_long_admin_password
ADMIN_SESSION_SECRET=change_me_to_a_random_session_secret
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

Image OCR is currently disabled in the UI and API routes. The provider framework is kept for future use and supports `OCR_PROVIDER=zhipu` or `OCR_PROVIDER=openai`. For Zhipu, set `ZHIPU_API_KEY`; for OpenAI, set `OPENAI_API_KEY`. If `OCR_PROVIDER` is omitted, the app uses Zhipu when `ZHIPU_API_KEY` exists, otherwise OpenAI when `OPENAI_API_KEY` exists. Do not commit `.env.local`.

`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are required for `/admin` publishing and public recommended articles. Run `docs/public-articles-supabase.sql` in Supabase before publishing.

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

## Main Routes

- `/api/explain-word` explains a word or short phrase from sentence context.
- `/api/ask-sentence` answers follow-up questions about the selected sentence.
- `/api/summarize-article` creates a short Chinese summary for saved article lists.
- `/api/import-url` imports public HTML articles into structured reading blocks.
- `/api/ocr-image` is retained for future uploaded-image OCR and currently returns 503 while OCR is disabled.
- `/api/ocr-image-url` is retained for future imported-article image OCR and currently returns 503 while OCR is disabled.
- `/api/anki/*` supports Anki model/deck helpers; note creation still depends on local AnkiConnect from the browser.
- `/api/public-articles` lists public recommended articles.
- `/api/public-articles/[id]` reads one public article and its preloaded explanations.
- `/api/admin/*` handles administrator login and publishing. Writes require the admin session cookie.

## Public Recommendations

Open `/admin`, enter `ADMIN_PASSWORD`, and publish articles already saved in the current browser. The admin page can publish one article, publish only selected local articles in a batch, merge cached explanations into an already public article, and delete public recommendations. The publish action uploads the article and any matching cached explanations from `localStorage` to Supabase.

Visitors do not need to log in. They can open public recommended articles from the homepage. The recommendation list is fetched during the server render, so it should appear immediately when the homepage loads. If the service worker has cached the app and public article API responses, those pages can reopen offline. New AI explanations, URL imports, and new summaries still require network access. OCR is currently disabled.

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
