// Run with PLAYWRIGHT_PACKAGE=<absolute package.json> and AUDIO_FIXTURE=<MP3>.
// Exercises the real component in three engines; does not claim physical Safari listening.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
const {default: nextConfig} = await import(pathToFileURL(resolve("next.config.ts")).href);
const policies = await nextConfig.headers();
const csp = policies.find(rule => rule.source === "/").headers.find(header => header.key === "Content-Security-Policy").value;
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE || import.meta.url);
const engines = require("playwright");
const output = resolve(process.env.AUDIO_OUTPUT || "artifacts/pronunciation-browser");
await mkdir(output, { recursive: true });
const audio = await readFile(process.env.AUDIO_FIXTURE);
const bundle = await build({ stdin: { contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {PronunciationButtons} from ${JSON.stringify(process.env.AUDIO_COMPONENT || "./components/PronunciationButtons")};
function App(){const [word,setWord]=React.useState('contemplate');return <><button onClick={()=>setWord(word==='contemplate'?'alternate':'lever')}>Change word</button><PronunciationButtons text={word} preload={location.search.includes('preload')} allowBrowserFallback={false}/></>}
createRoot(document.getElementById('app')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
  nodePaths: [resolve("node_modules")], bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
let requests = 0;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Security-Policy", csp);
  if (req.url === "/bundle.js") { res.setHeader("content-type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/api/pronunciation") { requests++; let body=""; for await (const chunk of req) body+=chunk; const slow=req.headers.referer?.includes("slow-load") && JSON.parse(body).text==="contemplate"; await new Promise(r => setTimeout(r, slow ? 6200 : 250)); res.setHeader("content-type", "audio/mpeg"); res.end(audio); }
  else { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<html><body><div id="app"></div><script src="/bundle.js"></script></body></html>'); }
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];
try {
  for (const name of (process.env.AUDIO_ENGINES || "chromium,chrome,msedge,firefox,webkit").split(",")) {
    let browser;
    try {
      const chromium = ["chromium", "chrome", "msedge"].includes(name);
      browser = await engines[chromium ? "chromium" : name].launch({ headless: true,
        ...(chromium ? { args: ["--autoplay-policy=user-gesture-required"], ...(name !== "chromium" ? {channel: name} : {}) } : {}) });
    } catch (error) {
      if (process.env.AUDIO_REQUIRE_ENGINES === "1") process.exitCode = 1;
      results.push({engine: name, available: false, error: error.message});
      console.log(`${name}: unavailable (${error.message.split("\n")[0]})`);
      continue;
    }
    try {
      const probe = await browser.newPage();
      const capabilities = await probe.evaluate(() => ({ webAudio: typeof (window.AudioContext || window.webkitAudioContext) === "function", mp3: new Audio().canPlayType("audio/mpeg") }));
      await probe.close();
      if (!capabilities.mp3) {
        if (process.env.AUDIO_REQUIRE_ENGINES === "1") process.exitCode = 1;
        results.push({engine:name,available:false,capabilities,note:"This browser build cannot play MP3."});
        console.log(`${name}: MP3 unavailable in this platform build`);
        continue;
      }
      for (const scenario of (process.env.AUDIO_SCENARIOS || "cold,preload,no-web-audio,denied-resume,hung-resume,decode-failure,slow-load,background").split(",")) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", e => errors.push(e.message));
        await page.addInitScript(({scenario}) => {
          window.__events = [];
          let gesture = false;
          document.addEventListener("click", () => { gesture = true; }, true);
          document.addEventListener("click", () => { gesture = false; });
          const originalPlay = HTMLMediaElement.prototype.play;
          const authorized = new WeakSet(), ids = new WeakMap(); let nextId=0;
          HTMLMediaElement.prototype.play = function() {
            if (!ids.has(this)) ids.set(this, ++nextId);
            const primer = this.loop, id = ids.get(this);
            window.__events.push({ type: "native-play", gesture, primer, id });
            // Strict per-element gesture gate supplements actual browser playback:
            // page-wide activation must not mask creating another player after fetch.
            if (!gesture && !authorized.has(this)) return Promise.reject(new DOMException("fresh element without gesture", "NotAllowedError"));
            if (gesture && !this.muted) authorized.add(this);
            if (!primer) {
              this.addEventListener("playing", () => window.__events.push({ type: "native-playing", id }), { once: true });
              this.addEventListener("ended", () => window.__events.push({ type: "native-ended", id, time: this.currentTime }), { once: true });
            }
            return originalPlay.call(this);
          };
          const C = window.AudioContext || window.webkitAudioContext;
          if (scenario === "no-web-audio") {
            Object.defineProperty(window, "AudioContext", {value: undefined, configurable: true});
            Object.defineProperty(window, "webkitAudioContext", {value: undefined, configurable: true});
          } else if (C) {
            const resume = C.prototype.resume;
            C.prototype.resume = function() {
              window.__events.push({type: "resume", gesture});
              if (scenario === "denied-resume") return Promise.reject(new DOMException("denied", "NotAllowedError"));
              if (scenario === "hung-resume") return new Promise(() => {});
              return resume.call(this);
            };
            if (scenario === "decode-failure") C.prototype.decodeAudioData = () => Promise.reject(new DOMException("decode", "EncodingError"));
          }
        }, {scenario});
        try {
        await page.goto(`${base}/?${scenario}`);
        const us = page.getByRole("button", { name: "播放 contemplate 的美式发音" });
        if (scenario === "preload") await page.waitForTimeout(500);
        await us.click();
        if (scenario === "background") {
          await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
          await page.waitForTimeout(700);
          assert.equal(await us.getAttribute("aria-pressed"), "false");
          assert.equal(await page.evaluate(() => window.__events.some(e => e.type === "native-playing")), false);
          await us.click();
        }
        await page.waitForFunction(() => window.__events.some(e => e.type === "native-ended"), null, {timeout: 16000});
        assert.equal(await page.getByRole("status").count(), 0, "first click succeeds without a retry prompt");
        await us.click(); // warm repeat
        await page.waitForFunction(() => window.__events.filter(e => e.type === "native-ended").length >= 2);
        await page.getByRole("button", {name:"播放 contemplate 的英式发音"}).click();
        await page.waitForFunction(() => window.__events.filter(e => e.type === "native-ended").length >= 3, null, {timeout:16000});
        for (const [word,count] of [["alternate",4],["lever",5]]) {
          await page.getByRole("button", { name: "Change word" }).click();
          const next=page.getByRole("button", {name: `播放 ${word} 的美式发音`});
          await next.click(); // exactly one click for every new word
          await page.waitForFunction(n => window.__events.filter(e => e.type === "native-ended").length >= n, count, {timeout:16000});
          assert.equal(await page.getByRole("status").count(),0);
        }
        const events = await page.evaluate(() => window.__events);
        assert.ok(events.filter(e => e.type === "native-play" && e.primer).every(e => e.gesture), "every primer starts in the gesture");
        assert.ok(events.filter(e => e.type === "native-play" && !e.primer).every(e => e.gesture || events.some(p => p.type === "native-play" && p.primer && p.gesture && p.id === e.id)), "cold word reuses the same authorized player");
        assert.equal(events.filter(e=>e.type==="resume").length,0,"native path is independent of Web Audio");
        assert.deepEqual(errors, []);
        const result = { engine: name, version: browser.version(), scenario, events, errors, passed: true };
        results.push(result); console.log(`${name} ${scenario}: passed`);
        } catch (error) {
          results.push({engine:name,scenario,passed:false,error:error.message,events:await page.evaluate(()=>window.__events),text:await page.locator("body").innerText()});
          console.log(JSON.stringify(results.at(-1)));
          process.exitCode=1;
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
  }
} finally {
  server.close();
  await writeFile(resolve(output, "browser-matrix.json"), JSON.stringify({ contentSecurityPolicy: csp, results, note: `Automated ${process.platform} engines with real MP3; Mac/iOS Safari default-policy and physical listening still require device acceptance.` }, null, 2));
}
