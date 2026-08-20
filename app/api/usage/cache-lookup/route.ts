import { NextResponse } from "next/server";
export async function POST() {
  return NextResponse.json({
    ok: true,
    actionId: "",
    counted: false,
  }, { headers: { "Cache-Control": "no-store" } });
}
