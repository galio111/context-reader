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
import {PronunciationButtons} from './components/PronunciationButtons';
function App(){const [word,setWord]=React.useState('contemplate');return <><button onClick={()=>setWord('alternate')}>Change word</button><PronunciationButtons text={word} preload={location.search.includes('preload')} allowBrowserFallback={false}/></>}
createRoot(document.getElementById('app')).render(<App/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
let requests = 0;
const server = createServer(async (req, res) => {
  res.setHeader("Content-Security-Policy", csp);
  if (req.url === "/bundle.js") { res.setHeader("content-type", "application/javascript"); res.end(bundle.outputFiles[0].text); }
  else if (req.url === "/api/pronunciation") { requests++; await new Promise(r => setTimeout(r, 250)); res.setHeader("content-type", "audio/mpeg"); res.end(audio); }
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
      results.push({engine: name, available: false, error: error.message});
      console.log(`${name}: unavailable (${error.message.split("\n")[0]})`);
      continue;
    }
    try {
      const probe = await browser.newPage();
      const capabilities = await probe.evaluate(() => ({ webAudio: typeof (window.AudioContext || window.webkitAudioContext) === "function", mp3: new Audio().canPlayType("audio/mpeg") }));
      await probe.close();
      if (!capabilities.webAudio) {
        results.push({engine:name,available:false,capabilities,note:"This browser build has no Web Audio; it cannot validate the cold-playback matrix."});
        console.log(`${name}: Web Audio unavailable in this platform build`);
        continue;
      }
      for (const scenario of ["cold", "preload", "denied-resume", "hung-resume", "decode-failure", "background"]) {
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
          HTMLMediaElement.prototype.play = function() {
            window.__events.push({ type: "native-play", gesture });
            this.addEventListener("playing", () => window.__events.push({ type: "native-playing" }), { once: true });
            this.addEventListener("ended", () => window.__events.push({ type: "native-ended", time: this.currentTime }), { once: true });
            return originalPlay.call(this);
          };
          const C = window.AudioContext || window.webkitAudioContext;
          const resume = C.prototype.resume;
          C.prototype.resume = function() {
            window.__events.push({ type: "resume", gesture });
            if (scenario === "denied-resume") return Promise.reject(new DOMException("denied", "NotAllowedError"));
            if (scenario === "hung-resume") { void this.suspend(); return new Promise(() => {}); }
            return resume.call(this);
          };
          if (scenario === "decode-failure") C.prototype.decodeAudioData = () => Promise.reject(new DOMException("decode", "EncodingError"));
          const start = AudioBufferSourceNode.prototype.start;
          AudioBufferSourceNode.prototype.start = function(...args) {
            const real = this.buffer && this.buffer.length > 1;
            window.__events.push({ type: real ? "buffer-start" : "warmup", gesture, state: this.context.state });
            if (real) this.addEventListener("ended", () => window.__events.push({ type: "buffer-ended", time: this.context.currentTime }), { once: true });
            return start.apply(this, args);
          };
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
          assert.equal(await page.evaluate(() => window.__events.some(e => e.type === "buffer-start")), false);
          await us.click();
        }
        if (["denied-resume", "hung-resume", "decode-failure"].includes(scenario)) {
          await page.getByText("声音未能启动，请再点一次发音按钮。").waitFor();
          assert.equal(await us.getAttribute("aria-busy"), "false");
          const before = requests;
          await us.click();
          assert.equal(requests, before, "retry does not regenerate");
        }
        await page.waitForFunction(() => window.__events.some(e => ["native-ended", "buffer-ended"].includes(e.type)), {timeout: 12000});
        await us.click(); // repeat uses prepared audio in a fresh gesture
        await page.waitForFunction(() => window.__events.filter(e => ["native-ended", "buffer-ended"].includes(e.type)).length >= 2);
        await page.getByRole("button", { name: "Change word" }).click();
        assert.equal(await page.getByRole("button", { name: "播放 alternate 的美式发音" }).getAttribute("aria-pressed"), "false");
        const events = await page.evaluate(() => window.__events);
        assert.ok(events.filter(e => e.type === "native-play").every(e => e.gesture), "native recording playback must be in click");
        assert.ok(events.filter(e => e.type === "resume").every(e => e.gesture));
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
  await writeFile(resolve(output, "browser-matrix.json"), JSON.stringify({ contentSecurityPolicy: csp, results, note: "Automated Windows engines with real MP3; Mac/iOS Safari default-policy and physical listening still require device acceptance." }, null, 2));
}
