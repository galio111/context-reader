import { loadCetCatalogue, type CetCataloguePage } from "./cetCatalogueLoader";
import type { CetPaper } from "../types/cet";

let seed: { papers: CetPaper[]; version: string; at: number } | undefined;
let pendingSeed: Promise<void> | undefined;
export function prepareCetPreview(): Promise<void> {
  if (seed && Date.now() - seed.at < 60_000) return Promise.resolve();
  return pendingSeed ??= fetch("/api/cet/preview", { signal: AbortSignal.timeout(12_000) }).then(async response => {
    if (!response.ok) throw Error("preview");
    const value = await response.json();
    if (!Array.isArray(value.papers) || typeof value.version !== "string") throw Error("preview");
    seed = { ...value, at: Date.now() };
  }).finally(() => { pendingSeed = undefined; });
}
type Subscriber = { batch: (value: CetCataloguePage) => void; error: () => void; done: () => void };
type Entry = {value?: CetCataloguePage; complete: boolean; at: number; listeners: Set<Subscriber>; controller?: AbortController};
const cache = new Map<string, Entry>();
/** Shared metadata reads with separate subscriber cancellation and bounded retention. */
export function subscribeCetCatalogue(scope: {level: 4 | 6; year: string; owner: string}, subscriber: Subscriber) {
  let live = true;
  let attached: Entry | undefined;
  void prepareCetPreview().catch(() => {}).then(() => {
    if (!live) return;
    const guest = scope.owner === "guest";
    const key = `${seed?.version || "unknown"}:${scope.owner}:${scope.level}:${guest ? "recent" : scope.year}`;
    let entry = cache.get(key);
    if (!entry || (Date.now() - entry.at > 60_000 && !entry.listeners.size && !entry.controller)) {
      for (const [oldKey, old] of cache) if (cache.size >= 8 && !old.listeners.size && !old.controller) cache.delete(oldKey);
      entry = {complete:false,at:Date.now(),listeners:new Set()};
      if (seed && (guest || scope.year === "recent")) {
        const papers = seed.papers.filter(p => p.level === scope.level);
        entry.value = {papers,total:papers.length,years:[...new Set(papers.map(p=>p.year))]};
        entry.complete = guest;
      }
      if (cache.size < 8) cache.set(key, entry);
    }
    attached = entry;
    entry.listeners.add(subscriber);
    if (entry.value) subscriber.batch(entry.value);
    if (entry.complete) { subscriber.done(); return; }
    if (entry.controller) return;
    const controller = new AbortController();
    entry.controller = controller;
    const current = entry;
    void loadCetCatalogue({signal:controller.signal,initial:entry.value?.papers,
      fetchPage:async page => {
        const params = new URLSearchParams({level:String(scope.level),year:guest ? "recent" : scope.year,page:String(page)});
        const response = await fetch(`/api/cet?${params}`, {signal:AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)])});
        if (!response.ok) throw Error("catalogue");
        return response.json();
      },
      onBatch:value=>{current.value=value;current.at=Date.now();for(const listener of current.listeners)listener.batch(value);},
    }).then(()=>{if(!controller.signal.aborted)current.complete=true;})
      .catch(()=>{if(!controller.signal.aborted)for(const listener of current.listeners)listener.error();})
      .finally(()=>{if(current.controller!==controller)return;current.controller=undefined;for(const listener of current.listeners)listener.done();});
  });
  return () => {
    live=false;
    attached?.listeners.delete(subscriber);
    const entry=attached;
    queueMicrotask(()=>{if(entry && !entry.listeners.size) {entry.controller?.abort();entry.controller=undefined;}});
  };
}
