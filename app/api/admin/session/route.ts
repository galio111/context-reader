import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminAuth";

export async function GET() {
  return NextResponse.json(
    { authenticated: await isAdminRequest() },
    { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
  );
}
