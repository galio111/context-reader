import { normalizePreferences } from "./preferences.mjs";

const SITE = "https://context-reader.com";
const extensionOrigin = chrome.runtime.getURL("").replace(/\/$/, "");
const operations = new Set(["explain", "stream", "dictionary", "ask", "pronunciation", "save", "save-sentence", "account", "translate"]);
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
async function state() { const s = await chrome.storage.local.get(["preferences", "connection"]); return { preferences: normalizePreferences(s.preferences), connection: s.connection || null }; }
function panelNonce(sender) {
  try { const u = new URL(sender.url); return u.protocol === "chrome-extension:" && u.host === chrome.runtime.id && u.pathname === "/panel.html" ? u.hash.slice(1) : ""; } catch { return ""; }
}
async function lookupSession(sender, suppliedNonce) {
  const nonce = panelNonce(sender);
  if (!nonce || suppliedNonce && nonce !== suppliedNonce) throw new Error("取词窗口已关闭，请重新划词。");
  const stored = (await chrome.storage.session.get("lookups")).lookups || {};
  const session = stored[nonce];
  if (!session || session.tabId !== sender.tab?.id || Date.now() - session.createdAt > 30 * 60 * 1000) throw new Error("取词窗口已过期，请重新划词。");
  const { connection } = await state();
  if (!connection || connection.connectionId !== session.connectionId) throw new Error("保存账号已变更，请重新划词。");
  return { ...session, connection };
}
async function api(connection, operation, body, signal, actionId) {
  const response = await fetch(`${SITE}/api/extension/execute/${operation}`, { method: "POST", credentials: "omit", cache: "no-store",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${connection.token}`, ...(actionId ? { "x-context-action-id": actionId } : {}) }, body: JSON.stringify(body || {}), signal });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || (response.status === 429 ? "查询较频繁，请稍后重试。" : "解释服务暂时不可用，请稍后重试。"));
  }
  return response;
}
function trustedPage(sender, path) { return sender.id === chrome.runtime.id && sender.url?.startsWith(`${extensionOrigin}/${path}`); }
async function handle(message, sender) {
  if (message?.type === "preferences") return { preferences: (await state()).preferences };
  if (message?.type === "set-preferences") {
    if (!trustedPage(sender, "options.html") && !panelNonce(sender)) throw new Error("请在扩展设置中调整外观。");
    const preferences = normalizePreferences(message.preferences);
    await chrome.storage.local.set({ preferences });
    for (const tab of await chrome.tabs.query({})) if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "appearance", preferences }).catch(() => {});
    return { preferences };
  }
  if (message?.type === "status" && trustedPage(sender, "options.html")) {
    const s = await state();
    return { preferences: s.preferences, account: s.connection ? { nickname: s.connection.nickname, id: s.connection.accountId } : null };
  }
  if (message?.type === "resize" && sender.tab?.id && !panelNonce(sender)) {
    const s = await state();
    const preferences = normalizePreferences({ ...s.preferences, width: message.width, height: message.height });
    await chrome.storage.local.set({ preferences });
    return { preferences };
  }
  if (message?.type === "prepare" && sender.tab?.id && /^https?:/.test(sender.url || "")) {
    const s = await state();
    if (!s.connection) { await chrome.tabs.create({ url: `${SITE}/browser-extension` }); return { error: "请先在网站连接保存账号。" }; }
    const nonce = crypto.randomUUID();
    const stored = (await chrome.storage.session.get("lookups")).lookups || {};
    const now = Date.now();
    const lookups = Object.fromEntries(Object.entries(stored).filter(([,v]) => v.tabId !== sender.tab.id && now - v.createdAt < 30 * 60 * 1000));
    lookups[nonce] = { context: message.context, tabId: sender.tab.id, createdAt: now, connectionId: s.connection.connectionId };
    await chrome.storage.session.set({ lookups });
    return { nonce, preferences: s.preferences, nickname: s.connection.nickname };
  }
  if (message?.type === "session") {
    const s = await lookupSession(sender, message.nonce);
    return { context: s.context, connectionId: s.connection.connectionId, nickname: s.connection.nickname, preferences: (await state()).preferences };
  }
  if (message?.type === "proxy") {
    const s = await lookupSession(sender);
    if (!operations.has(message.operation) || message.operation === "stream") throw new Error("不支持这项操作。");
    const r = await api(s.connection, message.operation, message.body, AbortSignal.timeout(120000), message.operation === "explain" ? message.actionId : undefined);
    if (message.operation === "pronunciation") {
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 2 * 1024 * 1024) throw new Error("发音文件过大。");
      let binary = ""; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return { binary: btoa(binary), contentType: r.headers.get("content-type") };
    }
    return { data: await r.json() };
  }
  if (message?.type === "open-settings") { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  throw new Error("不支持这项操作。");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(sendResponse).catch(error => sendResponse({ error: error.message || "扩展暂时不可用。" }));
  return true;
});
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (new URL(sender.url || "about:blank").origin !== SITE || new URL(sender.url).pathname !== "/browser-extension") return;
  if (message?.type === "ping") { state().then(s => respond({ installed: true, nickname: s.connection?.nickname || "", connectionId: s.connection?.connectionId || "" })); return true; }
  if (message?.type === "disconnect") {
    (async () => { const s = await state(); if (s.connection?.connectionId === message.connectionId) { await chrome.storage.local.remove("connection"); await chrome.storage.session.set({ lookups: {} }); } respond({ disconnected: true }); })().catch(() => respond({ error: "扩展状态未更新，请重新打开扩展。" }));
    return true;
  }
  if (message?.type !== "connect" || !/^crx_[\w-]{43}$/.test(message.token || "")) return;
  (async () => {
    // Verify the issued token before changing the active save target.
    const response = await api({ token: message.token }, "account", {}, AbortSignal.timeout(15000));
    const account = await response.json();
    const previous = (await state()).connection;
    await chrome.storage.local.set({ connection: { token: message.token, accountId: account.id, nickname: account.nickname, connectionId: account.connectionId } });
    await chrome.storage.session.set({ lookups: {} });
    if (previous && previous.connectionId !== account.connectionId) api(previous, "disconnect", {}, AbortSignal.timeout(15000)).catch(() => {});
    respond({ connected: true, accountId: account.id, connectionId: account.connectionId, previousConnectionId: previous?.connectionId });
  })().catch(error => respond({ error: error.message || "连接失败，请重试。" }));
  return true;
});
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== "explanation-stream" || !panelNonce(port.sender)) return;
  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());
  let started = false;
  port.onMessage.addListener(async message => {
    if (started) return; started = true;
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const session = await lookupSession(port.sender);
      const response = await api(session.connection, "stream", message.context, controller.signal, message.actionId);
      const reader = response.body.getReader(), decoder = new TextDecoder();
      while (true) { const { value, done } = await reader.read(); if (done) break; port.postMessage({ chunk: decoder.decode(value, { stream: true }) }); }
      const tail = decoder.decode(); if (tail) port.postMessage({ chunk: tail });
      port.postMessage({ done: true });
    } catch (error) { try { port.postMessage({ error: controller.signal.aborted ? "查询已停止，请重试。" : error.message }); } catch {} }
    finally { clearTimeout(timer); }
  });
});
async function trigger(tabId) { try { await chrome.tabs.sendMessage(tabId, { type: "lookup-selection" }); } catch { await chrome.action.setBadgeText({ tabId, text: "!" }); await chrome.action.setTitle({ tabId, title: "此页面暂不支持划词。请打开普通网页并刷新后重试。" }); } }
chrome.commands.onCommand.addListener(async command => { if (command !== "lookup-selection") return; const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); if (tab?.id) await trigger(tab.id); });
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === "context-reader-lookup" && tab?.id) trigger(tab.id); });
chrome.runtime.onInstalled.addListener(() => { chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: "context-reader-lookup", title: "用 Context Reader 解释所选文字", contexts: ["selection"], documentUrlPatterns: ["http://*/*", "https://*/*"] })); });
