import { extractImportedArticleFromHtml } from "../lib/urlArticleExtractor";

async function main() {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("Usage: tsx scripts/audit-url-article-import.ts <url> [...urls]");
    process.exitCode = 1;
    return;
  }
  for (const rawUrl of urls) {
    try {
      const response = await fetch(rawUrl, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36",
        },
        signal: AbortSignal.timeout(20_000),
        redirect: "follow",
      });
      const html = await response.text();
      const result = response.ok ? extractImportedArticleFromHtml(html, response.url || rawUrl) : null;
      const blocks = result?.article.blocks ?? [];
      console.log(JSON.stringify({
        requestedUrl: rawUrl,
        resolvedUrl: response.url,
        status: response.status,
        title: result?.article.title ?? "",
        siteName: result?.article.siteName ?? "",
        textCharacters: result?.article.text.length ?? 0,
        blockTypes: blocks.reduce<Record<string, number>>((counts, block) => {
          counts[block.type] = (counts[block.type] ?? 0) + 1;
          return counts;
        }, {}),
        firstBlocks: blocks.slice(0, 4).map((block) => ({ type: block.type, text: block.text?.slice(0, 160) ?? "", src: block.src ?? "" })),
        lastBlocks: blocks.slice(-4).map((block) => ({ type: block.type, text: block.text?.slice(0, 160) ?? "", src: block.src ?? "" })),
      }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ requestedUrl: rawUrl, error: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    }
  }
}

void main();
