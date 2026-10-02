import { NextResponse } from "next/server";
import { applyWechatTransaction, decryptWechatNotification, verifyWechat } from "@/lib/wechatPay";
export async function POST(request: Request) {
 try {
  if (Number(request.headers.get("content-length") || 0) > 32768) throw new Error("body too large");
  const reader = request.body?.getReader(); if (!reader) throw new Error("empty notification");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 32768) { await reader.cancel(); throw new Error("body too large"); } chunks.push(part.value); }
  const raw = Buffer.concat(chunks).toString("utf8");
  verifyWechat(request.headers, raw);
  await applyWechatTransaction(decryptWechatNotification(raw));
  return new NextResponse(null, { status: 204 });
 } catch { return NextResponse.json({ code: "FAIL", message: "通知校验或处理未完成" }, { status: 400 }); }
}
