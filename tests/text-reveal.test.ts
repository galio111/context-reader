import test from "node:test";
import assert from "node:assert/strict";
import { createTextReveal } from "../lib/textReveal";

function fixture(immediate = false) {
  let now = 0, id = 0;
  const tasks = new Map<number, () => void>();
  const frames: string[] = [];
  const controller = new AbortController();
  const reveal = createTextReveal({ signal: controller.signal, write: text => frames.push(text),
    immediate: () => immediate, now: () => now,
    schedule: callback => { tasks.set(++id, callback); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: timer => { tasks.delete(timer as unknown as number); },
  });
  const step = () => { now += 24; const batch = [...tasks.values()]; tasks.clear(); batch.forEach(fn => fn()); };
  return { reveal, frames, controller, tasks, step, get now() { return now; } };
}

test("a buffered full response finishes over multiple frames within 720ms", async () => {
  const f = fixture(); const text = "当前语境含义：" + "恢复能力😀".repeat(100);
  f.reveal.append(text);
  const done = f.reveal.finish(text);
  f.step(); assert.ok(f.frames[0].length > 0 && f.frames[0].length < text.length);
  while (f.tasks.size) f.step(); await done;
  assert.equal(f.frames.at(-1), text); assert.ok(f.now <= 720);
  assert.ok(f.frames.every(frame => text.startsWith(frame) && !/[\uD800-\uDBFF]$/.test(frame)));
});

test("incremental input stays progressive; structured repair also drains", async () => {
  const f = fixture(); f.reveal.append("基础释义：恢复"); f.step();
  f.reveal.append("能力\n当前语境含义：" + "有韧性".repeat(80)); f.step();
  const corrected = "基础释义：有韧性\n当前语境含义：" + "能够恢复".repeat(80);
  const done = f.reveal.finish(corrected);
  while (f.tasks.size) f.step(); await done;
  assert.equal(f.frames.at(-1), corrected);
});

test("cancellation settles completion and never writes into the next lookup", async () => {
  const f = fixture(); f.reveal.append("旧解释".repeat(200)); f.step();
  const done = f.reveal.finish(); const before = f.frames.length;
  f.controller.abort(); f.step(); f.reveal.append("stale"); await done;
  assert.equal(f.frames.length, before); assert.equal(f.tasks.size, 0);
});

test("reduced motion and hidden pages finish at the next tick", async () => {
  const f = fixture(true); const text = "无需动画".repeat(100); f.reveal.append(text);
  const done = f.reveal.finish(); f.step(); await done;
  assert.deepEqual(f.frames, [text]); f.reveal.dispose();
});
