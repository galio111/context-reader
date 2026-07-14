# Context Reader Agent Guide

## Project

Context Reader is a Next.js 15 / React 19 app for Chinese-speaking learners reading real English articles. Reading flow is primary; lookup, translation, vocabulary, and Anki are supporting tools. The fixed production URL is `https://context-reader-ten.vercel.app`.

Accounts use server-side Supabase email OTP with HttpOnly cookies. Guests receive 10 word/phrase lookups per Shanghai day; cached guest lookups count, while registered cache hits and failed/cancelled work do not. Save/vocabulary/Anki/private translation/summary/OCR require login; admin-prepublished translations stay public. Structured and streaming lookup requests share one idempotent usage action while recording both upstream executions. Cloud sync is authoritative but must preserve local data through object versions and recovery copies. Quotas and provisional plans are managed at `/admin/accounts`; payment is not connected. The production database, secrets, member-email login, and sync are active, but public email login is not launch-ready until custom SMTP and a `{{ .Token }}` OTP template are configured. Whenever future work touches authentication, launch readiness, or general site completion, proactively remind the user about this unfinished SMTP blocker.

## Commands

```powershell
npm install
npm run dev
npm.cmd run build
npm.cmd exec -- vercel --prod --yes
```

Pure documentation changes do not require a build or deployment. For user-facing code releases, run the production build and confirm Vercel reports the fixed production alias.

## Hard Boundaries

- Keep article text visually primary inside the reader. The homepage may use expressive spatial continuity and motion to teach real reading interactions, but it must keep article entry immediately available and must not become a generic AI landing page, game, or social feed.
- Article editing stays directly in the reading canvas. Read and edit modes must share typography and layout; do not replace the article with a textarea or controlled per-keystroke editor.
- Preserve explicit blank paragraphs. Imported images are read-only blocks but may be deleted as whole blocks while editing.
- Undo/redo is reading-session history, survives saves until returning home, and is not browser `execCommand` history.
- Mobile vertical movement is reading scroll. Phrase selection requires deliberate horizontal movement or long press.
- Full-article translation starts only from its sidebar. Opening the sidebar must not auto-start it, and switching tools must not cancel an active translation job.
- Translation runs one text block per request with full-article `contextBlocks`; unchanged blocks reuse cache, selective refresh touches changed blocks, and force-regenerate bypasses whole-article and per-block caches.
- Streamed word-explanation fields are the visible authority. Merge them into the structured result, cache the merged result, and keep fresh, completed, and replayed layouts identical.
- Regenerating a saved vocabulary item updates generated fields but preserves its id, creation time, and Anki import record.
- Vocabulary cards use measured content heights; do not restore fixed oversized rows or manual expand controls.
- Anki cloze hints use only the durable `contextMeaning`. Pronunciation is click-to-play; note import must continue if deck autoplay configuration cannot be written.
- Public recommendations are server-rendered. Any article, explanation-cache, translation-cache, import, or schema change must also be checked against `/admin` publishing, Supabase preload storage, and public-article cache replay.
- Keep the API security boundary intact: bounded request bodies, cost-aware throttling and concurrency caps, same-origin admin mutations, pinned-DNS safe remote fetches, private-network blocking, and generic client errors. The in-process limiter is defense in depth; production abuse resistance also requires a platform/distributed rate limit or a provider spending cap when traffic grows.
- Supabase browser roles must never bypass `/admin`. Keep RLS enabled and revoke table access from `anon`, `authenticated`, and `PUBLIC`; re-run the authoritative SQL after security/schema changes.

## OCR Boundary

- Homepage image reading is enabled in `components/ArticleInput.tsx`. It calls `/api/ocr-image` and `/api/ocr-image-layout` in parallel, preserves the uploaded image, and uses layout word boxes for click-to-explain when available.
- Automatic OCR for images inside URL-imported articles remains disabled in `components/ReaderView.tsx`. Do not describe OCR as either universally enabled or universally disabled.
- `/api/ocr-image-url` and the provider layer are available, but reader-side automatic invocation is gated off.
- The image viewer supports cursor-anchored wheel zoom, layout-word clicks when stored, and remote image download through `/api/download-image`.

## Homepage Boundary

- `components/ArticleInput.tsx` delegates the shipped homepage UI to `components/ImmersiveHome.tsx`; `docs/home-complete-ui-prototype.html` is its design baseline, not an unimplemented alternative.
- Keep the compact paste/URL entry on the first screen. The word demo, phrase-selection lesson, recommendations/saved articles, and final entry form may unfold across the page without displacing the first-screen reading action.
- Public recommendations must remain server-rendered through `app/page.tsx`. Desktop scene-boundary wheel snapping must not replace normal mobile vertical scrolling.

## Data And Compatibility

- Browser `localStorage` contains durable user data: saved articles, vocabulary, explanations, translations, and reading continuity. Failures should degrade gracefully and must not clear unrelated data.
- `SavedArticle.importedArticle` is optional for backward compatibility. When present, preserve rich blocks, inline `sup`/`sub`, images, OCR/layout metadata, and reading style.
- Explanation cache key: normalized selected word or phrase + source sentence. Article translations have whole-article and per-block caches.
- DeepSeek routes default to `deepseek-v4-pro` with thinking disabled. `DEEPSEEK_MODEL` is the shared override, `DEEPSEEK_TRANSLATION_MODEL` can override article translation alone, and the `DEEPSEEK_FALLBACK_*` variables configure model/provider fallback where supported.

## Documentation Map

- `PRODUCT.md`: product principles and design boundaries.
- `README.md`: setup, feature overview, routes, deployment.
- `docs/architecture.md`: internal flows and invariants.
- `docs/integration-guide.md`: API, environment, Supabase, OCR, and Anki integration.
- `docs/gpt-brief.md`: portable Chinese context package for conversations that cannot read the repository.
- `docs/public-articles-supabase.sql`: authoritative public-article schema.

When behavior changes, update the existing final-state description instead of appending a dated change log. Keep these files consistent with code.
