import { accountFetch } from "@/lib/accountStore";
import { siteNotificationEmailStatus } from "@/lib/siteNotificationEmail";
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



export async function getRecommendationAutomationStatus(now = new Date()): Promise<RecommendationAutomationStatus> {
  const { config, state } = await readSettings();
  const { getDiscoverySites } = await import("@/lib/discoveryStore");
  config.maxNewArticles = (await getDiscoverySites()).filter((site) => site.enabled).reduce((n, site) => n + site.dailyTarget, 0);
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
  await writeSetting(CONFIG_KEY, config);
  return getRecommendationAutomationStatus();
}



export interface RecommendationAutomationRunResponse {
  skipped?: "disabled" | "not_due" | "already_ran_today";
  result?: RecommendationCrawlerRunResult;
  status: RecommendationAutomationStatus;
}

export async function runConfiguredRecommendationAutomation(
  origin: string, trigger: "scheduled" | "manual", now = new Date(), sourceId?: string,
): Promise<RecommendationAutomationRunResponse> {
  const { runDiscoveryBatch } = await import("@/lib/discoveryRunner");
  return runDiscoveryBatch(origin, trigger, now, sourceId);
}
