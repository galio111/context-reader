"use client";

import { useEffect, useState } from "react";
import type { CetPaper } from "@/types/cet";

export function CetPaperEditor({ paperId, initialSectionId, onSaved }: { paperId: string; initialSectionId: string; onSaved: () => void }) {
  const [paper, setPaper] = useState<CetPaper | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [sectionId, setSectionId] = useState(initialSectionId);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const section = paper?.sections.find(item => item.id === sectionId);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/cet-paper?id=${encodeURIComponent(paperId)}`, { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "加载失败。");
        return data as { paper: CetPaper; revision: string | null };
      })
      .then(data => { if (live) { setPaper(data.paper); setRevision(data.revision); setSectionId(data.paper.sections.some(item => item.id === initialSectionId) ? initialSectionId : data.paper.sections[0]?.id || ""); } })
      .catch(error => { if (live) setMessage(error instanceof Error ? error.message : "加载失败。"); });
    return () => { live = false; };
  }, [paperId, initialSectionId]);

  useEffect(() => { setDraft(section?.paragraphs.join("\n\n") || ""); }, [section]);

  async function save() {
    if (!section || busy) return;
    const paragraphs = draft.split(/\n\s*\n/g).map(value => value.trim()).filter(Boolean);
    if (!paragraphs.length) { setMessage("请保留正文。"); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/cet-paper", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId, sectionId, paragraphs, expectedRevision: revision }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败。");
      const refreshedResponse = await fetch(`/api/admin/cet-paper?id=${encodeURIComponent(paperId)}`, { cache: "no-store" });
      if (!refreshedResponse.ok) throw new Error("已保存，但重新载入失败。请关闭编辑器后再打开核对。");
      const refreshed = await refreshedResponse.json() as {paper: CetPaper; revision: string | null};
      setPaper(refreshed.paper); setRevision(refreshed.revision);
      setMessage("已保存。新打开这道题的用户会看到修改后的排版；正在阅读的答卷保持原内容。");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
    } finally { setBusy(false); }
  }

  return <div className="cet-paper-editor">
    <p>逐段检查正文，空一行表示新段落。保存会应用给之后打开这道题的用户；题号、选项和答案无法在此修改。</p>
    {paper && <label>题组 <select value={sectionId} onChange={event => { if (section && draft !== section.paragraphs.join("\n\n")) { setMessage("请先保存或撤销本次输入，再切换题组。"); return; } setSectionId(event.target.value); setMessage(""); }}>
      {paper.sections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
    </select></label>}
    {section && <><label htmlFor="cet-paper-paragraph-editor">正文段落</label><textarea id="cet-paper-paragraph-editor" value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} />
      <small>{draft.split(/\n\s*\n/g).filter(value => value.trim()).length} 段 · 原版 {section.paragraphs.length} 段</small>
      <div className="cet-paper-editor-actions"><button type="button" disabled={busy || draft === section.paragraphs.join("\n\n")} onClick={() => setDraft(section.paragraphs.join("\n\n"))}>撤销本次输入</button><button type="button" disabled={busy || draft === section.paragraphs.join("\n\n")} onClick={() => void save()}>{busy ? "保存中…" : "保存排版"}</button></div></>}
    {message && <p role="status">{message}</p>}
  </div>;
}
