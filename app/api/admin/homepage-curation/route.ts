import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { accountFetch } from "@/lib/accountStore";
import { getHomepageCuration, saveHomepageCuration } from "@/lib/homepageCuration";
import { readJsonBody } from "@/lib/limitedBody";

export async function GET() {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  try {
    return NextResponse.json({ curation: await getHomepageCuration() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "首页编排读取失败。" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  const body = await readJsonBody<Record<string, unknown>>(request, 64 * 1024).catch(() => null);
  if (!body) return NextResponse.json({ error: "首页编排格式无效。" }, { status: 400 });
  try {
    const curation = await saveHomepageCuration(body.curation);
    await accountFetch("admin_audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        admin_label: "homepage-curation",
        action: "update_homepage_curation",
        target_type: "site_setting",
        target_id: "homepage_publication_curation",
        after_value: curation,
      }]),
    });
    return NextResponse.json({ curation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "首页编排保存失败。" }, { status: 500 });
  }
}

