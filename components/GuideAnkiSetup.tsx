"use client";

import { useEffect, useState, type ReactNode } from "react";
import ClearableField from "@/components/ClearableField";
import { checkAnki } from "@/lib/ankiConnect";
import { DEFAULT_ANKI_ENDPOINT } from "@/lib/ankiTemplates";
import styles from "./GuideAnkiSetup.module.css";

const ANKI_CONNECT_CODE = "2055492159";
const ANKI_DOWNLOAD_URL = "https://apps.ankiweb.net/";
const ANKI_CONNECT_URL = "https://ankiweb.net/shared/info/2055492159";
const PRODUCTION_ORIGIN = "https://context-reader.com";
const ANKI_CONNECT_CONFIG = `{
  "apiKey": null,
  "apiLogPath": null,
  "webBindAddress": "127.0.0.1",
  "webBindPort": 8765,
  "webCorsOriginList": [
    "http://localhost",
    "http://127.0.0.1",
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
  windows: { label: "Windows 电脑", download: "打开 Windows 下载页", note: "下载后运行安装程序，完成后打开 Anki。" },
  macos: { label: "Mac 电脑", download: "打开 macOS 下载页", note: "下载后把 Anki 拖入“应用程序”，完成后打开它。" },
  linux: { label: "Linux 电脑", download: "打开 Linux 下载页", note: "优先使用 Anki 官网提供的安装包。" },
  mobile: { label: "手机或平板", download: "查看桌面版下载方式", note: "AnkiConnect 需要桌面版 Anki，请改用电脑完成连接和导入。" },
  unknown: { label: "当前设备", download: "打开 Anki 下载页", note: "选择与你电脑系统对应的桌面版本。" },
};

function StepStatus({ complete, active, children }: { complete: boolean; active?: boolean; children: ReactNode }) {
  return <span className={styles.stepStatus} data-complete={complete || undefined} data-active={active || undefined}>{children}</span>;
}

export function GuideAnkiSetup() {
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [downloadOpened, setDownloadOpened] = useState(false);
  const [addonCopied, setAddonCopied] = useState(false);
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [endpoint, setEndpoint] = useState(DEFAULT_ANKI_ENDPOINT);
  const [checking, setChecking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("完成前两步后，保持 Anki 打开，再检测连接。");
  const [statusTone, setStatusTone] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => setPlatform(detectPlatform()), []);

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
      setStatus("插件代码已复制。请在 Anki 的“工具 → 插件 → 获取插件”中粘贴安装，然后重启 Anki。");
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
      setStatus(`连接成功，AnkiConnect API 版本 ${version}。现在可以回到生词本导入卡片。`);
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "连接失败，请确认 Anki 已打开并完成插件安装。");
      setStatusTone("error");
    } finally {
      setChecking(false);
    }
  }

  const currentPlatform = platformCopy[platform];

  return <section className={styles.assistant} aria-labelledby="anki-assistant-title">
    <header className={styles.assistantHeader}>
      <div><span>安装与连接</span><h3 id="anki-assistant-title">在电脑上完成 3 步</h3><p>当前设备：{currentPlatform.label}。网页会帮你打开下载页、复制插件代码并检测连接。</p></div>
      <ul aria-label="安装完成条件"><li>Anki 已打开</li><li>AnkiConnect 已安装</li><li>连接检测成功</li></ul>
    </header>

    <ol className={styles.steps}>
      <li>
        <span className={styles.stepNumber}>1</span>
        <div className={styles.stepBody}>
          <div className={styles.stepTitle}><h4>安装并打开 Anki 桌面版</h4><StepStatus complete={downloadOpened}>{downloadOpened ? "下载页已打开" : "尚未开始"}</StepStatus></div>
          <p>{currentPlatform.note}</p>
          <a className={styles.primaryAction} href={ANKI_DOWNLOAD_URL} target="_blank" rel="noreferrer" onClick={() => setDownloadOpened(true)}>{currentPlatform.download}<span aria-hidden="true">↗</span></a>
        </div>
      </li>

      <li>
        <span className={styles.stepNumber}>2</span>
        <div className={styles.stepBody}>
          <div className={styles.stepTitle}><h4>安装 AnkiConnect 插件</h4><StepStatus complete={addonCopied}>{addonCopied ? "代码已复制" : "等待安装"}</StepStatus></div>
          <p>在 Anki 中打开“工具 → 插件 → 获取插件”，粘贴下面的代码。安装完成后重启 Anki。</p>
          <div className={styles.addonCode}><code>{ANKI_CONNECT_CODE}</code><button type="button" onClick={() => void handleCopyAddonCode()}>{copyTarget === "addon" ? "已复制" : "复制插件代码"}</button></div>
          <a className={styles.textLink} href={ANKI_CONNECT_URL} target="_blank" rel="noreferrer">查看 AnkiConnect 插件页 <span aria-hidden="true">↗</span></a>
        </div>
      </li>

      <li>
        <span className={styles.stepNumber}>3</span>
        <div className={styles.stepBody}>
          <div className={styles.stepTitle}><h4>检测网页与 Anki 的连接</h4><StepStatus complete={connected} active={checking}>{connected ? "连接成功" : checking ? "正在检测" : "等待检测"}</StepStatus></div>
          <p>保持 Anki 打开，再点击检测。浏览器首次询问本地网络权限时请选择允许。</p>
          <button className={styles.primaryAction} type="button" onClick={() => void handleCheckConnection()} disabled={checking}>{checking ? "正在检测…" : connected ? "重新检测连接" : "检测连接"}</button>
          <div className={styles.status} data-tone={statusTone} role={statusTone === "error" ? "alert" : "status"} aria-live="polite">{status}</div>

          {statusTone === "error" && <div className={styles.troubleshoot}><strong>按这个顺序排查</strong><ol><li>确认当前使用电脑浏览器，并且 Anki 正在运行。</li><li>确认安装 AnkiConnect 后已经重启 Anki。</li><li>允许浏览器访问本地网络。</li><li>仍然失败时，展开下方高级设置。</li></ol></div>}

          <details className={styles.advanced}>
            <summary>高级设置：连接地址与网站权限</summary>
            <div className={styles.advancedBody}>
              <label htmlFor="guide-anki-endpoint">AnkiConnect 地址</label>
              <ClearableField className={styles.endpointField} value={endpoint} onClear={() => setEndpoint("")} label="清空 AnkiConnect 地址"><input id="guide-anki-endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={DEFAULT_ANKI_ENDPOINT} inputMode="url" /></ClearableField>
              <p>本站只连接本机的 127.0.0.1:8765。</p>
              <div className={styles.configHeader}><div><strong>允许 context-reader.com 连接</strong><p>在 AnkiConnect 的“配置”中，把本站地址加入现有 webCorsOriginList。已有自定义配置时不要覆盖其他项目。</p></div><button type="button" onClick={() => void copyText(ANKI_CONNECT_CONFIG, "config", "复制失败，请手动把本站地址加入 webCorsOriginList。")}>{copyTarget === "config" ? "配置已复制" : "复制推荐配置"}</button></div>
              <pre><code>{ANKI_CONNECT_CONFIG}</code></pre>
            </div>
          </details>
        </div>
      </li>
    </ol>
  </section>;
}
