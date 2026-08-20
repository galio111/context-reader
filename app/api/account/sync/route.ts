import { NextResponse } from "next/server";
import { decodeAccountSyncCursor, encodeAccountSyncCursor } from "@/lib/accountSyncCursor";
import {
  getLatestSyncCursor,
  listSyncBootstrapObjects,
  listSyncChanges,
  listSyncObjects,
  writeSyncObjects,
} from "@/lib/accountStore";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";
import { getAuthenticatedUser } from "@/lib/userAuth";
import type { AccountSyncObject, SyncObjectKind } from "@/types/account";

const ALLOWED_KINDS = new Set<SyncObjectKind>([
  "article", "vocabulary", "explanation", "article_translation", "translation_block", "reading_state", "preferences",
]);
const LEGACY_ARTICLE_RECOVERY_ID = /(?:-local-recovered-[a-z0-9]+)+$/i;

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

export async function GET(request: Request) {
  const user = await getAuthenticatedUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "请先登录。", code: "login_required" }, { status: 401 });
  }
  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get("protocol") === "2") {
    const bootstrapKind = searchParams.get("bootstrap");
    if (bootstrapKind === "active" || bootstrapKind === "deleted") {
      const rawSnapshot = searchParams.get("snapshot") || "";
      const snapshot = rawSnapshot
        ? decodeAccountSyncCursor(rawSnapshot)
        : await getLatestSyncCursor(user.id);
      if (!snapshot) {
        return NextResponse.json(
          { objects: [], nextOffset: null, snapshotCursor: "" },
          { headers: { "Cache-Control": "no-store" } },
        );
      }
      if (rawSnapshot && !decodeAccountSyncCursor(rawSnapshot)) {
        return NextResponse.json({ error: "首次同步快照无效，请重新开始。" }, { status: 400 });
      }
      const requestedOffset = Number(searchParams.get("offset") || "0");
      const offset = Number.isFinite(requestedOffset)
        ? Math.max(0, Math.min(100_000, Math.floor(requestedOffset)))
        : 0;
      const sourcePageSize = bootstrapKind === "deleted" ? 1_000 : 500;
      const source = await listSyncBootstrapObjects(
        user.id,
        snapshot,
        bootstrapKind === "deleted",
        offset,
        sourcePageSize,
      );
      const objects: AccountSyncObject[] = [];
      const responseByteLimit = 2_000_000;
      let responseBytes = 0;
      for (const object of source) {
        const objectBytes = new TextEncoder().encode(JSON.stringify(object)).byteLength;
        if (objects.length > 0 && responseBytes + objectBytes > responseByteLimit) break;
        objects.push(object);
        responseBytes += objectBytes;
      }
      const consumed = objects.length;
      const hasMore = consumed < source.length || source.length === sourcePageSize;
      return NextResponse.json(
        {
          objects,
          nextOffset: hasMore ? offset + consumed : null,
          snapshotCursor: encodeAccountSyncCursor(snapshot),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const rawCursor = searchParams.get("cursor") || "";
    const cursor = rawCursor ? decodeAccountSyncCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: "同步游标无效，请重新执行首次同步。" }, { status: 400 });
    }
    const sourcePageSize = 500;
    const source = await listSyncChanges(user.id, cursor, sourcePageSize);
    const objects: AccountSyncObject[] = [];
    const responseByteLimit = 2_000_000;
    let responseBytes = 0;
    for (const object of source.objects) {
      const objectBytes = new TextEncoder().encode(JSON.stringify(object)).byteLength;
      if (objects.length > 0 && responseBytes + objectBytes > responseByteLimit) break;
      objects.push(object);
      responseBytes += objectBytes;
    }
    const consumed = objects.length;
    const lastCursor = consumed > 0 ? source.cursors[consumed - 1] : cursor;
    const hasMore = consumed < source.objects.length || source.objects.length === sourcePageSize;
    return NextResponse.json(
      {
        objects,
        nextCursor: lastCursor ? encodeAccountSyncCursor(lastCursor) : rawCursor,
        hasMore,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const requestedOffset = Number(searchParams.get("offset") || "0");
  const offset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.min(20_000, Math.floor(requestedOffset)))
    : 0;
  const sourcePageSize = 500;
  const source = await listSyncObjects(user.id, { offset, limit: sourcePageSize });
  const objects: AccountSyncObject[] = [];
  const responseByteLimit = 2_000_000;
  let responseBytes = 0;
  for (const object of source) {
    const objectBytes = new TextEncoder().encode(JSON.stringify(object)).byteLength;
    if (objects.length > 0 && responseBytes + objectBytes > responseByteLimit) break;
    objects.push(object);
    responseBytes += objectBytes;
  }
  const consumed = objects.length;
  const hasMore = consumed < source.length || source.length === sourcePageSize;
  return NextResponse.json(
    { objects, nextOffset: hasMore ? offset + consumed : null },
    { headers: { "Cache-Control": "no-store" } },
  );
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

  const submittedObjects = body.objects as AccountSyncObject[];
  const normalizedObjects = submittedObjects.map((object) => {
    if (object.kind !== "article" || object.deletedAt || !LEGACY_ARTICLE_RECOVERY_ID.test(object.objectKey)) {
      return object;
    }
    const deletedAt = new Date().toISOString();
    return { ...object, clientUpdatedAt: deletedAt, deletedAt };
  });
  const objects = await writeSyncObjects(user.id, normalizedObjects);
  const hasConflict = objects.some((item) => !item.accepted);
  return NextResponse.json({ objects, conflict: hasConflict }, { status: hasConflict ? 409 : 200 });
}
