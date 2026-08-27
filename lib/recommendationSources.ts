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
    levelHint: "mixed",
  },
  {
    id: "science-daily",
    name: "ScienceDaily",
    feedUrl: "https://www.sciencedaily.com/rss/all.xml",
    articleHosts: ["sciencedaily.com"],
    topics: ["科技科学", "自然环境"],
    levelHint: "advanced",
  },
  {
    id: "smithsonian",
    name: "Smithsonian Magazine",
    feedUrl: "https://www.smithsonianmag.com/rss/latest_articles/",
    articleHosts: ["smithsonianmag.com"],
    topics: ["自然环境", "文化历史"],
    levelHint: "advanced",
  },
  {
    id: "aeon",
    name: "Aeon",
    feedUrl: "https://aeon.co/feed.rss",
    articleHosts: ["aeon.co"],
    topics: ["文化历史", "社会生活", "人物成长"],
    levelHint: "advanced",
  },
  {
    id: "literary-hub",
    name: "Literary Hub",
    feedUrl: "https://lithub.com/feed/",
    articleHosts: ["lithub.com"],
    topics: ["故事文学", "文化历史"],
    levelHint: "advanced",
  },
  {
    id: "npr-technology",
    name: "NPR Technology",
    feedUrl: "https://feeds.npr.org/1019/rss.xml",
    articleHosts: ["npr.org"],
    topics: ["科技科学", "社会生活", "人物成长"],
    levelHint: "advanced",
  },
  {
    id: "npr-business",
    name: "NPR Business",
    feedUrl: "https://feeds.npr.org/1006/rss.xml",
    articleHosts: ["npr.org"],
    topics: ["商业经济", "社会生活"],
    levelHint: "advanced",
  },
  {
    id: "science-news-explores",
    name: "Science News Explores",
    feedUrl: "https://www.snexplores.org/feed/",
    articleHosts: ["snexplores.org"],
    topics: ["科技科学", "自然环境", "人物成长"],
    levelHint: "lower",
  },
  {
    id: "voa-all-about-america",
    name: "VOA Learning English · All About America",
    feedUrl: "https://learningenglish.voanews.com/api/zbmroml-vomx-tpeqboo_",
    articleHosts: ["learningenglish.voanews.com"],
    topics: ["文化历史", "社会生活", "人物成长"],
    levelHint: "lower",
  },
  {
    id: "voa-arts-culture",
    name: "VOA Learning English · Arts & Culture",
    feedUrl: "https://learningenglish.voanews.com/api/zpyp_l-vomx-tpe_rym",
    articleHosts: ["learningenglish.voanews.com"],
    topics: ["文化历史", "社会生活", "故事文学"],
    levelHint: "lower",
  },
  {
    id: "voa-health-lifestyle",
    name: "VOA Learning English · Health & Lifestyle",
    feedUrl: "https://learningenglish.voanews.com/api/zmmpql-vomx-tpey-_q",
    articleHosts: ["learningenglish.voanews.com"],
    topics: ["社会生活", "人物成长", "科技科学"],
    levelHint: "lower",
  },
  {
    id: "voa-science-technology",
    name: "VOA Learning English · Science & Technology",
    feedUrl: "https://learningenglish.voanews.com/api/zmg_pl-vomx-tpeymtm",
    articleHosts: ["learningenglish.voanews.com"],
    topics: ["科技科学", "自然环境"],
    levelHint: "lower",
  },
  {
    id: "jstor-daily",
    name: "JSTOR Daily",
    feedUrl: "https://daily.jstor.org/feed/",
    articleHosts: ["daily.jstor.org"],
    topics: ["文化历史", "社会生活", "故事文学"],
    levelHint: "advanced",
  },
  {
    id: "mongabay",
    name: "Mongabay",
    feedUrl: "https://news.mongabay.com/feed/",
    articleHosts: ["news.mongabay.com"],
    topics: ["自然环境", "科技科学", "社会生活"],
    levelHint: "advanced",
  },
  {
    id: "undark",
    name: "Undark",
    feedUrl: "https://undark.org/feed/",
    articleHosts: ["undark.org"],
    topics: ["科技科学", "社会生活", "人物成长"],
    levelHint: "advanced",
  },
  {
    id: "psyche",
    name: "Psyche",
    feedUrl: "https://psyche.co/feed.rss",
    articleHosts: ["psyche.co"],
    topics: ["人物成长", "社会生活", "文化历史"],
    levelHint: "advanced",
  },
  {
    id: "public-domain-review",
    name: "The Public Domain Review",
    feedUrl: "https://publicdomainreview.org/feed/",
    articleHosts: ["publicdomainreview.org"],
    topics: ["文化历史", "故事文学"],
    levelHint: "advanced",
  },
  {
    id: "national-archives-prologue",
    name: "U.S. National Archives · Pieces of History",
    feedUrl: "https://prologue.blogs.archives.gov/feed/",
    articleHosts: ["prologue.blogs.archives.gov"],
    topics: ["文化历史", "社会生活", "人物成长"],
    levelHint: "mixed",
  },
  {
    id: "the-conversation-technology",
    name: "The Conversation · Technology",
    feedUrl: "https://theconversation.com/us/technology/articles.atom",
    articleHosts: ["theconversation.com"],
    topics: ["科技科学", "社会生活"],
    levelHint: "advanced",
  },
  {
    id: "the-conversation-business",
    name: "The Conversation · Business + Economy",
    feedUrl: "https://theconversation.com/us/business/articles.atom",
    articleHosts: ["theconversation.com"],
    topics: ["商业经济", "社会生活"],
    levelHint: "advanced",
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
