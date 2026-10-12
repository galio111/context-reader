import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { studyRpc } from "@/lib/studyStore";
export async function GET(request: Request) {
  if (!await isAdminRequest()) return NextResponse.json({ error: "无管理员权限。" }, { status: 401 });
  const value = Number(new URL(request.url).searchParams.get("days") || 30);
  const days = [7,30,90].includes(value) ? value : 30;
  try { return NextResponse.json(await studyRpc("product_analytics", { p_days: days }), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return NextResponse.json({ error: "学习统计暂时无法读取。" }, { status: 503 }); }
}
