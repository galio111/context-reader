import { defaults, normalizePreferences, rgba } from "./preferences.mjs";
const fields = Object.keys(defaults), $ = id => document.getElementById(id);
let preferences = { ...defaults }, timer;
function paint() {
  $("opacityValue").textContent = `${preferences.opacity}%`;
  $("preview").style.setProperty("--preview-paper", rgba(preferences.background, preferences.opacity));
  $("preview").style.setProperty("--preview-ink", preferences.text);
  $("preview").style.setProperty("--preview-accent", preferences.accent);
  const luminance = color => { const v = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4); return .2126*v[0]+.7152*v[1]+.0722*v[2]; };
  const a = luminance(preferences.background), b = luminance(preferences.text), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  $("contrast").textContent = ratio < 4.5 ? "这组文字与背景颜色较接近，建议提高对比度。透明背景下还会受到网页底色影响。" : "透明度只影响背景，文字保持清晰。";
}
function fill() { for (const key of fields) { if (key === "autoLookup") $(key).checked = preferences[key]; else $(key).value = preferences[key]; } paint(); }
for (const key of fields) $(key).addEventListener("input", () => {
  preferences = normalizePreferences({ ...preferences, [key]: key === "autoLookup" ? $(key).checked : $(key).value }); paint(); clearTimeout(timer);
  timer = setTimeout(async () => { try { const result = await chrome.runtime.sendMessage({ type: "set-preferences", preferences }); $("status").textContent = result.error || "外观已保存，打开的解释窗会即时更新。"; } catch { $("status").textContent = "未能保存，请重新打开设置。"; } }, 150);
});
$("reset").onclick = async () => { preferences = { ...defaults, autoLookup: preferences.autoLookup }; fill(); await chrome.runtime.sendMessage({ type: "set-preferences", preferences }); $("status").textContent = "已恢复默认外观。"; };
$("shortcuts").onclick = () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
const state = await chrome.runtime.sendMessage({ type: "status" }); preferences = normalizePreferences(state.preferences); fill();
$("account").textContent = state.account ? `当前保存到：${state.account.nickname}` : "尚未连接账号，请先到网站设置。";
chrome.commands.getAll().then(commands => { const shortcut = commands.find(v => v.name === "lookup-selection")?.shortcut; $("shortcut").textContent = shortcut ? `当前快捷键：${shortcut}` : "尚未设置快捷键，或默认快捷键被占用。"; });
