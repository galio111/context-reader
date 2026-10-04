import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userAuth";
import { readDictionaryResult } from "@/lib/dictionaryResultServer";
import { isValidStandaloneDictionaryQuery, sanitizeDictionaryQuery } from "@/lib/deepseekDictionary";

// Read-only recovery. This route cannot reserve quota or call a model.
export async function GET(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录。", code: "login_required" }, { status: 401 });
  const owner = request.headers.get("X-Context-Account");
  if (owner && owner !== user.id) return NextResponse.json({ error: "账号已切换，请刷新后重试。" }, { status: 409 });
  const query = sanitizeDictionaryQuery(new URL(request.url).searchParams.get("query") || "");
  if (!isValidStandaloneDictionaryQuery(query)) return NextResponse.json({ error: "查询内容无效。" }, { status: 400 });
  try {
    const dictionary = await readDictionaryResult(user.id, query);
    return NextResponse.json({ dictionary }, {
      status: dictionary ? 200 : 404, headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "历史结果暂时无法读取，请稍后重试。" }, { status: 503 });
  }
}
