# React Bits source records

Copyright (c) 2026 David Haz. License: **MIT + Commons Clause**, reproduced in [react-bits/LICENSE.md](react-bits/LICENSE.md). This is not an unrestricted MIT component package.

Upstream: https://github.com/DavidHDev/react-bits

Inspected revision: `90b2750ec57ab24969681dff24fbf22ccf9ccb59`, 2026-10-11.

The retained source files are research/provenance records in this private personal application. Components may be used as part of an application, website or product under the supplied terms. The license specifically restricts selling, sublicensing or redistributing the components themselves, including a bundle or port. Do not publish this directory as a standalone component distribution or relabel it as pure MIT. No React Bits Pro code or paid assets were accessed.

## Source adaptations in `studio/components/motion-layout.js`

| Source | Preserved algorithm / visual process | Integration changes |
| --- | --- | --- |
| PixelTransition.jsx | Integer hash cell thresholds; square canvas pixels cover old content, swap at halfway, then uncover new content | Full page container, deterministic seed for comparisons, one accent color; paused timeline drives canvas; DOM destination renders synchronously |
| AnimatedContent.jsx | 100px vertical entry, opacity, scale and power3-out curve | Page action trigger instead of ScrollTrigger; browser Web Animations timeline permits seek and pause |
| BlurText.jsx | Per-word staggering; blur 10px → 5px → 0, opacity 0 → .5 → 1, vertical position -50 → 5 → 0 | Same keyframes on native animations; explicit play/seek instead of an observer; Chinese can segment by characters |
| DecryptedText.jsx | `computeOrder` center-out order; revealed-index Set; remaining characters sampled from the source alphabet | Timeline progress replaces React state intervals; can pause/seek; accessible heading retains complete plain label |
| MagnetLines.jsx / .css | Angle from each line centre to pointer using acos and signed vertical offset | Events scoped to instance; no global pointer listener; works as an applied background; reduced motion leaves lines stationary |
| Masonry.jsx / .css | Shortest column placement and ResizeObserver recalculation | Text items and caller-provided heights replace upstream photos; transforms animate reorder; initial layout is immediate |

SpotlightCard source was inspected but is not ported. The existing spotlight material remains a separately implemented Raycast observation and must not be labelled a React Bits source port.

Original files are retained unchanged. Original application code around their algorithms provides callbacks, data binding, cleanup, keyboard controls, cancellation and live-project integration. Source screenshots under `docs/reference-evidence/components-motion/` are private research evidence, not licensed product images.
