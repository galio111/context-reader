import {createRequire} from 'node:module';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(process.env.PLAYWRIGHT_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const source=`import React from 'react';import {createRoot} from 'react-dom/client';import {useReadingEvidence} from './components/useReadingEvidence';import {useStudyTimer} from './components/useStudyTimer';function App(){const [study,setStudy]=React.useState(false);useReadingEvidence('timing-qa','article','');const elapsed=useStudyTimer(study,'card','timing-qa');return <><article data-learning-surface="reading" style={{height:400,background:'#ddd'}}>Reading surface</article><button onClick={()=>setStudy(!study)}>Toggle study</button><article data-learning-surface="study"><button onClick={()=>document.querySelector('output').textContent=String(elapsed())}>Answer</button></article><button>Outside</button><output/></>};createRoot(document.getElementById('root')).render(<App/>);`;
const compiled=await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':process.cwd()}});
const browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext();const page=await context.newPage();const ticks=[];const errors=[];
await context.route('**/*',async route=>{if(route.request().url().includes('/api/study/reading')){ticks.push(route.request().postDataJSON());return route.fulfill({json:{ok:true}});}if(route.request().url().endsWith('/bundle.js'))return route.fulfill({contentType:'application/javascript',body:compiled.outputFiles[0].text});return route.fulfill({contentType:'text/html',body:'<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>'});});
page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
const total=()=>ticks.reduce((n,t)=>n+t.seconds,0);
try{
 await page.clock.install();await page.goto('https://activity.test');await page.getByRole('button',{name:'Outside',exact:true}).waitFor();
 await page.clock.runFor(120000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),0,'untouched page');
 await page.mouse.move(100,100);await page.clock.runFor(60000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),0,'pointer movement');
 const reading=page.locator('[data-learning-surface="reading"]');await reading.click();await page.clock.runFor(10000);await reading.click();await page.clock.runFor(15000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),10,'quiet reading between two deliberate events');
 await page.clock.runFor(60000);await reading.click();await page.clock.runFor(15000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),10,'idle tail not counted');
 await page.getByRole('button',{name:'Outside',exact:true}).click();await page.clock.runFor(10000);await reading.click();await page.clock.runFor(15000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),10,'outside control breaks interval');
 await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.clock.runFor(10000);await reading.click();await page.clock.runFor(15000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),10,'blur breaks interval');
 const other=await context.newPage();await other.goto('https://activity.test');await other.evaluate(()=>localStorage.setItem('context-reader-active-learning:timing-qa','another-tab'));await page.bringToFront();await reading.click();await page.clock.runFor(15000);await new Promise(r=>setTimeout(r,100));assert.equal(total(),10,'other tab ownership breaks interval');await other.close();
 await page.getByRole('button',{name:'Toggle study'}).click();await page.clock.runFor(10000);await page.getByRole('button',{name:'Answer',exact:true}).click();const answered=Number(await page.locator('output').innerText());assert.ok(answered>=10000&&answered<10100,'study captures deliberate answer time');
 await page.clock.runFor(60000);await page.getByRole('button',{name:'Answer',exact:true}).click();assert.equal(Number(await page.locator('output').innerText()),answered,'abandoned card no extra minute');
 await page.getByRole('button',{name:'Outside',exact:true}).click();await page.clock.runFor(10000);await page.getByRole('button',{name:'Answer',exact:true}).click();assert.equal(Number(await page.locator('output').innerText()),answered,'study outside break');assert.deepEqual(errors,[]);
 await mkdir('artifacts/study-refinement-browser',{recursive:true});await writeFile('artifacts/study-refinement-browser/activity.json',JSON.stringify({ok:true,ticks,checks:['untouched','movement','quiet reading','idle','outside control','blur','tab ownership','study answer','abandoned study'],errors},null,2));console.log('Real hook browser timing checks passed');
}finally{await browser.close();}
