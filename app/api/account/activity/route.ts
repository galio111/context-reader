import { NextResponse } from "next/server";
import { studyOwner } from "@/lib/studyAuth";
import { studyRpc } from "@/lib/studyStore";
export async function GET(request: Request) {
  try {
    const user = await studyOwner(request);
    if (!user) return NextResponse.json({ error: "请登录后查看学习记录。" }, { status: 401 });
    return NextResponse.json(await studyRpc("activity_summary", { p_user: user }), { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  } catch { return NextResponse.json({ error: "学习记录暂时无法读取，请稍后重试。" }, { status: 503 }); }
}
export async function POST(request: Request) {
  try {
    const user = await studyOwner(request);
    if (!user) return NextResponse.json({ error: "请登录后继续。" }, { status: 401 });
    await studyRpc("record_visit", { p_user: user });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "访问记录暂时无法保存。" }, { status: 503 }); }
}
