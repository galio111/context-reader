import test from "node:test";
import assert from "node:assert/strict";
import { BoundedAsyncCache } from "../lib/boundedAsyncCache";
import { publicArticleSummary } from "../lib/publicArticleSummary";
import { validCoverVariants } from "../lib/coverVariantMetadata";
import type { PublicArticle } from "../types/publicArticle";

test("complete lightweight catalogue fits bounded cache and concurrent readers join one load", async () => {
  const source = "https://context-reader.com/storage/v1/object/public/public-article-covers/source.webp";
  const variants = { version: 1 as const, sourceUrl: source, width: 1600, height: 900, items: [{url: source, width: 1600, height: 900}] };
  assert.ok(validCoverVariants(variants, source));
  assert.equal(validCoverVariants({...variants, items:[{url:"https://other.example/image.webp",width:1600,height:900}]},source),false);
  const articles = Array.from({length:702},(_,i)=>publicArticleSummary({id:String(i),title:`Title ${i}`,summary:"Complete searchable summary",body:"private detail",recommendation:{coverImageUrl:source,coverPreviewDataUrl:"x".repeat(9000),coverVariants:variants}} as PublicArticle));
  assert.equal(articles.length,702);
  assert.ok(articles.every(a=>!a.body && !a.recommendation?.coverPreviewDataUrl && a.recommendation?.coverVariants));
  const cache = new BoundedAsyncCache<PublicArticle[]>(30_000,1,4*1024*1024);
  let calls=0;
  const load=async()=>{calls++;await new Promise(r=>setImmediate(r));return articles;};
  const [a,b]=await Promise.all([cache.get("catalogue",load),cache.get("catalogue",load)]);
  assert.equal(a,b); assert.equal(calls,1);
  await cache.get("catalogue",load);
  assert.deepEqual({...cache.snapshot(),bytes:0},{hits:1,misses:1,joins:1,oversized:0,entries:1,pending:0,bytes:0});
  assert.ok(cache.snapshot().bytes>0 && cache.snapshot().bytes<4*1024*1024);
  cache.clear();await cache.get("catalogue",load);assert.equal(calls,2);
});
