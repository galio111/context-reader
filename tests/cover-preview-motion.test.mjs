import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

test("preview and original cover share pointer tilt and nearby cards upgrade to the original image", async () => {
  const source = readFileSync(new URL("../components/HomeRedesign.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("function ArticleCover("), source.indexOf("export function HomeRedesign("));
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map(["window", "document", "IS_REACT_ACT_ENVIRONMENT"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, value });
  const frames = new Map(); let nextFrame = 0;
  dom.window.requestAnimationFrame = fn => { frames.set(++nextFrame, fn); return nextFrame; };
  dom.window.cancelAnimationFrame = id => frames.delete(id);
  const flush = () => { for (let step = 0; frames.size && step < 100; step++) { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(0)); } assert.equal(frames.size, 0); };
  let proximity;
  class Observer { constructor(callback) { proximity = callback; } observe() {} disconnect() {} }
  dom.window.IntersectionObserver = Observer;
  const context = {
    IntersectionObserver: Observer,
    React, useRef: React.useRef, useState: React.useState, useEffect: React.useEffect, window: dom.window,
    styles: { coverSurface: "coverSurface", coverFeatured: "coverFeatured", coverFallback: "coverFallback" },
    Image: ({ unoptimized, fetchPriority, ...props }) => React.createElement("img", props),
  };
  vm.runInNewContext(ts.transpileModule(component + "\nglobalThis.Cover = ArticleCover;", { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const host = dom.window.document.getElementById("root"); const root = createRoot(host);
  const article = { title: "Test", recommendation: { coverImageUrl: "https://example.org/full.webp", coverPreviewDataUrl: "data:image/webp;base64,AAAA" } };
  try {
    await act(async () => root.render(React.createElement(context.Cover, { article })));
    const surface = host.querySelector(".coverSurface"); const preview = surface.querySelector("img[data-cover-preview]");
    assert.ok(preview, "the preview must be an image on the transformed layer, not a flat background");
    assert.equal(surface.querySelectorAll("img").length, 1, "distant cards begin with an inline preview");
    assert.equal(preview.src, article.recommendation.coverPreviewDataUrl);
    await act(async () => proximity([{ isIntersecting: true }]));
    const full = surface.querySelector('img:not([data-cover-preview])');
    assert.equal(full.src, article.recommendation.coverImageUrl, "nearby cards must use the original cover URL without resizing");
    assert.equal(surface.dataset.imageReady, undefined, "keep preview visible until the original loads");
    await act(async () => full.dispatchEvent(new dom.window.Event("load")));
    assert.equal(surface.dataset.imageReady, "true");
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
    assert.match(css, /\.coverSurface > img\[data-cover-preview\] \{[^}]*opacity: 1;/);
  } finally {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
