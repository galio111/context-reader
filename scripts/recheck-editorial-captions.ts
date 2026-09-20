/** Re-run ambiguous caption findings against actual images; no article writes. */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { reviewEditorialArticle } from "../lib/editorialReview";
import type { PublicArticle } from "../types/publicArticle";
async function main() {
  const [snapshot, directory] = process.argv.slice(2);
  const rows = new Map((JSON.parse(await readFile(snapshot, "utf8")).articles as PublicArticle[]).map(row => [row.id, row]));
  const files = await readdir(directory);
  let cursor = 0;
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (cursor < files.length) {
      const path = `${directory}/${files[cursor++]}`;
      const result = JSON.parse(await readFile(path, "utf8"));
      if (result.captionPairingRechecked || !result.review?.checks?.orphanCaption) continue;
      const row = rows.get(result.id);
      if (!row?.importedArticle) continue;
      const review = await reviewEditorialArticle(row.importedArticle, { enabled: true, provider: "deepseek", jevMonthlyBudgetUsd: 4, dailyReviewLimit: 90 }, { forceCaptionPairing: true });
      result.previousReview = result.review;
      result.review = review;
      result.captionPairingRechecked = true;
      await writeFile(path, JSON.stringify(result, null, 2));
      console.log(JSON.stringify({ id: row.id, title: row.title, status: review.status, completed: review.completed, defects: review.confirmedDefects, reasons: review.reasons }));
    }
  }));
}
void main();
