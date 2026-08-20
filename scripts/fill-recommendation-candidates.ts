import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { runRecommendationCrawler } = await import("../lib/recommendationCrawler");
  const { listArticleCandidates } = await import("../lib/publicArticles");
  const { ARTICLE_TOPICS } = await import("../types/publicArticle");

  const targetTotal = Math.max(1, Number.parseInt(process.argv[2] || "50", 10));
  const origin = (process.argv[3] || "http://127.0.0.1:3000").replace(/\/$/, "");
  const maxRuns = Math.max(ARTICLE_TOPICS.length, Number.parseInt(process.argv[4] || "48", 10));

  let candidates = await listArticleCandidates();
  let runCount = 0;
  let consecutiveEmptyRuns = 0;

  console.log(JSON.stringify({
    event: "start",
    targetTotal,
    currentTotal: candidates.length,
    origin,
  }));

  while (candidates.length < targetTotal && runCount < maxRuns && consecutiveEmptyRuns < ARTICLE_TOPICS.length * 2) {
    const topic = ARTICLE_TOPICS[runCount % ARTICLE_TOPICS.length];
    const result = await runRecommendationCrawler(
      {
        topic,
        difficulty: "any",
        targetInventory: 30,
        maxNewArticles: Math.min(2, targetTotal - candidates.length),
        inventoryScope: "candidates",
      },
      origin,
    );

    runCount += 1;
    consecutiveEmptyRuns = result.created.length === 0 ? consecutiveEmptyRuns + 1 : 0;
    candidates = await listArticleCandidates();

    console.log(JSON.stringify({
      event: "run",
      runCount,
      topic,
      created: result.created.length,
      total: candidates.length,
      attempted: result.attempted,
      skipped: result.skipped.length,
      sourceErrors: result.sourceErrors.map((item) => item.sourceName),
    }));
  }

  console.log(JSON.stringify({
    event: "finish",
    targetTotal,
    total: candidates.length,
    runCount,
    stoppedAfterEmptyRuns: consecutiveEmptyRuns,
  }));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
