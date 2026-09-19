import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import type { PointerEvent } from "react";
import { useMobileBottomSheet } from "../components/useMobileBottomSheet";

test("mobile sheets retain quarter-height, close below it, and distinguish flicks from paused or cancelled drags", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  Object.defineProperty(dom.window, "innerHeight", { value: 800 });
  const { renderHook, act, cleanup } = await import("@testing-library/react");
  let now = 0, closes = 0;
  const originalNow = performance.now;
  performance.now = () => now;
  const target = { setPointerCapture() {}, hasPointerCapture() { return true; }, releasePointerCapture() {} };
  const event = (y: number) => ({ clientY: y, pointerId: 1, isPrimary: true, button: 0, currentTarget: target }) as unknown as PointerEvent<HTMLElement>;
  const hook = renderHook(({ key }) => useMobileBottomSheet(true, key, 48, () => closes++), { initialProps: { key: 0 } });
  const start = () => act(() => hook.result.current.onResizeStart(event(100)));
  const move = (y: number, ms: number) => act(() => { now += ms; hook.result.current.onResizeMove(event(y)); });
  const end = (y: number) => act(() => hook.result.current.onResizeEnd(event(y)));
  try {
    start(); move(284, 1000); end(284);
    assert.equal(hook.result.current.height, 25);
    assert.equal(closes, 0, "exactly one quarter stays open even after dragging more than 96px");
    start(); move(102, 200); end(102);
    assert.equal(closes, 1, "release below quarter-height closes");
    hook.rerender({ key: 1 });
    assert.equal(hook.result.current.height, 48, "reopening restores initial geometry");
    start(); move(134, 30); end(134);
    assert.equal(closes, 2, "quick downward flick closes above quarter-height");
    hook.rerender({ key: 2 });
    start(); move(134, 30); now += 100; end(134);
    assert.equal(closes, 2, "holding still cancels flick momentum");
    assert.equal(hook.result.current.height, 43.75);
    hook.rerender({ key: 3 });
    start(); move(350, 40);
    act(() => hook.result.current.onResizeCancel(event(350)));
    assert.equal(closes, 2);
    assert.equal(hook.result.current.height, 48, "pointer cancellation restores geometry");
    start(); move(-500, 300); end(-500);
    assert.equal(hook.result.current.height, 82);
    assert.equal(closes, 2, "upward drag only expands");
  } finally {
    cleanup(); performance.now = originalNow; dom.window.close();
  }
});
