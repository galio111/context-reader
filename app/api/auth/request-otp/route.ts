import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { isAccountSystemConfigured, isValidEmail, normalizeEmail, requestEmailOtp } from "@/lib/userAuth";

interface RequestBody {
  email?: string;
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

  const email = normalizeEmail(body.email ?? "");
  if (!isValidEmail(email)) {
    return NextResponse.json({ error: "请输入有效的邮箱地址。" }, { status: 400 });
  }

  try {
    await requestEmailOtp(email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "验证码发送失败，请稍后重试。" },
      { status: 502 },
    );
  }
}
