import {createRequire} from 'node:module';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE || `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json`)('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))writes.push({url:r.url(),method:r.method(),frame:r.frame().url()});});
await page.context().addCookies([{name:'context_reader_access',value:'ui-studio-local-fixture',url:'http://127.0.0.1:3391'}]);
try{
 const initial=(await (await page.request.get('http://127.0.0.1:3391/api/admin/ui-design')).json()).state;const saved=await (await page.request.post('http://127.0.0.1:3391/api/admin/ui-design',{headers:{origin:'http://127.0.0.1:3391'},data:{action:'save',expectedRevision:initial.revision,recipe:{version:1,targets:{}}}})).json();await page.request.post('http://127.0.0.1:3391/api/admin/ui-design',{headers:{origin:'http://127.0.0.1:3391'},data:{action:'publish',expectedRevision:saved.state.revision}});
 await page.goto('http://127.0.0.1:3391/admin/ui-studio',{waitUntil:'networkidle',timeout:120000});
 await page.getByRole('button',{name:'选择页面',exact:true}).click();await page.getByRole('option',{name:'背单词',exact:true}).click();
 const frame=page.frameLocator('iframe');await frame.locator('[data-rating="remembered"]').waitFor({timeout:60000});
 await page.getByRole('button',{name:'选择组件',exact:true}).click();await frame.locator('[data-rating="remembered"]').click();
 await page.getByRole('button',{name:'釉面陶瓷',exact:true}).click();
 await page.getByRole('spinbutton',{name:'圆角',exact:true}).fill('21');await frame.locator('[data-rating="remembered"][data-galio-material="ceramic"]').waitFor();
 assert.equal(await frame.locator('[data-rating="remembered"]').evaluate(n=>getComputedStyle(n).borderRadius),'21px');
 await page.getByRole('button',{name:'保存方案',exact:true}).click();await page.getByRole('status').filter({hasText:'方案已保存'}).waitFor();
 let publicData=await (await page.request.get('http://127.0.0.1:3391/api/ui-design')).json();assert.deepEqual(publicData.recipe.targets,{});
 await page.getByRole('button',{name:'应用到全站 ↗',exact:true}).click();await page.getByRole('status').filter({hasText:'已应用到全站'}).waitFor();
 publicData=await (await page.request.get('http://127.0.0.1:3391/api/ui-design')).json();assert.equal(publicData.recipe.targets['study.rating-remembered'].radius,21);
 await page.screenshot({path:'artifacts/ui-studio/study-editor.png'});
 await page.getByRole('button',{name:'正常操作',exact:true}).click();await frame.locator('[data-rating="remembered"]').click();await page.screenshot({path:'artifacts/ui-studio/study-answer.png'});
 await page.getByRole('button',{name:'恢复上次上线',exact:true}).click();await page.getByRole('status').filter({hasText:'已恢复上一次'}).waitFor();
 publicData=await (await page.request.get('http://127.0.0.1:3391/api/ui-design')).json();assert.deepEqual(publicData.recipe.targets,{});
 await page.getByRole('button',{name:'手机',exact:true}).click();await page.screenshot({path:'artifacts/ui-studio/mobile-editor.png'});
 await page.getByRole('button',{name:/效果清单/}).click();assert.ok(await page.locator('main article').count()>340);await page.screenshot({path:'artifacts/ui-studio/inventory.png'});
 assert.equal(writes.filter(r=>r.frame.includes('/frame')).length,0);console.log(JSON.stringify({ok:true,errors,writes}));
}catch(e){await page.screenshot({path:'artifacts/ui-studio/failure.png'});console.log(JSON.stringify({error:e.message,errors,writes,text:(await page.locator('body').innerText()).slice(-3500)}));process.exitCode=1;}finally{await browser.close();}
