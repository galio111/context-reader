import { readResponseText } from "./safeRemoteFetch";
import type { KnowledgeSource } from "./documentKnowledge";

export function parseWebSources(data: unknown): KnowledgeSource[] {
  const rows = (data as { results?: unknown[] })?.results;
  const sources = new Map<string, KnowledgeSource>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const item = row as Record<string, unknown>;
    if (!item || typeof item.title !== "string" || typeof item.url !== "string" || (typeof item.summary !== "string" && typeof item.snippet !== "string")) continue;
    try {
      const url = new URL(item.url);
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) continue;
      const summary = (typeof item.summary === "string" && item.summary.trim() ? item.summary : String(item.snippet || "")).trim();
      if (!summary) continue;
      sources.set(url.href, { title: item.title.slice(0, 300), url: url.href,
        text: `${typeof item.date === 'string' ? `发布日期：${item.date.slice(0, 40)}\n` : ''}${summary.slice(0, 3000)}` });
    } catch { /* Ignore malformed provider URLs. */ }
    if (sources.size >= 5) break;
  }
  return [...sources.values()];
}

export async function searchExtensionWeb(query: string, signal?: AbortSignal) {
  const unavailable = { sources: [] as KnowledgeSource[], notice: '本次未取得联网资料，无法核实人物身份或最新事件；回答中的背景知识不代表搜索结果。' };
  // Owner approved DeepSeek metered search on 2026-11-15. Set false to disable.
  if (process.env.EXTENSION_WEB_SEARCH_ENABLED === 'false' || !process.env.DEEPSEEK_API_KEY) return unavailable;
  try {
    const response = await fetch('https://api.deepseek.com/v1/tools/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({ query: Array.from(query.trim()).slice(0, 128).join(''), count: 5, need_content: false }),
      signal: AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) return unavailable;
    const sources = parseWebSources(JSON.parse(await readResponseText(response, 256 * 1024)));
    return sources.length ? { sources, notice: `已联网搜索：${query}。以下来源为网页摘要，请打开原文核对。` } : unavailable;
  } catch { signal?.throwIfAborted(); return unavailable; }
}
