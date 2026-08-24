import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function backendMode(): "mainland_internal" | "external_or_unverified" {
  return process.env.CONTEXT_READER_RUNTIME_MODE === "mainland"
    && process.env.SUPABASE_URL === "http://supabase-api:8000"
    ? "mainland_internal"
    : "external_or_unverified";
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      checkedAt: new Date().toISOString(),
      releaseId: process.env.CONTEXT_READER_RELEASE_ID || "unknown",
      parentReleaseId: process.env.CONTEXT_READER_PARENT_RELEASE_ID || "unknown",
      backendMode: backendMode(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );
}
