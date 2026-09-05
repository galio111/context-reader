import { NextResponse } from "next/server";
import sharp from "sharp";
import { isAdminRequest } from "@/lib/adminAuth";
import { readJsonBody } from "@/lib/limitedBody";
import { DAY_KEY, SITE_KEY, getDiscoverySites, readDiscoverySetting, writeDiscoverySetting, validateSite, withDiscoveryLease, type DiscoverySite } from "@/lib/discoveryStore";
import { importArticleThroughApi } from "@/lib/recommendationCrawler";
import { listArticleCandidates } from "@/lib/publicArticles";
import { readSourceFeed } from "@/lib/recommendationFeed";
import { readResponseBytes, safeRemoteFetch } from "@/lib/safeRemoteFetch";
import { requestExternalOrigin } from "@/lib/requestSecurity";
import { shanghaiDay, hasRecentPublishingCadence, minimumDiscoveryWords } from "@/lib/discoveryPolicy";
import { runConfiguredRecommendationAutomation } from "@/lib/recommendationAutomation";
export const maxDuration = 900;
export async function GET() {
  if (!await isAdminRequest()) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  const sites = await getDiscoverySites();
  const empty = { day: shanghaiDay(), sites: {} };
  const day = await readDiscoverySetting(DAY_KEY, empty);
  const rejected = (await listArticleCandidates({ includeRejected: true })).filter((a) => a.recommendation?.rejectedAt && a.recommendation.rejectionReason);
  const feedback = Object.fromEntries(sites.map((site) => [site.id, rejected.filter((a) => a.recommendation?.discoverySourceId === site.id || (() => { try { return new URL(a.sourceUrl).hostname.replace(/^www\./, "") === site.articleHosts[0]; } catch { return false; } })()).slice(0, 10).map((a) => ({ title: a.title, reason: a.recommendation!.rejectionReason! }))]));
  return NextResponse.json({ sites, day: day.day === empty.day ? day : empty, feedback }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!await isAdminRequest()) return NextResponse.json({ error: "需要管理员权限。" }, { status: 401 });
  if (request.headers.get("origin") !== requestExternalOrigin(request)) return NextResponse.json({ error: "请从本站后台操作。" }, { status: 403 });
  const body = await readJsonBody<{ action?: string; id?: string; site?: DiscoverySite }>(request, 24_000).catch(() => null);
  if (!body) return NextResponse.json({ error: "设置格式无效。" }, { status: 400 });
  try {
    if (body.action === "run") return NextResponse.json(await runConfiguredRecommendationAutomation(requestExternalOrigin(request), "manual", new Date(), body.id));
    return await withDiscoveryLease(async () => {
      const sites = await getDiscoverySites();
      let site = sites.find((item) => item.id === body.id);
      if (body.action === "delete") {
        if (!site) throw new Error("网站不存在。");
        await writeDiscoverySetting(SITE_KEY, sites.filter((s) => s.id !== body.id));
        return NextResponse.json({ ok: true });
      }
      if (body.action === "save" && body.site) {
        const incoming = validateSite(body.site);
        site = sites.find((item) => item.id === incoming.id);
        if (sites.some((item) => item.id !== incoming.id && item.articleHosts[0] === incoming.articleHosts[0])) throw new Error("这个网站已经存在，请修改原网站，避免重复计算每日额度。");
        const unchanged = site && JSON.stringify([site.feeds, site.articleHosts, site.discovery, site.articlePath]) === JSON.stringify([incoming.feeds, incoming.articleHosts, incoming.discovery, incoming.articlePath]);
        // Verification is server-owned; editing a source address invalidates it.
        incoming.verification = unchanged ? site!.verification : undefined;
        incoming.articlePath = unchanged ? site!.articlePath : undefined;
        if (!unchanged && incoming.discovery !== "feed") throw new Error("新增网站请使用 RSS/Atom 地址；没有订阅的复杂列表需要专门适配。");
        if (incoming.enabled && (!incoming.verification?.ok || Date.now() - Date.parse(incoming.verification.at) > 7 * 86400_000)) throw new Error("请先保存为停用状态，验证正文、图片与近期更新，再启用网站。");
        if (incoming.articleHosts[0] === "sciencedaily.com" && incoming.enabled) throw new Error("该来源公开声明不允许转载全文，暂不启用自动收录。");
        if (!site && sites.length >= 60) throw new Error("最多配置 60 个网站。");
        await writeDiscoverySetting(SITE_KEY, site ? sites.map((s) => s.id === incoming.id ? incoming : s) : [...sites, incoming]);
        return NextResponse.json({ ok: true });
      }
      if (body.action !== "verify" || !site) throw new Error("请选择有效网站和操作。");
      const verification: NonNullable<DiscoverySite["verification"]> = { at: new Date().toISOString(), ok: false, message: "", samples: [] };
      try {
        const feeds = await Promise.all(site.feeds.map((feedUrl) => readSourceFeed({ ...site!, feedUrl }, site!.topics[0]).catch(() => [])));
        const items = [...new Map(feeds.flat().map((item) => [item.url, item])).values()].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
        if (!items.length) throw new Error("没有读到文章列表，可能被拒绝访问、订阅失效或需要专门适配。");
        const recentCadence = hasRecentPublishingCadence(items.map((item) => item.publishedAt));
        for (const item of items.filter((item) => !item.publishedAt || Date.parse(item.publishedAt) <= Date.now()).slice(0, 4)) {
          if (verification.samples.length >= 2) break;
          try {
            const imported = await importArticleThroughApi(requestExternalOrigin(request), item.url);
            const article = imported.article!;
            const words = (article.text.match(/\b[a-zA-Z]+\b/g) ?? []).length;
            if (words < minimumDiscoveryWords(site.levelHint) || imported.metadata?.intakeWarnings?.length) continue;
            const image = article.blocks.find((block) => block.type === "image" && block.src && !/logo|icon|avatar|banner/i.test(block.src));
            const imageUrl = image?.src || imported.metadata?.coverCandidates?.find((url) => !/logo|icon|avatar|banner/i.test(url));
            if (!imageUrl) continue;
            const response = await safeRemoteFetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
            if (!response.ok) continue;
            const metadata = await sharp(await readResponseBytes(response, 5_000_000), { limitInputPixels: 40_000_000 }).metadata();
            if ((metadata.width || 0) < 300 || (metadata.height || 0) < 150) continue;
            verification.samples.push({ url: item.url, title: article.title, words, images: article.blocks.filter((b) => b.type === "image").length || 1, preview: article.text.slice(0, 600) });
          } catch { /* Try a different article; no access-control bypass. */ }
        }
        verification.ok = verification.samples.length >= 2 && recentCadence;
        verification.message = !recentCadence ? "近期更新频率未达日更或每 2–3 天更新：保留为备选，不计入日常来源。"
          : verification.samples.length < 2 ? "近期有更新，但未找到两篇正文完整且图片可读取的样本，暂不启用。"
          : "近期通常 1–3 天更新、最近 3 天有新作；两篇正文与图片可读取。启用前请检查下方正文样本。";
      } catch (error) { verification.message = error instanceof Error ? error.message.slice(0, 200) : "验证暂时失败。"; }
      await writeDiscoverySetting(SITE_KEY, sites.map((s) => s.id === site!.id ? { ...s, enabled: verification.ok ? s.enabled : false, verification } : s));
      return NextResponse.json({ verification });
    });
  } catch (error) {
    console.error("Discovery source operation failed", error);
    return NextResponse.json({ error: error instanceof Error && !/fetch|ECONN|postgres|supabase/i.test(error.message) ? error.message.slice(0, 200) : "网站设置暂时无法处理，请稍后重试。" }, { status: 400 });
  }
}
