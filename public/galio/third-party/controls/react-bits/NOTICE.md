# React Bits source adaptations

Copyright (c) 2026 David Haz. Upstream: https://github.com/DavidHDev/react-bits

Fetched and inspected on 2026-10-11. The exact license retrieved that day is retained in [LICENSE.md](LICENSE.md). It is **MIT + Commons Clause**, not plain MIT. The upstream license explicitly prohibits selling, sublicensing or redistributing the components themselves, including bundles or ports. These adaptations are kept in Galio’s private personal library; do not publish this directory as a reusable component package. Keep this notice and the full license when embedding applicable work in a project, and review the exact license for the intended distribution.

Only the free public source is used. No Pro code, logos, images or paid assets are included.

## Files and adaptations

- `Magnet.jsx`: pointer offset divided by the attraction strength, returning on leave. Ported to local pointer listeners and Web Animations; no global pointer tracking.
- `SpotlightCard.jsx`: soft radial falloff and pointer-relative spotlight. Ported to local CSS radial gradients with the upstream falloff sampled into 15 stops. Ambient noise, content imagery and nonlocal proximity are omitted.
- `TiltedCard.jsx`: normalized pointer coordinates, perspective rotations and scale. DOM/Web Animations replace React/Motion springs; neutral text replaces the example image.
- `Dock.jsx`: cosine-squared distance falloff produces shared magnification around the pointer. Only portable magnification and labels are ported; upstream menus, badges, hopping physics and launch mechanics are omitted.
- `PillNav.jsx`: measured circular-fill geometry, including radius and origin formulas; outgoing/incoming label motion. Web Animations replace GSAP. The separate radial-hover catalog item is a simplified geometry adaptation, not the complete navigation.
- `studio/components/context-pill.js/.css` (2026-10-13): full button-level port of Context Reader's PillNavAction, itself derived from the PillNav geometry. Preserves the radius/origin formulas, both content layers, 300 ms entrance / 200 ms exit, and nested power3.out timing. A local requestAnimationFrame controller replaces GSAP. Original business nodes remain in place; the inert visual layer supports replay, seeking, reduced motion, dynamic label/icon updates and complete cleanup. It is a button adapter, not the upstream full navigation component.
- `ClickSpark.jsx`: evenly spaced rays, ease-out distance and shrinking line length. Eight DOM rays and sampled keyframes replace the canvas loop so the effect supports pause/scrub and local cleanup.

The fetched, unmodified source snapshots are in `upstream/`. The executing adaptation is `studio/components/controls.js` and its scoped stylesheet. They do not import or execute these snapshots.

## Snapshot SHA-256

- `ClickSpark.jsx`: `120a32674c51237ab869239d579aaa0c1fcb112f7db14b631068455ef3cb59de`
- `Dock.jsx`: `f1eba9b158a023e78ff76242a0b17468ed733475918b1cb473158af19f59ebf9`
- `Magnet.jsx`: `57236b34936ff1eaa10b9b9a3c244bdb627f83b5261f6e69d376273f66b826d9`
- `PillNav.jsx`: `d8945db18d87ea3af8cb93943a1cade6a95247d0da750d27d792c1c5bedfe727`
- `SpotlightCard.jsx`: `e0b91ba07c173c98b87b44ec451d0243fe0a3edc67864e2779ad8507d455af67`
- `TiltedCard.jsx`: `f0df6e4f86287c0b70b99f50bf65318536326dc91adb8cf7810caa99a5831b62`
