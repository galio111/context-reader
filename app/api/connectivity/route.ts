import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      releaseId: process.env.CONTEXT_READER_RELEASE_ID || "unknown",
      parentReleaseId: process.env.CONTEXT_READER_PARENT_RELEASE_ID || "unknown",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
