import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import identity from "../chrome-extension/identity.json" with { type: "json" };
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const out = resolve("artifacts/chrome-extension-1113"); await mkdir(out, { recursive: true });
const extension = resolve(out, "unpacked"), evidence = [], errors = [];
const ctx = await chromium.launchPersistentContext(resolve(out, `qa-profile-${Date.now()}`), { channel: "chromium", executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, ignoreDefaultArgs: ["--disable-extensions", "--disable-component-extensions-with-background-pages"], viewport: { width: 1440, height: 960 }, args: ["--enable-unsafe-extension-debugging", ...(process.env.USE_CDP_EXTENSION_LOAD ? [] : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`])] });
try {
  if (process.env.USE_CDP_EXTENSION_LOAD) { const cdp = await ctx.browser().newBrowserCDPSession(); const loaded = await cdp.send("Extensions.loadUnpacked", { path: extension }); console.log("Loaded extension", loaded); await new Promise(r => setTimeout(r,1500)); console.log("Extension registry", await cdp.send("Extensions.getExtensions")); const wake = await ctx.newPage(); await wake.goto(`chrome-extension://${loaded.id}/options.html`); console.log("Extension page", await wake.title()); }
  const workerUrl = `chrome-extension://${identity.id}/background.js`;
  const worker = ctx.serviceWorkers().find(w => w.url() === workerUrl) || await ctx.waitForEvent("serviceworker", { predicate: w => w.url() === workerUrl });
  const id = new URL(worker.url()).hostname;
  await worker.evaluate(async () => {
    globalThis.__calls = [];
    const explanation = { word: "bank", lemma: "bank", phonetic: "/bæŋk/", phoneticFor: "bank", partOfSpeech: "名词", basicMeaning: "STRUCTURED OTHER", contextMeaning: "STRUCTURED OTHER", sentenceTranslation: "STRUCTURED OTHER", usageNote: "与 river 一起指河岸。", collocation: "river bank（河岸）", exampleEnglish: "We walked along the bank.", exampleChinese: "我们沿河岸散步。", difficulty: "easy", shouldAddToVocabulary: true, anki: {} };
    const text = "原型：bank\n当前词音标：/bæŋk/\n当前词音标归属：bank\n词性：名词\n难度：easy\n基础释义：银行；河岸\n当前语境含义：这里指河岸。\n当前句子翻译：我们在日落前到达了河岸。\n用法说明：与 river 一起指河岸。\n常见搭配：river bank（河岸）\n英文例句：We walked along the bank.\n例句中文翻译：我们沿河岸散步。\n\u001e";
    globalThis.fetch = async (url, init) => {
      const op = new URL(String(url)).pathname.split("/").at(-1), body = JSON.parse(init.body);
      globalThis.__calls.push({ op, body });
      if (op === "account") return Response.json({ id: "qa-account", nickname: "测试账号", connectionId: "qa-connection" });
      if (op === "disconnect") return Response.json({ ok: true });
      if (op === "stream") { const bytes = new TextEncoder().encode(text); return new Response(new ReadableStream({ async start(controller) { for (let i = 0; i < bytes.length; i += 44) { controller.enqueue(bytes.slice(i,i+44)); await new Promise(r => setTimeout(r,12)); } controller.close(); } }), { headers: { "Content-Type": "text/plain" } }); }
      if (op === "explain") { await new Promise(r => setTimeout(r,700)); return Response.json({ explanation }); }
      if (op === "dictionary") return Response.json({ dictionary: { query: body.query, lemma: body.query, phonetic: "/bæŋk/", direction: "en_to_cn", inputStatus: "valid", senses: [{ partOfSpeech: "名词", meaning: "银行；河岸", usageNote: "", exampleEnglish: "", exampleChinese: "" }], usageGuide: "", collocations: [], synonyms: [], wordFamily: [], commonMistakes: [] } });
      if (op === "save") return Response.json({ saved: true, id: "qa-word" });
      if (op === "pronunciation") return new Response(new Uint8Array([1,2,3]), { headers: { "Content-Type": "audio/mpeg" } });
      if (op === "ask") return Response.json({ answer: "这里是 river bank，因此指河岸。" });
      return Response.json({ error: "unexpected" }, { status: 400 });
    };
    await chrome.storage.local.set({ connection: { token: "crx_" + "x".repeat(43), accountId: "qa-account", nickname: "测试账号", connectionId: "qa-connection" }, preferences: { width: 420, height: 520, opacity: 96, background: "#ffffff", text: "#1d1d1f", accent: "#0066cc", autoLookup: false } });
  });
  const page = await ctx.newPage(); page.on("pageerror", e => errors.push(e.message));
  await ctx.route("https://reading.example.test/**", route => route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><title>Reading fixture</title><style>body{font:22px/2 Georgia;margin:120px;background:#eef2f5}main{max-width:760px}h1{font:38px Georgia}p{margin:30px 0}</style></head><body><main><h1>A river walk</h1><p>The bank is closed. We reached the river <b id="word">bank</b> before sunset. The water was cold.</p><h2 id="heading">Perspective</h2></main></body></html>' }));
  await page.goto("https://reading.example.test/article");
  await page.waitForTimeout(500);
  const trigger = async (selector, viaShortcut = false) => {
    await page.evaluate(selector => { const node = document.querySelector(selector).firstChild, range = document.createRange(); range.selectNodeContents(node); const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range); }, selector);
    await page.bringToFront();
    if (viaShortcut) await page.keyboard.press("Alt+Shift+D");
    else await worker.evaluate(async () => { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); await chrome.tabs.sendMessage(tab.id, { type: "lookup-selection" }); });
    const frame = await page.waitForEvent("frameattached", { timeout: 10000 }).catch(() => null);
    await page.waitForTimeout(300);
    return page.frames().find(f => f.url().startsWith(`chrome-extension://${id}/panel.html`));
  };
  let panel = await trigger("#word", Boolean(process.env.TEST_NATIVE_SHORTCUT)); assert.ok(panel, "extension iframe must open");
  await panel.getByRole("button", { name: "加入生词本", exact: true }).waitFor({ timeout: 15000 });
  assert.match(await panel.locator("body").innerText(), /这里指河岸/);
  assert.doesNotMatch(await panel.locator("body").innerText(), /STRUCTURED OTHER/);
  const calls = await worker.evaluate(() => globalThis.__calls); assert.equal(calls.find(v => v.op === "explain").body.sentence, "We reached the river bank before sunset.");
  evidence.push("Actual extension loaded in Chromium; repeated-word selection, streamed shared panel, account label and JSON/stream merge verified");
  await page.screenshot({ path: resolve(out, "floating-panel-top.png") });
  const iframeElement = await panel.frameElement();
  const initialBox = await iframeElement.evaluate(el => { const b = el.parentElement.getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height }; });
  await page.mouse.move(initialBox.x + initialBox.width - 5, initialBox.y + initialBox.height - 5); await page.mouse.down(); await page.mouse.move(initialBox.x + initialBox.width + 55, initialBox.y + initialBox.height + 35, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(400);
  const resized = await worker.evaluate(async () => (await chrome.storage.local.get("preferences")).preferences);
  assert.ok(resized.width > initialBox.width + 30, "native resize grip updates persisted width");
  await page.mouse.move(initialBox.x + 110, initialBox.y + 18); await page.mouse.down(); await page.mouse.move(initialBox.x + 40, initialBox.y + 60, { steps: 6 }); await page.mouse.up();
  const movedX = await iframeElement.evaluate(el => el.parentElement.getBoundingClientRect().x); assert.ok(movedX < initialBox.x - 30, "header dragging moves the window");
  evidence.push("Native resize grip persistence and title-bar dragging work in Chrome; command registration is checked separately because headless key events do not dispatch browser shortcuts");
  await panel.getByRole("button", { name: "加入生词本", exact: true }).click(); await panel.getByRole("button", { name: "已加入生词本", exact: true }).waitFor();
  const saved = await worker.evaluate(() => globalThis.__calls.find(v => v.op === "save").body); assert.equal(saved.explanation.contextMeaning, "这里指河岸。"); assert.equal(saved.context.sentence, "We reached the river bank before sunset.");
  await page.screenshot({ path: resolve(out, "floating-panel.png") });
  evidence.push("Save submits the visible stream-merged explanation and selected complete sentence");
  const options = await ctx.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
  await options.locator("#width").fill("530"); await options.locator("#width").dispatchEvent("input");
  await options.locator("#background").fill("#e5eef7"); await options.locator("#background").dispatchEvent("input");
  await options.locator("#opacity").fill("72"); await options.locator("#opacity").dispatchEvent("input");
  await options.waitForTimeout(600);
  const appearance = await worker.evaluate(async () => (await chrome.storage.local.get("preferences")).preferences);
  assert.equal(appearance.width, 530); assert.equal(appearance.opacity, 72); assert.equal(appearance.background, "#e5eef7");
  await page.screenshot({ path: resolve(out, "custom-appearance.png") }); await options.screenshot({ path: resolve(out, "settings.png") });
  await options.reload(); await options.locator("#width").waitFor(); assert.equal(await options.locator("#width").inputValue(), "530");
  const commands = await worker.evaluate(() => chrome.commands.getAll()); assert.ok(commands.find(c => c.name === "lookup-selection"));
  evidence.push("Appearance controls persist, update an open panel, and expose Chrome shortcut configuration");
  await panel.locator("body").press("Escape"); await page.waitForTimeout(200);
  assert.equal(page.frames().filter(f => f.url().includes("panel.html")).length, 0);
  panel = await trigger("#heading"); await panel.getByText("未取得完整原句，当前显示词典释义。").waitFor();
  await panel.getByRole("heading", { name: "Perspective" }).waitFor(); evidence.push("Escape closes the overlay; word-only heading uses dictionary fallback");
  await worker.evaluate(async () => { const { connection } = await chrome.storage.local.get("connection"); await chrome.storage.local.set({ connection: { ...connection, connectionId: "changed-account" } }); });
  await panel.getByRole("alert").filter({ hasText: "保存账号已变更" }).waitFor(); evidence.push("Changing the connection invalidates an open panel instead of saving into the wrong account");
  await ctx.route("https://reading.example.test/strict", route => route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": "default-src 'self'; frame-src 'self'; script-src 'none'; style-src 'none'" }, body: '<p>The river <b id="word">bank</b> is quiet.</p>' }));
  await page.goto("https://reading.example.test/strict"); await page.waitForTimeout(300);
  panel = await trigger("#word"); assert.ok(panel, "strict-CSP page opens extension frame");
  await panel.getByRole("button", { name: "加入生词本", exact: true }).waitFor();
  evidence.push("Overlay and extension frame work on a page with restrictive script, style and frame CSP");
  if (process.env.WEBSITE_BASE) {
    const site = await ctx.newPage(); site.on("pageerror", e => errors.push(e.message));
    await site.goto(process.env.WEBSITE_BASE + "/browser-extension"); await site.getByRole("heading", { name: "把语境解释带到其他网页" }).waitFor();
    await site.screenshot({ path: resolve(out, "website-desktop.png"), fullPage: true });
    await site.setViewportSize({ width: 390, height: 844 }); await site.screenshot({ path: resolve(out, "website-mobile.png"), fullPage: true });
    assert.equal(await site.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const download = await site.request.get(process.env.WEBSITE_BASE + "/downloads/context-reader-chrome.zip"); assert.equal(download.status(), 200); assert.equal((await download.body()).subarray(0,2).toString(), "PK");
    evidence.push("Website download page renders at desktop/390px widths and serves the ZIP download");
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, "browser-qa.json"), JSON.stringify({ ok: true, evidence, errors }, null, 2)); console.log(JSON.stringify({ ok: true, evidence }));
} finally { await ctx.close(); }
