# Context Reader Agent Guide

## Project

Context Reader is a Next.js 15 / React 19 reading tool for Chinese-speaking learners reading real English articles. Reading flow is primary; lookup, translation, vocabulary, recommendations, accounts and Anki support it.

Primary production is `https://context-reader.com` on the mainland-China stack. `https://context-reader-ten.vercel.app` and the managed Supabase project are rollback/reference environments only. The canonical homepage is the bare domain root; legacy `/home-v2` links permanently redirect to `/` while preserving their query string.

Production account, Auth, sync, REST and Storage traffic must use the Docker-internal `http://supabase-api:8000` gateway. The `SUPABASE_*` variable names remain compatibility names for the self-hosted adapters; they do not authorize Supabase Cloud as a production backend. A production container with any external `SUPABASE_URL` must refuse to start, and `/api/connectivity` must report `backendMode: "mainland_internal"`. Never rebuild `app` from the legacy mutable `/opt/context-reader/ops/mainland` directory; use the accepted release under `/opt/context-reader-current` or the stable versioned release entrypoint.

The public beta uses an unverified mainland-China phone identifier, nickname and password. New registration and voluntary password changes require 8–72 printable ASCII characters with at least one letter and one digit; existing six-digit numeric passwords remain accepted only for legacy login until the user changes them. It sends no SMS and offers no password recovery until phone ownership can be verified. The internal synthetic email is never user-visible. Email OTP remains legacy/future code and is not launch-ready until custom SMTP and a `{{ .Token }}` template are configured.

## Commands And Release

```powershell
npm install
npm run dev
npm.cmd run build
```

Pure documentation changes require no build or deployment. For user-visible code, run the production build, deploy through the versioned `ops/mainland/` workflow, and verify the public site plus affected account, sync, Admin, health, backup and rollback paths. Routine cutover may recreate only `app` and `caddy` with Compose dependencies disabled; never restart PostgreSQL, Auth, REST, Storage or the internal gateway for an app-only release. Do not routinely redeploy Vercel.

After a code or functional update is complete and validated, commit it from its dedicated `codex/*` worktree and push the reviewed result to `galio111/context-reader` automatically so GitHub-backed Chat context stays current. Never include credentials, logs, caches, release archives, worktrees or unrelated dirty-root changes. GitHub synchronization does not by itself mean production deployment; mainland release acceptance still requires the separate evidence below.

Production releases are cumulative and single-writer even when development sessions run in parallel. Never package the shared dirty workspace or an independent copy of an older release. Start from the currently accepted production release in a dedicated Git worktree, merge and commit every intended change, then use `ops/mainland/package-release.py` with an explicit reviewed changed-file list. The manifest parent must equal the active production release, `sourceRevision` must be the clean worktree's exact commit, and the archive delta must exactly equal `changedFiles`. Run the stable server entrypoint `/opt/context-reader/bin/deploy-release`; never trust a deploy script supplied only by the candidate archive. Its global lock, parent recheck, internal-backend check and protected contracts must stay enabled. If the parent changed, rebuild from the new accepted release instead of editing the manifest or retrying a stale package.

Every parallel code task must use its own `codex/*` branch and dedicated worktree; use `scripts/new-task-worktree.ps1` rather than editing the shared dirty root. The helper first removes only clean worktrees that are at least 48 hours old and whose commits are already contained by `origin/main`, then refuses creation when C: has less than 20 GB free or 32 task-worktree directories already exist. Commit the task before handoff. After its commit is accepted into `origin/main` and no session uses it, remove the worktree; run `scripts/cleanup-task-worktrees.ps1` for an audit or add `-Apply` for the same conservative cleanup. Never delete the caller's current worktree or any dirty, unmerged, locked or merely old worktree. Do not copy an entire task worktree over another task or production integration tree; merge or cherry-pick its commit so overlapping edits produce an explicit Git conflict. Documentation-only inspection may remain in the shared root only when it cannot overwrite another task's files.

Do not say a release is live because code was edited, committed, built, uploaded or accepted by a candidate container. “Production deployed” requires the public `/api/connectivity` response to report the exact new `releaseId`, `parentReleaseId` and `backendMode: "mainland_internal"`, plus the affected public regression checks. Record the accepted release id, parent id, source commit and evidence in final-state docs and `docs/product-journey.md`. Full invariants and recovery steps live in `docs/release-governance.md`.

## Product Boundaries

- Keep article text visually primary in `ReaderView`. The homepage may be expressive, but article entry must remain immediate and the site must not become a generic AI landing page, game or social feed.
- Article editing stays directly in the reading canvas. Read and edit modes share typography and layout; never replace the article with a textarea or controlled per-keystroke editor. Preserve explicit blank paragraphs. Images remain read-only blocks that may be deleted whole.
- Undo/redo is reading-session history that survives saves until returning home; it is not browser `execCommand` history.
- Mobile vertical movement is reading scroll. Phrase selection requires deliberate horizontal movement or long press.
- Full-article translation starts only after the user clicks inside its sidebar. Opening or switching tools must not auto-start or cancel it. Translate one text block per request with full-article `contextBlocks`; retain completed blocks, reuse unchanged caches and make force-regenerate non-destructive.
- Streamed explanation/dictionary fields are the visible authority. Merge them into the durable result so progressive, completed and replayed layouts remain the same.
- Regenerating a saved vocabulary item preserves its id, creation time and Anki record. Vocabulary virtualization uses measured content heights; do not restore fixed oversized rows.
- Anki cloze hints use only durable `contextMeaning`. Pronunciation is click-to-play, and note import continues if deck autoplay configuration cannot be written.
- User-visible failures distinguish unsupported input, connectivity, account/quota and site/provider faults. Never expose raw transport messages such as `Failed to fetch`.

## Account, Data And Security

- Guests receive separate Shanghai-day pools: 10 article word/phrase lookups, 5 standalone dictionary lookups, 2 pasted-text imports and 2 URL imports. Cache hits, failed work and timely cancellations do not consume these pools. Save, vocabulary/Anki, private translation and summary require login; admin-prepublished caches remain public. All four guest allowances are server-configurable in Admin.
- Admin-issued invitation codes are random, unique and single-use. Each grants Basic, Plus or Max for a configured number of days beginning at redemption, may have a separate redemption deadline, and binds atomically to the signed-in account. Active invitation grants do not stack; after expiry the account resolves to Free and may redeem another code. Store only a hash and a non-secret hint after the one-time plaintext display.
- Cloud sync is authoritative after login but must preserve local data. Keep protocol-2 snapshot bootstrap, opaque `(updated_at, kind, object_key)` cursor, version/hash manifest, compare-and-swap merges, article deduplication/tombstones and isolated recovery only for genuinely ambiguous vocabulary conflicts. Never clear unrelated `localStorage` data.
- A failed live session check enters explicit limited offline mode, not guest/logout state. A local identity snapshot may reopen only that account's browser-local articles, vocabulary, reading state and caches; it never restores Admin, plan, quota or server authorization.
- Only a server-verified active `admin` entitlement may expose the normal Admin entry or authorize `/api/admin/*`. The legacy password session is recovery-only. The browser receives no Supabase key.
- Preserve bounded bodies, cost-aware throttling/concurrency, same-origin admin mutations, pinned-DNS remote fetches, private-network blocking, generic client errors, RLS and browser-role revocations. The in-process limiter is defense in depth; larger traffic also needs a platform/distributed limit or provider spending cap.
- Detailed site/provider/config/client-processing faults are stored privately and visible only in server-authorized Admin. Network and input failures are not developer bugs. Email alerts are optional and never replace durable storage.

## Recommendations And Admin

- Public recommendations are server-rendered by `app/page.tsx`. Changes to article data, caches, import or schema must be checked against Admin publishing, preload storage and public replay.
- New recommendations enter one `/admin` candidate workflow from saved article, pasted text, URL or reviewed RSS/Atom discovery. URL intake and crawling reuse `/api/import-url` and the shared article-boundary sanitizer. Crawler output never publishes automatically.
- Candidate and published rows open the real `ReaderView`; body edits write back to that row, while title/summary/cover metadata stay in Admin. Publishing requires a reviewed cover.
- Remote candidate covers must be fetched through the pinned-DNS safe path, converted to bounded content-addressed WebP and stored in the active `public-article-covers` bucket before publication. Published failures show a calm source-labelled fallback, never browser broken-image UI.
- Feedback and up to three validated private images live in the private feedback bucket. Only Admin can list, view, update or delete them; deletion also removes attachments.
- Exact crawler, feedback, error, classification, storage and schema behavior belongs in `docs/architecture.md` and `docs/integration-guide.md`, not duplicated here.

## OCR Boundary

- OCR is not a current user-facing feature. Keep all shipped pages, Menu previews, guide, quota copy and offline messages free of OCR entries or promises.
- Legacy routes and stored image metadata remain for compatibility. `ArticleInput` and `ReaderView` keep their OCR gates disabled, including automatic OCR for URL-imported images.
- The image viewer may still use stored layout words, cursor-anchored zoom and `/api/download-image`.

## Homepage Boundary

- `/` is the only canonical homepage and receives server-rendered public articles. `/home-v2` is compatibility-only and must redirect to `/`. `HomeClient` owns every real transition into `ReaderView`. Do not create `/home-lab` or a disconnected fake homepage.
- Current code still ships `BookHome` and `CurvedPageTurn`, but their book/page-turn interaction is explicitly superseded as the future design direction. It is not a protected motion system.
- Accepted next direction: keep the existing cover and Ballpit physics as a brand/IP surface; remove all cover and inner page turns plus scroll/wheel-driven turning; clicking the cover or primary action should reveal real recommendations and a fast reading path. A user-confirmed Lusion reference may be reproduced with Context Reader content and slightly smaller imagery.
- Continue redesign work on the real root homepage in a branch and connect each visual slice to real SSR recommendations, HomeClient callbacks, Menu/account surfaces and `ReaderView` from the first iteration. Do not finish UI first and synchronize functionality later.
- Homepage layout, Menu presentation and visual hierarchy may be redesigned, but existing capabilities cannot disappear by implication. Any removal requires an explicit functional decision.
- Suppress native blue selection only through scoped/shared selection rules while restoring normal selection in inputs, textareas, editable fields and the translation panel. Never apply site-wide `user-select: none`.
- Full current/target status and the implementation workflow live in `docs/home-v2-implementation-contract.md`.

## Motion And UI Verification

- For a complex effect, accept a URL, 5–15 second recording, screenshots or public source as the specification. Before coding, summarize the start/end state, trigger, layers, timing, uncertain technology and smallest reviewable slice.
- Technical correctness, visual fidelity and repeated-use product experience are separate gates. Build success, HTTP 200, correct state transitions or one implementation-side browser pass do not prove reference fidelity or product suitability.
- Compare actual browser keyframes at start, 25%, 50%, 75% and end when possible. If the browser/reference cannot be inspected, mark visual verification incomplete. Static bundle inference is not observed behavior.
- Self-inspect desktop, mobile, keyboard, reduced-motion, console and repeat flows, but treat the user's visual acceptance as the final gate. Only user-confirmed complex motion may become protected behavior.

## Documentation Discipline

- `docs/home-redesign-current-decisions.md`: canonical current decision register for the pending homepage redesign. Read it before any homepage questionnaire, design or implementation work; a later explicit correction overrides older questionnaire or journey text.
- `docs/home-redesign-interview-archive.md`: structured interview choices and material user supplements. Archive a completed round here before replacing the live questionnaire with the next round.
- `PRODUCT.md`: durable product principles and current design direction.
- `README.md`: concise setup, feature, route and deployment overview.
- `docs/architecture.md`: internal flows and implementation invariants.
- `docs/integration-guide.md`: API, environment, Supabase-compatible backend, OCR and Anki integration.
- `docs/home-v2-implementation-contract.md`: current homepage status, accepted redesign and UI verification contract.
- `docs/product-journey.md`: chronological product history. Append every completed UI, function, infrastructure or major decision milestone with status, reason, validation and evidence.
- `docs/gpt-brief.md`: compact portable context for conversations that cannot read the repository.
- `docs/account-usage-plan.md` and its SQL: account gating, quotas and sync.
- `docs/mainland-deployment-and-migration-plan.md`: production topology, migration, backup and rollback.

When behavior changes, update final-state documents in place instead of appending history to them. Put chronology only in `docs/product-journey.md`. Always distinguish shipped behavior, accepted-but-pending direction and rejected/superseded ideas.

For homepage redesign continuity, update the current decision register, interview archive, implementation contract, GPT brief and product journey in the same discussion round. Historical text is evidence, not authority; never recover an older decision merely because keyword search finds it first.
