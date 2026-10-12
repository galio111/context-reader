import { notFound } from "next/navigation";
import { getAdminAccessMode } from "@/lib/adminAuth";
import { getAccountPlan } from "@/lib/accountStore";
import type { AccountPlanId } from "@/types/account";
import { previewAccount, type PreviewBalance } from "@/lib/experiencePreview";
import { ExperiencePreview } from "@/components/ExperiencePreview";
import { AccountUsagePageContent } from "@/components/AccountUsagePageContent";
import { BillingPage } from "@/components/BillingPage";
import HomePage from "@/app/page";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<{plan?:string;balance?:string;screen?:string}>}) {
  if(await getAdminAccessMode()!=="developer")notFound();
  const query=await searchParams;
  const plan=(["guest","free","basic","plus","max"].includes(query.plan||"")?query.plan:"guest") as AccountPlanId;
  const balance=(["available","low","empty"].includes(query.balance||"")?query.balance:"available") as PreviewBalance;
  const account=previewAccount(await getAccountPlan(plan),balance);
  return <ExperiencePreview account={account}>{query.screen==="account"?<AccountUsagePageContent embedded/>:query.screen==="billing"?<BillingPage/>:<HomePage searchParams={Promise.resolve({})}/>}</ExperiencePreview>;
}
