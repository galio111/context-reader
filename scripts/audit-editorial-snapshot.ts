/** Read-only model audit of an exported Admin snapshot. Never mutates article rows. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { classifyArticle } from "../lib/articleClassification";
import { reviewEditorialArticle } from "../lib/editorialReview";
import { EDITORIAL_DIFFICULTIES } from "../lib/editorialReviewPolicy";
import type { PublicArticle } from "../types/publicArticle";

async function main() {
  const [file, output, count = "12"] = process.argv.slice(2);
  if (!file || !output) throw new Error("Expected snapshot, output directory and optional count");
  const rows = (JSON.parse(await readFile(file, "utf8")) as { articles: PublicArticle[] }).articles;
  // Interleave old labels to exercise both school and adult difficulty boundaries.
  const groups = new Map<string, PublicArticle[]>();
  for (const row of rows) { const key = row.recommendation?.difficulty || "unknown"; groups.set(key, [...(groups.get(key) || []), row]); }
  const selected: PublicArticle[] = [];
  while (selected.length < Math.min(Number(count), rows.length)) {
    for (const group of groups.values()) { const row = group.shift(); if (row && selected.length < Number(count)) selected.push(row); }
  }
  await mkdir(output, { recursive: true });
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < selected.length) {
      const row = selected[cursor++];
      const path = `${output}/${row.id}.json`;
      try { await readFile(path); continue; } catch { /* resume only absent results */ }
      if (!row.importedArticle) { await writeFile(path, JSON.stringify({ id: row.id, outcome: "held", reason: "missing structured body" })); continue; }
      const article = row.importedArticle;
      const context = { fullTextReview: true, discoveryReview: true, sourceUrl: row.sourceUrl, sourceName: row.sourceName, imageDescriptions: article.blocks.filter(b => b.type === "image").map(b => b.alt || "").join("; ") };
      try {
        const first = await classifyArticle(article.title, article.text, { ...context, model: "deepseek-flash" });
        const low = !EDITORIAL_DIFFICULTIES.includes(first.difficulty);
        const classification = low || first.classificationSource !== "model" || first.difficultyEvidence.confidence !== "high"
          ? await classifyArticle(article.title, article.text, { ...context, model: "deepseek-v4-pro" }) : first;
        const confirmedLow = low && !EDITORIAL_DIFFICULTIES.includes(classification.difficulty) && classification.classificationSource === "model" && classification.difficultyEvidence.confidence === "high";
        const review = await reviewEditorialArticle(article, { enabled: true, provider: "deepseek", jevMonthlyBudgetUsd: 4, dailyReviewLimit: 90 });
        const result = { id: row.id, title: row.title, updatedAt: row.updatedAt, oldDifficulty: row.recommendation?.difficulty, first, classification, confirmedLow, review };
        await writeFile(path, JSON.stringify(result, null, 2));
        console.log(JSON.stringify({ id: row.id, title: row.title, difficulty: classification.difficulty, confirmedLow, status: review.status, completed: review.completed, defects: review.confirmedDefects, reasons: review.reasons }));
      } catch { await writeFile(path, JSON.stringify({ id: row.id, outcome: "held", reason: "audit interrupted; retry required" })); }
    }
  }));
}
void main();
