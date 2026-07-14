import { NextResponse } from "next/server";
import { signOutAuthenticatedUser } from "@/lib/userAuth";

export async function POST() {
  await signOutAuthenticatedUser();
  return NextResponse.json({ ok: true });
}
