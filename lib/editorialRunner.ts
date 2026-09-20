import { retryEditorialCandidate } from "@/lib/editorialPending";
import { sendSiteNotificationEmail } from "@/lib/siteNotificationEmail";
import { editorialDailyReport } from "@/lib/editorialReport";
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
    && !freshnessFailure([article.importedArticle.publishedTime || ""], meta.timeliness === "time-sensitive"));
}

/** Called under the discovery lease; accepted SMTP deliveries are not resent. */
async function notifyDailyResult(today: string, articles: PublicArticle[], attempts: number, complete: boolean) {
  const key = `recommendation_editorial_email_${today}_${complete ? "complete" : "shortfall"}`;
  const previous = await readDiscoverySetting<{ status?: string; at?: number }>(key, {});
  if (previous.status === "sent") return { status: "sent" as const, error: "" };
  if (previous.at && Date.now() - previous.at < 15 * 60_000) return null;
  const report = editorialDailyReport(today, articles, attempts, complete);
  await writeDiscoverySetting(key, { status: "sending", at: Date.now(), count: articles.length });
  const result = await sendSiteNotificationEmail(report.subject, report.text);
  await writeDiscoverySetting(key, { ...result, at: Date.now(), count: articles.length });
  return result;
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
  const ledger = await readDiscoverySetting<{ attempts: number; candidateRetries?: Record<string, number>; sites: Record<string, { visits: number; urls: string[] }> }>(dayKey, { attempts: 0, sites: {} });
  const todays = () => published.filter((a) => shanghaiDay(a.recommendation?.autoPublishedAt || "") === today);
  const candidates = await listArticleCandidates();
  if (todays().length >= DAILY_DISCOVERY_TARGET) {
    const email = await notifyDailyResult(today, todays(), ledger.attempts, true);
    if (email) await writeDiscoverySetting("recommendation_automation_state", { ...initial.state, status: "succeeded", lastCreatedCount: todays().length, lastScheduledDate: today, lastEmailStatus: email.status, lastEmailError: email.error });
    if (candidates.filter(eligibleEditorialCandidate).length >= DAILY_DISCOVERY_TARGET || ledger.attempts >= config.dailyReviewLimit) return { skipped: "already_ran_today", status: await getRecommendationAutomationStatus(now) };
  }
  const recent = published.filter((a) => Date.now() - Date.parse(a.recommendation?.autoPublishedAt || a.createdAt) < 7 * 86400_000);
  // Retry at most one unresolved candidate per batch, twice per day. Known low-level candidates stay pending.
  const retry = ledger.attempts % 4 === 0 ? candidates.find((a) => Date.now() - Date.parse(a.createdAt) < 48 * 3600_000 && a.recommendation?.sourceKind === "crawler" && a.recommendation.editorialReview?.status === "held" && EDITORIAL_DIFFICULTIES.includes(a.recommendation.difficulty) && (ledger.candidateRetries?.[a.id] || 0) < 2) : undefined;
  if (retry && ledger.attempts < config.dailyReviewLimit) {
    ledger.candidateRetries ||= {};
    ledger.candidateRetries[retry.id] = (ledger.candidateRetries[retry.id] || 0) + 1;
    ledger.attempts++;
    await writeDiscoverySetting(dayKey, ledger);
    try {
      const updated = await retryEditorialCandidate(retry, config);
      if (updated) candidates.splice(candidates.findIndex((a) => a.id === updated.id), 1, updated);
    } catch { /* Revision conflicts and provider failures stay pending; no destructive fallback. */ }
  }
  const sites = (await getDiscoverySites()).filter((s) => s.enabled && s.verification?.ok);
  sites.sort((a, b) => (ledger.sites[a.id]?.visits || 0) - (ledger.sites[b.id]?.visits || 0)
    || editorialBalanceScore(b.topics[0], EDITORIAL_DIFFICULTIES[0], b.id, recent) - editorialBalanceScore(a.topics[0], EDITORIAL_DIFFICULTIES[0], a.id, recent));
  const site = sites.find((s) => (ledger.sites[s.id]?.visits || 0) < 8 && (todays().length >= DAILY_DISCOVERY_TARGET || todays().filter((a) => a.recommendation?.discoverySourceId === s.id).length < 6));
  let result: RecommendationAutomationRunResponse["result"];
  if (!retry && site && ledger.attempts < config.dailyReviewLimit) {
    const entry = ledger.sites[site.id] ||= { visits: 0, urls: [] };
    entry.visits++;
    const attempts = Math.min(3, config.dailyReviewLimit - ledger.attempts);
    ledger.attempts += attempts; // reserve before network calls; crash cannot create unlimited spend
    await writeDiscoverySetting(dayKey, ledger);
    result = await runRecommendationCrawler({ topic: site.topics[0], difficulty: "any", targetInventory: 0, ignoreInventoryTarget: true, inventoryScope: "candidates", sourceId: site.id, maxNewArticles: 3, maxAttempts: attempts, feedPage: Math.min(3, Math.ceil(entry.visits / 3)), excludedUrls: entry.urls, editorial: config }, origin);
    // Reconcile reservations only after a completed call. Crashes retain their bounded reservation.
    ledger.attempts -= Math.max(0, attempts - result.attempted);
    await writeDiscoverySetting(`recommendation_editorial_batch_${today}_${site.id}`, { at: new Date().toISOString(), attempted: result.attempted, created: result.created.length, skipped: result.skipped, sourceErrors: result.sourceErrors });
    entry.urls = [...new Set([...entry.urls, ...result.skipped.map((s) => s.url), ...result.created.map((a) => a.sourceUrl)])];
    await writeDiscoverySetting(dayKey, ledger);
    candidates.push(...result.created);
  }
  const supplement = sites.every((s) => (ledger.sites[s.id]?.visits || 0) >= 1);
  const pool = [...new Map(candidates.filter(eligibleEditorialCandidate).map((a) => [a.id, a])).values()];
  while (pool.length && todays().length < DAILY_DISCOVERY_TARGET) {
    pool.sort((a, b) => editorialBalanceScore(b.recommendation!.topics[0], b.recommendation!.difficulty, b.recommendation!.discoverySourceId || "", recent) - editorialBalanceScore(a.recommendation!.topics[0], a.recommendation!.difficulty, a.recommendation!.discoverySourceId || "", recent));
    const candidate = pool.shift()!;
    const meta = candidate.recommendation!;
    const current = todays();
    if (current.filter((a) => a.recommendation?.discoverySourceId === meta.discoverySourceId).length >= (supplement ? 6 : 4)
      || current.filter((a) => a.recommendation?.topics[0] === meta.topics[0]).length >= (supplement ? 10 : 6)
      || current.filter((a) => a.recommendation?.difficulty === meta.difficulty).length >= (supplement ? 20 : 12)) continue;
    await writeDiscoverySetting(PENDING_KEY, [candidate.id]);
    const article = await publishArticleCandidate(candidate.id, { expectedEditorialHash: meta.editorialReview!.contentHash, autoPublishedAt: new Date().toISOString() });
    await curate(article, today);
    await writeDiscoverySetting(PENDING_KEY, []);
    published = [...published, article]; recent.push(article);
  }
  const count = todays().length;
  const complete = count >= DAILY_DISCOVERY_TARGET;
  const exhausted = ledger.attempts >= config.dailyReviewLimit || !site;
  const email = complete || exhausted ? await notifyDailyResult(today, todays(), ledger.attempts, complete) : null;
  await writeDiscoverySetting("recommendation_automation_state", { ...initial.state, ...(email ? { lastEmailStatus: email.status, lastEmailError: email.error } : { lastEmailStatus: "not_requested", lastEmailError: "" }), status: complete ? "succeeded" : exhausted ? "failed" : "running", lastTrigger: trigger, lastStartedAt: now.toISOString(), lastFinishedAt: new Date().toISOString(), lastCreatedCount: count, lastAttemptedCount: ledger.attempts, lastSkippedCount: result?.skipped.length || 0, lastSourceErrorCount: result?.sourceErrors.length || 0, lastScheduledDate: complete || exhausted ? today : "", lastError: complete ? "" : exhausted ? `今日已自动精选 ${count}/30 篇；合格内容或分布不足，保留缺口，不降低质量凑数。` : `今日已自动精选 ${count}/30 篇，继续分批审核。` });
  return { result, status: await getRecommendationAutomationStatus() };
}
