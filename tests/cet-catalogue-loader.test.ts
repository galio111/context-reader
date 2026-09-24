import test from "node:test";
import assert from "node:assert/strict";
import { loadCetCatalogue } from "../lib/cetCatalogueLoader";
import { normalizeCetLibraryView } from "../lib/cetLibraryView";
import type { CetPaper } from "../types/cet";
const papers = Array.from({length:28}, (_,i) => ({id:`cet6-${i}`, sections:[{id:`${i}-c1`,type:"detail"},{id:`${i}-c2`,type:"detail"}]})) as CetPaper[];
test("directory exposes the first page immediately and reaches the last metadata entry",async()=>{
 const seen:number[]=[];let final:CetPaper[]=[];
 await loadCetCatalogue({signal:new AbortController().signal, fetchPage:async page=>({papers:papers.slice(page*12,page*12+12),total:28,years:[2025]}),onBatch:b=>{seen.push(b.papers.length);final=b.papers;}});
 assert.deepEqual(seen,[12,24,28]);assert.equal(final.at(-1)?.id,"cet6-27");assert.equal(final.flatMap(p=>p.sections).length,56);
 assert.equal(normalizeCetLibraryView({page:2}).page,0);
});
test("later failure retains first batch; retry resumes without duplicates",async()=>{
 let retained:CetPaper[]=[];
 await assert.rejects(loadCetCatalogue({signal:new AbortController().signal,fetchPage:async page=>{if(page)throw Error("offline");return {papers:papers.slice(0,12),total:28,years:[]};},onBatch:b=>{retained=b.papers;}}));
 assert.equal(retained.length,12);const fetched:number[]=[];
 await loadCetCatalogue({signal:new AbortController().signal,initial:retained,fetchPage:async page=>{fetched.push(page);return {papers:papers.slice(page*12,page*12+12),total:28,years:[]};},onBatch:b=>{retained=b.papers;}});
 assert.deepEqual(fetched,[1,2]);assert.equal(new Set(retained.map(p=>p.id)).size,28);
});
test("aborted query cannot append its late response; guest six stays six",async()=>{
 const controller=new AbortController();let calls=0;
 await loadCetCatalogue({signal:controller.signal,fetchPage:async()=>{controller.abort();return {papers,total:28,years:[]};},onBatch:()=>{calls++;}});assert.equal(calls,0);
 await loadCetCatalogue({signal:new AbortController().signal,fetchPage:async()=>({papers:papers.slice(0,6),total:6,years:[]}),onBatch:b=>{calls++;assert.equal(b.papers.length,6);}});assert.equal(calls,1);
});
