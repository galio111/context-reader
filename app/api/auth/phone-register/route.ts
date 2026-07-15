import { NextResponse } from "next/server";
import { getAccountSessionState } from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { establishUserSession, isAccountSystemConfigured, registerPhonePinAccount } from "@/lib/userAuth";

interface RequestBody {
  phone?: string;
  nickname?: string;
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
    const session = await registerPhonePinAccount(body.phone ?? "", body.nickname ?? "", body.pin ?? "");
    const account = await getAccountSessionState(session.user);
    await establishUserSession(session);
    return NextResponse.json({ account }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "注册失败，请稍后重试。";
    return NextResponse.json(
      { error: message },
      { status: message.includes("已注册") ? 409 : 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
