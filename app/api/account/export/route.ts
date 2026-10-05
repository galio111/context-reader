import { NextResponse } from "next/server";
import { accountFetch, getAccountSessionState, listSyncObjects } from "@/lib/accountStore";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { getStudySettings, studyRows } from "@/lib/studyStore";

export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const [account, objects, actions, studySettings, studyCards, studyReviews, studyDays, readingEvidence, readingProfiles, studyRewards, studyStreaks] = await Promise.all([
    getAccountSessionState(user),
    listSyncObjects(user.id),
    accountFetch<Array<Record<string, unknown>>>(`usage_actions?user_id=eq.${encodeURIComponent(user.id)}&select=id,feature,metric_key,quota_units,cache_hit,status,error_code,created_at,completed_at&order=created_at.desc&limit=10000`),
    getStudySettings(user.id),
    studyRows("study_cards",user.id,"id,entry_id,mode,memory,version,suspended,anki_pending,created_at","&order=id.asc"),
    studyRows("study_reviews",user.id,"*","&order=reviewed_at.asc,id.asc",1000000),
    studyRows("study_days",user.id,"*","&order=day.asc"),
    studyRows("study_reading_days",user.id,"day,active_seconds,words,articles","&order=day.asc"),
    studyRows("study_profiles",user.id),
    studyRows("study_rewards",user.id),studyRows("study_streaks",user.id),
  ]);
  return NextResponse.json({ exportedAt: new Date().toISOString(), account, objects, usageActions: actions,
    study:{settings:studySettings,cards:studyCards,reviews:studyReviews,days:studyDays,rewards:studyRewards,streaks:studyStreaks,readingEvidence,readingProfiles} }, {
    headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="context-reader-data-${new Date().toISOString().slice(0, 10)}.json"` },
  });
}
