import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import identity from "../chrome-extension/identity.json" with { type: "json" };
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve(process.env.EXTENSION_QA_OUTPUT || "artifacts/extension-pin-1114"); await mkdir(out, { recursive: true });
const extension = resolve(process.env.CONTEXT_READER_EXTENSION_OUT_DIR || "artifacts/chrome-extension-1113/unpacked");
const ctx = await chromium.launchPersistentContext(resolve(out, `profile-${Date.now()}`), { channel: "chromium", executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, headless: true, ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"], args: ["--enable-unsafe-extension-debugging"], viewport: { width: 1440, height: 1000 } });
const checks = [], errors = [];
let debugPage, debugWorker;
try {
  const cdp = await ctx.browser().newBrowserCDPSession(); await cdp.send("Extensions.loadUnpacked", { path: extension });
  const url = `chrome-extension://${identity.id}/background.js`;
  const worker = ctx.serviceWorkers().find(w => w.url() === url) || await ctx.waitForEvent("serviceworker", { predicate: w => w.url() === url });
  debugWorker = worker;
  await worker.evaluate(async () => {
    globalThis.__calls = []; globalThis.__delay = 0;
    globalThis.fetch = async (url, init) => {
      const op = new URL(String(url)).pathname.split("/").at(-1), body = JSON.parse(init.body); globalThis.__calls.push({ op, body });
      if (globalThis.__delay) await new Promise(r => setTimeout(r, globalThis.__delay));
      if (op === "translate") return Response.json({ translations: [{ id: "extension-selection", translation: "所选内容的中文译文：" + body.text }] });
      if (op === "pronunciation") return new Response(new Uint8Array([1,2,3]), { headers: { "Content-Type": "audio/mpeg" } });
      const e = { word: body.word, lemma: body.word, phonetic: "/bæŋk/", phoneticFor: body.word, partOfSpeech: "名词", basicMeaning: "测试释义", contextMeaning: "当前语境释义", sentenceTranslation: "当前原句译文", usageNote: "用法说明", collocation: "river bank（河岸）", exampleEnglish: "We reached the bank.", exampleChinese: "我们到达河岸。", difficulty: "easy", shouldAddToVocabulary: true, anki: {} };
      if (op === "explain") return Response.json({ explanation: e });
      if (op === "stream") return new Response(`原型：${body.word}\n当前词音标：/bæŋk/\n当前词音标归属：${body.word}\n词性：名词\n难度：easy\n基础释义：测试释义\n当前语境含义：当前语境释义\n当前句子翻译：当前原句译文\n用法说明：用法说明\n常见搭配：river bank（河岸）\n英文例句：We reached the bank.\n例句中文翻译：我们到达河岸。\n\u001e`);
      if (op === "dictionary") return Response.json({ dictionary: { query: body.query, phonetic: "/x/", inputStatus: "valid", senses: [{ meaning: "词典释义", partOfSpeech: "名词" }] } });
      throw new Error("Unexpected operation " + op);
    };
    await chrome.storage.local.set({ connection: { token: "crx_" + "x".repeat(43), accountId: "test", nickname: "ACCOUNT_MUST_NOT_APPEAR", connectionId: "fixture" }, preferences: { width: 420, height: 520, opacity: 96, background: "#ffffff", text: "#1d1d1f", accent: "#0066cc", autoLookup: true } });
  });
  const page = await ctx.newPage(); page.on("pageerror", error => errors.push(error.message));
  debugPage = page;
  await ctx.route("https://reading.example.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><style>body{margin:0;background:#edf2f7;font:22px/1.8 Georgia}p{position:absolute;margin:0}#a{top:90px;left:100px}#b{top:760px;left:900px}#phrase-row{top:140px;left:850px}#sentence-row{top:300px;left:850px}#long-row{top:480px;left:850px;max-width:500px}#blank{position:absolute;left:1100px;top:50px;width:200px;height:60px;user-select:none}span{white-space:nowrap}</style></head><body><p id="a">The river <b id="first">bank</b> is quiet.</p><p id="b">The material is <b id="second">stable</b>.</p><p id="phrase-row">It worked <span id="phrase">in spite of</span> the rain.</p><p id="sentence-row"><span id="sentence">This is very useful.</span></p><p id="long-row">Earlier context. <span id="long">We reached the river bank before sunset, and returned home.</span> Later context.</p><div id="blank" aria-label="空白区域"></div></body></html>' }));
  await page.goto("https://reading.example.test/article"); await page.waitForTimeout(400);
  await page.addStyleTag({content:"#long-row{left:650px;font-size:19px}"});
  const panel = () => page.frames().find(f => f.url().startsWith(`chrome-extension://${identity.id}/panel.html`));
  const waitPanel = async (previousUrl = "") => { await page.waitForFunction(() => Boolean(document.querySelector("[data-context-reader-extension]"))); for (let i=0; i<60; i++) { if (panel() && panel().url() !== previousUrl) return panel(); await page.waitForTimeout(50); } throw new Error("Missing new panel"); };
  const headerButton = async name => { const el = await panel().frameElement(); const rect = await el.evaluate((iframe, name) => { const button = iframe.parentElement.querySelector(`button[aria-label="${name}"]`); const r = button.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; }, name); await page.mouse.click(rect.x, rect.y); };
  const position = async () => (await panel().frameElement()).evaluate(el => { const r = el.parentElement.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; });
  const dragSelect = async selector => { const r = await page.locator(selector).evaluate(el => { const range=document.createRange(); range.selectNodeContents(el); const r=range.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height }; }); await page.mouse.move(r.x+1,r.y+r.height/2); await page.mouse.down(); await page.mouse.move(r.x+r.width-1,r.y+r.height/2,{steps:14}); await page.mouse.up(); };
  await page.locator("#first").dblclick(); let frame = await waitPanel(); await frame.getByRole("heading",{name:"bank",exact:true}).waitFor();
  assert.doesNotMatch(await frame.locator("body").innerText(), /ACCOUNT_MUST_NOT_APPEAR|保存到|更换账号/);
  const outerText = await (await frame.frameElement()).evaluate(el=>el.parentElement.querySelector("header").textContent); assert.doesNotMatch(outerText,/ACCOUNT_MUST_NOT_APPEAR/);
  await headerButton("固定弹窗位置"); const fixed = await position();
  const firstUrl=frame.url(); await page.locator("#second").dblclick(); frame=await waitPanel(firstUrl); await frame.getByRole("heading",{name:"stable",exact:true}).waitFor(); assert.deepEqual(await position(),fixed);
  const n=await worker.evaluate(()=>globalThis.__calls.length); await page.locator("#blank").click(); await page.waitForTimeout(250); assert.deepEqual(await position(),fixed); assert.equal(await worker.evaluate(()=>globalThis.__calls.length),n);
  checks.push("Pin keeps the window in the exact same position for another word and blank clicks, without repeating a stale lookup");
  await headerButton("取消固定弹窗位置"); await page.locator("#blank").click(); await page.waitForTimeout(350); assert.equal(panel(),undefined); assert.equal(await page.locator("[data-context-reader-extension]").count(),0);
  await page.locator("#second").dblclick(); frame=await waitPanel(); await frame.getByRole("heading",{name:"stable",exact:true}).waitFor(); assert.notEqual((await position()).x,fixed.x);
  checks.push("Unpinned window closes on blank space, stays closed, and the next selection anchors beside its word");
  await headerButton("固定弹窗位置"); const box=await position(); await page.mouse.move(box.x+100,box.y+18); await page.mouse.down(); await page.mouse.move(160,60,{steps:8}); await page.mouse.up(); const moved=await position();
  const wordUrl=frame.url(); await dragSelect("#phrase"); frame=await waitPanel(wordUrl); await frame.getByRole("heading",{name:"in spite of",exact:true}).waitFor(); assert.deepEqual(await position(),moved);
  checks.push("A three-word native drag keeps phrase explanation and the pinned position");
  const before=await worker.evaluate(()=>globalThis.__calls.length), phraseUrl=frame.url(); await dragSelect("#sentence"); frame=await waitPanel(phraseUrl); await frame.getByRole("heading",{name:"句子翻译",exact:true}).waitFor(); await frame.locator(".translation-result").waitFor();
  const calls=await worker.evaluate(n=>globalThis.__calls.slice(n),before); assert.ok(calls.some(c=>c.op==="translate"&&c.body.text==="This is very useful.")); assert.ok(!calls.some(c=>["explain","stream","dictionary"].includes(c.op)));
  assert.doesNotMatch(await frame.locator("body").innerText(),/ACCOUNT_MUST_NOT_APPEAR|保存到|加入生词本/); assert.deepEqual(await position(),moved);
  await page.screenshot({path:resolve(out,"pinned-sentence.png")});
  const sentenceUrl=frame.url(); await dragSelect("#long"); frame=await waitPanel(sentenceUrl); await frame.locator(".translation-result").filter({hasText:"We reached the river bank before sunset, and returned home."}).waitFor();
  const last=await worker.evaluate(()=>globalThis.__calls.filter(c=>c.op==="translate").at(-1)); assert.equal(last.body.text,"We reached the river bank before sunset, and returned home.");
  checks.push("Exactly four words and longer punctuated selections use translation only; unselected surrounding sentences are not targets");
  await headerButton("取消固定弹窗位置"); await page.locator("#blank").click(); await worker.evaluate(()=>{globalThis.__delay=700});
  await page.locator("#first").dblclick(); await waitPanel(); await page.locator("#blank").click(); await page.waitForTimeout(1100); assert.equal(panel(),undefined);
  checks.push("Outside clicks also cancel a pending unpinned display; delayed replies cannot reopen it");
  assert.deepEqual(errors,[]); await writeFile(resolve(out,"browser-qa.json"),JSON.stringify({ok:true,checks,errors},null,2)); console.log(JSON.stringify({ok:true,checks}));
} catch (error) {
  if (debugPage) { await debugPage.screenshot({path:resolve(out,"failure.png")}); console.log(JSON.stringify({selection:await debugPage.evaluate(()=>getSelection()?.toString()),frames:debugPage.frames().map(f=>f.url()),errors,calls:await debugWorker.evaluate(()=>globalThis.__calls.map(c=>({op:c.op,word:c.body.word,text:c.body.text}))).catch(()=>[])})); }
  throw error;
} finally { await ctx.close(); }
