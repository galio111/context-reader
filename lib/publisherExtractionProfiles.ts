// Narrow publisher-specific removals supplement, never weaken, the shared sanitizer.
// A new complex publisher remains disabled until its actual extraction samples pass review.
const SELECTORS: Record<string, string> = {
  "npr.org": ".story-tools, .storybyline, .story-meta, .bucketwrap, .recommendations",
  "smithsonianmag.com": ".related-articles, .article-author, .newsletter-signup, .ad-container",
  "lithub.com": ".related-posts, .author-bio, .td-post-sharing, .td_block_related_posts",
  "snexplores.org": ".glossary, .educator-resources, .related-content, .field--name-field-glossary",
  "mongabay.com": ".related-articles, .related-stories, .article-tags, .short-article-related",
  "undark.org": ".author-bio, .related-posts, .newsletter-signup",
  "knowablemagazine.org": ".related-articles, .related-content, .newsletter-signup, .republish",
  "popsci.com": ".commerce, .product-card, .buy-button, .related-posts, .jw-player",
  "econlib.org": ".comment-list, .econlog-related-posts, .newsletter-signup",
  "knowledge.wharton.upenn.edu": ".related-content, .related-articles, .podcast-subscribe",
  "aeon.co": "[data-testid='related-content'], .newsletter-signup",
  "psyche.co": "[data-testid='related-content'], .newsletter-signup",
  "publicdomainreview.org": ".related-content, .shop-promo",
  "archives.gov": ".entry-footer, .sharedaddy, .jp-relatedposts",
  "learnenglish.britishcouncil.org": ".field--name-field-embed, .field--name-field-exercises, .field--name-field-preparation, .field--name-field-worksheet, .field--name-field-discussion, .comment-wrapper",
  "newsinlevels.com": ".test-your-english, .related-posts, .app-promo",
  "themarginalian.org": "#donation, #newsletter, #end_print, #amazon-notice, .donate, .donation, .newsletter",
  "oecdecoscope.blog": ".wp-block-jetpack-subscriptions, .jetpack-subscribe-modal, .wp-block-post-terms",
  "news.crunchbase.com": ".post-tags, .entry-tags, .mks_author_widget, .related-posts",
};
export function publisherIntakeWarnings(document: Document): string[] {
  const warnings: string[] = [];
  if ([...document.querySelectorAll('script[type="application/ld+json"]')].some((s) => /"isAccessibleForFree"\s*:\s*(?:false|"false")/.test(s.textContent || ""))) warnings.push("页面标记正文需要订阅");
  if ([...document.querySelectorAll("p,span,small,div")].some((node) => node.children.length === 0 && /^(?:sponsored(?: content| post| by .{1,80})?|paid content|advertorial|partner content|brand studio)$/i.test(node.textContent?.trim() || ""))) warnings.push("页面包含赞助或付费推广标记");
  return warnings;
}
export function applyPublisherProfile(document: Document, baseUrl: string): void {
  const host = new URL(baseUrl).hostname.replace(/^www\./, "");
  if (host === "levelread.com" && new URL(baseUrl).pathname.startsWith("/news/")) {
    const root = document.querySelector("article");
    const reading = root?.querySelector(".space-y-8");
    if (reading && (reading.textContent || "").length > 400) {
      const article = document.createElement("article");
      const heading = root?.querySelector("h1");
      const cover = root?.querySelector("img");
      if (heading) article.append(heading.cloneNode(true));
      if (cover) article.append(cover.cloneNode(true));
      for (const paragraph of reading.children) {
        const p = document.createElement("p");
        p.textContent = paragraph.textContent;
        article.append(p);
      }
      document.body.replaceChildren(article);
      return;
    }
  }
  if (host === "news.mongabay.com") {
    // "byline-<author>" is a WordPress taxonomy on the full article, not an author card.
    document.querySelectorAll("article[id^='post-']").forEach((article) => {
      article.className = article.className.split(/\s+/).filter((name) => !name.startsWith("byline-")).join(" ");
    });
    document.querySelectorAll("#single-article-footer, #series--description-container").forEach((node) => node.remove());
    document.querySelectorAll("article p").forEach((node) => { if (/^(?:FEEDBACK:|Related (?:story|reading|article))/i.test(node.textContent?.trim() || "")) node.remove(); });
  }
  for (const [domain, selector] of Object.entries(SELECTORS)) {
    if (host === domain || host.endsWith("." + domain)) document.querySelectorAll(selector).forEach((element) => element.remove());
  }
  if (host === "breakingnewsenglish.com") {
    const reading = document.querySelector(".lesson-excerpt article");
    if (reading && (reading.textContent || "").length > 400) {
      document.body.replaceChildren(reading.cloneNode(true));
      return;
    }
    const nodes = [...document.querySelectorAll("h2,h3,h4,p")];
    const start = nodes.findIndex((node) => /The Reading\s*\/\s*Listening/i.test(node.textContent || ""));
    if (start < 0) return;
    const article = document.createElement("article");
    for (const node of nodes.slice(start + 1)) {
      const text = node.textContent?.trim() || "";
      if (node.tagName !== "P" || /^(?:Try the same|Sources|Make sure|Warm-ups)/i.test(text)) break;
      if (text.length > 80) article.appendChild(node.cloneNode(true));
    }
    if ((article.textContent || "").length > 400) document.body.replaceChildren(article);
  }
  if (host === "newsinlevels.com") {
    const reading = document.querySelector("#nContent");
    if (reading) {
      const article = document.createElement("article");
      article.innerHTML = reading.innerHTML;
      article.querySelectorAll("p").forEach((p) => { if (/^(?:Difficult words:|You can watch)/i.test(p.textContent?.trim() || "")) p.remove(); });
      document.body.replaceChildren(article);
      return;
    }
    for (const node of document.querySelectorAll("h2,h3,h4,p")) {
      if (/^(?:LEARN 3000 WORDS|How to improve your English|You can watch the video|Difficult words:)/i.test(node.textContent?.trim() || "")) {
        // Remove only the matching instructional block. The generic boundary
        // sanitizer and quality reviewer still check its surrounding container.
        node.remove();
      }
    }
  }
  if (host === "popsci.com") {
    for (const heading of document.querySelectorAll("h2,h3")) {
      if (/Popular Science Home of the Future Awards/i.test(heading.textContent || "")) {
        const promotion = heading.parentElement?.parentElement;
        if (promotion && (promotion.textContent || "").length < 1000) promotion.remove();
      }
    }
  }
  if (host === "aeon.co") {
    document.querySelectorAll("p,div,span").forEach((node) => {
      const text = node.textContent?.trim() || "";
      if (!node.children.length && (/^(?:Listen to this essay|\d+ minute listen)$/i.test(text) || (text.length < 500 && /PREFER AEON ON GOOGLE|SYNDICATE THIS ESSAY/.test(text)))) node.remove();
    });
  }
  if (host === "daily.jstor.org") document.querySelectorAll("p,span,div").forEach((node) => {
    if (/^The icon indicates free access to the linked research on JSTOR\.?$/i.test(node.textContent?.trim() || "")) node.remove();
  });
  if (host === "sciencealert.com") document.querySelectorAll("p").forEach((node) => {
    if (/^This article was fact-checked by/i.test(node.textContent?.trim() || "")) node.remove();
  });
  if (host === "blogs.lse.ac.uk") document.querySelectorAll("p").forEach((node) => {
    if (/^(?:This (?:post|article) (?:represents|gives)|Image credit:|Please read our comment)/i.test(node.textContent?.trim() || "")) node.remove();
  });
  if (host === "openculture.com") document.querySelectorAll("p").forEach((node) => {
    const text = (node.textContent || "").replaceAll("\u00ad", "");
    if (/^Colin Marshall writes about/i.test(text) || (text.length < 1000 && /Books on Cities/.test(text) && /Follow him/.test(text))) node.remove();
  });
  if (host === "oecdecoscope.blog") document.querySelectorAll("h2,h3,p").forEach((node) => {
    if (/^(?:Discover more from ECOSCOPE|Subscribe to get the latest posts sent to your email\.)$/i.test(node.textContent?.trim() || "")) node.remove();
  });
  if (host === "news.crunchbase.com") document.querySelectorAll("h2,h3,h4,p").forEach((node) => {
    const text = node.textContent?.trim() || "";
    if (/^Want to keep track of the largest startup funding deals/.test(text)) node.remove();
    if (/^Related (?:reading|Crunchbase query):$/i.test(text)) {
      if (node.nextElementSibling?.tagName === "UL") node.nextElementSibling.remove();
      node.remove();
    }
  });
}
