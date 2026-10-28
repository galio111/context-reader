import test from 'node:test';
import assert from 'node:assert/strict';
import {withTranslationTimeout} from '../lib/articleTranslationTransport';
test('a hung translation response is bounded and aborts its transport',async()=>{
 let signal:AbortSignal|undefined;
 await assert.rejects(withTranslationTimeout(s=>{signal=s;return new Promise(()=>{});},15),/响应超时/);
 assert.equal(signal?.aborted,true);
});
test('owner cancellation interrupts a stalled response even if the fetch mock ignores abort',async()=>{
 const parent=new AbortController();const pending=withTranslationTimeout(()=>new Promise(()=>{}),1000,parent.signal);
 parent.abort();await assert.rejects(pending,{name:'AbortError'});
});
test('a completed response does not leave a timer that later aborts it',async()=>{
 let signal:AbortSignal|undefined;
 assert.equal(await withTranslationTimeout(async s=>{signal=s;return 3;},10),3);
 await new Promise(r=>setTimeout(r,20));assert.equal(signal?.aborted,false);
});
