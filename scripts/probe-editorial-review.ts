/** Bounded paid model probe; no article/setting writes. Usage logging is best-effort. */
import { readFile, writeFile } from "node:fs/promises";
import { classifyArticle } from "../lib/articleClassification";
import { reviewEditorialArticle } from "../lib/editorialReview";
import type { ImportedArticle } from "../types/article";
async function main() {
  for (const file of process.argv.slice(2)) {
    const data = JSON.parse(await readFile(file, "utf8")) as { article: ImportedArticle };
    const classification = await classifyArticle(data.article.title, data.article.text, { fullTextReview: true, discoveryReview: true, model: "deepseek-flash", sourceUrl: data.article.url, imageDescriptions: data.article.blocks.filter((b) => b.type === "image").map((b) => b.alt).join("; ") });
    const review = await reviewEditorialArticle(data.article, { enabled: true, provider: "deepseek", jevMonthlyBudgetUsd: 4, dailyReviewLimit: 90 });
    const result = { file, classification, review };
    await writeFile(file.replace(/\.json$/, "-review.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ file, difficulty: classification.difficulty, confidence: classification.difficultyEvidence.confidence, eligible: classification.qualityReview?.eligible, review }));
  }
}
void main();
