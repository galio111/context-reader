import { accountFetch } from "@/lib/accountStore";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { sendSiteNotificationEmail, siteNotificationEmailStatus, type SiteEmailStatus } from "@/lib/siteNotificationEmail";
import { ARTICLE_TOPICS, type ArticleTopic } from "@/types/publicArticle";
import type {
  RecommendationAutomationConfig,
  RecommendationAutomationState,
  RecommendationAutomationStatus,
  RecommendationCrawlerRunResult,
} from "@/types/recommendationCrawler";

const CONFIG_KEY = "recommendation_automation_config";
const STATE_KEY = "recommendation_automation_state";
const TIME_ZONE = "Asia/Shanghai";
const MAX_CANDIDATES_PER_RUN = 10;

const DEFAULT_CONFIG: RecommendationAutomationConfig = {
  enabled: true,
  runTime: "03:00",
  maxNewArticles: 2,
};

const DEFAULT_STATE: RecommendationAutomationState = {
  status: "never_run",
  lastTrigger: "",
  lastScheduledDate: "",
  pendingScheduledDate: "",
  pendingScheduledCreatedCount: 0,
  lastTopic: "",
  lastStartedAt: "",
  lastFinishedAt: "",
  lastCreatedCount: 0,
  lastAttemptedCount: 0,
  lastSkippedCount: 0,
  lastSourceErrorCount: 0,
  lastError: "",
  lastEmailStatus: "not_requested",
  lastEmailError: "",
};

interface SettingRow {
  key: string;
  value: unknown;
  updated_at: string;
}

interface ShanghaiParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateKey: string;
}

function shanghaiParts(date: Date): ShanghaiParts {
  const entries = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  const year = Number(entries.year);
  const month = Number(entries.month);
  const day = Number(entries.day);
  return {
    year,
    month,
    day,
    hour: Number(entries.hour),
    minute: Number(entries.minute),
    dateKey: `${entries.year}-${entries.month}-${entries.day}`,
  };
}

function validRunTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && minute % 5 === 0;
}

function normalizeConfig(value: unknown): RecommendationAutomationConfig {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: input.enabled !== false,
    runTime: validRunTime(input.runTime) ? input.runTime : DEFAULT_CONFIG.runTime,
    maxNewArticles: Number.isInteger(input.maxNewArticles)
      ? Math.max(1, Math.min(MAX_CANDIDATES_PER_RUN, Number(input.maxNewArticles)))
      : DEFAULT_CONFIG.maxNewArticles,
  };
}

function normalizeState(value: unknown): RecommendationAutomationState {
  const input = value && typeof value === "object" ? value as Partial<RecommendationAutomationState> : {};
  const status = input.status === "running" || input.status === "succeeded" || input.status === "failed"
    ? input.status
    : "never_run";
  const emailStatus: RecommendationAutomationState["lastEmailStatus"] =
    input.lastEmailStatus === "sent" || input.lastEmailStatus === "failed" || input.lastEmailStatus === "not_configured"
      ? input.lastEmailStatus
      : "not_requested";
  const lastTrigger: RecommendationAutomationState["lastTrigger"] = input.lastTrigger === "scheduled" || input.lastTrigger === "manual"
    ? input.lastTrigger
    : "";
  return {
    ...DEFAULT_STATE,
    ...input,
    status,
    lastTrigger,
    lastEmailStatus: emailStatus,
    pendingScheduledCreatedCount: Math.max(0, Number(input.pendingScheduledCreatedCount) || 0),
    lastCreatedCount: Number(input.lastCreatedCount) || 0,
    lastAttemptedCount: Number(input.lastAttemptedCount) || 0,
    lastSkippedCount: Number(input.lastSkippedCount) || 0,
    lastSourceErrorCount: Number(input.lastSourceErrorCount) || 0,
  };
}

async function readSettings(): Promise<{
  config: RecommendationAutomationConfig;
  state: RecommendationAutomationState;
}> {
  const rows = await accountFetch<SettingRow[]>(
    `account_settings?key=in.(${CONFIG_KEY},${STATE_KEY})&select=key,value,updated_at`,
  );
  const configRow = rows.find((row) => row.key === CONFIG_KEY);
  const stateRow = rows.find((row) => row.key === STATE_KEY);
  return {
    config: normalizeConfig(configRow?.value),
    state: normalizeState(stateRow?.value),
  };
}

async function writeSetting(key: string, value: unknown): Promise<void> {
  await accountFetch("account_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
  });
}

function scheduledMinute(config: RecommendationAutomationConfig): number {
  const [hour, minute] = config.runTime.split(":").map(Number);
  return hour * 60 + minute;
}

function nextRunAt(
  config: RecommendationAutomationConfig,
  state: RecommendationAutomationState,
  now: Date,
): string {
  if (!config.enabled) return "";
  const parts = shanghaiParts(now);
  const [hour, minute] = config.runTime.split(":").map(Number);
  const alreadyRanToday = state.lastScheduledDate === parts.dateKey;
  const passedToday = parts.hour * 60 + parts.minute >= scheduledMinute(config);
  if (passedToday && !alreadyRanToday) {
    return new Date(now.getTime() + 5 * 60 * 1000).toISOString();
  }
  const dayOffset = alreadyRanToday ? 1 : 0;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour - 8, minute)).toISOString();
}

function scheduledTopic(now: Date): ArticleTopic {
  const shanghaiDay = Math.floor((now.getTime() + 8 * 60 * 60 * 1000) / 86_400_000);
  return ARTICLE_TOPICS[shanghaiDay % ARTICLE_TOPICS.length];
}

export async function getRecommendationAutomationStatus(now = new Date()): Promise<RecommendationAutomationStatus> {
  const { config, state } = await readSettings();
  const email = siteNotificationEmailStatus();
  return {
    config,
    state,
    nextRunAt: nextRunAt(config, state, now),
    timeZone: TIME_ZONE,
    schedulePrecisionMinutes: 5,
    emailConfigured: email.configured,
    notificationEmail: email.recipient,
  };
}

export async function updateRecommendationAutomationConfig(
  input: RecommendationAutomationConfig,
): Promise<RecommendationAutomationStatus> {
  const config = normalizeConfig(input);
  if (!validRunTime(input.runTime)) {
    throw new Error("执行时间必须是 5 分钟的整数刻度。");
  }
  if (!Number.isInteger(input.maxNewArticles) || input.maxNewArticles < 1 || input.maxNewArticles > MAX_CANDIDATES_PER_RUN) {
    throw new Error("每次目标新增的候选文章必须是 1 至 10 篇。");
  }
  await writeSetting(CONFIG_KEY, config);
  return getRecommendationAutomationStatus();
}

function completionEmailText(result: RecommendationCrawlerRunResult, state: RecommendationAutomationState): string {
  const createdTitles = result.created.map((article) => `- ${article.title}`).join("\n") || "- 本次没有新增候选";
  return [
    "Context Reader 的定时推荐任务已执行完成。",
    "",
    `主题：${result.topic}`,
    `开始时间：${new Date(result.startedAt).toLocaleString("zh-CN", { timeZone: TIME_ZONE })}`,
    `完成时间：${new Date(result.finishedAt).toLocaleString("zh-CN", { timeZone: TIME_ZONE })}`,
    `本日累计新增：${state.lastCreatedCount} 篇`,
    `尝试处理：${result.attempted} 篇`,
    `去重或未通过检查：${result.skipped.length} 篇`,
    `暂时读取失败的来源：${result.sourceErrors.length} 个`,
    "",
    "最近一次尝试新增候选：",
    createdTitles,
    "",
    "这些文章只进入 Admin 候选区，不会自动公开。",
    state.lastError ? `运行说明：${state.lastError}` : "",
  ].filter(Boolean).join("\n");
}

export interface RecommendationAutomationRunResponse {
  skipped?: "disabled" | "not_due" | "already_ran_today";
  result?: RecommendationCrawlerRunResult;
  status: RecommendationAutomationStatus;
}

export async function runConfiguredRecommendationAutomation(
  origin: string,
  trigger: "scheduled" | "manual",
  now = new Date(),
): Promise<RecommendationAutomationRunResponse> {
  const initial = await getRecommendationAutomationStatus(now);
  const parts = shanghaiParts(now);
  if (trigger === "scheduled") {
    if (!initial.config.enabled) return { skipped: "disabled", status: initial };
    if (initial.state.lastScheduledDate === parts.dateKey) return { skipped: "already_ran_today", status: initial };
    if (parts.hour * 60 + parts.minute < scheduledMinute(initial.config)) {
      return { skipped: "not_due", status: initial };
    }
  }

  const topic = scheduledTopic(now);
  const startedAt = now.toISOString();
  const pendingScheduledCount = trigger === "scheduled" && initial.state.pendingScheduledDate === parts.dateKey
    ? Math.min(initial.config.maxNewArticles, initial.state.pendingScheduledCreatedCount)
    : 0;
  const targetForAttempt = trigger === "scheduled"
    ? Math.max(1, initial.config.maxNewArticles - pendingScheduledCount)
    : initial.config.maxNewArticles;
  const runningState: RecommendationAutomationState = {
    ...initial.state,
    status: "running",
    lastTrigger: trigger,
    pendingScheduledDate: trigger === "scheduled" ? parts.dateKey : initial.state.pendingScheduledDate,
    pendingScheduledCreatedCount: trigger === "scheduled" ? pendingScheduledCount : initial.state.pendingScheduledCreatedCount,
    lastTopic: topic,
    lastStartedAt: startedAt,
    lastFinishedAt: "",
    lastError: "",
    lastEmailStatus: "not_requested",
    lastEmailError: "",
  };
  await writeSetting(STATE_KEY, runningState);

  try {
    const result = await runRecommendationCrawler({
      topic,
      difficulty: "any",
      targetInventory: 30,
      maxNewArticles: targetForAttempt,
      inventoryScope: "candidates",
      ignoreInventoryTarget: true,
    }, origin);
    const accumulatedScheduledCount = trigger === "scheduled"
      ? pendingScheduledCount + result.created.length
      : 0;
    const scheduledTargetAchieved = trigger !== "scheduled"
      || accumulatedScheduledCount >= initial.config.maxNewArticles;
    const completedState: RecommendationAutomationState = {
      ...runningState,
      status: result.targetAchieved && scheduledTargetAchieved ? "succeeded" : "failed",
      lastScheduledDate: trigger === "scheduled" && scheduledTargetAchieved ? parts.dateKey : initial.state.lastScheduledDate,
      pendingScheduledDate: trigger === "scheduled" && scheduledTargetAchieved ? "" : runningState.pendingScheduledDate,
      pendingScheduledCreatedCount: trigger === "scheduled" && scheduledTargetAchieved ? 0 : accumulatedScheduledCount,
      lastFinishedAt: result.finishedAt,
      lastCreatedCount: trigger === "scheduled" ? accumulatedScheduledCount : result.created.length,
      lastAttemptedCount: result.attempted,
      lastSkippedCount: result.skipped.length,
      lastSourceErrorCount: result.sourceErrors.length,
      lastError: result.shortfall
        ? `已尝试全部 ${result.attempted} 篇可用新文章，仍缺 ${result.shortfall} 篇；本次未按目标记为成功。`
        : result.sourceErrors.length ? `${result.sourceErrors.length} 个来源暂时读取失败，其余来源已继续。` : "",
    };
    let emailStatus: SiteEmailStatus | "not_requested" = "not_requested";
    let emailError = "";
    if (trigger === "scheduled" && (scheduledTargetAchieved || pendingScheduledCount === 0)) {
      const emailResult = await sendSiteNotificationEmail(
        scheduledTargetAchieved
          ? `[Context Reader] 自动推荐完成，新增 ${accumulatedScheduledCount} 篇`
          : `[Context Reader] 自动推荐未达目标，还缺 ${Math.max(0, initial.config.maxNewArticles - accumulatedScheduledCount)} 篇，将自动重试`,
        completionEmailText(result, completedState),
      );
      emailStatus = emailResult.status;
      emailError = emailResult.error;
    }
    const finalState: RecommendationAutomationState = {
      ...completedState,
      lastEmailStatus: emailStatus,
      lastEmailError: emailError,
    };
    await writeSetting(STATE_KEY, finalState);
    return { result, status: await getRecommendationAutomationStatus(new Date(result.finishedAt)) };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "自动推荐任务失败。";
    await writeSetting(STATE_KEY, {
      ...runningState,
      status: "failed",
      lastFinishedAt: new Date().toISOString(),
      lastError: message,
    });
    throw error;
  }
}
