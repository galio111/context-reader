import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

test("video warms before playback and stale promises cannot stop a new generation", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const pending = []; let pauses = 0;
  dom.window.HTMLMediaElement.prototype.play = function () { return new Promise((resolve, reject) => pending.push({ resolve, reject })); };
  dom.window.HTMLMediaElement.prototype.pause = () => { pauses++; };
  const source = readFileSync(new URL("../components/ShowcaseRecording.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("export function ShowcaseRecording")).replace("export function", "function");
  const context = { React, useRef: React.useRef, useState: React.useState, useEffect: React.useEffect, window: dom.window, styles: {} };
  vm.runInNewContext(ts.transpileModule(component + "\nglobalThis.Recording=ShowcaseRecording;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const host = dom.window.document.getElementById("root"); const root = createRoot(host);
  const render = (warm, playing) => act(async () => root.render(React.createElement(context.Recording, { src: "/showcase/publications-v3.mp4", label: "test", warm, playing, onBuffered() {} })));
  try {
    await render(false, false); assert.equal(host.querySelector("video").getAttribute("src"), null);
    await render(true, false);
    assert.equal(host.querySelector("video").getAttribute("src"), "/showcase/publications-v3.mp4");
    assert.equal(pending.length, 0); assert.equal(host.querySelector("video").defaultMuted, true);
    await render(true, true); assert.equal(pending.length, 1);
    await render(true, false); await render(true, true); assert.equal(pending.length, 2);
    const afterNewGeneration = pauses;
    await act(async () => pending[0].resolve()); assert.equal(pauses, afterNewGeneration);
    await act(async () => pending[1].resolve()); assert.equal(pauses, afterNewGeneration);
    await render(true, false); await render(true, true);
    await act(async () => pending[2].reject(Object.assign(new Error("cancelled"), { name: "AbortError" })));
    assert.equal(host.querySelector("button"), null, "cancellation must not be labelled autoplay denial");
    await render(true, false); await render(true, true);
    // VM realm Error must be used to exercise DOMException's name across realms.
    await act(async () => pending[3].reject(vm.runInNewContext('Object.assign(new Error("policy"), {name:"NotAllowedError"})', context)));
    assert.equal(host.querySelector("button")?.textContent, "播放演示");
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
