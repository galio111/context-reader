// Providers can express the same decision as an HTTP error or a finish reason.
type ProviderDecision = {
  error?: { code?: string | number; type?: string; message?: string } | null;
  choices?: Array<{ finish_reason?: string | null }>;
};

export function providerDeclinedContent(data: ProviderDecision | null): boolean {
  if (!data || typeof data !== "object") return false;
  const reason = data.choices?.[0]?.finish_reason || "";
  const error = data.error;
  return /^(content_filter|content_policy_violation|sensitive|safety)$/i.test(reason) ||
    [error?.code, error?.type].some(v => /^(content_filter|content_policy_violation|content_restricted|sensitive_content|1301)$/i.test(String(v || ""))) ||
    /不安全或敏感内容|内容安全策略|content filter(?:ing)? policy|violat(?:es|ion of).{0,24}content policy/i.test(error?.message || "");
}

export const TRANSLATION_CONTENT_RESTRICTION = {
  code: "provider_content_restricted",
  status: 422,
  error: "翻译服务因内容限制停止了本次翻译。已完成的段落会保留。",
} as const;
