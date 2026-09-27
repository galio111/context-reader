import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import catalogue from "@/data/cet/catalog.json";

const papers = [4, 6].flatMap(level => catalogue.filter(p => p.level === level)
  .sort((a, b) => b.year - a.year || b.month - a.month || a.set - b.set).slice(0, 6)
  .map(p => ({id:p.id, level:p.level, year:p.year, month:p.month, set:p.set, title:p.title,
    source:p.source, status:p.status, sections:p.sections.map(s => ({id:s.id,type:s.type,title:s.title,
      materialId:s.materialId,questionSetId:s.questionSetId,questions:s.questions.map(q=>({number:q.number}))}))})));
const version = createHash("sha256").update(JSON.stringify(papers)).digest("hex").slice(0, 16);
export function GET() {
  return NextResponse.json({papers,version}, {headers:{"Cache-Control":"public, max-age=60, must-revalidate"}});
}
