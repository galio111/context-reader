"use client";

import { useState } from "react";
import { SiteBackdrop } from "@/components/SiteBackdrop";

interface RepairResult {
  before: number;
  after: number;
  removed: number;
  recoveredActive: number;
}

export default function RepairVocabularyPage() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RepairResult | null>(null);
  const [error, setError] = useState("");

  async function repair() {
    setRunning(true);
    setError("");
    try {
      const response = await fetch("/api/account/vocabulary-repair", { method: "POST" });
      const data = await response.json() as RepairResult & { error?: string };
      if (!response.ok) throw new Error(data.error || "修复失败，请稍后重试。");
      setResult(data);
    } catch (repairError) {
      setError(repairError instanceof Error ? repairError.message : "修复失败，请稍后重试。");
    } finally {
      setRunning(false);
    }
  }

  return (
    <main className="cr-site-background px-6 py-20 text-[#17212b]">
      <SiteBackdrop />
      <div className="mx-auto max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#687985]">Account maintenance</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">修复重复生词</h1>
        <p className="mt-4 text-sm leading-7 text-[#5f6d79]">
          按“单词＋原句”合并云端重复项，保留内容最完整的词条和 Anki 导入记录。操作可重复执行。
        </p>
        <button
          className="mt-8 rounded-full bg-[#174f82] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#123f68] disabled:opacity-50"
          type="button"
          disabled={running}
          onClick={() => void repair()}
        >
          {running ? "正在修复…" : "开始修复"}
        </button>
        {result && (
          <div className="mt-8 rounded-[16px] bg-[#fbfcfe] p-6 text-sm leading-7 shadow-[0_3px_8px_rgb(43_61_77_/_9%)]">
            <p>修复前：{result.before} 条活跃生词</p>
            <p>修复后：{result.after} 个逻辑词条</p>
            <p>本次删除重复项：{result.removed} 条</p>
            <p>剩余恢复副本：{result.recoveredActive} 条</p>
          </div>
        )}
        {error && <p className="mt-6 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  );
}
