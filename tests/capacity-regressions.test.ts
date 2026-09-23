import assert from "node:assert/strict";
import { test } from "node:test";
import { BoundedAsyncCache } from "../lib/boundedAsyncCache";
import { acquireAiSlot, acquireCostSlot, acquireCostSlotWithWait } from "../lib/costConcurrency";
import { publicArticleSummary } from "../lib/publicArticleSummary";
import { orderHomepageRecommendations, orderHomepageCategoryArticles } from "../lib/homepageRecommendations";
import { emptyRecommendationPreferences } from "../lib/recommendationPreferences";
import type { PublicArticle } from "../types/publicArticle";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("capacity cache coalesces a burst, does not cache failures, expires and bounds memory", async () => {
  const cache = new BoundedAsyncCache<string>(15, 2, 20);
  let calls = 0;
  const load = async () => { calls++; await sleep(2); return "small"; };
  assert.deepEqual(await Promise.all(Array.from({ length: 100 }, () => cache.get("a", load))), Array(100).fill("small"));
  assert.equal(calls, 1);
  await sleep(20); await cache.get("a", load); assert.equal(calls, 2);
  await assert.rejects(cache.get("error", async () => { throw Error("database unavailable"); }));
  assert.equal(await cache.get("error", async () => "recovered"), "recovered");
  await cache.get("large", async () => "x".repeat(100));
  assert.equal(await cache.get("large", async () => "new"), "new");
  await cache.get("b", async () => "b"); await cache.get("c", async () => "c");
  assert.equal(await cache.get("a", async () => "reloaded"), "reloaded");
});

test("publish/delete invalidation cannot be undone by an older in-flight read", async () => {
  const cache = new BoundedAsyncCache<string>(1_000, 4, 100);
  let finish!: (value: string) => void;
  const old = cache.get("article", () => new Promise<string>(resolve => { finish = resolve; }));
  await Promise.resolve(); cache.clear();
  assert.equal(await cache.get("article", async () => "new revision"), "new revision");
  finish("old revision"); await old;
  assert.equal(await cache.get("article", async () => "wrong"), "new revision");
});

test("AI admission uses FIFO handoff, bounded waiting and cancellation without slot leaks", async () => {
  const bucket = "capacity-fifo";
  const first = acquireCostSlot(bucket, 1)!;
  const cancelled = new AbortController();
  const a = acquireCostSlotWithWait(bucket, 1, { timeoutMs: 100, signal: cancelled.signal });
  const b = acquireCostSlotWithWait(bucket, 1, { timeoutMs: 100, maxQueued: 2 });
  assert.equal(await acquireCostSlotWithWait(bucket, 1, { timeoutMs: 100, maxQueued: 2 }), null);
  cancelled.abort(); assert.equal(await a, null);
  first(); const release = await b; assert.ok(release);
  assert.equal(acquireCostSlot(bucket, 1), null);
  release(); release();
  const next = acquireCostSlot(bucket, 1); assert.ok(next);
  assert.equal(await acquireCostSlotWithWait(bucket, 1, { timeoutMs: 5 }), null);
  next();
  const afterTimeout = acquireCostSlot(bucket, 1); assert.ok(afterTimeout); afterTimeout();
});

test("1000 DAU admission profile: 4 long requests cannot exclude 12 simultaneous lookups", async () => {
  const original = process.env.AI_MAX_CONCURRENCY;
  process.env.AI_MAX_CONCURRENCY = "16";
  const controller = new AbortController();
  const releases: (() => void)[] = [];
  try {
    for (let i = 0; i < 4; i++) { const release = await acquireAiSlot(controller.signal, true); assert.ok(release); releases.push(release); }
    const backgroundAbort = new AbortController();
    const fifth = acquireAiSlot(backgroundAbort.signal, true);
    for (let i = 0; i < 12; i++) { const release = await acquireAiSlot(controller.signal); assert.ok(release); releases.push(release); }
    backgroundAbort.abort(); assert.equal(await fifth, null);
    const queued = acquireAiSlot(controller.signal);
    releases.pop()!(); const admitted = await queued; assert.ok(admitted); releases.push(admitted);
  } finally {
    releases.forEach(release => release());
    if (original === undefined) delete process.env.AI_MAX_CONCURRENCY; else process.env.AI_MAX_CONCURRENCY = original;
  }
});

test("compact catalogue preserves article identity, preference/category order and Admin originals", () => {
  const articles: PublicArticle[] = ["科技科学", "文化历史", "商业经济"].map((topic, i) => ({
    id: `${i}`, title: `Article ${i}`, summary: "Reader visible summary", body: "private detail payload",
    sourceUrl: `https://example.org/${i}`, sourceName: "Source", createdAt: "2026-09-22", updatedAt: "2026-09-22",
    recommendation: { coverImageUrl: `https://example.org/${i}.webp`, coverPreviewDataUrl: "data:image/webp;base64,UklGRg==", difficulty: "CET-6 / 考研", cefr: "B2", audienceStages: ["CET-6"], topics: [topic], wordCount: 800, timeliness: "evergreen", sourceKind: "crawler", classificationSource: "manual", reviewNotes: "Admin evidence ".repeat(500) },
  } as PublicArticle));
  const compact = articles.map(publicArticleSummary);
  const preferences = emptyRecommendationPreferences();
  assert.deepEqual(orderHomepageRecommendations(compact, undefined, preferences, "2026-09-22").map(a => a.id), orderHomepageRecommendations(articles, undefined, preferences, "2026-09-22").map(a => a.id));
  assert.deepEqual(orderHomepageCategoryArticles(compact, ["2", "0"]).map(a => a.id), orderHomepageCategoryArticles(articles, ["2", "0"]).map(a => a.id));
  for (let i = 0; i < articles.length; i++) {
    assert.equal(compact[i].summary, articles[i].summary);
    assert.deepEqual(compact[i].recommendation?.topics, articles[i].recommendation?.topics);
    assert.equal(compact[i].recommendation?.coverPreviewDataUrl, articles[i].recommendation?.coverPreviewDataUrl);
    assert.equal(compact[i].recommendation?.reviewNotes, undefined);
    assert.ok(articles[i].recommendation?.reviewNotes);
    assert.equal(compact[i].body, "");
  }
  assert.ok(JSON.stringify(compact).length < JSON.stringify(articles).length / 4);
});
