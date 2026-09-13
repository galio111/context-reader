import { createRequire } from "node:module";
import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import * as React from "react";

test("login completes while historical cache download is blocked, then retry restores exact data", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://context-reader.com" });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent, Event: dom.window.Event, React })) Object.defineProperty(globalThis, key, { configurable: true, value });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  const { render, waitFor, cleanup } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  const require = createRequire(import.meta.url);
  require.extensions[".css"] = module => { module.exports = {}; };
  const { AccountProvider, useAccount } = await import("../components/AccountProvider");
  const { getLearningStorage } = await import("../lib/learningStorage");
  const { readStoredArticles } = await import("../lib/articleStorage");
  const guest = { configured: true, authenticated: false, profile: null, plan: null, usage: [] };
  const member = { ...guest, authenticated: true, profile: { userId: "test-user", nickname: "Test", email: "internal@example.test", phone: "19900000001" }, plan: { id: "free" } };
  const at = "2026-09-13T00:00:00.000Z";
  const article = { id: "a", title: "Test", body: "Persistent article", summary: "", createdAt: at, updatedAt: at, lastOpenedAt: at };
  let authenticated = false, blockCache = true, releaseCache: (() => void) | undefined, learningRequests = 0, cacheFailures = 0, expireSession = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), "https://context-reader.com");
    if (url.pathname === "/api/auth/session") return Response.json({ account: authenticated ? member : guest });
    if (url.pathname === "/api/auth/phone-login") { authenticated = true; return Response.json({ account: member }); }
    if (url.pathname === "/api/account/sync") {
      if (expireSession) return Response.json({ error: "请先登录。" }, { status: 401 });
      const group = url.searchParams.get("group"), phase = url.searchParams.get("bootstrap");
      if (group === "learning") learningRequests++;
      if (group === "cache" && blockCache) { await new Promise<void>(resolve => { releaseCache = resolve; }); cacheFailures++; throw new TypeError("simulated connection interruption"); }
      return Response.json({ objects: group === "learning" && phase === "active" ? [{ kind: "article", objectKey: "a", payload: article, serverVersion: 1, clientUpdatedAt: at }] : [], snapshotCursor: "current", nextOffset: null, hasMore: false, nextCursor: "current" });
    }
    throw new Error(`Unexpected endpoint ${url.pathname}`);
  }) as typeof fetch;
  function Harness() {
    const { account, loading, openLogin, syncNow } = useAccount();
    const [manual, setManual] = React.useState("");
    return <><div data-testid="identity">{loading ? "loading" : account.authenticated ? "signed-in" : "guest"}</div><button onClick={() => openLogin()}>Open login</button><button onClick={() => void syncNow({ reconcile: true, onProgress: p => setManual(p.phase) }).then(() => setManual("complete")).catch(() => setManual("error"))}>Manual sync</button><div data-testid="manual">{manual}</div></>;
  }
  const ui = render(<AccountProvider><Harness /></AccountProvider>);
  try {
    const user = userEvent.setup({ document: dom.window.document });
    await waitFor(() => assert.equal(ui.getByTestId("identity").textContent, "guest"));
    await user.click(ui.getByText("Open login"));
    await user.type(ui.getByPlaceholderText("中国大陆手机号"), "19900000001");
    await user.type(ui.getByPlaceholderText("输入密码"), "Password123");
    const started = Date.now();
    await user.click(ui.container.querySelector<HTMLButtonElement>('form button[type="submit"]')!);
    await waitFor(() => assert.equal(ui.getByTestId("identity").textContent, "signed-in"), { timeout: 2000 });
    assert.equal(ui.queryByPlaceholderText("输入密码"), null, "login modal must close before cache download finishes");
    console.log(JSON.stringify({ loginUiMs: Date.now() - started, cacheStillBlocked: blockCache }));
    await waitFor(() => assert.ok(releaseCache), { timeout: 6000 });
    assert.equal(readStoredArticles(getLearningStorage())[0].id, "a", "learning content precedes caches");
    releaseCache!();
    await waitFor(() => assert.equal(cacheFailures, 1));
    assert.ok(!ui.queryByRole("alert"), "background restore must not create a global banner");
    const beforeRetry = learningRequests;
    blockCache = false;
    await user.click(ui.getByRole("button", { name: "Manual sync" }));
    await waitFor(() => assert.equal(ui.getByTestId("manual").textContent, "complete"));
    assert.ok(!ui.queryByRole("alert"));
    assert.ok(!ui.queryByText(/账号已登录，|正在等待同步服务|重试数据恢复/));
    assert.equal(learningRequests, beforeRetry, "retry resumes after completed learning pages");
    assert.deepEqual(readStoredArticles(getLearningStorage()), [article]);
    expireSession = true; authenticated = false;
    await user.click(ui.getByRole("button", { name: "Manual sync" }));
    await waitFor(() => assert.equal(ui.getByTestId("identity").textContent, "guest"));
    assert.ok(!ui.queryByRole("alert"), "expired session must not claim account is still logged in");
    assert.deepEqual(readStoredArticles(getLearningStorage()), [article], "session expiry preserves learning data");
  } finally { releaseCache?.(); cleanup(); globalThis.fetch = originalFetch; dom.window.close(); }
});
