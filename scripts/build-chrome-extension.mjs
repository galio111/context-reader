import { build } from "esbuild";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { generateKeyPairSync, createHash } from "node:crypto";
import { resolve, relative } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";
import JSZip from "jszip";
import sharp from "sharp";

const root = process.cwd(), dir = resolve(root, "chrome-extension"), out = resolve(root, "artifacts/chrome-extension-1113/unpacked");
await mkdir(out, { recursive: true });
let identity;
try { identity = JSON.parse(await readFile(resolve(dir, "identity.json"), "utf8")); }
catch {
  if (!process.argv.includes("--initialize-identity")) throw new Error("Missing stable extension identity. Restore chrome-extension/identity.json; use --initialize-identity only for an intentionally new extension.");
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = publicKey.export({ type: "spki", format: "der" });
  const id = [...createHash("sha256").update(key).digest().subarray(0,16)].map(v => String.fromCharCode(97 + (v >> 4), 97 + (v & 15))).join("");
  identity = { id, key: key.toString("base64") }; await writeFile(resolve(dir, "identity.json"), JSON.stringify(identity, null, 2) + "\n");
}
const manifest = {
  manifest_version: 3, name: "Context Reader 划词助手", version: "1.0.0", minimum_chrome_version: "120",
  description: "网页划词、语境解释与账号生词本。快捷键、浮窗大小、颜色和透明度可自定义。", key: identity.key,
  permissions: ["storage", "contextMenus"], host_permissions: ["https://context-reader.com/*"],
  icons: { 16: "icon16.png", 32: "icon32.png", 48: "icon48.png", 128: "icon128.png" },
  background: { service_worker: "background.js", type: "module" }, action: { default_popup: "options.html", default_title: "Context Reader 划词设置", default_icon: { 16: "icon16.png", 32: "icon32.png" } },
  options_page: "options.html", commands: { "lookup-selection": { suggested_key: { default: "Alt+Shift+D", mac: "Alt+Shift+D" }, description: "解释网页中所选的英文词或短语" } },
  content_scripts: [{ matches: ["http://*/*", "https://*/*"], exclude_matches: ["https://context-reader.com/*"], js: ["content.js"], run_at: "document_idle", all_frames: true }],
  web_accessible_resources: [{ resources: ["panel.html", "panel.js", "panel.css"], matches: ["http://*/*", "https://*/*"] }],
  externally_connectable: { matches: ["https://context-reader.com/browser-extension"] },
  content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; connect-src 'self' https://context-reader.com; media-src 'self' blob: data:" },
};
await writeFile(resolve(out, "manifest.json"), JSON.stringify(manifest, null, 2));
await build({ entryPoints: { panel: "chrome-extension/src/panel.tsx", options: "chrome-extension/src/options.mjs", background: "chrome-extension/src/background.mjs", content: "chrome-extension/src/content.mjs" },
  outdir: out, bundle: true, minify: true, target: "chrome120", format: "esm", jsx: "automatic", tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "account-navigation", setup(b) { b.onResolve({ filter: /(?:^@\/lib\/|\.\/)accountUsageNavigation$/ }, () => ({ path: resolve(dir, "src/accountNavigation.ts") })); } }] });
const tw = await postcss([tailwindcss({ content: ["./components/ExplanationPanel.tsx", "./components/PronunciationButtons.tsx", "./components/LoadingStatus.tsx", "./chrome-extension/src/panel.tsx"], theme: {}, plugins: [] }), autoprefixer]).process("@tailwind base;\n@tailwind components;\n@tailwind utilities;", { from: undefined });
const cssPath = resolve(out, "panel.css"); await writeFile(cssPath, tw.css + "\n" + await readFile(cssPath, "utf8"));
await writeFile(resolve(out, "panel.html"), '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Context Reader 解释</title><link rel="stylesheet" href="panel.css"></head><body><div id="root"></div><script type="module" src="panel.js"></script></body></html>');
for (const file of ["options.html", "options.css"]) await writeFile(resolve(out, file), await readFile(resolve(dir, "src", file)));
for (const size of [16, 32, 48, 128]) await sharp(await readFile(resolve(root, "public/icon.svg"))).resize(size, size).png().toFile(resolve(out, `icon${size}.png`));
await writeFile(resolve(out, "安装说明.txt"), "Context Reader Chrome 划词助手\r\n\r\n1. 解压整个文件夹。\r\n2. 在 Chrome 打开 chrome://extensions，开启开发者模式。\r\n3. 点击加载已解压的扩展程序，选择包含 manifest.json 的文件夹。\r\n4. 打开 https://context-reader.com/browser-extension，登录并连接保存账号。\r\n5. 在扩展设置中修改外观，点击设置快捷键可进入 Chrome 快捷键页。\r\n6. 在普通网页划选英文，再按快捷键。安装前已打开的网页请刷新。\r\n\r\n支持 Windows 和 macOS 的桌面 Chrome。不支持 Chrome 系统页面、商店页面、内置 PDF 阅读器、图片文字和受限网页。默认不读取输入框；只在查询时发送所选词及相邻句子，不上传整页。账号连接 90 天有效，可在网站随时解除。\r\n");
const zip = new JSZip(); for (const name of (await readdir(out)).sort()) zip.file(name, await readFile(resolve(out, name)), { date: new Date("2026-11-13T00:00:00Z") });
await mkdir(resolve(root, "public/downloads"), { recursive: true });
await writeFile(resolve(root, "public/downloads/context-reader-chrome.zip"), await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
console.log(`Extension ${identity.id}: ${relative(root, out)} and public/downloads/context-reader-chrome.zip`);
