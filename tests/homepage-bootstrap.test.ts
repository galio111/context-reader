import test from "node:test";
import assert from "node:assert/strict";
import { homepageBootstrap } from "../lib/homepageBootstrap";
import { normalizeHomepageCuration, HOME_CURATION_CATEGORIES } from "../lib/homepageCurationShared";
import { homepageShowcaseArticles, orderHomepageCategoryArticles, orderHomepageRecommendations } from "../lib/homepageRecommendations";
import { articleMatchesEditorialCategory } from "../lib/editorialCuration";
import { emptyRecommendationPreferences } from "../lib/recommendationPreferences";
import type { PublicArticle } from "../types/publicArticle";

test("bootstrap keeps every category's desktop/mobile showcase, full counts and source data intact", () => {
  const articles = Array.from({ length: 180 }, (_, i) => ({
    id: `article-${i}`, title: `Article ${i}`, summary: `Searchable summary ${i}`, body: "",
    sourceName: "Source", sourceUrl: `https://example.org/${i}`, createdAt: "2026-09-22", updatedAt: "2026-09-22",
    recommendation: { difficulty: "高中 / CET-4", cefr: "B2", timeliness: "evergreen", sourceKind: "manual-url", classificationSource: "manual", coverImageUrl: i % 7 ? `https://example.org/${i}.webp` : "", audienceStages: [], topics: [], homepageCategory: HOME_CURATION_CATEGORIES[1 + i % 4] as "时事" | "科技" | "文化" | "商业", wordCount: 800 },
  } as PublicArticle));
  const snapshot = JSON.stringify(articles);
  const curation = normalizeHomepageCuration({ version: 2, categories: { 推荐: articles.slice(15).reverse().map(a => a.id), 科技: ["article-77", "article-1"] }, recommendationFeaturedId: "article-179", selectedAtById: { "article-77": "2026-09-22T00:00:00Z" } });
  const bootstrap = homepageBootstrap(articles, curation, "2026-09-22");
  assert.equal(bootstrap.complete, false);
  assert.ok(bootstrap.articles.length <= 50);
  const ordered = (input: PublicArticle[], category: typeof HOME_CURATION_CATEGORIES[number]) => category === "推荐"
    ? orderHomepageRecommendations(input, curation, emptyRecommendationPreferences(), "2026-09-22")
    : orderHomepageCategoryArticles(input.filter(a => articleMatchesEditorialCategory(a, category)), curation.categories[category], curation.selectedAtById, "2026-09-22");
  for (const category of HOME_CURATION_CATEGORIES) {
    const full = ordered(articles, category);
    assert.equal(bootstrap.counts[category], full.length);
    for (const limit of [7, 10]) assert.deepEqual(homepageShowcaseArticles(ordered(bootstrap.articles, category), limit).map(a => a.id), homepageShowcaseArticles(full, limit).map(a => a.id));
  }
  for (const article of bootstrap.articles) assert.strictEqual(article, articles.find(a => a.id === article.id));
  assert.equal(JSON.stringify(articles), snapshot);
});

test("empty/small catalogues need no redundant completion fetch", () => {
  assert.equal(homepageBootstrap([], undefined, "2026-09-22").complete, true);
  const article = { id: "one", title: "One", summary: "Original", body: "", recommendation: { difficulty: "高中 / CET-4", cefr: "B2", timeliness: "evergreen", sourceKind: "manual-url", classificationSource: "manual", coverImageUrl: "https://example.org/cover.webp", topics: [], audienceStages: [] } } as unknown as PublicArticle;
  assert.deepEqual(homepageBootstrap([article], undefined, "2026-09-22").articles, [article]);
  assert.equal(homepageBootstrap([article], undefined, "2026-09-22").complete, true);
});
