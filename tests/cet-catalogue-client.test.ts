import test from "node:test";
import assert from "node:assert/strict";
import { prepareCetPreview, subscribeCetCatalogue } from "../lib/cetCatalogueClient";
import { GET } from "../app/api/cet/preview/route";

test("public seed is finite metadata; shared subscribers keep independent cancellation and owner partitions", async () => {
  const payload = await GET().json();
  assert.equal(payload.papers.length, 24);
  for (const level of [4,6]) assert.equal(payload.papers.filter((p:{level:number})=>p.level===level).length,12);
  for (const p of payload.papers) for (const s of p.sections) {
    assert.equal(s.body, undefined); assert.equal(s.passage, undefined);
    for (const q of s.questions) assert.deepEqual(Object.keys(q), ["number"]);
  }
  const original = globalThis.fetch;
  let calls=0;
  let resolve: ((r:Response)=>void) | undefined;
  globalThis.fetch = async input => {
    if (String(input)==="/api/cet/preview") return Response.json(payload);
    calls++;
    return new Promise<Response>(r=>{resolve=r;});
  };
  try {
    await prepareCetPreview();
    const seen:number[]=[];
    const done = new Promise<void>((finished,reject)=>{
      const a=subscribeCetCatalogue({level:4,year:"recent",owner:"a"},{batch:()=>{},error:()=>reject(Error("request failed")),done:()=>{}});
      const b=subscribeCetCatalogue({level:4,year:"recent",owner:"a"},{batch:v=>seen.push(v.papers.length),error:()=>reject(Error("request failed")),done:()=>{b();finished();}});
      queueMicrotask(()=>a());
    });
    await new Promise(r=>setImmediate(r));
    assert.equal(calls,1);
    resolve!(Response.json({papers:payload.papers.filter((p:{level:number})=>p.level===4),total:12,years:[2025]}));
    await done;
    assert.deepEqual(seen,[12,12]);
    const guest: number[]=[];
    const off=subscribeCetCatalogue({level:6,year:"recent",owner:"guest"},{batch:v=>guest.push(v.papers.length),error:()=>{},done:()=>{}});
    await new Promise(r=>setImmediate(r));off();
    assert.deepEqual(guest,[12]);assert.equal(calls,1);
    const offB=subscribeCetCatalogue({level:4,year:"recent",owner:"b"},{batch:()=>{},error:()=>{},done:()=>{}});
    await new Promise(r=>setImmediate(r));assert.equal(calls,2);offB();
  } finally {globalThis.fetch=original;}
});
