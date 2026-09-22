import test from "node:test";
import assert from "node:assert/strict";
import { buildUsageReport, reportWindow, usageCost, type ReportAction, type ReportExecution } from "../lib/adminUsageReport";
const now = new Date("2026-09-22T12:00:00Z");
const window = reportWindow(new URLSearchParams(), now);
const action: ReportAction = { id: "a", user_id: "u", feature: "word_explanation", quota_units: 1, status: "succeeded", created_at: "2026-09-22T01:00:00.000Z" };
const execution = (extra: Partial<ReportExecution> = {}): ReportExecution => ({ id: "e", action_id: "a", provider: "deepseek", model: "deepseek-flash", route: "/api/explain-word-stream", prompt_tokens: 1000, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 0, completion_tokens: 100, status: "succeeded", created_at: "2026-09-22T01:01:00.000Z", ...extra });
test("Shanghai windows include midnight, exclude next midnight and reject impossible dates", () => {
  assert.equal(window.start, "2026-09-21T16:00:00.000Z");
  assert.equal(reportWindow(new URLSearchParams("period=yesterday"), now).end, window.start);
  assert.equal(reportWindow(new URLSearchParams("period=7"), now).days.length, 7);
  assert.throws(() => reportWindow(new URLSearchParams("period=date&date=2026-02-31"), now));
  assert.throws(() => reportWindow(new URLSearchParams("period=date&date=2026-09-23"), now));
  const report = buildUsageReport([execution({ created_at: window.start }), execution({ created_at: window.end })], [], window);
  assert.equal(report.total.calls, 1);
});
test("fallback attempts cost separately but charge one user action; every breakdown reconciles", () => {
  const report = buildUsageReport([execution({ status: "failed" }), execution({ id: "fallback", provider: "zhipu", model: "glm-4.5-air" })], [action], window);
  assert.equal(report.total.calls, 2); assert.equal(report.total.failed, 1); assert.equal(report.total.chargedActions, 1);
  assert.equal(report.models.length, 2);
  for (const groups of [report.features, report.models, report.accounts, report.daily, report.sources]) assert.equal(groups.reduce((s, g) => s + g.costMicrocny, 0), report.total.costMicrocny);
  assert.equal(report.features.find(f => f.key === "reader:word_explanation")!.children.length, 2);
});
test("MiMo charges all input when the recorder defaulted cache miss to zero", () => {
  assert.equal(usageCost(execution({ model: "mimo-v2.6-flash", provider: "mimo" })), 1200);
  assert.equal(usageCost(execution({ model: "mimo-v2.6-flash", prompt_cache_hit_tokens: 500 })), 710);
  assert.equal(usageCost(execution({ model: "unpriced-new-model" })), null);
  assert.equal(usageCost(execution({ prompt_tokens: 0, completion_tokens: 0, status: "failed" })), null);
});
test("cached action and background probe never invent model calls or user charges", () => {
  const probe = { ...action, id: "p", user_id: null, owner_key: "system:model_connection_test", feature: "model_connection_test", metric_key: "system_ai", quota_units: 0 };
  const report = buildUsageReport([execution({ action_id: "p", usage_actions: probe, route: "/api/admin/models" })], [{ ...action, status: "cached", cache_hit: true, quota_units: 0 }, probe], window);
  assert.equal(report.total.calls, 1); assert.equal(report.total.chargedActions, 0); assert.equal(report.total.cacheHits, 1);
  assert.equal(report.accounts[0].calls, 0); assert.equal(report.sources.find(s => s.key === "system")!.calls, 1);
  const reader = buildUsageReport([execution({ usage_actions: probe })], [action, probe], { ...window, scope: "reader" });
  assert.equal(reader.total.calls, 0); assert.equal(reader.total.actions, 1);
});
test("cross-day action join preserves account attribution without counting yesterday's action today", () => {
  const old = { ...action, created_at: "2026-09-20T00:00:00.000Z" };
  const report = buildUsageReport([execution({ usage_actions: old })], [], window);
  assert.equal(report.total.actions, 0); assert.equal(report.accounts[0].key, "u");
  assert.equal(report.features[0].label, "划词解释");
});
test("classification actions and executions share one feature; no lost unmatched calls", () => {
  const a = { ...action, feature: "article_classification", owner_key: "system:article_classification", user_id: null };
  const report = buildUsageReport([execution({ usage_actions: a, route: "/api/admin/article-classification" }), execution({ action_id: "missing", id: "missing", model: "unknown" })], [a], window);
  assert.equal(report.features.find(f => f.key === "system:classification")!.actions, 1);
  assert.equal(report.total.unknownCost, 1); assert.equal(report.sources.find(s => s.key === "unclassified")!.calls, 1);
});
test("recent record cap does not cap costs and supports unknown costs", () => {
  const report = buildUsageReport(Array.from({ length: 205 }, (_, i) => execution({ id: String(i) })), [action], window);
  assert.equal(report.details.length, 200); assert.equal(report.detailsTruncated, true); assert.equal(report.total.calls, 205);
  assert.equal(report.total.costMicrocny, usageCost(execution())! * 205);
});
