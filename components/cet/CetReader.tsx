"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CetOptionList, CetSelect } from "./CetSelect";
import { ReaderView } from "@/components/ReaderView";
import { PillNavAction } from "@/components/PillNavAction";
import { useAccount } from "@/components/AccountProvider";
import { useDocumentScrollLock } from "@/components/useDocumentScrollLock";
import { initializeLearningStorage, flushLearningStorage, getLearningStorage } from "@/lib/learningStorage";
import { readCetAttempts } from "@/lib/cetProgress";
import { adaptLegacyCetAttempt } from "@/lib/cetLegacy";
import { cetObservedConditions, exposureFor, priorCetSections, readCetExposures, saveCetExposure } from "@/lib/cetExposure";
import { readCetActivities, saveCetActivity } from "@/lib/cetActivityStorage";
import { cetElapsedMs, cetHistoryLabel, cetAnswer, cetContentVersion, cetEligibility, cetFinalizedSection, cetFinalize, cetPause, cetPracticeSectionElapsedMs, cetQuestionKey, cetRemainingMs, cetResume, cetScopeKey, createCetActivity } from "@/lib/cetActivity";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { CetLibrary, type CetEntry } from "./CetLibrary";
import { cetViewModel } from "@/lib/cetViewModel";
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
  return <dialog ref={ref} aria-label={title} className={`cet-sheet ${left ? "cet-sheet-left" : ""}`} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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

export function CetReader({ entry, onOpen, onBack, ...base }: BaseProps & { entry: CetEntry; onOpen: (e: CetEntry) => void; onBack: () => void }) {
  const { account, isOffline } = useAccount();
  const [paper, setPaper] = useState<CetPaper | null>(null);
  const [activity, setActivity] = useState<CetActivity | null>(null);
  const [legacyPreview, setLegacyPreview] = useState<CetActivity | null>(null);
  const [view, setView] = useState<"start" | "reading">("start");
  const [history, setHistory] = useState<CetActivity[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sheet, setSheet] = useState<DialogName>("");
  const [minutes, setMinutes] = useState(String(entry.sectionId ? 10 : 40));
  const [timerMode, setTimerMode] = useState<"countdown" | "countup">("countdown");
  const [historyPurpose, setHistoryPurpose] = useState<"practice" | "self_test">("practice");
  const jumpQuestion = useRef<number | null>(null);
  const pausedScroll = useRef(0);
  const [activeToken, setActiveToken] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedFinalId, setSelectedFinalId] = useState("");
  const [directSectionId, setDirectSectionId] = useState("");
  const [exposures, setExposures] = useState(readCetExposures);
  const [choice, setChoice] = useState<{ question: CetQuestion; section: CetSection; anchor: HTMLElement } | null>(null);
  const [historyLimit, setHistoryLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [foreground,setForeground]=useState(true);
  const current = useRef<CetActivity | null>(null);
  const owner = useRef("");
  const pendingScroll = useRef<number | null>(null);
  const practiceSegment = useRef<{ id: string; sectionId: string; start: number } | null>(null);
  const pendingStart = useRef<CetActivity | null>(null);
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
    if (!a || (a.purpose !== "practice" && !a.legacy) || !segment || a.status === "submitted" || a.status === "ended") return;
    const parts = { ...a.timerParts, [segment.id]: Math.max(0, Date.now() - segment.start) };
    persistDraft({ ...a, timerParts: parts, elapsedMs: Object.values(parts).reduce((sum, ms) => sum + ms, 0), updatedAt: new Date().toISOString() });
    if (stop) practiceSegment.current = null;
  }, [persistDraft]);

  useEffect(() => {
    let live = true;
    current.current = null;
    practiceSegment.current = null;
    pendingFinal.current = null;pendingStart.current=null;
    setMinutes(String(entry.sectionId ? 10 : 40));setTimerMode("countdown");
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
        if (selected.purpose === "practice" && selected.status === "in_progress" && !cetFinalizedSection(selected, selected.activeSection) && !selected.practiceTimerPaused && !document.hidden) practiceSegment.current = { id: `${selected.activeSection}#${crypto.randomUUID()}`, sectionId: selected.activeSection, start: Date.now() };
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
      setForeground(!document.hidden);
      if (document.hidden) checkpointPractice(true);
      else if (current.current?.purpose === "practice" && current.current.status === "in_progress" && !current.current.practiceTimerPaused && !cetFinalizedSection(current.current, current.current.activeSection) && view === "reading") practiceSegment.current = { id: `${current.current.activeSection}#${crypto.randomUUID()}`, sectionId: current.current.activeSection, start: Date.now() };
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
    if (jumpQuestion.current !== null || sheet) return;
    if (pendingScroll.current !== null) { window.scrollTo(0, pendingScroll.current); pendingScroll.current = null; }
  }, [activity?.activeSection, activity?.status, directSectionId, sheet]);

  useEffect(() => {
    if (sheet || jumpQuestion.current === null) return;
    // The dialog's passive cleanup restores its old scroll position. Jump only
    // after that lock is released and the destination question is mounted.
    let frame = 0, attempts = 0;
    const align = () => {
      const node = document.getElementById(`cet-q-${jumpQuestion.current}`);
      if (node && document.body.style.position !== "fixed") {
        node.scrollIntoView({block:"center"});jumpQuestion.current=null;pendingScroll.current=null;
      } else if (++attempts < 12) frame=window.requestAnimationFrame(align);
    };
    align();
    return () => window.cancelAnimationFrame(frame);
  }, [activity?.activeSection, directSectionId, sheet]);

  useEffect(() => {
    if (!paper || view === "start" || activity?.status === "paused") return;
    const section = paper.sections.find((item) => item.id === (activity?.activeSection || directSectionId || entry.sectionId || paper.sections[0]?.id));
    if (!section) return;
    const base = activity?.id || directSessionId.current;
    const events: Array<"read" | "answer_view"> = ["read"];
    if (activity?.status === "submitted" || activity?.status === "ended" || (activity?.purpose === "practice" && Boolean(cetFinalizedSection(activity, section.id)))) events.push("answer_view");
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
      const next = pendingStart.current || createCetActivity({ paper, sectionId: entry.sectionId, purpose, owner: owner.current, minutes: Number(minutes), timerMode, knownPriorSectionIds: knownPrior, now });
      pendingStart.current=next;
      const saved = saveCetActivity(next);
      await flushLearningStorage();
      if (expectedOwner !== storageOwner()) return;
      current.current = saved;
      pendingStart.current=null;
      setActivity(saved); setView("reading"); setSheet(""); refreshHistory();
      if (purpose === "practice") practiceSegment.current = { id: `${saved.activeSection}#${crypto.randomUUID()}`, sectionId: saved.activeSection, start: Date.now() };
    } catch { setNotice("开始记录未能保存到本机，请重试。"); }
    finally { starting.current = false; setBusy(false); }
  }, [paper, entry.sectionId, minutes, timerMode, refreshHistory, storageOwner]);

  const commit = useCallback(async (reason: "passage_submit" | "manual_submit" | "time_expired" | "ended_for_study", sectionId?: string) => {
    const a = current.current;
    if (!paper || !a || submitting.current) return;
    if(cetViewModel(paper,a).mismatch){setNotice("题目范围与当前题库不一致，原记录已保留，暂不能提交。");return;}
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
      if (saved.purpose === "practice" && saved.status === "in_progress" && !saved.practiceTimerPaused && !cetFinalizedSection(saved, saved.activeSection) && !document.hidden) practiceSegment.current = { id: `${saved.activeSection}#${crypto.randomUUID()}`, sectionId: saved.activeSection, start: Date.now() };
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
  const model = cetViewModel(paper, activity, entry.sectionId, selectedFinalId);
  const scope = model.sections;
  const section = scope.find((s) => s.id === (activity?.activeSection || directSectionId)) || scope[0];
  if (!section) return <div className="cet-load" role="alert">阅读部分暂不可用。</div>;
  const shown = view !== "start";
  const testing = Boolean(activity?.purpose === "self_test" && activity.status === "in_progress");
  const paused = Boolean(activity?.purpose === "self_test" && activity.status === "paused");
  const locked = !shown || testing || paused;
  const applicableFinalizations = activity ? Object.values(activity.finalizations).filter((item) => activity.purpose === "self_test" ? !item.sectionId : item.sectionId === section.id || item.reason === "ended_for_study" && item.questions.some(q=>q.sectionId===section.id)) : [];
  const result = applicableFinalizations.find((item) => item.id === selectedFinalId) || applicableFinalizations[0];
  const sectionResult = activity?.purpose === "practice" ? result : undefined;
  const showAnswers = Boolean(result) || activity?.status === "ended";
  const displayAnswer = model.answer;
  const answered = model.answered;
  const activeSectionIndex = scope.indexOf(section);
  const sectionAnswered = section.questions.filter((q) => model.answer(section.id,cetQuestionKey(section.id,q.number))).length;
  const remaining = activity?.purpose === "practice" ? section.questions.length - sectionAnswered : model.total - answered;
  const submittedCount = activity?.purpose === "practice" ? scope.filter((s) => cetFinalizedSection(activity, s.id)).length : 0;
  const contentChanged = Boolean(result && result.contentVersion !== cetContentVersion(paper, scopeIds));
  const observedConditions = activity ? cetObservedConditions(activity, paper.sections, exposures) : [];
  const timerRead = () => {
    const a = current.current;
    if (!a) return 0;
    if (a.status === "submitted" || a.status === "ended") return result?.elapsedMs ?? a.elapsedMs;
    if (a.purpose === "self_test" && !a.legacy) return a.timerMode === "countup" ? cetElapsedMs(a) : cetRemainingMs(a);
    if (a.purpose === "practice" && sectionResult) return sectionResult.elapsedMs;
    const segment = practiceSegment.current;
    if (a.purpose === "practice" && !a.legacy) return cetPracticeSectionElapsedMs(a, section.id) + (segment?.sectionId === section.id ? Math.max(0, Date.now() - segment.start - (a.timerParts[segment.id] || 0)) : 0);
    return a.elapsedMs + (segment ? Math.max(0, Date.now() - segment.start - (a.timerParts[segment.id] || 0)) : 0);
  };
  const toggleTimer = async () => {
    const a = current.current; if (!a || busy || a.status === "submitted" || a.status === "ended") return;
    if (a.purpose === "practice") {
      checkpointPractice(true); const latest = current.current!;
      const next = {...latest, practiceTimerPaused: !a.practiceTimerPaused, timerRevision: `${new Date().toISOString()}:${crypto.randomUUID()}`, updatedAt: new Date().toISOString()};
      if (persistDraft(next) && !next.practiceTimerPaused && !cetFinalizedSection(next, section.id)) practiceSegment.current = {id:`${section.id}#${crypto.randomUUID()}`,sectionId:section.id,start:Date.now()};
      return;
    }
    if (a.status === "in_progress" && cetRemainingMs(a) <= 0) {await commit("time_expired");return;}
    setBusy(true);
    try { if(a.status === "in_progress") pausedScroll.current=window.scrollY;
      const next = a.status === "paused" ? cetResume(a) : cetPause(a); const saved=saveCetActivity(next); await flushLearningStorage();
      if(owner.current!==storageOwner())return;
      current.current=saved;setActivity(saved); if(saved.status==='in_progress') pendingScroll.current=pausedScroll.current;
    } catch {setNotice("计时状态未能保存，请重试。");} finally {setBusy(false);}
  };
  const timerStopped = activity?.status === "submitted" || activity?.status === "ended" || Boolean(sectionResult);
  const timerPaused = paused || Boolean(activity?.practiceTimerPaused) || !foreground && activity?.purpose === "practice";
  const timerLabel = timerStopped ? "用时" : activity?.legacy ? "旧版计时" : activity?.purpose === "practice" ? "学习用时" : activity?.timerMode === "countup" ? "正计时" : "倒计时";
  const timer = activity && <button type="button" className="cet-timer" data-state={timerPaused ? "paused" : activity.status} disabled={timerStopped || busy} aria-label={timerStopped ? "已固定用时" : `${timerPaused ? "继续" : "暂停"}${activity.purpose === "self_test" ? "自测" : "学习"}计时`} onClick={()=>void toggleTimer()}>
    <span>{timerLabel}</span><TimerClock read={timerRead} label={timerLabel} running={!timerStopped && !timerPaused && activity.status === "in_progress"} />
    <span aria-hidden="true">{timerStopped ? "✓" : timerPaused ? "▶" : "Ⅱ"}</span>{timerPaused && <small>已暂停</small>}
  </button>;

  const updateDraft = (question: CetQuestion, value: string) => {
    const a = current.current;
    if (!a || a.status !== "in_progress") return;
    if (a.legacy?.mode === "study" && a.legacy.raw.answers[cetQuestionKey(section.id, question.number)]) return;
    if (a.legacy?.raw.revealed[section.id]) return;
    if (model.mismatch) {setNotice("题目范围发生变化，原记录已保留，暂不能作答。");return;}
    if (a.purpose === "self_test" && cetRemainingMs(a) <= 0) { void commit("time_expired"); return; }
    const key = cetQuestionKey(section.id, question.number);
    if (section.type === "cloze" && value && section.questions.some((other) => other.number !== question.number && a.answers[cetQuestionKey(section.id, other.number)]?.value === value)) {
      setNotice("这个单词已用于另一空，请先清空原空格。"); return;
    }
    const persisted = persistDraft(cetAnswer(a, key, value));
    try { saveCetExposure(exposureFor(section, paper.id, owner.current, "answer", `answer:${a.id}:${section.id}`, a.id)); } catch { /* The draft remains visible and can be retried. */ }
    if(persisted) setNotice("");
  };
  const changeSection = (id: string, scroll = false) => {
    pendingScroll.current = scroll ? 0 : window.scrollY;
    setChoice(null); setActiveToken("");
    checkpointPractice(true);
    const a = current.current;
    if (a) {
      if(a.status === "submitted" || a.status === "ended") {const next={...a,activeSection:id};current.current=next;setActivity(next);}
      else persistDraft({ ...a, activeSection: id, updatedAt: new Date().toISOString() });
      if (a.purpose === "practice" && a.status === "in_progress" && !a.practiceTimerPaused && !cetFinalizedSection(a, id) && !document.hidden) practiceSegment.current = { id: `${id}#${crypto.randomUUID()}`, sectionId: id, start: Date.now() };
    } else setDirectSectionId(id);
  };
  const lookupText = (text: string, lookup: (context: WordContext) => void, contextText?: string, contextOffset = 0) => <CetText text={text} locked={locked} lookup={lookup} active={activeToken} onActive={setActiveToken} contextText={contextText} contextOffset={contextOffset} />;
  const answerFor = (question: CetQuestion) => displayAnswer(section.id, cetQuestionKey(section.id, question.number));
  const isRevealed = (question: CetQuestion) => !testing && (showAnswers || Boolean(activity?.legacy?.raw.revealed[section.id]) || Boolean(activity?.legacy?.mode === "study" && activity.legacy.raw.answers[cetQuestionKey(section.id, question.number)]));
  const explain = (question: CetQuestion) => {
    const key = cetQuestionKey(section.id, question.number);
    const snapshot = result?.questions.find((q) => q.key === key);
    const original = result?.answers[key] ?? answerFor(question);
    const referenceAnswer = snapshot ? snapshot.answer : question.answer;
    const correct = referenceAnswer && original === referenceAnswer;
    const open = !correct || expanded.includes(key);
    return <div className="cet-explanation" data-correct={Boolean(correct)}>
      <button type="button" onClick={() => setExpanded((prior) => prior.includes(key) ? prior.filter((item) => item !== key) : [...prior, key])}>
        {referenceAnswer ? `${!original ? "未作答" : correct ? "回答正确" : "回答错误"} · 原答案 ${original || "空"} · 参考答案 ${referenceAnswer}` : "此题暂无可靠参考答案"} {correct && (open ? "收起解析" : "展开解析")}
      </button>
      {open && <p>{(snapshot ? snapshot.explanation : question.explanation) || "来源暂未提供可靠解析，此题暂不计分。"}</p>}
    </div>;
  };
  const openChoice = (event: React.MouseEvent<HTMLButtonElement>, question: CetQuestion) => setChoice({ question, section, anchor: event.currentTarget });
  const startNew = (purpose: "practice" | "self_test") => { void leaveTo(() => { setSheet(""); setView("start"); setActivity(null); current.current = null; if (purpose === "self_test") setSheet("开始新自测"); }); };
  const currentScopeKey = activity?.scopeKey || cetScopeKey(paper.id, entry.sectionId);
  const scopedHistory = history.filter((record) => record.scopeKey === currentScopeKey);
  const visibleHistory = scopedHistory.filter(record=>record.purpose===historyPurpose);
  const openRecord = (record: CetActivity) => { checkpointPractice(true);setSelectedFinalId(""); current.current = record; setActivity(record); setView("reading"); if (record.purpose === "practice" && record.status === "in_progress" && !record.practiceTimerPaused && !cetFinalizedSection(record, record.activeSection) && !document.hidden) practiceSegment.current = { id: `${record.activeSection}#${crypto.randomUUID()}`, sectionId: record.activeSection, start: Date.now() }; };

  const startSurface = <div className="cet-start">
    {!sheet && notice && <p className="cet-notice" role="alert">{notice}</p>}
    <div className="cet-mobile-actions"><button type="button" onClick={()=>setSheet("选择真题")}>选择真题</button></div>
    <span className="cet-start-kicker">{entry.sectionId ? "单篇题组" : "阅读套卷"} · CET {paper.level}</span>
    <h1>{entry.sectionId ? `${paper.title} · ${section.title}` : paper.title}</h1>
    <p>{entry.sectionId ? names[section.type] : "选词填空 · 长篇匹配 · 仔细阅读"} · 共 {model.total} 题</p>
    {legacyPreview && <div className="cet-legacy-preview"><strong>旧版{legacyPreview.purpose === "self_test" ? "自测" : "练习"}记录</strong><p>{legacyPreview.status === "submitted" ? "可回看旧答案；当时的辅助和计时条件记录不完整。" : legacyPreview.purpose === "self_test" ? "可继续原答案，保留旧版手动计时口径；曾提前查看的答案不会被清除。" : "已即时反馈的题目会保持原答案，不会变成新的未揭晓练习。"}</p><button type="button" onClick={() => { try { const saved = saveCetActivity(legacyPreview); current.current = saved; setActivity(saved); setView("reading"); setLegacyPreview(null); } catch { setNotice("旧版记录迁移未能保存，请重试。"); } }}>{legacyPreview.status === "submitted" ? "回看旧答卷" : "继续旧版进度"}</button></div>}
    <div className="cet-start-goals">{(["practice", "self_test"] as const).map(purpose => {
      const records = scopedHistory.filter(r=>r.purpose===purpose);
      const ongoing = records.find(r=>r.status==='in_progress'||r.status==='paused');
      return <section key={purpose}><h2>{purpose==='practice' ? '阅读练习' : entry.sectionId ? '单篇自测' : '套卷自测'}</h2>
        <p>{purpose==='practice' ? '可以查词和翻译；每篇提交后查看答案与解析。' : '提交前不提供查词和翻译；提交后统一查看答案与解析。开始前可选择正计时或倒计时。'}</p>
        <div className="cet-start-actions"><button className="cet-primary" disabled={busy} onClick={()=>purpose==='practice' ? void start('practice') : (setTimerMode("countdown"),setNotice(""),setSheet('开始新自测'))}>{purpose==='practice' ? records.length ? '开始新练习' : '开始练习' : `开始${entry.sectionId ? '单篇' : '套卷'}自测`}</button>
        {ongoing && <button onClick={()=>openRecord(ongoing)}>继续上次{purpose==='practice'?'练习':'自测'}</button>}</div>
        <h3>最近{purpose==='practice'?'练习':'自测'}</h3>{records.slice(0,3).map(record=><button type="button" className="cet-start-record" key={record.id} onClick={()=>openRecord(record)}><span>{record.purpose==='self_test' ? `${record.timerMode==='countup'?'正计时':'倒计时'} · ` : ''}{cetHistoryLabel(record)}</span><small>{new Date(record.createdAt).toLocaleDateString('zh-CN')}</small></button>)}
        {!records.length && <p className="cet-muted">尚无记录</p>}{records.length>3 && <button onClick={()=>{setHistoryPurpose(purpose);setHistoryLimit(30);setSheet('练习历史');}}>更多{purpose==='practice'?'练习':'自测'}记录</button>}
      </section>;
    })}</div>
    <details className="cet-source-info"><summary>资料信息</summary><p>真题来源：{paper.source}</p></details>
  </div>;

  const renderReading = (lookup: (context: WordContext) => void) => {
    if (view === "start") return startSurface;
    if (paused && activity) return <div className="cet-paused">{notice && <p className="cet-notice" role="alert">{notice}</p>}<div className="cet-mobile-timer">{timer}</div><h1>自测已暂停</h1><p>题目暂时隐藏，本次中断已记录。点击计时胶囊继续原答卷。</p><button type="button" className="cet-primary" disabled={busy} onClick={() => void toggleTimer()}>继续自测</button><button type="button" onClick={() => void leaveTo(onBack)}>返回首页</button></div>;
    return <div className="cet-reading">
      <div className="cet-reading-meta"><span>{paper.title} · {activity?.purpose === "self_test" ? activity.sectionId ? "单篇自测" : "阅读套卷自测" : "阅读练习"}</span><span>{activity?.purpose === "practice" ? `已完成 ${submittedCount}/${scope.length} 篇` : activity?.purpose === "self_test" && activity.status === "in_progress" ? `已答 ${answered}/${model.total} 题` : activity?.status === "ended" ? "未完成结束" : activity?.status === "submitted" ? "已提交" : ""}</span></div>
      <div className="cet-mobile-actions"><button onClick={() => setSheet("选择真题")}>选择真题</button><button onClick={() => setSheet("练习历史")}>练习历史</button><button onClick={() => setSheet("答题卡")}>答题卡</button></div>
      <nav className="cet-sections" aria-label="阅读部分">{scope.map((item) => <button key={item.id} aria-current={item.id === section.id ? "page" : undefined} onClick={() => changeSection(item.id)}>{item.type === "detail" ? item.title : names[item.type]}{activity?.purpose === "practice" && cetFinalizedSection(activity, item.id) ? " · 已提交" : ""}</button>)}</nav>
      {model.mismatch && <p className="cet-notice" role="alert">此记录的题目范围与当前题库不一致。原记录已保留，请查看历史答卷；暂不能继续提交。</p>}{notice && <p className="cet-notice" role="alert">{notice}</p>}
      {isOffline && activity && <p className="cet-notice" role="status">已保存到本机，待网络恢复后同步。</p>}
      {activity?.legacy && <p className="cet-notice">旧版记录，条件记录不完整。{activity.conditions.includes("legacy_early_reveal") ? "曾提前查看答案；该事实保留。" : ""}</p>}
      {result?.reason === "time_expired" && <p className="cet-notice" role="status">时间已结束，已固定本次答卷。</p>}
      {result?.unreliable ? <p className="cet-notice">另有 {result.unreliable} 题缺少可靠参考答案，不计入结果分母。</p> : null}
      {applicableFinalizations.length > 1 && <div className="cet-conflicts"><p>这次活动在不同设备产生了 {applicableFinalizations.length} 份提交快照。原答案分别保留，暂不纳入默认自测统计。</p><div>{applicableFinalizations.map((item, index) => <button type="button" key={item.id} aria-pressed={result?.id === item.id} onClick={() => setSelectedFinalId(item.id)}>答卷 {index + 1} · {new Date(item.at).toLocaleString("zh-CN")}</button>)}</div></div>}
      {result && <div className="cet-result" role="status"><strong>{result.reason === "ended_for_study" ? "未完成结束" : activity?.purpose === "self_test" ? "自测结果" : "本篇结果"}</strong><span>{result.reason === "ended_for_study" ? `已答 ${result.questions.length - result.unanswered} 题 · 不计入完成成绩` : result.scoreable ? `答对 ${result.correct}/${result.scoreable} 题 · 未答 ${result.unanswered} 题` : "暂无可计分结果"}</span><span>{activity?.legacy ? "旧版计时" : activity?.purpose === "self_test" ? "自测用时" : "学习用时"} {formatTime(result.elapsedMs)}{result.everPaused ? " · 曾中断" : ""}</span>{contentChanged && <small>当前题库与作答时版本不同，此处按当时快照展示。</small>}{activity?.purpose === "self_test" && <small>{observedConditions.length ? "作答期间另有学习接触记录 · 条件记录不完整" : cetEligibility(activity, observedConditions) === "repeat_test" ? "重复材料自测" : cetEligibility(activity, observedConditions) === "conditions_incomplete" ? "条件记录不完整" : "首次在本站自测"}</small>}</div>}
      <div className="cet-mobile-timer">{timer}</div>
      <p className="cet-directions">{section.type === "cloze" ? "从词库中选择合适单词填入空格，每词限用一次。" : section.type === "matching" ? "为每个陈述选择对应段落；段落可以被重复选择。" : "阅读文章，并为每道题选择一个最佳答案。"}</p>
      <h1>{section.title}</h1>
      {section.bank && <div className="cet-word-bank">{section.bank.map((option) => <span key={option.key} data-used={section.questions.some(q=>answerFor(q)===option.key) || undefined}><b>{option.key}</b> {lookupText(option.text, lookup)}{section.questions.some(q=>answerFor(q)===option.key) && <small>已用</small>}</span>)}</div>}
      <div className="cet-passages">{section.paragraphs.map((text, index) => <p key={index}>{section.type === "cloze" ? text.split(/(\[\[\d+\]\])/g).map((part, partIndex, parts) => {
        const number = Number(part.match(/\[\[(\d+)\]\]/)?.[1]);
        const question = section.questions.find((item) => item.number === number);
        return question ? <span className="cet-gap" id={`cet-q-${number}`} key={partIndex}><button type="button" disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={(event) => openChoice(event, question)} aria-haspopup="listbox" aria-expanded={choice?.question.number === number} aria-label={`第 ${number} 空，${answerFor(question) || "未作答"}`}><b>{number}</b>{answerFor(question) ? <span>{question.options.find((option) => option.key === answerFor(question))?.text || answerFor(question)}</span> : null}</button></span> : <span key={partIndex}>{lookupText(part, lookup, text, parts.slice(0, partIndex).join("").length)}</span>;
      }) : lookupText(text, lookup)}</p>)}</div>
      {section.type !== "cloze" && <div className="cet-questions">{section.questions.map((question) => <section id={`cet-q-${question.number}`} key={question.number}><h2><b>{question.number}.</b> {lookupText(question.stem, lookup)}</h2>{section.type === "detail" ? <div role="radiogroup" aria-label={`第 ${question.number} 题选项`}>{question.options.map((option) => <div className="cet-option" data-chosen={answerFor(question) === option.key} key={option.key}><button type="button" role="radio" aria-label={`第 ${question.number} 题选择 ${option.key}`} aria-checked={answerFor(question) === option.key} disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={() => updateDraft(question, answerFor(question) === option.key ? "" : option.key)}>{option.key}</button><span>{lookupText(option.text, lookup)}</span></div>)}</div> : <button type="button" className="cet-match-choice" aria-haspopup="listbox" aria-expanded={choice?.question.number === question.number} disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={(event) => openChoice(event, question)}>{answerFor(question) ? `${answerFor(question)} 段` : "选择段落"} <span aria-hidden="true">⌄</span></button>}{isRevealed(question) && explain(question)}</section>)}</div>}
      {section.type === "cloze" && section.questions.some(isRevealed) && <section className="cet-cloze-explanations"><h2>选词填空解析</h2>{section.questions.filter(isRevealed).map((question) => <div key={question.number}><h3>第 {question.number} 空</h3>{explain(question)}</div>)}</section>}
      {activity?.purpose === "practice" && activity.status === "in_progress" && !sectionResult && <button type="button" className="cet-submit-passage" disabled={busy || model.mismatch} onClick={() => setSheet("提交本篇")}>提交本篇</button>}
      {activity?.purpose === "practice" && activity.status === "in_progress" && activeSectionIndex === scope.length - 1 && <button type="button" className="cet-direct-link" disabled={busy} onClick={() => setSheet("直接精读")}>结束练习并精读</button>}
      {activity?.purpose === "self_test" && activity.status === "in_progress" && activeSectionIndex === scope.length - 1 && <button type="button" className="cet-submit-passage" disabled={busy || model.mismatch} onClick={() => setSheet("提交自测")}>提交自测</button>}

      <nav className="cet-bottom-nav"><button disabled={activeSectionIndex === 0} onClick={() => changeSection(scope[activeSectionIndex - 1].id, true)}>← 上一篇</button><span>{activeSectionIndex + 1} / {scope.length}</span><button disabled={activeSectionIndex === scope.length - 1} onClick={() => changeSection(scope[activeSectionIndex + 1].id, true)}>下一篇 →</button></nav>
    </div>;
  };

  return <>
    <ReaderView backLabel={testing || paused ? "保存并离开" : "返回首页"} key={`${paper.id}:${section.id}:${view}`} {...base} article={shown && !paused ? section.paragraphs.join("\n\n").replace(/\[\[(\d+)\]\]/g, "（第 $1 空）") : ""} importedArticle={shown && !paused ? { title: `${paper.title} · ${section.title}`, siteName: "四六级真题", url: paper.source, text: section.paragraphs.join("\n\n"), blocks: section.paragraphs.map((text, index) => ({ id: `${section.id}-${index}`, type: "paragraph" as const, text })) } : null} onBack={() => void leaveTo(onBack)} desktopViewportInsetLeft={132} examSurface={{
      locked,
      testing: testing || paused,
      startScreen: view === "start",
      lockedMessage: !shown ? "选择学习目标后开始阅读。" : paused ? "自测已暂停。点击继续自测后恢复题目与计时。" : undefined,
      onAssistanceShown: () => {
        if (view === "start" || testing || paused || owner.current !== storageOwner()) return;
        try { saveCetExposure(exposureFor(section, paper.id, owner.current, "assist", `assist:${activity?.id || directSessionId.current}:${section.id}`, activity?.id)); } catch { /* Reading tools remain usable if exposure persistence is temporarily unavailable. */ }
      },
      toolbar: <>{shown && <PillNavAction className={toolbarStyles.action} label={`答题卡 ${answered}/${model.total}`} onClick={() => setSheet("答题卡")} />}{(testing || paused) && <PillNavAction className={toolbarStyles.action} label="提交自测" onClick={() => setSheet("提交自测")} />}</>,
      rail: <div className={`${toolbarStyles.railActions} cet-rail`}><button onClick={() => setSheet("选择真题")}><span>选择真题</span><small>按试卷或题型选择</small></button><button onClick={() => setSheet("练习历史")}><span>练习历史</span><small>继续或回看</small></button><button onClick={() => setSheet("重新练习")}><span>重新练习</span><small>保留本轮记录</small></button></div>,
      timer,

      render: renderReading,
    }} />
    {choice && <CetOptionList anchor={choice.anchor} options={[{key:"",text:"清空答案"}, ...choice.question.options.map(o=>({key:o.key,text:`${o.key} ${o.text}`}))]} value={activity?.answers[cetQuestionKey(choice.section.id, choice.question.number)]?.value || ""} label={`第 ${choice.question.number} 题选择${choice.section.type === "matching" ? "段落" : "单词"}`} onChoose={(key) => { updateDraft(choice.question, key); setChoice(null); }} onClose={() => setChoice(null)} />}
    {sheet && <Sheet title={sheet} left={sheet === "选择真题"} onClose={() => setSheet("")}>
      {sheet === "开始新自测" ? <div className="cet-test-settings"><p>本次：{entry.sectionId ? '单篇题组' : '阅读套卷'} · 共 {model.total} 题</p><div className="cet-timer-mode">{(['countup','countdown'] as const).map(mode=><button key={mode} aria-pressed={timerMode===mode} onClick={()=>setTimerMode(mode)}>{mode==='countup'?'正计时':'倒计时'}</button>)}</div><p>{timerMode==='countup'?'从 00:00 开始累计，用时由你掌握。':'设置时长，到时结束并保存本次答卷。'}</p>{timerMode==='countdown' && <label className="cet-budget">时长 <button aria-label="减少一分钟" onClick={()=>setMinutes(String(Math.max(1,(Number(minutes)||1)-1)))}>−</button><input aria-label="自测分钟数" inputMode="numeric" value={minutes} onChange={e=>setMinutes(e.target.value)} /><span>分钟</span><button aria-label="增加一分钟" onClick={()=>setMinutes(String(Math.min(180,(Number(minutes)||0)+1)))}>＋</button></label>}<p>提交前不提供查词和翻译；提交后查看答案与解析。点击阅读页上的计时胶囊可暂停或继续。</p>{notice && <p role="alert">{notice}</p>}<div className="cet-dialog-actions"><button onClick={()=>setSheet('')}>返回</button><button disabled={busy} onClick={()=>{if(timerMode==='countdown' && (!/^\d+$/.test(minutes)||Number(minutes)<1||Number(minutes)>180)){setNotice('请输入 1–180 的整数分钟。');return;}void start('self_test');}}>开始自测</button></div></div> : sheet === "选择真题" ? <CetLibrary compact onOpen={(selected) => void leaveTo(() => { setSheet(""); onOpen(selected); })} /> : sheet === "练习历史" ? <div className="cet-history"><CetSelect label="历史目标" value={historyPurpose} options={[{key:"practice",text:"阅读练习"},{key:"self_test",text:"自测"}]} onChange={v=>setHistoryPurpose(v as typeof historyPurpose)} />{visibleHistory.slice(0, historyLimit).map((record) => <button key={record.id} onClick={() => void leaveTo(() => { setSheet(""); onOpen({ paperId: record.paperId, sectionId: record.sectionId, attemptId: record.id }); })}><small>{record.sectionId ? "单篇" : "整卷"} · {record.purpose === "practice" ? "阅读练习" : record.timerMode === "countup" ? "正计时自测" : "倒计时自测"}</small><strong>{record.title}</strong><span>{record.status === "submitted" ? "查看结果" : record.status === "ended" ? "未完成结束" : record.status === "paused" ? "继续已暂停自测" : "继续"} · {Object.values(record.answers).filter((answer) => answer.value).length} 题</span></button>)}{visibleHistory.length > historyLimit && <button onClick={() => setHistoryLimit((n) => n + 30)}>加载更多记录</button>}{!visibleHistory.length && <p>开始练习后，进度会保存在这里。</p>}</div> : sheet === "答题卡" ? <div className="cet-answer-card"><p>已答 {model.answered}/{model.total} 题</p>{scope.map((item) => <section key={item.id}><h3>{item.type==='detail' ? item.title : names[item.type]}</h3>{item.questions.map((question) => {
        const key=cetQuestionKey(item.id,question.number), value=model.answer(item.id,key), state=model.state(item.id,key);
        const marks={correct:'✓',incorrect:'×',unanswered:'—',unverified:'待核对',answered:'',draft:''};
        const labels={correct:'正确',incorrect:'错误',unanswered:'未答',unverified:'待核对',answered:'已答',draft:'未作答'};
        return <button type="button" key={question.number} data-result={state} data-answered={Boolean(value)} aria-label={`第 ${question.number} 题，${labels[state]}${value ? `，选择 ${value}` : ''}`} onClick={()=>{jumpQuestion.current=question.number;changeSection(item.id);setSheet('');}}>{question.number}{value && ` · ${value}`}<span>{marks[state]}</span></button>;
      })}</section>)}</div> : <div className="cet-confirm">
        <p>{sheet === "提交本篇" ? remaining ? `本篇还有 ${remaining} 题未作答。提交后答案固定并显示解析。` : "提交后答案固定并显示解析。" : sheet === "提交自测" ? remaining ? `还有 ${remaining} 题未作答。提交后本次自测结束，答案与用时固定。` : "提交后本次自测结束，答案与用时固定。" : sheet === "结束自测并精读" ? "当前答案和用时会保留，本次自测将标记为“未完成结束”。进入精读后可以查词和查看解析；这份答卷不能继续作为原自测作答。之后可以重新开始一份空白自测。" : sheet === "直接精读" ? "所有已提交结果保持不变，未提交部分将保留为结束记录，不计为完成练习。进入精读后可以查看解析。" : sheet === "保存失败" ? "结果尚未可靠保存，答案不会揭晓。请重试本机保存。" : "旧记录会保留，开始新一轮不会覆盖原答案。"}</p>
        {sheet === "提交自测" && <button className="cet-end" onClick={()=>setSheet("结束自测并精读")}>结束并精读（不计完成成绩）</button>}<div className="cet-dialog-actions"><button onClick={() => setSheet("")}>{sheet === "结束自测并精读" ? "继续自测" : "返回继续"}</button><button disabled={busy} onClick={() => { if (sheet === "提交本篇") void commit("passage_submit", section.id); else if (sheet === "提交自测") void commit("manual_submit"); else if (sheet === "结束自测并精读") void commit("ended_for_study"); else if (sheet === "保存失败" && pendingFinal.current) void commit(pendingFinal.current.finalizations[Object.keys(pendingFinal.current.finalizations).at(-1)!]?.reason as "manual_submit"); else if (sheet === "直接精读") void commit("ended_for_study"); else if (sheet === "重新练习") startNew("practice");  }}>{sheet === "提交本篇" ? "提交并查看解析" : sheet === "提交自测" ? "提交自测" : sheet === "结束自测并精读" ? "结束并精读" : sheet === "直接精读" ? "结束并精读" : sheet === "保存失败" ? "重试保存" : "开始新一轮"}</button></div>
      </div>}
    </Sheet>}
  </>;
}
