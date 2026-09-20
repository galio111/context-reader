import { test } from "node:test";
import assert from "node:assert/strict";
import { applyEditorialRepair, repairEditorialArticle } from "../lib/editorialRepair";
import { editorialDailyReport } from "../lib/editorialReport";
import type { ImportedArticle } from "../types/article";
import type { PublicArticle } from "../types/publicArticle";
const prose = "This is substantive independent reporting about people and the natural world. ".repeat(45);
const article: ImportedArticle = { title: "Example", url: "https://example.org/a", siteName: "Example", text: prose + "\nSubscribe to our newsletter.", blocks: [{ id: "p", type: "paragraph", text: prose }, { id: "ad", type: "paragraph", text: "Subscribe to our newsletter." }, { id: "end", type: "paragraph", text: "The final substantive paragraph must remain intact." }, { id: "img", type: "image", src: "https://example.org/photo.jpg", alt: "Article illustration" }] };
const proposal = { uncertain: false, remove: [{ id: "ad", text: "Subscribe to our newsletter.", category: "newsletter", reason: "standalone signup" }] };
test("repair removes agreed middle furniture while retaining exact prose, end, images and IDs", () => {
  const result = applyEditorialRepair(article, proposal, proposal);
  assert.equal(result.removed.length, 1);
  assert.deepEqual(result.article.blocks, article.blocks.filter((b) => b.id !== "ad"));
  assert.ok(result.article.text.includes("final substantive paragraph"));
  assert.ok(!result.article.text.includes("Subscribe"));
});
test("disagreement, uncertainty, invented text and excessive deletion cannot modify content", () => {
  for (const bad of [{ uncertain: true, remove: proposal.remove }, { uncertain: false, remove: [] }, { uncertain: false, remove: [{ ...proposal.remove[0], text: "invented" }] }]) assert.equal(applyEditorialRepair(article, proposal, bad).article, article);
  const excessive = { uncertain: false, remove: [{ ...proposal.remove[0], id: "p", text: prose }] };
  assert.equal(applyEditorialRepair(article, excessive, excessive).article, article);
});
test("repair cannot delete images, captions or quotations to hide defects", () => {
  for (const type of ["image", "caption", "quote", "table"] as const) {
    const copy = { ...article, blocks: article.blocks.map((b) => b.id === "ad" ? { ...b, type } : b) };
    assert.equal(applyEditorialRepair(copy, proposal, proposal).article, copy);
  }
});
test("failed repair preserves original and never supplies an approval", async () => {
  const result = await repairEditorialArticle(article, async () => { throw new Error("provider unavailable"); });
  assert.equal(result.article, article); assert.equal(result.evidence, undefined);
});
test("email reports exact published counts, zero categories, primary topics and difficulties", () => {
  const rows = [{ title: "One", sourceUrl: "https://example.org/a", recommendation: { difficulty: "CET-6 / 考研", topics: ["商业经济", "社会生活"] } }] as PublicArticle[];
  const report = editorialDailyReport("2026-09-20", rows, 3, false);
  assert.match(report.subject, /未达标 1\/30/);
  assert.match(report.text, /商业：1 篇/); assert.match(report.text, /科学：0 篇/);
  assert.match(report.text, /商业经济：1 篇/); assert.match(report.text, /社会生活：0 篇/);
  assert.match(report.text, /CET-6 \/ 考研：1 篇/);
});
