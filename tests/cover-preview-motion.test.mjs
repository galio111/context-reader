import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

test("final clear cover retains pointer tilt, readiness does not remount its motion surface", async () => {
  const source = readFileSync(new URL("../components/ArticleCover.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("export function ArticleCover(")).replace("export function", "function");
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const frames = new Map(); let nextFrame = 0;
  dom.window.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  dom.window.cancelAnimationFrame = id => frames.delete(id);
  const flush = () => { for (let step = 0; frames.size && step < 100; step++) { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(0)); } assert.equal(frames.size, 0); };
  let prepared;
  class ResizeObserver { observe() {} disconnect() {} }
  class Observer { constructor(callback) { proximity = callback; } observe() {} disconnect() {} }
  dom.window.IntersectionObserver = Observer;
  const context = {
    IntersectionObserver: Observer, ResizeObserver,
    prepareCover: (element, options) => { prepared = options; return () => {}; },
    React, useRef: React.useRef, useState: React.useState, useEffect: React.useEffect, window: dom.window,
    styles: { coverSurface: "coverSurface", coverFeatured: "coverFeatured", coverFallback: "coverFallback" },
    Image: ({ unoptimized, fetchPriority, ...props }) => React.createElement("img", props),
  };
  vm.runInNewContext(ts.transpileModule(component + "\nglobalThis.Cover = ArticleCover;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const host = dom.window.document.getElementById("root"); const root = createRoot(host);
  const article = { title: "Test", recommendation: { coverImageUrl: "https://example.org/full.webp", coverPreviewDataUrl: "data:image/webp;base64,AAAA" } };
  try {
    await act(async () => root.render(React.createElement(context.Cover, { article })));
    const surface = host.querySelector(".coverSurface");
    assert.equal(surface.querySelectorAll("img").length, 0, "a distant image must not bypass the media queue");
    assert.equal(surface.textContent, "", "normal photos never become temporary text cards");
    await act(async () => prepared.done({ src: article.recommendation.coverImageUrl, sizes: "480px" }));
    const full = surface.querySelector("img");
    assert.equal(full.src, article.recommendation.coverImageUrl);
    assert.equal(surface.dataset.imageReady, "true");
    assert.equal(host.querySelector(".coverSurface"), surface, "decoded readiness retains the motion surface");
    assert.equal(surface.querySelector('[data-cover-preview]'), null);
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300 });
    surface.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 390, clientY: 20 })); flush();
    assert.ok(parseFloat(surface.style.getPropertyValue("--rotate-y")) > 5);
    assert.ok(parseFloat(surface.style.getPropertyValue("--rotate-x")) > 3);
    surface.dispatchEvent(new dom.window.MouseEvent("pointerout", { bubbles: true })); flush();
    assert.ok(Math.abs(parseFloat(surface.style.getPropertyValue("--rotate-y"))) < .02);
    await act(async () => root.render(React.createElement(context.Cover, { article, motion3dEnabled: false })));
    surface.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, clientX: 390, clientY: 20 }));
    assert.equal(frames.size, 0, "the user's disabled-motion preference must stop pointer animation");
    const css = readFileSync(new URL("../components/HomeRedesign.module.css", import.meta.url), "utf8");
    assert.match(css, /\.coverSurface > img \{[^}]*rotateX\(var\(--rotate-x\)\) rotateY\(var\(--rotate-y\)\)/);

  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
