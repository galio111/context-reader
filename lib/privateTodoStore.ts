import "server-only";
import { accountFetch } from "@/lib/accountStore";
import type { PrivateTodoSnapshot, PrivateTodoState } from "@/lib/privateTodoState";

export async function readPrivateTodo(ownerId: string): Promise<PrivateTodoSnapshot | null> {
  const rows = await accountFetch<PrivateTodoSnapshot[]>(
    "personal_todo_workspace?select=revision,state&owner_id=eq." + encodeURIComponent(ownerId) + "&limit=1",
  );
  return rows[0] ?? null;
}

export async function updatePrivateTodo(ownerId: string, revision: number, state: PrivateTodoState): Promise<PrivateTodoSnapshot | null> {
  const rows = await accountFetch<PrivateTodoSnapshot[]>(
    "personal_todo_workspace?select=revision,state&owner_id=eq." + encodeURIComponent(ownerId) + "&revision=eq." + revision,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ revision: revision + 1, state }) },
  );
  return rows[0] ?? null;
}
