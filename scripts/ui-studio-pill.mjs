import {createRequire} from 'node:module';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const {chromium}=createRequire(`${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json`)('playwright');
const base=process.env.UI_STUDIO_URL||'http://127.0.0.1:3391',out=process.env.UI_STUDIO_EVIDENCE||'artifacts/ui-picking';await fs.mkdir(out,{recursive:true});
const b=await chromium.launch({channel:'chrome',headless:true}),ctx=await b.newContext({viewport:{width:1600,height:1000}});if(process.env.UI_STUDIO_COOKIES)await ctx.addCookies(JSON.parse(await fs.readFile(process.env.UI_STUDIO_COOKIES,'utf8')).cookies);
const p=await ctx.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/')&&r.frame().url().includes('/frame?'))writes.push(r.url());});
try{
 await p.goto(base+'/admin/ui-studio',{waitUntil:'domcontentloaded',timeout:120000});const f=p.frameLocator('iframe');const menu=f.locator('[class*="HomeRedesign_menuButton"]');await menu.waitFor({timeout:90000});await menu.click();await p.locator('aside h2').filter({hasText:'右上角 Menu'}).waitFor();
 const catalog=JSON.parse(await fs.readFile('public/galio/content/components-controls.json','utf8'));
 const items=Array.isArray(catalog)?catalog:catalog.components;
 const choose=async id=>{const title=items.find(x=>x.id===id).title;const card=p.locator('aside article').filter({has:p.getByText(title,{exact:true})});await card.getByRole('button',{name:'使用',exact:true}).click();await menu.locator(id==='c-buttons-context-pill'?'.gcp-visual':'.gc-decoration').waitFor();};
 for(let round=0;round<3;round++){
  await choose('c-buttons-context-pill');assert.equal(await menu.getAttribute('data-ui-effect-owner'),'galio');assert.equal(await menu.locator('[data-pill-circle]').evaluate(n=>getComputedStyle(n).display),'none');
  await menu.hover();await p.waitForTimeout(350);assert.equal(await menu.locator('.gcp-hover').innerText(),'Menu');assert.equal(await menu.locator('.gcp-visual').count(),1);assert.equal(await menu.locator('.gc-decoration').count(),0);
  if(round===0)await p.screenshot({path:out+'/capsule.png'});
  await choose('c-buttons-flip');await menu.hover();await p.waitForTimeout(400);assert.equal(await menu.locator('.gcp-visual').count(),0);assert.equal(await menu.locator('[data-pill-circle]').evaluate(n=>getComputedStyle(n).display),'none');assert.ok(['none','matrix(1, 0, 0, 1, 0, 0)'].includes(await menu.locator('[data-pill-primary]').evaluate(n=>getComputedStyle(n).transform)));
  await p.getByRole('button',{name:'保留原有按钮',exact:true}).click();await p.waitForTimeout(250);assert.equal(await menu.getAttribute('data-ui-effect-owner'),null);assert.equal(await menu.locator('.gc-decoration,.gcp-visual').count(),0);
  await menu.hover();await p.waitForTimeout(350);assert.notEqual(await menu.locator('[data-pill-circle]').evaluate(n=>getComputedStyle(n).display),'none');
 }
 await choose('c-buttons-context-pill');await p.getByRole('button',{name:'正常操作',exact:true}).click();await menu.click();await f.locator('#home-option-menu').waitFor();
 await p.getByRole('button',{name:'对比原版',exact:true}).click();await p.waitForTimeout(250);assert.equal(await menu.locator('.gcp-visual').count(),0);await p.getByRole('button',{name:'返回设计',exact:true}).click();await menu.locator('.gcp-visual').waitFor();
 await p.getByRole('button',{name:'手机',exact:true}).click();await p.waitForTimeout(300);await p.screenshot({path:out+'/capsule-mobile.png'});
 await p.emulateMedia({reducedMotion:'reduce'});await p.waitForTimeout(250);assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 const report={ok:true,cycles:3,oldTimelineSuppressed:true,restoredNative:true,originalClickPreserved:true,compareRestores:true,mobileAndReducedMotion:true,errors,frameBusinessWrites:0};await fs.writeFile(out+'/pill.json',JSON.stringify(report,null,2));console.log(report);
}catch(e){console.error(e);await p.screenshot({path:out+'/pill-failure.png'});process.exitCode=1;}finally{await b.close();}
