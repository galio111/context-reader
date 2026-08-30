import type { ArticleDifficulty, ArticleTopic, PublicArticle } from "@/types/publicArticle";
import type { EditorialCategory } from "@/lib/editorialCuration";

export type CrawlerDifficulty = ArticleDifficulty | "any";

export interface RecommendationCrawlerSourceInfo {
  id: string;
  name: string;
  topics: ArticleTopic[];
  levelHint?: "lower" | "mixed" | "advanced";
}

export interface RecommendationCrawlerStatus {
  scheduled: boolean;
  scheduleLabel: string;
  maxNewArticlesPerRun: number;
  automation: RecommendationAutomationStatus;
  sources: RecommendationCrawlerSourceInfo[];
}

export interface RecommendationAutomationConfig {
  enabled: boolean;
  runTime: string;
  maxNewArticles: number;
}

export interface RecommendationAutomationState {
  status: "never_run" | "running" | "succeeded" | "failed";
  lastTrigger: "" | "scheduled" | "manual";
  lastScheduledDate: string;
  pendingScheduledDate: string;
  pendingScheduledCreatedCount: number;
  lastTopic: "" | ArticleTopic;
  lastStartedAt: string;
  lastFinishedAt: string;
  lastCreatedCount: number;
  lastAttemptedCount: number;
  lastSkippedCount: number;
  lastSourceErrorCount: number;
  lastError: string;
  lastEmailStatus: "not_requested" | "sent" | "failed" | "not_configured";
  lastEmailError: string;
}

export interface RecommendationAutomationStatus {
  config: RecommendationAutomationConfig;
  state: RecommendationAutomationState;
  nextRunAt: string;
  timeZone: "Asia/Shanghai";
  schedulePrecisionMinutes: number;
  emailConfigured: boolean;
  notificationEmail: string;
}

export interface RecommendationCrawlerRunInput {
  topic: ArticleTopic;
  difficulty: CrawlerDifficulty;
  targetInventory: number;
  maxNewArticles?: number;
  inventoryScope?: "all" | "candidates";
  ignoreInventoryTarget?: boolean;
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
  targetNewArticles: number;
  targetAchieved: boolean;
  shortfall: number;
  created: PublicArticle[];
  skipped: RecommendationCrawlerSkippedItem[];
  sourceErrors: RecommendationCrawlerSourceError[];
  startedAt: string;
  finishedAt: string;
  balancePlan?: Array<{
    category: EditorialCategory;
    topic: ArticleTopic;
    targetCount: number;
    beforeCount: number;
  }>;
}
