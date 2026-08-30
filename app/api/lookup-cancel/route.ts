import { NextResponse } from "next/server";
import { cancelActiveLookupRequests, isLookupActionId } from "@/lib/activeLookupRequests";
import { readRequestBytes, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { requestExternalOrigin } from "@/lib/requestSecurity";

export async function POST(request: Request) {
  const origin = request.headers.get("origin")?.trim() ?? "";
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase() ?? "";
  let validOrigin = true;
  if (origin) {
    try {
      validOrigin = new URL(origin).origin === requestExternalOrigin(request);
    } catch {
      validOrigin = false;
    }
  }
  if (!validOrigin || fetchSite === "cross-site") {
    return NextResponse.json({ error: "不允许跨站取消请求。" }, { status: 403 });
  }
  let actionId = "";
  try {
    actionId = new TextDecoder().decode(await readRequestBytes(request, 128)).trim();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "取消标识过长。" : "取消标识无效。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!isLookupActionId(actionId)) {
    return NextResponse.json({ error: "取消标识无效。" }, { status: 400 });
  }
  const cancelled = cancelActiveLookupRequests(actionId);
  return NextResponse.json({ ok: true, cancelled }, { headers: { "Cache-Control": "no-store" } });
}
