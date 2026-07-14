import { NextResponse } from "next/server";
import { listSyncObjects, writeSyncObjects } from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { getAuthenticatedUser } from "@/lib/userAuth";
import type { AccountSyncObject, SyncObjectKind } from "@/types/account";

const ALLOWED_KINDS = new Set<SyncObjectKind>([
  "article", "vocabulary", "explanation", "article_translation", "translation_block", "reading_state", "preferences",
]);

function isSyncObject(value: unknown): value is AccountSyncObject {
  const item = value as Partial<AccountSyncObject>;
  return Boolean(
    item &&
    typeof item.kind === "string" &&
    ALLOWED_KINDS.has(item.kind as SyncObjectKind) &&
    typeof item.objectKey === "string" &&
    item.objectKey.length > 0 &&
    item.objectKey.length <= 500 &&
    typeof item.clientUpdatedAt === "string" &&
    Number.isFinite(item.serverVersion),
  );
}

export async function GET() {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "请先登录。", code: "login_required" }, { status: 401 });
  }
  return NextResponse.json({ objects: await listSyncObjects(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "请先登录。", code: "login_required" }, { status: 401 });
  }

  let body: { objects?: unknown };
  try {
    body = await readJsonBody(request, 8 * 1024 * 1024);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof RequestBodyTooLargeError ? "同步数据超过 8MB，请先导出备份后分批处理。" : "同步数据格式无效。" },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

  if (!Array.isArray(body.objects) || body.objects.length > 20000 || !body.objects.every(isSyncObject)) {
    return NextResponse.json({ error: "同步对象格式无效。" }, { status: 400 });
  }

  const objects = await writeSyncObjects(user.id, body.objects);
  const hasConflict = objects.some((item) => !item.accepted);
  return NextResponse.json({ objects, conflict: hasConflict }, { status: hasConflict ? 409 : 200 });
}
