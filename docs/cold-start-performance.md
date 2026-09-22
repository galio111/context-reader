# Three simultaneous cold starts without additional services

Implementation in validation; production identity and measured acceptance must be recorded after guarded deployment. No paid service, infrastructure plan or provider choice is changed.

## Loading behavior

- The legacy `ArticleInput` homepage is still available through its existing branch, but loads only when used. It no longer pulls legacy reading/vocabulary/UI dependencies into the real homepage's initial bundle.
- Ballpit remains the same component with the same props and physics. Its Three.js dependency loads independently from homepage controls, after the guest opening completes and only when the cover is still visible. Jumping directly to reading or media does not download an unseen cover scene; returning to the cover still starts it. Existing word-fall opening, desktop/mobile rendering and reduced-motion behavior remain.
- Every category's initial desktop/mobile showcase keeps its exact server-rendered articles and order. The initial payload contains the union of those showcases (at most 50 records), plus full category counts. The complete unchanged catalogue is requested within 240 pixels of the article section, on category/preference/library intent, or before vocabulary source recovery. Requests are coalesced; failures retain initial cards with an explicit retry, and counts/personalization/search use the full data once it arrives. Daily update notices wait for the complete catalogue. Cover image requests start within 350 pixels of the viewport after hydration, retain their layout space and still use the original optimized image/alt/failure behavior. The featured card no longer preloads from below the fold.
- The hidden contact QR image loads when expanded. Showcase poster/video requests follow the actual media viewport after account resolution and the opening. Desktop physics prewarming waits until the publications video is fully buffered, or starts when another module is selected. The mobile-hidden lanyard neither mounts nor prewarms, matching the accepted mobile design; its text animation and direct guide button remain.
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
