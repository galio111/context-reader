"use client";

import { useEffect, useState } from "react";

type RepairResult = {
  scanned?: number;
  updated?: Array<{ id: string; title: string; localizedImages?: number }>;
  failed?: Array<{ id: string; title: string; error: string }>;
};

export default function PublicImageRepairPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function checkSession() {
      try {
        const response = await fetch("/api/admin/session", { cache: "no-store" });
        const data = await response.json().catch(() => null) as { authenticated?: boolean } | null;
        setAuthenticated(Boolean(response.ok && data?.authenticated));
      } finally {
        setChecking(false);
      }
    }

    void checkSession();
  }, []);

  async function repairImages() {
    if (!window.confirm("将扫描全部已公开文章，把仍依赖外站的封面和正文图片转存到本站。继续吗？")) return;
    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/article-covers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = await response.json().catch(() => null) as (RepairResult & { error?: string }) | null;
      if (!response.ok || !data) {
        throw new Error(data?.error || "公开图片修复失败，请稍后重试。");
      }
      const localized = (data.updated ?? []).reduce((total, article) => total + (article.localizedImages ?? 0), 0);
      const failures = data.failed?.length ?? 0;
      setMessage(`已扫描 ${data.scanned ?? 0} 篇，更新 ${data.updated?.length ?? 0} 篇，转存 ${localized} 张图片${failures ? `；${failures} 篇仍有失败项` : "，没有失败项"}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "公开图片修复失败，请稍后重试。");
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f5f7f8] px-4 py-10 text-[#17212b]">
      <section className="mx-auto max-w-xl rounded-[22px] bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#006b80]">Context Reader Admin</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight">公开文章图片修复</h1>
        <p className="mt-3 text-sm leading-6 text-[#52606a]">
          仅扫描已公开文章，将仍依赖外站的封面和正文图片转存为本站 WebP。已经本地化的图片会跳过。
        </p>
        {checking ? (
          <p className="mt-6 text-sm text-[#52606a]">正在核验管理员权限…</p>
        ) : !authenticated ? (
          <p className="mt-6 rounded-[14px] bg-red-50 p-4 text-sm text-red-700">当前会话没有有效的 Admin 权限。</p>
        ) : (
          <button
            className="mt-6 h-11 rounded-full bg-[#006b80] px-6 text-sm font-semibold text-white disabled:cursor-wait disabled:bg-[#9ab7bd]"
            type="button"
            disabled={working}
            onClick={() => void repairImages()}
          >
            {working ? "正在转存公开图片…" : "开始修复公开图片"}
          </button>
        )}
        {message && <p role="status" className="mt-5 rounded-[14px] border border-[#dce4e7] bg-[#f8fafb] p-4 text-sm leading-6">{message}</p>}
        <a className="mt-6 inline-block text-sm font-medium text-[#006b80] hover:underline" href="/admin">返回管理后台</a>
      </section>
    </main>
  );
}
