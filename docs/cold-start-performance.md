# Three simultaneous cold starts without additional services

精选外刊首页卡片与 Reader 的图片滚动问题仍未验收：用户报告快速下滑时灰色占位更频繁，且出现短暂停顿。见 [精选图片滚动问题](featured-image-scroll-open-issue.md)。此前图片请求变快、构建成功和存储地址可访问均不能证明该交互已修好。

Production release `20260922T102600`, parent `20260922T101400`, source `bb50d2ba144737e23ef436eb61726012c0cb6c1b`, on the mainland-internal backend. Public connectivity, resolved current symlink and the stable deploy log confirm this identity. No paid service, infrastructure plan, model choice or quota is changed.

## Current measured result

Three-user core-flow checks pass. This is not a promise of zero waiting in every operation: one final cold video start took 5.37 seconds, although all six final playback samples ran continuously without buffering. The original broader 1,000-DAU workload remains a separate, incompletely certified target in [capacity-plan.md](capacity-plan.md).

| Final release check | Observed result |
| --- | --- |
| Three simultaneous desktop cold visits | Homepage hydration plus account resolution: 1.84 / 1.46 / 3.31 s |
| Three simultaneous mobile-size cold visits | 3.32 / 2.95 / 2.15 s |
| Three simultaneous desktop video starts | 3.42 / 5.37 / 2.61 s; each subsequently advanced 10.00 s with zero `waiting` or `stalled` events |
| Three simultaneous mobile video starts | 4.32 / 1.01 / 4.10 s; each subsequently advanced 10.01 s with zero buffering events |
| Public data parity | All 426 ids/order and visible fields preserved; 40 initial SSR records; full detail/editorial evidence preserved; legacy root redirect 308 |
| Delivery integrity | All 113 live JS/CSS Brotli responses decode byte-identically; non-Brotli fallback and missing-file 404 pass |
| Safety and operation | Anonymous sync/Admin 401; recovery Admin reads 200; seven services healthy; isolated backup restore verifies 16 tables; accepted current/parent rollback images present |
| Browser accessibility smoke | Keyboard Menu Enter/Escape and reduced-motion mode pass; no page errors or document overflow in that check |

Cold contexts start together in Chrome with separate empty browser contexts, cache disabled and service workers blocked, at 1365×900 and 390×844. The readiness metric ends when controls are hydrated and the account-resolution indicator disappears; the existing intentional word-fall opening is separate. Video runs use fresh contexts with normal service workers and measure actual playback, not HTTP status alone. These are one workstation/network and emulated viewports, not multiple physical phones or a long soak. Screenshots were inspected; user visual/physical-device acceptance is not implied.

The code series also passed aligned three-user desktop/mobile Menu → dictionary → Reader flows. The detailed mobile sample on `20260922T093500` showed first dictionary content at 0.88 s, completion at 4.22–6.26 s, and click-to-Reader at 1.86–1.88 s. Later code changes only refine homepage media loading. Three isolated account workflows concurrently passed registration, login, article/vocabulary save/read, protocol-2 sync and stale-write rejection; all three exact synthetic accounts were then deleted. Those account checks ran from the server and are functional/concurrency evidence, not client-network latency measurements.

105 focused regressions, production builds, release contracts and the egress audit passed. Local real-Next root rendering, delayed-account/media checks, desktop scene prewarming and synthetic WebM failure → working MP4 fallback passed. Final evidence: `accepted-desktop.json`, `accepted-mobile.json`, `video-three-desktop.json`, `video-three-mobile.json`, `keyboard-smoke.json`, `public-shipped-acceptance.json` and `server-shipped-acceptance.log` under `artifacts/cold-start-three/`. Earlier functional evidence is retained as `final-interactions-desktop.json`, `verified-mobile-2.json`, `account-three-results.json` and `account-cleanup.log`.

## Loading behavior

- The legacy `ArticleInput` homepage is still available through its existing branch, but loads only when used. It no longer pulls legacy reading/vocabulary/UI dependencies into the real homepage's initial bundle.
- Ballpit remains the same component with the same props and physics. Its Three.js dependency loads independently from homepage controls, after the guest opening completes and only when the cover is still visible. Jumping directly to reading or media does not download an unseen cover scene; returning to the cover still starts it. Existing word-fall opening, desktop/mobile rendering and reduced-motion behavior remain.
- Every category's initial desktop/mobile showcase keeps its exact server-rendered articles and order. The initial payload contains the union of those showcases (at most 50 records), plus full category counts. The complete unchanged catalogue is requested within 240 pixels of the article section, on category/preference/library intent, or before vocabulary source recovery. Requests are coalesced; failures retain initial cards with an explicit retry, and counts/personalization/search use the full data once it arrives. Daily update notices wait for the complete catalogue. Cover image requests start within 350 pixels of the viewport after hydration, retain their layout space and still use the original optimized image/alt/failure behavior. The featured card no longer preloads from below the fold.
- The hidden contact QR image loads when expanded. Showcase poster/video requests follow the actual media viewport after account resolution and the opening. Desktop physics prewarming waits until the publications video is fully buffered and has played once, or starts when another module is selected. The mobile-hidden lanyard neither mounts nor prewarms, matching the accepted mobile design; its text animation and direct guide button remain.
- Showcase v2 keeps the same approximately 13-second silent recording, loop, pause, replay, aspect ratio and controls. H.264 fast-start renditions use 24 fps, 1056×864 desktop and 528×432 mobile, with maximum rates 650/300 kbit/s. Files shrink from 3,765,764 to 1,062,209 bytes and 1,578,427 to 490,804 bytes. New filenames avoid stale seven-day video caches; original v1 assets remain available. Sample frames were inspected, but this is not user approval of compression fidelity.
- Desktop browsers reporting VP9 support prefer a 568,962-byte, two-pass 350 kbit/s WebM of the same recording (84.9% smaller than the original desktop file). Unsupported or failed WebM playback falls back to the H.264 version; mobile retains its smaller H.264 rendition. Posters and all controls are unchanged. Original recordings remain available for comparison and rollback.

## Immutable asset delivery

`npm run build` now precompresses every generated JS/CSS asset using Brotli quality 11 once at build time. Original assets remain intact; Docker already copies both representations from `.next/static`. No compression work is added to each production request.

Middleware rewrites eligible `/_next/static/` GET/HEAD requests accepting Brotli to the static-asset route. The route validates path segments, reads only the static build directory, returns the original JavaScript/CSS MIME type, immutable one-year cache headers and `Vary: Accept-Encoding`. Requests excluding Brotli, range requests and development assets continue through Next's standard asset delivery. API/account/HTML data are not cached or compressed through this route. Unknown assets return 404.

## Verification contract

Run the encoding/path tests and `node scripts/verify-static-assets.mjs http://127.0.0.1:3218` against a local production build. Every decompressed response must be byte-identical to its generated asset, including dynamic route filenames, with legacy negotiation and missing-file behavior checked. Production build, critical regressions, release contracts and egress audit must pass.

Use three fresh browser contexts with empty caches/service workers blocked, navigating together. Record network, first paint, homepage hydration/session resolution, JavaScript errors, visible loading state and actual control interactions; inspect desktop and mobile. Resource-only download tests are secondary because they omit image competition, hydration and account resolution. Deliberate existing opening animation is distinguished from network waiting, and no visual fidelity claim follows from a successful build alone.

Baseline on release `20260922T074500`: three simultaneous desktop Chrome cold contexts had control hydration times 11.82, 13.45 and 21.56 seconds, despite no JavaScript errors. Their resource waterfalls included below-fold eager article covers, a hidden 122 kB QR JPEG and a showcase poster competing with the initial scripts. Screenshots still showed the account-resolution indicator at the hydration milestone. This browser result supersedes any implication that the earlier resource-only timings captured complete page readiness. Baseline was recorded before another accepted Admin-only release; cumulative deployment must retain that release.

Evidence belongs in `artifacts/cold-start-three/`; do not package browser dependencies or local evidence into production.

Intermediate release `20260922T084600` (parent `20260922T083448`, source `6da7153d8218a4336ccf418443f819268ef1de1e`) reduced initial JS from 454 kB to 213 kB, but a three-browser cold run still had a 6.44 s slowest homepage resolution. That failed measurement motivated the progressive complete-catalogue transport above; it is not reported as final acceptance.

## Failures retained and corrected

- Release `20260922T090800` accidentally called a client-marked preference helper from the new server catalogue selector. Real public browser tests caught the root render failure after deployment; connectivity alone was healthy. The site was rolled back to `20260922T084600` at approximately 09:14 UTC, then the pure functions were separated into `recommendationPreferencesShared.ts`. The corrected root rendered in a real local Next production server before the next cutover. No catalogue or user data was migrated or removed.
- The independently reviewed stable `/opt/context-reader/bin/deploy-release` now fetches the candidate root, checks its actual server-rendered recommendation section and rejects streamed Next error markers before cutover. It retains the global lock, parent recheck and protected contracts. Installed SHA-256: `4a2771ee349a8cc0fb1ba2a46dd4b22882168c8e14321a54ae8863d870b7f181`. The prior stable script is retained as `deploy-release.before-home-check-20260922`; candidate archive scripts are not executed as the release authority.
- Corrected catalogue release `20260922T092400` still had mobile waits up to 14.25 seconds because a partly visible showcase started hidden media/physics requests during account resolution. Actual-media visibility gating, high-priority session fetch and opening-aware scene loading removed that contention.
- On `20260922T093500`, all 12 explicit cold contexts passed the 5-second homepage threshold (desktop 1.62–3.97 s; mobile 1.98–3.34 s). Desktop/mobile Menu, dictionary and article flows passed with no JavaScript errors or dictionary overflow. The mobile detailed run displayed initial dictionary content at 0.88 s, completed at 4.22–6.26 s, and entered Reader 1.86–1.88 s after clicking an already-visible card. These are different milestones: its scroll/catalogue/cover-plus-click phase reached 5.24 s and is not misreported as pure article-open latency.
- The same release's simultaneous mobile videos buffered 8–10 times each over 10 seconds. H.264 compression stopped mobile playback stalls, but desktop physics prewarming still competed with video. Buffer-first physics scheduling on `20260922T100400` removed observed continuous playback stalls on both viewports; a 7.30 s desktop start remained, prompting the smaller VP9 rendition with runtime H.264 fallback. All of these slow samples remain evidence, not discarded warm-up runs.
- Early interaction scripts had selector/timing errors (hidden desktop quick navigation, selecting the preference button as an article, and scrolling before a mobile sheet finished closing). Stream response-body retrieval was also unreliable in Chrome DevTools although the UI had completed. Corrected tests use real visible controls, sheet detachment, rendered dictionary results and separate click-to-reader timing. These harness failures are not treated as website success or website faults.

Evidence is held outside release archives in `artifacts/cold-start-three/`. Local synthetic delayed-session/media and failed-WebM checks are explicitly labelled local; public concurrency runs use the real site. Temporary account tests are separate from guest browser activity, which remains part of the private operational audit.

The 2026-09-23 homepage cover change supersedes the 350px/Next-optimized cover sentence above: first 12 cards prepare after opening, remaining stored WebP covers start in a 3600px observer band and load directly. See [featured-image-scroll-open-issue.md](featured-image-scroll-open-issue.md) for pending visual acceptance.
