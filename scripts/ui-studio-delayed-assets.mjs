import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(`${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json`)('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});
for (const kind of ['catalog','sdk']) {
 const ctx=await browser.newContext(),page=await ctx.newPage();const network=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/galio/**',async route=>{const u=route.request().url();const delay=kind==='catalog'?u.includes('/content/components-'):u.endsWith('/sdk/components.js');if(delay){network.push({url:u,start:Date.now()});await new Promise(r=>setTimeout(r,1000));}await route.continue();});
 await page.goto('http://127.0.0.1:3391/api/connectivity');
 await page.setContent(`<iframe style="width:1440px;height:1000px" src="http://127.0.0.1:3391/admin/ui-studio/frame?screen=study&nonce=1797b3ec-f72e-4a1f-84e8-c4ae46d9760f"></iframe>`);
 const iframe=page.frameLocator('iframe');await iframe.locator('[data-rating="remembered"]').waitFor({timeout:60000});const f=page.frames().find(f=>f.url().includes('/frame?'));
 await f.evaluate(()=>{window.__mutations=[];new MutationObserver(rs=>window.__mutations.push({at:Date.now(),r:rs.map(r=>({target:r.target.nodeName,added:r.addedNodes.length,removed:r.removedNodes.length}))})).observe(document.body,{childList:true,subtree:true});});
 await new Promise(r=>setTimeout(r,2000));
 const post=async (material,seq)=>page.evaluate(({material,seq})=>document.querySelector('iframe').contentWindow.postMessage({channel:'galio-ui-studio',nonce:'1797b3ec-f72e-4a1f-84e8-c4ae46d9760f',type:'update',seq,editing:false,selected:'study.rating-remembered',recipe:{version:1,targets:{'study.rating-remembered':{material}}}},location.origin),{material,seq});
 const started=Date.now();await post('matte',1000);await new Promise(r=>setTimeout(r,200));await post('chrome',1001);const samples=[];
 for(let i=0;i<10;i++){await new Promise(r=>setTimeout(r,300));samples.push({ms:Date.now()-started,material:await iframe.locator('[data-rating="remembered"]').getAttribute('data-galio-material')});}
 assert.equal(samples.at(-1).material,'chrome');assert.deepEqual(errors,[]);console.log(JSON.stringify({kind,finalMaterial:samples.at(-1).material,errors}));
 await ctx.close();
}
await browser.close();
