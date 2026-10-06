import { listArticleCandidates, listPublicArticles, publishArticleCandidate, setArticleCandidateRejected } from "@/lib/publicArticles";
import { getEditorialConfig } from "@/lib/editorialReview";
import { getEditorialSpend, withEditorialBudget } from "@/lib/editorialBudget";
import { readDiscoverySetting, writeDiscoverySetting } from "@/lib/discoveryStore";
import { runRecommendationCrawler } from "@/lib/recommendationCrawler";
import { curateEditorialArticle, eligibleEditorialCandidate, repairEditorialCurationDates } from "@/lib/editorialRunner";
import { shanghaiDay } from "@/lib/discoveryPolicy";
import { isolatedPublishFailure } from "@/lib/editorialRecoveryPolicy";
import { canonicalArticleUrl } from "@/lib/recommendationFeed";
import type { RecommendationAutomationState } from "@/types/recommendationCrawler";

/** Caller holds the discovery lease. Resume interrupted work with its remaining processing time. */
export async function resumeEditorialDay() {
  const today=shanghaiDay();
  const key=`recommendation_editorial_day_${today}`;
  const ledger=await readDiscoverySetting<Record<string,unknown>>(key,{attempts:0,sites:{}});
  const state=await readDiscoverySetting<RecommendationAutomationState>("recommendation_automation_state",{} as RecommendationAutomationState);
  const consumed=Number(ledger.processingMs) || Math.max(0,Date.parse(state.lastFinishedAt || "")-Date.parse(String(ledger.startedAt || ""))) || 0;
  const remaining=Math.max(0,120*60_000-Math.min(120*60_000,consumed));
  if(!remaining)throw new Error("今日有效处理时间已达 120 分钟，不能继续自动抓取。");
  await repairEditorialCurationDates(await listPublicArticles());
  const at=new Date().toISOString();
  await writeDiscoverySetting(`recommendation_editorial_recovery_${today}_${Date.now()}`,{at,previous:ledger,remainingProcessingMs:remaining,reason:"管理员恢复异常中断的日任务"});
  await writeDiscoverySetting(key,{...ledger,finished:false,suspended:false,stopReason:undefined,recoveryAt:at,processingMs:consumed,processingStartedAt:at,nextSupplyRetryAt:undefined,deadlineAt:new Date(Date.now()+remaining).toISOString()});
  await writeDiscoverySetting("recommendation_automation_state",{...state,status:"running",lastScheduledDate:"",lastEmailStatus:"not_requested",lastEmailError:"",lastError:"修复后继续审核未完成文章；数量达标后仍继续处理。"});
  return {day:today,remainingProcessingMs:remaining};
}

/** Backlog releases retain quality gates; quantity never prevents an approved publication. */
export async function publishApprovedCandidates(ids: string[], origin: string) {
  const config=await getEditorialConfig();
  const today=shanghaiDay();
  const rows=await listArticleCandidates();
  const curation=await readDiscoverySetting<{selectedAtById?:Record<string,string>}>("homepage_publication_curation",{});
  const allPublished=await listPublicArticles();
  const publishedToday=allPublished.filter(a=>shanghaiDay(curation.selectedAtById?.[a.id] || a.recommendation?.autoPublishedAt || "")===today);
  const outcomes:Array<{id:string;status:string;reason?:string}>=[];
  return withEditorialBudget(today,Math.min(1.5,config.dailyBudgetCny ?? 1.5),async()=> {
    for(const id of ids) {
      const key=`recommendation_editorial_backlog_${today}_${id}`;
      const old=await readDiscoverySetting<{id:string;status:string;reason?:string}|null>(key,null);
      if(old && !(old.status==="kept" && /缺少可靠发布日期/.test(old.reason || "") && !(old as {datePolicyVersion?:number}).datePolicyVersion)){outcomes.push(old);continue;}
      let row=rows.find(a=>a.id===id);
      let result:{id:string;status:string;reason?:string};
      try {
        if(!row || row.recommendation?.editorialReview?.status!=="passed")throw new Error("候选未通过审核或已经变化，留待核实。");
        if(row.sourceUrl && allPublished.some(a=>canonicalArticleUrl(a.sourceUrl)===canonicalArticleUrl(row!.sourceUrl))) {await setArticleCandidateRejected(id,true,"与已有文章相似",row.updatedAt);throw new Error("已有相同公开文章，不重复自动精选。");}
        if(!eligibleEditorialCandidate(row)) {
          const spend=await getEditorialSpend(today);
          if(spend.calls>=config.dailyReviewLimit || spend.blocked)throw new Error("今日审核或费用已达边界，保留候选。");
          const refresh=await runRecommendationCrawler({topic:row.recommendation.topics[0],difficulty:"any",targetInventory:0,ignoreInventoryTarget:true,inventoryScope:"candidates",refreshCandidateId:id,maxNewArticles:1,maxAttempts:1,editorial:config},origin);
          row=refresh.created[0];
          if(!row || !eligibleEditorialCandidate(row))throw new Error(refresh.skipped[0]?.reason || row?.recommendation?.editorialReview?.reasons.join("；") || "重新核验未通过，保留候选。");
        }
        const published=await publishArticleCandidate(id,{expectedEditorialHash:row.recommendation!.editorialReview!.contentHash,expectedUpdatedAt:row.updatedAt,autoPublishedAt:new Date().toISOString()});
        publishedToday.push(published);
        await writeDiscoverySetting(key,{id,status:"published",curationPending:true,at:new Date().toISOString()});
        await curateEditorialArticle(published,today);
        result={id,status:"published"};
      } catch(error) {
        if(publishedToday.some(a=>a.id===id)) {
          result={id,status:"published",reason:"发布已完成，首页记录待恢复。"};
        } else {
        result={id,status:isolatedPublishFailure(error) && /相同公开文章/.test(String(error))?"duplicate":"kept",reason:String(error).slice(0,500)};
        }
      }
      await writeDiscoverySetting(key,{...result,datePolicyVersion:1,at:new Date().toISOString()});
      outcomes.push(result);
    }
    return {day:today,outcomes};
  },undefined,'backlog');
}
