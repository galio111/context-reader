import type { ArticleDifficulty, ArticleTopic, PublicArticle } from "@/types/publicArticle";

export type CrawlerDifficulty = ArticleDifficulty | "any";

export interface RecommendationCrawlerSourceInfo {
  id: string;
  name: string;
  topics: ArticleTopic[];
}

export interface RecommendationCrawlerStatus {
  scheduled: boolean;
  scheduleLabel: string;
  maxNewArticlesPerRun: number;
  sources: RecommendationCrawlerSourceInfo[];
}

export interface RecommendationCrawlerRunInput {
  topic: ArticleTopic;
  difficulty: CrawlerDifficulty;
  targetInventory: number;
  maxNewArticles?: number;
}

export interface RecommendationCrawlerSkippedItem {
  title: string;
  url: string;
  reason: string;
}

export interface RecommendationCrawlerSourceError {
  sourceName: string;
  message: string;
}

export interface RecommendationCrawlerRunResult {
  topic: ArticleTopic;
  difficulty: CrawlerDifficulty;
  targetInventory: number;
  inventoryBefore: number;
  inventoryAfter: number;
  discovered: number;
  attempted: number;
  created: PublicArticle[];
  skipped: RecommendationCrawlerSkippedItem[];
  sourceErrors: RecommendationCrawlerSourceError[];
  startedAt: string;
  finishedAt: string;
}
