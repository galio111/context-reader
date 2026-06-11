# Context Reader Architecture

## Overview

Context Reader is a Next.js app with a client-side reading workspace and server-side AI/helper routes. The app supports three article entry modes:

- Plain text paste: stores and renders text only.
- URL import: server extracts public HTML into structured blocks, then the reader renders headings, paragraphs, lists, quotes, images, and inline upper/lower annotations.
- Image OCR framework: retained for uploaded images and imported article images, but currently disabled in the UI and API routes. Imported article images remain visible and can be opened in the centered zoom viewer.

## Reading Flow

`app/page.tsx` owns the active article state. Plain text articles pass only `article` into `ReaderView`. URL imports also pass `importedArticle`, which contains rich `blocks`. A text block's plain `text` remains the source for lookup, summaries, copying, and saved article identity; optional `inline` segments preserve visual annotations such as original `sup` and `sub` text. Image blocks render as article media with a click-to-enlarge zoom viewer. They can still carry stored `ocrText` for compatibility, but new image OCR is disabled while `IMAGE_OCR_ENABLED` is `false`. `ReaderView` tokenizes every text block so word selection, phrase dragging, cached explanations, vocabulary saving, CSV export, and Anki import all continue to work across both plain and imported articles.

Saved articles live in browser `localStorage` through `lib/articles.ts`. `SavedArticle.importedArticle` is optional for backward compatibility. When present, reopening a saved URL import restores the original structured layout, images, supported inline annotations, and any OCR text already attached to image blocks instead of falling back to plain text.

## Homepage

`ArticleInput` renders the homepage as a compact first-screen workspace with rounded white panels. The main paste area fills the left panel while keeping the primary reading action visible without page scrolling on desktop. The homepage can open the shared vocabulary notebook as a centered dialog from near the top of the viewport.

Public recommended articles are fetched in the server `app/page.tsx` and passed into the client homepage as `initialPublicArticles`. Do not move this list back to a client-only `useEffect` fetch; otherwise the homepage first renders without recommendations and visibly fills them in later. The recommendation strip belongs under the paste/start-reading controls in the left workspace, not in the right rail, so it does not hide the user's saved articles.

The reading view uses the same vocabulary data but keeps the notebook as a right-side drawer so it does not cover the article workspace.

## Mobile Reader

The mobile explanation panel is a bottom sheet. It defaults to half the viewport height and can be resized with the small top handle. Only the compact collapse button should stay visible while the explanation content scrolls.

Touch word selection separates reading scroll from lookup gestures. Vertical movement is treated as article scrolling and should not highlight or query a word. A tap explains one word. Horizontal movement across words or long-press selection can select a short phrase, capped at eight words.

## API Routes

- `/api/public-articles`: lists public recommended articles for clients and service-worker caching. The homepage does not depend on a client-side call for first paint.
- `/api/public-articles/[id]`: reads one public article and its preloaded explanations.
- `/api/admin/*`: handles administrator login, public article listing, publishing, selected batch publishing, and deletion. Writes require the admin session cookie.
- `/api/import-url`: fetches public HTML, strips noisy elements, extracts article-like content, normalizes image URLs, preserves `sup`/`sub` inline segments, and returns `ImportedArticle`.
- `/api/ocr-image`: OCR framework route for a single uploaded image up to 8MB. It currently returns 503 while `IMAGE_OCR_ENABLED` is `false`.
- `/api/ocr-image-url`: OCR framework route for remote imported-article image URLs. It currently returns 503 while `IMAGE_OCR_ENABLED` is `false`.
- `/api/explain-word`: sends only selected word/phrase and sentence context to DeepSeek.
- `/api/summarize-article`: summarizes saved articles for the homepage list.
- `/api/ask-sentence`: answers follow-up questions about a selected sentence.
- `/api/anki/*`: checks/creates Anki helpers, while browser-side AnkiConnect is still required for local note import.

## Public Recommendations

Public articles are stored in Supabase tables created by `docs/public-articles-supabase.sql`. Admin publishing reads the current browser's local saved articles and matching `localStorage` explanation cache, then writes public article rows plus `article_id + cache_key` explanation rows. Duplicate publishing should update/reuse the existing public article and merge explanations rather than creating another visible recommendation.

The admin UI supports selecting specific local articles for batch publishing. It also lists current public recommendations and can delete them. This is intentionally an admin-only workflow; visitors can read public articles without logging in.

## Offline Behavior

The production app registers `public/sw.js` as a service worker. After the site has been opened online once, the cached app shell can reopen offline. Public article API responses use network-first caching, so public articles that have already been loaded can reopen offline. New AI explanations, URL import, and article summaries still require network access. Image OCR is currently disabled.

## OCR Provider Framework

`lib/visionOcr.ts` keeps the reusable OCR provider layer for future re-enablement. It supports `OCR_PROVIDER=zhipu` with `ZHIPU_API_KEY`, `ZHIPU_BASE_URL`, and `ZHIPU_OCR_MODEL`, and `OCR_PROVIDER=openai` with `OPENAI_API_KEY` and `OPENAI_OCR_MODEL`. If `OCR_PROVIDER` is omitted, the provider layer prefers Zhipu when `ZHIPU_API_KEY` exists, otherwise OpenAI when `OPENAI_API_KEY` exists.

To re-enable OCR, set `IMAGE_OCR_ENABLED = true` in `components/ArticleInput.tsx`, `components/ReaderView.tsx`, `app/api/ocr-image/route.ts`, and `app/api/ocr-image-url/route.ts`, then run the production build and deploy.

## Design

The frontend follows `design-md/apple` with a quiet utility layout: no global black nav, compact rounded white surfaces, system font stack, and a single Action Blue `#0066cc` for primary interactive states.
