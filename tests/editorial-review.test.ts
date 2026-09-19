import { test } from "node:test";
import assert from "node:assert/strict";
import { EDITORIAL_DIFFICULTIES, editorialChunks, parseEditorialDecisions, editorialStructureFailures, editorialBalanceScore } from "../lib/editorialReviewPolicy";
import { editorialContentHash, reviewEditorialArticle } from "../lib/editorialReview";
import { eligibleEditorialCandidate } from "../lib/editorialRunner";
import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";
import type { ImportedArticle } from "../types/article";
import type { PublicArticle } from "../types/publicArticle";

const article: ImportedArticle = { title: "A real article", url: "https://example.com/article", text: "A complete paragraph.", siteName: "Example", blocks: [{ id: "p1", type: "paragraph", text: "A complete paragraph." }, { id: "i1", type: "image", src: "https://example.com/photo.webp", alt: "A photo" }] };
test("full review keeps middle sections and last blocks", () => {
  const copy = { ...article, blocks: Array.from({ length: 20 }, (_, i) => ({ id: String(i), type: "paragraph" as const, text: `MARKER_${i} ` + "test ".repeat(400) })) };
  const joined = editorialChunks(copy, 6000).join("");
  for (let i = 0; i < 20; i++) assert.ok(joined.includes(`MARKER_${i} `));
});
test("missing or stringified booleans never pass review", () => {
  assert.throws(() => parseEditorialDecisions({ incomplete: false }));
  assert.throws(() => parseEditorialDecisions({ incomplete: false, contamination: "false", orphanCaption: false, mediaDependent: false, promotional: false }));
  assert.deepEqual(Object.values(parseEditorialDecisions({ incomplete: false, contamination: false, orphanCaption: false, mediaDependent: false, promotional: false })), [false, false, false, false, false]);
});
test("school labels remain excluded from the daily automated pool", () => {
  for (const difficulty of ["小学高年级", "初中", "高中 / CET-4"]) assert.ok(!EDITORIAL_DIFFICULTIES.includes(difficulty as typeof EDITORIAL_DIFFICULTIES[number]));
});
test("hash binds title, full text and images but not mutable recommendation metadata", () => {
  assert.notEqual(editorialContentHash(article), editorialContentHash({ ...article, text: "Edited" }));
  assert.notEqual(editorialContentHash(article), editorialContentHash({ ...article, blocks: article.blocks.slice(0, 1) }));
  assert.equal(editorialContentHash(article), editorialContentHash({ ...article, recommendation: {} as never }));
});
test("post-review edits and rejected candidates cannot auto-publish", () => {
  const meta = { sourceKind: "crawler", difficulty: "CET-6 / 考研", editorialReview: { version: 1, status: "passed", checkedAt: new Date().toISOString(), contentHash: editorialContentHash(article) } };
  const row = { importedArticle: article, recommendation: meta } as PublicArticle;
  assert.equal(eligibleEditorialCandidate(row), true);
  assert.equal(eligibleEditorialCandidate({ ...row, importedArticle: { ...article, text: "Changed" } }), false);
  assert.equal(eligibleEditorialCandidate({ ...row, recommendation: { ...row.recommendation!, rejectedAt: new Date().toISOString() } }), false);
});
test("structure catches missing images and duplicate block identities", () => {
  assert.ok(editorialStructureFailures({ ...article, blocks: [...article.blocks, { id: "p1", type: "image" }] }).length >= 2);
});
test("balance penalizes overrepresented topics and sources", () => {
  const recent = [{ recommendation: { topics: ["科技科学"], difficulty: "CET-6 / 考研", discoverySourceId: "a" } }] as PublicArticle[];
  assert.ok(editorialBalanceScore("故事文学", "雅思 / 托福进阶", "b", recent) > editorialBalanceScore("科技科学", "CET-6 / 考研", "a", recent));
});
test("Nautilus newsletter and embedded-video labels do not become prose", () => {
  const text = "This is substantive independent reporting about the natural world and the people who study it. ".repeat(30);
  const extracted = extractImportedArticleFromHtml(`<html><title>Example</title><body><article><h1>Example</h1><p>${text}</p><div>Featured Video</div><p>The real final paragraph is preserved.</p><p>Enjoying Nautilus? Subscribe to our free newsletter.</p><p>Lead Image: Photographer</p></article></body></html>`, "https://nautil.us/example");
  assert.ok(extracted);
  assert.ok(extracted.article.text.includes("real final paragraph"));
  assert.doesNotMatch(extracted.article.text, /Featured Video|Enjoying Nautilus|Lead Image/);
});

const config = { enabled: true, provider: "jev-shadow" as const, jevMonthlyBudgetUsd: 4, dailyReviewLimit: 90 };
const clean = { incomplete: false, contamination: false, orphanCaption: false, mediaDependent: false, promotional: false };
const complete = async () => ({ parsed: { checks: clean, uncertain: false, relevant: true }, usage: { prompt_tokens: 10, completion_tokens: 5 }, cost: 1 });
test("Jev outage or reservation failure falls back to full DeepSeek audit", async () => {
  const previous = process.env.AI_GATEWAY_API_KEY;
  process.env.AI_GATEWAY_API_KEY = "test-only";
  try {
    for (const budgetFails of [false, true]) {
      const review = await reviewEditorialArticle(article, config, { complete, reserve: async () => { if (budgetFails) throw new Error("budget storage unavailable"); return true; }, jev: (async () => { throw new Error("401 or timeout"); }) as never });
      assert.equal(review.status, "passed");
      assert.equal(review.provider, "deepseek-fallback");
      assert.equal(review.inputTokens, 20);
    }
  } finally { if (previous === undefined) delete process.env.AI_GATEWAY_API_KEY; else process.env.AI_GATEWAY_API_KEY = previous; }
});
test("DeepSeek failure never turns into automatic approval", async () => {
  const review = await reviewEditorialArticle(article, { ...config, provider: "deepseek" }, { complete: async () => { throw new Error("unavailable"); } });
  assert.equal(review.status, "held");
  assert.ok(review.reasons.length);
});
test("uncertain Flash decisions require Pro and unresolved uncertainty stays held", async () => {
  const calls: string[] = [];
  const review = await reviewEditorialArticle(article, { ...config, provider: "deepseek" }, { complete: async (_prompt, model) => { calls.push(model); return { ...await complete(), parsed: { checks: clean, uncertain: true, relevant: true } }; } });
  assert.ok(calls.includes("deepseek-v4-pro"));
  assert.equal(review.status, "held");
});

test("public reload preserves reviewed CEFR instead of remapping it from the old label", async () => {
  const { listPublicArticles } = await import("../lib/publicArticles");
  const savedFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL; const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  globalThis.fetch = async () => new Response(JSON.stringify([{ id: "test", title: "Test", summary: "Test", body: "Text", source_url: "", source_name: "Test", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), recommendation: { difficulty: "CET-6 / 考研", cefr: "B2", classificationSource: "model", topics: ["文化历史"], editorialReview: { version: 1 } } }]), { status: 200 });
  try { assert.equal((await listPublicArticles())[0].recommendation?.cefr, "B2"); }
  finally { globalThis.fetch = savedFetch; if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; }
});

test("publication rechecks a fresh rejection before touching images or published rows", async () => {
  const { publishArticleCandidate } = await import("../lib/publicArticles");
  const savedFetch=globalThis.fetch;const oldUrl=process.env.SUPABASE_URL;const oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://example.invalid";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only";
  let calls=0;
  const recommendation={sourceKind:"crawler",difficulty:"CET-6 / 考研",topics:[],rejectedAt:new Date().toISOString(),editorialReview:{version:1,status:"passed",checkedAt:new Date().toISOString(),contentHash:editorialContentHash(article)}};
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify([{id:"test",title:article.title,summary:"Test",body:article.text,source_url:article.url,source_name:"Example",imported_article:{...article,recommendation},created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]));};
  try {await assert.rejects(publishArticleCandidate("test",{expectedEditorialHash:editorialContentHash(article)}));assert.equal(calls,1);}
  finally {globalThis.fetch=savedFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});
