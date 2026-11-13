import { extractSelection } from "./context.mjs";
import { rgba } from "./preferences.mjs";
let host = null, captured = null, pending = 0, activeBox = null, activeIframe = null;
const message = body => chrome.runtime.sendMessage(body);
document.addEventListener("pointerup", async event => {
  if (host && event.composedPath().includes(host)) return;
  const selected = extractSelection(document);
  captured = selected;
  if (!selected || event.button !== 0) return;
  try { const { preferences } = await message({ type: "preferences" }); if (preferences.autoLookup) show(selected); } catch {}
});
function close() { pending++; host?.remove(); host = null; activeBox = null; activeIframe = null; }
function appearance(p) {
  if (!activeBox) return;
  activeBox.style.setProperty("--paper", rgba(p.background, p.opacity)); activeBox.style.setProperty("--ink", p.text);
  activeBox.style.width = `${Math.min(p.width, innerWidth - 16)}px`; activeBox.style.height = `${Math.min(p.height, innerHeight - 16)}px`;
  activeBox.style.left = `${Math.max(8, Math.min(activeBox.offsetLeft, innerWidth - activeBox.offsetWidth - 8))}px`;
  activeBox.style.top = `${Math.max(8, Math.min(activeBox.offsetTop, innerHeight - activeBox.offsetHeight - 8))}px`;
}
async function show(context) {
  const ticket = ++pending;
  const result = await message({ type: "prepare", context });
  if (ticket !== pending || result.error) return;
  host?.remove();
  host = document.createElement("div"); host.dataset.contextReaderExtension = "";
  host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;width:0!important;height:0!important;z-index:2147483647!important;";
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style"); style.textContent = `*{box-sizing:border-box} .window{position:fixed;display:flex;flex-direction:column;resize:both;overflow:hidden;min-width:280px;min-height:220px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);border:1px solid #868e9644;border-radius:14px;font:13px/1.4 system-ui,sans-serif;color:var(--ink);background:var(--paper)} header{height:40px;flex-shrink:0;display:flex;gap:8px;align-items:center;padding:0 10px;cursor:move;border-bottom:1px solid #868e9633;touch-action:none} header span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}button{border:0;background:transparent;color:inherit;padding:5px;cursor:pointer;font:inherit;border-radius:6px}button:hover{background:#868e9620}button:focus-visible{outline:1px solid currentColor}iframe{display:block;width:100%;flex:1;min-height:0;border:0;background:transparent} .grip{position:absolute;right:2px;bottom:2px;width:14px;height:14px;pointer-events:none;color:var(--ink);opacity:.5}`;
  const box = document.createElement("section"); box.className = "window"; box.setAttribute("aria-label", "Context Reader 划词解释");
  activeBox = box;
  const prefs = result.preferences;
  box.style.width = `${Math.min(prefs.width, innerWidth - 16)}px`; box.style.height = `${Math.min(prefs.height, innerHeight - 16)}px`;
  box.style.setProperty("--paper", rgba(prefs.background, prefs.opacity)); box.style.setProperty("--ink", prefs.text);
  const left = Math.min(innerWidth - Math.min(prefs.width, innerWidth - 16) - 8, Math.max(8, context.rect.left));
  const top = context.rect.bottom + 8 + prefs.height <= innerHeight ? context.rect.bottom + 8 : Math.max(8, innerHeight - Math.min(prefs.height, innerHeight - 16) - 8);
  box.style.left = `${left}px`; box.style.top = `${top}px`;
  const header = document.createElement("header"), title = document.createElement("span");
  title.textContent = `Context Reader · ${result.nickname}`;
  const settings = document.createElement("button"); settings.textContent = "外观"; settings.title = "调整大小、颜色和透明度"; settings.onclick = () => message({ type: "open-settings" });
  const dismiss = document.createElement("button"); dismiss.textContent = "×"; dismiss.setAttribute("aria-label", "关闭解释"); dismiss.onclick = close;
  header.append(title, settings, dismiss);
  const iframe = document.createElement("iframe"); iframe.title = "Context Reader 语境解释"; iframe.src = chrome.runtime.getURL(`panel.html#${result.nonce}`); iframe.allow = "clipboard-write";
  activeIframe = iframe;
  const grip = document.createElement("span"); grip.className = "grip"; grip.textContent = "◢";
  box.append(header, iframe, grip); shadow.append(style, box); document.documentElement.append(host);
  let drag = null;
  header.onpointerdown = e => { if (e.target.closest("button")) return; drag = { x: e.clientX - box.offsetLeft, y: e.clientY - box.offsetTop }; header.setPointerCapture(e.pointerId); };
  header.onpointermove = e => { if (drag) { box.style.left = `${Math.max(8, Math.min(innerWidth - box.offsetWidth - 8, e.clientX - drag.x))}px`; box.style.top = `${Math.max(8, Math.min(innerHeight - 40, e.clientY - drag.y))}px`; } };
  header.onpointerup = () => { drag = null; };
  let resizeTimer;
  const observer = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (box.isConnected) message({ type: "resize", width: box.offsetWidth, height: box.offsetHeight }); }, 250); });
  observer.observe(box);
  const localHost = host;
  const watcher = new MutationObserver(() => { if (!localHost.isConnected) { observer.disconnect(); watcher.disconnect(); clearTimeout(resizeTimer); } }); watcher.observe(document.documentElement, { childList: true });
}
document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
chrome.runtime.onMessage.addListener(message => { if (message.type === "appearance") appearance(message.preferences); if (message.type === "lookup-selection") { const context = extractSelection(document) || captured; if (context) show(context).catch(() => {}); } });
window.addEventListener("message", event => { if (!host || event.source !== activeIframe?.contentWindow) return; if (event.data?.type === "cr-close-panel") close(); });
window.addEventListener("resize", () => { message({ type: "preferences" }).then(r => appearance(r.preferences)).catch(() => {}); });
