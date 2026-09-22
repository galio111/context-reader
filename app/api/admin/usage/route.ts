import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { accountFetch } from "@/lib/accountStore";
import { buildUsageReport, reportWindow, type ReportAction, type ReportExecution } from "@/lib/adminUsageReport";

async function pageRows<T>(table: string, select: string, start: string, end: string) {
  const rows: T[] = [];
  for (let offset = 0; offset < 50000; offset += 1000) {
    const query = new URLSearchParams({ select, and: `(created_at.gte.${start},created_at.lt.${end})`, order: "created_at.desc,id.desc", limit: "1000", offset: String(offset) });
    const page = await accountFetch<T[]>(`${table}?${query}`);
    rows.push(...page);
    if (page.length < 1000) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
export async function GET(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "未登录管理员。" }, { status: 401 });
  let window;
  try { window = reportWindow(new URL(request.url).searchParams); }
  catch { return NextResponse.json({ error: "请选择最近 30 个上海自然日内的有效时间和费用来源。" }, { status: 400 }); }
  try {
    const actionFields = "id,user_id,guest_id,owner_key,feature,metric_key,quota_units,status,cache_hit,created_at";
    const [executions, actions] = await Promise.all([
      pageRows<ReportExecution>("usage_executions", `id,action_id,provider,model,route,prompt_tokens,prompt_cache_hit_tokens,prompt_cache_miss_tokens,completion_tokens,status,created_at,usage_actions(${actionFields})`, window.start, window.end),
      pageRows<ReportAction>("usage_actions", actionFields, window.start, window.end),
    ]);
    return NextResponse.json({ ...buildUsageReport(executions.rows, actions.rows, window), truncated: executions.truncated || actions.truncated, loadedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "用量报表暂时无法读取，请稍后重试。" }, { status: 503 }); }
}
