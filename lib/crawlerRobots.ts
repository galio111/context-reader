import robotsParser from "robots-parser";
import { safeRemoteFetch, readResponseText } from "@/lib/safeRemoteFetch";
const cache = new Map<string, { at: number; text: string }>();
const nextAllowedAt = new Map<string, number>();
const AGENT = "ContextReaderRecommendationCrawler";
export async function assertCrawlerAllowed(url: string): Promise<void> {
  const robotsUrl = new URL("/robots.txt", url).href;
  let entry = cache.get(robotsUrl);
  if (!entry || Date.now() - entry.at > 300_000) {
    const response = await safeRemoteFetch(robotsUrl, { headers: { "User-Agent": AGENT + "/2.0 (+https://context-reader.com)" }, signal: AbortSignal.timeout(12_000) });
    if (!response.ok && response.status !== 404) throw new Error("暂时无法确认网站的自动抓取规则，未继续读取");
    entry = { at: Date.now(), text: response.status === 404 ? "" : await readResponseText(response, 256_000) };
    if (/<html|<!doctype html/i.test(entry.text)) throw new Error("网站返回验证页面，未继续自动抓取");
    if (cache.size > 100) cache.clear();
    cache.set(robotsUrl, entry);
  }
  const robots = robotsParser(robotsUrl, entry.text);
  if (robots.isDisallowed(url, AGENT)) throw new Error("网站 robots.txt 不允许自动抓取此地址");
  // Sites with long requested delays need a separate pacing adapter.
  if ((robots.getCrawlDelay(AGENT) ?? 0) > 5) throw new Error("网站要求较长抓取间隔，需要单独适配后启用");
  const readyAt = Math.max(Date.now(), nextAllowedAt.get(robotsUrl) || 0);
  nextAllowedAt.set(robotsUrl, readyAt + Math.max(1000, (robots.getCrawlDelay(AGENT) || 0) * 1000));
  if (readyAt > Date.now()) await new Promise((resolve) => setTimeout(resolve, readyAt - Date.now()));
}
