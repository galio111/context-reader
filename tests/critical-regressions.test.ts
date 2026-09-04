import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildContextCloze } from "../lib/ankiData";
import { DeepSeekParseError, explainWordWithDeepSeek } from "../lib/deepseek";
import {
  cancelActiveLookupRequests,
  registerActiveLookupRequest,
  waitForLookupPeersOrCancellation,
} from "../lib/activeLookupRequests";
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
import { homepageShowcaseArticles, orderHomepageCategoryArticles, orderHomepageRecommendations } from "../lib/homepageRecommendations";
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
import { createArticleTranslationCacheKey } from "../lib/articleTranslationIdentity";
import { cursorAnchoredImageZoom } from "../lib/imageZoom";
import { createSourceSentenceIndex, findBestSourceSentenceMatchInIndex } from "../lib/sourceMatching";
import { tokenizeArticle } from "../lib/tokenizer";
import { extractArticleTranslationText, IncrementalJsonObjectParser } from "../lib/incrementalJsonObjects";
import { removeDuplicateImageCaptionBlocks } from "../lib/articleContentSanitizer";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import {
  coreDeepSeekModelCandidates,
  fetchWithDeepSeekModelFailover,
  isRetryableDeepSeekStatus,
} from "../lib/deepseekModelFailover";
import { DictionaryProviderStreamNormalizer } from "../lib/dictionaryStreamServer";
import { guestCoverTouchSnapTarget } from "../lib/guestCoverTouchSnap";

test("core lookup routes fall back from overloaded Pro to Flash", async () => {
  assert.deepEqual(coreDeepSeekModelCandidates("deepseek-v4-pro", undefined), [
    "deepseek-v4-pro",
    "deepseek-v4-flash",
  ]);
  assert.deepEqual(coreDeepSeekModelCandidates("deepseek-v4-pro", ""), ["deepseek-v4-pro"]);
  assert.equal(isRetryableDeepSeekStatus(429), true);
  assert.equal(isRetryableDeepSeekStatus(503), true);
  assert.equal(isRetryableDeepSeekStatus(400), false);

  const attemptedModels: string[] = [];
  const failedOverModels: string[] = [];
  const result = await fetchWithDeepSeekModelFailover({
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    attempt: async (model) => {
      attemptedModels.push(model);
      return model === "deepseek-v4-pro"
        ? new Response(JSON.stringify({ error: { message: "Server Overloaded" } }), { status: 503 })
        : new Response("ok", { status: 200 });
    },
    onFailover: ({ model }) => { failedOverModels.push(model); },
  });

  assert.deepEqual(attemptedModels, ["deepseek-v4-pro", "deepseek-v4-flash"]);
  assert.deepEqual(failedOverModels, ["deepseek-v4-pro"]);
  assert.equal(result.model, "deepseek-v4-flash");
  assert.equal(await result.response.text(), "ok");

  const explanationStream = readFileSync(new URL("../app/api/explain-word-stream/route.ts", import.meta.url), "utf8");
  const dictionaryStream = readFileSync(new URL("../app/api/dictionary-stream/route.ts", import.meta.url), "utf8");
  const structuredExplanation = readFileSync(new URL("../lib/deepseek.ts", import.meta.url), "utf8");
  assert.match(explanationStream, /fetchWithDeepSeekModelFailover/);
  assert.match(dictionaryStream, /fetchWithDeepSeekModelFailover/);
  assert.match(structuredExplanation, /coreDeepSeekModelCandidates/);
});

test("standalone dictionary compacts pretty provider JSON across arbitrary chunks", () => {
  const normalizer = new DictionaryProviderStreamNormalizer("resilient");
  const output = [
    ...normalizer.push('```json\n{\n  "type": "head",\n  "query": "wrong",\n  "lemma": "resilient",\n'),
    ...normalizer.push('  "phonetic": "/rɪˈzɪliənt/",\n  "phoneticFor": "resilient",\n  "direction": "en_to_cn",\n  "inputStatus": "valid"\n}\n{\n  "type": "sense",\n'),
    ...normalizer.push('  "partOfSpeech": "adjective",\n  "meaning": "有韧性的"\n}\n{\n  "type": "done"\n}\n```'),
  ];
  assert.equal(output.length, 3);
  assert.ok(output.every((line) => !line.includes("\n")));
  const parsed = parseDictionaryStream(`${output.join("\n")}\n`, "resilient");
  assert.equal(parsed.complete, true);
  assert.equal(parsed.result.query, "resilient");
  assert.equal(parsed.result.senses[0]?.meaning, "有韧性的");
});

test("article translation streaming parses complete objects without physical newlines", () => {
  const parser = new IncrementalJsonObjectParser();
  const first = parser.push('```jsonl\n{"id":"a","translation":"甲"}{"id":"b","trans');
  assert.deepEqual(first, [{ id: "a", translation: "甲" }]);
  const second = parser.push('lation":"含有 \\"引号\\" 和 {括号}"}\n```');
  assert.deepEqual(second, [{ id: "b", translation: '含有 "引号" 和 {括号}' }]);

  const wrappedParser = new IncrementalJsonObjectParser();
  const wrapped = wrappedParser.push('{"translations":[{"id":"c","translation":"丙"},{"id":"d","translation":"丁"}]}');
  assert.ok(wrapped.some((value) => (value as { id?: string }).id === "c"));
  assert.ok(wrapped.some((value) => (value as { id?: string }).id === "d"));
});

test("article translation streaming accepts provider block-type fields only for the requested type", () => {
  assert.equal(
    extractArticleTranslationText({ id: "block-0", heading: " 标题译文 " }, "heading"),
    "标题译文",
  );
  assert.equal(
    extractArticleTranslationText({ id: "block-2", paragraph: " 段落译文 " }, "paragraph"),
    "段落译文",
  );
  assert.equal(
    extractArticleTranslationText({ id: "block-2", commentary: "不能误收" }, "paragraph"),
    "",
  );
  assert.equal(
    extractArticleTranslationText({ id: "block-2", translation: "标准译文", paragraph: "备用译文" }, "paragraph"),
    "标准译文",
  );
});

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
  assert.match(explanationRoute, /waitForLookupPeersOrCancellation\(actionId, lookupController\)/);
  assert.match(explanationRoute, /error instanceof ClientRequestCancelledError[\s\S]*?refundUsage\(actionId, "cancelled", "client_cancelled"\)[\s\S]*?status: 499/);
  assert.match(cancellationRoute, /cancelActiveLookupRequests\(actionId\)/);
  assert.match(deepseek, /abortCause === "client"[\s\S]*?throw new ClientRequestCancelledError\(\)/);
});

test("structured lookup defers provider reporting while its stream peer can still be cancelled", async () => {
  const cancelledActionId = "33333333-3333-4333-8333-333333333333";
  const structuredController = new AbortController();
  const unregisterStructured = registerActiveLookupRequest(cancelledActionId, structuredController);
  const cancellationDecision = waitForLookupPeersOrCancellation(cancelledActionId, structuredController, {
    peerJoinGraceMs: 100,
    maxWaitMs: 500,
    pollMs: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const streamController = new AbortController();
  registerActiveLookupRequest(cancelledActionId, streamController);
  await new Promise((resolve) => setTimeout(resolve, 10));
  cancelActiveLookupRequests(cancelledActionId);
  assert.equal(await cancellationDecision, "cancelled");
  unregisterStructured();

  const completedActionId = "44444444-4444-4444-8444-444444444444";
  const completedStructuredController = new AbortController();
  const unregisterCompletedStructured = registerActiveLookupRequest(completedActionId, completedStructuredController);
  const completedDecision = waitForLookupPeersOrCancellation(completedActionId, completedStructuredController, {
    peerJoinGraceMs: 100,
    maxWaitMs: 500,
    pollMs: 5,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const completedStreamController = new AbortController();
  const unregisterCompletedStream = registerActiveLookupRequest(completedActionId, completedStreamController);
  await new Promise((resolve) => setTimeout(resolve, 10));
  unregisterCompletedStream();
  assert.equal(await completedDecision, "settled");
  unregisterCompletedStructured();
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

  process.env.DEEPSEEK_MODEL = "deepseek-v4-pro";
  delete process.env.DEEPSEEK_FALLBACK_MODELS;
  const attemptedModels: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const model = String(JSON.parse(String(init?.body)).model);
    attemptedModels.push(model);
    if (model === "deepseek-v4-pro") {
      return new Response(JSON.stringify({ error: { message: "Server Overloaded" } }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        basicMeaning: "清楚的",
        contextMeaning: "清晰的",
        sentenceTranslation: "这个区别很清楚。",
        usageNote: "用于说明界限容易辨认。",
        collocation: "clear distinction（明确区别）",
        exampleChinese: "这个区别很清楚。",
      }) } }],
      usage: {},
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const recovered = await explainWordWithDeepSeek(request);
  assert.equal(recovered.model, "deepseek-v4-flash");
  assert.deepEqual(attemptedModels, ["deepseek-v4-pro", "deepseek-v4-pro", "deepseek-v4-flash"]);
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

test("recommendations treat the Admin pool as authoritative and keep text-only entries out of the collapsed rows", () => {
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
  assert.deepEqual(ordered.map((article) => article.id), ["2", "1"]);
  assert.deepEqual(homepageShowcaseArticles(ordered, 10).map((article) => article.id), ["2", "1"]);
});

test("category curation keeps the lead order without hiding the remaining published articles", () => {
  const articles = Array.from({ length: 12 }, (_, index) => recommendationArticle(String(index + 1)));
  const ordered = orderHomepageCategoryArticles(articles, ["3", "1"]);
  assert.deepEqual(ordered.slice(0, 2).map((article) => article.id), ["3", "1"]);
  assert.equal(ordered.length, 12);
  assert.equal(new Set(ordered.map((article) => article.id)).size, 12);
});

test("text-only articles stay out of the three post-feature rows and rejoin the expanded tail", () => {
  const articles = Array.from({ length: 15 }, (_, index) => recommendationArticle(String(index + 1), {
    cover: ![0, 4, 7, 10, 13].includes(index),
  }));
  const curation = normalizeHomepageCuration({
    version: 2,
    categories: { 推荐: articles.map((article) => article.id), 时事: [], 科技: [], 文化: [], 商业: [] },
    recommendationFeaturedId: "1",
  });
  const ordered = orderHomepageRecommendations(articles, curation, {
    version: 1, readingLevel: "", interests: [], updatedAt: "", scope: "guest",
  }, "2026-09-02");
  assert.equal(ordered[0].id, "1");
  assert.ok(ordered.slice(1, 10).every((article) => Boolean(article.recommendation?.coverImageUrl)));
  assert.equal(homepageShowcaseArticles(ordered, 10).length, 10);
  assert.ok(ordered.slice(10).some((article) => !article.recommendation?.coverImageUrl));

  const automaticCategory = orderHomepageCategoryArticles(articles, []);
  assert.ok(automaticCategory.slice(0, 10).every((article) => Boolean(article.recommendation?.coverImageUrl)));
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
  assert.deepEqual(next.categories.文化, []);
});

test("recommendation motion rebinds when preference ordering swaps article ids without changing length", () => {
  const source = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  assert.match(source, /const displayArticleMotionKey = displayArticles\.map\(\(article\) => article\.id\)/);
  assert.match(source, /\[activeCategory, displayArticleMotionKey\]/);
  assert.match(source, /Math\.max\(2, Math\.ceil\(words \/ 120\)\)/);
});

test("URL extraction decodes publisher entities that were escaped twice", () => {
  const extracted = extractImportedArticleFromHtml(`<!doctype html><html><head><title>Study</title></head><body><article><h1>Study</h1><p>Researchers at T&amp;uuml;bingen University reported a meaningful result for participants in a carefully controlled longitudinal study.</p><p>The second paragraph supplies enough substantive article text for the extractor to retain the complete reading body.</p></article></body></html>`, "https://example.com/study");
  assert.ok(extracted);
  assert.match(extracted.article.text, /Tübingen University/);
  assert.doesNotMatch(extracted.article.text, /&uuml;/);
});

test("public article saves request the charged prepublished summary cache", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/summarize-article/route.ts", import.meta.url), "utf8");
  assert.match(reader, /publicArticleId: articleSource\?\.kind === "public"/);
  assert.match(route, /finishUsage\(actionId, "cached", true, false\)/);
});

test("word lookup transports run stream-first instead of racing duplicate provider requests", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const legacyReader = readFileSync(new URL("../components/BookHome.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(reader, /const structuredPromise = requestExplanation/);
  assert.doesNotMatch(legacyReader, /Promise\.all\(\[\s*requestContextExplanation/);
});

test("warning diagnostics stay in Admin without sending panic mail", () => {
  const store = readFileSync(new URL("../lib/errorReportStore.ts", import.meta.url), "utf8");
  const dictionaryRoute = readFileSync(new URL("../app/api/dictionary-stream/route.ts", import.meta.url), "utf8");
  assert.match(store, /const emailWorthy = normalized\.severity === "error" \|\| normalized\.severity === "critical"/);
  assert.match(dictionaryRoute, /errorCode: "provider_incomplete_content"[\s\S]*?finishUsage\(actionId, "succeeded"\)/);
  assert.doesNotMatch(dictionaryRoute, /refundUsage\(actionId, "failed", "provider_incomplete_content"\)/);
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
  assert.match(scrollLock, /body\.style\.width = scrollbarWidth > 0 \? `calc\(100% - \$\{scrollbarWidth\}px\)`/);
  assert.doesNotMatch(scrollLock, /body\.style\.paddingRight = `\$\{scrollbarWidth\}px`/);
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

test("temporary pasted and URL articles confirm before every route back to home", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../components/HomeClient.tsx", import.meta.url), "utf8");
  assert.match(reader, /confirmUnsavedExit && !articleSaved/);
  assert.match(home, /originKind === "pasted-text" \|\| originKind === "url-import"/);
  assert.match(home, /approvedReaderBackRef\.current = true/);
});

test("reader bottom sheets own gestures without locking the exposed article", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const boundary = readFileSync(new URL("../components/useMobileSheetScrollBoundary.ts", import.meta.url), "utf8");
  assert.match(reader, /useDocumentScrollLock\(mobileViewport && \(Boolean\(readerWorkLayer\) \|\| dictionaryMounted\)\)/);
  assert.doesNotMatch(reader, /useDocumentScrollLock\([^\n]*mobileExplanationOpen/);
  assert.match(reader, /ref=\{mobileToolScrollBoundaryRef\}/);
  assert.match(boundary, /canConsumeVerticalScroll/);
  assert.match(boundary, /addEventListener\("touchmove", onTouchMove, \{ passive: false \}\)/);
  assert.match(boundary, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(boundary, /useEffect\([\s\S]*?\}, \[root\]\)/);
  assert.match(boundary, /event\.preventDefault\(\)/);
  assert.match(boundary, /element\.scrollTop \+ element\.clientHeight < element\.scrollHeight - 1/);
});

test("mobile sheet return controls stay above drag handles with full touch targets", () => {
  const menuStyles = readFileSync(new URL("../components/HomeOptionMenu.module.css", import.meta.url), "utf8");
  const readerStyles = readFileSync(new URL("../components/ReaderToolbar.module.css", import.meta.url), "utf8");
  const homeStyles = readFileSync(new URL("../components/HomeRedesign.module.css", import.meta.url), "utf8");
  assert.match(menuStyles, /\.mobilePreviewBack\s*\{[\s\S]*?z-index:\s*64[\s\S]*?min-height:\s*48px/);
  assert.match(menuStyles, /\.mobileSheetHandle\s*\{[\s\S]*?z-index:\s*52/);
  assert.match(readerStyles, /\.mobileSheetHeader button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(readerStyles, /\.workLayer > header > button\s*\{[^}]*min-height:\s*44px/);
  assert.match(homeStyles, /\.dictionaryWindow > header button\s*\{[^}]*min-height:\s*44px/);
});

test("homepage dictionary is docked instead of restoring a draggable floating window", () => {
  const component = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../components/HomeRedesign.module.css", import.meta.url), "utf8");
  assert.doesNotMatch(component, /context-reader-dictionary-window-v1|startDictionaryDrag|persistDictionaryWindow/);
  assert.match(component, /MOBILE_SHEET_MAX_HEIGHT/);
  assert.match(styles, /\.dictionaryWindow\s*\{[\s\S]*?inset:\s*0 auto 0 0[\s\S]*?height:\s*100dvh/);
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

test("guest cover touch gestures snap without turning horizontal drags into page navigation", () => {
  const upward = guestCoverTouchSnapTarget({
    deltaX: 5,
    deltaY: -64,
    viewportHeight: 1024,
    startedInHandoff: true,
    startedNearRecommendations: false,
  });
  const downward = guestCoverTouchSnapTarget({
    deltaX: 3,
    deltaY: 58,
    viewportHeight: 1024,
    startedInHandoff: false,
    startedNearRecommendations: true,
  });
  assert.equal(upward, "recommendations");
  assert.equal(downward, "cover");
  assert.equal(guestCoverTouchSnapTarget({
    deltaX: 52,
    deltaY: -34,
    viewportHeight: 1024,
    startedInHandoff: true,
    startedNearRecommendations: false,
  }), null);
  assert.equal(guestCoverTouchSnapTarget({
    deltaX: 2,
    deltaY: -18,
    viewportHeight: 768,
    startedInHandoff: true,
    startedNearRecommendations: false,
  }), null);

  const component = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  assert.match(component, /addEventListener\("touchstart", handleTouchStart, \{ passive: true \}\)/);
  assert.match(component, /addEventListener\("touchend", handleTouchEnd, \{ passive: true \}\)/);
  assert.match(component, /closest\?\.\("\[data-local-scroll-surface\]"\)/);
});

test("every recommendation card receives a painted entry keyframe before observation", () => {
  const component = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  assert.match(component, /cards\.forEach\(\(card\) => \{[\s\S]*?delete card\.dataset\.visible/);
  assert.match(component, /requestAnimationFrame\(\(\) => \{\s*observeFrame = window\.requestAnimationFrame/);
  assert.match(component, /cards\.forEach\(\(card\) => observer\.observe\(card\)\)/);
});

test("image zoom keeps the source pixel under a changed cursor position", () => {
  const firstCursor = { x: 240, y: 160 };
  const first = cursorAnchoredImageZoom({ scale: 1, x: 0, y: 0 }, 1.5, firstCursor);
  assert.equal(first.x + (firstCursor.x * first.scale), firstCursor.x);
  assert.equal(first.y + (firstCursor.y * first.scale), firstCursor.y);

  const secondCursor = { x: 680, y: 420 };
  const sourceX = (secondCursor.x - first.x) / first.scale;
  const sourceY = (secondCursor.y - first.y) / first.scale;
  const second = cursorAnchoredImageZoom(first, 2, secondCursor);
  assert.equal(second.x + (sourceX * second.scale), secondCursor.x);
  assert.equal(second.y + (sourceY * second.scale), secondCursor.y);
});

test("reader image loading and zoom stay outside the long article render state", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(reader, /loadedImageBlockIds|setLoadedImageBlockIds/);
  assert.match(reader, /function ActiveImageCanvas/);
  assert.match(reader, /cursorAnchoredImageZoom\(targetTransformRef\.current/);
  assert.match(reader, /addEventListener\("wheel", onWheel, \{ passive: false \}\)/);
  assert.match(reader, /className="absolute right-3 top-3 z-\[2\][^"]*"[\s\S]*?点击放大/);
});

test("long readers hydrate only nearby lookup tokens", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  assert.match(reader, /new IntersectionObserver/);
  assert.match(reader, /rootMargin: "900px 0px 900px 0px"/);
  assert.match(reader, /data-reader-token-surface/);
  assert.match(reader, /interactive && block\.tokens\?\.length/);
  assert.match(reader, /revealInteractiveBlocks\(\[blockId\]\)/);
  assert.match(reader, /else if \(next\.delete\(blockId\)\)/);
  assert.doesNotMatch(reader, /contentVisibility|containIntrinsicSize/);
});

test("duplicate image captions collapse while distinct caption text survives", () => {
  const exact = removeDuplicateImageCaptionBlocks([
    { id: "image", type: "image", src: "https://example.com/a.jpg", alt: "A selectable caption." },
    { id: "caption", type: "caption", text: " A selectable caption. " },
    { id: "body", type: "paragraph", text: "The article continues here." },
  ]);
  assert.equal(exact.length, 2);
  assert.equal(exact[1]?.text, "The article continues here.");
  const distinct = removeDuplicateImageCaptionBlocks([
    { id: "image", type: "image", src: "https://example.com/a.jpg", alt: "Short alt text" },
    { id: "caption", type: "caption", text: "A longer publisher caption with context." },
  ]);
  assert.equal(distinct.length, 2);
});

test("URL extraction keeps publication time and does not duplicate exact figure captions", () => {
  const extracted = extractImportedArticleFromHtml(`<!doctype html><html><head>
    <meta property="og:title" content="Publication time sample">
    <meta property="article:published_time" content="2026-08-31T04:30:00Z">
  </head><body><article><h1>Publication time sample</h1>
    <figure><img src="https://example.com/photo.jpg" width="900" height="600" alt="The exact image caption"><figcaption>The exact image caption</figcaption></figure>
    <p>This is the first substantive paragraph with enough English article content for the extraction boundary.</p>
    <p>This is the second substantive paragraph and it continues the article with useful context for readers.</p>
    <p>This is the final substantive paragraph and ensures the candidate is considered a complete article.</p>
  </article></body></html>`, "https://example.com/story");
  assert.equal(extracted?.article.publishedTime, "2026-08-31T04:30:00Z");
  assert.equal(extracted?.article.blocks.filter((block) => block.text === "The exact image caption").length, 0);
});

test("vocabulary source jumps avoid delayed long-article rerenders and bulk image wakeups", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const home = readFileSync(new URL("../components/HomeClient.tsx", import.meta.url), "utf8");
  const alignedHandler = home.slice(home.indexOf("onSourceJumpAligned={() => {"), home.indexOf("savedArticles={savedArticles}"));
  assert.doesNotMatch(reader, /image\.loading = "eager"/);
  assert.match(reader, /sourceTargetTokenIds\(wordTokens, sourceSentenceToHighlight/);
  assert.match(home, /if \(forcedSavedArticleId\)[\s\S]*?saveArticleReadingProgress\(forcedSavedArticleId, anchor\);/);
  assert.doesNotMatch(alignedHandler, /setSavedArticles/);
  assert.doesNotMatch(reader, /contentVisibility|containIntrinsicSize/);
});

test("source sentence matching indexes candidates instead of rescanning every word token", () => {
  const tokens = tokenizeArticle([
    "A short unrelated sentence.",
    "Mourners were given the toys at her funeral.",
    "Another unrelated sentence about a commercial rubric.",
  ].join("\n")).flatMap((paragraph) => paragraph.tokens.filter((token) => token.type === "word"));
  const index = createSourceSentenceIndex(tokens);
  const match = findBestSourceSentenceMatchInIndex(
    "Mourners were given toys at the funeral.",
    "Mourners",
    index,
  );
  assert.equal(match?.sentence, "Mourners were given the toys at her funeral.");
  assert.equal(index.sentenceIndexesByTerm.get("mourners")?.length, 1);
});

test("full translation quotas bind to the exact article body version", () => {
  const first = createArticleTranslationCacheKey([{ id: "paragraph-0", type: "paragraph", text: "Original body." }]);
  const same = createArticleTranslationCacheKey([{ id: "paragraph-0", type: "paragraph", text: "Original body." }]);
  const edited = createArticleTranslationCacheKey([{ id: "paragraph-0", type: "paragraph", text: "Edited body." }]);
  assert.equal(first, same);
  assert.notEqual(first, edited);
});

test("translation and summary quotas stay separate and curated cache keeps its charge", () => {
  const reader = readFileSync(new URL("../components/ReaderView.tsx", import.meta.url), "utf8");
  const translationStart = readFileSync(new URL("../app/api/translate-article/start/route.ts", import.meta.url), "utf8");
  const summary = readFileSync(new URL("../app/api/summarize-article/route.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../ops/mainland/migrate-translation-summary-quotas.sql", import.meta.url), "utf8");
  assert.match(translationStart, /metricKey: "full_article_translation"/);
  assert.match(translationStart, /finishUsage\(actionId, "cached", true, false\)/);
  assert.match(summary, /metricKey: "article_summary"/);
  assert.doesNotMatch(reader, /重写摘要|重新生成摘要|handleRegenerateSummary/);
  assert.doesNotMatch(summary, /regenerate|regenerated/);
  assert.doesNotMatch(reader, /void startArticleTranslationJob\(translationSourceKey, missingBlocks/);
  assert.match(migration, /\('plus', 'full_article_translation', 20, 'month'\)/);
  assert.match(migration, /\('max', 'full_article_translation', 60, 'month'\)/);
});

test("quota migration keeps consume_usage column references unambiguous", () => {
  const migration = readFileSync(new URL("../ops/mainland/migrate-translation-summary-quotas.sql", import.meta.url), "utf8");
  const verification = readFileSync(new URL("../ops/mainland/verify-usage-contracts.sql", import.meta.url), "utf8");
  assert.match(migration, /select uc\.used_units into v_current[\s\S]*?from public\.usage_counters uc/);
  assert.doesNotMatch(migration, /select used_units into v_current/);
  assert.match(verification, /from public\.consume_usage\(/);
  assert.match(verification, /for v_metric in[\s\S]*?quota_plan_limits/);
});

test("full translation keeps progressive output while batching upstream context", () => {
  const translationRoute = readFileSync(new URL("../app/api/translate-article/route.ts", import.meta.url), "utf8");
  const translationJobs = readFileSync(new URL("../lib/articleTranslationJobs.ts", import.meta.url), "utf8");
  const translationBatching = readFileSync(new URL("../lib/articleTranslationBatching.ts", import.meta.url), "utf8");
  const translationPanel = readFileSync(new URL("../components/ArticleTranslationPanel.tsx", import.meta.url), "utf8");
  const adminPage = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  assert.match(translationRoute, /stream:\s*true/);
  assert.match(translationRoute, /application\/x-ndjson/);
  assert.match(translationRoute, /"deepseek-v4-flash"/);
  assert.match(translationBatching, /ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS\s*=\s*80/);
  assert.match(translationRoute, /MAX_CONTEXT_TOTAL_CHARS\s*=\s*64_000/);
  assert.match(translationRoute, /contextMatchesTarget\s*\?/);
  assert.match(translationRoute, /emitFallbackDocument/);
  assert.match(translationRoute, /IncrementalJsonObjectParser/);
  assert.doesNotMatch(translationRoute, /正在保留已完成段落/);
  assert.match(translationBatching, /ARTICLE_TRANSLATION_BATCH_MAX_CHARS\s*=\s*24_000/);
  assert.match(translationJobs, /onTranslation\(event\.translation\)/);
  assert.match(translationJobs, /setInterval\(updateCountdown, 1_000\)/);
  assert.match(translationPanel, /本次尚未生成可显示译文/);
  assert.match(translationPanel, /本次生成失败，请重试/);
  assert.doesNotMatch(translationPanel, /录入已有全文译文|粘贴整篇中文/);
  assert.match(adminPage, /预发布译文上传失败/);
  assert.match(adminPage, /articleId: published\.id/);
  assert.match(adminPage, /uploadCurrentPublishedTranslation/);
  assert.doesNotMatch(adminPage, /AdminArticleTranslationUpload|录入译文|粘贴整篇中文/);
  assert.doesNotMatch(translationBatching, /ARTICLE_TRANSLATION_BATCH_MAX_BLOCKS\s*=\s*1/);
});

test("published homepage toggles persist immediately while candidate choices remain draft", () => {
  const inspector = readFileSync(new URL("../components/AdminArticleMetadataInspector.tsx", import.meta.url), "utf8");
  const adminPage = readFileSync(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const toolbarStyles = readFileSync(new URL("../components/ReaderToolbar.module.css", import.meta.url), "utf8");
  assert.match(inspector, /articleKind !== "published" \|\| !onPlacementSave/);
  assert.match(inspector, /await onPlacementSave\(draft\.homepageCategory, nextPlacement\)/);
  assert.doesNotMatch(inspector, /保存首页位置/);
  assert.match(adminPage, />文章设置<\/button>[\s\S]*?>精选 \{publicArticles\.length\}<\/button>[\s\S]*?>候选 \{candidateArticles\.length\}<\/button>/);
  assert.match(adminPage, /onUploadTranslation=\{readerState\.kind === "published"/);
  assert.match(toolbarStyles, /editorialMobileActions\s*\{[\s\S]*?justify-content:\s*flex-start[\s\S]*?gap:\s*4px/);
  assert.match(toolbarStyles, /editorialMobileActions > button\s*\{[\s\S]*?padding:\s*0 8px[\s\S]*?white-space:\s*nowrap/);
});
