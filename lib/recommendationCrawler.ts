import { classifyArticle } from "@/lib/articleClassification";
import { getDiscoverySites } from "@/lib/discoveryStore";
import { freshnessFailure, similarArticle, hasRecentPublishingCadence, minimumDiscoveryWords } from "@/lib/discoveryPolicy";
import { localizePublicArticleInputCover } from "@/lib/publicArticleCovers";
import { articleHasHomepageImage } from "@/lib/articleMedia";
import { assertCrawlerAllowed } from "@/lib/crawlerRobots";
import { discoveryImageIsReadable } from "@/lib/discoveryImages";
import { listArticleCandidates, listPublicArticles, saveArticleCandidate } from "@/lib/publicArticles";
import type { ImportedArticle } from "@/types/article";
import type { ArticleRecommendationMetadata, PublicArticle, PublicArticleCandidateInput } from "@/types/publicArticle";
import type {
  RecommendationCrawlerRunInput,
  RecommendationCrawlerRunResult,
  RecommendationCrawlerSkippedItem,
  RecommendationCrawlerSourceError,
} from "@/types/recommendationCrawler";

const DEFAULT_MAX_NEW_ARTICLES = 2;
const MAX_NEW_ARTICLES_PER_RUN = 10;
interface ImportApiResponse {
  article?: ImportedArticle;
  metadata?: { description?: string; coverCandidates?: string[]; intakeWarnings?: string[] };
  error?: string;
}

import { canonicalArticleUrl, normalizedFeedTitle, readSourceFeed, type FeedItem } from "@/lib/recommendationFeed";

export async function importArticleThroughApi(origin: string, url: string): Promise<ImportApiResponse> {
  await assertCrawlerAllowed(url);
  const response = await fetch(new URL("/api/import-url", origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "User-Agent": "ContextReaderRecommendationCrawler/1.0",
    },
    body: JSON.stringify({ url }),
    cache: "no-store",
    signal: AbortSignal.timeout(45_000),
  });
  const payload = await response.json().catch(() => null) as ImportApiResponse | null;
  if (!response.ok || !payload?.article) {
    throw new Error(payload?.error || `文章导入返回 ${response.status}`);
  }
  return payload;
}

function inventoryMatches(
  article: { recommendation?: ArticleRecommendationMetadata },
  input: RecommendationCrawlerRunInput,
): boolean {
  const recommendation = article.recommendation;
  return Boolean(
    recommendation?.topics.includes(input.topic) &&
    (input.difficulty === "any" || recommendation.difficulty === input.difficulty),
  );
}

function interleaveSources(items: FeedItem[]): FeedItem[] {
  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const group = groups.get(item.source.id) ?? [];
    group.push(item);
    groups.set(item.source.id, group);
  }
  const orderedGroups = [...groups.values()].map((group) => group.sort((left, right) => {
    return (Date.parse(right.publishedAt) || 0) - (Date.parse(left.publishedAt) || 0) || right.relevance - left.relevance;
  }));
  const result: FeedItem[] = [];
  for (let index = 0; orderedGroups.some((group) => index < group.length); index += 1) {
    for (const group of orderedGroups) {
      if (group[index]) result.push(group[index]);
    }
  }
  return result;
}

function crawlerCandidateInput(
  item: FeedItem,
  imported: ImportApiResponse,
  classification: Awaited<ReturnType<typeof classifyArticle>>,
): PublicArticleCandidateInput {
  const article = imported.article as ImportedArticle;
  const coverImageUrl = imported.metadata?.coverCandidates?.[0] ?? "";
  const recommendation: ArticleRecommendationMetadata = {
    coverImageUrl,
    coverImageAlt: article.title,
    coverImageSourceUrl: item.url,
    coverImageCredit: item.source.name,
    difficulty: classification.difficulty,
    cefr: classification.cefr,
    audienceStages: classification.audienceStages,
    topics: classification.topics,
    discoverySourceId: item.source.id,
    wordCount: classification.wordCount,
    timeliness: classification.timeliness,
    sourceKind: "crawler",
    classificationSource: classification.classificationSource,
    classifiedAt: classification.classifiedAt,
    reviewNotes: [`自动发现自 ${item.source.name}`, classification.reviewNotes].filter(Boolean).join("；").slice(0, 500),
    difficultyEvidence: classification.difficultyEvidence,
  };
  return {
    title: article.title,
    summary: classification.summary,
    body: article.text,
    sourceUrl: item.url,
    sourceName: article.siteName || item.source.name,
    importedArticle: {
      ...article,
      url: item.url,
      ...(article.publishedTime || item.publishedAt ? { publishedTime: article.publishedTime || item.publishedAt } : {}),
      recommendation,
    },
    recommendation,
  };
}

export async function runRecommendationCrawler(
  input: RecommendationCrawlerRunInput,
  origin: string,
): Promise<RecommendationCrawlerRunResult> {
  const startedAt = new Date().toISOString();
  const maxNewArticles = Math.max(1, Math.min(MAX_NEW_ARTICLES_PER_RUN, input.maxNewArticles ?? DEFAULT_MAX_NEW_ARTICLES));
  const [published, activeCandidates, allCandidates] = await Promise.all([
    listPublicArticles(),
    listArticleCandidates(),
    listArticleCandidates({ includeRejected: true }),
  ]);
  const allArticles = [...published, ...allCandidates];
  const candidates = activeCandidates;
  const inventoryArticles = input.inventoryScope === "candidates" ? candidates : allArticles;
  const inventoryBefore = inventoryArticles.filter((article) => inventoryMatches(article, input)).length;
  const resultBase = {
    topic: input.topic,
    difficulty: input.difficulty,
    targetInventory: input.targetInventory,
    inventoryBefore,
    discovered: 0,
    attempted: 0,
    targetNewArticles: 0,
    targetAchieved: true,
    shortfall: 0,
    created: [] as PublicArticle[],
    skipped: [] as RecommendationCrawlerSkippedItem[],
    sourceErrors: [] as RecommendationCrawlerSourceError[],
    startedAt,
  };

  if (!input.ignoreInventoryTarget && inventoryBefore >= input.targetInventory) {
    return { ...resultBase, inventoryAfter: inventoryBefore, finishedAt: new Date().toISOString() };
  }

  const configured = (await getDiscoverySites()).filter((site) => site.enabled && (input.sourceId ? site.id === input.sourceId : site.topics.includes(input.topic)));
  const sources = configured.flatMap((site) => site.feeds.map((feedUrl) => ({ ...site, feedUrl })));
  const feedResults = await Promise.allSettled(sources.map((source) => readSourceFeed(source, input.topic)));
  const discoveredItems: FeedItem[] = [];
  feedResults.forEach((feedResult, index) => {
    if (feedResult.status === "fulfilled") {
      discoveredItems.push(...feedResult.value);
    } else {
      resultBase.sourceErrors.push({
        sourceName: sources[index]?.name ?? "未知来源",
        message: feedResult.reason instanceof Error ? feedResult.reason.message : "Feed 读取失败",
      });
    }
  });
  if (input.sourceId && !hasRecentPublishingCadence(discoveredItems.map((item) => item.publishedAt))) {
    return { ...resultBase, targetNewArticles: maxNewArticles, targetAchieved: false, shortfall: maxNewArticles, inventoryAfter: inventoryBefore, finishedAt: new Date().toISOString(), sourceErrors: [...resultBase.sourceErrors, { sourceName: configured[0]?.name || "来源", message: "未确认近期持续更新，本批不使用存档文章凑数。" }] };
  }

  const knownUrls = new Set(allArticles.map((article) => canonicalArticleUrl(article.sourceUrl)).filter(Boolean));
  const knownTitles = new Set(allArticles.map((article) => normalizedFeedTitle(article.title)).filter(Boolean));
  const knownArticleIds = new Set(allArticles.map((article) => article.id));
  const uniqueItems = interleaveSources(
    [...new Map(discoveredItems.map((item) => [canonicalArticleUrl(item.url), item])).values()]
      .filter((item) => !knownUrls.has(canonicalArticleUrl(item.url)) && !knownTitles.has(normalizedFeedTitle(item.title)) && !input.excludedUrls?.includes(item.url)),
  );
  resultBase.discovered = uniqueItems.length;

  const needed = input.ignoreInventoryTarget
    ? maxNewArticles
    : Math.min(maxNewArticles, input.targetInventory - inventoryBefore);
  resultBase.targetNewArticles = needed;
  for (const item of uniqueItems) {
    if (resultBase.created.length >= needed || resultBase.attempted >= (input.maxAttempts ?? 3) || Date.now() - Date.parse(startedAt) > 180_000) break;
    resultBase.attempted += 1;
    try {
      const earlyFailure = freshnessFailure([item.publishedAt], false);
      if (earlyFailure) throw new Error(earlyFailure);
      if (/\/image-article\/apod-/i.test(item.url)) throw new Error("天文每日图片短条目，不作为完整阅读文章");
      if (/\b(?:sponsored|advertorial|paid content|partner content)\b/i.test(item.title + " " + item.description.slice(0, 400))) throw new Error("赞助或推广内容");
      if (/newsinlevels\.com/.test(item.url) && !/-level-3(?:\/|$)/.test(item.url)) throw new Error("只收录 level 3 的完整阅读，避免同文多级重复");
      if (allArticles.some((article) => similarArticle(item.title, article.title))) throw new Error("标题与已有文章高度相似");
      const imported = await importArticleThroughApi(origin, item.url);
      const article = imported.article!;
      if (imported.metadata?.intakeWarnings?.length) throw new Error(imported.metadata.intakeWarnings.join("；"));
      if (article.blocks.filter((block) => block.type === "image").length > 8) throw new Error("图片过多，可能是图库或合集，留待人工导入");
      const words = (article.text.match(/\b[a-zA-Z]+\b/g) ?? []).length;
      if (words < minimumDiscoveryWords(item.source.levelHint)) throw new Error(`正文不足 ${minimumDiscoveryWords(item.source.levelHint)} 词，属于短讯或正文提取不完整`);
      if (article.language && !/^en\b/i.test(article.language)) throw new Error("不是英文正文");
      const images = article.blocks.filter((block) => block.type === "image" && block.src && !/logo|avatar|icon|banner|pixel|tracking/i.test(block.src));
      const covers = (imported.metadata?.coverCandidates ?? []).filter((url) => !/logo|avatar|icon|banner|pixel|tracking/i.test(url));
      if (!images.length && !covers.length) throw new Error("没有可用的文章配图");
      let verifiedCover = "";
      for (const url of [...new Set([...images.map((image) => image.src!), ...covers])].slice(0, 3)) {
        if (await discoveryImageIsReadable(url)) { verifiedCover = url; break; }
      }
      if (!verifiedCover) throw new Error("配图不可读取或尺寸不足，不用图标、像素图凑数");
      article.blocks = article.blocks.filter((block) => block.type !== "image" || images.includes(block));
      imported.metadata = { ...imported.metadata, coverCandidates: [verifiedCover] };
      const classification = await classifyArticle(
        imported.article?.title || item.title,
        imported.article?.text || "",
        {
          sourceUrl: item.url,
          sourceName: imported.article?.siteName || item.source.name,
          usageRoute: "/api/admin/article-crawler",
          discoveryReview: true,
          imageDescriptions: images.map((image) => image.alt || "").join("; ") || "文章发布者提供的社交分享封面，无法确认内容；需人工复核",
        },
      );
      if (!classification.qualityReview?.eligible) throw new Error(classification.qualityReview?.reason || "质量判断暂时不可用，未自动入库");
      if (images.some((image) => image.alt?.trim()) && !classification.qualityReview.imageRelevant) throw new Error("配图说明与正文主题不相符");
      if (classification.topics.includes("科技科学") && classification.qualityReview.specialist) throw new Error("科技内容过于专业，不符合通俗科普要求");
      const dateFailure = freshnessFailure([article.publishedTime || "", item.publishedAt], classification.timeliness === "time-sensitive" || classification.topics.includes("商业经济"));
      if (dateFailure) throw new Error(dateFailure);
      const rejectedSimilar = allCandidates.some((old) => old.recommendation?.rejectedAt && old.recommendation.rejectionReason === "内容没兴趣" && similarArticle(article.title + " " + classification.summary, old.title + " " + old.summary, 0.5));
      if (rejectedSimilar) throw new Error("与之前标为不感兴趣的文章主题高度相似");
      const difficultFeedback = allCandidates.some((old) => old.recommendation?.rejectedAt && old.recommendation.rejectionReason === "太专业或太难" && old.recommendation.discoverySourceId === item.source.id && similarArticle(article.title, old.title, 0.45));
      if (difficultFeedback && (classification.qualityReview.specialist || classification.difficultyEvidence.backgroundKnowledge >= 3)) throw new Error("参考不精选反馈：该网站相似主题仍要求较多专业背景");
      if (allArticles.some((old) => similarArticle(article.text.slice(0, 1600), old.body.slice(0, 1600), 0.85))) throw new Error("正文与已有文章高度相似");
      if (input.difficulty !== "any" && classification.difficulty !== input.difficulty) {
        resultBase.skipped.push({ title: item.title, url: item.url, reason: `判断为${classification.difficulty}，与目标难度不符` });
        continue;
      }
      const prepared = await localizePublicArticleInputCover(crawlerCandidateInput(item, imported, classification));
      if (!articleHasHomepageImage({ ...prepared, importedArticle: prepared.importedArticle || undefined })) throw new Error("图片无法安全保存，未收录无图文章");
      const candidate = await saveArticleCandidate(prepared);
      if (knownArticleIds.has(candidate.id)) {
        resultBase.skipped.push({ title: item.title, url: item.url, reason: "与候选库中已有文章内容重复" });
        knownUrls.add(canonicalArticleUrl(item.url));
        knownTitles.add(normalizedFeedTitle(item.title));
        continue;
      }
      resultBase.created.push(candidate);
      allArticles.push(candidate);
      knownArticleIds.add(candidate.id);
      knownUrls.add(canonicalArticleUrl(item.url));
      knownTitles.add(normalizedFeedTitle(candidate.title));
    } catch (error) {
      resultBase.skipped.push({
        title: item.title,
        url: item.url,
        reason: error instanceof Error ? error.message.slice(0, 180) : "抓取失败",
      });
    }
  }

  const shortfall = Math.max(0, needed - resultBase.created.length);
  return {
    ...resultBase,
    targetAchieved: shortfall === 0,
    shortfall,
    inventoryAfter: inventoryBefore + resultBase.created.length,
    finishedAt: new Date().toISOString(),
  };
}
