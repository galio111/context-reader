import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { getRecommendationAutomationStatus, type RecommendationAutomationRunResponse } from "@/lib/recommendationAutomation";
import { DAY_KEY, getDiscoverySites, readDiscoverySetting, writeDiscoverySetting, withDiscoveryLease, type DiscoveryDay } from "@/lib/discoveryStore";
import { shanghaiDay, discoveryVisitLimit } from "@/lib/discoveryPolicy";
import { listArticleCandidates, listPublicArticles } from "@/lib/publicArticles";
import { sendSiteNotificationEmail } from "@/lib/siteNotificationEmail";
import type { RecommendationAutomationState } from "@/types/recommendationCrawler";

export async function runDiscoveryBatch(origin: string, trigger: "scheduled" | "manual", now = new Date(), sourceId?: string): Promise<RecommendationAutomationRunResponse> {
  return withDiscoveryLease(async () => {
    const initial = await getRecommendationAutomationStatus(now);
    const today = shanghaiDay(now);
    if (trigger === "scheduled") {
      if (!initial.config.enabled) return { skipped: "disabled", status: initial };
      if (now < new Date(`${today}T${initial.config.runTime}:00+08:00`)) return { skipped: "not_due", status: initial };
    }
    const savedDay = await readDiscoverySetting<DiscoveryDay>(DAY_KEY, { day: today, sites: {} });
    const ledger: DiscoveryDay = savedDay.day === today ? savedDay : { day: today, sites: {} };
    const sites = (await getDiscoverySites()).filter((site) => site.enabled && site.dailyTarget > 0);
    const articles = [...await listArticleCandidates({ includeRejected: true }), ...await listPublicArticles()];
    for (const site of sites) {
      const entry = ledger.sites[site.id] ?? { created: 0, attempts: 0, visits: 0, lastAt: "", issues: [], attemptedUrls: [] };
      const persisted = articles.filter((a) => shanghaiDay(a.createdAt) === today && (a.recommendation?.discoverySourceId === site.id || (() => { try { return new URL(a.sourceUrl || "").hostname.replace(/^www\./, "") === site.articleHosts[0]; } catch { return false; } })())).length;
      entry.created = Math.max(entry.created, persisted);
      ledger.sites[site.id] = entry;
    }
    const eligible = sites.filter((site) => {
      const day = ledger.sites[site.id];
      return (!sourceId || site.id === sourceId) && day.created < site.dailyTarget && day.visits < discoveryVisitLimit(site.dailyTarget)
        && (!day.lastAt || Date.now() - Date.parse(day.lastAt) >= 30 * 60_000);
    }).sort((a, b) => ledger.sites[a.id].visits - ledger.sites[b.id].visits || a.id.localeCompare(b.id));
    const site = eligible[0];
    if (!site) {
      await writeDiscoverySetting(DAY_KEY, ledger);
      return { skipped: "already_ran_today", status: initial };
    }
    const entry = ledger.sites[site.id];
    entry.visits += 1;
    entry.lastAt = new Date().toISOString();
    await writeDiscoverySetting(DAY_KEY, ledger);
    const running: RecommendationAutomationState = { ...initial.state, status: "running", lastTrigger: trigger, lastStartedAt: entry.lastAt, lastFinishedAt: "", lastTopic: site.topics[0], lastError: "" };
    await writeDiscoverySetting("recommendation_automation_state", running);
    try {
      const result = await runRecommendationCrawler({ topic: site.topics[0], difficulty: "any", targetInventory: 0, ignoreInventoryTarget: true, inventoryScope: "candidates", sourceId: site.id, maxNewArticles: site.dailyTarget - entry.created, excludedUrls: entry.attemptedUrls, maxAttempts: 3 }, origin);
      entry.created += result.created.length;
      entry.attempts += result.attempted;
      entry.attemptedUrls = [...new Set([...entry.attemptedUrls, ...result.skipped.map((s) => s.url), ...result.created.map((a) => a.sourceUrl || "")])].filter(Boolean).slice(-50);
      entry.issues = [...entry.issues, ...result.skipped, ...result.sourceErrors.map((s) => ({ title: s.sourceName, url: site.feedUrl, reason: s.message }))].slice(-30);
      if (!result.discovered) entry.issues.push({ title: site.name, url: site.feedUrl, reason: "没有新的未处理文章，不使用重复文章凑数。" });
      await writeDiscoverySetting(DAY_KEY, ledger);
      const total = Object.values(ledger.sites).reduce((n, item) => n + item.created, 0);
      const finished = sites.every((s) => ledger.sites[s.id].created >= s.dailyTarget || ledger.sites[s.id].visits >= discoveryVisitLimit(s.dailyTarget));
      const complete = sites.every((s) => ledger.sites[s.id].created >= s.dailyTarget);
      const state: RecommendationAutomationState = { ...running, status: complete ? "succeeded" : finished ? "failed" : "running", lastFinishedAt: result.finishedAt, lastCreatedCount: total, lastAttemptedCount: result.attempted, lastSkippedCount: result.skipped.length, lastSourceErrorCount: result.sourceErrors.length, lastScheduledDate: finished ? today : "", lastError: finished && !complete ? "今日已完成有限次数检查，部分网站不足目标。查看各站原因。" : !finished ? "已处理一个网站，服务器将继续分批检查其余网站。" : "" };
      if (trigger === "scheduled" && finished && initial.state.lastScheduledDate !== today) {
        const email = await sendSiteNotificationEmail(`[Context Reader] 今日候选 ${total} 篇`, sites.map((s) => `${s.name}：${ledger.sites[s.id].created}/${s.dailyTarget} 篇`).join("\n") + "\n只进入候选，不会自动发布。");
        state.lastEmailStatus = email.status; state.lastEmailError = email.error || "";
      }
      await writeDiscoverySetting("recommendation_automation_state", state);
      return { result, status: await getRecommendationAutomationStatus() };
    } catch (error) {
      entry.issues.push({ title: site.name, url: site.feedUrl, reason: "本次运行失败，稍后有限重试；详细错误保留在服务端。" });
      await writeDiscoverySetting(DAY_KEY, ledger);
      await writeDiscoverySetting("recommendation_automation_state", { ...running, status: "failed", lastFinishedAt: new Date().toISOString(), lastError: "抓取暂时失败，请查看网站状态。" });
      throw error;
    }
  });
}
