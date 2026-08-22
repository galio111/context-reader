import { NextResponse } from "next/server";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { changePhoneAccountPassword, getAuthenticatedUser } from "@/lib/userAuth";

interface PasswordPatchBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "请先登录。" }, { status: 401 });

  let body: PasswordPatchBody;
  try {
    body = await readJsonBody<PasswordPatchBody>(request, 4 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "请求内容过大。" : "请求格式不正确。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  try {
    await changePhoneAccountPassword(
      user.id,
      String(body.currentPassword ?? ""),
      String(body.newPassword ?? ""),
    );
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "密码暂时无法修改，请稍后重试。" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
