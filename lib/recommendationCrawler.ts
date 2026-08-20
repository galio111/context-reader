import { classifyArticle } from "@/lib/articleClassification";
import { listArticleCandidates, listPublicArticles, saveArticleCandidate } from "@/lib/publicArticles";
import {
  crawlerSourcesForTopic,
  sourceAllowsArticleUrl,
  type RecommendationCrawlerSource,
} from "@/lib/recommendationSources";
import { readResponseText, safeRemoteFetch } from "@/lib/safeRemoteFetch";
import type { ImportedArticle } from "@/types/article";
import type { ArticleRecommendationMetadata, PublicArticle, PublicArticleCandidateInput } from "@/types/publicArticle";
import type {
  RecommendationCrawlerRunInput,
  RecommendationCrawlerRunResult,
  RecommendationCrawlerSkippedItem,
  RecommendationCrawlerSourceError,
} from "@/types/recommendationCrawler";

const MAX_FEED_BYTES = 700_000;
const MAX_FEED_ITEMS = 50;
const MAX_ATTEMPTS_PER_RUN = 18;
const DEFAULT_MAX_NEW_ARTICLES = 2;
const MAX_NEW_ARTICLES_PER_RUN = 6;

interface FeedItem {
  title: string;
  url: string;
  description: string;
  publishedAt: string;
  source: RecommendationCrawlerSource;
  relevance: number;
}

interface ImportApiResponse {
  article?: ImportedArticle;
  metadata?: { description?: string; coverCandidates?: string[] };
  error?: string;
}

const TOPIC_PATTERNS: Record<RecommendationCrawlerRunInput["topic"], RegExp> = {
  科技科学: /\b(?:science|technology|research|space|planet|computer|digital|artificial intelligence|robot|energy|physics|biology|medical|engineering)\b/i,
  自然环境: /\b(?:nature|climate|environment|ocean|forest|animal|wildlife|earth|weather|ecology|species|conservation)\b/i,
  文化历史: /\b(?:culture|history|ancient|museum|art|heritage|tradition|language|century|archaeology|civilization)\b/i,
  社会生活: /\b(?:society|community|city|work|education|health|family|economy|media|public|daily life|policy)\b/i,
  人物成长: /\b(?:life|career|learn|growth|mind|psychology|habit|interview|biography|people|person|identity)\b/i,
  故事文学: /\b(?:story|novel|fiction|poem|poetry|literature|writer|memoir|book|narrative|character)\b/i,
};

function decodeXml(value: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value
    .replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => entities[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(fragment: string, names: string[]): string {
  for (const name of names) {
    const escaped = name.replace(":", "\\:");
    const match = fragment.match(new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
    if (match?.[1]) {
      return decodeXml(match[1]);
    }
  }
  return "";
}

function attributeValue(tag: string, name: string): string {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeXml(match?.[1] ?? match?.[2] ?? "");
}

function feedItemUrl(fragment: string): string {
  const linkContent = tagValue(fragment, ["link"]);
  if (linkContent) {
    return linkContent;
  }
  for (const match of fragment.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attributeValue(match[0], "rel");
    const href = attributeValue(match[0], "href");
    if (href && (!rel || rel === "alternate")) {
      return href;
    }
  }
  return tagValue(fragment, ["guid", "id"]);
}

function canonicalArticleUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function parseFeed(xml: string, source: RecommendationCrawlerSource, topic: RecommendationCrawlerRunInput["topic"]): FeedItem[] {
  const fragments = [
    ...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi),
  ].slice(0, MAX_FEED_ITEMS);
  const topicPattern = TOPIC_PATTERNS[topic];

  return fragments.flatMap((match): FeedItem[] => {
    const fragment = match[1] ?? "";
    const title = tagValue(fragment, ["title"]);
    const url = canonicalArticleUrl(feedItemUrl(fragment));
    if (!title || !url || !sourceAllowsArticleUrl(source, url)) {
      return [];
    }
    const description = tagValue(fragment, ["description", "summary", "content:encoded", "content"]);
    const publishedAt = tagValue(fragment, ["pubDate", "published", "updated", "dc:date"]);
    const titleMatch = topicPattern.test(title) ? 4 : 0;
    const descriptionMatch = topicPattern.test(description) ? 2 : 0;
    return [{ title, url, description, publishedAt, source, relevance: titleMatch + descriptionMatch }];
  });
}

async function readSourceFeed(
  source: RecommendationCrawlerSource,
  topic: RecommendationCrawlerRunInput["topic"],
): Promise<FeedItem[]> {
  const response = await safeRemoteFetch(source.feedUrl, {
    headers: {
      Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
      "User-Agent": "ContextReaderRecommendationCrawler/1.0 (+https://context-reader-ten.vercel.app)",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Feed 返回 ${response.status}`);
  }
  return parseFeed(await readResponseText(response, MAX_FEED_BYTES), source, topic);
}

async function importArticleThroughApi(origin: string, url: string): Promise<ImportApiResponse> {
  const response = await fetch(new URL("/api/import-url", origin), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "User-Agent": "ContextReaderRecommendationCrawler/1.0",
    },
    body: JSON.stringify({ url }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
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

function uniqueTopics(requested: RecommendationCrawlerRunInput["topic"], classified: ArticleRecommendationMetadata["topics"]): ArticleRecommendationMetadata["topics"] {
  return [requested, ...classified.filter((topic) => topic !== requested)].slice(0, 3);
}

function interleaveSources(items: FeedItem[]): FeedItem[] {
  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const group = groups.get(item.source.id) ?? [];
    group.push(item);
    groups.set(item.source.id, group);
  }
  const orderedGroups = [...groups.values()].map((group) => group.sort((left, right) => {
    if (right.relevance !== left.relevance) return right.relevance - left.relevance;
    return Date.parse(right.publishedAt || "") - Date.parse(left.publishedAt || "");
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
  requestedTopic: RecommendationCrawlerRunInput["topic"],
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
    topics: uniqueTopics(requestedTopic, classification.topics),
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
    importedArticle: { ...article, url: item.url, recommendation },
    recommendation,
  };
}

export async function runRecommendationCrawler(
  input: RecommendationCrawlerRunInput,
  origin: string,
): Promise<RecommendationCrawlerRunResult> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const maxNewArticles = Math.max(1, Math.min(MAX_NEW_ARTICLES_PER_RUN, input.maxNewArticles ?? DEFAULT_MAX_NEW_ARTICLES));
  const latestNextAttemptMs = 42_000 + Math.max(0, maxNewArticles - DEFAULT_MAX_NEW_ARTICLES) * 55_000;
  const [published, candidates] = await Promise.all([listPublicArticles(), listArticleCandidates()]);
  const allArticles = [...published, ...candidates];
  const inventoryArticles = input.inventoryScope === "candidates" ? candidates : allArticles;
  const inventoryBefore = inventoryArticles.filter((article) => inventoryMatches(article, input)).length;
  const resultBase = {
    topic: input.topic,
    difficulty: input.difficulty,
    targetInventory: input.targetInventory,
    inventoryBefore,
    discovered: 0,
    attempted: 0,
    created: [] as PublicArticle[],
    skipped: [] as RecommendationCrawlerSkippedItem[],
    sourceErrors: [] as RecommendationCrawlerSourceError[],
    startedAt,
  };

  if (!input.ignoreInventoryTarget && inventoryBefore >= input.targetInventory) {
    return { ...resultBase, inventoryAfter: inventoryBefore, finishedAt: new Date().toISOString() };
  }

  const sources = crawlerSourcesForTopic(input.topic);
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

  const knownUrls = new Set(allArticles.map((article) => canonicalArticleUrl(article.sourceUrl)).filter(Boolean));
  const uniqueItems = interleaveSources(
    [...new Map(discoveredItems.map((item) => [item.url, item])).values()]
      .filter((item) => !knownUrls.has(item.url)),
  );
  resultBase.discovered = uniqueItems.length;

  const needed = input.ignoreInventoryTarget
    ? maxNewArticles
    : Math.min(maxNewArticles, input.targetInventory - inventoryBefore);
  for (const item of uniqueItems.slice(0, MAX_ATTEMPTS_PER_RUN)) {
    if (
      resultBase.created.length >= needed ||
      (resultBase.attempted > 0 && Date.now() - startedMs > latestNextAttemptMs)
    ) {
      break;
    }
    resultBase.attempted += 1;
    try {
      const imported = await importArticleThroughApi(origin, item.url);
      const classification = await classifyArticle(
        imported.article?.title || item.title,
        imported.article?.text || "",
        {
          sourceUrl: item.url,
          sourceName: imported.article?.siteName || item.source.name,
        },
      );
      if (input.difficulty !== "any" && classification.difficulty !== input.difficulty) {
        resultBase.skipped.push({ title: item.title, url: item.url, reason: `判断为${classification.difficulty}，与目标难度不符` });
        continue;
      }
      const candidate = await saveArticleCandidate(crawlerCandidateInput(item, imported, classification, input.topic));
      resultBase.created.push(candidate);
      knownUrls.add(item.url);
    } catch (error) {
      resultBase.skipped.push({
        title: item.title,
        url: item.url,
        reason: error instanceof Error ? error.message.slice(0, 180) : "抓取失败",
      });
    }
  }

  return {
    ...resultBase,
    inventoryAfter: inventoryBefore + resultBase.created.length,
    finishedAt: new Date().toISOString(),
  };
}
