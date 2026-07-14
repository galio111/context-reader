import { NextResponse } from "next/server";
import { accountFetch, getAccountSessionState, listSyncObjects } from "@/lib/accountStore";
import { getAuthenticatedUser } from "@/lib/userAuth";

export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });
  const [account, objects, actions] = await Promise.all([
    getAccountSessionState(user),
    listSyncObjects(user.id),
    accountFetch<Array<Record<string, unknown>>>(`usage_actions?user_id=eq.${encodeURIComponent(user.id)}&select=id,feature,metric_key,quota_units,cache_hit,status,error_code,created_at,completed_at&order=created_at.desc&limit=10000`),
  ]);
  return NextResponse.json({ exportedAt: new Date().toISOString(), account, objects, usageActions: actions }, {
    headers: { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="context-reader-data-${new Date().toISOString().slice(0, 10)}.json"` },
  });
}
