import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const {chromium}=createRequire(process.env.PLAYWRIGHT_PACKAGE || `${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json`)('playwright');
const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:3391/admin/ui-studio',{waitUntil:'networkidle'});
 await page.getByRole('button',{name:'选择页面',exact:true}).click();await page.getByRole('option',{name:'背单词',exact:true}).click();
 const frame=page.frameLocator('iframe'),button=frame.locator('[data-rating="remembered"]');await button.waitFor();
 let seq=1000;
 const preview=async targets=>{await page.evaluate(({targets,seq})=>{const f=document.querySelector('iframe');f.contentWindow.postMessage({channel:'galio-ui-studio',nonce:new URL(f.src).searchParams.get('nonce'),type:'update',seq,recipe:{version:1,targets},editing:false,selected:''},location.origin);},{targets,seq:seq++});await page.waitForTimeout(500);};
 await preview({'study.rating-remembered':{componentId:'c-buttons-fill',material:'matte',fontSize:23}});
 assert.equal(await button.getAttribute('data-galio-material'),'matte');assert.equal(await button.locator('.gc-decoration').count(),1);
 await preview({'study.rating-remembered':{componentId:'c-buttons-fill'}});
 assert.equal(await button.getAttribute('data-galio-material'),'original');assert.equal(await button.locator('.gc-decoration').count(),1);
 assert.equal(await button.evaluate(n=>n.style.getPropertyValue('--gc-size')),'16px');
 const names=['split','fill','circle','underline','shortcut','physical','reveal-arrow','pill','flip'].map(n=>'c-buttons-'+n).concat(['arrow-loop','radial','magnet','line-draw','tilt','spotlight','reveal','lift','border-trace'].map(n=>'c-hover-'+n));
 for(const componentId of names){await preview({'study.rating-remembered':{componentId,material:'ceramic'}});assert.equal(await button.locator('.gc-decoration').count(),1,componentId);assert.match(await button.innerText(),/记得/,componentId);await button.hover();}
 await preview({});assert.equal(await button.locator('.gc-decoration').count(),0);assert.equal(await button.getAttribute('data-galio-material'),null);
 await preview({'study.rating-remembered':{componentId:'c-buttons-fill'}});await button.click();await frame.getByRole('button',{name:'答对了',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,variants:names.length,checks:['material undo','font reset','all adapters','no duplicate decorations','restore','business click preserved']}));
}catch(e){console.error(e);await page.screenshot({path:'artifacts/ui-studio/adapters-failure.png'});process.exitCode=1;}finally{await browser.close();}
