import { JSDOM } from "jsdom";
import { safeRemoteFetch, readResponseText } from "../lib/safeRemoteFetch";
async function main() {
  for (const url of process.argv.slice(2)) {
    try {
      const response = await safeRemoteFetch(url, { signal: AbortSignal.timeout(20_000) });
      const html = await readResponseText(response, 1_200_000);
      const document = new JSDOM(html, { url }).window.document;
      function path(node: Element) {
        const result: string[] = [];
        let current: Element | null = node;
        while (current && result.length < 3) { result.push(current.tagName.toLowerCase() + "#" + current.id + "." + current.className); current = current.parentElement; }
        return result.join(" < ");
      }
      const paragraphs = [...document.querySelectorAll("p")].filter((p) => (p.textContent?.length || 0) > 100);
      if (url.includes("levelread.com/news/")) console.log(JSON.stringify([...document.querySelectorAll("div,section,article")].filter((node) => (node.textContent?.length || 0) > 500 && !node.querySelector("h1,h2,h3")).slice(0, 8).map((node) => ({ path: path(node), html: node.innerHTML.slice(0, 1200) }))));
      if (url === "https://levelread.com/") {
        const anchor = document.querySelector('a[href*="/news/level-3/"]');
        let parent = anchor?.parentElement;
        for (let depth = 0; parent && depth < 7; depth++, parent = parent.parentElement) console.log(JSON.stringify({ depth, path: path(parent), text: parent.textContent?.slice(0, 700) }));
      }
      console.log(JSON.stringify({ url, status: response.status, paragraphs: [...paragraphs.slice(0, 3), ...paragraphs.slice(-3)].map((p) => ({ path: path(p), text: p.textContent?.slice(0, 100) })), headings: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => ({ path: path(h), text: h.textContent?.slice(0, 100) })).slice(0, 4) }));
    } catch (e) { console.log(JSON.stringify({ url, error: String(e) })); }
  }
}
void main();
