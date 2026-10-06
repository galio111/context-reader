import {DAILY_CATEGORIES,DAILY_TOTAL_MIN,distributionSatisfied} from './editorialDistribution';
import { captureEditorialRound, editorialIntakeStatus } from './editorialIntake';
import {supplyRetryDue,supplyRetryTime,type SupplyRetryLedger} from './editorialSupplyRetry';
import {rankEditorialSources, type SourceCategoryYield} from './editorialSourcePriority';
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
import { listArticleCandidates, listPublicArticles, publishArticleCandidate, setArticleCandidateRejected } from "@/lib/publicArticles";
import { editorialContentHash, type EditorialConfig } from "@/lib/editorialReview";
import { EDITORIAL_DIFFICULTIES, EDITORIAL_POLICY_VERSION } from "@/lib/editorialReviewPolicy";
import { normalizeHomepageCuration } from "@/lib/homepageCurationShared";
import { invalidateHomepageCuration } from "@/lib/homepageCuration";
import { approvedRefreshPool, isolatedPublishFailure } from "@/lib/editorialRecoveryPolicy";
import { editorialCategoryForArticle } from "@/lib/editorialCuration";
import { getRecommendationAutomationStatus, type RecommendationAutomationRunResponse } from "@/lib/recommendationAutomation";
import type { PublicArticle } from "@/types/publicArticle";

// Preserve existing report identities to avoid resending accepted SMTP deliveries.
const DAILY_DISCOVERY_TARGET = 60;
export const EDITORIAL_MINIMUM = DAILY_TOTAL_MIN;
const PENDING_KEY = "recommendation_editorial_pending_curation_v1";

/** Completed days use only tiny settings reads; yesterday's email state cannot suppress today's report. */
export async function editorialDayClosed(day:string, read=readDiscoverySetting):Promise<boolean> {
  const ledger=await read<SupplyRetryLedger>(`recommendation_editorial_day_${day}`,{});
  if(!ledger.finished)return false;
  if(ledger.suspended)return true;
  if(supplyRetryDue(ledger))return false;
  const reports=await Promise.all([DAILY_DISCOVERY_TARGET,30].flatMap(target=>["complete","shortfall"].map(kind=>read<{status?:string}>(`recommendation_editorial_email_${day}_${target}_${kind}`,{}))));
  return reports.some(report=>report.status==="sent");
}

/** CAS preserves simultaneous Admin placement edits; the journal repairs a publish/curation crash. */
export async function curateEditorialArticle(article: PublicArticle, today: string): Promise<void> {
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
    if (changed.length) { invalidateHomepageCuration(); revalidatePath("/"); return; }
  }
  throw new Error("首页精选同时发生变更，下批自动重试。");
}

export async function repairEditorialCurationDates(articles: PublicArticle[]): Promise<void> {
  const key = "homepage_publication_curation";
  for (let attempt=0;attempt<4;attempt++) {
    const rows=await accountFetch<Array<{value:unknown;updated_at:string}>>(`account_settings?key=eq.${key}&select=value,updated_at`);
    if(!rows[0])return;
    const value=normalizeHomepageCuration(rows[0].value);
    let changed=false;
    for(const article of articles) {
      const at=article.recommendation?.autoPublishedAt;
      if(at && !value.selectedAtById[article.id]) {value.selectedAtById[article.id]=at;changed=true;}
    }
    if(!changed)return;
    value.updatedAt=new Date().toISOString();
    const saved=await accountFetch<unknown[]>(`account_settings?key=eq.${key}&updated_at=eq.${encodeURIComponent(rows[0].updated_at)}`,{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({value,updated_at:value.updatedAt})});
    if(saved.length){invalidateHomepageCuration();revalidatePath("/");return;}
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
async function notifyDailyResult(today: string, articles: PublicArticle[], attempts: number, complete: boolean, config: EditorialConfig, recovery=false) {
  const key = `recommendation_editorial_email_${today}_${DAILY_DISCOVERY_TARGET}_${complete ? "complete" : "shortfall"}${recovery?"_recovery":""}`;
  const previous = await readDiscoverySetting<{ status?: string; at?: number }>(key, {});
  if (previous.status === "sent") return { status: "sent" as const, error: "" };
  if (previous.at && Date.now() - previous.at < 15 * 60_000) return null;
  const report = editorialDailyReport(today, articles, attempts, complete, await getEditorialSpend(today), undefined, config.dailyBudgetCny);
  const intake = await editorialIntakeStatus(await getDiscoverySites());
  report.text += '\n\n来源与待处理记录（累计）：\n' + intake.map(s => `${s.name}：等待审核 ${s.counts.waiting}；技术重试 ${s.counts.retry}；需要检查 ${s.counts.attention}；内容未入选 ${s.counts.rejected}；规则跳过 ${s.counts.skipped}。${s.feedErrors.length ? '订阅读取异常，保留已发现文章。' : ''}`).join('\n');
  report.text += '\n达到篇数门槛不表示所有来源读取正常或所有文章已审完。技术失败不是内容不合格；后台保留原因与重试入口。';
  await writeDiscoverySetting(key, { status: "sending", at: Date.now(), count: articles.length });
  const result = await sendSiteNotificationEmail(report.subject, report.text);
  await writeDiscoverySetting(key, { ...result, at: Date.now(), count: articles.length });
  return result;
}

/** Explicit recovery report reconciles the final day after approved backlog releases. */
export async function reportEditorialRecovery() {
  const today=shanghaiDay();
  const ledger=await readDiscoverySetting<{finished?:boolean;attempts?:number}>(`recommendation_editorial_day_${today}`,{});
  if(!ledger.finished)throw new Error("当日自动任务尚未完成，请先等待收尾。");
  const articles=await listPublicArticles();
  await repairEditorialCurationDates(articles);
  const curation=await readDiscoverySetting<{selectedAtById?:Record<string,string>}>("homepage_publication_curation",{});
  const rows=articles.filter(a=>shanghaiDay(curation.selectedAtById?.[a.id] || a.recommendation?.autoPublishedAt || "")===today);
  const counts=Object.fromEntries(DAILY_CATEGORIES.map(k=>[k,rows.filter(a=>editorialCategoryForArticle(a)===k).length]));
  const complete=distributionSatisfied(counts);
  if(complete)await writeDiscoverySetting(`recommendation_editorial_day_${today}`,{...ledger,nextSupplyRetryAt:undefined});
  const email=await notifyDailyResult(today,rows,ledger.attempts || 0,complete,await import("@/lib/editorialReview").then(m=>m.getEditorialConfig()),true);
  const status=await getRecommendationAutomationStatus();
  await writeDiscoverySetting("recommendation_automation_state",{...status.state,lastCreatedCount:rows.length,status:complete?"succeeded":"failed",...(email?{lastEmailStatus:email.status,lastEmailError:email.error}:{})});
  return {day:today,count:rows.length,counts,complete,email};
}

/** Caller holds the cross-instance discovery lease. One source per bounded batch. */
export async function runEditorialBatch(origin: string, trigger: "scheduled" | "manual", config: EditorialConfig, now: Date): Promise<RecommendationAutomationRunResponse> {
  if(await editorialDayClosed(shanghaiDay(now)))return {skipped:"already_ran_today",status:await getRecommendationAutomationStatus(now)};
  // No trial escape hatch: all automatic editorial runs share the finite daily cap.
  const effectiveConfig: EditorialConfig = {...config, provider:"deepseek", jevAutoAdopt:false, approvedJevChecks:[], budgetTrial:null, dailyBudgetCny:Math.min(1.5,config.dailyBudgetCny ?? 1.5)};
  try {
    const ledger=await readDiscoverySetting<SupplyRetryLedger & {recoveryAt?:string}>(`recommendation_editorial_day_${shanghaiDay(now)}`,{});
    return await withEditorialBudget(shanghaiDay(now), effectiveConfig.dailyBudgetCny!, () => runBudgetedBatch(origin, trigger, effectiveConfig, now),undefined,ledger.recoveryAt||supplyRetryDue(ledger)?'recovery':'scheduled');
  } catch(error) {
    const today=shanghaiDay(now);
    const ledger=await readDiscoverySetting<Record<string,unknown>>(`recommendation_editorial_day_${today}`,{});
    const articles=(await listPublicArticles()).filter(a=>shanghaiDay(a.recommendation?.autoPublishedAt || "")===today);
    const detail=String(error).slice(0,500);
    await writeDiscoverySetting(`recommendation_editorial_fault_${today}_${Date.now()}`,{at:new Date().toISOString(),error:detail});
    await writeDiscoverySetting(`recommendation_editorial_day_${today}`,{...ledger,finished:true,stopReason:"发布或运行异常"});
    const initial=await getRecommendationAutomationStatus();
    const email=await notifyDailyResult(today,articles,Number(ledger.attempts)||0,false,effectiveConfig);
    await writeDiscoverySetting("recommendation_automation_state",{...initial.state,status:"failed",lastScheduledDate:today,lastCreatedCount:articles.length,lastFinishedAt:new Date().toISOString(),lastError:"自动精选遇到异常，已停止并保留后台明细。",...(email?{lastEmailStatus:email.status,lastEmailError:email.error}:{})});
    return {status:await getRecommendationAutomationStatus()};
  }
}
async function runBudgetedBatch(origin: string, trigger: "scheduled" | "manual", config: EditorialConfig, now: Date): Promise<RecommendationAutomationRunResponse> {
  const today = shanghaiDay(now);
  const published = await listPublicArticles();
  await repairEditorialCurationDates(published);
  const pending = await readDiscoverySetting<string[]>(PENDING_KEY, []);
  for (const id of pending) {
    const article = published.find((a) => a.id === id);
    if (article) await curateEditorialArticle(article, today);
  }
  await writeDiscoverySetting(PENDING_KEY, []);
  const initial = await getRecommendationAutomationStatus(now);
  const dayKey = `recommendation_editorial_day_${today}`;
  type Ledger = SupplyRetryLedger & {attempts:number; recoveryAt?:string; deadlineAt?:string; stopReason?:string; refreshedIds?:string[]; publishFailures?:Record<string,{revision:string;reason:string}>; noProgress?:number; failureStreak?:number; sites:Record<string,{visits:number;waveVisits?:number;urls:string[];empty?:number}>};
  const ledger = await readDiscoverySetting<Ledger>(dayKey,{attempts:0,sites:{}});
  ledger.startedAt ||= now.toISOString();
  if(supplyRetryDue(ledger)) {
    const remaining=Math.max(0,120*60_000-(ledger.processingMs ?? 120*60_000));
    ledger.nextSupplyRetryAt=undefined;
    if(remaining) {
      ledger.finished=false;ledger.supplyRetryCount=1;ledger.nextSupplyRetryAt=undefined;
      ledger.recoveryAt=now.toISOString();ledger.processingStartedAt=now.toISOString();ledger.deadlineAt=new Date(Date.now()+remaining).toISOString();
      for(const entry of Object.values(ledger.sites)){entry.waveVisits=0;entry.empty=0;}
    }
    await writeDiscoverySetting(dayKey,ledger);
  }
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
  const publishPool = async () => {
    const pool=candidates.filter(eligibleEditorialCandidate).filter(a=>!published.some(b=>b.id===a.id) && ledger.publishFailures?.[a.id]?.revision!==a.updatedAt);
    while(pool.length) {
      pool.sort((a,b)=>score(b)-score(a)); const candidate=pool.shift()!;
      // Balance ranks eligible items, never discards them or creates a paid retry.
      await writeDiscoverySetting(PENDING_KEY,[candidate.id]);
      try {
        const article=await publishArticleCandidate(candidate.id,{expectedEditorialHash:candidate.recommendation!.editorialReview!.contentHash,autoPublishedAt:new Date().toISOString()});
        // Retain an accepted publication even if the following curation write needs repair.
        published.push(article);
        await curateEditorialArticle(article,today); await writeDiscoverySetting(PENDING_KEY,[]);
      } catch(error) {
        if(!isolatedPublishFailure(error))throw error;
        if(/相同公开文章/.test(String(error)))await setArticleCandidateRejected(candidate.id,true,"与已有文章相似",candidate.updatedAt);
        (ledger.publishFailures ||= {})[candidate.id]={revision:candidate.updatedAt,reason:String(error).slice(0,300)};
        await writeDiscoverySetting(dayKey,ledger);
        await writeDiscoverySetting(PENDING_KEY,[]);
      }
    }
  };
  await publishPool(); // Reuse already-paid valid candidates before spending on discovery.
  const sourceSites = await getDiscoverySites();
  const scanComplete = await captureEditorialRound(sourceSites, ledger.recoveryAt);
  const spend=await getEditorialSpend(today);
  const maySpend=!spend.blocked && spend.actualMicrocny+spend.reservedMicrocny<(config.dailyBudgetCny??1.5)*1e6;
  const expired=Date.now()>Date.parse(ledger.deadlineAt || new Date(Date.parse(ledger.startedAt)+120*60_000).toISOString());
  const refresh=approvedRefreshPool(candidates.filter(a=>!eligibleEditorialCandidate(a)),counts(),ledger.refreshedIds)[0];
  const canWork=maySpend && !expired && ledger.attempts<config.dailyReviewLimit && (ledger.failureStreak||0)<3;
  let refreshResult:RecommendationAutomationRunResponse["result"];
  let refreshError="";
  if(canWork && refresh) {
    (ledger.refreshedIds ||= []).push(refresh.id);
    ledger.attempts++;
    await writeDiscoverySetting(dayKey,ledger);
    try {
      refreshResult=await runRecommendationCrawler({topic:refresh.recommendation!.topics[0],difficulty:"any",targetInventory:0,ignoreInventoryTarget:true,inventoryScope:"candidates",refreshCandidateId:refresh.id,maxNewArticles:1,maxAttempts:1,editorial:config},origin);
      const revised=refreshResult.created[0];
      if(revised){const index=candidates.findIndex(a=>a.id===revised.id);candidates[index]=revised;}
      await publishPool();
    } catch(error) {
      refreshError=String(error).slice(0,500);
    }
    await writeDiscoverySetting(`recommendation_editorial_refresh_${today}_${refresh.id}`,{at:new Date().toISOString(),created:refreshResult?.created.map(a=>a.id)||[],skipped:refreshResult?.skipped||[],error:refreshError});
  }
  const observed:Record<string,SourceCategoryYield>={};
  for(const article of new Map([...published,...candidates].map(article=>[article.id,article])).values()){
    const source=article.recommendation?.discoverySourceId;
    const checkedAt=Date.parse(article.recommendation?.editorialReview?.checkedAt || "");
    if(!source || !Number.isFinite(checkedAt) || checkedAt<Date.now()-3*24*3600_000)continue;
    const row=observed[source] ||= {total:0,categories:{}};row.total++;
    const category=editorialCategoryForArticle(article);
    if(article.recommendation?.editorialReview?.status==='passed')row.categories[category]=(row.categories[category]||0)+1;
  }
  const waveVisits=Object.fromEntries(Object.entries(ledger.sites).map(([id,entry])=>[id,{...entry,visits:entry.waveVisits ?? entry.visits}]));
  const intakeStatus = await editorialIntakeStatus(sourceSites);
  const sites=rankEditorialSources(sourceSites.map(s=>({...s,pendingCount:intakeStatus.find(q=>q.id===s.id)?.due || 0})),counts(),waveVisits,observed);
  const site=sites[0];
  let result:RecommendationAutomationRunResponse["result"]=refreshResult;
  const before=todays().length;
  if (!refresh && canWork && site) {
    const entry=ledger.sites[site.id] ||= {visits:0,urls:[],empty:0};
    entry.visits++;if(entry.waveVisits!==undefined)entry.waveVisits++; const attempts=Math.min(3,config.dailyReviewLimit-ledger.attempts); ledger.attempts+=attempts;
    await writeDiscoverySetting(dayKey,ledger);
    result=await runRecommendationCrawler({topic:site.topics[0],difficulty:"any",targetInventory:0,ignoreInventoryTarget:true,inventoryScope:"candidates",sourceId:site.id,maxNewArticles:3,maxAttempts:attempts,feedPage:site.pendingCount?1:Math.min(6,entry.waveVisits ?? entry.visits),excludedUrls:entry.urls,editorial:config},origin);
    ledger.attempts-=Math.max(0,attempts-result.attempted);
    entry.urls=[...new Set([...entry.urls,...result.skipped.filter(s=>s.kind!=='technical_pending').map(s=>s.url),...result.created.map(a=>a.sourceUrl)])];
    entry.empty=result.created.length?0:(entry.empty||0)+1;
    const faults=result.skipped.filter(s=>s.kind==='technical_pending' && s.stage==='review' && /flash_invalid|flash_missing|flash_inconsistent|editorial_provider|fetch failed|timeout|JSON/i.test(s.reason)).length;
    ledger.failureStreak=result.created.length?0:faults?(ledger.failureStreak||0)+faults:0;
    // Append-only batch detail: historical failures must not be overwritten.
    await writeDiscoverySetting(`recommendation_editorial_batch_${today}_${site.id}_${entry.visits}`,{at:new Date().toISOString(),attempted:result.attempted,created:result.created.map(a=>a.id),skipped:result.skipped,sourceErrors:result.sourceErrors});
    candidates.push(...result.created); await publishPool();
  }
  ledger.noProgress=todays().length>before?0:(ledger.noProgress||0)+1;
  const afterSpend=await getEditorialSpend(today);
  const remainingRefresh=approvedRefreshPool(candidates.filter(a=>!eligibleEditorialCandidate(a)),counts(),ledger.refreshedIds).length;
  const stopped=scanComplete && (!maySpend || afterSpend.blocked || expired || (!site && !remainingRefresh) || ledger.attempts>=config.dailyReviewLimit || (ledger.failureStreak||0)>=3);
  const complete=stopped && distributionSatisfied(counts());
  const stopReason=afterSpend.blocked||!maySpend?"预算达到边界，未审核文章保留":expired?"120 分钟时限，未审核文章保留":!site?"本轮可处理来源耗尽，技术问题保留":ledger.attempts>=config.dailyReviewLimit?`尝试次数达到 ${config.dailyReviewLimit}，未审核文章保留`:(ledger.failureStreak||0)>=3?"连续模型失败，保留待重试":"继续处理";
  ledger.finished=stopped;ledger.stopReason=stopReason;
  if(stopped) {
    ledger.processingMs=Math.min(120*60_000,(ledger.processingMs||0)+Math.max(0,Date.now()-Date.parse(ledger.processingStartedAt || ledger.startedAt)));
    ledger.nextSupplyRetryAt=!site && !remainingRefresh && maySpend && !afterSpend.blocked && !expired && ledger.attempts<config.dailyReviewLimit && (ledger.failureStreak||0)<3 && !ledger.supplyRetryCount ? supplyRetryTime(today,Date.now(),ledger.processingMs) : undefined;
  }
  await writeDiscoverySetting(dayKey,ledger);
  const email=stopped?await notifyDailyResult(today,todays(),ledger.attempts,complete,config):null;
  await writeDiscoverySetting("recommendation_automation_state",{...initial.state,...(email?{lastEmailStatus:email.status,lastEmailError:email.error}:{}),status:complete?"succeeded":stopped?"failed":"running",lastTrigger:trigger,lastStartedAt:ledger.startedAt,lastFinishedAt:new Date().toISOString(),lastCreatedCount:todays().length,lastAttemptedCount:ledger.attempts,lastSkippedCount:result?.skipped.length||0,lastSourceErrorCount:result?.sourceErrors.length||0,lastScheduledDate:stopped?today:"",lastError:complete?"":stopped?`已停止：${todays().length} 篇；${stopReason}，请查看明细。`:`已精选 ${todays().length} 篇，连续处理下一批。`});
  return {result,status:await getRecommendationAutomationStatus()};
}
