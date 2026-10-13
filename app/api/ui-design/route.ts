import { NextResponse } from "next/server";
import { publishedDesignState } from "@/lib/uiDesignPublished";

export const dynamic = "force-dynamic";
export async function GET() {
  try { return NextResponse.json(await publishedDesignState(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    console.error("Published UI design read failed", error);
    return NextResponse.json({ error: "网站设计暂时无法读取。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
