import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import { privateTodoAccess, todoAccessFailure, todoPrivateHeaders, todoResponse } from "@/lib/privateTodoAccess";
import { readPrivateTodo, updatePrivateTodo } from "@/lib/privateTodoStore";
import { isPrivateTodoState } from "@/lib/privateTodoState";
import { readJsonBody, RequestBodyTooLargeError } from "@/lib/limitedBody";

export const dynamic = "force-dynamic";

export async function HEAD() {
  const access = await privateTodoAccess();
  const status = access.kind === "owner" ? 204 : todoAccessFailure(access.kind).status;
  return new NextResponse(null, { status, headers: todoPrivateHeaders });
}

export async function GET() {
  const access = await privateTodoAccess();
  if (access.kind !== "owner") return todoAccessFailure(access.kind);
  try {
    const snapshot = await readPrivateTodo(access.id);
    return snapshot ? todoResponse(snapshot) : todoAccessFailure("unavailable");
  } catch {
    return todoAccessFailure("unavailable");
  }
}

export async function PUT(request: Request) {
  const access = await privateTodoAccess();
  if (access.kind !== "owner") return todoAccessFailure(access.kind);
  let input: unknown;
  try {
    input = await readJsonBody(request, 4 * 1024 * 1024);
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? todoResponse({ error: "待办记录超出单次保存上限。" }, 413)
      : todoResponse({ error: "待办格式无效。" }, 400);
  }
  if (!input || typeof input !== "object" || !("revision" in input) || !("state" in input)
    || typeof input.revision !== "number" || !Number.isSafeInteger(input.revision) || input.revision < 0
    || !isPrivateTodoState(input.state)) return todoResponse({ error: "请检查待办日期、分类与提醒设置。" }, 400);
  try {
    const saved = await updatePrivateTodo(access.id, input.revision, input.state);
    if (saved) return todoResponse(saved);
    const current = await readPrivateTodo(access.id);
    if (!current) return todoAccessFailure("unavailable");
    if (current.revision === input.revision + 1 && isDeepStrictEqual(current.state, input.state)) return todoResponse(current);
    return todoResponse({ error: "另一处已更新待办。", ...current }, 409);
  } catch {
    return todoAccessFailure("unavailable");
  }
}
