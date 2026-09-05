import { JSDOM } from "jsdom";
import type { DiscoverySite } from "@/lib/discoveryStore";
import { sourceAllowsArticleUrl, type RecommendationCrawlerSource } from "@/lib/recommendationSources";
import { readResponseText, safeRemoteFetch } from "@/lib/safeRemoteFetch";
import { assertCrawlerAllowed } from "@/lib/crawlerRobots";
import type { RecommendationCrawlerRunInput } from "@/types/recommendationCrawler";
const MAX_FEED_BYTES = 1_200_000;
const MAX_FEED_ITEMS = 50;



export interface FeedItem {
  title: string;
  url: string;
  description: string;
  publishedAt: string;
  source: RecommendationCrawlerSource;
  relevance: number;
}


const TOPIC_PATTERNS: Record<RecommendationCrawlerRunInput["topic"], RegExp> = {
  科技科学: /\b(?:science|technology|research|space|planet|computer|digital|artificial intelligence|robot|energy|physics|biology|medical|engineering)\b/i,
  自然环境: /\b(?:nature|climate|environment|ocean|forest|animal|wildlife|earth|weather|ecology|species|conservation)\b/i,
  文化历史: /\b(?:culture|history|ancient|museum|art|heritage|tradition|language|century|archaeology|civilization)\b/i,
  社会生活: /\b(?:society|community|city|work|education|health|family|economy|media|public|daily life|policy)\b/i,
  商业经济: /\b(?:business|economy|economic|finance|financial|market|trade|company|industry|startup|employment|investment|banking|retail)\b/i,
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

export function canonicalArticleUrl(rawUrl: string): string {
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

export function normalizedFeedTitle(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, "");
}

export function parseFeed(xml: string, source: RecommendationCrawlerSource, topic: RecommendationCrawlerRunInput["topic"]): FeedItem[] {
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
    const publishedAt = tagValue(fragment, ["pubDate", "published", "dc:date"]);
    const titleMatch = topicPattern.test(title) ? 4 : 0;
    const descriptionMatch = topicPattern.test(description) ? 2 : 0;
    return [{ title, url, description, publishedAt, source, relevance: titleMatch + descriptionMatch }];
  });
}

export async function readSourceFeed(
  source: RecommendationCrawlerSource,
  topic: RecommendationCrawlerRunInput["topic"],
): Promise<FeedItem[]> {
  await assertCrawlerAllowed(source.feedUrl);
  const response = await safeRemoteFetch(source.feedUrl, {
    headers: {
      Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml",
      "User-Agent": "ContextReaderRecommendationCrawler/2.0 (+https://context-reader.com)",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Feed 返回 ${response.status}`);
  }
  const contents = await readResponseText(response, MAX_FEED_BYTES);
  if ((source as DiscoverySite).discovery === "index") {
    const document = new JSDOM(contents, { url: source.feedUrl }).window.document;
    const pattern = (source as DiscoverySite).articlePath;
    if (!pattern) throw new Error("列表来源尚未配置文章路径，需要专门适配。");
    const matches = [...document.querySelectorAll("a[href]")].flatMap((anchor): FeedItem[] => {
      const url = new URL(anchor.getAttribute("href") || "", source.feedUrl);
      let title = anchor.textContent?.trim() || "";
      const card = anchor.closest("article, .views-row, .card, li");
      let publishedAt = card?.querySelector("time")?.getAttribute("datetime") || "";
      if (source.articleHosts[0] === "levelread.com") {
        let parent = anchor.parentElement;
        for (let depth = 0; parent && depth < 5; depth += 1, parent = parent.parentElement) {
          if (title.length < 10) title = parent.querySelector("h2,h3")?.textContent?.trim() || title;
          const dates = [...(parent.textContent || "").matchAll(/\b(20\d{2})\/(\d{2})\/(\d{2})(?!\d)/g)];
          if (dates.length === 1) { publishedAt = `${dates[0][1]}-${dates[0][2]}-${dates[0][3]}T00:00:00+08:00`; break; }
        }
      }
      return title.length >= 10 && sourceAllowsArticleUrl(source, url.href) && new RegExp(pattern).test(url.pathname)
        ? [{ title, url: canonicalArticleUrl(url.href), description: "", publishedAt, source, relevance: 0 }] : [];
    });
    return [...new Map(matches.map((item) => [item.url, item])).values()].slice(0, MAX_FEED_ITEMS);
  }
  const items = parseFeed(contents, source, topic);
  if (!items.length) throw new Error("没有读到有效订阅文章，可能是验证页、格式变化或空订阅。");
  return items;
}
