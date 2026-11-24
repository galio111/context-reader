import type { Metadata } from "next";
import PrivateTodoWorkspace from "@/components/todo/PrivateTodoWorkspace";
import { PrivateTodoLogin } from "@/components/todo/PrivateTodoLogin";
import { privateTodoAccess } from "@/lib/privateTodoAccess";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "私人待办 · Context Reader", robots: { index: false, follow: false } };

export default async function TodoPage() {
  const access = await privateTodoAccess(false);
  if (access.kind !== "owner") return <PrivateTodoLogin access={access.kind} />;
  return <PrivateTodoWorkspace />;
}
