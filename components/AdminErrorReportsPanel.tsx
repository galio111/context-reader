"use client";

import { useEffect, useMemo, useState } from "react";
import type { ErrorReportStatus, StoredErrorReport } from "@/types/errorReport";

type ErrorFilter = "new" | "all" | "resolved";

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function severityLabel(value: StoredErrorReport["severity"]): string {
  if (value === "critical") return "严重";
  if (value === "warning") return "警告";
  return "错误";
}

function categoryLabel(value: StoredErrorReport["category"]): string {
  if (value === "provider") return "上游服务";
  if (value === "configuration") return "配置";
  if (value === "client") return "浏览器代码";
  if (value === "service") return "本站服务";
  return "未知";
}

export default function AdminErrorReportsPanel() {
  const [items, setItems] = useState<StoredErrorReport[]>([]);
  const [filter, setFilter] = useState<ErrorFilter>("new");
  const [loading, setLoading] = useState(true);
  const [workingPath, setWorkingPath] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/error-reports", { cache: "no-store" });
      const data = await response.json().catch(() => null) as { reports?: StoredErrorReport[]; error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "错误记录读取失败。");
      setItems(data?.reports ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "错误记录读取失败。");
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

  async function updateStatus(item: StoredErrorReport) {
    const nextStatus: ErrorReportStatus = item.status === "new" ? "resolved" : "new";
    setWorkingPath(item.objectPath);
    setError("");
    try {
      const response = await fetch("/api/admin/error-reports", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.objectPath, status: nextStatus }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "错误状态更新失败。");
      setItems((current) => current.map((entry) => entry.objectPath === item.objectPath
        ? { ...entry, status: nextStatus, resolvedAt: nextStatus === "resolved" ? new Date().toISOString() : "" }
        : entry));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "错误状态更新失败。");
    } finally {
      setWorkingPath("");
    }
  }

  async function deleteReport(item: StoredErrorReport) {
    if (!window.confirm(`确定永久删除错误记录 ${item.id} 吗？`)) return;
    setWorkingPath(item.objectPath);
    setError("");
    try {
      const response = await fetch(`/api/admin/error-reports?path=${encodeURIComponent(item.objectPath)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(data?.error || "错误记录删除失败。");
      setItems((current) => current.filter((entry) => entry.objectPath !== item.objectPath));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "错误记录删除失败。");
    } finally {
      setWorkingPath("");
    }
  }

  return (
    <section className="rounded-[16px] bg-white p-5" aria-labelledby="admin-errors-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="admin-errors-title" className="text-[21px] font-semibold">错误与 Bug</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4d4d4d]">
            这里只记录站点、API、上游服务或浏览器代码异常。用户输入错误和明确的本地断网不会进入列表。
          </p>
        </div>
        <button
          className="h-10 self-start rounded-full border border-[#0066cc] px-4 text-sm text-[#0066cc] disabled:opacity-50"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "正在刷新…" : "刷新记录"}
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2" aria-label="错误记录筛选">
        {([
          ["new", `待处理 ${newCount}`],
          ["all", `全部 ${items.length}`],
          ["resolved", `已解决 ${items.length - newCount}`],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              filter === value ? "bg-[#0066cc] text-white" : "bg-[#f2f5f8] text-[#333333]"
            }`}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 rounded-[12px] bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">{error}</p>}
      {loading ? (
        <p className="mt-5 text-sm text-[#6e6e73]">正在读取错误记录…</p>
      ) : visibleItems.length === 0 ? (
        <p className="mt-5 text-sm leading-6 text-[#6e6e73]">
          {filter === "new" ? "目前没有待处理错误。" : "这个筛选下没有错误记录。"}
        </p>
      ) : (
        <ol className="mt-5 grid gap-4">
          {visibleItems.map((item) => {
            const busy = workingPath === item.objectPath;
            return (
              <li key={item.objectPath} className="rounded-[14px] bg-[#f7f8fa] p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        item.severity === "critical"
                          ? "bg-red-100 text-red-800"
                          : item.severity === "warning"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-orange-100 text-orange-800"
                      }`}>
                        {severityLabel(item.severity)}
                      </span>
                      <span className="rounded-full bg-[#e7edf3] px-2.5 py-1 text-xs text-[#33475b]">
                        {categoryLabel(item.category)}
                      </span>
                      <strong className="break-all text-sm">{item.id}</strong>
                      {item.occurrenceCount > 1 && <span className="text-xs text-[#6e6e73]">发生 {item.occurrenceCount} 次</span>}
                    </div>
                    <h3 className="mt-3 text-[17px] font-semibold leading-6">{item.operation}</h3>
                    <p className="mt-1 text-sm leading-6 text-[#333333]">{item.userMessage || "未记录用户提示"}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      className="h-9 rounded-full border border-[#0066cc] px-3 text-sm text-[#0066cc] disabled:opacity-50"
                      type="button"
                      disabled={busy}
                      onClick={() => void updateStatus(item)}
                    >
                      {item.status === "new" ? "标记已解决" : "重新打开"}
                    </button>
                    <button
                      className="h-9 rounded-full border border-red-200 px-3 text-sm text-red-700 disabled:opacity-50"
                      type="button"
                      disabled={busy}
                      onClick={() => void deleteReport(item)}
                    >
                      删除
                    </button>
                  </div>
                </div>

                <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-[#6e6e73]">首次发生</dt><dd className="mt-0.5">{formatDate(item.createdAt)}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">最近发生</dt><dd className="mt-0.5">{formatDate(item.lastSeenAt)}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">接口</dt><dd className="mt-0.5 break-all">{item.endpoint || "未记录"}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">HTTP / 代码</dt><dd className="mt-0.5">{item.httpStatus || "无"} / {item.code || "无"}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">用户</dt><dd className="mt-0.5 break-all">{item.nickname || "未记录昵称"} · {item.userId || "游客或未知"}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">邮件</dt><dd className="mt-0.5">{item.emailStatus}{item.emailError ? ` · ${item.emailError}` : ""}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">页面</dt><dd className="mt-0.5 break-all">{item.page || "未记录"}</dd></div>
                  <div><dt className="text-xs text-[#6e6e73]">部署版本</dt><dd className="mt-0.5 break-all">{item.release || item.deploymentUrl || "未记录"}</dd></div>
                </dl>

                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-[#0066cc]">查看技术详情</summary>
                  <div className="mt-3 grid gap-3">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[#18212a] p-3 text-xs leading-5 text-[#eef4f8]">{item.technicalMessage}</pre>
                    {item.stack && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[#202a34] p-3 text-xs leading-5 text-[#eef4f8]">{item.stack}</pre>}
                    {Object.keys(item.metadata || {}).length > 0 && (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-[10px] bg-[#eef2f6] p-3 text-xs leading-5 text-[#263746]">
                        {JSON.stringify(item.metadata, null, 2)}
                      </pre>
                    )}
                    <p className="break-all text-xs leading-5 text-[#6e6e73]">浏览器：{item.userAgent || "未记录"}</p>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
