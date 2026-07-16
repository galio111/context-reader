"use client";

import { useEffect, useMemo, useState } from "react";

interface AdminFeedbackItem {
  id: string;
  createdAt: string;
  category: string;
  message: string;
  contact: string;
  page: string;
  status: "new" | "resolved";
  resolvedAt: string;
  objectPath: string;
}

type FeedbackFilter = "new" | "all" | "resolved";

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function pageLabel(value: string): string {
  if (!value) return "未记录页面";
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

export default function AdminFeedbackPanel() {
  const [items, setItems] = useState<AdminFeedbackItem[]>([]);
  const [filter, setFilter] = useState<FeedbackFilter>("new");
  const [loading, setLoading] = useState(true);
  const [workingPath, setWorkingPath] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/feedback", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { feedback?: AdminFeedbackItem[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "用户反馈读取失败。");
      setItems(data?.feedback ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "用户反馈读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const newCount = items.filter((item) => item.status === "new").length;
  const visibleItems = useMemo(
    () => items.filter((item) => filter === "all" || item.status === filter),
    [filter, items],
  );

  async function updateStatus(item: AdminFeedbackItem) {
    const nextStatus = item.status === "new" ? "resolved" : "new";
    setWorkingPath(item.objectPath);
    setError("");
    try {
      const response = await fetch("/api/admin/feedback", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.objectPath, status: nextStatus }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "反馈状态更新失败。");
      setItems((current) => current.map((entry) => entry.objectPath === item.objectPath
        ? { ...entry, status: nextStatus, resolvedAt: nextStatus === "resolved" ? new Date().toISOString() : "" }
        : entry));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "反馈状态更新失败。");
    } finally {
      setWorkingPath("");
    }
  }

  async function deleteFeedback(item: AdminFeedbackItem) {
    if (!window.confirm("确定永久删除这条用户反馈吗？删除后无法恢复。")) return;
    setWorkingPath(item.objectPath);
    setError("");
    try {
      const response = await fetch(`/api/admin/feedback?path=${encodeURIComponent(item.objectPath)}`, { method: "DELETE" });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "反馈删除失败。");
      setItems((current) => current.filter((entry) => entry.objectPath !== item.objectPath));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "反馈删除失败。");
    } finally {
      setWorkingPath("");
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[24px] font-semibold leading-tight">用户反馈</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[#4d535a]">查看用户从首页提交的问题和建议。默认只显示还没有处理的内容。</p>
        </div>
        <button className="min-h-10 self-start rounded-full border border-[#0066cc] px-4 text-sm font-medium text-[#0066cc] hover:bg-[#f2f7fc] disabled:opacity-50" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "刷新中..." : "刷新反馈"}
        </button>
      </div>

      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">{error}</p>}

      <section className="mt-6 overflow-hidden rounded-2xl bg-white">
        <div className="flex flex-col gap-4 border-b border-[#e1e5e9] px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong className="text-lg">{newCount} 条待处理</strong>
            <span className="ml-2 text-sm text-[#68717a]">共收到 {items.length} 条</span>
          </div>
          <div className="flex w-fit gap-1 rounded-full bg-[#eef1f4] p-1" aria-label="反馈筛选">
            {([
              ["new", `待处理 ${newCount}`],
              ["all", `全部 ${items.length}`],
              ["resolved", `已处理 ${items.length - newCount}`],
            ] as Array<[FeedbackFilter, string]>).map(([value, label]) => (
              <button
                key={value}
                className={`min-h-9 rounded-full px-3 text-sm font-medium ${filter === value ? "bg-white text-[#17191c]" : "text-[#59636c] hover:text-[#17191c]"}`}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid gap-3 px-5 py-6" aria-label="正在读取反馈">
            {[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-[#eef1f4] motion-reduce:animate-none" />)}
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <h3 className="font-semibold text-[#17191c]">{filter === "new" ? "没有待处理反馈" : "这里还没有反馈"}</h3>
            <p className="mt-2 text-sm text-[#68717a]">{filter === "new" ? "新的建议提交后会出现在这里。" : "用户可以从书本主页 Menu 中提交意见反馈。"}</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#e1e5e9]">
            {visibleItems.map((item) => {
              const working = workingPath === item.objectPath;
              return (
                <li key={item.objectPath} className="px-5 py-5">
                  <article>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-[#edf5fb] px-2.5 py-1 text-xs font-medium text-[#174d73]">{item.category}</span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.status === "new" ? "bg-[#fff3dc] text-[#77551f]" : "bg-[#e9f5ee] text-[#17613b]"}`}>{item.status === "new" ? "待处理" : "已处理"}</span>
                        <time className="text-xs text-[#68717a]" dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                      </div>
                      <span className="text-xs text-[#68717a]">来源：{pageLabel(item.page)}</span>
                    </div>
                    <p className="mt-4 max-w-4xl whitespace-pre-wrap text-[15px] leading-7 text-[#252a2e]">{item.message}</p>
                    {item.contact && <p className="mt-3 text-sm text-[#4d535a]"><strong className="font-medium text-[#252a2e]">联系方式：</strong>{item.contact}</p>}
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button className="min-h-9 rounded-full border border-[#b8c7d5] px-3 text-sm font-medium text-[#175a8d] hover:bg-[#edf5fb] disabled:opacity-50" type="button" onClick={() => void updateStatus(item)} disabled={working}>
                        {working ? "处理中..." : item.status === "new" ? "标为已处理" : "重新打开"}
                      </button>
                      <button className="min-h-9 rounded-full px-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50" type="button" onClick={() => void deleteFeedback(item)} disabled={working}>删除反馈</button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
