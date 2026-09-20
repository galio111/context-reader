/** Offline snapshot evaluation only: no article writes, publication or restoration. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { repairEditorialArticle } from "../lib/editorialRepair";
import { reviewEditorialArticle } from "../lib/editorialReview";
import type { PublicArticle } from "../types/publicArticle";
async function main() {
  const [snapshot, output, ...ids] = process.argv.slice(2);
  const rows = (JSON.parse(await readFile(snapshot, "utf8")) as { articles: PublicArticle[] }).articles;
  await mkdir(output, { recursive: true });
  for (const id of ids) {
    const row = rows.find((r) => r.id === id);
    if (!row?.importedArticle) throw new Error(`Missing fixture ${id}`);
    const repaired = await repairEditorialArticle(row.importedArticle);
    const review = await reviewEditorialArticle(repaired.article, { enabled: true, provider: "deepseek", jevMonthlyBudgetUsd: 0, dailyReviewLimit: 90 });
    await writeFile(`${output}/${id}.json`, JSON.stringify({ id, title: row.title, before: row.importedArticle, after: repaired.article, evidence: repaired.evidence, review }, null, 2));
    console.log(JSON.stringify({ id, title: row.title, removed: repaired.evidence?.removed, status: review.status, reasons: review.reasons }));
  }
}
void main();
