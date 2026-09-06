import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { accountFetch } from "@/lib/accountStore";
import { getHomepageCuration, saveHomepageCuration } from "@/lib/homepageCuration";
import { readJsonBody } from "@/lib/limitedBody";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { listPublicArticles } from "@/lib/publicArticles";
import { shufflePublishedHomepageCuration } from "@/lib/editorialCuration";

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
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站后台操作。" }, { status: 403 });
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

export async function PATCH(request: Request) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站后台操作。" }, { status: 403 });
  const body = await readJsonBody<{ action?: unknown }>(request, 4 * 1024).catch(() => null);
  if (body?.action !== "shuffle-published") return NextResponse.json({ error: "首页编排操作无效。" }, { status: 400 });
  try {
    const [current, articles] = await Promise.all([getHomepageCuration(), listPublicArticles()]);
    const curation = await saveHomepageCuration(shufflePublishedHomepageCuration(current, articles));
    await accountFetch("admin_audit_logs", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify([{
        admin_label: "homepage-curation",
        action: "shuffle_published_homepage",
        target_type: "site_setting",
        target_id: "homepage_publication_curation",
        after_value: curation,
      }]),
    });
    return NextResponse.json({ curation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "往日精选打乱失败。" }, { status: 500 });
  }
}
