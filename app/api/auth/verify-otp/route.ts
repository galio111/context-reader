import { NextResponse } from "next/server";
import { getAccountSessionState } from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { establishUserSession, isAccountSystemConfigured, verifyEmailOtp } from "@/lib/userAuth";

interface RequestBody {
  email?: string;
  token?: string;
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
    const session = await verifyEmailOtp(body.email ?? "", body.token ?? "");
    const account = await getAccountSessionState(session.user);
    await establishUserSession(session);
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录失败，请重新获取验证码。" },
      { status: 401 },
    );
  }
}
