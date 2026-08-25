import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";
import { repairExternalSavedArticleImages } from "@/lib/savedArticleImages";

export const runtime = "nodejs";

export async function PATCH() {
  if (!(await isAdminRequest())) {
    return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  }
  try {
    return NextResponse.json({ result: await repairExternalSavedArticleImages() });
  } catch (error) {
    console.error("Saved article image repair failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存文章图片修复失败。" },
      { status: 500 },
    );
  }
}
