import {DAILY_TOTAL_MAX,DAILY_CATEGORY_MAX,DAILY_CATEGORIES,distributionSatisfied} from './editorialDistribution';
import {rankEditorialSources} from './editorialSourcePriority';
import {isFirstPartyArticleImageUrl} from './articleImageUrls';
import {countArticleEnglishWords} from './articleWordCount';
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

export const EDITORIAL_TARGET = 60;
export const EDITORIAL_MINIMUM = 55;
const DAILY_DISCOVERY_TARGET = EDITORIAL_TARGET;
const PENDING_KEY = "recommendation_editorial_pending_curation_v1";

/** Completed days use only tiny settings reads; yesterday's email state cannot suppress today's report. */
export async function editorialDayClosed(day:string, read=readDiscoverySetting):Promise<boolean> {
  const ledger=await read<{finished?:boolean;suspended?:boolean}>(`recommendation_editorial_day_${day}`,{});
  if(!ledger.finished)return false;
  if(ledger.suspended)return true;
  const reports=await Promise.all([EDITORIAL_TARGET,30].flatMap(target=>["complete","shortfall"].map(kind=>read<{status?:string}>(`recommendation_editorial_email_${day}_${target}_${kind}`,{}))));
  return reports.some(report=>report.status==="sent");
}

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
  const images = article.importedArticle?.blocks.filter(b => b.type === "image") || [];
  return !!(article.importedArticle && meta && !meta.rejectedAt && meta.sourceKind === "crawler" && EDITORIAL_DIFFICULTIES.includes(meta.difficulty)
    && countArticleEnglishWords(article.importedArticle.text) >= 401
    && images.length > 0 && images.every(b => !!b.src && isFirstPartyArticleImageUrl(b.src))
    && isFirstPartyArticleImageUrl(meta.coverImageUrl || '')
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
  if(await editorialDayClosed(shanghaiDay(now)))return {skipped:"already_ran_today",status:await getRecommendationAutomationStatus(now)};
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
    if(!ledger.suspended) {
      const email=await notifyDailyResult(today,todays(),ledger.attempts,distributionSatisfied(Object.fromEntries(DAILY_CATEGORIES.map(k=>[k,todays().filter(a=>editorialCategoryForArticle(a)===k).length]))),config);
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
  const counts=()=>Object.fromEntries(DAILY_CATEGORIES.map(k=>[k,todays().filter(a=>editorialCategoryForArticle(a)===k).length]));
  const targetSatisfied=()=>todays().length>=EDITORIAL_TARGET&&distributionSatisfied(counts());
  const publishPool = async () => {
    const pool=candidates.filter(eligibleEditorialCandidate).filter(a=>!published.some(b=>b.id===a.id));
    while(pool.length && todays().length<DAILY_TOTAL_MAX && !targetSatisfied()) {
      pool.sort((a,b)=>score(b)-score(a)); const candidate=pool.shift()!;
      if((counts()[editorialCategoryForArticle(candidate)]||0)>=DAILY_CATEGORY_MAX)continue;
      // Balance ranks eligible items, never discards them or creates a paid retry.
      await writeDiscoverySetting(PENDING_KEY,[candidate.id]);
      const article=await publishArticleCandidate(candidate.id,{expectedEditorialHash:candidate.recommendation!.editorialReview!.contentHash,autoPublishedAt:new Date().toISOString()});
      await curate(article,today); await writeDiscoverySetting(PENDING_KEY,[]); published.push(article);
    }
  };
  await publishPool(); // Reuse already-paid valid candidates before spending on discovery.
  const spend=await getEditorialSpend(today);
  const maySpend=!spend.blocked && spend.actualMicrocny+spend.reservedMicrocny<(config.dailyBudgetCny??1.5)*1e6;
  const softBudgetReached=distributionSatisfied(counts()) && spend.actualMicrocny+spend.reservedMicrocny>=1e6;
  const expired=Date.now()-Date.parse(ledger.startedAt)>120*60_000;
  const observed:Record<string,{matched:number;total:number}>={};
  for(const article of [...published,...candidates]){
    const source=article.recommendation?.discoverySourceId;
    if(!source || !article.recommendation?.editorialReview?.checkedAt || shanghaiDay(article.recommendation.editorialReview.checkedAt)!==today)continue;
    const row=observed[source] ||= {matched:0,total:0};row.total++;
    if(article.recommendation.topics[0]==="商业经济" || editorialCategoryForArticle(article)==="商业")row.matched++;
  }
  const sites=rankEditorialSources(await getDiscoverySites(),counts(),ledger.sites,observed);
  const site=sites[0];
  let result:RecommendationAutomationRunResponse["result"];
  const before=todays().length;
  if (!targetSatisfied() && before<DAILY_TOTAL_MAX && maySpend && !softBudgetReached && !expired && site && ledger.attempts<config.dailyReviewLimit && (ledger.failureStreak||0)<3) {
    const entry=ledger.sites[site.id] ||= {visits:0,urls:[],empty:0};
    entry.visits++; const attempts=Math.min(3,config.dailyReviewLimit-ledger.attempts); ledger.attempts+=attempts;
    await writeDiscoverySetting(dayKey,ledger);
    result=await runRecommendationCrawler({topic:site.topics[0],difficulty:"any",targetInventory:0,ignoreInventoryTarget:true,inventoryScope:"candidates",sourceId:site.id,maxNewArticles:Math.min(3,DAILY_TOTAL_MAX-before),maxAttempts:attempts,feedPage:Math.min(3,entry.visits),excludedUrls:entry.urls,editorial:config},origin);
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
  const stopped=targetSatisfied() || todays().length>=DAILY_TOTAL_MAX || !maySpend || afterSpend.blocked || softBudgetReached || expired || !site || ledger.attempts>=config.dailyReviewLimit || (ledger.failureStreak||0)>=3;
  const complete=stopped && distributionSatisfied(counts());
  ledger.finished=stopped; await writeDiscoverySetting(dayKey,ledger);
  const email=stopped?await notifyDailyResult(today,todays(),ledger.attempts,complete,config):null;
  const stopReason=afterSpend.blocked||!maySpend?"预算达到边界":expired?"120 分钟时限":!site?"缺口板块来源耗尽":ledger.attempts>=config.dailyReviewLimit?`尝试次数达到 ${config.dailyReviewLimit}`:(ledger.failureStreak||0)>=3?"连续模型失败":"数量或分类边界";
  await writeDiscoverySetting("recommendation_automation_state",{...initial.state,...(email?{lastEmailStatus:email.status,lastEmailError:email.error}:{}),status:complete?"succeeded":stopped?"failed":"running",lastTrigger:trigger,lastStartedAt:ledger.startedAt,lastFinishedAt:new Date().toISOString(),lastCreatedCount:todays().length,lastAttemptedCount:ledger.attempts,lastSkippedCount:result?.skipped.length||0,lastSourceErrorCount:result?.sourceErrors.length||0,lastScheduledDate:stopped?today:"",lastError:complete?"":stopped?`已停止：${todays().length} 篇；${stopReason}，请查看明细。`:`已精选 ${todays().length} 篇，连续处理下一批。`});
  return {result,status:await getRecommendationAutomationStatus()};
}
