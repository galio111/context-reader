import { RECOMMENDATION_CRAWLER_SOURCES } from "@/lib/recommendationSources";
import type { DiscoverySite } from "@/lib/discoveryStore";
export function defaultDiscoverySites(): DiscoverySite[] {
  const groups = new Map<string, DiscoverySite>();
  for (const source of RECOMMENDATION_CRAWLER_SOURCES) {
    const host = source.articleHosts[0];
    const existing = groups.get(host);
    if (existing) {
      existing.feeds.push(source.feedUrl);
      existing.topics = [...new Set([...existing.topics, ...source.topics])];
    } else groups.set(host, { ...source, id: host.replaceAll(".", "-"), name: host === "npr.org" ? "NPR" : host === "learningenglish.voanews.com" ? "VOA Learning English" : host === "theconversation.com" ? "The Conversation" : source.name, feeds: [source.feedUrl], enabled: false, dailyTarget: 2, discovery: "feed", note: "待验证正文、图片与清洗效果，验证通过后可启用。" });
  }
  const additions: Array<[string, string, string, DiscoverySite["topics"], boolean, string?]> = [
    ["UN News", "news.un.org", "https://news.un.org/feed/subscribe/en/news/all/rss.xml", ["社会生活", "商业经济", "自然环境"], false],
    ["Asian Development Blog", "blogs.adb.org", "https://blogs.adb.org/rss.xml", ["商业经济", "社会生活"], false],
    ["Economics Observatory", "economicsobservatory.com", "https://www.economicsobservatory.com/feed", ["商业经济"], false],
    ["Inter Press Service", "ipsnews.net", "https://www.ipsnews.net/feed/", ["社会生活", "文化历史", "商业经济"], false],
    ["Japan Today", "japantoday.com", "https://japantoday.com/feed", ["社会生活", "文化历史", "商业经济"], false],
    ["OECD Ecoscope", "oecdecoscope.blog", "https://oecdecoscope.blog/feed/", ["商业经济"], false],
    ["Global Voices", "globalvoices.org", "https://globalvoices.org/feed/", ["社会生活", "文化历史"], false],
    ["Crunchbase News", "news.crunchbase.com", "https://news.crunchbase.com/feed/", ["商业经济"], false],
    ["Euronews", "euronews.com", "https://www.euronews.com/rss?level=theme&name=news", ["社会生活", "商业经济"], false],
    ["Live Science", "livescience.com", "https://www.livescience.com/feeds/all", ["科技科学", "自然环境"], false],
    ["ZME Science", "zmescience.com", "https://www.zmescience.com/feed/", ["科技科学", "自然环境"], false],
    ["New Atlas", "newatlas.com", "https://newatlas.com/index.rss", ["科技科学", "商业经济"], false],
    ["LSE Business Review", "blogs.lse.ac.uk", "https://blogs.lse.ac.uk/businessreview/feed/", ["商业经济"], false],
    ["Nieman Lab", "niemanlab.org", "https://www.niemanlab.org/feed/", ["商业经济", "社会生活"], false],
    ["TIME", "time.com", "https://time.com/feed/", ["社会生活", "科技科学", "文化历史", "商业经济"], false],
    ["The Guardian", "theguardian.com", "https://www.theguardian.com/world/rss", ["社会生活", "文化历史", "商业经济", "自然环境"], false],
    ["Harvard Gazette", "news.harvard.edu", "https://news.harvard.edu/gazette/feed/", ["社会生活", "科技科学", "文化历史"], false],
    ["Michigan News", "news.umich.edu", "https://news.umich.edu/feed/", ["社会生活", "科技科学", "商业经济"], false],
    ["Inside Climate News", "insideclimatenews.org", "https://insideclimatenews.org/feed/", ["自然环境", "社会生活"], false],
    ["Reasons to be Cheerful", "reasonstobecheerful.world", "https://reasonstobecheerful.world/feed/", ["社会生活", "文化历史"], false],
    ["The Marginalian", "themarginalian.org", "https://www.themarginalian.org/feed/", ["故事文学", "文化历史", "人物成长"], false],
    ["Open Culture", "openculture.com", "https://www.openculture.com/feed/", ["文化历史", "故事文学"], false],
    ["Fast Company", "fastcompany.com", "https://www.fastcompany.com/latest/rss", ["商业经济", "社会生活"], false],
    ["TechCrunch", "techcrunch.com", "https://techcrunch.com/feed/", ["商业经济", "科技科学"], false],
    ["The World of Chinese", "theworldofchinese.com", "https://www.theworldofchinese.com/rss/", ["文化历史", "社会生活"], false],
    ["France 24", "france24.com", "https://www.france24.com/en/rss", ["社会生活", "商业经济"], false],
    ["ScienceAlert", "sciencealert.com", "https://www.sciencealert.com/feed", ["科技科学", "自然环境"], false],
    ["Colossal", "thisiscolossal.com", "https://www.thisiscolossal.com/feed/", ["文化历史"], false],
    ["Electric Literature", "electricliterature.com", "https://electricliterature.com/feed/", ["故事文学", "文化历史"], false],
    ["ARTnews", "artnews.com", "https://www.artnews.com/feed/", ["文化历史"], false],
    ["Level Read", "levelread.com", "https://levelread.com/", ["社会生活", "科技科学", "商业经济"], true, "^/news/level-3/[^/]+/?$"],
    ["Knowable Magazine", "knowablemagazine.org", "https://knowablemagazine.org/rss", ["科技科学", "自然环境"], false],
    ["Popular Science", "popsci.com", "https://www.popsci.com/feed/", ["科技科学", "自然环境"], false],
    ["Econlib", "econlib.org", "https://www.econlib.org/feed/", ["商业经济"], false],
    ["Harvard Working Knowledge", "library.hbs.edu", "https://www.library.hbs.edu/working-knowledge", ["商业经济"], false, "^/working-knowledge/(?!collections|popular-research|about)[^/?]+$"],
    ["Knowledge at Wharton", "knowledge.wharton.upenn.edu", "https://knowledge.wharton.upenn.edu/feed/", ["商业经济"], false],
    ["British Council Magazine", "learnenglish.britishcouncil.org", "https://learnenglish.britishcouncil.org/free-resources/general/magazine-zone", ["文化历史", "社会生活"], true, "^/free-resources/general/magazine-zone/[^/?]+$"],
    ["NewsForKids.net", "newsforkids.net", "https://newsforkids.net/feed/", ["社会生活", "科技科学", "自然环境", "文化历史"], true],
    ["Breaking News English", "breakingnewsenglish.com", "https://breakingnewsenglish.com/rss.xml", ["社会生活", "商业经济", "科技科学"], true],
    ["English Online", "english-online.at", "https://www.english-online.at/", ["文化历史", "科技科学", "社会生活"], true, "^/(?!news/)[a-z-]+/[a-z0-9/-]+\\.htm$"],
    ["News in Levels", "newsinlevels.com", "https://www.newsinlevels.com/feed/", ["社会生活", "商业经济"], true],
  ];
  for (const [name, host, url, topics, lower, articlePath] of additions) groups.set(host, {
    id: host.replaceAll(".", "-"), name, articleHosts: [host], feedUrl: url, feeds: [url], topics,
    levelHint: lower ? "lower" : "mixed", enabled: false, dailyTarget: 2, discovery: articlePath ? "index" : "feed", articlePath,
    note: lower ? "专门补充较低难度；仍按实际语言分级，短讯不凑数。" : "待逐站验证，科技只接收面向普通读者的解释型内容。",
  });
  const sites = [...groups.values()];
  const pdr = sites.find((site) => site.articleHosts[0] === "publicdomainreview.org");
  if (pdr) pdr.feeds = [pdr.feedUrl = "https://publicdomainreview.org/rss.xml"];
  const science = sites.find((site) => site.articleHosts[0] === "sciencedaily.com");
  if (science) science.note = "官方 RSS 说明不允许转载完整正文，暂停自动收录；保留原有候选。";
  const time = sites.find((site) => site.articleHosts[0] === "time.com");
  if (time) time.note = "内容方向合适，但大陆生产服务器当前访问主页和 RSS 均超时；保留为待重试来源，不在无法稳定读取时启用凑数。";
  return sites;
}
