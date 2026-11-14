import { extractSelection } from "./context.mjs";
import { rgba } from "./preferences.mjs";

let host = null, captured = null, pending = 0, selectionVersion = 0;
let activeBox = null, activeIframe = null, pinned = false, pinnedPosition = null;
let pointerOrigin = null;
const message = body => chrome.runtime.sendMessage(body);
const inside = event => Boolean(host && event.composedPath().includes(host));
const clamp = (value, size, viewport) => Math.max(8, Math.min(value, viewport - size - 8));
function rememberPosition() {
  if (pinned && activeBox) pinnedPosition = { left: activeBox.offsetLeft, top: activeBox.offsetTop };
}
function close() {
  rememberPosition(); pending++; selectionVersion++;
  host?.remove(); host = null; activeBox = null; activeIframe = null;
}
document.addEventListener("pointerdown", event => {
  if (inside(event)) return;
  const selection = document.getSelection();
  pointerOrigin = { x: event.clientX, y: event.clientY, range: selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null };
  captured = null; selectionVersion++;
  if (!pinned) close();
}, true);
document.addEventListener("pointerup", async event => {
  if (inside(event)) return;
  const selected = extractSelection(document), version = ++selectionVersion;
  captured = selected;
  if (!selected || event.button !== 0) return;
  const range = document.getSelection()?.getRangeAt(0), previous = pointerOrigin?.range;
  const unchanged = range && previous && range.startContainer === previous.startContainer && range.startOffset === previous.startOffset && range.endContainer === previous.endContainer && range.endOffset === previous.endOffset;
  if (unchanged && Math.hypot(event.clientX - pointerOrigin.x, event.clientY - pointerOrigin.y) < 3) { captured = null; return; }
  try {
    const { preferences } = await message({ type: "preferences" });
    if (preferences.autoLookup && version === selectionVersion) show(selected).catch(() => {});
  } catch {}
});
function appearance(p) {
  if (!activeBox) return;
  activeBox.style.setProperty("--paper", rgba(p.background, p.opacity));
  activeBox.style.setProperty("--ink", p.text);
  activeBox.style.setProperty("--accent", p.accent);
  activeBox.style.width = `${Math.min(p.width, innerWidth - 16)}px`;
  activeBox.style.height = `${Math.min(p.height, innerHeight - 16)}px`;
  activeBox.style.left = `${clamp(activeBox.offsetLeft, activeBox.offsetWidth, innerWidth)}px`;
  activeBox.style.top = `${clamp(activeBox.offsetTop, activeBox.offsetHeight, innerHeight)}px`;
  rememberPosition();
}
async function show(context) {
  const ticket = ++pending;
  const result = await message({ type: "prepare", context });
  if (ticket !== pending || result.error) return;
  if (pinned && activeBox && activeIframe) {
    rememberPosition();
    // A hash-only navigation would keep the previous React lookup mounted.
    const nextIframe = activeIframe.cloneNode(false);
    nextIframe.src = chrome.runtime.getURL(`panel.html#${result.nonce}`);
    activeIframe.replaceWith(nextIframe); activeIframe = nextIframe;
    return;
  }
  host?.remove();
  host = document.createElement("div"); host.dataset.contextReaderExtension = "";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `*{box-sizing:border-box}.window{position:fixed;display:flex;flex-direction:column;resize:both;overflow:hidden;min-width:280px;min-height:220px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);border:1px solid #868e9644;border-radius:14px;font:13px/1.4 system-ui,sans-serif;color:var(--ink);background:var(--paper)}header{height:40px;flex-shrink:0;display:flex;gap:6px;align-items:center;padding:0 10px;cursor:move;border-bottom:1px solid #868e9633;touch-action:none}header span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button{border:0;background:transparent;color:inherit;padding:5px;cursor:pointer;font:inherit;border-radius:6px;min-width:28px;min-height:28px}button:hover{background:#868e9620}button:focus-visible{outline:1px solid currentColor}.pin{display:grid;place-items:center}.pin[aria-pressed=true]{color:var(--accent);background:#868e9620}.pin svg{width:16px;height:16px;transform:rotate(35deg)}.pin[aria-pressed=true] svg{transform:none}iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:transparent}.grip{position:absolute;right:2px;bottom:2px;width:14px;height:14px;pointer-events:none;color:var(--ink);opacity:.5}`;
  const box = document.createElement("section"); box.className = "window";
  box.setAttribute("aria-label", "Context Reader 划词解释"); activeBox = box;
  const prefs = result.preferences, width = Math.min(prefs.width, innerWidth - 16), height = Math.min(prefs.height, innerHeight - 16);
  box.style.width = `${width}px`; box.style.height = `${height}px`;
  box.style.setProperty("--paper", rgba(prefs.background, prefs.opacity));
  box.style.setProperty("--ink", prefs.text); box.style.setProperty("--accent", prefs.accent);
  const anchoredTop = context.rect.bottom + 8 + height <= innerHeight - 8 ? context.rect.bottom + 8 : context.rect.top - height - 8;
  const position = pinned && pinnedPosition ? pinnedPosition : { left: context.rect.left, top: anchoredTop };
  box.style.left = `${clamp(position.left, width, innerWidth)}px`;
  box.style.top = `${clamp(position.top, height, innerHeight)}px`;
  const header = document.createElement("header"), title = document.createElement("span");
  title.textContent = "Context Reader";
  const pin = document.createElement("button"); pin.className = "pin";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.8"); svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", "M16 3 21 8 17 9 15 15 9 9 15 7Z M9 9 6 12 12 18 15 15 M9 15 3 21"); svg.append(path); pin.append(svg);
  const paintPin = () => { pin.setAttribute("aria-pressed", String(pinned)); pin.setAttribute("aria-label", pinned ? "取消固定弹窗位置" : "固定弹窗位置"); pin.title = pinned ? "已固定：新查询保留当前位置，点击取消固定" : "固定位置：新查询不再跟随所选文字"; };
  paintPin();
  pin.onclick = () => { pinned = !pinned; if (pinned) rememberPosition(); else pinnedPosition = null; paintPin(); };
  const settings = document.createElement("button"); settings.textContent = "外观";
  settings.title = "调整大小、颜色和透明度"; settings.onclick = () => message({ type: "open-settings" });
  const dismiss = document.createElement("button"); dismiss.textContent = "×"; dismiss.setAttribute("aria-label", "关闭解释"); dismiss.onclick = close;
  header.append(title, pin, settings, dismiss);
  const iframe = document.createElement("iframe"); iframe.title = "Context Reader 语境解释";
  iframe.src = chrome.runtime.getURL(`panel.html#${result.nonce}`); iframe.allow = "clipboard-write"; activeIframe = iframe;
  const grip = document.createElement("span"); grip.className = "grip"; grip.textContent = "◢";
  box.append(header, iframe, grip); shadow.append(style, box); document.documentElement.append(host);
  let drag = null;
  header.onpointerdown = event => { if (event.target.closest("button")) return; drag = { x: event.clientX - box.offsetLeft, y: event.clientY - box.offsetTop }; header.setPointerCapture(event.pointerId); };
  header.onpointermove = event => { if (!drag) return; box.style.left = `${clamp(event.clientX - drag.x, box.offsetWidth, innerWidth)}px`; box.style.top = `${clamp(event.clientY - drag.y, box.offsetHeight, innerHeight)}px`; rememberPosition(); };
  header.onpointerup = header.onpointercancel = () => { drag = null; };
  let resizeTimer;
  const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (box.isConnected) message({ type: "resize", width: box.offsetWidth, height: box.offsetHeight }); }, 250); });
  observer.observe(box);
  const localHost = host;
  const watcher = new MutationObserver(() => { if (!localHost.isConnected) { observer.disconnect(); watcher.disconnect(); clearTimeout(resizeTimer); } });
  watcher.observe(document.documentElement, { childList: true });
}
document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
chrome.runtime.onMessage.addListener(body => {
  if (body.type === "appearance") appearance(body.preferences);
  if (body.type === "lookup-selection") { const context = extractSelection(document) || captured; if (context) show(context).catch(() => {}); }
});
window.addEventListener("message", event => { if (host && event.source === activeIframe?.contentWindow && event.data?.type === "cr-close-panel") close(); });
window.addEventListener("resize", () => { message({ type: "preferences" }).then(result => appearance(result.preferences)).catch(() => {}); });
