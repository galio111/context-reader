import { randomUUID } from "node:crypto";
import { defaultDiscoverySites } from "@/lib/discoveryDefaults";
import { accountFetch } from "@/lib/accountStore";
import type { RecommendationCrawlerSource } from "@/lib/recommendationSources";
import { ARTICLE_TOPICS } from "@/types/publicArticle";

export interface DiscoverySite extends RecommendationCrawlerSource {
  enabled: boolean;
  dailyTarget: number;
  feeds: string[];
  discovery: "feed" | "index";
  articlePath?: string;
  note: string;
  verification?: { at: string; ok: boolean; message: string; samples: Array<{ url: string; title: string; words: number; images: number; preview: string }> };
}
export interface SiteDay {
  created: number; attempts: number; visits: number; lastAt: string;
  issues: Array<{ title: string; url: string; reason: string }>;
  attemptedUrls: string[];
}
export interface DiscoveryDay { day: string; sites: Record<string, SiteDay> }
export const SITE_KEY = "recommendation_discovery_sites_v2";
export const DAY_KEY = "recommendation_discovery_day_v2";
export const ORDER_KEY = "recommendation_candidate_order_v2";
export async function readDiscoverySetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await accountFetch<Array<{ value: T }>>(`account_settings?key=eq.${encodeURIComponent(key)}&select=value`);
  return rows[0]?.value ?? fallback;
}
export async function writeDiscoverySetting(key: string, value: unknown): Promise<void> {
  await accountFetch("account_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]) });
}
export async function getDiscoverySites(): Promise<DiscoverySite[]> {
  return readDiscoverySetting(SITE_KEY, defaultDiscoverySites());
}
export function validateSite(input: DiscoverySite): DiscoverySite {
  if (!input || !/^[a-z0-9][a-z0-9-]{1,79}$/.test(input.id) || !input.name?.trim() || input.name.length > 120) throw new Error("请填写有效的网站名称和编号。");
  if (!["lower", "mixed", "advanced"].includes(input.levelHint || "") || !["feed", "index"].includes(input.discovery) || typeof input.enabled !== "boolean") throw new Error("网站用途和启用状态无效。");
  if (!Number.isInteger(input.dailyTarget) || input.dailyTarget < 0 || input.dailyTarget > 10) throw new Error("每站每日目标为 0 至 10 篇。");
  if (!Array.isArray(input.feeds) || input.feeds.length < 1 || input.feeds.length > 6 || input.feeds.some((url) => { try { const u = new URL(url); return u.protocol !== "https:" || !!u.username || !!u.password || url.length > 2048; } catch { return true; } })) throw new Error("请填写最多 6 个 HTTPS 订阅或列表地址。");
  if (!Array.isArray(input.articleHosts) || input.articleHosts.length !== 1 || !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(input.articleHosts[0])) throw new Error("每个网站只填写一个正文域名，不带 https:// 或路径。");
  if (!Array.isArray(input.topics) || !input.topics.length || input.topics.some((topic) => !ARTICLE_TOPICS.includes(topic))) throw new Error("至少选择一个有效主题。");
  return { ...input, name: input.name.trim(), feedUrl: input.feeds[0], dailyTarget: input.dailyTarget, topics: [...new Set(input.topics)], note: String(input.note || "").slice(0, 500) };
}
// Database compare-and-swap serializes scheduled and manual runs across app instances.
// The bounded batch completes well before the lease expiry; crashed workers recover automatically.
export async function withDiscoveryLease<T>(action: () => Promise<T>): Promise<T> {
  const key = "recommendation_discovery_lease_v2";
  await accountFetch("account_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify([{ key, value: { until: 0 }, updated_at: new Date().toISOString() }]) });
  const rows = await accountFetch<Array<{ value: { until?: number }; updated_at: string }>>(`account_settings?key=eq.${key}&select=value,updated_at`);
  const row = rows[0];
  if (!row || Number(row.value?.until) > Date.now()) throw new Error("已有抓取任务正在运行，请稍后刷新。");
  const token = randomUUID();
  const changed = await accountFetch<unknown[]>(`account_settings?key=eq.${key}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ value: { token, until: Date.now() + 30 * 60_000 }, updated_at: new Date().toISOString() }) });
  if (!changed.length) throw new Error("已有抓取任务正在运行，请稍后刷新。");
  try { return await action(); } finally {
    await accountFetch(`account_settings?key=eq.${key}&value->>token=eq.${token}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ value: { until: 0 }, updated_at: new Date().toISOString() }) });
  }
}
