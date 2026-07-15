import { NextResponse } from "next/server";
import { getAccountSessionState } from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { establishUserSession, isAccountSystemConfigured, loginPhonePinAccount } from "@/lib/userAuth";

interface RequestBody {
  phone?: string;
  pin?: string;
}

export async function POST(request: Request) {
  if (!isAccountSystemConfigured()) {
    return NextResponse.json({ error: "账号服务尚未配置。" }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await readJsonBody<RequestBody>(request, 4 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式不正确。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  try {
    const session = await loginPhonePinAccount(body.phone ?? "", body.pin ?? "");
    const account = await getAccountSessionState(session.user);
    if (account.profile?.status !== "active") {
      return NextResponse.json({ error: "账号已停用，请联系管理员。" }, { status: 403 });
    }
    await establishUserSession(session);
    return NextResponse.json({ account }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败，请稍后重试。" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
}
