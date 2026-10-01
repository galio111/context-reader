"use client";

import { useEffect, useRef, useState } from "react";
import { readCetEditableParagraphs, writeCetEditableParagraphs, validateCetParagraphEdit } from "@/lib/cetPaperFormatting";
import type { CetPaper, CetSection } from "@/types/cet";

export function CetPaperEditor({ paperId, section, onSaved, onClose }: {
  paperId: string; section: CetSection;
  onSaved: (paragraphs: string[]) => void; onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const baseline = useRef(section.paragraphs);
  const revision = useRef<string | null>(null);
  const history = useRef<string[][]>([]);
  const index = useRef(0);
  const saving = useRef(false);
  const live = useRef(true);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    live.current = true;
    const controller = new AbortController();
    // React never owns the editable descendants, including during input or save.
    if (root.current) writeCetEditableParagraphs(root.current, section.paragraphs);
    void fetch(`/api/admin/cet-paper?id=${encodeURIComponent(paperId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "正文暂不可用，请重试。");
        return data as { paper: CetPaper; revision: string | null };
      }).then(data => {
        if (!live.current) return;
        const current = data.paper.sections.find(item => item.id === section.id);
        if (!current || !root.current) throw new Error("未找到当前正文，请重新打开题目。");
        baseline.current = current.paragraphs;
        revision.current = data.revision;
        history.current = [[...current.paragraphs]];
        index.current = 0;
        writeCetEditableParagraphs(root.current, current.paragraphs);
        setReady(true);
      }).catch(error => {
        if (live.current && !controller.signal.aborted) setMessage(error instanceof Error && !(error instanceof TypeError) ? error.message : "正文加载失败，请重试。");
      });
    return () => { live.current = false; controller.abort(); };
    // Saving updates the section in the parent without resetting the live DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId, section.id]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  function refresh() {
    if (!root.current) return;
    setDirty(JSON.stringify(readCetEditableParagraphs(root.current)) !== JSON.stringify(baseline.current));
    setCanUndo(index.current > 0);
    setCanRedo(index.current < history.current.length - 1);
  }
  function record() {
    if (!root.current) return;
    const paragraphs = readCetEditableParagraphs(root.current);
    if (JSON.stringify(paragraphs) !== JSON.stringify(history.current[index.current])) {
      history.current = [...history.current.slice(0, index.current + 1), paragraphs].slice(-100);
      index.current = history.current.length - 1;
    }
    refresh(); setClosing(false);
  }
  function moveHistory(direction: number) {
    if (!root.current || saving.current) return;
    const next = index.current + direction;
    if (next < 0 || next >= history.current.length) return;
    index.current = next;
    writeCetEditableParagraphs(root.current, history.current[next]);
    refresh();
  }
  async function save(close = false) {
    if (!root.current || !ready || saving.current) return;
    const paragraphs = readCetEditableParagraphs(root.current);
    if (!paragraphs.some(value => value.trim())) { setMessage("请保留正文。"); return; }
    const invalid = validateCetParagraphEdit(baseline.current, paragraphs);
    if (invalid) { setMessage(invalid); return; }
    saving.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/cet-paper", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paperId, sectionId: section.id, paragraphs, expectedRevision: revision.current }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "保存失败，请重试。");
      if (!live.current) return;
      baseline.current = paragraphs; revision.current = data.revision;
      onSaved(paragraphs);
      refresh(); setClosing(false); setMessage("排版已保存，当前原文已更新。");
      if (close) onClose();
    } catch (error) {
      if (live.current) setMessage(error instanceof Error && !(error instanceof TypeError) ? error.message : "保存失败，请重试。");
    } finally { saving.current = false; if (live.current) setBusy(false); }
  }

  return <>
    <div className="cet-paper-editor-tools" role="group" aria-label="原文排版编辑">
      <span>{ready ? "直接修改原文；Enter 分段，Shift+Enter 换行。" : "正在载入可编辑原文…"}</span>
      <div className="cet-paper-editor-actions">
        <button type="button" disabled={!canUndo || busy} onClick={() => moveHistory(-1)}>撤销</button>
        <button type="button" disabled={!canRedo || busy} onClick={() => moveHistory(1)}>重做</button>
        <button type="button" disabled={!dirty || busy || !ready} onClick={() => void save()}>{busy ? "保存中…" : "保存排版"}</button>
        <button type="button" disabled={busy} onClick={() => dirty ? setClosing(true) : onClose()}>完成编辑</button>
      </div>
      {closing && <div className="cet-paper-editor-actions"><span>有尚未保存的修改。</span><button type="button" onClick={() => setClosing(false)}>继续编辑</button><button type="button" onClick={onClose}>放弃修改</button><button type="button" onClick={() => void save(true)}>保存并退出</button></div>}
      {message && <span role="status">{message}</span>}
    </div>
    <div ref={root} className="cet-passages cet-editable-passages" data-native-selection="blue" role="textbox" aria-label="真题原文排版" aria-multiline="true" aria-busy={busy || !ready} contentEditable={ready && !busy} suppressContentEditableWarning spellCheck={false} onInput={record} onKeyDown={event => {
      if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
        event.preventDefault(); moveHistory(event.shiftKey || event.key.toLowerCase() === "y" ? 1 : -1);
      }
    }} onBeforeInput={event => {
      const type = (event.nativeEvent as InputEvent).inputType;
      if (type === "historyUndo" || type === "historyRedo") { event.preventDefault(); moveHistory(type === "historyUndo" ? -1 : 1); }
    }} onPaste={event => {
      event.preventDefault();
      const selection = window.getSelection();
      if (!selection?.rangeCount || !root.current?.contains(selection.anchorNode)) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const text = document.createTextNode(event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n"));
      range.insertNode(text); range.setStartAfter(text); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range); record();
    }} />
  </>;
}
