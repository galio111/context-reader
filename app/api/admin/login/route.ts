import { NextResponse } from "next/server";
import { createAdminSession, isAdminPassword } from "@/lib/adminAuth";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export async function POST(request: Request) {
  let data: { password?: string } | null;
  try {
    data = await readJsonBody(request, 4 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式无效。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  const password = data?.password ?? "";

  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: "管理员密码不正确。" }, { status: 401 });
  }

  try {
    await createAdminSession();
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Admin session creation failed", error);
    return NextResponse.json(
      { error: "管理员登录暂不可用，请检查服务端安全配置。" },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
