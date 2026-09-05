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
if (args.includes("--shuffle")) {
  const before = (await request("/api/admin/article-candidates")).articles;
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const sameDay = (a) => new Date(Date.parse(a.createdAt) + 8 * 3600000).toISOString().slice(0, 10) === today;
  const after = (await request("/api/admin/article-candidates", { action: "shuffle" }, "PATCH")).articles;
  assert.deepEqual([...before.map((a) => a.id)].sort(), [...after.map((a) => a.id)].sort());
  assert.deepEqual(before.filter(sameDay).map((a) => a.id), after.filter(sameDay).map((a) => a.id));
  assert.ok(after.slice(0, before.filter(sameDay).length).every(sameDay));
  assert.deepEqual(after.map((a) => a.id), (await request("/api/admin/article-candidates")).articles.map((a) => a.id));
  console.log(JSON.stringify({ checks: "persistent shuffle preserves inventory and pins Shanghai today", candidates: after.length, pinned: before.filter(sameDay).length }));
}
const run = args.find((arg) => arg.startsWith("--run-source="));
if (run) {
  const result = await request(path, { action: "run", id: run.split("=")[1] });
  console.log(JSON.stringify({ skipped: result.skipped, created: result.result?.created.map((a) => ({ id: a.id, title: a.title, difficulty: a.recommendation?.difficulty, source: a.recommendation?.discoverySourceId, cover: a.recommendation?.coverImageUrl })), issues: result.result?.skipped, sourceErrors: result.result?.sourceErrors }));
}
