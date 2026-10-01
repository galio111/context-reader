import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/userAuth";
import papersData from "@/data/cet/catalog.json";
import { readCetPaperWithOverrides } from "@/lib/cetPaperOverrides";
import type { CetPaper } from "@/types/cet";
import { CET_GUEST_PREVIEW_COUNT } from "@/lib/cetGuestPreview";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const user = await getAuthenticatedUser().catch(() => null);
  const all = (papersData as CetPaper[])
    .slice()
    .sort((a, b) => b.year - a.year || b.month - a.month || a.set - b.set);
  const visible = user
    ? all
    : [4, 6].flatMap((level) =>
        all.filter((p) => p.level === level).slice(0, CET_GUEST_PREVIEW_COUNT),
      );
  const id = params.get("id");
  if (id) {
    const item = visible.find((p) => p.id === id);
    if (!item)
      return NextResponse.json(
        { error: user ? "未找到这份试卷。" : "请登录后查看这份试卷。" },
        { status: user ? 404 : 401 },
      );
    const { paper } = await readCetPaperWithOverrides(item.id);
    paper.sections = paper.sections.map((section) => {
      const metadata = item.sections.find((candidate) => candidate.id === section.id);
      return { ...section, materialId: metadata?.materialId, questionSetId: metadata?.questionSetId };
    });
    return NextResponse.json(
      { paper },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const level = Number(params.get("level")) === 6 ? 6 : 4;
  const year = Number(params.get("year")),
    page = Math.max(0, Math.min(100, Number(params.get("page")) || 0));
  const filtered = visible.filter(
    (p) => p.level === level && (!year || p.year === year),
  );
  return NextResponse.json(
    {
      papers: filtered.slice(page * 12, page * 12 + 12),
      total: filtered.length,
      years: [
        ...new Set(visible.filter((p) => p.level === level).map((p) => p.year)),
      ],
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
