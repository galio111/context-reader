import assert from 'node:assert/strict';
import test from 'node:test';
import {withinStartupBudget} from '../lib/startupBudget';
import {BoundedAsyncCache} from '../lib/boundedAsyncCache';

test('a cold catalogue cannot indefinitely block HTML, and its later result remains reusable',async()=>{
  let finish!:(value:string)=>void;
  const cache=new BoundedAsyncCache<string>(10_000,1,100);
  const pending=cache.get('catalogue',()=>new Promise(resolve=>{finish=resolve;}));
  assert.equal(await withinStartupBudget(pending,10),undefined);
  finish('real catalogue');await pending;
  assert.equal(await withinStartupBudget(cache.get('catalogue',()=>Promise.reject(Error('must be cached'))),10),'real catalogue');
  assert.equal(await withinStartupBudget(Promise.reject(Error('unavailable')),10),undefined);
});

test('public stale reads coalesce refresh, and explicit invalidation prevents late resurrection',async()=>{
  const cache=new BoundedAsyncCache<string>(0,1,100,true);
  await cache.get('catalogue',async()=>'old');
  let finish!:(value:string)=>void,loads=0;
  const load=()=>{loads++;return new Promise<string>(resolve=>{finish=resolve;});};
  assert.equal(await cache.get('catalogue',load),'old');
  assert.equal(await cache.get('catalogue',load),'old');assert.equal(loads,1);
  cache.clear();assert.equal(await cache.get('catalogue',async()=>'published'),'published');
  finish('obsolete');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await cache.get('catalogue',async()=>'published'),'published');
});

test('strict default caches still await authoritative refresh',async()=>{
  const cache=new BoundedAsyncCache<string>(0,1,100);
  await cache.get('key',async()=>'old');
  assert.equal(await cache.get('key',async()=>'fresh'),'fresh');
});

test('an oversized refresh cannot leave a public snapshot permanently stale',async()=>{
  const cache=new BoundedAsyncCache<string>(0,1,20,true);
  await cache.get('key',async()=>'old');
  const large='new'.repeat(100);
  assert.equal(await cache.get('key',async()=>large),'old');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(await cache.get('key',async()=>large),large);
});
