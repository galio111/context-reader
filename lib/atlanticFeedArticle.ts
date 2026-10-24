import { JSDOM } from "jsdom";
import { fetchRemoteDocument } from "@/lib/overseasFetch";
import { readResponseText } from "@/lib/safeRemoteFetch";

const FEED_URL = "https://www.theatlantic.com/feed/all/";
const ATOM = "http://www.w3.org/2005/Atom";
const MEDIA = "http://search.yahoo.com/mrss/";

function articleKey(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["theatlantic.com", "www.theatlantic.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    return url.pathname.replace(/\/$/, "");
  } catch { return null; }
}

/** Only publisher-delivered Atom content, matched to the exact original article. */
export function atlanticArticleFromFeed(xml: string, articleUrl: string): string | null {
  const key = articleKey(articleUrl);
  if (!key) return null;
  let feed: JSDOM;
  try { feed = new JSDOM(xml, { contentType: "text/xml" }); } catch { return null; }
  try {
    for (const entry of feed.window.document.getElementsByTagNameNS(ATOM, "entry")) {
      const link = [...entry.getElementsByTagNameNS(ATOM, "link")].find((node) => !node.getAttribute("rel") || node.getAttribute("rel") === "alternate");
      if (articleKey(link?.getAttribute("href") || "") !== key) continue;
      const content = entry.getElementsByTagNameNS(ATOM, "content")[0];
      if (content?.getAttribute("type") !== "html") return null;
      const page = new JSDOM("<!doctype html><html lang='en'><head></head><body><article data-article-body></article></body></html>", { url: articleUrl });
      try {
        const doc = page.window.document;
        const article = doc.querySelector("article")!;
        article.innerHTML = content.textContent || "";
        // Never execute active feed markup or treat a subscription teaser as a full article.
        article.querySelectorAll("script, style, iframe, object, embed, form").forEach((node) => node.remove());
        const text = article.textContent || "";
        if ((text.match(/\b[a-zA-Z]+\b/g) || []).length < 401 || /subscribe to (?:continue|keep) reading|read the (?:full|rest of the) (?:article|story) (?:at|on)|this (?:is|was) (?:an? )?(?:excerpt|preview)\b/i.test(text)) return null;
        doc.title = entry.getElementsByTagNameNS(ATOM, "title")[0]?.textContent || "The Atlantic";
        const title = doc.createElement("h1"); title.textContent = doc.title; article.prepend(title);
        for (const [name, value] of [
          ["og:title", doc.title],
          ["og:image", entry.getElementsByTagNameNS(MEDIA, "content")[0]?.getAttribute("url") || ""],
          ["article:published_time", entry.getElementsByTagNameNS(ATOM, "published")[0]?.textContent || entry.getElementsByTagNameNS(ATOM, "updated")[0]?.textContent || ""],
        ]) {
          if (!value) continue;
          const meta = doc.createElement("meta"); meta.setAttribute("property", name); meta.content = value; doc.head.append(meta);
        }
        return page.serialize();
      } finally { page.window.close(); }
    }
    return null;
  } finally { feed.window.close(); }
}

export async function fetchAtlanticFeedArticle(url: URL, signal?: AbortSignal): Promise<string | null> {
  if (!articleKey(url.toString()) || !/\/\d{6,}\/?$/.test(url.pathname)) return null;
  try {
    const remote = await fetchRemoteDocument(FEED_URL, {}, { mode: "feed", signal, maxBytes: 1_200_000 });
    if (!remote.response.ok) { await remote.response.body?.cancel(); return null; }
    return atlanticArticleFromFeed(await readResponseText(remote.response, 1_200_000), url.toString());
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}
