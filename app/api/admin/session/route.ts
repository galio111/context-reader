import { NextResponse } from "next/server";
import { getAdminAccessMode } from "@/lib/adminAuth";

export async function GET() {
  const accessMode = await getAdminAccessMode();
  return NextResponse.json(
    { authenticated: Boolean(accessMode), accessMode },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
