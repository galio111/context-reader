import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { accountFetch } from "@/lib/accountStore";
import { validateCetParagraphEdit } from "@/lib/cetPaperFormatting";
import type { CetPaper } from "@/types/cet";

interface CetPaperOverrideRow {
  paper_id: string;
  paragraphs: Record<string, string[]>;
  updated_at: string;
}

export async function readBaseCetPaper(id: string): Promise<CetPaper> {
  if (!/^cet[46]-\d{4}-\d{2}-[1-3]$/.test(id)) throw new Error("Invalid CET paper id.");
  return JSON.parse(await readFile(path.join(process.cwd(), "data", "cet", `${id}.json`), "utf8")) as CetPaper;
}

export async function readCetPaperOverride(id: string): Promise<CetPaperOverrideRow | null> {
  const rows = await accountFetch<CetPaperOverrideRow[]>(
    `cet_paper_overrides?select=paper_id,paragraphs,updated_at&paper_id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  return rows[0] || null;
}

export function applyCetPaperOverride(paper: CetPaper, row: CetPaperOverrideRow | null): CetPaper {
  if (!row || !row.paragraphs || typeof row.paragraphs !== "object") return paper;
  return {
    ...paper,
    sections: paper.sections.map(section => {
      const paragraphs = row.paragraphs[section.id];
      return Array.isArray(paragraphs) && paragraphs.length > 0 && paragraphs.length <= 100
        && paragraphs.every(value => typeof value === "string" && value.length > 0 && value.length <= 20_000)
        ? { ...section, paragraphs } : section;
    }),
  };
}

export async function readCetPaperWithOverrides(id: string): Promise<{paper: CetPaper; revision: string | null}> {
  const paper = await readBaseCetPaper(id);
  try {
    const override = await readCetPaperOverride(id);
    return { paper: applyCetPaperOverride(paper, override), revision: override?.updated_at || null };
  } catch (error) {
    console.error("CET paper override unavailable", { paperId: id, error });
    return { paper, revision: null };
  }
}

export async function saveCetPaperParagraphs(input: {
  paperId: string;
  sectionId: string;
  paragraphs: string[];
  expectedRevision: string | null;
}): Promise<"saved" | "conflict"> {
  const base = await readBaseCetPaper(input.paperId);
  const section = base.sections.find(section => section.id === input.sectionId);
  if (!section) throw new Error("Invalid CET section.");
  const old = await readCetPaperOverride(input.paperId);
  if ((old?.updated_at || null) !== input.expectedRevision) return "conflict";
  const original = old?.paragraphs?.[input.sectionId] || section.paragraphs;
  const validationError = validateCetParagraphEdit(original, input.paragraphs);
  if (validationError) throw new Error(validationError);
  const paragraphs = { ...(old?.paragraphs || {}), [input.sectionId]: input.paragraphs };
  if (!old) {
    const rows = await accountFetch<CetPaperOverrideRow[]>("cet_paper_overrides?on_conflict=paper_id&select=paper_id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify([{ paper_id: input.paperId, paragraphs }]),
    });
    return rows.length ? "saved" : "conflict";
  }
  const rows = await accountFetch<CetPaperOverrideRow[]>(
    `cet_paper_overrides?paper_id=eq.${encodeURIComponent(input.paperId)}&updated_at=eq.${encodeURIComponent(old.updated_at)}&select=paper_id`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ paragraphs, updated_at: new Date(Math.max(Date.now(), Date.parse(old.updated_at) + 1)).toISOString() }),
    },
  );
  return rows.length ? "saved" : "conflict";
}
