"use client";
import { cetSubmitPolicy, type CetSubmitCommand } from "@/lib/cetSubmitPolicy";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
import { cetElapsedMs, cetSelectSection, cetHistoryLabel, cetAnswer, cetContentVersion, cetEligibility, cetFinalizedSection, cetFinalize, cetPause, cetPracticeSectionElapsedMs, cetQuestionKey, cetRemainingMs, cetResume, cetScopeKey, createCetActivity } from "@/lib/cetActivity";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import { CetLibrary, type CetEntry } from "./CetLibrary";
import { prepareCetPracticeSubmitAll, cetPracticeTotals } from "@/lib/cetPracticeSubmitAll";
import { cetViewModel } from "@/lib/cetViewModel";
import {adjustCetTimer,projectCetTimer,currentCetEpoch,type CetTimerTarget} from "@/lib/cetAdjustableTimer";
import { loadCetCatalogue } from "@/lib/cetCatalogueLoader";
import { historicalTrailEvents, listAccessibleUnits, projectTrail, projectViewedTrail, resolvePrevious, resolveNext, trailPosition, currentTrailRound, type CetTrailKey, type CetTypeUnit } from "@/lib/cetTypeTrail";
import {readCetTrail,saveCetTrail} from "@/lib/cetTypeTrailStorage";
import { CetQuestionSurface, CetQuestionActions, type QuestionSurface, type QuestionAction } from "./CetQuestionSurface";
import {readCetViewport,saveCetViewport} from "@/lib/cetLocalViewport";
import { CetText } from "./CetText";
import { CetListeningPlayer, type CetListeningController } from "./CetListeningPlayer";
import { listeningDefaultMinutes, listeningVisibleText, recordListeningPlayback } from "@/lib/cetListening";
import { CetPaperEditor } from "./CetPaperEditor";
import { canEditCetUnderlines, addCetUnderlines, cetUnderlineSource, liveCetUnderlines, updateCetUnderline, type CetUnderlineRange } from "@/lib/cetUnderlines";
import type { CetActivity, CetPaper, CetQuestion, CetSection, CetUnderline, CetUnderlineColor } from "@/types/cet";
import { cetTranslationBlocks } from "@/lib/cetTranslationBlocks";
import { readCetUnderlineSelection, cetUnderlineMenuPosition } from "@/lib/cetUnderlineSelection";
import { useCetUnderlineSelection } from "./useCetUnderlineSelection";
import type { WordContext } from "@/types/reader";
import toolbarStyles from "@/components/ReaderToolbar.module.css";
import "./cet.css";

const names = { listening: "听力", cloze: "选词填空", matching: "长篇匹配", detail: "仔细阅读" };
const formatTime = (ms: number) => `${Math.floor(Math.max(0, ms) / 60000).toString().padStart(2, "0")}:${Math.floor((Math.max(0, ms) / 1000) % 60).toString().padStart(2, "0")}`;
type BaseProps = Pick<ComponentProps<typeof ReaderView>, "savedArticles" | "onArticleSaved" | "onOpenSavedArticle" | "onRenameSavedArticle" | "onDeleteSavedArticle" | "onOpenImportedArticle">;
type DialogName = "选择真题" | "练习历史" | "答题卡" | "提交本篇" | "提交全部" | "提交自测" | "结束自测并精读" | "重新练习" | "开始新自测" | "保存失败" | "计时归零" | "设置倒计时" | "";
type UnderlineMenu = { kind: "selection"; ranges: CetUnderlineRange[]; left: number; top: number } | { kind: "mark"; id: string; left: number; top: number };
const underlineColors: { id: CetUnderlineColor; label: string }[] = [
  { id: "blue", label: "蓝色" }, { id: "teal", label: "绿色" }, { id: "amber", label: "橙色" }, { id: "rose", label: "粉色" },
];

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

function CetDurationInput({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <div className="cet-budget" role="group" aria-label="倒计时时长">
    <span>时长</span>
    <button type="button" aria-label="减少一分钟" onClick={()=>onChange(String(Math.max(1,(Number(value)||1)-1)))}>−</button>
    <input aria-label={label} inputMode="numeric" pattern="[0-9]*" value={value} onChange={e=>onChange(e.target.value)} />
    <span>分钟</span>
    <button type="button" aria-label="增加一分钟" onClick={()=>onChange(String(Math.min(180,(Number(value)||0)+1)))}>＋</button>
  </div>;
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
  const [paperEditorOpen, setPaperEditorOpen] = useState(false);
  const [editedParagraphs, setEditedParagraphs] = useState<Record<string, string[]>>({});
  const [canEditPaper, setCanEditPaper] = useState(false);
  const [minutes, setMinutes] = useState(String(entry.sectionId ? 10 : 40));
  const [timerMode, setTimerMode] = useState<"countdown" | "countup">("countdown");
  const [historyPurpose, setHistoryPurpose] = useState<"all" | "practice" | "self_test">("all");
  const [historyScope, setHistoryScope] = useState<"all_cet" | "current_material">("all_cet");
  const [historyLevel, setHistoryLevel] = useState("all");
  const [legacyHistory, setLegacyHistory] = useState<ReturnType<typeof readCetAttempts>>([]);
  const jumpQuestion = useRef<number | null>(null);
  const [activeToken, setActiveToken] = useState("");
  const captureUnderlineRef = useCetUnderlineSelection();
  const [underlineMenu, setUnderlineMenu] = useState<UnderlineMenu | null>(null);
  const [underlineColor, setUnderlineColor] = useState<CetUnderlineColor>("blue");
  const passageRoot = useRef<HTMLDivElement>(null);
  const jumpUnderline = useRef<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedFinalId, setSelectedFinalId] = useState("");
  const [directSectionId, setDirectSectionId] = useState("");
  const [exposures, setExposures] = useState(readCetExposures);
  const [choice, setChoice] = useState<{ question: CetQuestion; section: CetSection; activityId: string; surface: QuestionSurface; anchor: HTMLElement } | null>(null);
  const [historyLimit, setHistoryLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [listeningRunning, setListeningRunning] = useState(false);
  const listeningController = useRef<CetListeningController|null>(null);
  const [timerAnchor,setTimerAnchor]=useState<HTMLElement|null>(null);
  const timerTarget=useRef<CetTimerTarget|null>(null);
  const pendingTimer=useRef<CetActivity|null>(null);
  const [foreground,setForeground]=useState(true);
  const current = useRef<CetActivity | null>(null);
  const owner = useRef("");
  const pendingScroll = useRef<number | null>(null);
  const practiceSegment = useRef<{ id: string; sectionId: string; start: number } | null>(null);
  const pendingStart = useRef<CetActivity | null>(null);
  const pendingFinal = useRef<CetActivity | null>(null);
  const directSessionId = useRef(crypto.randomUUID());
  const recordedExposureIds = useRef(new Set<string>());
  const [trailEvents,setTrailEvents] = useState(readCetTrail);
  const [routePapers,setRoutePapers] = useState<CetPaper[]>([]);
  const [routeLoading,setRouteLoading] = useState(false);
  const [routeError,setRouteError] = useState("");
  const [routeRetry,setRouteRetry] = useState(0);
  const routePending = useRef<CetTypeUnit|null>(null);
  const routeNavigating = useRef(false);
  const forceNew = useRef(false);
  const routeScroll = useRef(new Map<string,number>());
  const starting = useRef(false);
  const submitting = useRef(false);
  const storageOwner = useCallback(() => getLearningStorage().getItem("context-reader:local-account-owner:v1") || "guest", []);

  const refreshHistory = useCallback(() => { setTrailEvents(readCetTrail()); setHistory(readCetActivities().filter(a => a.owner === storageOwner()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setLegacyHistory(readCetAttempts()); setExposures(readCetExposures()); }, [storageOwner]);
  useEffect(() => {
    if (!account.authenticated) { setCanEditPaper(false); return; }
    let live = true;
    void fetch("/api/admin/session", { cache: "no-store" }).then(response => response.json()).then(data => {
      if (live) setCanEditPaper(data.accessMode === "developer");
    }).catch(() => { if (live) setCanEditPaper(false); });
    return () => { live = false; };
  }, [account.authenticated, account.profile?.userId]);
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
    if(stop&&a)saveCetViewport(`article:${a.owner}:${a.id}:${a.activeSection}`,window.scrollY);
    if (!a || (a.purpose !== "practice" && !a.legacy) || !segment || a.status === "submitted" || a.status === "ended") return;
    const epoch=currentCetEpoch(a,segment.sectionId);
    const oldSegment=a.timerParts[segment.id]||0;
    const projected=projectCetTimer(a,segment.sectionId,Date.now(),Math.max(0,Date.now()-segment.start-oldSegment));
    const used=epoch?.mode==='countdown'?oldSegment+Math.max(0,projected.total-cetPracticeSectionElapsedMs(a,segment.sectionId)):Math.max(0, Date.now()-segment.start);
    const parts = { ...a.timerParts, [segment.id]: used };
    persistDraft({ ...a, timerParts: parts, elapsedMs: Object.values(parts).reduce((sum, ms) => sum + ms, 0), updatedAt: new Date().toISOString() });
    if (stop) practiceSegment.current = null;
  }, [persistDraft]);

  useEffect(() => {
    let live = true;
    current.current = null;
    practiceSegment.current = null;
    pendingFinal.current = null;pendingStart.current=null;
    setMinutes(String(entry.sectionId ? 10 : 40));setTimerMode("countdown");
    setTimerAnchor(null);timerTarget.current=null;pendingTimer.current=null;
    setSelectedFinalId(""); setDirectSectionId(""); setPaperEditorOpen(false); setEditedParagraphs({});
    setUnderlineMenu(null); jumpUnderline.current = null;
    recordedExposureIds.current.clear();
    setHistory([]);setLegacyHistory([]);setPaper(null); setActivity(null); setLegacyPreview(null); setView("start"); setError(""); setNotice(""); setChoice(null);
    void Promise.all([
      initializeLearningStorage(),
      (entry.preparedPaper && entry.preparedOwner === storageOwner() ? Promise.resolve({ok:true,json:async()=>({paper:entry.preparedPaper})}) : fetch(`/api/cet?id=${encodeURIComponent(entry.paperId)}`)).then(async (response) => {
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
      setMinutes(String(listeningDefaultMinutes(loaded,entry.sectionId)));
      setHistory(records.filter(a => a.owner === owner.current));setLegacyHistory(readCetAttempts());
      if (selected && selected.paperId === loaded.id && selected.owner === owner.current) {
        current.current = selected;
        setActivity(selected);
        setView("reading");
        pendingScroll.current = routeScroll.current.get(selected.id) ?? readCetViewport(`article:${selected.owner}:${selected.id}:${selected.activeSection}`);
        if (selected.purpose === "practice" && selected.status === "in_progress" && !cetFinalizedSection(selected, selected.activeSection) && !selected.practiceTimerPaused && !document.hidden) practiceSegment.current = { id: `${selected.activeSection}#${crypto.randomUUID()}`, sectionId: selected.activeSection, start: Date.now() };
      } else if (old && old.paperId === loaded.id) {
        setLegacyPreview(adaptLegacyCetAttempt(old, loaded, owner.current));
      }
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "试卷加载失败，请重试。"); });
    return () => { live = false; checkpointPractice(true); void flushLearningStorage().catch(() => {}); };
    // The previous activity is checkpointed before each entry change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.paperId, entry.sectionId, entry.attemptId, account.profile?.userId]);

  const routeLevel=paper?.level || entry.preparedPaper?.level;
  const routeEnabled=Boolean(entry.sectionId || activity?.sectionId);
  useEffect(() => {
    if (!routeLevel || !routeEnabled) return;
    const controller = new AbortController(), expectedOwner = storageOwner();
    setRouteLoading(true);setRouteError("");setRoutePapers([]);routePending.current=null;
    void loadCetCatalogue({signal:controller.signal,fetchPage:async(page)=>{
      for(let attempt=0;attempt<3;attempt++){
        try {
          const response=await fetch(`/api/cet?level=${routeLevel}&page=${page}`,{signal:controller.signal});
          const data=await response.json();if(!response.ok)throw Error('目录暂不可用');return data;
        } catch(error) {
          if(controller.signal.aborted||attempt===2)throw error;
          await new Promise<void>(resolve=>window.setTimeout(resolve,350*(attempt+1)));
        }
      }
      throw Error('目录暂不可用');
    },onBatch:batch=>{
      if(controller.signal.aborted||storageOwner()!==expectedOwner)return;
      setRoutePapers(batch.papers);
      const events=readCetTrail();
      for(const event of historicalTrailEvents(readCetActivities(),readCetExposures(),batch.papers,expectedOwner)){
        if(!events.some(e=>e.owner===event.owner&&e.paperId===event.paperId&&e.sectionId===event.sectionId&&e.purpose===event.purpose))saveCetTrail(event);
      }
      setTrailEvents(readCetTrail());
    }})
      .catch(()=>{if(!controller.signal.aborted)setRouteError('同题型目录未加载完整，请重试。');})
      .finally(()=>{if(!controller.signal.aborted)setRouteLoading(false);});
    return ()=>controller.abort();
  }, [routeLevel, routeEnabled, account.profile?.userId, account.authenticated, routeRetry, storageOwner]);

  const touchTrail = useCallback((a:CetActivity,loaded:CetPaper,reason:'view'|'answer'|'assistance_shown'|'finalized'|'restart')=>{
    if(!a.sectionId || a.owner!==storageOwner())return;
    const part=loaded.sections.find(s=>s.id===a.sectionId);if(!part)return;
    const key:CetTrailKey={owner:a.owner,level:loaded.level,type:part.type,purpose:a.purpose};
    const events=readCetTrail(),round=currentTrailRound(events,key);
    const already=events.some(e=>e.owner===key.owner&&e.level===key.level&&e.type===key.type&&e.purpose===key.purpose&&e.round===round&&e.paperId===loaded.id&&e.sectionId===part.id&&e.reason!=='round');
    if(already&&reason!=='restart' || !already&&reason==='restart')return;
    const recent=events.filter(e=>e.owner===key.owner&&e.level===key.level&&e.type===key.type&&e.purpose===key.purpose&&e.round===round).at(-1);
    const now=Date.now(),last=recent?Date.parse(recent.at):0;
    const at=new Date(last>=now&&last-now<2000?last+1:now).toISOString();
    saveCetTrail({...key,round,id:crypto.randomUUID(),at,paperId:loaded.id,sectionId:part.id,activityId:a.id,reason});
    setTrailEvents(readCetTrail());
  },[storageOwner]);

  useEffect(() => {
    const shown = current.current;
    if (!paper || !shown?.sectionId || view !== "reading") return;
    try { touchTrail(shown, paper, "view"); }
    catch { setNotice("已打开题目，但浏览记录尚未保存，请保留页面重试。"); }
  }, [paper, activity?.id, activity?.sectionId, activity?.status, view, touchTrail]);

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
      if (updated) {
        // Sync data without moving the passage the user is currently reading.
        const visible = updated.owner === a.owner && updated.sectionIds.includes(a.activeSection)
          ? { ...updated, activeSection: a.activeSection } : updated;
        current.current = visible; setActivity(visible);
      }
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
    if (!jumpUnderline.current) return;
    const id = jumpUnderline.current;
    let frame = 0, attempts = 0;
    const find = () => {
      const node = document.querySelector<HTMLElement>(`.cet-reading [data-cet-underline-id="${CSS.escape(id)}"]`);
      if (node) { node.scrollIntoView({block:"center"}); jumpUnderline.current = null; }
      else if (++attempts < 12) frame = requestAnimationFrame(find);
    };
    frame = requestAnimationFrame(find);
    return () => cancelAnimationFrame(frame);
  }, [activity?.activeSection, directSectionId]);

  useEffect(() => {
    if (!underlineMenu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof window.Element && !event.target.closest(".cet-underline-menu")) setUnderlineMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setUnderlineMenu(null); };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [underlineMenu]);

  useEffect(() => { setUnderlineMenu(null); }, [activity?.id, activity?.activeSection, activity?.status, sheet, view]);

  useEffect(() => {
    if (sheet || jumpQuestion.current === null) return;
    // The dialog's passive cleanup restores its old scroll position. Jump only
    // after that lock is released and the destination question is mounted.
    let frame = 0, attempts = 0;
    const align = () => {
      const node = document.getElementById(`cet-inline-q-${jumpQuestion.current}`);
      if (node && document.body.style.position !== "fixed") {
        node.scrollIntoView({block:"center"});jumpQuestion.current=null;pendingScroll.current=null;
      } else if (++attempts < 12) frame=window.requestAnimationFrame(align);
    };
    align();
    return () => window.cancelAnimationFrame(frame);
  }, [activity?.activeSection, directSectionId, sheet]);

  useEffect(() => {
    if (!paper || view === "start") return;
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
      const part = paper.sections.find(s=>s.id===entry.sectionId);
      const trail = part ? projectTrail(readCetTrail(),{owner:expectedOwner,level:paper.level,type:part.type,purpose},[{paperId:paper.id,sectionId:part.id}]).trail : [];
      const bound = !forceNew.current && trail[0] ? readCetActivities().find(a=>a.id===trail[0].activityId&&a.owner===expectedOwner) : undefined;
      const next = pendingStart.current || bound || createCetActivity({ paper, sectionId: entry.sectionId, purpose, owner: owner.current, minutes: Number(minutes), timerMode, knownPriorSectionIds: knownPrior, now });
      pendingStart.current=next;
      const saved = saveCetActivity(next);
      await flushLearningStorage();
      if (expectedOwner !== storageOwner()) return;
      current.current = saved;
      pendingStart.current=null;
      if(forceNew.current)touchTrail(saved,paper,"restart");forceNew.current=false;
      setActivity(saved); setView("reading"); setSheet(""); refreshHistory();
      if (purpose === "practice" && saved.status === "in_progress" && !saved.practiceTimerPaused && !cetFinalizedSection(saved,saved.activeSection)) practiceSegment.current = { id: `${saved.activeSection}#${crypto.randomUUID()}`, sectionId: saved.activeSection, start: Date.now() };
    } catch { setNotice("开始记录未能保存到本机，请重试。"); }
    finally { starting.current = false; setBusy(false); }
  }, [paper, entry.sectionId, minutes, timerMode, refreshHistory, storageOwner, touchTrail]);

  const commit = useCallback(async (reason: "submit_all" | "passage_submit" | "manual_submit" | "time_expired" | "ended_for_study", sectionId?: string) => {
    listeningController.current?.checkpoint();
    const a = current.current;
    if (!paper || !a || submitting.current) return;
    if(cetViewModel(paper,a).mismatch){setNotice("题目范围与当前题库不一致，原记录已保留，暂不能提交。");return;}
    const expectedOwner = owner.current;
    if (expectedOwner !== storageOwner() || a.owner !== expectedOwner) return;
    if (a.purpose === "practice" || a.legacy) checkpointPractice(true);
    submitting.current = true; setBusy(true); setNotice("");
    try {
      const latest = current.current || a;
      const next = pendingFinal.current || (reason === "submit_all" ? prepareCetPracticeSubmitAll(latest, paper, crypto.randomUUID()) : cetFinalize(latest, paper, reason, sectionId));
      pendingFinal.current = next;
      const saved = saveCetActivity(next);
      await flushLearningStorage();
      if (expectedOwner !== storageOwner()) return;
      pendingFinal.current = null;
      current.current = saved;
      touchTrail(saved,paper,"finalized");await flushLearningStorage();
      setActivity(saved); setSheet(""); refreshHistory();
      if (reason === "ended_for_study") setView("reading");
      if (saved.purpose === "practice" && saved.status === "in_progress" && !saved.practiceTimerPaused && !cetFinalizedSection(saved, saved.activeSection) && !document.hidden) practiceSegment.current = { id: `${saved.activeSection}#${crypto.randomUUID()}`, sectionId: saved.activeSection, start: Date.now() };
    } catch { setNotice("结果尚未可靠保存，本篇答案不会揭晓。请点击重试。"); setSheet("保存失败"); }
    finally { submitting.current = false; setBusy(false); }
  }, [paper, checkpointPractice, refreshHistory, storageOwner, touchTrail]);

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
    if (paperEditorOpen) { setNotice("请先完成原文编辑，再离开阅读。"); return; }
    listeningController.current?.checkpoint();
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
  }, [checkpointPractice, storageOwner, commit, paperEditorOpen]);

  const applyTimerAdjustment = async (kind:'reset'|'countdown') => {
    const a=current.current,target=timerTarget.current;
    if(!a||!target||submitting.current||busy||owner.current!==storageOwner()||a.id!==target.activityId||a.activeSection!==target.sectionId||a.status==="submitted"||a.status==="ended"||a.purpose==="practice"&&cetFinalizedSection(a,a.activeSection))return;
    if(a.purpose==='self_test'&&a.status==='in_progress'&&cetRemainingMs(a)<=0){await commit('time_expired');return;}
    setBusy(true);
    try {
      checkpointPractice(true);
      const latest=current.current!;
      const next=pendingTimer.current||adjustCetTimer(latest,target,kind,kind==='countdown'?Number(minutes):undefined,new Date().toISOString(),crypto.randomUUID());
      pendingTimer.current=next;
      const saved=saveCetActivity(next);await flushLearningStorage();
      if(target.owner!==storageOwner()||current.current?.id!==target.activityId)return;
      current.current=saved;setActivity(saved);pendingTimer.current=null;setSheet('');setNotice('计时已调整，答案和累计用时已保留。');
      if(saved.purpose==='practice'&&!saved.practiceTimerPaused&&!document.hidden)practiceSegment.current={id:`${saved.activeSection}#${crypto.randomUUID()}`,sectionId:saved.activeSection,start:Date.now()};
    }catch{
      if(target.owner===storageOwner()&&current.current?.id===target.activityId){
        setNotice('计时调整尚未可靠保存，请重试；原记录保留。');
        const retained=current.current;
        if(retained.purpose==='practice'&&retained.status==='in_progress'&&!retained.practiceTimerPaused&&!document.hidden&&!cetFinalizedSection(retained,retained.activeSection))practiceSegment.current={id:`${retained.activeSection}#${crypto.randomUUID()}`,sectionId:retained.activeSection,start:Date.now()};
      }
    }
    finally{setBusy(false);}
  };
  useEffect(()=>{
    if(!activity||activity.purpose!=='practice'||activity.practiceTimerPaused||activity.status!=='in_progress')return;
    const tick=()=>{
      const a=current.current,segment=practiceSegment.current;if(!a||!segment)return;
      const p=projectCetTimer(a,a.activeSection,Date.now(),Math.max(0,Date.now()-segment.start-(a.timerParts[segment.id]||0)));
      if(p.mode!=='countdown'||p.remaining>0)return;
      checkpointPractice(true);const latest=current.current!;
      persistDraft({...latest,practiceTimerPaused:true,timerRevision:`${new Date().toISOString()}:expired`,updatedAt:new Date().toISOString()});
      setNotice('时间到，可继续练习。');
    };
    const interval=window.setInterval(tick,250);return()=>window.clearInterval(interval);
  },[activity,checkpointPractice,persistDraft]);

  const navigateTypeUnit = async (target:CetTypeUnit, retryNext = false) => {
    if(listeningRunning&&current.current?.purpose==="self_test"){setNotice("请听完当前音频后再切换题目。");return;}
    if (paperEditorOpen) { setNotice("请先完成原文编辑，再切换题目。"); return; }
    const a=current.current,loaded=paper,expectedOwner=owner.current;
    if(!a?.sectionId||!loaded||routeNavigating.current||submitting.current||expectedOwner!==storageOwner())return;
    routeNavigating.current=true;routePending.current=retryNext?target:null;setBusy(true);setNotice("");
    try {
      if(a.purpose==='self_test'&&a.status==='in_progress'&&cetRemainingMs(a)<=0){await commit('time_expired');if(pendingFinal.current)throw Error('save');}
      checkpointPractice(true);
      const source=current.current!;
      routeScroll.current.set(source.id,window.scrollY);
      const stopped=source.purpose==='self_test'&&source.status==='in_progress'?cetPause(source):source;
      const saved=saveCetActivity(stopped);await flushLearningStorage();
      if(expectedOwner!==storageOwner())return;
      current.current=saved;setActivity(saved);
      const response=await fetch(`/api/cet?id=${encodeURIComponent(target.paperId)}`);
      const data=await response.json();if(!response.ok)throw Error('load');
      const nextPaper=data.paper as CetPaper,part=nextPaper.sections.find(s=>s.id===target.sectionId),sourcePart=loaded.sections.find(s=>s.id===a.sectionId);
      if(!part||!sourcePart||nextPaper.level!==loaded.level||part.type!==sourcePart.type||expectedOwner!==storageOwner())throw Error('scope');
      const key:CetTrailKey={owner:expectedOwner,level:loaded.level,type:part.type,purpose:a.purpose};
      const linked=projectTrail(readCetTrail(),key,[target]).trail[0];
      const prior=linked&&readCetActivities().find(item=>item.id===linked.activityId&&item.owner===expectedOwner&&item.paperId===target.paperId&&item.sectionId===target.sectionId&&item.purpose===a.purpose);
      const next=prior||createCetActivity({paper:nextPaper,sectionId:target.sectionId,owner:expectedOwner,purpose:a.purpose,timerMode:a.timerMode,minutes:(a.budgetMs||600000)/60000,
        knownPriorSectionIds:priorCetSections([part],readCetExposures(),new Date().toISOString(),expectedOwner)});
      const savedNext=saveCetActivity(next);await flushLearningStorage();
      if(expectedOwner!==storageOwner())return;
      setChoice(null);setSheet('');setActiveToken('');routePending.current=null;
      onOpen({paperId:target.paperId,sectionId:target.sectionId,attemptId:savedNext.id,preparedPaper:nextPaper,preparedOwner:expectedOwner});
    } catch {
      if(expectedOwner===storageOwner()&&current.current?.id===a.id){
        const retained=current.current;
        if(retained.purpose==='practice'&&retained.status==='in_progress'&&!retained.practiceTimerPaused&&!document.hidden&&!cetFinalizedSection(retained,retained.activeSection))practiceSegment.current={id:`${retained.activeSection}#${crypto.randomUUID()}`,sectionId:retained.activeSection,start:Date.now()};
        setNotice('切换未完成，当前答案已保留。再次点击将重试同一篇。');
      }
    }
    finally{routeNavigating.current=false;setBusy(false);}
  };

  if (error) return <div className="cet-load"><p role="alert">{error}</p><button onClick={onBack}>返回首页</button></div>;
  if (!paper) return <div className="cet-load" role="status">正在打开试卷…</div>;

  const scopeIds = activity?.sectionIds || (entry.sectionId ? [entry.sectionId] : paper.sections.map((s) => s.id));
  const model = cetViewModel(paper, activity, entry.sectionId, selectedFinalId);
  const scope = model.sections;
  let section = scope.find((s) => s.id === (activity?.activeSection || directSectionId)) || scope[0];
  if (!section) return <div className="cet-load" role="alert">阅读部分暂不可用。</div>;
  const shown = view !== "start";
  const testing = Boolean(activity?.purpose === "self_test" && activity.status === "in_progress");
  const paused = Boolean(activity?.purpose === "self_test" && activity.status === "paused");
  const locked = testing || paused || paperEditorOpen;
  const marking = canEditCetUnderlines(activity) && !paperEditorOpen;
  const applicableFinalizations = activity ? Object.values(activity.finalizations).filter((item) => activity.purpose === "self_test" ? !item.sectionId : item.sectionId === section.id || item.reason === "ended_for_study" && item.questions.some(q=>q.sectionId===section.id)) : [];
  const result = applicableFinalizations.find((item) => item.id === selectedFinalId) || applicableFinalizations[0];
  if (result?.listeningSections?.[section.id]) section = { ...section, audio: result.listeningSections[section.id].audio, listeningGroups: result.listeningSections[section.id].groups };
  const sectionResult = activity?.purpose === "practice" ? result : undefined;
  const showAnswers = Boolean(result) || activity?.status === "ended";
  const displayAnswer = model.answer;
  const answered = model.answered;
  const activeSectionIndex = scope.findIndex(item => item.id === section.id);
  const routeKey:CetTrailKey={owner:owner.current,level:paper.level,type:section.type,purpose:activity?.purpose||'practice'};
  const routeUnits=listAccessibleUnits(routePapers,paper.level,section.type);
  const routeProjection=projectViewedTrail(trailEvents,routeKey,routeUnits);
  const unit={paperId:paper.id,sectionId:section.id};
  const previousUnit=resolvePrevious(routeProjection.trail,unit);
  const hasNextUnit=Boolean(resolveNext(routeProjection.trail,routeUnits,unit,routePending.current,()=>0));
  const routePosition=trailPosition(routeProjection.trail,routeUnits,unit);
  const allUnderlines = (activity?.purpose === "self_test"
    ? activity.status === "submitted" || activity.status === "ended" ? liveCetUnderlines(result?.underlines) : liveCetUnderlines(activity.underlines)
    : []).filter(mark => mark.target && mark.target !== "passage" || !editedParagraphs[mark.sectionId]
      || JSON.stringify(editedParagraphs[mark.sectionId]) === JSON.stringify(result?.underlinedParagraphs?.[mark.sectionId]));
  const sectionUnderlines = allUnderlines.filter(mark => mark.sectionId === section.id);
  const passageParagraphs = section.type === "listening" ? listeningVisibleText(section,number=>Boolean(result?.questions.some(q=>q.number===number))) : editedParagraphs[section.id] || result?.underlinedParagraphs?.[section.id] || section.paragraphs;
  const underlineExcerpt = (mark: CetUnderline) => {
    if (mark.target && mark.target !== "passage") {
      const question = result?.questions.find(item => item.sectionId === mark.sectionId && item.number === mark.questionNumber);
      const source = mark.target === "bank" ? paper.sections.find(item => item.id === mark.sectionId)?.bank?.find(item => item.key === mark.optionKey)?.text
        : mark.target === "stem" ? question?.stem || cetUnderlineSource(paper, mark)
        : question?.options.find(item => item.key === mark.optionKey)?.text || cetUnderlineSource(paper, mark);
      return source?.slice(mark.start,mark.end).trim() || "题目位置";
    }
    const source = result?.underlinedParagraphs?.[mark.sectionId]
      || paper.sections.find(item => item.id === mark.sectionId)?.paragraphs;
    return source?.[mark.paragraphIndex]?.slice(mark.start, mark.end).trim() || "原文位置";
  };
  const captureUnderlineSelection = (root: HTMLElement | null = passageRoot.current) => {
    const selection = window.getSelection();
    if (!marking || !root || !selection || selection.isCollapsed || !selection.rangeCount || busy || sheet) return;
    const range = selection.getRangeAt(0);
    const ranges = readCetUnderlineSelection(root, range, paper, section.id);
    if (!ranges.length) return;
    const rects = Array.from(range.getClientRects?.() || []);
    const position = cetUnderlineMenuPosition(rects, window.innerWidth, window.innerHeight,
      selection.focusNode === range.startContainer && selection.focusOffset === range.startOffset);
    if (position) setUnderlineMenu({kind:"selection",ranges,...position});
  };
  captureUnderlineRef.current = captureUnderlineSelection;
  const openExistingUnderline = (event: React.MouseEvent<HTMLElement>) => {
    if (!marking || !window.getSelection()?.isCollapsed) return;
    const target = event.target instanceof window.Element ? event.target.closest<HTMLElement>("[data-cet-underline-id]") : null;
    const id = target?.dataset.cetUnderlineId;
    if (!id || !sectionUnderlines.some(mark => mark.id === id)) return;
    const position = cetUnderlineMenuPosition(Array.from(target.getClientRects()), window.innerWidth, window.innerHeight);
    if (position) setUnderlineMenu({kind:"mark",id,...position});
  };
  const applyUnderline = (color: CetUnderlineColor | "remove") => {
    const a = current.current, menu = underlineMenu;
    if (!a || !menu || !marking || model.mismatch || !canEditCetUnderlines(a) || a.owner !== storageOwner() || busy) return;
    if (a.status === "in_progress" && cetRemainingMs(a) <= 0) { void commit("time_expired"); return; }
    const next = menu.kind === "mark" ? updateCetUnderline(a,menu.id,color)
      : color === "remove" ? a : addCetUnderlines(a,paper,menu.ranges,color);
    if (next === a) return;
    if (persistDraft(next)) {
      if (color !== "remove") setUnderlineColor(color);
      setUnderlineMenu(null);window.getSelection()?.removeAllRanges();
    }
  };
  const jumpToUnderline = (mark: CetUnderline) => {
    jumpUnderline.current = mark.id;
    if (section.id !== mark.sectionId) changeSection(mark.sectionId, true);
    else window.requestAnimationFrame(() => {
      const node = document.querySelector<HTMLElement>(`[data-cet-underline-id="${CSS.escape(mark.id)}"]`);
      node?.scrollIntoView({block:"center",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
      jumpUnderline.current = null;
    });
  };
  const sectionAnswered = section.questions.filter((q) => model.answer(section.id,cetQuestionKey(section.id,q.number))).length;
  const remaining = activity?.purpose === "practice" ? section.questions.length - sectionAnswered : model.total - answered;
  const submittedCount = activity?.purpose === "practice" ? scope.filter((s) => cetFinalizedSection(activity, s.id)).length : 0;
  const contentChanged = Boolean(result && result.contentVersion !== cetContentVersion(paper, scopeIds));
  const observedConditions = activity ? cetObservedConditions(activity, paper.sections, exposures) : [];
  const timerRead = () => {
    const a = current.current;
    if (!a) return 0;
    if (a.status === "submitted" || a.status === "ended") return result?.elapsedMs ?? a.elapsedMs;
    if (a.purpose === "practice" && sectionResult) return sectionResult.elapsedMs;
    if (a.schemaVersion===4) { const seg=practiceSegment.current; return projectCetTimer(a,section.id,Date.now(),seg?.sectionId===section.id?Math.max(0,Date.now()-seg.start-(a.timerParts[seg.id]||0)):0).display; }
    if (a.purpose === "self_test" && !a.legacy) return a.timerMode === "countup" ? cetElapsedMs(a) : cetRemainingMs(a);
    const segment = practiceSegment.current;
    if (a.purpose === "practice" && !a.legacy) return cetPracticeSectionElapsedMs(a, section.id) + (segment?.sectionId === section.id ? Math.max(0, Date.now() - segment.start - (a.timerParts[segment.id] || 0)) : 0);
    return a.elapsedMs + (segment ? Math.max(0, Date.now() - segment.start - (a.timerParts[segment.id] || 0)) : 0);
  };
  const toggleTimer = async () => {
    const a = current.current; if (!a || busy || a.status === "submitted" || a.status === "ended") return;
    if(listeningRunning&&testing){setNotice("自测音频播放中，无法暂停计时。可保存并离开，记录会标记中断。");return;}
    if (a.purpose === "practice") {
      checkpointPractice(true); const latest = current.current!;
      const next = {...latest, practiceTimerPaused: !a.practiceTimerPaused, timerRevision: `${new Date().toISOString()}:${crypto.randomUUID()}`, updatedAt: new Date().toISOString()};
      if (persistDraft(next) && !next.practiceTimerPaused && !cetFinalizedSection(next, section.id)) practiceSegment.current = {id:`${section.id}#${crypto.randomUUID()}`,sectionId:section.id,start:Date.now()};
      return;
    }
    if (a.status === "in_progress" && cetRemainingMs(a) <= 0) {await commit("time_expired");return;}
    setBusy(true);
    try {
      const next = a.status === "paused" ? cetResume(a) : cetPause(a); const saved=saveCetActivity(next); await flushLearningStorage();
      if(owner.current!==storageOwner())return;
      current.current=saved;setActivity(saved);
    } catch {setNotice("计时状态未能保存，请重试。");} finally {setBusy(false);}
  };
  const timerStopped = activity?.status === "submitted" || activity?.status === "ended" || Boolean(sectionResult);
  const timerPaused = paused || Boolean(activity?.practiceTimerPaused) || !foreground && activity?.purpose === "practice";
  const timerLabel = timerStopped ? "用时" : activity?.legacy ? "旧版计时" : activity?.purpose === "practice" ? (activity&&currentCetEpoch(activity,section.id)?.mode==='countdown'?"倒计时":"学习用时") : activity?.timerMode === "countup" ? "正计时" : "倒计时";
  const openTimerMenu=(anchor:HTMLElement)=>{
    if(listeningRunning&&testing){setNotice("自测音频播放中，计时设置暂不可调整。");return;}
    const a=current.current;if(!a||a.legacy||timerStopped||busy)return;
    timerTarget.current={owner:a.owner,activityId:a.id,sectionId:section.id,revision:a.timerRevision};pendingTimer.current=null;
    setTimerAnchor(anchor);
  };
  const timer = activity && <div className="cet-timer-wrapper" title={timerLabel}><button type="button" className="cet-timer" title={timerLabel} data-settings={!timerStopped&&!activity.legacy||undefined} data-state={timerPaused ? "paused" : activity.status} disabled={timerStopped || busy} aria-label={timerStopped ? "已固定用时" : `${timerPaused ? "继续" : "暂停"}${activity.purpose === "self_test" ? "自测" : "学习"}计时`} onContextMenu={e=>{e.preventDefault();openTimerMenu(e.currentTarget);}} onKeyDown={e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();openTimerMenu(e.currentTarget);}}} onClick={()=>void toggleTimer()}>
    <TimerClock read={timerRead} label={timerLabel} running={!timerStopped && !timerPaused && activity.status === "in_progress"} />
    <span aria-hidden="true">{timerStopped ? "✓" : timerPaused ? "▶" : "Ⅱ"}</span>
  </button>{!timerStopped&&!activity.legacy&&<button type="button" className="cet-timer-more" aria-label="更多计时设置" disabled={busy} onClick={e=>openTimerMenu(e.currentTarget)}><span aria-hidden="true">⋯</span></button>}</div>;

  const updateDraft = (question: CetQuestion, value: string, expected = {activityId:activity?.id,sectionId:section.id}) => {
    const a = current.current;
    if (!a || a.status !== "in_progress" || a.id!==expected.activityId || a.activeSection!==expected.sectionId || owner.current!==storageOwner() || !a.questionKeys.includes(cetQuestionKey(expected.sectionId,question.number))) return;
    if (a.legacy?.mode === "study" && a.legacy.raw.answers[cetQuestionKey(section.id, question.number)]) return;
    if (a.legacy?.raw.revealed[section.id]) return;
    if (model.mismatch) {setNotice("题目范围发生变化，原记录已保留，暂不能作答。");return;}
    if (a.purpose === "self_test" && cetRemainingMs(a) <= 0) { void commit("time_expired"); return; }
    const key = cetQuestionKey(section.id, question.number);
    if (section.type === "cloze" && value && section.questions.some((other) => other.number !== question.number && a.answers[cetQuestionKey(section.id, other.number)]?.value === value)) {
      setNotice("这个单词已用于另一空，请先清空原空格。"); return;
    }
    if((a.answers[key]?.value||"")===value)return;
    const answeredActivity=cetAnswer(a,key,value);if(answeredActivity===a)return;
    const persisted = persistDraft(answeredActivity);
    if(persisted)try{touchTrail(current.current!,paper,"answer");}catch{setNotice("路线记录尚未保存，请保留页面重试。");}
    try { saveCetExposure(exposureFor(section, paper.id, owner.current, "answer", `answer:${a.id}:${section.id}`, a.id)); } catch { /* The draft remains visible and can be retried. */ }
    if(persisted) setNotice("");
  };
  const changeSection = (id: string, scroll = false) => {
    if (paperEditorOpen) { setNotice("请先完成原文编辑，再切换阅读部分。"); return; }
    if(listeningRunning&&testing){setNotice("请听完当前音频后再切换题目。");return;}
    pendingScroll.current = scroll ? 0 : window.scrollY;
    setChoice(null); setActiveToken("");
    checkpointPractice(true);
    const a = current.current;
    if (a) {
      if(a.status === "submitted" || a.status === "ended") {const next={...a,activeSection:id};current.current=next;setActivity(next);}
      else persistDraft(cetSelectSection(a, id));
      if (a.purpose === "practice" && a.status === "in_progress" && !a.practiceTimerPaused && !cetFinalizedSection(a, id) && !document.hidden) practiceSegment.current = { id: `${id}#${crypto.randomUUID()}`, sectionId: id, start: Date.now() };
    } else setDirectSectionId(id);
  };
  const lookupText = (text: string, lookup: (context: WordContext) => void, contextText?: string, contextOffset = 0, underlines?: CetUnderline[]) => <CetText text={text} locked={locked} lookup={lookup} active={activeToken} onActive={setActiveToken} contextText={contextText} contextOffset={contextOffset} underlines={underlines} />;
  const answerFor = (question: CetQuestion) => displayAnswer(section.id, cetQuestionKey(section.id, question.number));
  const isRevealed = (question: CetQuestion) => !testing && (showAnswers || Boolean(activity?.legacy?.raw.revealed[section.id]) || Boolean(activity?.legacy?.mode === "study" && activity.legacy.raw.answers[cetQuestionKey(section.id, question.number)]));
  const explain = (question: CetQuestion, surface: QuestionSurface = "inline") => {
    const key = cetQuestionKey(section.id, question.number);
    const snapshot = result?.questions.find((q) => q.key === key);
    const original = result?.answers[key] ?? answerFor(question);
    const referenceAnswer = snapshot ? snapshot.answer : question.answer;
    const correct = referenceAnswer && original === referenceAnswer;
    const expansionKey = `${surface}:${key}`;
    const open = !correct || expanded.includes(expansionKey);
    return <div className="cet-explanation" data-correct={Boolean(correct)}>
      <button type="button" onClick={() => setExpanded((prior) => prior.includes(expansionKey) ? prior.filter((item) => item !== expansionKey) : [...prior, expansionKey])}>
        {referenceAnswer ? `${!original ? "未作答" : correct ? "回答正确" : "回答错误"} · 原答案 ${original || "空"} · 参考答案 ${referenceAnswer}` : "此题暂无可靠参考答案"} {correct && (open ? "收起解析" : "展开解析")}
      </button>
      {open && <p>{(snapshot ? snapshot.explanation : question.explanation) || "来源暂未提供可靠解析，此题暂不计分。"}</p>}
    </div>;
  };
  const openChoice = (event: React.MouseEvent<HTMLButtonElement>, question: CetQuestion, surface:QuestionSurface="inline") => {if(activity)setChoice({ question, section, activityId:activity.id,surface, anchor: event.currentTarget });};
  const startNew = (purpose: "practice" | "self_test") => { forceNew.current=true; void leaveTo(() => { setSheet(""); setView("start"); setActivity(null); current.current = null; if (purpose === "self_test") setSheet("开始新自测"); }); };
  const currentScopeKey = activity?.scopeKey || cetScopeKey(paper.id, entry.sectionId);
  const scopedHistory = history.filter((record) => record.scopeKey === currentScopeKey);
  const historyRows = [...history.map(record => ({...record, answerCount: Object.values(record.answers).filter(a => a.value).length})), ...legacyHistory.filter(old => !history.some(record => record.sourceAttemptId === old.id)).map(old => ({ id: old.id, paperId: old.paperId, sectionId: old.sectionId, scopeKey: cetScopeKey(old.paperId, old.sectionId), title: old.title, purpose: old.mode === "exam" ? "self_test" as const : "practice" as const, timerMode: undefined, status: old.finishedAt ? "submitted" : "in_progress", updatedAt: old.updatedAt, answerCount: Object.values(old.answers).filter(Boolean).length }))];
  const visibleHistory = historyRows.filter(record => (historyScope === "all_cet" || record.scopeKey === currentScopeKey) && (historyPurpose === "all" || record.purpose === historyPurpose) && (historyLevel === "all" || record.paperId.startsWith(`cet${historyLevel}-`))).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const openGlobalHistory = () => {setHistoryScope("all_cet");setHistoryPurpose("all");setHistoryLevel("all");setHistoryLimit(30);refreshHistory();setSheet("练习历史");};
  const practiceTotals = activity?.purpose === "practice" ? cetPracticeTotals(activity) : null;
  const pendingPracticeQuestions = activity?.purpose === "practice" ? scope.filter(item => !cetFinalizedSection(activity,item.id)).flatMap(item => item.questions.map(q => cetQuestionKey(item.id,q.number))) : [];
  const practiceUnanswered = pendingPracticeQuestions.filter(key => !activity?.answers[key]?.value).length;
  const submitAll = () => {if(practiceUnanswered)setSheet("提交全部");else void commit("submit_all");};
  const openRecord = (record: CetActivity) => { checkpointPractice(true);setSelectedFinalId(""); current.current = record; setActivity(record); setView("reading"); if (record.purpose === "practice" && record.status === "in_progress" && !record.practiceTimerPaused && !cetFinalizedSection(record, record.activeSection) && !document.hidden) practiceSegment.current = { id: `${record.activeSection}#${crypto.randomUUID()}`, sectionId: record.activeSection, start: Date.now() }; };

  const startSurface = <div className="cet-start">
    {!sheet && notice && <p className="cet-notice" role="alert">{notice}</p>}
    <div className="cet-mobile-actions"><button type="button" onClick={()=>setSheet("选择真题")}>选择真题</button></div>
    <span className="cet-start-kicker">{entry.sectionId ? "单篇题组" : scope.some(s=>s.type==="listening") ? "听力与阅读套卷" : "阅读套卷"} · CET {paper.level}</span>
    <h1>{entry.sectionId ? `${paper.title} · ${section.title}` : paper.title}</h1>
    <p>{entry.sectionId ? names[section.type] : scope.some(s=>s.type==="listening") ? "听力 · 选词填空 · 长篇匹配 · 仔细阅读" : "选词填空 · 长篇匹配 · 仔细阅读"} · 共 {model.total} 题</p>
    {legacyPreview && <div className="cet-legacy-preview"><strong>旧版{legacyPreview.purpose === "self_test" ? "自测" : "练习"}记录</strong><p>{legacyPreview.status === "submitted" ? "可回看旧答案与用时。" : legacyPreview.purpose === "self_test" ? "可继续原答案，保留旧版手动计时口径；曾提前查看的答案不会被清除。" : "已即时反馈的题目会保持原答案，不会变成新的未揭晓练习。"}</p><button type="button" onClick={() => { try { const saved = saveCetActivity(legacyPreview); current.current = saved; setActivity(saved); setView("reading"); setLegacyPreview(null); } catch { setNotice("旧版记录迁移未能保存，请重试。"); } }}>{legacyPreview.status === "submitted" ? "回看旧答卷" : "继续旧版进度"}</button></div>}
    <div className="cet-start-goals">{(["practice", "self_test"] as const).map(purpose => {
      const records = scopedHistory.filter(r=>r.purpose===purpose);
      const ongoing = records.find(r=>r.status==='in_progress'||r.status==='paused');
      return <section key={purpose}><h2>{purpose==='practice' ? !entry.sectionId&&scope.some(s=>s.type==='listening')?'听力与阅读练习':section.type==='listening'?'听力练习':'阅读练习' : entry.sectionId ? '单篇自测' : '套卷自测'}</h2>
        <p>{purpose==='practice' ? '可以查词和翻译；每篇提交后查看答案与解析。' : '提交前不提供查词和翻译；提交后统一查看答案与解析。开始前可选择正计时或倒计时。'}</p>
        <div className="cet-start-actions"><button className="cet-primary" disabled={busy} onClick={()=>{forceNew.current=records.length>0;if(purpose==='practice')void start('practice');else{setTimerMode("countdown");setNotice("");setSheet('开始新自测');}}}>{purpose==='practice' ? records.length ? '开始新练习' : '开始练习' : `开始${entry.sectionId ? '单篇' : '套卷'}自测`}</button>
        {ongoing && <button onClick={()=>openRecord(ongoing)}>继续上次{purpose==='practice'?'练习':'自测'}</button>}</div>
        <h3>最近{purpose==='practice'?'练习':'自测'}</h3>{records.slice(0,3).map(record=><button type="button" className="cet-start-record" key={record.id} onClick={()=>openRecord(record)}><span>{record.purpose==='self_test' ? `${record.timerMode==='countup'?'正计时':'倒计时'} · ` : ''}{cetHistoryLabel(record)}</span><small>{new Date(record.createdAt).toLocaleDateString('zh-CN')}</small></button>)}
        {!records.length && <p className="cet-muted">尚无记录</p>}{records.length>3 && <button onClick={()=>{setHistoryScope("current_material");setHistoryLevel("all");setHistoryPurpose(purpose);setHistoryLimit(30);setSheet('练习历史');}}>更多{purpose==='practice'?'练习':'自测'}记录</button>}
      </section>;
    })}</div>
    <details className="cet-source-info"><summary>资料信息</summary><p>真题来源：{paper.source}</p>{paper.sections.find(s=>s.type==='listening')?.audio?.attribution?.map(source=><p key={source.url}>听力资料：<a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>{source.license && <> · {source.licenseUrl ? <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer">{source.license}</a> : source.license}</>}</p>)}</details>
  </div>;

  const submitPolicy = cetSubmitPolicy({ purpose: activity?.purpose || "practice", status: activity?.status || "in_progress", sectionId: activity ? activity.sectionId : entry.sectionId, sectionIds: scopeIds, activeSectionId: section.id, finalized: Boolean(sectionResult), mismatch: model.mismatch });
  const invokeSubmit = (command: CetSubmitCommand) => {
    if (paperEditorOpen) { setNotice("请先完成原文编辑，再提交答卷。"); return; }
    if (command === "submit_all") submitAll();
    else setSheet(command === "passage_submit" ? "提交本篇" : "提交自测");
  };
  const questionActions: QuestionAction[] = activity ? submitPolicy.questions.map(command => ({
    id: command === "passage_submit" ? "submit-section" : command === "submit_all" ? "submit-all" : "submit-test",
    label: command === "passage_submit" ? "提交本篇" : command === "submit_all" ? "提交全部" : "提交自测",
    disabled: busy || model.mismatch,
    invoke: () => invokeSubmit(command),
    className: "cet-submit-passage",
  })) : [];
  const renderNavigation = () => (activity?.sectionId ? <nav className="cet-bottom-nav" aria-label="同题型路线">
        {previousUnit && <button disabled={busy} onClick={()=>void navigateTypeUnit(previousUnit)}>← 上一题</button>}
        <span aria-label="当前题组位置" title={`该题型${activity.purpose==='self_test'?'自测':'练习'}浏览顺序中的当前位置`}>{routeLoading?'正在读取同题型目录…':routeError?`已载入 ${routeUnits.length} 篇`:`${routePosition} / ${routeUnits.length} 篇`}</span>
        {hasNextUnit && <button disabled={busy} onClick={()=>{const target=resolveNext(routeProjection.trail,routeUnits,unit,routePending.current,Math.random);if(target)void navigateTypeUnit(target,true);}}>下一题 →</button>}
        {routeError && <button onClick={()=>setRouteRetry(n=>n+1)}>重试目录</button>}
      </nav> : <nav className="cet-bottom-nav"><button disabled={activeSectionIndex === 0} onClick={() => changeSection(scope[activeSectionIndex - 1].id, true)}>← 上一篇</button><span>{activeSectionIndex + 1} / {scope.length}</span><button disabled={activeSectionIndex === scope.length - 1} onClick={() => changeSection(scope[activeSectionIndex + 1].id, true)}>下一篇 →</button></nav>);
  const renderQuestions = (surface:QuestionSurface,lookup:(context:WordContext)=>void) => {
    const markedQuestionText = (text:string,target?:Pick<CetUnderlineRange,"target"|"questionNumber"|"optionKey">) => {
      if (!target?.target) return lookupText(text,lookup);
      const marks=sectionUnderlines.filter(mark=>mark.target===target.target&&mark.questionNumber===target.questionNumber&&mark.optionKey===target.optionKey);
      return <span data-cet-mark-target={target.target} data-cet-question-number={target.questionNumber} data-cet-option-key={target.optionKey}><span data-cet-part-start={0}>{lookupText(text,lookup,undefined,0,marks)}</span></span>;
    };
    const displaySection=result?.questions.length && activity?.purpose==='self_test'
      ? {...section,questions:section.questions.map(question=>result.questions.find(snapshot=>snapshot.sectionId===section.id&&snapshot.number===question.number)||question)} : section;
    return <div className="cet-markable-questions" data-native-selection="blue" onMouseUpCapture={event=>{const root=event.currentTarget;requestAnimationFrame(()=>captureUnderlineSelection(root));}} onKeyUpCapture={event=>{const root=event.currentTarget;requestAnimationFrame(()=>captureUnderlineSelection(root));}} onTouchEndCapture={event=>{const root=event.currentTarget;window.setTimeout(()=>captureUnderlineSelection(root),80);}} onClickCapture={openExistingUnderline}><CetQuestionSurface surface={surface} section={displaySection} disabled={paperEditorOpen||!activity||activity.status!=='in_progress'} answerFor={answerFor} revealed={isRevealed} renderText={markedQuestionText} explain={explain} onAnswer={(q,value)=>updateDraft(q,value)} onOpenChoice={openChoice} openNumber={choice?.surface===surface?choice.question.number:undefined}/></div>;
  };
  const renderActions = (surface:QuestionSurface) => <CetQuestionActions surface={surface} actions={questionActions}>{renderNavigation()}</CetQuestionActions>;

  const renderReading = (lookup: (context: WordContext) => void) => {
    if (view === "start") return startSurface;
    return <div className="cet-reading">
      {practiceTotals && activity?.status === "submitted" && <div className="cet-practice-total" role="status">{practiceTotals.conflict ? "存在不同提交结果，请分别查看，暂不合成总分。" : `答对 ${practiceTotals.correct}/${practiceTotals.scoreable} · 未答 ${practiceTotals.unanswered} · 已完成 ${practiceTotals.completed}/${scope.length} ${scope.some(s=>s.type==="listening")?"组":"篇"} · 学习用时 ${formatTime(practiceTotals.elapsedMs)}${practiceTotals.unreliable ? ` · ${practiceTotals.unreliable} 题答案待核对，不计分` : ""}`}</div>}
      <div className="cet-reading-meta"><span>{paper.title} · {activity?.purpose === "self_test" ? activity.sectionId ? section.type === "listening" ? "听力自测" : "单篇自测" : scope.some(s=>s.type === "listening") ? "听力与阅读套卷自测" : "阅读套卷自测" : section.type === "listening" ? "听力练习" : "阅读练习"}</span><span>{activity?.purpose === "practice" ? `已完成 ${submittedCount}/${scope.length} ${scope.some(s=>s.type==="listening")?"组":"篇"}` : locked ? `${paused ? "已暂停 · " : ""}已答 ${answered}/${model.total} 题` : activity?.status === "ended" ? "未完成结束" : activity?.status === "submitted" ? "已提交" : ""}</span></div>
      <div className="cet-mobile-actions"><button onClick={() => setSheet("选择真题")}>选择真题</button><button onClick={openGlobalHistory}>练习历史</button><button onClick={() => setSheet("答题卡")}>答题卡</button></div>
      <nav className="cet-sections" aria-label="试卷部分">{scope.map((item) => <button key={item.id} aria-current={item.id === section.id ? "page" : undefined} onClick={() => changeSection(item.id)}>{item.type === "detail" ? item.title : names[item.type]}{activity?.purpose === "practice" && cetFinalizedSection(activity, item.id) ? " · 已提交" : ""}</button>)}</nav>
      {model.mismatch && <p className="cet-notice" role="alert">此记录的题目范围与当前题库不一致。原记录已保留，请查看历史答卷；暂不能继续提交。</p>}{notice && <p className="cet-notice" role="alert">{notice}</p>}
      {isOffline && activity && <p className="cet-notice" role="status">已保存到本机，待网络恢复后同步。</p>}
      {activity?.legacy && activity.conditions.includes("legacy_early_reveal") && <p className="cet-notice">旧版记录曾提前查看答案；该事实保留。</p>}
      {result?.reason === "time_expired" && <p className="cet-notice" role="status">时间已结束，已固定本次答卷。</p>}
      {result?.unreliable ? <p className="cet-notice">另有 {result.unreliable} 题缺少可靠参考答案，不计入结果分母。</p> : null}
      {applicableFinalizations.length > 1 && <div className="cet-conflicts"><p>这次活动在不同设备产生了 {applicableFinalizations.length} 份提交快照。原答案分别保留，暂不纳入默认自测统计。</p><div>{applicableFinalizations.map((item, index) => <button type="button" key={item.id} aria-pressed={result?.id === item.id} onClick={() => setSelectedFinalId(item.id)}>答卷 {index + 1} · {new Date(item.at).toLocaleString("zh-CN")}</button>)}</div></div>}
      {result && <div className="cet-result" role="status"><strong>{result.reason === "ended_for_study" ? "未完成结束" : activity?.purpose === "self_test" ? "自测结果" : "本篇结果"}</strong><span>{result.reason === "ended_for_study" ? `已答 ${result.questions.length - result.unanswered} 题 · 不计入完成成绩` : result.scoreable ? `答对 ${result.correct}/${result.scoreable} 题 · 未答 ${result.unanswered} 题` : "暂无可计分结果"}</span><span>{activity?.legacy ? "旧版计时" : activity?.purpose === "self_test" ? "自测用时" : "学习用时"} {formatTime(result.elapsedMs)}{result.everPaused ? " · 曾中断" : ""}</span>{result.conditions.includes("listening_not_completed")&&<small>听力未播放完毕</small>}{result.conditions.includes("listening_interrupted")&&<small>听力播放曾中断</small>}{contentChanged && <small>当前题库与作答时版本不同，此处按当时快照展示。</small>}{activity?.purpose === "self_test" && cetEligibility(activity, observedConditions) === "repeat_test" && <small>重复材料自测</small>}</div>}

      {result && activity?.purpose === "self_test" && allUnderlines.length > 0 && <details className="cet-underline-index" open><summary>自测划记 · {allUnderlines.length} 处</summary><p>点击划记跳转到原文或题目，再点单词查词。划记已随本次答卷固定。</p><div>{allUnderlines.map(mark => <button type="button" key={mark.id} onClick={() => jumpToUnderline(mark)}><i data-color={mark.color} aria-hidden="true" /><span>{paper.sections.find(item => item.id === mark.sectionId)?.title || "阅读原文"}{mark.questionNumber ? ` · 第 ${mark.questionNumber} 题` : ""} · {underlineExcerpt(mark)}</span></button>)}</div></details>}
      <p className="cet-directions">{section.type === "listening" ? "听录音，为每道题选择一个最佳答案。" : section.type === "cloze" ? "从词库中选择合适单词填入空格，每词限用一次。" : section.type === "matching" ? "为每个陈述选择对应段落；段落可以被重复选择。" : "阅读文章，并为每道题选择一个最佳答案。"}</p>
      {marking && <p className="cet-underline-hint">选中原文或题目可添加彩色下划线；提交后划记固定在这次自测中。</p>}
      <h1>{section.title}</h1>
      {section.type === "listening" && section.audio && <CetListeningPlayer controller={listeningController} key={`${activity?.id}:${section.id}:${Boolean(result)}`} audio={section.audio} testing={Boolean(activity?.purpose==="self_test"&&!result)} blocked={paused||!activity} stopped={!activity||["submitted","ended"].includes(activity.status)||Boolean(sectionResult)} initial={activity?.listeningPlayback?.[section.id]} onRunningChange={setListeningRunning} onCheckpoint={(position,state)=>{const a=current.current;if(a&&a.status==="in_progress"&&a.sectionIds.includes(section.id)&&!cetFinalizedSection(a,section.id))persistDraft(recordListeningPlayback(a,section.id,position,state));}} />}
      {shown && section.type!=="listening" && canEditPaper && !paperEditorOpen && <button type="button" className="cet-edit-paper" disabled={testing || paused} onClick={() => { setNotice(""); setPaperEditorOpen(true); }}>编辑真题排版</button>}
      {result && editedParagraphs[section.id] && <p className="cet-directions">当前显示已保存排版；历史答卷保留提交时的内容。</p>}
      {section.bank && <div className="cet-word-bank cet-markable-questions" data-native-selection="blue" onMouseUpCapture={event=>{const root=event.currentTarget;requestAnimationFrame(()=>captureUnderlineSelection(root));}} onKeyUpCapture={event=>{const root=event.currentTarget;requestAnimationFrame(()=>captureUnderlineSelection(root));}} onTouchEndCapture={event=>{const root=event.currentTarget;window.setTimeout(()=>captureUnderlineSelection(root),80);}} onClickCapture={openExistingUnderline}>{section.bank.map((option) => <span key={option.key} data-used={section.questions.some(q=>answerFor(q)===option.key) || undefined}><b>{option.key}</b> <span data-cet-mark-target="bank" data-cet-option-key={option.key}><span data-cet-part-start={0}>{lookupText(option.text, lookup, undefined, 0, sectionUnderlines.filter(mark=>mark.target==="bank"&&mark.optionKey===option.key))}</span></span>{section.questions.some(q=>answerFor(q)===option.key) && <small>已用</small>}</span>)}</div>}
      {paperEditorOpen && canEditPaper ? <CetPaperEditor key={`${paper.id}:${section.id}`} paperId={paper.id} section={paper.sections.find(item => item.id === section.id)!} onClose={() => setPaperEditorOpen(false)} onSaved={paragraphs => {
        setPaper(current => current && { ...current, sections: current.sections.map(item => item.id === section.id ? { ...item, paragraphs } : item) });
        setEditedParagraphs(previous => ({ ...previous, [section.id]: paragraphs }));
      }} /> : section.type === "listening" ? null : <div ref={passageRoot} className="cet-passages" data-native-selection="blue" onMouseUpCapture={() => requestAnimationFrame(() => captureUnderlineSelection())} onKeyUpCapture={() => requestAnimationFrame(() => captureUnderlineSelection())} onTouchEndCapture={() => window.setTimeout(() => captureUnderlineSelection(), 80)} onClickCapture={openExistingUnderline}>{passageParagraphs.map((text, index) => <p key={index} data-cet-paragraph={index}>{section.type === "cloze" ? text.split(/(\[\[\d+\]\])/g).map((part, partIndex, parts) => {
        const number = Number(part.match(/\[\[(\d+)\]\]/)?.[1]);
        const question = section.questions.find((item) => item.number === number);
        const offset = parts.slice(0, partIndex).join("").length;
        return question ? <span className="cet-gap" id={`cet-inline-q-${number}`} key={partIndex}><button type="button" disabled={isRevealed(question) || !activity || activity.status !== "in_progress"} onClick={(event) => openChoice(event, question)} aria-haspopup="listbox" aria-expanded={choice?.surface === "inline" && choice?.question.number === number} aria-label={`第 ${number} 空，${answerFor(question) || "未作答"}`}><b>{number}</b>{answerFor(question) ? <span>{question.options.find((option) => option.key === answerFor(question))?.text || answerFor(question)}</span> : null}</button></span> : <span key={partIndex} data-cet-part-start={offset}>{lookupText(part, lookup, text, offset, sectionUnderlines.filter(mark => (!mark.target || mark.target === "passage") && mark.paragraphIndex === index && mark.start < offset + part.length && mark.end > offset).map(mark => ({...mark,start:Math.max(0,mark.start-offset),end:Math.min(part.length,mark.end-offset)})))}</span>;
      }) : <span data-cet-part-start={0}>{lookupText(text, lookup, undefined, 0, sectionUnderlines.filter(mark => (!mark.target || mark.target === "passage") && mark.paragraphIndex === index))}</span>}</p>)}</div>}
      {activity?.conditions.includes("legacy_draft_conflict") && <p role="status">旧设备有不同草稿，已保留在本机备份中，当前答卷和已提交结果未被替换。</p>}
      {renderQuestions("inline",lookup)}
      {section.type === "listening" && section.audio?.attribution?.length ? <details className="cet-source-info"><summary>听力资料来源</summary>{section.audio.attribution.map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>{source.license && <> · {source.licenseUrl ? <a href={source.licenseUrl} target="_blank" rel="noopener noreferrer">{source.license}</a> : source.license}</>}</p>)}</details> : null}
      {!paperEditorOpen && renderActions("inline")}
    </div>;
  };

  return <>
    <ReaderView backLabel={testing || paused ? "保存并离开" : "返回首页"} key={`${paper.id}:${section.id}:${view}`} {...base} article={shown ? passageParagraphs.join("\n\n").replace(/\[\[(\d+)\]\]/g, "（第 $1 空）") : ""} importedArticle={shown ? { title: `${paper.title} · ${section.title}`, siteName: "四六级真题", url: paper.source, text: passageParagraphs.join("\n\n"), blocks: passageParagraphs.map((text, index) => ({ id: `${section.id}-${index}`, type: "paragraph" as const, text })) } : null} onBack={() => void leaveTo(onBack)} desktopViewportInsetLeft={132} examSurface={{
      locked,
      translationBlocks: shown ? cetTranslationBlocks(section, passageParagraphs, result) : [],
      testing: testing || paused,
      startScreen: view === "start",
      lockedMessage: paperEditorOpen ? "正在编辑原文排版，请完成编辑后使用阅读工具。" : !shown ? "选择学习目标后开始阅读。" : undefined,
      onAssistanceShown: () => {
        if (view === "start" || testing || paused || owner.current !== storageOwner()) return;
        if(current.current)try{touchTrail(current.current,paper,"assistance_shown");}catch{setNotice("路线记录尚未保存，请保留页面重试。");}
        try { saveCetExposure(exposureFor(section, paper.id, owner.current, "assist", `assist:${activity?.id || directSessionId.current}:${section.id}`, activity?.id)); } catch { /* Reading tools remain usable if exposure persistence is temporarily unavailable. */ }
      },
      toolbar: <>{shown && <PillNavAction className={toolbarStyles.action} label={`答题卡 ${answered}/${model.total}`} onClick={() => setSheet("答题卡")} />}{(testing || paused) && <PillNavAction className={toolbarStyles.action} label="提交自测" onClick={() => setSheet("提交自测")} />}{shown && activity?.purpose === "practice" && !activity.legacy && <PillNavAction className={toolbarStyles.action} label={submitPolicy.toolbar.label} disabled={busy || submitPolicy.toolbar.disabled} onClick={() => invokeSubmit(submitPolicy.toolbar.command)} />}</>,
      rail: <div className={`${toolbarStyles.railActions} cet-rail`}><button disabled={paperEditorOpen} onClick={() => setSheet("选择真题")}><span>选择真题</span><small>按试卷或题型选择</small></button><button disabled={paperEditorOpen} onClick={openGlobalHistory}><span>练习历史</span><small>继续或回看</small></button>{shown && <button disabled={paperEditorOpen} onClick={() => setSheet("重新练习")}><span>重新练习</span><small>保留本轮记录</small></button>}{canEditPaper && section.type!=="listening" && <button disabled={paperEditorOpen || testing || paused} onClick={() => { setNotice(""); setView("reading"); setPaperEditorOpen(true); }}><span>编辑真题排版</span><small>开发者专用</small></button>}</div>,
      timer,

      questions: shown && !paperEditorOpen && section.type!=="cloze" && section.type!=="listening" ? {key:`${owner.current}:${activity?.id||directSessionId.current}:${section.id}`, available:true, title:section.title, answered:sectionAnswered,total:section.questions.length,
        onDismiss:()=>setChoice(prior=>prior?.surface==='dock'?null:prior),
        render:lookup=><div className="cet-dock-reading">{renderQuestions('dock',lookup)}{renderActions('dock')}</div>} : undefined,
      render: renderReading,
    }} />
    {typeof document !== "undefined" && marking && underlineMenu && createPortal(<div className="cet-underline-menu" role="toolbar" aria-label={underlineMenu.kind === "selection" ? "为选中原文添加下划线" : "编辑自测划记"} style={{left:underlineMenu.left,top:underlineMenu.top}} onPointerDown={event => event.preventDefault()}>
      {underlineMenu.kind === "selection" && <button type="button" className="cet-underline-apply" onClick={() => applyUnderline(underlineColor)}><u>U</u> 下划线</button>}
      <div className="cet-underline-colors" aria-label="下划线颜色">{underlineColors.map(color => <button type="button" key={color.id} data-color={color.id} aria-label={`${color.label}下划线`} title={`${color.label}下划线`} onClick={() => applyUnderline(color.id)} />)}</div>
      {underlineMenu.kind === "mark" && <button type="button" className="cet-underline-remove" onClick={() => applyUnderline("remove")}>删除</button>}
    </div>, document.body)}
    {timerAnchor && <CetOptionList anchor={timerAnchor} label="计时设置" value="" options={[{key:'reset',text:'归零'},{key:'countdown',text:activity&&projectCetTimer(activity,section.id).mode==='countdown'?'调整倒计时':'改为倒计时'}]} onClose={()=>setTimerAnchor(null)} onChoose={key=>{setTimerAnchor(null);setNotice('');setMinutes(String((activity&&projectCetTimer(activity,section.id).budget||600000)/60000));setSheet(key==='reset'?'计时归零':'设置倒计时');}} />}
    {choice && activity?.status==="in_progress" && choice.activityId===activity.id && choice.section.id===activity.activeSection && <CetOptionList anchor={choice.anchor} options={[{key:"",text:"清空答案"}, ...choice.question.options.map(o=>({key:o.key,text:`${o.key} ${o.text}`}))]} value={activity?.answers[cetQuestionKey(choice.section.id, choice.question.number)]?.value || ""} label={`第 ${choice.question.number} 题选择${choice.section.type === "matching" ? "段落" : "单词"}`} onChoose={(key) => { updateDraft(choice.question, key, {activityId:choice.activityId,sectionId:choice.section.id}); setChoice(null); }} onClose={() => setChoice(null)} />}
    {sheet && <Sheet title={sheet} left={sheet === "选择真题"} onClose={() => setSheet("")}>
      {sheet === "计时归零" || sheet === "设置倒计时" ? <div className="cet-test-settings">
        <p>{sheet==='计时归零' ? activity&&projectCetTimer(activity,section.id).mode==='countdown'?'将重新从本轮设置时长倒计时，答案保留。':'仅重置当前计时，已选答案和原始累计用时保留。':'从新时长开始倒计时，已选答案和原始累计用时保留。'}</p>
        {sheet==='设置倒计时'&&<CetDurationInput label="倒计时分钟数" value={minutes} onChange={setMinutes} />}
        {notice&&<p role="alert">{notice}</p>}<div className="cet-dialog-actions"><button onClick={()=>setSheet('')}>取消</button><button disabled={busy||timerStopped} onClick={()=>{if(sheet==='设置倒计时'&&(!/^\d+$/.test(minutes)||Number(minutes)<1||Number(minutes)>180)){setNotice('请输入1–180的整数分钟。');return;}void applyTimerAdjustment(sheet==='计时归零'?'reset':'countdown');}}>确认调整</button></div>
      </div> : sheet === "开始新自测" ? <div className="cet-test-settings"><p>本次：{entry.sectionId ? section.type==='listening'?'听力题组':'单篇题组' : scope.some(s=>s.type==='listening')?'听力与阅读套卷':'阅读套卷'} · 共 {model.total} 题</p><div className="cet-timer-mode">{(['countup','countdown'] as const).map(mode=><button key={mode} aria-pressed={timerMode===mode} onClick={()=>setTimerMode(mode)}>{mode==='countup'?'正计时':'倒计时'}</button>)}</div><p>{timerMode==='countup'?'从 00:00 开始累计，用时由你掌握。':'设置时长，到时结束并保存本次答卷。'}</p>{timerMode==='countdown' && <CetDurationInput label="自测分钟数" value={minutes} onChange={setMinutes} />}<p>提交前不提供查词和翻译；提交后查看答案与解析。{scope.some(s=>s.type==="listening")?"音频播放期间无法暂停或切换题目；保存离开会记录中断。":"点击阅读页上的计时胶囊可暂停或继续。"}</p>{notice && <p role="alert">{notice}</p>}<div className="cet-dialog-actions"><button onClick={()=>setSheet('')}>返回</button><button disabled={busy} onClick={()=>{if(timerMode==='countdown' && (!/^\d+$/.test(minutes)||Number(minutes)<1||Number(minutes)>180)){setNotice('请输入 1–180 的整数分钟。');return;}void start('self_test');}}>开始自测</button></div></div> : sheet === "选择真题" ? <CetLibrary compact onOpen={(selected) => void leaveTo(() => { setSheet(""); onOpen(selected); })} /> : sheet === "练习历史" ? <div className="cet-history"><p>{historyScope === "all_cet" ? "全部真题历史" : "本套记录"}</p><CetSelect label="历史级别" value={historyLevel} options={[{key:"all",text:"全部级别"},{key:"4",text:"四级"},{key:"6",text:"六级"}]} onChange={setHistoryLevel} /><CetSelect label="历史目标" value={historyPurpose} options={[{key:"all",text:"全部目标"},{key:"practice",text:"练习"},{key:"self_test",text:"自测"}]} onChange={v=>setHistoryPurpose(v as typeof historyPurpose)} />{visibleHistory.slice(0, historyLimit).map((record) => <button key={record.id} onClick={() => void leaveTo(() => { setSheet(""); onOpen({ paperId: record.paperId, sectionId: record.sectionId, attemptId: record.id }); })}><small>{record.sectionId ? "单篇" : "整卷"} · {record.purpose === "practice" ? record.sectionId?.endsWith("-listening") ? "听力练习" : "阅读练习" : record.timerMode === "countup" ? "正计时自测" : "倒计时自测"}</small><strong>{record.title}</strong><span>{record.status === "submitted" ? record.purpose === "self_test" ? "已提交" : "查看结果" : record.status === "ended" ? "未完成结束" : record.status === "paused" ? "继续已暂停自测" : "继续"} · {record.answerCount} 题</span></button>)}{visibleHistory.length > historyLimit && <button onClick={() => setHistoryLimit((n) => n + 30)}>加载更多记录</button>}{!visibleHistory.length && <p>开始练习后，进度会保存在这里。</p>}</div> : sheet === "答题卡" ? <div className="cet-answer-card"><p>已答 {model.answered}/{model.total} 题</p>{scope.map((item) => <section key={item.id}><h3>{item.type==='detail' ? item.title : names[item.type]}</h3>{item.questions.map((question) => {
        const key=cetQuestionKey(item.id,question.number), value=model.answer(item.id,key), state=model.state(item.id,key);
        const marks={correct:'✓',incorrect:'×',unanswered:'—',unverified:'待核对',answered:'',draft:''};
        const labels={correct:'正确',incorrect:'错误',unanswered:'未答',unverified:'待核对',answered:'已答',draft:'未作答'};
        return <button type="button" key={question.number} data-result={state} data-answered={Boolean(value)} aria-label={`第 ${question.number} 题，${labels[state]}${value ? `，选择 ${value}` : ''}`} onClick={()=>{jumpQuestion.current=question.number;changeSection(item.id);setSheet('');}}>{question.number}{value && ` · ${value}`}<span>{marks[state]}</span></button>;
      })}</section>)}</div> : <div className="cet-confirm">{listeningRunning&&testing&&<p>提交将结束当前音频播放；未听完会在这次记录中标明。</p>}
        <p>{sheet === "提交全部" ? `还有 ${practiceUnanswered} 题未答，提交后将检查本次练习全部 ${scope.length} ${scope.some(s=>s.type==="listening")?"组":"篇"}。已提交结果保持不变。` : sheet === "提交本篇" ? remaining ? `本篇还有 ${remaining} 题未作答。提交后答案固定并显示解析。` : "提交后答案固定并显示解析。" : sheet === "提交自测" ? remaining ? `还有 ${remaining} 题未作答。提交后本次自测结束，答案与用时固定。` : "提交后本次自测结束，答案与用时固定。" : sheet === "结束自测并精读" ? "当前答案和用时会保留，本次自测将标记为“未完成结束”。进入精读后可以查词和查看解析；这份答卷不能继续作为原自测作答。之后可以重新开始一份空白自测。" : sheet === "保存失败" ? "结果尚未可靠保存，答案不会揭晓。请重试本机保存。" : "旧记录会保留，开始新一轮不会覆盖原答案。"}</p>
        {sheet === "提交自测" && <button className="cet-end" onClick={()=>setSheet("结束自测并精读")}>结束并精读（不计完成成绩）</button>}<div className="cet-dialog-actions"><button onClick={() => setSheet("")}>{sheet === "结束自测并精读" ? "继续自测" : "返回继续"}</button><button disabled={busy} onClick={() => { if (sheet === "提交全部") void commit("submit_all"); else if (sheet === "提交本篇") void commit("passage_submit", section.id); else if (sheet === "提交自测") void commit("manual_submit"); else if (sheet === "结束自测并精读") void commit("ended_for_study"); else if (sheet === "保存失败" && pendingFinal.current) void commit(pendingFinal.current.finalizations[Object.keys(pendingFinal.current.finalizations).at(-1)!]?.reason as "manual_submit"); else if (sheet === "重新练习") startNew("practice");  }}>{sheet === "提交全部" ? "提交全部并查看结果" : sheet === "提交本篇" ? "提交并查看解析" : sheet === "提交自测" ? "提交自测" : sheet === "结束自测并精读" ? "结束并精读" : sheet === "保存失败" ? "重试保存" : "开始新一轮"}</button></div>
      </div>}
    </Sheet>}
  </>;
}
