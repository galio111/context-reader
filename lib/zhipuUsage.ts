import { estimateDeepSeekCostMicrocny } from "./usageCost";

export interface ZhipuExecution {
  action_id?: string; route?: string; provider?: string; model?: string;
  status?: string; error_code?: string; created_at?: string;
  prompt_tokens?: number; completion_tokens?: number;
}
export function summarizeZhipuUsage(rows: ZhipuExecution[]) {
  const calls = rows.filter(row => /^zhipu(?::|$)/i.test(row.provider || "") || /^glm-/i.test(row.model || ""));
  const sorted = [...calls].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  return {
    calls: calls.length,
    succeeded: calls.filter(row => row.status === "succeeded").length,
    failed: calls.filter(row => row.status === "failed").length,
    promptTokens: calls.reduce((sum, row) => sum + Number(row.prompt_tokens || 0), 0),
    completionTokens: calls.reduce((sum, row) => sum + Number(row.completion_tokens || 0), 0),
    estimatedCostCny: calls.reduce((sum, row) => sum + estimateDeepSeekCostMicrocny(row.model || "glm-4.5-air", row, new Date(row.created_at || 0)), 0) / 1_000_000,
    recent: sorted.slice(0, 100),
    hasMore: calls.length > 100,
  };
}
export type ZhipuUsageSummary = ReturnType<typeof summarizeZhipuUsage>;
