"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ReaderView } from "@/components/ReaderView";
import { PillNavAction } from "@/components/PillNavAction";
import { useAccount } from "@/components/AccountProvider";
import { useDocumentScrollLock } from "@/components/useDocumentScrollLock";
import { initializeLearningStorage, flushLearningStorage, getLearningStorage } from "@/lib/learningStorage";
import { readCetAttempts } from "@/lib/cetProgress";
import { adaptLegacyCetAttempt } from "@/lib/cetLegacy";
import { cetObservedConditions, exposureFor, priorCetSections, readCetExposures, saveCetExposure } from "@/lib/cetExposure";
import { readCetActivities, saveCetActivity } from "@/lib/cetActivityStorage";
import { cetAnswer, cetContentVersion, cetEligibility, cetFinalizedSection, cetFinalize, cetPause, cetPracticeSectionElapsedMs, cetQuestionKey, cetRemainingMs, cetResume, cetScopeKey, createCetActivity } from "@/lib/cetActivity";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { CetLibrary, type CetEntry } from "./CetLibrary";
import { CetText } from "./CetText";
import type { CetActivity, CetPaper, CetQuestion, CetSection } from "@/types/cet";
import type { WordContext } from "@/types/reader";
import toolbarStyles from "@/components/ReaderToolbar.module.css";
import "./cet.css";

const names = { cloze: "选词填空", matching: "长篇匹配", detail: "仔细阅读" };
const formatTime = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000).toString().padStart(2, "0")}:${Math.floor((Math.max(0, ms) / 1000) % 60).toString().padStart(2, "0")}`;
type BaseProps = Pick<ComponentProps<typeof ReaderView>, "savedArticles" | "onArticleSaved" | "onOpenSavedArticle" | "onRenameSavedArticle" | "onDeleteSavedArticle" | "onOpenImportedArticle">;
type DialogName = "选择真题" | "练习历史" | "答题卡" | "提交本篇" | "提交自测" | "结束自测并精读" | "直接精读" | "重新练习" | "开始新自测" | "保存失败" | "";

function Sheet({ title, onClose, children, left = false }: { title: string; onClose: () => void; children: ReactNode; left?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useDocumentScrollLock(true);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={ref} className={`cet-sheet ${left ? "cet-sheet-left" : ""}`} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`关闭${title}`}>×</button></header><div className="cet-sheet-body">{children}</div></section>
  </dialog>;
}

function TimerClock({ read, label, running }: { read: () => number; label: string; running: boolean }) {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    if (!running) return;
    const interval = window.setInterval(() => setValue(read()), 1000);
    return () => window.clearInterval(interval);
  }, [read, running]);
  return <strong aria-label={label} aria-live="off">{formatTime(value)}</strong>;
}

function ChoicePicker({ anchor, options, selected, title, onChoose, onClose }: {
  anchor: DOMRect;
  options: { key: string; text: string }[];
  selected: string;
  title: string;
  onChoose: (key: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const handleKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } };
    const handlePointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("pointerdown", handlePointer);
    return () => { document.removeEventListener("keydown", handleKey); document.removeEventListener("pointerdown", handlePointer); previous?.focus(); };
  }, [onClose]);
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - 285));
  const top = Math.max(12, Math.min(anchor.bottom + 6, window.innerHeight - 330));
  return createPortal(<div className="cet-choice-picker" ref={ref} role="dialog" aria-label={title} style={{ left, top }}>
    <div className="cet-choice-title">{title}</div>
    <div className="cet-choice-list">
      <button type="button" aria-pressed={!selected} onClick={() => onChoose("")}>清空答案</button>
      {options.map((option) => <button type="button" key={option.key} aria-pressed={selected === option.key} onClick={() => onChoose(option.key)}><b>{option.key}</b><span>{option.text}</span></button>)}
    </div>
  </div>, document.body);
}

export function CetReader({ entry, onOpen, onBack, ...base }: BaseProps & { entry: CetEntry; onOpen: (e: CetEntry) => void; onBack: () => void }) {
  const { account, isOffline } = useAccount();
  const [paper, setPaper] = useState<CetPaper | null>(null);
  const [activity, setActivity] = useState<CetActivity | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<CetActivity | null>(null);
  const [view, setView] = useState<"start" | "reading" | "direct">("start");
  const [history, setHistory] = useState<CetActivity[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState<DialogName>("");
  const [minutes, setMinutes] = useState(entry.sectionId ? 10 : 40);
  const [activeToken, setActiveToken] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedFinalId, setSelectedFinalId] = useState("");
  const [directSectionId, setDirectSectionId] = useState("");
  const [exposures, setExposures] = useState(readCetExposures);
  const [choice, setChoice] = useState<{ question: CetQuestion; section: CetSection; anchor: DOMRect } | null>(null);
  const [historyLimit, setHistoryLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const current = useRef<CetActivity | null>(null);
  const owner = useRef("");
  const pendingScroll = useRef<number | null>(null);
  const practiceSegment = useRef<{ id: string; sectionId: string; start: number } | null>(null);
  const pendingFinal = useRef<CetActivity | null>(null);
  const directSessionId = useRef(crypto.randomUUID());
  const recordedExposureIds = useRef(new Set<string>());
  const starting = useRef(false);
  const submitting = useRef(false);
  const storageOwner = useCallback(() => getLearningStorage().getItem("context-reader:local-account-owner:v1") || "guest", []);

  const refreshHistory = useCallback(() => { setHistory(readCetActivities().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setExposures(readCetExposures()); }, []);
  const persistDraft = useCallback((next: CetActivity): boolean => {
    if (owner.current !== storageOwner()) { setNotice("账号已切换，请重新打开这份阅读。"); return false; }
    current.current = next;
    setActivity(next);
    try {
      const saved = saveCetActivity(next);
      current.current = saved;
      setActivity(saved);
      void flushLearningStorage().catch(() => setNotice("进度已留在当前页面，但本机持久化尚未完成，请重试。"));
      return true;
    } catch {
      setNotice("本机保存失败。答案仍留在当前页面，请勿关闭并重试。");
      return false;
    }
  }, [storageOwner]);

  const checkpointPractice = useCallback((stop = false) => {
    const a = current.current;
    const segment = practiceSegment.current;
    if (!a || (a.purpose !== "practice" && !a.legacy) || !segment || a.status === "submitted") return;
    const parts = { ...a.timerParts, [segment.id]: Math.max(0, Date.now() - segment.start) };
    persistDraft({ ...a, timerParts: parts, elapsedMs: Object.values(parts).reduce((sum, ms) => sum + ms, 0), updatedAt: new Date().toISOString() });
    if (stop) practiceSegment.current = null;
  }, [persistDraft]);

  useEffect(() => {
    let live = true;
    current.current = null;
    practiceSegment.current = null;
    pendingFinal.current = null;
    setSelectedFinalId(""); setDirectSectionId("");
    recordedExposureIds.current.clear();
    setPaper(null); setActivity(null); setLegacyPreview(null); setView("start"); setError(""); setNotice(""); setChoice(null);
    void Promise.all([
      initializeLearningStorage(),
      fetch(`/api/cet?id=${encodeURIComponent(entry.paperId)}`).then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "试卷加载失败。");
        return data.paper as CetPaper;
      }),
    ]).then(([, loaded]) => {
      if (!live) return;
      owner.current = storageOwner();
      const records = readCetActivities().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const selected = entry.attemptId ? records.find((a) => a.id === entry.attemptId || a.sourceAttemptId === entry.attemptId) : undefined;
      const old = entry.attemptId && !selected ? readCetAttempts().find((a) => a.id === entry.attemptId) : undefined;
      setPaper(loaded);
      setHistory(records);
      if (selected && selected.paperId === loaded.id && selected.owner === owner.current) {
        current.current = selected;
        setActivity(selected);
        setView("reading");
        if (selected.purpose === "practice" && selected.status === "in_progress" && !cetFinalizedSection(selected, selected.activeSection) && !document.hidden) practiceSegment.current = { id: `${selected.activeSection}#${crypto.randomUUID()}`, sectionId: selected.activeSection, start: Date.now() };
      } else if (old && old.paperId === loaded.id) {
        setLegacyPreview(adaptLegacyCetAttempt(old, loaded, owner.current));
      }
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "试卷加载失败，请重试。"); });
    return () => { live = false; checkpointPractice(true); void flushLearningStorage().catch(() => {}); };
    // The previous activity is checkpointed before each entry change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.paperId, entry.sectionId, entry.attemptId, account.profile?.userId]);

  useEffect(() => {
    const interval = window.setInterval(() => checkpointPractice(), 10_000);
    const onVisibility = () => {
      if (document.hidden) checkpointPractice(true);
      else if (current.current?.purpose === "practice" && current.current.status === "in_progress" && !cetFinalizedSection(current.current, current.current.activeSection) && view === "reading") practiceSegment.current = { id: `${current.current.activeSection}#${crypto.randomUUID()}`, sectionId: current.current.activeSection, start: Date.now() };
    };
    const onPageHide = () => checkpointPractice(true);
    const onMerge = () => {
      refreshHistory();
      const a = current.current;
      if (!a) return;
      const updated = readCetActivities().find((item) => item.id === a.id);
      if (updated) { current.current = updated; setActivity(updated); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, onMerge);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("pagehide", onPageHide); window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, onMerge); };
  }, [checkpointPractice, refreshHistory, view]);

  useLayoutEffect(() => {
    if (pendingScroll.current !== null) { window.scrollTo(0, pendingScroll.current); pendingScroll.current = null; }
  }, [activity?.activeSection, directSectionId]);

  useEffect(() => {
    if (!paper || view === "start" || activity?.status === "paused") return;
    const section = paper.sections.find((item) => item.id === (activity?.activeSection || directSectionId || entry.sectionId || paper.sections[0]?.id));
    if (!section) return;
    const base = activity?.id || directSessionId.current;
    const events: Array<"read" | "answer_view"> = ["read"];
    if (view === "direct" || activity?.status === "submitted" || activity?.status === "ended" || (activity?.purpose === "practice" && Boolean(cetFinalizedSection(activity, section.id)))) events.push("answer_view");
    for (const kind of events) {
      const id = `${kind}:${base}:${section.id}`;
      if (recordedExposureIds.current.has(id)) continue;
      try {
        saveCetExposure(exposureFor(section, paper.id, owner.current, kind, id, activity?.id));
        recordedExposureIds.current.add(id);
      } catch { setNotice("学习记录暂未保存到本机，请保留页面并重试。"); }
    }
  }, [paper, view, activity, entry.sectionId, directSectionId]);

  const start = useCallback(async (purpose: "practice" | "self_test") => {
    if (!paper || starting.current) return;
    const expectedOwner = owner.current;
    if (expectedOwner !== storageOwner()) return;
    starting.current = true; setBusy(true); setNotice("");
    try {
      const scope = entry.sectionId ? [entry.sectionId] : paper.sections.map((s) => s.id);
      const now = new Date().toISOString();
      const knownPrior = [...new Set([
        ...priorCetSections(paper.sections.filter((s) => scope.includes(s.id)), readCetExposures(), now, owner.current),
        ...readCetAttempts().filter((a) => a.paperId === paper.id).flatMap((a) => scope.filter((id) => a.revealed[id] || Object.entries(a.answers).some(([key, value]) => key.startsWith(`${id}:`) && value))),
      ])];
      const next = createCetActivity({ paper, sectionId: entry.sectionId, purpose, owner: owner.current, minutes, knownPriorSectionIds: knownPrior, now });
      const saved = saveCetActivity(next);
      await flushLearningStorage();
      if (expectedOwner !== storageOwner()) return;
      current.current = saved;
      setActivity(saved); setView("reading"); refreshHistory();
      if (purpose === "practice") practiceSegment.current = { id: `${saved.activeSection}#${crypto.randomUUID()}`, sectionId: saved.activeSection, start: Date.now() };
    } catch { setNotice("开始记录未能保存到本机，请重试。"); }
    finally { starting.current = false; setBusy(false); }
  }, [paper, entry.sectionId, minutes, refreshHistory, storageOwner]);

  const commit = useCallback(async (reason: "passage_submit" | "manual_submit" | "time_expired" | "ended_for_study", sectionId?: string) => {
    const a = current.current;
    if (!paper || !a || submitting.current) return;
    const expectedOwner = owner.current;
    if (expectedOwner !== storageOwner() || a.owner !== expectedOwner) return;
    if (a.purpose === "practice" || a.legacy) checkpointPractice(true);
    submitting.current = true; setBusy(true); setNotice("");
    try {
      const latest = current.current || a;
      const next = pendingFinal.current || cetFinalize(latest, paper, reason, sectionId);
      pendingFinal.current = next;
      const saved = saveCetActivity(next);
      await flushLearningStorage();
      if (expectedOwner !== storageOwner()) return;
      pendingFinal.current = null;
      current.current = saved;
      setActivity(saved); setSheet(""); refreshHistory();
      if (reason === "ended_for_study") setView("reading");
      if (saved.purpose === "practice" && saved.status === "in_progress" && !cetFinalizedSection(saved, saved.activeSection) && !document.hidden) practiceSegment.current = { id: `${saved.activeSection}#${crypto.randomUUID()}`, sectionId: saved.activeSection, start: Date.now() };
    } catch { setNotice("结果尚未可靠保存，本篇答案不会揭晓。请点击重试。"); setSheet("保存失败"); }
    finally { submitting.current = false; setBusy(false); }
  }, [paper, checkpointPractice, refreshHistory, storageOwner]);

  useEffect(() => {
    if (!paper || !activity || activity.purpose !== "self_test" || activity.status !== "in_progress") return;
    const check = () => {
      const a = current.current;
      if (a?.id === activity.id && a.status === "in_progress" && cetRemainingMs(a) <= 0) void commit("time_expired");
    };
    check();
    const interval = window.setInterval(check, 1000);
    return () => window.clearInterval(interval);
  }, [paper, activity, commit]);

  const leaveTo = useCallback(async (target: () => void) => {
    const a = current.current;
    const expectedOwner = owner.current;
    if (expectedOwner !== storageOwner()) { setNotice("账号已切换，请重新打开这份阅读。"); return; }
    if (a?.purpose === "self_test" && a.status === "in_progress") {
      if (!a.legacy && cetRemainingMs(a) <= 0) { await commit("time_expired"); return; }
      setBusy(true);
      try {
        const paused = cetPause(a);
        const saved = saveCetActivity(paused);
        await flushLearningStorage();
        if (expectedOwner !== storageOwner()) return;
        current.current = saved; setActivity(saved);
        setNotice(""); target();
      } catch { setNotice("本机保存失败，仍停留在当前自测。请重试。"); }
      finally { setBusy(false); }
      return;
    }
    checkpointPractice(true);
    try { await flushLearningStorage(); if (expectedOwner === storageOwner()) target(); }
    catch { setNotice("本机保存失败，仍停留在当前阅读。请重试。"); }
  }, [checkpointPractice, storageOwner, commit]);

  if (error) return <div className="cet-load"><p role="alert">{error}</p><button onClick={onBack}>返回首页</button></div>;
  if (!paper) return <div className="cet-load" role="status">正在打开试卷…</div>;

  const scopeIds = activity?.sectionIds || (entry.sectionId ? [entry.sectionId] : paper.sections.map((s) => s.id));
  const scope = paper.sections.filter((s) => scopeIds.includes(s.id));
  const section = scope.find((s) => s.id === (activity?.activeSection || directSectionId)) || scope[0];
  if (!section) return <div className="cet-load" role="alert">阅读部分暂不可用。</div>;
  const shown = view !== "start";
  const testing = Boolean(activity?.purpose === "self_test" && activity.status === "in_progress");
  const paused = Boolean(activity?.purpose === "self_test" && activity.status === "paused");
  const locked = !shown || testing || paused;
  const applicableFinalizations = activity ? Object.values(activity.finalizations).filter((item) => activity.purpose === "self_test" ? !item.sectionId : item.sectionId === section.id) : [];
  const result = applicableFinalizations.find((item) => item.id === selectedFinalId) || applicableFinalizations[0];
  const sectionResult = activity?.purpose === "practice" ? result : undefined;
  const showAnswers = view === "direct" || Boolean(result) || activity?.status === "ended";
  const displayAnswer = (sectionId: string, key: string) => {
    const finalized = activity?.purpose === "self_test" ? result : sectionId === section.id ? result : activity && cetFinalizedSection(activity, sectionId);
    return finalized ? finalized.answers[key] || "" : activity?.answers[key]?.value || "";
  };
  const answered = activity ? activity.questionKeys.filter((key) => displayAnswer(key.slice(0, key.lastIndexOf(":")), key)).length : 0;
  const activeSectionIndex = scope.indexOf(section);
  const sectionAnswered = section.questions.filter((q) => activity?.answers[cetQuestionKey(section.id, q.number)]?.value).length;
  const remaining = activity?.purpose === "practice" ? section.questions.length - sectionAnswered : (activity?.questionKeys.length || 0) - answered;
  const submittedCount = activity?.purpose === "practice" ? scope.filter((s) => cetFinalizedSection(activity, s.id)).length : 0;
  const contentChanged = Boolean(result && result.contentVersion !== cetContentVersion(paper, scopeIds));
  const observedConditions = activity ? cetObservedConditions(activity, paper.sections, exposures) : [];
  const timerRead = () => {
    const a = current.current;
    if (!a) return 0;
    if (a.purpose === "self_test" && !a.legacy) return cetRemainingMs(a);
    if (a.purpose === "practice" && sectionResult) return sectionResult.elapsedMs;
    const segment = practiceSegment.current;
    if (a.purpose === "practice" && !a.legacy) return cetPracticeSectionElapsedMs(a, section.id) + (segment?.sectionId === section.id ? Math.max(0, Date.now() - segment.start - (a.timerParts[segment.id] || 0)) : 0);
    return a.elapsedMs + (segment ? Math.max(0, Date.now() - segment.start - (a.timerParts[segment.id] || 0)) : 0);
  };
  const timer = activity && <div className="cet-timer" data-state={activity.status}>
    <span>{activity.purpose === "self_test" && !activity.legacy ? "自测剩余" : activity.legacy ? "旧版计时" : "学习用时"}</span>
    <TimerClock key={`${activity.id}:${activity.status}:${section.id}`} read={timerRead} label={activity.purpose === "self_test" && !activity.legacy ? "自测剩余时间" : "学习用时"} running={activity.status === "in_progress" && !sectionResult && (!activity.legacy || Boolean(practiceSegment.current))} />
    {activity.purpose === "self_test" && activity.status === "paused" && <small>已暂停 · 本次已标记中断</small>}
    {activity.purpose === "practice" && <small>仅供学习参考</small>}
    {activity.legacy && activity.status === "in_progress" && <button type="button" onClick={() => { if (practiceSegment.current) checkpointPractice(true); else practiceSegment.current = { id: `${section.id}#${crypto.randomUUID()}`, sectionId: section.id, start: Date.now() }; setActivity({ ...current.current! }); }}>{practiceSegment.current ? "暂停计时" : "开始计时"}</button>}
  </div>;

  const updateDraft = (question: CetQuestion, value: string) => {
    const a = current.current;
    if (!a || a.status !== "in_progress") return;
    if (a.legacy?.mode === "study" && a.legacy.raw.answers[cetQuestionKey(section.id, question.number)]) return;
    if (a.legacy?.raw.revealed[section.id]) return;
    if (a.purpose === "self_test" && cetRemainingMs(a) <= 0) { void commit("time_expired"); return; }
    const key = cetQuestionKey(section.id, question.number);
    if (section.type === "cloze" && value && section.questions.some((other) => other.number !== question.number && a.answers[cetQuestionKey(section.id, other.number)]?.value === value)) {
      setNotice("这个单词已用于另一空，请先清空原空格。"); return;
    }
    persistDraft(cetAnswer(a, key, value));
    try { saveCetExposure(exposureFor(section, paper.id, owner.current, "answer", `answer:${a.id}:${section.id}`, a.id)); } catch { /* The draft remains visible and can be retried. */ }
    setNotice("");
  };
  const changeSection = (id: string, scroll = false) => {
    pendingScroll.current = scroll ? 0 : window.scrollY;
    setChoice(null); setActiveToken("");
    checkpointPractice(true);
    const a = current.current;
    if (a) {
      persistDraft({ ...a, activeSection: id, updatedAt: new Date().toISOString() });
      if (a.purpose === "practice" && a.status === "in_progress" && !cetFinalizedSection(a, id) && !document.hidden) practiceSegment.current = { id: `${id}#${crypto.randomUUID()}`, sectionId: id, start: Date.now() };
    } else setDirectSectionId(id);
  };
  const lookupText = (text: string, lookup: (context: WordContext) => void, contextText?: string) => <CetText text={text} locked={locked} lookup={lookup} active={activeToken} onActive={setActiveToken} contextText={contextText} />;
  const answerFor = (question: CetQuestion) => displayAnswer(section.id, cetQuestionKey(section.id, question.number));
  const isRevealed = (question: CetQuestion) => !testing && (showAnswers || Boolean(activity?.legacy?.raw.revealed[section.id]) || Boolean(activity?.legacy?.mode === "study" && activity.legacy.raw.answers[cetQuestionKey(section.id, question.number)]));
  const explain = (question: CetQuestion) => {
    const key = cetQuestionKey(section.id, question.number);
    const snapshot = result?.questions.find((q) => q.key === key);
    const original = result?.answers[key] ?? answerFor(question);
    const correct = (snapshot?.answer || question.answer) && original === (snapshot?.answer || question.answer);
    const open = !correct || expanded.includes(key) || view === "direct";
    return <div className="cet-explanation" data-correct={Boolean(correct)}>
      <button type="button" onClick={() => setExpanded((prior) => prior.includes(key) ? prior.filter((item) => item !== key) : [...prior, key])}>
        {view === "direct" ? `参考答案 ${question.answer || "待核对"}` : snapshot?.answer || question.answer ? `${!original ? "未作答" : correct ? "回答正确" : "回答错误"} · 原答案 ${original || "空"} · 参考答案 ${snapshot?.answer || question.answer}` : "此题暂无可靠参考答案"} {correct && (open ? "收起解析" : "展开解析")}
      </button>
      {open && <p>{snapshot?.explanation || question.explanation || "来源暂未提供可靠解析，此题暂不计分。"}</p>}
    </div>;
  };
  const openChoice = (event: React.MouseEvent<HTMLButtonElement>, question: CetQuestion) => setChoice({ question, section, anchor: event.currentTarget.getBoundingClientRect() });
  const beginDirect = () => { checkpointPractice(true); setSheet(""); setView("direct"); setActivity(null); current.current = null; };
  const startNew = (purpose: "practice" | "self_test") => { void leaveTo(() => { setSheet(""); setView("start"); setActivity(null); current.current = null; if (purpose === "self_test") setSheet("开始新自测"); }); };
  const scopedHistory = history.filter((record) => record.scopeKey === cetScopeKey(paper.id, entry.sectionId));
  const primaryRecord = scopedHistory.find((record) => record.status === "in_progress" || record.status === "paused") || scopedHistory.find((record) => record.status === "submitted" || record.status === "ended");
  const openRecord = (record: CetActivity) => { checkpointPractice(true); current.current = record; setActivity(record); setView("reading"); if (record.purpose === "practice" && record.status === "in_progress" && !cetFinalizedSection(record, record.activeSection) && !document.hidden) practiceSegment.current = { id: `${record.activeSection}#${crypto.randomUUID()}`, sectionId: record.activeSection, start: Date.now() }; };

  const startSurface = <div className="cet-start">
    <span className="cet-start-kicker">{entry.sectionId ? "单篇题组" : "阅读套卷"} · CET {paper.level}</span>
    <h1>{entry.sectionId ? `${paper.title} · ${section.title}` : paper.title}</h1>
    <p>{entry.sectionId ? names[section.type] : "选词填空 · 长篇匹配 · 仔细阅读"} · {scope.reduce((sum, item) => sum + item.questions.length, 0)} 题</p>
    {history.some((a) => a.paperId === paper.id && a.sectionIds.some((s) => scopeIds.includes(s))) && <p className="cet-start-history">此前在本站接触过这份材料；再次自测会标记为重复材料。</p>}
    {legacyPreview && <div className="cet-legacy-preview"><strong>旧版{legacyPreview.purpose === "self_test" ? "自测" : "练习"}记录</strong><p>{legacyPreview.status === "submitted" ? "可回看旧答案；当时的辅助和计时条件记录不完整。" : legacyPreview.purpose === "self_test" ? "可继续原答案，保留旧版手动计时口径；曾提前查看的答案不会被清除。" : "已即时反馈的题目会保持原答案，不会变成新的未揭晓练习。"}</p><button type="button" onClick={() => { try { const saved = saveCetActivity(legacyPreview); current.current = saved; setActivity(saved); setView("reading"); setLegacyPreview(null); } catch { setNotice("旧版记录迁移未能保存，请重试。"); } }}>{legacyPreview.status === "submitted" ? "回看旧答卷" : "继续旧版进度"}</button></div>}
    <div className="cet-start-actions">
      {primaryRecord && <button type="button" className="cet-primary" onClick={() => openRecord(primaryRecord)}>{primaryRecord.status === "submitted" || primaryRecord.status === "ended" ? "查看结果与解析" : primaryRecord.purpose === "self_test" ? "继续上次自测" : "继续上次练习"}</button>}
      <button type="button" className={primaryRecord ? undefined : "cet-primary"} disabled={busy} onClick={() => void start("practice")}>{primaryRecord ? "开始新练习" : "开始练习"}</button>
      <button type="button" disabled={busy} onClick={() => void start("self_test")}>{primaryRecord ? "开始新自测" : `开始${entry.sectionId ? "单篇自测" : "阅读套卷自测"}`}</button>
      <button type="button" onClick={beginDirect}>直接精读</button>
    </div>
    <label className="cet-budget">自测时长 <input type="number" min="1" max="180" value={minutes} onChange={(event) => setMinutes(Number(event.target.value))} /> 分钟 <small>开始后不可更改；套卷默认 40 分钟，单篇建议 10 分钟。</small></label>
    <p className="cet-start-note">练习可使用查词和翻译，按篇提交后查看解析。自测开始即计时，统一提交前不提供学习辅助；保存并离开会暂停并记录中断。</p>
    {scopedHistory.slice(0, 3).map((record) => <button type="button" className="cet-start-record" key={record.id} onClick={() => openRecord(record)}><span>{record.purpose === "practice" ? "阅读练习" : "限时自测"} · {record.status === "submitted" ? "查看结果" : record.status === "ended" ? "未完成结束" : record.status === "paused" ? "继续已暂停自测" : "继续进度"}</span><small>{new Date(record.updatedAt).toLocaleDateString("zh-CN")}</small></button>)}
    {notice && <p className="cet-notice" role="alert">{notice}</p>}
  </div>;

  const renderReading = (lookup: (context: WordContext) => void) => {
    if (view === "start") return startSurface;
    if (paused && activity) return <div className="cet-paused"><h1>自测已暂停</h1><p>剩余 {formatTime(cetRemainingMs(activity))}。保存并离开已记录一次中断；继续后仍使用这份答卷。</p><button type="button" className="cet-primary" disabled={busy} onClick={() => { const resumed = cetResume(activity); persistDraft(resumed); }}>继续自测</button><button type="button" onClick={() => void leaveTo(onBack)}>返回首页</button></div>;
    return <div className="cet-reading">
      <div className="cet-reading-meta"><span>{paper.title} · {activity?.purpose === "self_test" ? entry.sectionId ? "单篇自测" : "阅读套卷自测" : view === "direct" ? "直接精读" : "阅读练习"}</span><span>{activity?.purpose === "practice" ? `已完成 ${submittedCount}/${scope.length} 篇` : activity?.purpose === "self_test" && activity.status === "in_progress" ? `已答 ${answered}/${activity.questionKeys.length} 题` : activity?.status === "ended" ? "未完成结束" : activity?.status === "submitted" ? "已提交" : ""}</span></div>
      <div className="cet-mobile-actions"><button onClick={() => setSheet("选择真题")}>选择真题</button><button onClick={() => setSheet("练习历史")}>练习历史</button><button onClick={() => setSheet("答题卡")}>答题卡</button></div>
      <nav className="cet-sections" aria-label="阅读部分">{scope.map((item) => <button key={item.id} aria-current={item.id === section.id ? "page" : undefined} onClick={() => changeSection(item.id)}>{item.type === "detail" ? item.title : names[item.type]}{activity?.purpose === "practice" && cetFinalizedSection(activity, item.id) ? " · 已提交" : ""}</button>)}</nav>
      {notice && <p className="cet-notice" role="alert">{notice}</p>}
      {isOffline && activity && <p className="cet-notice" role="status">已保存到本机，待网络恢复后同步。</p>}
      {activity?.legacy && <p className="cet-notice">旧版记录，条件记录不完整。{activity.conditions.includes("legacy_early_reveal") ? "曾提前查看答案；该事实保留。" : ""}</p>}
      {result?.reason === "time_expired" && <p className="cet-notice" role="status">时间已结束，已固定本次答卷。</p>}
      {result?.unreliable ? <p className="cet-notice">另有 {result.unreliable} 题缺少可靠参考答案，不计入结果分母。</p> : null}
      {applicableFinalizations.length > 1 && <div className="cet-conflicts"><p>这次活动在不同设备产生了 {applicableFinalizations.length} 份提交快照。原答案分别保留，暂不纳入默认自测统计。</p><div>{applicableFinalizations.map((item, index) => <button type="button" key={item.id} aria-pressed={result?.id === item.id} onClick={() => setSelectedFinalId(item.id)}>答卷 {index + 1} · {new Date(item.at).toLocaleString("zh-CN")}</button>)}</div></div>}
      {result && <div className="cet-result" role="status"><strong>{activity?.status === "ended" ? "未完成结束" : "本篇结果"}</strong><span>{activity?.status === "ended" ? `已答 ${result.questions.length - result.unanswered} 题 · 不计入完成成绩` : result.scoreable ? `答对 ${result.correct}/${result.scoreable} 题 · 未答 ${result.unanswered} 题` : "暂无可计分结果"}</span><span>{activity?.legacy ? "旧版计时" : activity?.purpose === "self_test" ? "自测用时" : "学习用时"} {formatTime(result.elapsedMs)}{result.everPaused ? " · 曾中断" : ""}</span>{contentChanged && <small>当前题库与作答时版本不同，此处按当时快照展示。</small>}{activity?.purpose === "self_test" && <small>{observedConditions.length ? "作答期间另有学习接触记录 · 条件记录不完整" : cetEligibility(activity, observedConditions) === "repeat_test" ? "重复材料自测" : cetEligibility(activity, observedConditions) === "conditions_incomplete" ? "条件记录不完整" : "首次在本站自测"}</small>}</div>}
      <div className="cet-mobile-timer">{timer}</div>
      <p className="cet-directions">{section.type === "cloze" ? "从词库中选择合适单词填入空格，每词限用一次。" : section.type === "matching" ? "为每个陈述选择对应段落；段落可以被重复选择。" : "阅读文章，并为每道题选择一个最佳答案。"}</p>
      <h1>{section.title}</h1>
      {section.bank && <div className="cet-word-bank">{section.bank.map((option) => <span key={option.key}><b>{option.key}</b> {lookupText(option.text, lookup)}</span>)}</div>}
      <div className="cet-passages">{section.paragraphs.map((text, index) => <p key={index}>{section.type === "cloze" ? text.split(/(\[\[\d+\]\])/g).map((part, partIndex) => {
        const number = Number(part.match(/\[\[(\d+)\]\]/)?.[1]);
        const question = section.questions.find((item) => item.number === number);
        return question ? <span className="cet-gap" id={`cet-q-${number}`} key={partIndex}><button type="button" disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={(event) => openChoice(event, question)} aria-label={`第 ${number} 空，${answerFor(question) || "未作答"}`}><b>{number}</b>{answerFor(question) ? <span>{question.options.find((option) => option.key === answerFor(question))?.text || answerFor(question)}</span> : <span>选词</span>}</button></span> : <span key={partIndex}>{lookupText(part, lookup, text)}</span>;
      }) : lookupText(text, lookup)}</p>)}</div>
      {section.type !== "cloze" && <div className="cet-questions">{section.questions.map((question) => <section id={`cet-q-${question.number}`} key={question.number}><h2><b>{question.number}.</b> {lookupText(question.stem, lookup)}</h2>{section.type === "detail" ? <div role="radiogroup" aria-label={`第 ${question.number} 题选项`}>{question.options.map((option) => <div className="cet-option" data-chosen={answerFor(question) === option.key} key={option.key}><button type="button" role="radio" aria-label={`第 ${question.number} 题选择 ${option.key}`} aria-checked={answerFor(question) === option.key} disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={() => updateDraft(question, answerFor(question) === option.key ? "" : option.key)}>{option.key}</button><span>{lookupText(option.text, lookup)}</span></div>)}</div> : <button type="button" className="cet-match-choice" disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={(event) => openChoice(event, question)}>{answerFor(question) ? `${answerFor(question)} 段` : "选择段落"} <span aria-hidden="true">⌄</span></button>}{isRevealed(question) && explain(question)}</section>)}</div>}
      {section.type === "cloze" && section.questions.some(isRevealed) && <section className="cet-cloze-explanations"><h2>选词填空解析</h2>{section.questions.filter(isRevealed).map((question) => <div key={question.number}><h3>第 {question.number} 空</h3>{explain(question)}</div>)}</section>}
      {activity?.purpose === "practice" && activity.status === "in_progress" && !sectionResult && <button type="button" className="cet-submit-passage" disabled={busy} onClick={() => setSheet("提交本篇")}>提交本篇</button>}
      {activity?.purpose === "practice" && activity.status === "in_progress" && !sectionResult && <button type="button" className="cet-direct-link" disabled={busy} onClick={() => setSheet("直接精读")}>结束练习并精读</button>}
      {activity?.purpose === "self_test" && activity.status === "in_progress" && <button type="button" className="cet-submit-passage" disabled={busy} onClick={() => setSheet("提交自测")}>提交自测</button>}
      <p className="cet-source">试题来源：<a href={paper.source} target="_blank" rel="noreferrer">CET46-Resources ↗</a>{showAnswers && paper.answerSource && <> · <a href={paper.answerSource} target="_blank" rel="noreferrer">参考答案与解析 ↗</a></>}。仅收录附有参考答案与解析的阅读材料。</p>
      <nav className="cet-bottom-nav"><button disabled={activeSectionIndex === 0} onClick={() => changeSection(scope[activeSectionIndex - 1].id, true)}>← 上一篇</button><span>{activeSectionIndex + 1} / {scope.length}</span><button disabled={activeSectionIndex === scope.length - 1} onClick={() => changeSection(scope[activeSectionIndex + 1].id, true)}>下一篇 →</button></nav>
    </div>;
  };

  return <>
    <ReaderView key={`${paper.id}:${section.id}:${view}`} {...base} article={shown && !paused ? section.paragraphs.join("\n\n").replace(/\[\[(\d+)\]\]/g, "（第 $1 空）") : ""} importedArticle={shown && !paused ? { title: `${paper.title} · ${section.title}`, siteName: "四六级真题", url: paper.source, text: section.paragraphs.join("\n\n"), blocks: section.paragraphs.map((text, index) => ({ id: `${section.id}-${index}`, type: "paragraph" as const, text })) } : null} onBack={() => void leaveTo(onBack)} desktopViewportInsetLeft={132} examSurface={{
      locked,
      lockedMessage: !shown ? "选择学习目标后开始阅读。" : paused ? "自测已暂停。点击继续自测后恢复题目与计时。" : undefined,
      onAssistanceShown: () => {
        if (view === "start" || testing || paused || owner.current !== storageOwner()) return;
        try { saveCetExposure(exposureFor(section, paper.id, owner.current, "assist", `assist:${activity?.id || directSessionId.current}:${section.id}`, activity?.id)); } catch { /* Reading tools remain usable if exposure persistence is temporarily unavailable. */ }
      },
      toolbar: <><PillNavAction className={toolbarStyles.action} label={shown ? `答题卡 ${answered}/${activity?.questionKeys.length || section.questions.length}` : "选择真题"} onClick={() => setSheet(shown ? "答题卡" : "选择真题")} />{testing && <PillNavAction className={toolbarStyles.action} label="提交自测" onClick={() => setSheet("提交自测")} />}</>,
      rail: <div className={`${toolbarStyles.railActions} cet-rail`}><button onClick={() => setSheet("选择真题")}><span>选择真题</span><small>按试卷或题型选择</small></button><button onClick={() => setSheet("练习历史")}><span>练习历史</span><small>继续或回看</small></button><button onClick={() => setSheet("重新练习")}><span>重新练习</span><small>保留本轮记录</small></button></div>,
      timer,
      menu: <div className="cet-menu">{testing && <><button onClick={() => void leaveTo(onBack)}>保存并离开</button><small>会暂停计时，并标记本次中断。</small><button onClick={() => setSheet("结束自测并精读")}>结束自测并精读</button><p>自测期间暂不可查词、翻译、保存文章或查看解析。</p></>}</div>,
      render: renderReading,
    }} />
    {choice && <ChoicePicker anchor={choice.anchor} options={choice.question.options} selected={activity?.answers[cetQuestionKey(choice.section.id, choice.question.number)]?.value || ""} title={`第 ${choice.question.number} 题选择${choice.section.type === "matching" ? "段落" : "单词"}`} onChoose={(key) => { updateDraft(choice.question, key); setChoice(null); }} onClose={() => setChoice(null)} />}
    {sheet && <Sheet title={sheet} left={sheet === "选择真题"} onClose={() => setSheet("")}>
      {sheet === "选择真题" ? <CetLibrary compact onOpen={(selected) => void leaveTo(() => { setSheet(""); onOpen(selected); })} /> : sheet === "练习历史" ? <div className="cet-history">{history.slice(0, historyLimit).map((record) => <button key={record.id} onClick={() => void leaveTo(() => { setSheet(""); onOpen({ paperId: record.paperId, sectionId: record.sectionId, attemptId: record.id }); })}><small>{record.sectionId ? "单篇" : "整卷"} · {record.purpose === "practice" ? "阅读练习" : "限时自测"}</small><strong>{record.title}</strong><span>{record.status === "submitted" ? "查看结果" : record.status === "ended" ? "未完成结束" : record.status === "paused" ? "继续已暂停自测" : "继续"} · {Object.values(record.answers).filter((answer) => answer.value).length} 题</span></button>)}{history.length > historyLimit && <button onClick={() => setHistoryLimit((n) => n + 30)}>加载更多记录</button>}{!history.length && <p>开始练习后，进度会保存在这里。</p>}</div> : sheet === "答题卡" ? <div className="cet-answer-card">{scope.map((item) => <section key={item.id}><h3>{names[item.type]}</h3>{item.questions.map((question) => { const selected = displayAnswer(item.id, cetQuestionKey(item.id, question.number)); return <button key={question.number} data-answered={Boolean(selected)} onClick={() => { changeSection(item.id); setSheet(""); requestAnimationFrame(() => document.getElementById(`cet-q-${question.number}`)?.scrollIntoView({ block: "center" })); }}>{question.number}{selected && ` · ${selected}`}</button>; })}</section>)}</div> : <div className="cet-confirm">
        <p>{sheet === "提交本篇" ? remaining ? `本篇还有 ${remaining} 题未作答。提交后答案固定并显示解析。` : "提交后答案固定并显示解析。" : sheet === "提交自测" ? remaining ? `还有 ${remaining} 题未作答。提交后本次自测结束，答案与用时固定。` : "提交后本次自测结束，答案与用时固定。" : sheet === "结束自测并精读" ? "当前答案和用时会保留，本次自测将标记为“未完成结束”。进入精读后可以查词和查看解析；这份答卷不能继续作为原自测作答。之后可以重新开始一份空白自测。" : sheet === "直接精读" ? "当前答案和学习用时会保留，这次练习标记为未完成结束，不计入完成成绩。进入精读后可以查词和查看解析；重新作答需要开始新练习。" : sheet === "保存失败" ? "结果尚未可靠保存，答案不会揭晓。请重试本机保存。" : "旧记录会保留，开始新一轮不会覆盖原答案。"}</p>
        <div className="cet-dialog-actions"><button onClick={() => setSheet("")}>{sheet === "结束自测并精读" ? "继续自测" : "返回继续"}</button><button disabled={busy} onClick={() => { if (sheet === "提交本篇") void commit("passage_submit", section.id); else if (sheet === "提交自测") void commit("manual_submit"); else if (sheet === "结束自测并精读") void commit("ended_for_study"); else if (sheet === "保存失败" && pendingFinal.current) void commit(pendingFinal.current.finalizations[Object.keys(pendingFinal.current.finalizations).at(-1)!]?.reason as "manual_submit"); else if (sheet === "直接精读") void commit("ended_for_study", section.id); else if (sheet === "重新练习") startNew("practice"); else if (sheet === "开始新自测") { setSheet(""); void start("self_test"); } }}>{sheet === "提交本篇" ? "提交并查看解析" : sheet === "提交自测" ? "提交自测" : sheet === "结束自测并精读" ? "结束并精读" : sheet === "直接精读" ? "结束并精读" : sheet === "保存失败" ? "重试保存" : "开始新一轮"}</button></div>
      </div>}
    </Sheet>}
  </>;
}
