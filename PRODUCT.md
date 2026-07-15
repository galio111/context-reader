# Product

## Register

product

## Users

Context Reader is for Chinese-speaking English learners who read articles from pasted text, imported URLs, or English screenshots and scans. They are usually trying to understand real English prose without leaving the reading flow, and they need fast word-level or short-phrase explanations in Chinese.

The primary context is active reading: the user is looking at an article, taps or selects unfamiliar language, reviews the explanation, and saves useful vocabulary for later study or Anki import.

## Product Purpose

Context Reader helps learners read English articles with less interruption. It preserves article structure when importing from URLs, explains selected words or phrases using nearby sentence context, stores learning data locally first, synchronizes it across devices after login, and supports CSV export and browser-side AnkiConnect import.

Success means the reader can move between reading, lookup, vocabulary capture, and review without fighting the interface. The article remains readable, the lookup action feels immediate, saved words keep IPA phonetics when available, mobile scrolling does not accidentally trigger word queries, and login or sync never silently discards local learning data.

Guests can read immediately and receive a small daily lookup trial. Login is requested only when that trial is exhausted or at a restricted action such as saving, vocabulary/Anki, private translation, summary, or OCR. The public-beta login uses an unverified mainland-China phone identifier, nickname, and a six-digit PIN without SMS; this is a low-friction temporary identity, not proof that the user owns the phone number. Plans and quotas are configurable product experiments; online payment is not connected.

## Brand Personality

Quiet, focused, practical.

The reading workspace should remain calm and compact. The homepage may be more expressive and promotional, but its motion and spatial depth must teach the real click-word and drag-phrase interactions while keeping article entry immediately available.

## Anti-references

Do not make the homepage a generic AI landing page or let decorative effects replace the reading interaction. Avoid global black brand bars, nested cards, unrelated 3D mascots, tiny explanatory copy, and interface chrome that competes with the sentence demo or article entry. The reader itself remains a quiet tool rather than a campaign surface.

Avoid playful language-learning gamification unless explicitly requested. The product should not feel like a toy, quiz app, or social feed.

## Design Principles

1. Keep reading primary: article text should remain the visual anchor, with lookup and vocabulary tools supporting it instead of taking over.
2. Preserve flow: common actions such as returning home, editing text directly on the article, copying content, saving articles, and opening vocabulary should be reachable without layout surprises. Entering edit mode must not change the article's typography, width, wrapping, or paragraph spacing.
3. Respect mobile touch intent: vertical scrolling is reading, while phrase selection requires a deliberate horizontal or long-press gesture.
4. Make study artifacts durable: vocabulary data should preserve phonetics, source sentence, contextual meaning, copied explanations, CSV fields, and Anki fields. Anki pronunciation should be available on demand without auto-playing when a card answer is shown.
5. Keep entry compact even when the homepage is expressive: paste and URL controls remain visible on the first screen, saved articles stay reachable from its top navigation, every logical article appears only once in latest-opened order, and longer explanation unfolds through the word demo, phrase demo, recommendations, and final article entry.
6. Reset ephemeral UI state: closing and reopening tools should feel fresh. Search terms, panel scroll offsets, temporary previews, status messages, and resized sheet positions should return to defaults unless preserving them clearly supports uninterrupted reading.

## Accessibility & Inclusion

Target practical WCAG AA readability for body text and controls. Maintain strong contrast for article text, explanations, buttons, and status messages. Do not rely on color alone for important states.

Support reduced-motion expectations by avoiding unnecessary animation in the reading workflow. On mobile, keep scroll behavior predictable and avoid gestures that accidentally block reading.
