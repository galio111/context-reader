import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { accountFetch } from "@/lib/accountStore";
import { getDiscoverySites, readDiscoverySetting, writeDiscoverySetting } from "@/lib/discoveryStore";
import { shanghaiDay, freshnessFailure, DAILY_DISCOVERY_TARGET } from "@/lib/discoveryPolicy";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { listArticleCandidates, listPublicArticles, publishArticleCandidate } from "@/lib/publicArticles";
import { editorialContentHash, type EditorialConfig } from "@/lib/editorialReview";
import { EDITORIAL_DIFFICULTIES, EDITORIAL_POLICY_VERSION, editorialBalanceScore } from "@/lib/editorialReviewPolicy";
import { normalizeHomepageCuration } from "@/lib/homepageCurationShared";
import { editorialCategoryForArticle } from "@/lib/editorialCuration";
import { getRecommendationAutomationStatus, type RecommendationAutomationRunResponse } from "@/lib/recommendationAutomation";
import type { PublicArticle } from "@/types/publicArticle";

const PENDING_KEY = "recommendation_editorial_pending_curation_v1";

/** CAS preserves simultaneous Admin placement edits; the journal repairs a publish/curation crash. */
async function curate(article: PublicArticle, today: string): Promise<void> {
  const key = "homepage_publication_curation";
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await accountFetch<Array<{ value: unknown; updated_at: string }>>(`account_settings?key=eq.${key}&select=value,updated_at`);
    if (!rows[0]) {
      await accountFetch("account_settings?on_conflict=key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify([{ key, value: normalizeHomepageCuration(null), updated_at: new Date().toISOString() }]) });
      continue;
    }
    const value = normalizeHomepageCuration(rows[0].value);
    const category = editorialCategoryForArticle(article);
    value.categories[category] = [article.id, ...value.categories[category].filter((id) => id !== article.id)].slice(0, 500);
    value.categories.推荐 = [article.id, ...value.categories.推荐.filter((id) => id !== article.id)].slice(0, 500);
    value.selectedAtById[article.id] = article.recommendation?.autoPublishedAt || new Date().toISOString();
    // Reservoir sampling gives every newly published item a chance without model cost.
    const todayIds = value.categories.推荐.filter((id) => shanghaiDay(value.selectedAtById[id]) === today);
    if (shanghaiDay(value.selectedAtById[value.recommendationFeaturedId]) !== today || randomInt(Math.max(1, todayIds.length)) === 0) value.recommendationFeaturedId = article.id;
    value.updatedAt = new Date().toISOString();
    const changed = await accountFetch<unknown[]>(`account_settings?key=eq.${key}&updated_at=eq.${encodeURIComponent(rows[0].updated_at)}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ value, updated_at: value.updatedAt }) });
    if (changed.length) { revalidatePath("/"); return; }
  }
  throw new Error("首页精选同时发生变更，下批自动重试。");
}

export function eligibleEditorialCandidate(article: PublicArticle): boolean {
  const meta = article.recommendation;
  return !!(article.importedArticle && meta && !meta.rejectedAt && meta.sourceKind === "crawler" && EDITORIAL_DIFFICULTIES.includes(meta.difficulty)
    && meta.editorialReview?.version === EDITORIAL_POLICY_VERSION && meta.editorialReview.status === "passed"
    && meta.editorialReview.contentHash === editorialContentHash(article.importedArticle)
    && Date.now() >= Date.parse(meta.editorialReview.checkedAt)
    && Date.now() - Date.parse(meta.editorialReview.checkedAt) < 48 * 3600_000
    && !freshnessFailure([article.importedArticle.publishedTime || ""], meta.timeliness === "time-sensitive" || !!meta.topics?.includes("商业经济")));
}

/** Caller holds the cross-instance discovery lease. One source per bounded batch. */
export async function runEditorialBatch(origin: string, trigger: "scheduled" | "manual", config: EditorialConfig, now: Date): Promise<RecommendationAutomationRunResponse> {
  const today = shanghaiDay(now);
  let published = await listPublicArticles();
  const pending = await readDiscoverySetting<string[]>(PENDING_KEY, []);
  for (const id of pending) {
    const article = published.find((a) => a.id === id);
    if (article) await curate(article, today);
  }
  await writeDiscoverySetting(PENDING_KEY, []);
  const initial = await getRecommendationAutomationStatus(now);
  const dayKey = `recommendation_editorial_day_${today}`;
  const ledger = await readDiscoverySetting<{ attempts: number; sites: Record<string, { visits: number; urls: string[] }> }>(dayKey, { attempts: 0, sites: {} });
  const todays = () => published.filter((a) => shanghaiDay(a.recommendation?.autoPublishedAt || "") === today);
  if (todays().length >= DAILY_DISCOVERY_TARGET) return { skipped: "already_ran_today", status: initial };
  const recent = published.filter((a) => Date.now() - Date.parse(a.recommendation?.autoPublishedAt || a.createdAt) < 7 * 86400_000);
  const candidates = await listArticleCandidates();
  const sites = (await getDiscoverySites()).filter((s) => s.enabled && s.levelHint !== "lower" && s.verification?.ok);
  sites.sort((a, b) => (ledger.sites[a.id]?.visits || 0) - (ledger.sites[b.id]?.visits || 0)
    || editorialBalanceScore(b.topics[0], EDITORIAL_DIFFICULTIES[0], b.id, recent) - editorialBalanceScore(a.topics[0], EDITORIAL_DIFFICULTIES[0], a.id, recent));
  const site = sites.find((s) => (ledger.sites[s.id]?.visits || 0) < 8 && todays().filter((a) => a.recommendation?.discoverySourceId === s.id).length < 4);
  let result: RecommendationAutomationRunResponse["result"];
  if (site && ledger.attempts < config.dailyReviewLimit) {
    const entry = ledger.sites[site.id] ||= { visits: 0, urls: [] };
    entry.visits++;
    const attempts = Math.min(3, config.dailyReviewLimit - ledger.attempts);
    ledger.attempts += attempts; // reserve before network calls; crash cannot create unlimited spend
    await writeDiscoverySetting(dayKey, ledger);
    result = await runRecommendationCrawler({ topic: site.topics[0], difficulty: "any", targetInventory: 0, ignoreInventoryTarget: true, inventoryScope: "candidates", sourceId: site.id, maxNewArticles: 3, maxAttempts: attempts, excludedUrls: entry.urls, editorial: config }, origin);
    entry.urls = [...new Set([...entry.urls, ...result.skipped.map((s) => s.url), ...result.created.map((a) => a.sourceUrl)])];
    await writeDiscoverySetting(dayKey, ledger);
    candidates.push(...result.created);
  }
  const pool = [...new Map(candidates.filter(eligibleEditorialCandidate).map((a) => [a.id, a])).values()];
  while (pool.length && todays().length < DAILY_DISCOVERY_TARGET) {
    pool.sort((a, b) => editorialBalanceScore(b.recommendation!.topics[0], b.recommendation!.difficulty, b.recommendation!.discoverySourceId || "", recent) - editorialBalanceScore(a.recommendation!.topics[0], a.recommendation!.difficulty, a.recommendation!.discoverySourceId || "", recent));
    const candidate = pool.shift()!;
    const meta = candidate.recommendation!;
    const current = todays();
    if (current.filter((a) => a.recommendation?.discoverySourceId === meta.discoverySourceId).length >= 4
      || current.filter((a) => a.recommendation?.topics[0] === meta.topics[0]).length >= 6
      || current.filter((a) => a.recommendation?.difficulty === meta.difficulty).length >= 12) continue;
    await writeDiscoverySetting(PENDING_KEY, [candidate.id]);
    const article = await publishArticleCandidate(candidate.id, { expectedEditorialHash: meta.editorialReview!.contentHash, autoPublishedAt: new Date().toISOString() });
    await curate(article, today);
    await writeDiscoverySetting(PENDING_KEY, []);
    published = [...published, article]; recent.push(article);
  }
  const count = todays().length;
  const complete = count >= DAILY_DISCOVERY_TARGET;
  const exhausted = ledger.attempts >= config.dailyReviewLimit || !site;
  await writeDiscoverySetting("recommendation_automation_state", { ...initial.state, status: complete ? "succeeded" : exhausted ? "failed" : "running", lastTrigger: trigger, lastStartedAt: now.toISOString(), lastFinishedAt: new Date().toISOString(), lastCreatedCount: count, lastAttemptedCount: ledger.attempts, lastScheduledDate: complete || exhausted ? today : "", lastError: complete ? "" : exhausted ? `今日已自动精选 ${count}/30 篇；合格内容或分布不足，保留缺口，不降低质量凑数。` : `今日已自动精选 ${count}/30 篇，继续分批审核。` });
  return { result, status: await getRecommendationAutomationStatus() };
}
