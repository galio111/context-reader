import { readResponseText } from "./safeRemoteFetch";
import type { KnowledgeSource } from "./documentKnowledge";

export function parseWebSources(data: unknown): KnowledgeSource[] {
  const rows = (data as { search_result?: unknown[] })?.search_result;
  const sources = new Map<string, KnowledgeSource>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = row as Record<string, unknown>;
    if (!item || typeof item.title !== "string" || typeof item.link !== "string" || typeof item.content !== "string") continue;
    try {
      const url = new URL(item.link);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      if (!item.content.trim()) continue;
      sources.set(url.href, { title: item.title.slice(0, 300), url: url.href,
        text: `${typeof item.publish_date === 'string' ? `发布日期：${item.publish_date.slice(0, 40)}\n` : ''}${item.content.slice(0, 3000)}` });
    } catch { /* Ignore malformed provider URLs. */ }
    if (sources.size >= 5) break;
  }
  return [...sources.values()];
}

export async function searchExtensionWeb(query: string, signal?: AbortSignal) {
  const unavailable = { sources: [] as KnowledgeSource[], notice: '本次未取得联网资料，无法核实人物身份或最新事件；回答中的背景知识不代表搜索结果。' };
  // Requires explicit operator approval for metered search before activation.
  if (process.env.EXTENSION_WEB_SEARCH_ENABLED !== 'true' || !process.env.ZHIPU_API_KEY) return unavailable;
  try {
    const response = await fetch('https://open.bigmodel.cn/api/paas/v4/web_search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ZHIPU_API_KEY}` },
      body: JSON.stringify({ search_engine: 'search_std', search_query: query.slice(0, 150), count: 5, content_size: 'medium', search_recency_filter: 'noLimit' }),
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) return unavailable;
    const sources = parseWebSources(JSON.parse(await readResponseText(response, 256 * 1024)));
    return sources.length ? { sources, notice: `已联网搜索：${query}。以下来源为网页摘要，请打开原文核对。` } : unavailable;
  } catch { signal?.throwIfAborted(); return unavailable; }
}
