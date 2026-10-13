import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const {chromium}=createRequire(`${process.env.USERPROFILE}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json`)('playwright');
const base=process.env.UI_STUDIO_URL||'http://127.0.0.1:3391',out=process.env.UI_STUDIO_EVIDENCE||'artifacts/ui-picking';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),ctx=await browser.newContext({viewport:{width:1600,height:1000}});
if(process.env.UI_STUDIO_COOKIES)await ctx.addCookies(JSON.parse(await fs.readFile(process.env.UI_STUDIO_COOKIES,'utf8')).cookies);
const page=await ctx.newPage(),errors=[],writes=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/')&&r.frame().url().includes('/frame?'))writes.push(r.url());});
const frame=()=>page.frameLocator('iframe');
async function locate(title,selector){
 await page.getByRole('button',{name:/^效果清单/}).click();
 await page.getByRole('textbox',{name:'搜索界面与动效',exact:true}).fill(title);
 const row=page.locator('main article').filter({has:page.getByText(title,{exact:true})});
 await row.getByRole('button',{name:/在页面查看|打开所属页面/}).click();
 await frame().locator(selector).first().waitFor({state:'visible',timeout:45000});
 await page.waitForFunction(()=>{const f=document.querySelector('iframe');return f?.contentDocument?.querySelector('[data-ui-selection]')?.matches(':popover-open');},{timeout:15000});
 checks.push(title);
}
try{
 await page.goto(base+'/admin/ui-studio',{waitUntil:'domcontentloaded',timeout:120000});
 await frame().locator('[data-home-mode]').waitFor({timeout:90000});
 const menu=frame().locator('[class*="HomeRedesign_menuButton"]');
 await menu.click();await page.locator('aside h2').filter({hasText:'右上角 Menu'}).waitFor();
 assert.equal(await frame().locator('#home-option-menu').count(),0);
 await page.getByRole('button',{name:'正常操作',exact:true}).click();await menu.click();await frame().locator('#home-option-menu').waitFor();
 await page.getByRole('button',{name:'选择组件',exact:true}).click();await frame().locator('#home-option-menu button').filter({hasText:'设置'}).click();
 await page.locator('aside h2').filter({hasText:'Menu 项目'}).waitFor();checks.push('operate/select');
 await locate('目标记住率下拉','[aria-label="目标记住率"]');
 await page.getByRole('spinbutton',{name:'圆角',exact:true}).fill('19');
 assert.equal(await frame().locator('[aria-label="目标记住率"]').evaluate(n=>getComputedStyle(n).borderRadius),'19px');
 // Left-side selection must open the appropriate state as well.
 await page.getByRole('textbox',{name:'查找当前页面元素'}).fill('学习日历方格');await page.locator('aside button').filter({hasText:'学习日历方格'}).click();
 await frame().locator('[class*="StudyPanel_heatmap"]').waitFor();checks.push('left opens stats');
 await locate('学习确认弹窗','[class*="StudyPanel_confirm"]');
 await locate('账号与用量标题','.cr-account-title');
 await locate('Menu 外观设置','[class*="HomeOptionMenu_settingsPanel"]');
 await locate('首屏标题','#home-redesign-title');
 assert.ok((await page.locator('iframe').getAttribute('src')).includes('screen=guest'));
 await locate('首页固定查词面板','[aria-label="单独查词面板"]');
 await locate('按钮圆弧填充与文字上移','[data-pill-action]');
 await page.locator('aside h2').filter({hasText:'圆弧填充胶囊按钮'}).waitFor();checks.push('effect maps to editable button');
 await page.screenshot({path:out+'/editor.png'});
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
 await fs.writeFile(out+'/picking.json',JSON.stringify({ok:true,checks,errors,frameBusinessWrites:writes.length},null,2));
 console.log(JSON.stringify({ok:true,checks,errors}));
}catch(e){await page.screenshot({path:out+'/failure.png'});console.error(e);console.log((await page.locator('body').innerText()).slice(-2000));process.exitCode=1;}finally{await browser.close();}
