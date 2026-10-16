import test from 'node:test';
import assert from 'node:assert/strict';
import {publicReadCache,invalidatePublicReadCache} from '../lib/publicReadCache';
import type {PublicArticle} from '../types/publicArticle';
test('a catalogue beyond the former 4 MiB limit stays cached and concurrent reloads join',async()=>{
 invalidatePublicReadCache();let loads=0;
 const catalogue=[{id:'large-catalogue-fixture',summary:'x'.repeat(5*1024*1024)}] as PublicArticle[];
 const load=async()=>{loads++;return catalogue;};
 const first=await Promise.all(Array.from({length:15},()=>publicReadCache.summaries.get('catalogue',load)));
 assert.ok(first.every(value=>value===catalogue));assert.equal(loads,1);
 assert.equal(await publicReadCache.summaries.get('catalogue',load),catalogue);assert.equal(loads,1);
 invalidatePublicReadCache();await publicReadCache.summaries.get('catalogue',load);assert.equal(loads,2);
 invalidatePublicReadCache();
});
