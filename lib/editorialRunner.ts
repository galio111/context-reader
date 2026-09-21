import { getEditorialSpend, withEditorialBudget } from "@/lib/editorialBudget";

import { sendSiteNotificationEmail } from "@/lib/siteNotificationEmail";
import { editorialDailyReport } from "@/lib/editorialReport";
import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { accountFetch } from "@/lib/accountStore";
import { getDiscoverySites, readDiscoverySetting, writeDiscoverySetting } from "@/lib/discoveryStore";
import { shanghaiDay, freshnessFailure } from "@/lib/discoveryPolicy";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { listArticleCandidates, listPublicArticles, publishArticleCandidate } from "@/lib/publicArticles";
import { editorialContentHash, type EditorialConfig } from "@/lib/editorialReview";
import { EDITORIAL_DIFFICULTIES, EDITORIAL_POLICY_VERSION } from "@/lib/editorialReviewPolicy";
import { normalizeHomepageCuration } from "@/lib/homepageCurationShared";
import { editorialCategoryForArticle } from "@/lib/editorialCuration";
import { getRecommendationAutomationStatus, type RecommendationAutomationRunResponse } from "@/lib/recommendationAutomation";
import type { PublicArticle } from "@/types/publicArticle";

export const EDITORIAL_TARGET = 30;
export const EDITORIAL_MINIMUM = 25;
const DAILY_DISCOVERY_TARGET = EDITORIAL_TARGET;
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
    && meta.editorialReview?.version === EDITORIAL_POLICY_VERSION && meta.editorialReview.status === "passed" && meta.editorialReview.completed === true
    && meta.editorialReview.sourceCompletenessVerified === true
    && meta.editorialReview.contentHash === editorialContentHash(article.importedArticle)
    && Date.now() >= Date.parse(meta.editorialReview.checkedAt)
    && Date.now() - Date.parse(meta.editorialReview.checkedAt) < 48 * 3600_000
    && !freshnessFailure([article.importedArticle.publishedTime || ""], meta.timeliness === "time-sensitive"));
}

/** Called under the discovery lease; accepted SMTP deliveries are not resent. */
async function notifyDailyResult(today: string, articles: PublicArticle[], attempts: number, complete: boolean, config: EditorialConfig) {
  const key = `recommendation_editorial_email_${today}_${DAILY_DISCOVERY_TARGET}_${complete ? "complete" : "shortfall"}`;
  const previous = await readDiscoverySetting<{ status?: string; at?: number }>(key, {});
  if (previous.status === "sent") return { status: "sent" as const, error: "" };
  if (previous.at && Date.now() - previous.at < 15 * 60_000) return null;
  const report = editorialDailyReport(today, articles, attempts, complete, await getEditorialSpend(today), undefined, config.dailyBudgetCny);
  await writeDiscoverySetting(key, { status: "sending", at: Date.now(), count: articles.length });
  const result = await sendSiteNotificationEmail(report.subject, report.text);
  await writeDiscoverySetting(key, { ...result, at: Date.now(), count: articles.length });
  return result;
}

/** Caller holds the cross-instance discovery lease. One source per bounded batch. */
export async function runEditorialBatch(origin: string, trigger: "scheduled" | "manual", config: EditorialConfig, now: Date): Promise<RecommendationAutomationRunResponse> {
  // No trial escape hatch: all automatic editorial runs share the finite daily cap.
  const effectiveConfig: EditorialConfig = {...config, provider:"deepseek", jevAutoAdopt:false, approvedJevChecks:[], budgetTrial:null, dailyBudgetCny:Math.min(1.5,config.dailyBudgetCny ?? 1.5)};
  return withEditorialBudget(shanghaiDay(now), effectiveConfig.dailyBudgetCny!, () => runBudgetedBatch(origin, trigger, effectiveConfig, now));
}
async function runBudgetedBatch(origin: string, trigger: "scheduled" | "manual", config: EditorialConfig, now: Date): Promise<RecommendationAutomationRunResponse> {
  const today = shanghaiDay(now);
  const published = await listPublicArticles();
  const pending = await readDiscoverySetting<string[]>(PENDING_KEY, []);
  for (const id of pending) {
    const article = published.find((a) => a.id === id);
    if (article) await curate(article, today);
  }
  await writeDiscoverySetting(PENDING_KEY, []);
  const initial = await getRecommendationAutomationStatus(now);
  const dayKey = `recommendation_editorial_day_${today}`;
  type Ledger = {attempts:number; startedAt?:string; noProgress?:number; finished?:boolean; suspended?:boolean; failureStreak?:number; sites:Record<string,{visits:number;urls:string[];empty?:number}>};
  const ledger = await readDiscoverySetting<Ledger>(dayKey,{attempts:0,sites:{}});
  ledger.startedAt ||= now.toISOString();
  const todays = () => published.filter(a=>shanghaiDay(a.recommendation?.autoPublishedAt||"")===today);
  if (ledger.finished) {
    if(!ledger.suspended && initial.state.lastEmailStatus!=="sent") {
      const email=await notifyDailyResult(today,todays(),ledger.attempts,todays().length>=EDITORIAL_MINIMUM,config);
      if(email)await writeDiscoverySetting("recommendation_automation_state",{...initial.state,lastEmailStatus:email.status,lastEmailError:email.error});
    }
    return {skipped:"already_ran_today",status:await getRecommendationAutomationStatus(now)};
  }
  const candidates = await listArticleCandidates();
  const score = (a:PublicArticle) => {
    const rows=todays(); const meta=a.recommendation!;
    const category=rows.filter(b=>editorialCategoryForArticle(b)===editorialCategoryForArticle(a)).length;
    const difficulty=rows.filter(b=>(b.recommendation?.difficulty==="雅思 / 托福进阶")===(meta.difficulty==="雅思 / 托福进阶")).length;
    const source=rows.filter(b=>b.recommendation?.discoverySourceId===meta.discoverySourceId).length;
    return -(category*4+difficulty*3+source*2);
  };
  const publishPool = async () => {
    const pool=candidates.filter(eligibleEditorialCandidate).filter(a=>!published.some(b=>b.id===a.id));
    while(pool.length && todays().length<EDITORIAL_TARGET) {
      pool.sort((a,b)=>score(b)-score(a)); const candidate=pool.shift()!;
      // Balance ranks eligible items, never discards them or creates a paid retry.
      await writeDiscoverySetting(PENDING_KEY,[candidate.id]);
      const article=await publishArticleCandidate(candidate.id,{expectedEditorialHash:candidate.recommendation!.editorialReview!.contentHash,autoPublishedAt:new Date().toISOString()});
      await curate(article,today); await writeDiscoverySetting(PENDING_KEY,[]); published.push(article);
    }
  };
  await publishPool(); // Reuse already-paid valid candidates before spending on discovery.
  const spend=await getEditorialSpend(today);
  const maySpend=!spend.blocked && spend.actualMicrocny+spend.reservedMicrocny<(config.dailyBudgetCny??1.5)*1e6;
  const softBudgetReached=todays().length>=EDITORIAL_MINIMUM && spend.actualMicrocny+spend.reservedMicrocny>=1e6;
  const expired=Date.now()-Date.parse(ledger.startedAt)>90*60_000;
  const sites=(await getDiscoverySites()).filter(s=>s.enabled && s.verification?.ok && s.levelHint!=="lower");
  const categoryCount=(category:string)=>todays().filter(a=>editorialCategoryForArticle(a)===category).length;
  const advanced=todays().filter(a=>a.recommendation?.difficulty==="雅思 / 托福进阶").length;
  sites.sort((a,b)=> {
    const priority=(s:typeof a)=> -(ledger.sites[s.id]?.visits||0)*12
      - categoryCount(s.topics[0]==="商业经济"?"商业":s.topics[0]==="社会生活"?"时事":s.topics[0]==="科技科学"||s.topics[0]==="自然环境"?"科技":"文化")*2
      + (s.levelHint==="advanced" && advanced*2<todays().length ? (todays().length-advanced*2>5?28:8):0);
    return priority(b)-priority(a);
  });
  const site=sites.find(s=>(ledger.sites[s.id]?.visits||0)<4 && (ledger.sites[s.id]?.empty||0)<2);
  let result:RecommendationAutomationRunResponse["result"];
  const before=todays().length;
  if (before<EDITORIAL_TARGET && maySpend && !softBudgetReached && !expired && site && ledger.attempts<config.dailyReviewLimit && (ledger.failureStreak||0)<3) {
    const entry=ledger.sites[site.id] ||= {visits:0,urls:[],empty:0};
    entry.visits++; const attempts=Math.min(3,config.dailyReviewLimit-ledger.attempts); ledger.attempts+=attempts;
    await writeDiscoverySetting(dayKey,ledger);
    result=await runRecommendationCrawler({topic:site.topics[0],difficulty:"any",targetInventory:0,ignoreInventoryTarget:true,inventoryScope:"candidates",sourceId:site.id,maxNewArticles:Math.min(3,EDITORIAL_TARGET-before),maxAttempts:attempts,feedPage:Math.min(3,entry.visits),excludedUrls:entry.urls,editorial:config},origin);
    ledger.attempts-=Math.max(0,attempts-result.attempted);
    entry.urls=[...new Set([...entry.urls,...result.skipped.map(s=>s.url),...result.created.map(a=>a.sourceUrl)])];
    entry.empty=result.created.length?0:(entry.empty||0)+1;
    const faults=result.skipped.filter(s=>/flash_invalid|flash_missing|flash_inconsistent|editorial_provider|fetch failed|timeout|JSON/i.test(s.reason)).length;
    ledger.failureStreak=result.created.length?0:faults?(ledger.failureStreak||0)+faults:0;
    // Append-only batch detail: historical failures must not be overwritten.
    await writeDiscoverySetting(`recommendation_editorial_batch_${today}_${site.id}_${entry.visits}`,{at:new Date().toISOString(),attempted:result.attempted,created:result.created.map(a=>a.id),skipped:result.skipped,sourceErrors:result.sourceErrors});
    candidates.push(...result.created); await publishPool();
  }
  ledger.noProgress=todays().length>before?0:(ledger.noProgress||0)+1;
  const afterSpend=await getEditorialSpend(today);
  const stopped=todays().length>=EDITORIAL_TARGET || !maySpend || afterSpend.blocked || softBudgetReached || expired || !site || ledger.attempts>=config.dailyReviewLimit || (ledger.failureStreak||0)>=3 || (ledger.noProgress||0)>=18;
  const complete=stopped && todays().length>=EDITORIAL_MINIMUM;
  ledger.finished=stopped; await writeDiscoverySetting(dayKey,ledger);
  const email=stopped?await notifyDailyResult(today,todays(),ledger.attempts,complete,config):null;
  await writeDiscoverySetting("recommendation_automation_state",{...initial.state,...(email?{lastEmailStatus:email.status,lastEmailError:email.error}:{}),status:complete?"succeeded":stopped?"failed":"running",lastTrigger:trigger,lastStartedAt:ledger.startedAt,lastFinishedAt:new Date().toISOString(),lastCreatedCount:todays().length,lastAttemptedCount:ledger.attempts,lastSkippedCount:result?.skipped.length||0,lastSourceErrorCount:result?.sourceErrors.length||0,lastScheduledDate:stopped?today:"",lastError:complete?"":stopped?`已停止：${todays().length} 篇；预算、90 分钟时限、来源耗尽或连续失败达到边界，请查看明细。`:`已精选 ${todays().length} 篇，连续处理下一批。`});
  return {result,status:await getRecommendationAutomationStatus()};
}
