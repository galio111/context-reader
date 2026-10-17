import test from "node:test";
import assert from "node:assert/strict";
import { readRefreshState, writeRefreshState } from "../lib/refreshContinuity";

test("refresh presentation is isolated by account and tolerates corrupt or unavailable tab storage", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) } });
  try {
    writeRefreshState("page", "account-a", { reader: { article: "private article" } });
    assert.deepEqual(readRefreshState("page", "account-a"), { reader: { article: "private article" } });
    assert.equal(readRefreshState("page", "account-b"), null);
    assert.equal(readRefreshState("page", "guest"), null);
    data.set("context-reader:refresh:page", "broken");
    assert.equal(readRefreshState("page", "account-a"), null);
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    assert.doesNotThrow(() => writeRefreshState("page", "account-a", {}));
    assert.equal(readRefreshState("page", "account-a"), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, "sessionStorage", previous);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
