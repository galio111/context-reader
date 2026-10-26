import { safeRemoteFetch, readResponseText } from "./safeRemoteFetch";
export interface KnowledgeSource { title: string; url: string; text: string }
/** Public reference lookup only. Never sends the private paper or conversation. */
export async function searchDocumentKnowledge(query: string, signal?: AbortSignal): Promise<{ sources: KnowledgeSource[]; notice: string }> {
  const term = query.trim().slice(0, 150);
  if (!term) return { sources: [], notice: "" };
  const timeout = AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]);
  const wiki = new URL(/\p{Script=Han}/u.test(term) ? "https://zh.wikipedia.org/w/api.php" : "https://en.wikipedia.org/w/api.php");
  wiki.search = new URLSearchParams({action:"query",format:"json",generator:"search",gsrsearch:term,gsrlimit:"3",prop:"extracts",exintro:"1",explaintext:"1",exchars:"2400"}).toString();
  const papers = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  papers.search = new URLSearchParams({query:term,format:"json",pageSize:"3",resultType:"core"}).toString();
  const results = await Promise.allSettled([wiki, papers].map(async url => {
    const response = await safeRemoteFetch(url, {signal:timeout,headers:{Accept:"application/json"}}, {maxRedirects:0});
    if (!response.ok) throw new Error("Reference unavailable");
    return JSON.parse(await readResponseText(response, 256 * 1024));
  }));
  const sources: KnowledgeSource[] = [];
  if (results[0].status === "fulfilled") for (const item of Object.values(results[0].value.query?.pages ?? {}) as {title?:string;extract?:string;pageid?:number}[]) {
    if (item.title && item.extract && Number.isSafeInteger(item.pageid)) sources.push({title:item.title,url:`${wiki.origin}/?curid=${item.pageid}`,text:item.extract.slice(0,2400)});
  }
  if (results[1].status === "fulfilled") for (const item of results[1].value.resultList?.result ?? []) {
    if (typeof item.title === "string" && typeof item.abstractText === "string" && /^[\w-]+$/.test(item.id) && /^[A-Z]+$/.test(item.source)) sources.push({title:item.title,url:`https://europepmc.org/article/${item.source}/${item.id}`,text:item.abstractText.replace(/<[^>]*>/g, " ").slice(0,2400)});
  }
  return {sources:sources.slice(0,5),notice:sources.length ? "已检索维基百科 / Europe PMC 的可用条目与摘要。" : "外部资料暂未检索到可用结果，本次结合论文内容回答。"};
}
