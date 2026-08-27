"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";
import { HOME_CURATION_CATEGORIES, type HomeCurationCategory, type HomepageCuration } from "@/lib/homepageCurationShared";
import type { PublicArticle } from "@/types/publicArticle";

function emptyCuration(): HomepageCuration {
  return { version: 1, categories: { 推荐: [], 时事: [], 科技: [], 文化: [], 商业: [] }, updatedAt: "" };
}

export default function AdminHomepageCurationPanel({ articles }: { articles: PublicArticle[] }) {
  const [curation, setCuration] = useState<HomepageCuration>(emptyCuration);
  const [category, setCategory] = useState<HomeCurationCategory>("推荐");
  const [draggedId, setDraggedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const articleById = useMemo(() => new Map(articles.map((article) => [article.id, article])), [articles]);
  const selectedIds = curation.categories[category];
  const available = articles.filter((article) => !selectedIds.includes(article.id));

  useEffect(() => {
    void fetch("/api/admin/homepage-curation", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => null) as { curation?: HomepageCuration; error?: string } | null;
        if (!response.ok || !data?.curation) throw new Error(data?.error || "首页编排读取失败。");
        setCuration(data.curation);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "首页编排读取失败。"));
  }, []);

  function updateCategory(ids: string[]) {
    setCuration((current) => ({ ...current, categories: { ...current.categories, [category]: ids } }));
  }

  function addArticle(id: string) {
    if (!id || selectedIds.includes(id)) return;
    updateCategory(selectedIds.length ? [selectedIds[0], id, ...selectedIds.slice(1)] : [id]);
  }

  function moveArticle(id: string, direction: -1 | 1) {
    const index = selectedIds.indexOf(id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    updateCategory(next);
  }

  function dropBefore(targetId: string, event: DragEvent<HTMLLIElement>) {
    event.preventDefault();
    if (!draggedId || draggedId === targetId) return;
    const next = selectedIds.filter((id) => id !== draggedId);
    next.splice(Math.max(0, next.indexOf(targetId)), 0, draggedId);
    updateCategory(next);
    setDraggedId("");
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/homepage-curation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ curation }),
      });
      const data = await response.json().catch(() => null) as { curation?: HomepageCuration; error?: string } | null;
      if (!response.ok || !data?.curation) throw new Error(data?.error || "保存失败。");
      setCuration(data.curation);
      setMessage("首页外刊编排已保存，新请求会按此顺序读取。 ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5" aria-labelledby="homepage-curation-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="homepage-curation-title" className="text-[21px] font-semibold">首页外刊编排</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#4d535a]">每个栏目的第一篇都是该栏主推；“推荐”同时是游客首先看到的全局精选顺序。日常精选会自动更新，这里只用于微调。</p>
        </div>
        <button className="min-h-10 rounded-full bg-[#1769aa] px-4 text-sm font-medium text-white disabled:bg-[#aeb8c2]" type="button" onClick={() => void save()} disabled={saving}>{saving ? "保存中..." : "保存编排"}</button>
      </div>
      <div className="mt-5 flex gap-2 overflow-x-auto" role="tablist" aria-label="首页外刊分类">
        {HOME_CURATION_CATEGORIES.map((item) => <button key={item} type="button" role="tab" aria-selected={category === item} className={`min-h-10 shrink-0 rounded-full px-4 text-sm ${category === item ? "bg-[#1769aa] text-white" : "bg-[#edf3f6] text-[#335666]"}`} onClick={() => setCategory(item)}>{item}</button>)}
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(260px,.75fr)]">
        <div>
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">当前槽位</h3><span className="text-xs text-[#68717a]">{selectedIds.length} 篇</span></div>
          {selectedIds.length ? <ol className="grid gap-2">{selectedIds.map((id, index) => {
            const article = articleById.get(id);
            return <li key={id} draggable onDragStart={() => setDraggedId(id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropBefore(id, event)} className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl bg-[#f3f5f7] px-3 py-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-white text-xs font-semibold text-[#1769aa]">{index + 1}</span>
              <div className="min-w-0"><strong className="block truncate text-sm">{article?.title || "文章已下架"}</strong><span className="text-xs text-[#68717a]">{index === 0 ? "本栏主推 · " : ""}{article?.sourceName || id}</span></div>
              <div className="flex gap-1"><button className="h-8 w-8 rounded-full bg-white disabled:opacity-30" type="button" aria-label={`上移 ${article?.title || id}`} disabled={index === 0} onClick={() => moveArticle(id, -1)}>↑</button><button className="h-8 w-8 rounded-full bg-white disabled:opacity-30" type="button" aria-label={`下移 ${article?.title || id}`} disabled={index === selectedIds.length - 1} onClick={() => moveArticle(id, 1)}>↓</button><button className="h-8 rounded-full bg-white px-3 text-xs text-red-600" type="button" onClick={() => updateCategory(selectedIds.filter((item) => item !== id))}>移除</button></div>
            </li>;
          })}</ol> : <p className="rounded-xl bg-[#f3f5f7] px-4 py-8 text-center text-sm text-[#68717a]">尚未编排。保存前首页会继续使用公开文章的默认顺序。</p>}
        </div>
        <div>
          <h3 className="mb-3 font-semibold">从已发布文章加入</h3>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-[#dbe1e5] p-2">
            {available.length ? available.map((article) => <button key={article.id} type="button" className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#edf5fb]" onClick={() => addArticle(article.id)}><strong className="block text-sm">{article.title}</strong><span className="text-xs text-[#68717a]">{article.sourceName || "来源待确认"} · 加入</span></button>) : <p className="px-3 py-6 text-center text-sm text-[#68717a]">没有更多可加入的已发布文章。</p>}
          </div>
        </div>
      </div>
      {message && <p className="mt-4 text-sm text-[#315e66]" role="status">{message}</p>}
    </section>
  );
}
