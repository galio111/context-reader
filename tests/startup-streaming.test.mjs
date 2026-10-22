import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture() {
  let finishWrite, finishFetch;
  const background=[];
  const cached=new Response('cached public shell',{headers:{'X-SW-Cached-At':String(Date.now())}});
  const cache={match:async()=>cached.clone(),put:()=>new Promise(r=>{finishWrite=r;}),keys:async()=>[],delete:async()=>true};
  const box={self:{addEventListener(){}},caches:{open:async()=>cache,match:async()=>undefined},fetch:async()=>new Response('live stream'),Headers,Response,URL,Date,setTimeout,clearTimeout};
  vm.createContext(box);vm.runInContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),box);
  const event={waitUntil:p=>background.push(p)};
  return {box,event,background,write:()=>finishWrite?.(),slow:()=>{box.fetch=()=>new Promise(r=>{finishFetch=r;});},fetch:()=>finishFetch(new Response('fresh shell'))};
}

for(const method of ['networkFirst','cacheFirst']) test(`${method} streams before a blocked cache write`,async()=>{
  const f=fixture();
  const response=await Promise.race([f.box[method](new Request('https://context-reader.com/'),f.event),new Promise((_,reject)=>setTimeout(()=>reject(Error('response blocked on cache')),150))]);
  assert.equal(await response.text(),'live stream');
  f.write();await Promise.all(f.background);
});

test('slow root navigation returns cached public HTML while retaining live refresh',async()=>{
  const f=fixture();f.slow();
  const response=await f.box.publicHomeNavigation(new Request('https://context-reader.com/'),f.event);
  assert.equal(await response.text(),'cached public shell');
  f.fetch();await f.background[0];f.write();await Promise.all(f.background);
});

test('opening is absent even when a legacy preview URL requests it',()=>{
  const source=readFileSync(new URL('../components/HomeRedesign.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(source,/FallingWordOpening|memberOpeningVisible|setMemberOpeningVariant/);
  assert.match(source,/<Ballpit/); // Homepage physics remain available.
});
