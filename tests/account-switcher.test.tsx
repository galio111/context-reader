import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import React from "react";

test("switcher keeps current account, explains capacity, confirms removal and recovers from switch errors", async () => {
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  for (const key of ["window", "document", "navigator", "CustomEvent"]) Object.defineProperty(globalThis, key, { configurable: true, value: (dom.window as unknown as Record<string, unknown>)[key] });
  Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });
  const require = createRequire(import.meta.url);
  const provider = require.resolve("../components/AccountProvider.tsx");
  let removed = "", switched = "", logins = 0;
  const state = { account: { profile: { userId: "a" } }, savedAccounts: ["a", "b", "c"].map(userId => ({ userId, nickname: userId, phone: "13800000000" })), isOffline: false,
    openLogin: () => { logins++; }, removeAccount: async (id: string) => { removed = id; state.savedAccounts = state.savedAccounts.filter(a => a.userId !== id); },
    switchAccount: async (id: string) => { switched = id; throw new Error("此账号登录已过期，请移除后重新登录。"); },
  };
  require.cache[provider] = { id: provider, filename: provider, loaded: true, exports: { useAccount: () => state } } as NodeModule;
  const { AccountSwitcher } = require("../components/AccountSwitcher.tsx");
  const { render, fireEvent, act, cleanup } = await import("@testing-library/react");
  try {
    const ui = render(<AccountSwitcher />);
    assert.equal(ui.getByRole("button", { name: "当前账号 a" }).hasAttribute("disabled"), true);
    fireEvent.click(ui.getByRole("button", { name: "添加账号" }));
    assert.match(ui.getByRole("status").textContent ?? "", /三个/); assert.equal(logins, 0);
    fireEvent.click(ui.getAllByRole("button", { name: "移除" })[0]);
    assert.equal(removed, "");
    fireEvent.click(ui.getByRole("button", { name: "取消" })); assert.equal(removed, "");
    fireEvent.click(ui.getAllByRole("button", { name: "移除" })[0]);
    await act(async () => { fireEvent.click(ui.getByRole("button", { name: "移除账号" })); });
    assert.equal(removed, "b");
    fireEvent.click(ui.getByRole("button", { name: "添加账号" })); assert.equal(logins, 1);
    await act(async () => { fireEvent.click(ui.getByRole("button", { name: "切换到 c" })); });
    assert.equal(switched, "c"); assert.match(ui.getByRole("alert").textContent ?? "", /已过期/);
    assert.equal(ui.getByRole("button", { name: "添加账号" }).hasAttribute("disabled"), false);
  } finally { cleanup(); delete require.cache[provider]; dom.window.close(); }
});
