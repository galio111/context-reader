import type { ArticleTopic } from "@/types/publicArticle";
import type { RecommendationCrawlerSourceInfo } from "@/types/recommendationCrawler";

export interface RecommendationCrawlerSource extends RecommendationCrawlerSourceInfo {
  feedUrl: string;
  articleHosts: string[];
}

export const RECOMMENDATION_CRAWLER_SOURCES: RecommendationCrawlerSource[] = [
  {
    id: "nasa",
    name: "NASA",
    feedUrl: "https://www.nasa.gov/feed/",
    articleHosts: ["nasa.gov"],
    topics: ["科技科学", "自然环境"],
  },
  {
    id: "science-daily",
    name: "ScienceDaily",
    feedUrl: "https://www.sciencedaily.com/rss/all.xml",
    articleHosts: ["sciencedaily.com"],
    topics: ["科技科学", "自然环境"],
  },
  {
    id: "smithsonian",
    name: "Smithsonian Magazine",
    feedUrl: "https://www.smithsonianmag.com/rss/latest_articles/",
    articleHosts: ["smithsonianmag.com"],
    topics: ["自然环境", "文化历史"],
  },
  {
    id: "aeon",
    name: "Aeon",
    feedUrl: "https://aeon.co/feed.rss",
    articleHosts: ["aeon.co"],
    topics: ["文化历史", "社会生活", "人物成长"],
  },
  {
    id: "literary-hub",
    name: "Literary Hub",
    feedUrl: "https://lithub.com/feed/",
    articleHosts: ["lithub.com"],
    topics: ["故事文学", "文化历史"],
  },
  {
    id: "npr-technology",
    name: "NPR Technology",
    feedUrl: "https://feeds.npr.org/1019/rss.xml",
    articleHosts: ["npr.org"],
    topics: ["科技科学", "社会生活", "人物成长"],
  },
];

export function crawlerSourcesForTopic(topic: ArticleTopic): RecommendationCrawlerSource[] {
  return RECOMMENDATION_CRAWLER_SOURCES.filter((source) => source.topics.includes(topic));
}

export function sourceAllowsArticleUrl(source: RecommendationCrawlerSource, rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return source.articleHosts.some((allowedHost) => (
      hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
    ));
  } catch {
    return false;
  }
}
