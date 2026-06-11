import { NextResponse } from "next/server";
import { createAdminSession, isAdminPassword } from "@/lib/adminAuth";

export async function POST(request: Request) {
  const data = (await request.json().catch(() => null)) as { password?: string } | null;
  const password = data?.password ?? "";

  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: "管理员密码不正确。" }, { status: 401 });
  }

  await createAdminSession();
  return NextResponse.json({ ok: true });
}

