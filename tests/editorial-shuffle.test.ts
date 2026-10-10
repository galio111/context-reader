import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { finalizeEditorialShuffle } from "../lib/editorialShuffle";
import { editorialDayClosed } from "../lib/editorialRunner";
import { normalizeHomepageCuration, HOME_CURATION_CATEGORIES } from "../lib/homepageCurationShared";
import { shufflePublishedHomepageCuration } from "../lib/editorialCuration";
import type { PublicArticle } from "../types/publicArticle";

const day = "2026-10-10", now = "2026-10-10T01:00:00Z", old = "2026-10-09T01:00:00Z";
function fixture() {
  const articles = ["时事", "科技", "文化", "商业"].flatMap(category =>
    ["today1", "today2", "today3", "old1", "old2", "old3"].map(label => ({
      id: `${category}-${label}`, createdAt: label.startsWith("today") ? now : old,
      updatedAt: now, recommendation: { homepageCategory: category, autoPublishedAt: label.startsWith("today") ? now : old },
    } as PublicArticle)));
  const curation = normalizeHomepageCuration({ version: 2,
    categories: Object.fromEntries(HOME_CURATION_CATEGORIES.map(category => [category,
      articles.filter(a => category === "推荐" || a.recommendation?.homepageCategory === category).map(a => a.id)])),
    selectedAtById: Object.fromEntries(articles.map(a => [a.id, a.createdAt])),
    recommendationFeaturedId: articles[0].id,
  });
  return { articles, curation };
}

test("today and older selections both shuffle in all five categories without mixing dates or re-adding excluded recommendations", () => {
  const { articles, curation } = fixture();
  curation.categories.推荐 = curation.categories.推荐.filter(id => id !== "商业-old3");
  const next = shufflePublishedHomepageCuration(curation, articles, now, () => 0);
  for (const category of HOME_CURATION_CATEGORIES) {
    const ids = next.categories[category], previous = curation.categories[category];
    assert.deepEqual([...ids].sort(), [...previous].sort());
    const firstOld = ids.findIndex(id => id.includes("old"));
    assert.ok(ids.slice(0, firstOld).every(id => id.includes("today")));
    assert.ok(ids.slice(firstOld).every(id => id.includes("old")));
    assert.notDeepEqual(ids.filter(id => id.includes("today")), previous.filter(id => id.includes("today")));
    assert.notDeepEqual(ids.filter(id => id.includes("old")), previous.filter(id => id.includes("old")));
  }
  assert.equal(next.recommendationFeaturedId, curation.recommendationFeaturedId);
  assert.deepEqual(next.selectedAtById, curation.selectedAtById);
});

test("persistent completion survives restart, retries CAS against Admin changes and reruns only for new publications or day", async () => {
  const { articles, curation } = fixture();
  const savedFetch = globalThis.fetch, savedUrl = process.env.SUPABASE_URL, savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "http://supabase-api:8000"; process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
  const cache = mock.method(workAsyncStorage, "getStore", () => ({ incrementalCache: {} }) as never);
  let row = { value: curation, updated_at: old }, writes = 0, conflict = true;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.ok(url.pathname.endsWith("/account_settings"));
    if (init?.method === "PATCH") {
      if (conflict) {
        conflict = false;
        row.value.categories.推荐 = row.value.categories.推荐.filter(id => id !== "商业-old3");
        row.updated_at = now;
        return Response.json([]);
      }
      assert.equal(url.searchParams.get("updated_at"), `eq.${row.updated_at}`);
      row = JSON.parse(String(init.body)); writes++; return Response.json([row]);
    }
    return Response.json([structuredClone(row)]);
  };
  try {
    await finalizeEditorialShuffle(day, articles);
    assert.equal(writes, 1); assert.ok(!row.value.categories.推荐.includes("商业-old3"));
    const receipt = row.value.editorialShuffle, first = structuredClone(row);
    assert.equal(receipt?.day, day); assert.ok(receipt?.completedAt);
    await finalizeEditorialShuffle(day, [...articles].reverse());
    assert.equal(writes, 1); assert.deepEqual(row, first);
    const added = { ...articles[0], id: "new-recovery" };
    await finalizeEditorialShuffle(day, [...articles, added]);
    assert.equal(writes, 2); assert.notEqual(row.value.editorialShuffle?.publicationSignature, receipt?.publicationSignature);
    await finalizeEditorialShuffle("2026-10-11", [...articles, added]);
    assert.equal(writes, 3); assert.equal(row.value.editorialShuffle?.day, "2026-10-11");
    conflict = true;
    globalThis.fetch = async (_input, init) => Response.json(init?.method === "PATCH" ? [] : [row]);
    await assert.rejects(finalizeEditorialShuffle("2026-10-12", articles), /排序保存冲突/);
    assert.equal(row.value.editorialShuffle?.day, "2026-10-11");
  } finally {
    globalThis.fetch = savedFetch; cache.mock.restore();
    if (savedUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  }
});

test("a finished day with accepted mail still needs its shuffle; a completed day skips large inventory reads", async () => {
  let completed = false, reads = 0;
  const read = async <T>(key: string): Promise<T> => {
    reads++;
    return (key.includes("_day_") ? { finished: true, shuffleCompleted: completed } : { status: "sent" }) as T;
  };
  assert.equal(await editorialDayClosed(day, read), false); assert.equal(reads, 1);
  completed = true;
  assert.equal(await editorialDayClosed(day, read), true);
});

test("a topic's full older library survives persistence beyond the former 500-item ceiling", () => {
  const { articles, curation } = fixture();
  const oldLibrary = Array.from({ length: 1200 }, (_, index) => ({ ...articles[3], id: `old-${index}` }));
  curation.selectedAtById = Object.fromEntries(oldLibrary.map(article => [article.id, old]));
  const next = normalizeHomepageCuration(shufflePublishedHomepageCuration(curation, oldLibrary, now, () => 0));
  assert.equal(next.categories.时事.length, 1200);
  assert.equal(new Set(next.categories.时事).size, 1200);
  assert.ok(next.categories.时事.includes("old-1199"));
});
