import { NextResponse } from "next/server";
import { getAccountSessionState } from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { adoptSupabaseSession, establishUserSession, isAccountSystemConfigured } from "@/lib/userAuth";

interface RequestBody {
  accessToken?: string;
  refreshToken?: string;
}

export async function POST(request: Request) {
  if (!isAccountSystemConfigured()) {
    return NextResponse.json({ error: "账号服务尚未配置。" }, { status: 503 });
  }

  let body: RequestBody;
  try {
    body = await readJsonBody<RequestBody>(request, 20 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "登录信息过大。" : "登录信息格式不正确。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  try {
    const session = await adoptSupabaseSession(body.accessToken ?? "", body.refreshToken ?? "");
    const account = await getAccountSessionState(session.user);
    await establishUserSession(session);
    return NextResponse.json({ account });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录链接无效或已过期。" },
      { status: 401 },
    );
  }
}
