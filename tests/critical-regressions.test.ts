import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildContextCloze } from "../lib/ankiData";
import { waitForFastImageLocalization } from "../lib/articleImageLocalizationPolicy";
import { parseDictionaryStream } from "../lib/dictionaryStream";
import { scopeReaderTokenId } from "../lib/readerTokenIdentity";
import { classifyStreamTermination } from "../lib/requestCancellation";
import { USER_SESSION_MAX_AGE_SECONDS } from "../lib/sessionPolicy";
import {
  classifyFeatureOrbitGesture,
  FEATURE_ORBIT_AUTOPLAY_MS,
} from "../lib/featureOrbitMotion";
import {
  clampMobileSheetHeight,
  MOBILE_SHEET_DEFAULT_HEIGHT,
  MOBILE_SHEET_MAX_HEIGHT,
} from "../components/useMobileBottomSheet";
import { audienceForDifficulty } from "../lib/articleAudience";
import { orderHomepageRecommendations } from "../lib/homepageRecommendations";
import { setPublishedArticlePlacement } from "../lib/editorialCuration";
import { estimateDeepSeekCostMicrousd } from "../lib/usageCost";
import { normalizeHomepageCuration } from "../lib/homepageCurationShared";
import type { PublicArticle } from "../types/publicArticle";

function recommendationArticle(id: string, options?: { cover?: boolean }): PublicArticle {
  return {
    id,
    title: `Article ${id}`,
    summary: "Summary",
    body: "Body text for a published article.",
    sourceUrl: `https://example.com/${id}`,
    sourceName: "Example",
    published: true,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    recommendation: {
      coverImageUrl: options?.cover === false ? "" : `https://example.com/${id}.webp`,
      difficulty: "CET-6 / 考研",
      cefr: "C1",
      audienceStages: ["CET-6", "考研", "IELTS", "TOEFL"],
      topics: ["科技科学"],
      wordCount: 600,
      timeliness: "evergreen",
      sourceKind: "manual-url",
      classificationSource: "manual",
    },
  };
}

test("reader token ids stay unique across article blocks", () => {
  assert.notEqual(scopeReaderTokenId("paragraph-0-", "word-4"), scopeReaderTokenId("paragraph-1-", "word-4"));
});

test("client cancellation is not classified as a provider failure", () => {
  assert.equal(classifyStreamTermination({ clientAborted: true, timedOut: false, error: new Error("aborted") }), "cancelled");
  assert.equal(classifyStreamTermination({ clientAborted: false, timedOut: true, error: new Error("aborted") }), "timeout");
  assert.equal(classifyStreamTermination({ clientAborted: false, timedOut: false, error: new Error("failed") }), "failed");
});

test("context cloze tolerates normalized apostrophes in saved phrases", () => {
  assert.equal(
    buildContextCloze(
      "But a mutual fund or ETF won’t necessarily provide diversification.",
      "won t necessarily",
    ),
    "But a mutual fund or ETF ________ provide diversification.",
  );
});

test("normal image localization completes inline while slow localization falls back to background", async () => {
  const fast = await waitForFastImageLocalization(Promise.resolve("localized"), 20);
  assert.deepEqual(fast, { mode: "fast", value: "localized" });

  let resolveSlow!: (value: string) => void;
  const slowPromise = new Promise<string>((resolve) => { resolveSlow = resolve; });
  const slow = await waitForFastImageLocalization(slowPromise, 1);
  assert.equal(slow.mode, "background");
  resolveSlow("localized-later");
  if (slow.mode === "background") assert.equal(await slow.pending, "localized-later");
});

test("authenticated browser session uses the accepted 400-day rolling window", () => {
  assert.equal(USER_SESSION_MAX_AGE_SECONDS, 400 * 24 * 60 * 60);
});

test("ambiguous standalone lookup preserves inflection and independent headword senses", () => {
  const parsed = parseDictionaryStream([
    JSON.stringify({ type: "head", query: "fell", lemma: "fall / fell", inputStatus: "ambiguous" }),
    JSON.stringify({ type: "sense", headword: "fall", headwordNote: "fall 的过去式", partOfSpeech: "verb", meaning: "落下；下降" }),
    JSON.stringify({ type: "sense", headword: "fell", headwordNote: "独立词头", partOfSpeech: "verb", meaning: "砍倒" }),
    JSON.stringify({ type: "done" }),
  ].join("\n"), "fell");
  assert.equal(parsed.result.inputStatus, "ambiguous");
  assert.deepEqual(parsed.result.senses.map((sense) => sense.headword), ["fall", "fell"]);
});

test("admin curation remounts and releases per-article working state", () => {
  const page = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const inspector = readFileSync(new URL("../components/AdminArticleMetadataInspector.tsx", import.meta.url), "utf8");
  assert.match(page, /<AdminArticleMetadataInspector\s+key=\{`\$\{readerState\.kind\}:\$\{readerState\.article\.id\}`\}/);
  assert.match(inspector, /finally \{ setWorking\(""\); \}/);
});

test("recommendations keep Admin choices first and fill a full three-row showcase", () => {
  const articles = Array.from({ length: 12 }, (_, index) => recommendationArticle(String(index + 1), { cover: index !== 4 }));
  const curation = normalizeHomepageCuration({
    version: 2,
    categories: { 推荐: ["2", "1"], 时事: [], 科技: [], 文化: [], 商业: [] },
    recommendationFeaturedId: "2",
  });
  const ordered = orderHomepageRecommendations(articles, curation, {
    version: 1, readingLevel: "", interests: [], updatedAt: "", scope: "guest",
  }, "2026-08-29");
  assert.equal(ordered[0].id, "2");
  assert.equal(ordered[1].id, "1");
  assert.equal(ordered.length, 12);
  assert.equal(ordered.slice(0, 10).length, 10);
  assert.ok(ordered.findIndex((article) => article.id === "5") > ordered.findIndex((article) => article.id === "6"));
});

test("C1 exam bands overlap CET-6, postgraduate, IELTS and TOEFL audiences", () => {
  assert.deepEqual(audienceForDifficulty("CET-6 / 考研"), ["CET-6", "考研", "IELTS", "TOEFL"]);
  assert.deepEqual(audienceForDifficulty("雅思 / 托福基础"), ["CET-6", "考研", "IELTS", "TOEFL"]);
});

test("published placement can remove recommendation membership and move category atomically", () => {
  const current = normalizeHomepageCuration({
    version: 2,
    categories: { 推荐: ["a", "b"], 时事: ["a"], 科技: ["b"], 文化: [], 商业: [] },
    recommendationFeaturedId: "a",
  });
  const next = setPublishedArticlePlacement(current, "a", "文化", {
    categoryFeatured: false,
    includeInRecommendation: false,
    recommendationFeatured: false,
  });
  assert.equal(next.recommendationFeaturedId, "");
  assert.ok(!next.categories.推荐.includes("a"));
  assert.ok(!next.categories.时事.includes("a"));
  assert.deepEqual(next.categories.文化, ["a"]);
});

test("DeepSeek estimates use historical and peak/off-peak prices at execution time", () => {
  const usage = { prompt_tokens: 1_000, prompt_cache_miss_tokens: 1_000, completion_tokens: 100 };
  assert.equal(estimateDeepSeekCostMicrousd("deepseek-v4-pro", usage, new Date("2026-08-15T00:00:00Z")), 522);
  assert.equal(estimateDeepSeekCostMicrousd("deepseek-v4-pro", usage, new Date("2026-08-20T00:00:00Z")), 858);
  assert.equal(estimateDeepSeekCostMicrousd("deepseek-v4-pro", usage, new Date("2026-08-20T02:00:00Z")), 1_716);
});

test("mobile tools reopen at 56 percent and never expand beyond 82 percent", () => {
  assert.equal(MOBILE_SHEET_DEFAULT_HEIGHT, 56);
  assert.equal(MOBILE_SHEET_MAX_HEIGHT, 82);
  assert.equal(clampMobileSheetHeight(96), 82);
  assert.equal(clampMobileSheetHeight(68), 68);

  const menuStyles = readFileSync(new URL("../components/HomeOptionMenu.module.css", import.meta.url), "utf8");
  const readerStyles = readFileSync(new URL("../components/ReaderToolbar.module.css", import.meta.url), "utf8");
  const explanationPanel = readFileSync(new URL("../components/ExplanationPanel.tsx", import.meta.url), "utf8");
  assert.match(menuStyles, /height: var\(--mobile-sheet-height, 56dvh\)/);
  assert.match(readerStyles, /height: var\(--mobile-work-sheet-height, 56dvh\)/);
  assert.doesNotMatch(menuStyles.slice(menuStyles.indexOf("@media (max-width: 760px)")), /height: 100svh/);
  assert.doesNotMatch(explanationPanel, />\s*收起\s*</);
});

test("mobile Menu keeps theme controls tappable and vocabulary rows selectable", () => {
  const menu = readFileSync(new URL("../components/HomeOptionMenu.tsx", import.meta.url), "utf8");
  const menuStyles = readFileSync(new URL("../components/HomeOptionMenu.module.css", import.meta.url), "utf8");
  const globals = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const account = readFileSync(new URL("../components/AccountUsagePageContent.tsx", import.meta.url), "utf8");

  assert.match(menu, /<section data-mobile-theme>/);
  assert.equal((menu.match(/<section data-mobile-hidden>/g) ?? []).length, 2);
  assert.match(menuStyles, /\.settingsPanel section\[data-mobile-hidden\] \{ display: none; \}/);
  assert.match(menuStyles, /\.themeChoices button \{[^}]*touch-action: manipulation/);
  assert.doesNotMatch(
    menuStyles.slice(0, menuStyles.indexOf("@media (hover: hover) and (pointer: fine)")),
    /\.savedList\[data-scrolling="true"\] \.vocabularyEntry \{[^}]*pointer-events: none/,
  );
  assert.match(menuStyles, /@media \(hover: hover\) and \(pointer: fine\) \{\s*\.savedList\[data-scrolling="true"\] \.vocabularyEntry \{\s*pointer-events: none;/);
  assert.match(account, /data-embedded=\{embedded \|\| undefined\}/);
  assert.match(globals, /\.cr-account-usage\[data-embedded\] \.cr-account-login/);
});

test("homepage feature cards reserve vertical gestures for page scrolling", () => {
  assert.equal(FEATURE_ORBIT_AUTOPLAY_MS, 6_000);
  assert.equal(classifyFeatureOrbitGesture(4, 7), "pending");
  assert.equal(classifyFeatureOrbitGesture(13, 5), "horizontal");
  assert.equal(classifyFeatureOrbitGesture(7, 15), "vertical");

  const component = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../components/HomeRedesign.module.css", import.meta.url), "utf8");
  assert.match(component, /!memberHome && !compactViewport && <div className=\{styles\.ballField\}/);
  assert.match(component, /setFeatureAutoplayStopped\(true\)/);
  assert.match(styles, /\.ballField, \.coverBreath \{ display: none; \}/);
  assert.match(styles, /\.closingActions \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.qrToggle, \.wechatQr \{ display: none !important; \}/);
});
