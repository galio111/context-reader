import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildContextCloze } from "../lib/ankiData";
import { DeepSeekParseError, explainWordWithDeepSeek } from "../lib/deepseek";
import { cancelActiveLookupRequests, registerActiveLookupRequest } from "../lib/activeLookupRequests";
import { POST as cancelLookupRequest } from "../app/api/lookup-cancel/route";
import { waitForFastImageLocalization } from "../lib/articleImageLocalizationPolicy";
import { parseDictionaryStream } from "../lib/dictionaryStream";
import { scopeReaderTokenId } from "../lib/readerTokenIdentity";
import { ClientRequestCancelledError, classifyStreamTermination } from "../lib/requestCancellation";
import { USER_SESSION_MAX_AGE_SECONDS } from "../lib/sessionPolicy";
import {
  classifyFeatureOrbitGesture,
  FEATURE_ORBIT_AUTOPLAY_MS,
} from "../lib/featureOrbitMotion";
import {
  clampMobileSheetHeight,
  MOBILE_SHEET_DEFAULT_HEIGHT,
  MOBILE_SHEET_MAX_HEIGHT,
  MOBILE_SHEET_TALL_HEIGHT,
} from "../components/useMobileBottomSheet";
import { audienceForDifficulty } from "../lib/articleAudience";
import { orderHomepageCategoryArticles, orderHomepageRecommendations } from "../lib/homepageRecommendations";
import { buildBalancedRecommendationPlan } from "../lib/recommendationBalance";
import { setPublishedArticlePlacement } from "../lib/editorialCuration";
import {
  DEFAULT_DEEPSEEK_USD_TO_CNY_RATE,
  estimateDeepSeekCostMicrocny,
  estimateDeepSeekCostMicrousd,
  microcnyToCny,
  microusdToCny,
  shanghaiUsageWindow,
  summarizeUsageExecutionsByFeature,
  summarizeUsageExecutionsByShanghaiDay,
} from "../lib/usageCost";
import { normalizeHomepageCuration } from "../lib/homepageCurationShared";
import {
  READING_PROGRESS_STABLE_DWELL_MS,
  isRapidReaderScroll,
  isReaderAtBottom,
  shouldRestartSavedArticleOnExit,
  usesSavedArticleRestartPolicy,
} from "../lib/readingProgressPolicy";
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

test("saved-article rapid scans restart at top unless the reader settles, while vocabulary jumps stay exact", () => {
  const now = 20_000;
  assert.equal(usesSavedArticleRestartPolicy("saved-article"), true);
  assert.equal(usesSavedArticleRestartPolicy("vocabulary"), false);
  assert.equal(isRapidReaderScroll(850, 1_200, 1_000), true);
  assert.equal(isRapidReaderScroll(850, 1_201, 1_000), false);
  assert.equal(isReaderAtBottom(5_000, 3_936, 1_000), true);
  assert.equal(shouldRestartSavedArticleOnExit({
    rapidScroll: true,
    atBottom: false,
    settledAt: now - READING_PROGRESS_STABLE_DWELL_MS + 1,
  }, true, now), true);
  assert.equal(shouldRestartSavedArticleOnExit({
    rapidScroll: true,
    atBottom: false,
    settledAt: now - READING_PROGRESS_STABLE_DWELL_MS,
  }, true, now), false);
  assert.equal(shouldRestartSavedArticleOnExit({
    rapidScroll: false,
    atBottom: true,
    settledAt: now - READING_PROGRESS_STABLE_DWELL_MS,
  }, false, now), true);
});

test("client cancellation is not classified as a provider failure", () => {
  assert.equal(classifyStreamTermination({ clientAborted: true, timedOut: false, error: new Error("aborted") }), "cancelled");
  assert.equal(classifyStreamTermination({ clientAborted: false, timedOut: true, error: new Error("aborted") }), "timeout");
  assert.equal(classifyStreamTermination({ clientAborted: false, timedOut: false, error: new Error("failed") }), "failed");
  assert.equal(new ClientRequestCancelledError().name, "ClientRequestCancelledError");
});

test("closing lookup surfaces aborts active provider work without creating a provider report", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const dictionary = readFileSync(new URL("../components/BookDictionary.tsx", import.meta.url), "utf8");
  const explanationRoute = readFileSync(new URL("../app/api/explain-word/route.ts", import.meta.url), "utf8");
  const cancellationRoute = readFileSync(new URL("../app/api/lookup-cancel/route.ts", import.meta.url), "utf8");
  const deepseek = readFileSync(new URL("../lib/deepseek.ts", import.meta.url), "utf8");

  assert.match(reader, /function closeMobileToolSheet\(\)[\s\S]*?cancelActiveExplanationRequest\(\)/);
  assert.match(reader, /onClick=\{closeMobileToolSheet\}>回到原文/);
  assert.match(reader, /<BookDictionary[\s\S]*?active=\{!dictionaryClosing\}/);
  assert.match(reader, /notifyLookupCancellation\(activeExplanationActionIdRef\.current\)/);
  assert.match(dictionary, /if \(!active\) abortActiveDictionaryRequest\(\)/);
  assert.match(dictionary, /notifyLookupCancellation\(activeActionIdRef\.current\)/);
  assert.match(explanationRoute, /registerActiveLookupRequest\(actionId, lookupController\)/);
  assert.match(explanationRoute, /explainWordWithDeepSeek\(safeRequest, lookupController\.signal\)/);
  assert.match(explanationRoute, /error instanceof ClientRequestCancelledError[\s\S]*?refundUsage\(actionId, "cancelled", "client_cancelled"\)[\s\S]*?status: 499/);
  assert.match(cancellationRoute, /cancelActiveLookupRequests\(actionId\)/);
  assert.match(deepseek, /abortCause === "client"[\s\S]*?throw new ClientRequestCancelledError\(\)/);
});

test("explicit cancellation reaches active requests and survives an early close race", () => {
  const earlyActionId = "11111111-1111-4111-8111-111111111111";
  assert.equal(cancelActiveLookupRequests(earlyActionId), 0);
  const lateController = new AbortController();
  registerActiveLookupRequest(earlyActionId, lateController);
  assert.equal(lateController.signal.aborted, true);

  const activeActionId = "22222222-2222-4222-8222-222222222222";
  const first = new AbortController();
  const second = new AbortController();
  registerActiveLookupRequest(activeActionId, first);
  registerActiveLookupRequest(activeActionId, second);
  assert.equal(cancelActiveLookupRequests(activeActionId), 2);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, true);
});

test("lookup cancellation accepts the public origin behind the mainland reverse proxy", async () => {
  const actionId = "66666666-6666-4666-8666-666666666666";
  const controller = new AbortController();
  registerActiveLookupRequest(actionId, controller);
  const response = await cancelLookupRequest(new Request("http://app:3000/api/lookup-cancel", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      Origin: "https://context-reader.com",
      "X-Forwarded-Host": "context-reader.com",
      "X-Forwarded-Proto": "https",
    },
    body: actionId,
  }));
  assert.equal(response.status, 200);
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(await response.json(), { ok: true, cancelled: 1 });
});

test("structured explanation distinguishes an aborted fetch from a completed malformed response", async (t) => {
  const environmentKeys = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_FALLBACK_MODELS",
    "DEEPSEEK_FALLBACK_BASE_URL",
    "DEEPSEEK_FALLBACK_API_KEY",
    "DEEPSEEK_FALLBACK_MODEL",
  ] as const;
  const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    for (const [key, value] of originalEnvironment) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = "https://provider.invalid";
  process.env.DEEPSEEK_MODEL = "test-model";
  process.env.DEEPSEEK_FALLBACK_MODELS = "";
  process.env.DEEPSEEK_FALLBACK_BASE_URL = "";
  process.env.DEEPSEEK_FALLBACK_API_KEY = "";
  process.env.DEEPSEEK_FALLBACK_MODEL = "";

  const request = {
    word: "clear",
    sentence: "The distinction is clear.",
    previousSentence: "",
    nextSentence: "",
  };
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    const rejectAbort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal?.aborted) rejectAbort();
    else signal?.addEventListener("abort", rejectAbort, { once: true });
  })) as typeof fetch;
  const controller = new AbortController();
  const cancelled = explainWordWithDeepSeek(request, controller.signal);
  controller.abort();
  await assert.rejects(cancelled, ClientRequestCancelledError);

  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: "{}" } }],
    usage: {},
  }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  await assert.rejects(explainWordWithDeepSeek(request), (error: unknown) => (
    error instanceof DeepSeekParseError && !(error instanceof ClientRequestCancelledError)
  ));
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

test("admin usage groups executions by Shanghai calendar day", () => {
  const window = shanghaiUsageWindow(new Date("2026-08-30T03:00:00Z"), 3);
  assert.equal(window.windowStart, "2026-08-27T16:00:00.000Z");
  assert.deepEqual(window.dayKeys, ["2026-08-30", "2026-08-29", "2026-08-28"]);

  const days = summarizeUsageExecutionsByShanghaiDay([
    { route: "/api/explain-word", created_at: "2026-08-29T15:59:59Z", model: "deepseek-v4-pro", prompt_tokens: 100, completion_tokens: 20, status: "succeeded" },
    { route: "/api/translate-article", created_at: "2026-08-29T16:00:00Z", model: "deepseek-v4-pro", prompt_tokens: 200, completion_tokens: 40, status: "failed" },
  ], window.dayKeys);

  assert.equal(days[0].date, "2026-08-30");
  assert.equal(days[0].executions, 1);
  assert.equal(days[0].failed, 1);
  assert.equal(days[0].promptTokens, 200);
  assert.equal(days[1].executions, 1);
  assert.equal(days[1].failed, 0);
  assert.equal(days[2].executions, 0);

  const features = summarizeUsageExecutionsByFeature([
    { route: "/api/explain-word", created_at: "2026-08-29T15:59:59Z", model: "deepseek-v4-pro", prompt_tokens: 100, completion_tokens: 20, status: "succeeded" },
    { route: "/api/translate-article", created_at: "2026-08-29T16:00:00Z", model: "deepseek-v4-pro", prompt_tokens: 2_000, completion_tokens: 400, status: "succeeded" },
  ]);
  assert.equal(features[0].key, "translation");
  assert.equal(features[0].label, "全文翻译");
  assert.equal(features[0].executions, 1);
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
  assert.match(page, /editorialMobileActions=\{<>[\s\S]*?候选 \{candidateArticles\.length\}[\s\S]*?精选 \{publicArticles\.length\}/);
  assert.match(page, /function resetEditorialReaderViewport\(\)/);
  assert.match(page, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(inspector, /适合人群（可多选）/);
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

test("category curation keeps the lead order without hiding the remaining published articles", () => {
  const articles = Array.from({ length: 12 }, (_, index) => recommendationArticle(String(index + 1)));
  const ordered = orderHomepageCategoryArticles(articles, ["3", "1"]);
  assert.deepEqual(ordered.slice(0, 2).map((article) => article.id), ["3", "1"]);
  assert.equal(ordered.length, 12);
  assert.equal(new Set(ordered.map((article) => article.id)).size, 12);
});

test("temporary reading bands expose the two overlapping audience groups", () => {
  assert.deepEqual(audienceForDifficulty("高中 / CET-4"), ["高中", "CET-4", "IELTS", "TOEFL"]);
  assert.deepEqual(audienceForDifficulty("雅思 / 托福基础"), ["高中", "CET-4", "IELTS", "TOEFL"]);
  assert.deepEqual(audienceForDifficulty("CET-6 / 考研"), ["CET-6", "考研", "IELTS", "TOEFL"]);
  assert.deepEqual(audienceForDifficulty("雅思 / 托福进阶"), ["CET-6", "考研", "IELTS", "TOEFL"]);
});

test("daily crawler plan fills the most underrepresented editorial categories first", () => {
  const published = Array.from({ length: 5 }, (_, index) => ({
    ...recommendationArticle(`tech-${index}`),
    recommendation: { ...recommendationArticle(`tech-${index}`).recommendation!, homepageCategory: "科技" as const },
  }));
  const candidates = [{
    ...recommendationArticle("business-1"),
    recommendation: { ...recommendationArticle("business-1").recommendation!, homepageCategory: "商业" as const },
  }];
  const plan = buildBalancedRecommendationPlan(candidates, published, 3, new Date("2026-08-30T00:00:00.000Z"));
  const targets = new Map(plan.map((item) => [item.category, item.targetCount]));
  assert.equal(targets.get("商业"), 1);
  assert.equal(targets.get("时事"), 1);
  assert.equal(targets.get("文化"), 1);
  assert.equal(targets.get("科技"), undefined);
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
  assert.equal(estimateDeepSeekCostMicrousd("deepseek-v4-pro", usage, new Date("2026-08-23T02:00:00Z")), 858);
  assert.equal(estimateDeepSeekCostMicrocny("deepseek-v4-pro", usage, new Date("2026-08-15T00:00:00Z")), 3_600);
  assert.equal(estimateDeepSeekCostMicrocny("deepseek-v4-pro", usage, new Date("2026-08-20T00:00:00Z")), 5_850);
  assert.equal(estimateDeepSeekCostMicrocny("deepseek-v4-pro", usage, new Date("2026-08-20T02:00:00Z")), 11_700);
  assert.equal(estimateDeepSeekCostMicrocny("deepseek-v4-pro", usage, new Date("2026-08-23T02:00:00Z")), 5_850);
  assert.equal(DEFAULT_DEEPSEEK_USD_TO_CNY_RATE, 7.2);
  assert.equal(microusdToCny(1_000_000, 7.2), 7.2);
  assert.equal(microcnyToCny(1_000_000), 1);
});

test("mobile tools reopen at 56 percent and never expand beyond 82 percent", () => {
  assert.equal(MOBILE_SHEET_DEFAULT_HEIGHT, 56);
  assert.equal(MOBILE_SHEET_MAX_HEIGHT, 82);
  assert.equal(MOBILE_SHEET_TALL_HEIGHT, 76);
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

test("mobile overlays lock background scroll and adapt across viewport changes", () => {
  const menu = readFileSync(new URL("../components/HomeOptionMenu.tsx", import.meta.url), "utf8");
  const vocabulary = readFileSync(new URL("../components/VocabularyPanel.tsx", import.meta.url), "utf8");
  const scrollLock = readFileSync(new URL("../components/useDocumentScrollLock.ts", import.meta.url), "utf8");
  const sheet = readFileSync(new URL("../components/useMobileBottomSheet.ts", import.meta.url), "utf8");
  const menuStyles = readFileSync(new URL("../components/HomeOptionMenu.module.css", import.meta.url), "utf8");

  assert.match(menu, /useDocumentScrollLock\(mounted\)/);
  assert.match(vocabulary, /useDocumentScrollLock\(open\)/);
  assert.match(scrollLock, /activeLocks \+= 1/);
  assert.match(scrollLock, /body\.style\.position = "fixed"/);
  assert.match(scrollLock, /window\.scrollTo\(previous\.scrollX, previous\.scrollY\)/);
  assert.match(menu, /pinnedPreview === "vocabulary" \? MOBILE_SHEET_TALL_HEIGHT/);
  assert.match(sheet, /\[initialHeight, open, resetKey\]/);
  assert.match(vocabulary, /matchMedia\("\(max-width: 639px\)"\)/);
  assert.match(vocabulary, /rowVirtualizer\.measure\(\)/);
  assert.match(menuStyles, /@media \(hover: none\), \(pointer: coarse\)/);
  assert.match(menuStyles, /\.mobileSheetHandle \{[\s\S]*?height: 44px/);
  assert.match(menuStyles, /\.menuItem \{[\s\S]*?min-height: 44px/);
  assert.doesNotMatch(menuStyles, /color: #657985|color: #687b86|color: #607581/);
});

test("mobile vocabulary hides Anki actions and image captions use reader tokens", () => {
  const menu = readFileSync(new URL("../components/HomeOptionMenu.tsx", import.meta.url), "utf8");
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  assert.match(menu, /showAnkiActions=\{!mobileMenu\}/);
  assert.match(menu, /\{!mobileMenu && <div className=\{styles\.ankiToolbar\}>/);
  assert.match(reader, /image-caption:\$\{block\.id\}/);
  assert.match(reader, /renderTokenList\(block\.captionTokens\)/);
});

test("release image retention preserves current and direct-parent rollback images", () => {
  const script = readFileSync(new URL("../ops/mainland/prune-release-images.sh", import.meta.url), "utf8");
  assert.match(script, /flock -n 9/);
  assert.match(script, /accepted-\$current_id/);
  assert.match(script, /accepted-\$parent_id/);
  assert.match(script, /docker image prune -f/);
  assert.doesNotMatch(script, /docker (?:system|volume) prune|rm -rf/);
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
