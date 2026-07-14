"use client";

import { useState } from "react";
import { checkAnki } from "@/lib/ankiConnect";
import { DEFAULT_ANKI_ENDPOINT } from "@/lib/ankiTemplates";

const ANKI_CONNECT_CODE = "2055492159";

export function GuideAnkiSetup() {
  const [endpoint, setEndpoint] = useState(DEFAULT_ANKI_ENDPOINT);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const [statusTone, setStatusTone] = useState<"idle" | "success" | "error">("idle");
  const [copied, setCopied] = useState(false);

  async function handleCheckConnection() {
    setChecking(true);
    setStatus("");
    setStatusTone("idle");

    try {
      const version = await checkAnki(endpoint.trim() || DEFAULT_ANKI_ENDPOINT);
      setStatus(`连接成功，AnkiConnect API 版本 ${version}。现在可以回到阅读页导入词汇。`);
      setStatusTone("success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "AnkiConnect 检测失败，请确认桌面版 Anki 已打开。");
      setStatusTone("error");
    } finally {
      setChecking(false);
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(ANKI_CONNECT_CODE);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatus("复制失败，请手动复制插件代码 2055492159。");
      setStatusTone("error");
    }
  }

  const statusClass = statusTone === "success"
    ? "bg-[#e4f1e9] text-[#245844]"
    : statusTone === "error"
      ? "bg-[#f7e9e5] text-[#8b342b]"
      : "bg-[#eef1ee] text-[#52625a]";

  return (
    <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:gap-12">
      <div>
        <h3 className="text-xl font-semibold tracking-[-0.02em] text-[#18211d]">安装 AnkiConnect</h3>
        <p className="mt-2 max-w-[58ch] text-sm leading-6 text-[#5b6962]">
          在桌面版 Anki 中打开“工具 → 插件 → 获取插件”，粘贴下面的代码。安装完成后重启 Anki。
        </p>
        <div className="mt-5 flex max-w-md items-center justify-between gap-4 rounded-[12px] bg-[#e9eeeb] px-4 py-3">
          <code className="font-mono text-[15px] font-semibold tracking-[0.08em] text-[#183f34]">{ANKI_CONNECT_CODE}</code>
          <button
            type="button"
            className="rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-[#285143] transition-colors hover:bg-[#f8faf8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]"
            onClick={handleCopyCode}
          >
            {copied ? "已复制" : "复制插件代码"}
          </button>
        </div>
        <a
          className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#1769aa] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1769aa]"
          href="https://ankiweb.net/shared/info/2055492159"
          target="_blank"
          rel="noreferrer"
        >
          查看 AnkiConnect 插件页
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div className="rounded-[14px] bg-white p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-xl font-semibold tracking-[-0.02em] text-[#18211d]">测试本地连接</h3>
            <p className="mt-1 text-sm leading-6 text-[#5b6962]">先打开桌面版 Anki，再检测网页能否访问 AnkiConnect。</p>
          </div>
          <span className="w-fit rounded-full bg-[#eef1ee] px-3 py-1 text-xs font-medium text-[#52625a]">仅桌面端</span>
        </div>
        <label className="mt-5 block text-sm font-semibold text-[#34443c]" htmlFor="guide-anki-endpoint">
          AnkiConnect 地址
        </label>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row">
          <input
            id="guide-anki-endpoint"
            className="h-11 min-w-0 flex-1 rounded-full border border-[#bdc9c2] bg-[#f8faf8] px-4 text-sm text-[#18211d] outline-none transition-colors placeholder:text-[#65736c] focus:border-[#1769aa] focus:ring-2 focus:ring-[#1769aa]/15"
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
            placeholder={DEFAULT_ANKI_ENDPOINT}
            inputMode="url"
          />
          <button
            type="button"
            className="h-11 rounded-full bg-[#183f34] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#123229] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#183f34] disabled:bg-[#8d9b94]"
            onClick={handleCheckConnection}
            disabled={checking}
          >
            {checking ? "正在检测..." : "测试 Anki 连接"}
          </button>
        </div>
        <div className={`mt-4 min-h-12 rounded-[10px] px-4 py-3 text-sm leading-6 ${statusClass}`} role="status" aria-live="polite">
          {status || "连接成功后，Context Reader 会在导入时创建或更新自己的卡片模板。"}
        </div>
        <p className="mt-3 text-xs leading-5 text-[#66736c]">
          如果线上网站提示 Failed to fetch，请同时检查浏览器的本地网络权限，以及 AnkiConnect 是否允许当前网站来源。
        </p>
      </div>
    </div>
  );
}
