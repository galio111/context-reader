import { estimateDeepSeekCostMicrocny, shanghaiUsageWindow } from "./usageCost";

export type UsageScope = "all" | "reader" | "system" | "unclassified";
export interface ReportAction {
  id: string; user_id?: string | null; guest_id?: string | null; owner_key?: string;
  feature?: string; metric_key?: string; quota_units?: number; status?: string;
  cache_hit?: boolean; created_at?: string;
}
export interface ReportExecution {
  id: string; action_id: string; provider?: string; model?: string; route?: string;
  prompt_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number;
  completion_tokens?: number; status?: string; created_at: string; error_code?: string;
  usage_actions?: ReportAction | null;
}
export interface UsageTotals {
  calls: number; failed: number; cancelled: number; input: number; output: number;
  cacheTokens: number; costMicrocny: number; unknownCost: number;
  actions: number; chargedActions: number; quotaUnits: number; cacheHits: number;
}
export interface UsageGroup extends UsageTotals { key: string; label: string; scope: UsageScope; children: UsageGroup[] }
export const REPORT_FEATURES: Record<string, string> = {
  word_explanation: "划词解释", standalone_dictionary: "单独查词", sentence_question: "句子追问",
  article_summary: "文章摘要", full_article_translation: "全文翻译", guest_text_import: "粘贴导入（游客）",
  guest_url_import: "网址导入（游客）", editorial_review: "自动精选审核", model_connection_test: "模型连接测试",
  classification: "文章分类与难度", crawler: "候选采集分析", other: "其他调用",
};
const routeFeatures: Record<string, string> = {
  "/api/explain-word": "word_explanation", "/api/explain-word-stream": "word_explanation",
  "/api/dictionary": "standalone_dictionary", "/api/dictionary-stream": "standalone_dictionary",
  "/api/ask-sentence": "sentence_question", "/api/translate-article": "full_article_translation",
  "/api/summarize-article": "article_summary", "/api/admin/models": "model_connection_test",
  "/api/admin/article-classification": "classification", "/api/admin/article-crawler": "crawler",
  "/api/cron/recommendations": "editorial_review",
};
export function reportWindow(params: URLSearchParams, now = new Date()) {
  const window = shanghaiUsageWindow(now, 30);
  const period = params.get("period") || "today";
  if (!["today", "yesterday", "7", "30", "date"].includes(period)) throw Error("请选择有效的统计时间。");
  const date = period === "date" ? params.get("date") || "" : window.dayKeys[period === "yesterday" ? 1 : 0];
  if (!window.dayKeys.includes(date)) throw Error("请选择最近 30 个上海自然日内的日期。");
  const days = period === "7" ? window.dayKeys.slice(0, 7) : period === "30" ? window.dayKeys : [date];
  const start = new Date(`${days.at(-1)}T00:00:00+08:00`).toISOString();
  const end = new Date(Math.min(Date.parse(`${days[0]}T00:00:00+08:00`) + 86400000, now.getTime())).toISOString();
  const scope = params.get("scope") || "all";
  if (!["all", "reader", "system", "unclassified"].includes(scope)) throw Error("请选择有效的费用来源。");
  return { period, scope: scope as UsageScope, start, end, days, today: window.dayKeys[0], oldest: window.dayKeys.at(-1)! };
}
export function usageCost(row: ReportExecution): number | null {
  const model = row.model || "";
  // Unknown model families must never fall through to Pro pricing.
  if (!/^(deepseek-flash|deepseek-v4-flash|deepseek-v4-pro|deepseek-chat|glm-4\.5-air|mimo-v2\.6-flash|jev-latest|typesafe-ai\/jev)$/.test(model)) return null;
  const input = Math.max(0, Number(row.prompt_tokens) || 0);
  const output = Math.max(0, Number(row.completion_tokens) || 0);
  if (!input && !output) return null; // Historic recorder used zero for absent usage.
  const hit = Math.min(input, Math.max(0, Number(row.prompt_cache_hit_tokens) || 0));
  return estimateDeepSeekCostMicrocny(model, {
    prompt_tokens: input, prompt_cache_hit_tokens: hit, prompt_cache_miss_tokens: input - hit,
    completion_tokens: output,
  }, new Date(row.created_at));
}
function scopeFor(action?: ReportAction | null, route = ""): UsageScope {
  if (action?.owner_key?.startsWith("system:") || action?.metric_key === "system_ai" || /^\/api\/(admin|cron)\//.test(route)) return "system";
  if (action?.user_id || action?.guest_id || action?.owner_key?.startsWith("guest:")) return "reader";
  return "unclassified";
}
function featureFor(action?: ReportAction | null, route = "") {
  const aliases: Record<string,string> = { article_classification: "classification" };
  const key = action?.feature ? aliases[action.feature] || action.feature : routeFeatures[route] || "other";
  return { key, label: REPORT_FEATURES[key] || `其他：${key}` };
}
export const emptyUsageTotals = (): UsageTotals => ({ calls: 0, failed: 0, cancelled: 0, input: 0, output: 0, cacheTokens: 0, costMicrocny: 0, unknownCost: 0, actions: 0, chargedActions: 0, quotaUnits: 0, cacheHits: 0 });
export function buildUsageReport(executions: ReportExecution[], actions: ReportAction[], window: ReturnType<typeof reportWindow>) {
  const total = emptyUsageTotals();
  const features = new Map<string, UsageGroup>(), models = new Map<string, UsageGroup>(), accounts = new Map<string, UsageGroup>(), days = new Map<string, UsageGroup>();
  const sources = new Map<string, UsageGroup>();
  const actionMap = new Map(actions.map(a => [a.id, a]));
  const get = (map: Map<string, UsageGroup>, key: string, label: string, scope: UsageScope) => {
    if (!map.has(key)) map.set(key, { ...emptyUsageTotals(), key, label, scope, children: [] });
    return map.get(key)!;
  };
  if (window.scope === "all" || window.scope === "reader") for (const key of ["word_explanation", "standalone_dictionary", "sentence_question", "article_summary", "full_article_translation"]) get(features, `reader:${key}`, REPORT_FEATURES[key], "reader");
  for (const day of window.days) get(days, day, day, "all");
  const inWindow = (at?: string) => Boolean(at && Date.parse(at) >= Date.parse(window.start) && Date.parse(at) < Date.parse(window.end));
  const details: Array<{ id: string; at: string; feature: string; model: string; userId: string; scope: UsageScope; status: string; input: number; output: number; costMicrocny: number | null }> = [];
  for (const row of executions) {
    if (!inWindow(row.created_at)) continue;
    const action = row.usage_actions || actionMap.get(row.action_id);
    const scope = scopeFor(action, row.route);
    if (window.scope !== "all" && window.scope !== scope) continue;
    const feature = featureFor(action, row.route);
    const model = `${row.provider || "未记录供应商"} / ${row.model || "未记录模型"}`;
    const cost = usageCost(row);
    const f = get(features, `${scope}:${feature.key}`, feature.label, scope);
    const m = get(models, model, model, "all");
    let child = f.children.find(c => c.key === model);
    if (!child) { child = { ...emptyUsageTotals(), key: model, label: model, scope, children: [] }; f.children.push(child); }
    const day = new Date(Date.parse(row.created_at) + 8 * 3600000).toISOString().slice(0, 10);
    const targets: UsageTotals[] = [total, f, m, child, get(days, day, day, "all"), get(sources, scope, scope, scope)];
    if (scope === "reader" && action?.user_id) targets.push(get(accounts, action.user_id, action.user_id, "reader"));
    for (const t of targets) {
      t.calls++; t.failed += Number(row.status === "failed"); t.cancelled += Number(row.status === "cancelled");
      t.input += Math.max(0, Number(row.prompt_tokens) || 0); t.output += Math.max(0, Number(row.completion_tokens) || 0);
      t.cacheTokens += Math.min(Math.max(0, Number(row.prompt_tokens) || 0), Math.max(0, Number(row.prompt_cache_hit_tokens) || 0));
      if (cost === null) t.unknownCost++; else t.costMicrocny += cost;
    }
    if (details.length < 200) details.push({ id: row.id, at: row.created_at, feature: feature.label, model, userId: action?.user_id || "", scope, status: row.status || "unknown", input: Number(row.prompt_tokens) || 0, output: Number(row.completion_tokens) || 0, costMicrocny: cost });
  }
  for (const action of actions) {
    if (!inWindow(action.created_at)) continue;
    const scope = scopeFor(action);
    if (window.scope !== "all" && window.scope !== scope) continue;
    const feature = featureFor(action);
    const f = get(features, `${scope}:${feature.key}`, feature.label, scope);
    const targets: UsageTotals[] = [total, f, get(sources, scope, scope, scope)];
    if (scope === "reader" && action.user_id) targets.push(get(accounts, action.user_id, action.user_id, "reader"));
    for (const t of targets) {
      t.actions++; t.cacheHits += Number(action.cache_hit === true || action.status === "cached");
      if (["succeeded", "cached"].includes(action.status || "") && Number(action.quota_units) > 0) { t.chargedActions++; t.quotaUnits += Number(action.quota_units); }
    }
  }
  const sorted = (map: Map<string, UsageGroup>) => [...map.values()].sort((a, b) => b.costMicrocny - a.costMicrocny || b.calls - a.calls);
  return { window, total, features: sorted(features), models: sorted(models), accounts: sorted(accounts), sources: sorted(sources), daily: [...days.values()], details, detailsTruncated: total.calls > details.length };
}
export type AdminUsageReport = ReturnType<typeof buildUsageReport> & { truncated: boolean; loadedAt: string };
