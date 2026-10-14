import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
test('a direct response that stalls after headers falls back before returning success',async()=>{
 const require=createRequire(import.meta.url);const path=require.resolve('../lib/safeRemoteFetch');const real=require(path);let calls=0;
 require.cache[path]={id:path,filename:path,loaded:true,exports:{...real,assertSafeRemoteUrl:async(input:string|URL)=>new URL(input),safeRemoteFetch:async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('<html>'));c.error(new DOMException('timed out','TimeoutError'));}}),{headers:{'content-type':'text/html'}});}}} as NodeModule;
 const original=globalThis.fetch;const oldUrl=process.env.OVERSEAS_FETCH_URL;const oldToken=process.env.OVERSEAS_FETCH_TOKEN;
 process.env.OVERSEAS_FETCH_URL='https://context-reader-overseas-fetch.vercel.app/api/fetch';process.env.OVERSEAS_FETCH_TOKEN='x'.repeat(64);
 globalThis.fetch=async()=>new Response('<html><body>Complete overseas body</body></html>',{headers:{'x-context-reader-overseas-fetch':'1','x-context-reader-final-url':'https://example.org/final','content-type':'text/html'}});
 try {const {fetchRemoteDocument}=await import('../lib/overseasFetch');const result=await fetchRemoteDocument('https://example.org/',{}, {maxBytes:500});assert.equal(calls,1);assert.equal(result.route,'vercel-overseas');assert.equal(result.finalUrl,'https://example.org/final');assert.match(await result.response.text(),/Complete overseas body/);}finally{globalThis.fetch=original;if(oldUrl===undefined)delete process.env.OVERSEAS_FETCH_URL;else process.env.OVERSEAS_FETCH_URL=oldUrl;if(oldToken===undefined)delete process.env.OVERSEAS_FETCH_TOKEN;else process.env.OVERSEAS_FETCH_TOKEN=oldToken;}
});
