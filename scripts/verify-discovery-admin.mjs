// Authenticated smoke checks. Read-only unless an explicit mutation flag is supplied.
// Credentials come only from the process environment; never print response headers.
import assert from "node:assert/strict";
const origin = process.env.DISCOVERY_QA_ORIGIN || "https://context-reader.com";
const args = process.argv.slice(2);
const login = await fetch(origin + "/api/admin/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
assert.equal(login.status, 200, "Admin recovery login failed");
const cookie = login.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
assert.ok(cookie, "No admin session issued");
async function request(path, body, method = "POST") {
  const response = await fetch(origin + path, { method: body ? method : "GET", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(900_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${data.error || "operation failed"}`);
  return data;
}
const path = "/api/admin/discovery-sources";
const initial = await request(path);
assert.ok(initial.sites.length);
const anonymous = await fetch(origin + path);
assert.equal(anonymous.status, 401);
const crossOrigin = await fetch(origin + path, { method: "POST", headers: { Cookie: cookie, Origin: "https://example.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
assert.equal(crossOrigin.status, 403);
console.log(JSON.stringify({ checks: "source read, anonymous denial, cross-origin denial", sites: initial.sites.length, enabled: initial.sites.filter((s) => s.enabled).length }));

if (args.includes("--reconcile-daily-sources")) {
  const desiredIds = new Set([
    "news-crunchbase-com", "news-harvard-edu", "blogs-lse-ac-uk", "nasa-gov",
    "openculture-com", "popsci-com", "reasonstobecheerful-world", "sciencealert-com",
    "snexplores-org", "techcrunch-com", "themarginalian-org", "npr-org",
    "smithsonianmag-com", "aeon-co", "psyche-co", "daily-jstor-org", "newsforkids-net",
  ]);
  const additions = [
    { id: "npr-org", name: "NPR", feeds: ["https://feeds.npr.org/1019/rss.xml", "https://feeds.npr.org/1006/rss.xml"], articleHosts: ["npr.org"], topics: ["科技科学", "社会生活", "人物成长", "商业经济"], levelHint: "advanced", note: "综合时事、科技和商业长文；必须通过正文、图片和时效筛选。" },
    { id: "smithsonianmag-com", name: "Smithsonian Magazine", feeds: ["https://www.smithsonianmag.com/rss/latest_articles/"], articleHosts: ["smithsonianmag.com"], topics: ["自然环境", "文化历史"], levelHint: "advanced", note: "文化、历史和自然解释型文章；旅行推广区不进入正文。" },
    { id: "aeon-co", name: "Aeon", feeds: ["https://aeon.co/feed.rss"], articleHosts: ["aeon.co"], topics: ["文化历史", "社会生活", "人物成长"], levelHint: "advanced", note: "长篇解释和思想文章；约 1–3 天更新，按实际新作收录。" },
    { id: "psyche-co", name: "Psyche", feeds: ["https://psyche.co/feed.rss"], articleHosts: ["psyche.co"], topics: ["人物成长", "社会生活", "文化历史"], levelHint: "advanced", note: "心理、生活与文化长文；短于 401 词的 Notes 自动跳过。" },
    { id: "daily-jstor-org", name: "JSTOR Daily", feeds: ["https://daily.jstor.org/feed/"], articleHosts: ["daily.jstor.org"], topics: ["文化历史", "社会生活", "故事文学"], levelHint: "advanced", note: "工作日更新的历史与文化解释文章；正文可读且有封面才收录。" },
    { id: "newsforkids-net", name: "NewsForKids.net", feeds: ["https://newsforkids.net/feed/"], articleHosts: ["newsforkids.net"], topics: ["社会生活", "科技科学", "自然环境", "文化历史"], levelHint: "lower", note: "较低难度完整新闻来源；通常周二至周四更新，仍要求至少 401 词。" },
    { id: "time-com", name: "TIME", feeds: ["https://time.com/feed/"], articleHosts: ["time.com"], topics: ["社会生活", "科技科学", "文化历史", "商业经济"], levelHint: "mixed", note: "内容方向合适，但大陆生产服务器当前访问主页和 RSS 均超时；保留为待重试来源，不在无法稳定读取时启用凑数。" },
  ].map((site) => ({ ...site, feedUrl: site.feeds[0], enabled: false, dailyTarget: 2, discovery: "feed" }));

  let current = (await request(path)).sites;
  for (const addition of additions) {
    const existing = current.find((site) => site.id === addition.id);
    if (!existing) {
      await request(path, { action: "save", site: addition });
      console.log(JSON.stringify({ source: addition.name, change: "added-disabled" }));
    }
  }
  current = (await request(path)).sites;
  for (const site of current.filter((item) => item.enabled && !desiredIds.has(item.id))) {
    await request(path, { action: "save", site: { ...site, enabled: false } });
    console.log(JSON.stringify({ source: site.name, change: "disabled-after-live-audit" }));
  }

  const verifyIds = new Set(["blogs-lse-ac-uk", "snexplores-org", ...additions.filter((site) => desiredIds.has(site.id)).map((site) => site.id)]);
  for (const id of verifyIds) {
    const result = await request(path, { action: "verify", id });
    console.log(JSON.stringify({ source: id, verified: result.verification?.ok, message: result.verification?.message, samples: result.verification?.samples?.map((sample) => ({ title: sample.title, words: sample.words, images: sample.images })) }));
  }

  current = (await request(path)).sites;
  for (const site of current.filter((item) => desiredIds.has(item.id))) {
    if (!site.verification?.ok) {
      console.log(JSON.stringify({ source: site.name, change: "remains-disabled", reason: site.verification?.message || "not verified" }));
      continue;
    }
    await request(path, { action: "save", site: { ...site, enabled: true, dailyTarget: 2 } });
  }
  const finalSites = (await request(path)).sites.filter((site) => site.enabled);
  console.log(JSON.stringify({ enabled: finalSites.length, target: finalSites.reduce((total, site) => total + site.dailyTarget, 0), lower: finalSites.filter((site) => site.levelHint === "lower").length, names: finalSites.map((site) => site.name) }));
}
if (args.includes("--test-config")) {
  const site = { id: "qa-source-20260905", name: "Temporary source control verification", feedUrl: "https://example.invalid/feed", feeds: ["https://example.invalid/feed"], articleHosts: ["example.invalid"], topics: ["社会生活"], levelHint: "mixed", discovery: "feed", enabled: false, dailyTarget: 2, note: "Temporary smoke test; deleted immediately" };
  assert.ok(!initial.sites.some((s) => s.id === site.id));
  await request(path, { action: "save", site });
  try {
    await request(path, { action: "save", site: { ...site, dailyTarget: 3 } });
    assert.equal((await request(path)).sites.find((s) => s.id === site.id).dailyTarget, 3);
    await assert.rejects(request(path, { action: "save", site: { ...site, enabled: true, verification: { at: new Date().toISOString(), ok: true, message: "forged", samples: [] } } }));
  } finally { await request(path, { action: "delete", id: site.id }); }
  assert.ok(!(await request(path)).sites.some((s) => s.id === site.id));
  console.log(JSON.stringify({ checks: "add, edit daily target, reject forged verification, remove temporary site", passed: true }));
}
if (args.includes("--configure-reviewed")) {
  const reviewed = new Set(["nasa-gov", "snexplores-org", "news-mongabay-com", "sciencealert-com", "thisiscolossal-com", "electricliterature-com", "popsci-com", "breakingnewsenglish-com", "news-harvard-edu", "blogs-lse-ac-uk", "reasonstobecheerful-world", "themarginalian-org", "openculture-com", "techcrunch-com", "levelread-com", "news-crunchbase-com"]);
  reviewed.add("oecdecoscope-blog");
  for (const site of initial.sites.filter((s) => reviewed.has(s.id) && s.verification?.ok)) await request(path, { action: "save", site: { ...site, enabled: true, dailyTarget: 2 } });
  const sites = (await request(path)).sites.filter((s) => s.enabled);
  console.log(JSON.stringify({ enabled: sites.length, lower: sites.filter((s) => s.levelHint === "lower").length, target: sites.reduce((n, s) => n + s.dailyTarget, 0), names: sites.map((s) => s.name) }));
}
if (args.includes("--shuffle-published")) {
  const before = (await request("/api/admin/homepage-curation")).curation;
  const after = (await request("/api/admin/homepage-curation", { action: "shuffle-published" }, "PATCH")).curation;
  assert.deepEqual([...before.categories.推荐].sort(), [...after.categories.推荐].sort());
  assert.equal(after.categories.推荐[0] || "", after.recommendationFeaturedId);
  assert.deepEqual(after, (await request("/api/admin/homepage-curation")).curation);
  console.log(JSON.stringify({ checks: "persistent published shuffle covers five homepage categories", categories: Object.fromEntries(Object.entries(after.categories).map(([category, ids]) => [category, ids.length])), recommendationFeaturedId: after.recommendationFeaturedId }));
}
const run = args.find((arg) => arg.startsWith("--run-source="));
if (run) {
  const result = await request(path, { action: "run", id: run.split("=")[1] });
  console.log(JSON.stringify({ skipped: result.skipped, created: result.result?.created.map((a) => ({ id: a.id, title: a.title, difficulty: a.recommendation?.difficulty, source: a.recommendation?.discoverySourceId, cover: a.recommendation?.coverImageUrl })), issues: result.result?.skipped, sourceErrors: result.result?.sourceErrors }));
}
