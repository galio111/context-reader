"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { checkAnki } from "@/lib/ankiConnect";
import { DEFAULT_ANKI_ENDPOINT } from "@/lib/ankiTemplates";

const ANKI_CONNECT_CODE = "2055492159";
const ANKI_DOWNLOAD_URL = "https://apps.ankiweb.net/";
const ANKI_CONNECT_URL = "https://ankiweb.net/shared/info/2055492159";
const PRODUCTION_ORIGIN = "https://context-reader-ten.vercel.app";
const ANKI_CONNECT_CONFIG = `{
  "apiKey": null,
  "apiLogPath": null,
  "webBindAddress": "127.0.0.1",
  "webBindPort": 8765,
  "webCorsOriginList": [
    "http://localhost",
    "${PRODUCTION_ORIGIN}"
  ],
  "ignoreOriginList": []
}`;

type Platform = "windows" | "macos" | "linux" | "mobile" | "unknown";
type CopyTarget = "addon" | "config" | null;

function detectPlatform(): Platform {
  const value = `${navigator.platform || ""} ${navigator.userAgent || ""}`.toLowerCase();
  if (/iphone|ipad|ipod|android/.test(value)) return "mobile";
  if (value.includes("win")) return "windows";
  if (value.includes("mac")) return "macos";
  if (value.includes("linux")) return "linux";
  return "unknown";
}

const platformCopy: Record<Platform, { label: string; download: string; note: string }> = {
  windows: { label: "Windows 电脑", download: "打开 Windows 下载页", note: "下载后运行安装程序，再打开 Anki。" },
  macos: { label: "Mac 电脑", download: "打开 macOS 下载页", note: "下载后把 Anki 拖入“应用程序”，再打开它。" },
  linux: { label: "Linux 电脑", download: "打开 Linux 下载页", note: "优先使用 Anki 官方提供的安装包。" },
  mobile: { label: "手机或平板", download: "查看桌面版下载方式", note: "AnkiConnect 需要桌面版 Anki，请改用电脑完成连接和导入。" },
  unknown: { label: "当前设备", download: "打开 Anki 官方下载页", note: "选择与你电脑系统对应的桌面版本。" },
};

function StepStatus({ complete, active, children }: { complete: boolean; active?: boolean; children: ReactNode }) {
  const className = complete
    ? "bg-[#dff0e7] text-[#245844]"
    : active
      ? "bg-[#e5eef8] text-[#245d8d]"
      : "bg-[#edf1ee] text-[#607068]";

  return <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}

export function GuideAnkiSetup() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [downloadOpened, setDownloadOpened] = useState(false);
  const [addonCopied, setAddonCopied] = useState(false);
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [endpoint, setEndpoint] = useState(DEFAULT_ANKI_ENDPOINT);
  const [checking, setChecking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("准备好后，从第 1 步开始。已经装过 Anki 的用户可以直接检测连接。");
  const [statusTone, setStatusTone] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  async function copyText(value: string, target: Exclude<CopyTarget, null>, fallback: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(value);
      setCopyTarget(target);
      window.setTimeout(() => setCopyTarget((current) => current === target ? null : current), 1800);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (copied) {
        setCopyTarget(target);
        window.setTimeout(() => setCopyTarget((current) => current === target ? null : current), 1800);
        return true;
      }
      setStatus(fallback);
      setStatusTone("error");
      return false;
    }
  }

  async function handleCopyAddonCode() {
    const copied = await copyText(ANKI_CONNECT_CODE, "addon", `复制失败，请手动输入插件代码 ${ANKI_CONNECT_CODE}。`);
    if (copied) {
      setAddonCopied(true);
      setStatus("插件代码已复制。现在打开 Anki 的“工具 → 插件 → 获取插件”，粘贴代码并安装，然后重启 Anki。");
      setStatusTone("idle");
    }
  }

  async function handleCheckConnection() {
    setChecking(true);
    setConnected(false);
    setStatus("正在连接这台电脑上的 Anki…");
    setStatusTone("idle");

    try {
      const version = await checkAnki(endpoint.trim() || DEFAULT_ANKI_ENDPOINT);
      setConnected(true);
      setStatus(`连接成功，AnkiConnect API 版本 ${version}。现在可以回到阅读页，把生词导入 Anki。`);
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "连接失败，请确认桌面版 Anki 已打开并完成插件安装。");
      setStatusTone("error");
    } finally {
      setChecking(false);
    }
  }

  const statusClass = statusTone === "success"
    ? "bg-[#dff0e7] text-[#245844]"
    : statusTone === "error"
      ? "bg-[#f7e7e3] text-[#8b342b]"
      : "bg-[#e9eeeb] text-[#4e5f56]";
  const currentPlatform = platformCopy[platform];

  return (
    <section className="overflow-hidden rounded-[16px] bg-[#203f35] text-white" aria-labelledby="anki-assistant-title">
      <div className="grid lg:grid-cols-[0.72fr_1.28fr]">
        <div className="border-b border-white/12 px-6 py-7 sm:px-8 sm:py-9 lg:border-b-0 lg:border-r">
          <p className="text-sm font-semibold text-[#a9d5c4]">Anki 安装与连接助手</p>
          <h3 id="anki-assistant-title" className="mt-3 text-balance text-[26px] font-semibold leading-[1.18] tracking-[-0.025em]">把安装流程缩短到 3 步</h3>
          <p className="mt-4 text-sm leading-6 text-[#cbdad3]">检测到：{currentPlatform.label}</p>
          <p className="mt-2 max-w-[46ch] text-sm leading-6 text-[#afc3ba]">网页可以打开官方下载、复制插件代码并测试连接，但不能绕过系统确认直接安装电脑软件。</p>

          <div className="mt-6 rounded-[12px] bg-white/[0.08] p-4">
            <p className="text-sm font-semibold text-white">安装完成的标志</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-[#cbdad3]">
              <li className="flex gap-2"><span aria-hidden="true" className="text-[#8fc4af]">✓</span>Anki 桌面版已经打开</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-[#8fc4af]">✓</span>AnkiConnect 已安装并重启生效</li>
              <li className="flex gap-2"><span aria-hidden="true" className="text-[#8fc4af]">✓</span>下方连接检测显示成功</li>
            </ul>
          </div>
        </div>

        <div className="bg-[#f8faf8] text-[#18211d]">
          <ol className="divide-y divide-[#18211d]/10">
            <li className="grid gap-4 px-5 py-6 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center sm:px-7">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e4f1e9] font-mono text-xs font-semibold text-[#285143]">1</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-[#24352d]">安装并打开 Anki 桌面版</h4>
                  <StepStatus complete={downloadOpened}>{downloadOpened ? "下载页已打开" : "尚未开始"}</StepStatus>
                </div>
                <p className="mt-1 text-sm leading-6 text-[#5a6861]">{currentPlatform.note}</p>
              </div>
              <a
                className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-full bg-[#1769aa] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#125b94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]"
                href={ANKI_DOWNLOAD_URL}
                target="_blank"
                rel="noreferrer"
                onClick={() => setDownloadOpened(true)}
              >
                {currentPlatform.download}
                <span aria-hidden="true">↗</span>
              </a>
            </li>

            <li className="grid gap-4 px-5 py-6 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:px-7">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e4f1e9] font-mono text-xs font-semibold text-[#285143]">2</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-[#24352d]">安装 AnkiConnect 插件</h4>
                  <StepStatus complete={addonCopied}>{addonCopied ? "代码已复制" : "需要在 Anki 中完成"}</StepStatus>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#5a6861]">在 Anki 中打开“工具 → 插件 → 获取插件”，粘贴代码，完成后重启 Anki。</p>
                <div className="mt-4 flex max-w-[520px] flex-col gap-3 rounded-[12px] bg-[#e9eeeb] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <code className="px-2 font-mono text-[15px] font-semibold tracking-[0.08em] text-[#183f34]">{ANKI_CONNECT_CODE}</code>
                  <button className="h-10 rounded-full bg-white px-4 text-sm font-semibold text-[#285143] transition-colors hover:bg-[#f8faf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" type="button" onClick={() => void handleCopyAddonCode()}>
                    {copyTarget === "addon" ? "插件代码已复制" : "复制插件代码"}
                  </button>
                </div>
                <a className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#1769aa] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" href={ANKI_CONNECT_URL} target="_blank" rel="noreferrer">
                  查看 AnkiConnect 插件页
                  <span aria-hidden="true">↗</span>
                </a>
              </div>
            </li>

            <li className="grid gap-4 px-5 py-6 sm:grid-cols-[2.25rem_minmax(0,1fr)] sm:px-7">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-[#e4f1e9] font-mono text-xs font-semibold text-[#285143]">3</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-[#24352d]">测试网页与 Anki 的连接</h4>
                  <StepStatus complete={connected} active={checking}>{connected ? "连接成功" : checking ? "正在检测" : "等待检测"}</StepStatus>
                </div>
                <p className="mt-2 text-sm leading-6 text-[#5a6861]">保持 Anki 打开，再点击检测。浏览器首次访问本地网络时，请选择允许。</p>
                <button
                  className="mt-4 h-11 rounded-full bg-[#183f34] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#123229] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#183f34] disabled:cursor-wait disabled:bg-[#89968f]"
                  type="button"
                  onClick={() => void handleCheckConnection()}
                  disabled={checking}
                >
                  {checking ? "正在检测本地 Anki…" : connected ? "重新检测连接" : "检测 Anki 连接"}
                </button>

                <div className={`mt-4 rounded-[10px] px-4 py-3 text-sm leading-6 ${statusClass}`} role={statusTone === "error" ? "alert" : "status"} aria-live="polite">
                  {status}
                  {connected && <Link className="ml-1 font-semibold underline underline-offset-4" href="/">返回首页开始阅读</Link>}
                </div>

                {statusTone === "error" && (
                  <div className="mt-4 rounded-[12px] bg-[#fff2ef] p-4 text-sm text-[#6f3e37]">
                    <p className="font-semibold">按这个顺序排查</p>
                    <ol className="mt-2 list-decimal space-y-1.5 pl-5 leading-6">
                      <li>确认当前是电脑浏览器，桌面版 Anki 正在运行。</li>
                      <li>确认 AnkiConnect 安装后已经重启 Anki。</li>
                      <li>允许浏览器访问本地网络。</li>
                      <li>仍然失败时，展开下方“线上网站跨域配置”。</li>
                    </ol>
                  </div>
                )}

                <details className="mt-4 rounded-[12px] bg-[#edf1ee] p-4 text-sm text-[#4e5f56]">
                  <summary className="cursor-pointer font-semibold text-[#34443c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]">高级设置：连接地址与线上网站跨域配置</summary>
                  <div className="mt-4">
                    <label className="block font-semibold text-[#34443c]" htmlFor="guide-anki-endpoint">AnkiConnect 地址</label>
                    <input
                      id="guide-anki-endpoint"
                      className="mt-2 h-11 w-full rounded-[10px] border border-[#bdc9c2] bg-white px-3 text-sm text-[#18211d] outline-none transition-colors placeholder:text-[#65736c] focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15"
                      value={endpoint}
                      onChange={(event) => setEndpoint(event.target.value)}
                      placeholder={DEFAULT_ANKI_ENDPOINT}
                      inputMode="url"
                    />
                    <p className="mt-2 text-xs leading-5 text-[#65736c]">出于安全原因，本站只连接本机的 127.0.0.1:8765。</p>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-semibold text-[#34443c]">允许生产网站来源</p>
                        <p className="mt-1 max-w-[58ch] text-xs leading-5 text-[#65736c]">在 Anki 的“工具 → 插件”中选中 AnkiConnect，打开“配置”。如果你已有自定义配置，只把生产网址追加到现有 webCorsOriginList，不要覆盖其他设置。</p>
                      </div>
                      <button className="h-10 shrink-0 rounded-full bg-white px-4 text-sm font-semibold text-[#285143] transition-colors hover:bg-[#f8faf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]" type="button" onClick={() => void copyText(ANKI_CONNECT_CONFIG, "config", "复制失败，请手动把生产网址加入 webCorsOriginList。")}>{copyTarget === "config" ? "配置已复制" : "复制推荐配置"}</button>
                    </div>
                    <pre className="mt-3 max-h-60 overflow-auto rounded-[10px] bg-[#152d25] p-4 text-xs leading-5 text-[#dce9e3]"><code>{ANKI_CONNECT_CONFIG}</code></pre>
                  </div>
                </details>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
