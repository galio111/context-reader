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
  const chemical = new URL(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(term)}/description/JSON`);
  const results = await Promise.allSettled([wiki, papers, chemical].map(async url => {
    const response = await safeRemoteFetch(url, {signal:timeout,headers:{Accept:"application/json"}}, {maxRedirects:0});
    if (!response.ok) throw new Error("Reference unavailable");
    const data=JSON.parse(await readResponseText(response, 256 * 1024));
    if(url===chemical){
      const cid=data.InformationList?.Information?.find((item:{CID?:number})=>Number.isSafeInteger(item.CID))?.CID;
      if(cid)try{
        const properties=await safeRemoteFetch(new URL(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/data/compound/${cid}/JSON?heading=Color%2FForm`),{signal:timeout,headers:{Accept:"application/json"}},{maxRedirects:0});
        if(properties.ok){
          const view=JSON.parse(await readResponseText(properties,256*1024));
          const texts:string[]=[];
          function collect(node:unknown):void {
            if(!node || typeof node!=="object")return;
            const value=node as {StringWithMarkup?:{String?:string}[];Section?:unknown[];Information?:unknown[];Record?:unknown;Value?:unknown};
            for(const row of value.StringWithMarkup ?? [])if(typeof row.String==="string")texts.push(row.String.slice(0,2000));
            for(const child of [...(value.Section ?? []),...(value.Information ?? []),...(value.Record?[value.Record]:[]),...(value.Value?[value.Value]:[])])collect(child);
          }
          collect(view);
          if(texts.length)data.InformationList.Information.unshift({CID:cid,Description:`Color/Form: ${texts.join("; ").slice(0,4000)}`});
        }
      }catch{ /* Description remains usable if the optional property read fails. */ }
    }
    return data;
  }));
  const sources: KnowledgeSource[] = [];
  if(results[2].status === "fulfilled") for(const item of results[2].value.InformationList?.Information ?? []) {
    if(Number.isSafeInteger(item.CID) && typeof item.Description === "string") sources.push({title:`PubChem: ${term}`,url:`https://pubchem.ncbi.nlm.nih.gov/compound/${item.CID}`,text:item.Description.slice(0,4000)});
    if(sources.length>=2)break;
  }
  if (results[0].status === "fulfilled") for (const item of Object.values(results[0].value.query?.pages ?? {}) as {title?:string;extract?:string;pageid?:number}[]) {
    if (item.title && item.extract && Number.isSafeInteger(item.pageid)) sources.push({title:item.title,url:`${wiki.origin}/?curid=${item.pageid}`,text:item.extract.slice(0,2400)});
  }
  if (results[1].status === "fulfilled") for (const item of results[1].value.resultList?.result ?? []) {
    if (typeof item.title === "string" && typeof item.abstractText === "string" && /^[\w-]+$/.test(item.id) && /^[A-Z]+$/.test(item.source)) sources.push({title:item.title,url:`https://europepmc.org/article/${item.source}/${item.id}`,text:item.abstractText.replace(/<[^>]*>/g, " ").slice(0,2400)});
  }
  const unique=new Map<string,KnowledgeSource>();
  for(const source of sources){const existing=unique.get(source.url);if(existing)existing.text=(existing.text+"\n"+source.text).slice(0,6000);else unique.set(source.url,{...source});}
  const selected=[...unique.values()].slice(0,5);
  const providers=[...new Set(selected.map(s=>new URL(s.url).hostname.replace(/^(en|zh)\./,"")))].join(" / ");
  return {sources:selected,notice:selected.length ? `检索关键词：${term}。来源：${providers}（条目 / 摘要）。` : `检索关键词：${term}。外部资料暂不可用或未找到结果，本次使用一般知识与论文回答，未取得外部来源。`};
}
