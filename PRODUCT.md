# Product

## Register

product

## Users

Context Reader is for Chinese-speaking English learners who read articles from pasted text or imported URLs. They are usually trying to understand real English prose without leaving the reading flow, and they need fast word-level or short-phrase explanations in Chinese.

The primary context is active reading: the user is looking at an article, taps or selects unfamiliar language, reviews the explanation, and saves useful vocabulary for later study or Anki import.

## Product Purpose

Context Reader helps learners read English articles with less interruption. It preserves article structure when importing from URLs, explains selected words or phrases using nearby sentence context, stores learning data locally first, synchronizes it across devices after login, and supports CSV export and browser-side AnkiConnect import.

Success means the reader can move between reading, lookup, vocabulary capture, and review without fighting the interface. The article remains readable, the lookup action feels immediate, saved words keep IPA phonetics when available, mobile scrolling does not accidentally trigger word queries, and login or sync never silently discards local learning data. When connectivity is lost, the interface keeps the last server-verified account as an explicitly labeled offline identity, exposes only that account's browser-local articles, vocabulary, and caches, and never treats the offline snapshot as server authorization.

Failure states are part of the reading experience. The product must say whether an action is unsupported, blocked by account/quota rules, waiting on connectivity, or unavailable because Context Reader or an upstream service failed. Raw transport text such as `Failed to fetch` is never user-facing. Offline messages state both what remains usable locally and which actions require reconnection; site faults provide a traceable error id when automatic reporting succeeds.

Guests can read immediately and receive a small daily lookup trial. Login is requested only when that trial is exhausted or at a restricted action such as saving, vocabulary/Anki, private translation, or summary. The public-beta login uses an unverified mainland-China phone identifier, nickname, and a six-digit numeric password without SMS; this is a low-friction temporary identity, not proof that the user owns the phone number. Admin may privately issue a unique single-use invitation code that grants Basic, Plus, or Max for a fixed number of days after redemption; the account shows the granted limits and expiry, returns to Free at expiry, and may then redeem another code. Plans and quotas are configurable product experiments; online payment is not connected.

## Brand Personality

Quiet, focused, practical, with one memorable brand surface rather than continuous spectacle.

The reading workspace should remain calm and compact. The homepage may be more expressive, but its first job is to create a quick path into a real article. Expressive motion must earn its repeated-use cost; an effect that is impressive once but delays reading or competes with natural scrolling is not successful product motion.

The curated-publication surface has two deliberate depths. Signed-out visitors see a finite homepage window whose target is one featured article plus three complete three-card rows. The four topic categories each keep an explicit first featured article; `推荐` is a separately editable Admin pool with an optional default featured article. Admin selection remains the primary editorial signal. When that pool has fewer than ten available publications, the product fills the remaining positions from all published inventory with a Shanghai-day-stable order; covered articles lead equivalent coverless fallbacks. With saved preferences, level and interest matches rank both the chosen pool and fallback inventory, but a manually selected recommendation is not silently discarded solely for lacking an interest tag. Its final action is a direct “登录查看更多” handoff into the existing account surface, while the following homepage sections remain in the document flow. Signed-in returning users reach publications only after their direct workbench; within that final homepage section they first see the same ten-article window, then may reveal the rest of the inventory directly below it. Publication inventory, category placement, recommendation-pool membership and the optional default recommendation feature remain separate editorial concepts.

Editorial value is not conditional on photography. Candidates with meaningful images localize them into first-party storage before review; images that cannot be safely retained disappear instead of becoming broken browser UI. Strong text-only sources remain eligible for selection and receive an intentionally composed text-edition cover using source and summary, so “no image” reads as an editorial choice rather than a loading failure.

Personalization is a separate reading preference, not another publication category. The external-publication header always exposes it to guests and members; the five familiar reading levels and eight interest themes affect only the default `推荐` order. Admin inclusion is the primary editorial signal; preference matches rank the window and guide fallback selection when fewer than ten Admin choices exist. Explicit category choices remain authoritative. Guest preferences persist in that browser, account preferences synchronize, and signing in mid-journey must not unexpectedly reflow the page the user is currently reading.

The current cover and Ballpit collision field are an accepted brand/IP direction. The old book page-turn and wheel-to-turn system is not. New or signed-out users see a near-full-height brand cover followed by curated publications. Its accepted structural direction is a spacious brand surface with an unframed Ballpit field and restrained left-aligned copy, not a conventional split-column hero. Visual whitespace does not impose a permanent physics wall: the “ball aperture” begins from the live, freely colliding Ballpit state on one full-viewport canvas, first opens a central route, then moves the same spheres out only as the publication list settles. A ball must remain whole until it reaches the real viewport edge; no moving internal clip, scene switch, re-randomization, mid-scroll flash, wheel jump, or idle jank is acceptable. Ordinary browser scrolling directly drives this reversible timeline; it never intercepts the wheel, snaps sections, locks the document, or forces a completion jump. Scrolling upward restores the same sequence in reverse. A cover action may smoothly scroll to publications on a slightly faster version of the same path, but cannot change manual scroll semantics. The cover background remains a near-white brand field; no recognizable background image is accepted. The first screen uses the confirmed main line and one entry action; the explanatory sentence and its exact location remain unapproved. For signed-in returning users, a compact multi-track Ballpit gather-and-aperture opening leads to a centered workbench where a smaller continue-reading module and a larger import module are visible together; recent-article lists are not repeated there. Curated content and self-import are coequal entries, while contextual explanation/translation remains the core capability. On pointer devices, the top-left `Context Reader` pill reveals four independent high-frequency controls on the signed-out homepage; signed-in home and Reader show those controls persistently. They sit close to the left viewport edge, use short Chinese labels and their own non-pill hover language, and never become a full-height side panel. The Menu remains a separate top-right control and does not duplicate these desktop entries. Touch devices use one bottom Menu and no left handle or sidebar. Cursor-letter motion remains a confirmed non-Reader brand detail, at lower intensity in the closing area. After import, signed-out users meet a seven-card infinite 3D feature ring that supports drag, swipe, controls, and card selection; it introduces real capabilities without turning those cards into duplicate entry points.

## Anti-references

Do not make the homepage a generic AI landing page or let decorative effects replace the reading interaction. Avoid global black brand bars, nested cards, unrelated 3D mascots, tiny explanatory copy, and interface chrome that competes with the sentence demo or article entry. The reader itself remains a quiet tool rather than a campaign surface.

Avoid playful language-learning gamification unless explicitly requested. The product should not feel like a toy, quiz app, or social feed.

## Design Principles

1. Keep reading primary: article text should remain the visual anchor, with lookup and vocabulary tools supporting it instead of taking over.
2. Preserve flow: common actions such as returning home, editing text directly on the article, copying content, saving articles, and opening vocabulary should be reachable without layout surprises. Entering edit mode must not change the article's typography, width, wrapping, or paragraph spacing.
3. Respect mobile touch intent: vertical scrolling is reading, while phrase selection requires a deliberate horizontal or long-press gesture.
4. Make study artifacts durable: vocabulary data should preserve phonetics, source sentence, contextual meaning, copied explanations, CSV fields, and Anki fields. Anki pronunciation should be available on demand without auto-playing when a card answer is shown.
5. Keep entry immediate even when the homepage is expressive: the bare production domain is the canonical homepage, while legacy `/home-v2` links redirect to it without losing query parameters. The accepted redesign keeps the cover/Ballpit identity, removes page turns, and lets the cover hand off to real curated publications before presenting paste/URL import to new users. Signed-in returning users enter a direct workbench with continue reading and import/lookup actions. Standalone lookup, paste, URL, saved articles and recommendations must remain real connected capabilities, although their layout may be redesigned.
6. Reset ephemeral UI state: closing and reopening tools should feel fresh. Search terms, panel scroll offsets, temporary previews, status messages, and resized sheet positions should return to defaults unless preserving them clearly supports uninterrupted reading.
7. Validate motion in three dimensions: technical correctness, visual fidelity to the chosen reference, and repeated-use product experience. Passing a build or state-machine check does not establish the other two.

## Accessibility & Inclusion

Target practical WCAG AA readability for body text and controls. Maintain strong contrast for article text, explanations, buttons, and status messages. Do not rely on color alone for important states.

Day and night are equal product states. Every new or redesigned interface must define both palettes together, including embedded and standalone forms plus hover, focus, selected, disabled, loading, warning and error states. A light-only component is not finished even when the surrounding page already supports night mode.

Support reduced-motion expectations by avoiding unnecessary animation in the reading workflow. On mobile, keep scroll behavior predictable and avoid gestures that accidentally block reading. The homepage must never reinterpret ordinary vertical wheel/touch movement as a different action without an explicit, user-understood interaction boundary.
