"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { ReaderView } from "@/components/ReaderView";
import { PillNavAction } from "@/components/PillNavAction";
import { CetLibrary, type CetEntry } from "./CetLibrary";
import { CetText } from "./CetText";
import { useAccount } from "@/components/AccountProvider";
import { useDocumentScrollLock } from "@/components/useDocumentScrollLock";
import {
  initializeLearningStorage,
  flushLearningStorage,
  getLearningStorage,
} from "@/lib/learningStorage";
import {
  readCetAttempts,
  saveCetAttempt,
  mergeCetAttempt,
} from "@/lib/cetProgress";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import type {
  CetAttempt,
  CetPaper,
  CetSection,
  CetQuestion,
} from "@/types/cet";
import type { WordContext } from "@/types/reader";
import toolbarStyles from "@/components/ReaderToolbar.module.css";
import "./cet.css";
const names = { cloze: "选词填空", matching: "长篇匹配", detail: "仔细阅读" };
const formatTime = (n: number) =>
  `${Math.floor(n / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((n / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
function TimerClock({
  read,
  running,
}: {
  read: () => number;
  running: () => boolean;
}) {
  const [, render] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (running()) render((n) => n + 1);
    }, 1000);
    return () => clearInterval(t);
  }, [running]);
  return <strong aria-label="练习用时">{formatTime(read())}</strong>;
}
function Sheet({
  title,
  onClose,
  children,
  left = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  left?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useDocumentScrollLock(true);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => {
      el?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`cet-sheet ${left ? "cet-sheet-left" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label={`关闭${title}`}>
            ×
          </button>
        </header>
        <div className="cet-sheet-body">{children}</div>
      </section>
    </dialog>
  );
}
type BaseProps = Pick<
  ComponentProps<typeof ReaderView>,
  | "savedArticles"
  | "onArticleSaved"
  | "onOpenSavedArticle"
  | "onRenameSavedArticle"
  | "onDeleteSavedArticle"
  | "onOpenImportedArticle"
>;
export function CetReader({
  entry,
  onOpen,
  onBack,
  ...base
}: BaseProps & {
  entry: CetEntry;
  onOpen: (e: CetEntry) => void;
  onBack: () => void;
}) {
  const { account } = useAccount();
  const [paper, setPaper] = useState<CetPaper | null>(null),
    [attempt, setAttempt] = useState<CetAttempt | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [sheet, setSheet] = useState(""),
    [activeToken, setActiveToken] = useState(""),
    [expanded, setExpanded] = useState<string[]>([]),
    [dontRemind, setDontRemind] = useState(false),
    [tick, setTick] = useState(0),
    [historyLimit, setHistoryLimit] = useState(30);
  const current = useRef<CetAttempt | null>(null),
    running = useRef<{ id: string; start: number } | null>(null),
    owner = useRef(""),
    pendingScroll = useRef<number | null>(null);
  const storageOwner = () =>
    getLearningStorage().getItem("context-reader:local-account-owner:v1") ||
    "guest";
  function persist(next: CetAttempt, quiet = false) {
    if (owner.current !== storageOwner()) return;
    try {
      const saved = saveCetAttempt(next);
      current.current = saved;
      if (!quiet) setAttempt(saved);
      setNotice("");
      void flushLearningStorage().catch(() =>
        setNotice("本机写入尚未完成，请保留页面并重试。"),
      );
    } catch {
      setNotice("进度暂时未能保存，请保留页面并重试。");
    }
  }
  function checkpoint(stop = false) {
    const a = current.current,
      r = running.current;
    if (!a) return;
    if (r) {
      const timerParts = { ...a.timerParts, [r.id]: Date.now() - r.start };
      persist(
        {
          ...a,
          timerParts,
          elapsedMs: Object.values(timerParts).reduce((s, n) => s + n, 0),
          updatedAt: new Date().toISOString(),
        },
        !stop,
      );
    }
    if (stop) {
      running.current = null;
      setTick((x) => x + 1);
    }
  }
  function newAttempt(p: CetPaper): CetAttempt {
    const s = p.sections.find((s) => s.id === entry.sectionId) || p.sections[0],
      now = new Date().toISOString();
    return {
      id: crypto.randomUUID(),
      scope: entry.sectionId ? `section:${entry.sectionId}` : `paper:${p.id}`,
      paperId: p.id,
      sectionId: entry.sectionId,
      activeSection: s.id,
      title: entry.sectionId ? `${p.title} · ${s.title}` : p.title,
      mode: "study",
      answers: {},
      answerTimes: {},
      revealed: {},
      elapsedMs: 0,
      timerEpoch: now,
      timerParts: {},
      createdAt: now,
      updatedAt: now,
    };
  }
  useEffect(() => {
    let live = true;
    setPaper(null);
    setAttempt(null);
    setError("");
    running.current = null;
    current.current = null;
    void Promise.all([
      initializeLearningStorage(),
      fetch(`/api/cet?id=${encodeURIComponent(entry.paperId)}`).then(
        async (r) => {
          const d = await r.json();
          if (!r.ok) throw Error(d.error || "试卷加载失败。");
          return d.paper as CetPaper;
        },
      ),
    ])
      .then(([, p]) => {
        if (!live) return;
        owner.current = storageOwner();
        const scope = entry.sectionId
          ? `section:${entry.sectionId}`
          : `paper:${p.id}`;
        const candidates = readCetAttempts()
          .filter((x) => x.scope === scope)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        const a =
          (entry.attemptId
            ? candidates.find((x) => x.id === entry.attemptId)
            : candidates[0]) || newAttempt(p);
        setPaper(p);
        current.current = a;
        persist(a);
      })
      .catch((e) => {
        if (live) setError(e.message || "试卷加载失败，请重试。");
      });
    return () => {
      checkpoint(true);
      void flushLearningStorage().catch(() => {});
      live = false;
    };
    // Scope changes must pause before loading the next attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    entry.paperId,
    entry.sectionId,
    entry.attemptId,
    account.profile?.userId,
  ]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (running.current) checkpoint();
    }, 10000);
    const pause = () => checkpoint(true);
    const hidden = () => {
      if (document.hidden) pause();
    };
    const merge = () => {
      const a = current.current;
      if (!a) return;
      const cloud = readCetAttempts().find((x) => x.id === a.id);
      if (cloud) {
        const merged = mergeCetAttempt(a, cloud);
        if (merged.timerEpoch !== a.timerEpoch || merged.finishedAt)
          running.current = null;
        current.current = merged;
        setAttempt(merged);
      }
    };
    window.addEventListener("pagehide", pause);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, merge);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", pause);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, merge);
    };
  }, []);
  useLayoutEffect(() => {
    if (pendingScroll.current !== null) {
      window.scrollTo(0, pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [attempt?.activeSection]);
  if (error)
    return (
      <div className="cet-load">
        <p role="alert">{error}</p>
        <button onClick={onBack}>返回首页</button>
      </div>
    );
  if (!paper || !attempt)
    return (
      <div className="cet-load" role="status">
        正在打开试卷…
      </div>
    );
  const section =
      paper.sections.find((s) => s.id === attempt.activeSection) ||
      paper.sections[0],
    scope = attempt.sectionId ? [section] : paper.sections,
    locked = attempt.mode === "exam" && !attempt.finishedAt,
    sectionRevealed = !!attempt.revealed[section.id] || !!attempt.finishedAt;
  const key = (q: CetQuestion, s: CetSection = section) =>
    `${s.id}:${q.number}`;
  const isShown = (q: CetQuestion) =>
    sectionRevealed || (attempt.mode === "study" && !!attempt.answers[key(q)]);
  const update = (patch: Partial<CetAttempt>) =>
    persist({
      ...current.current!,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  function choose(q: CetQuestion, value: string) {
    if (isShown(q)) return;
    if (
      section.type === "cloze" &&
      value &&
      section.questions.some(
        (other) =>
          other.number !== q.number &&
          attempt!.answers[key(other)] === value &&
          (locked || other.answer === value),
      )
    ) {
      setNotice("这个单词已用于另一空，请先修改那个空。");
      return;
    }
    const k = key(q);
    update({
      answers: { ...current.current!.answers, [k]: value },
      answerTimes: {
        ...current.current!.answerTimes,
        [k]: new Date().toISOString(),
      },
    });
  }
  function switchSection(id: string, scroll = false) {
    pendingScroll.current = scroll ? 0 : window.scrollY;
    setActiveToken("");
    update({ activeSection: id });
  }
  function reveal() {
    if (dontRemind)
      getLearningStorage().setItem(
        `context-reader:cet-skip-reveal-warning:${storageOwner()}`,
        "1",
      );
    update({
      revealed: {
        ...current.current!.revealed,
        [section.id]: new Date().toISOString(),
      },
    });
    setSheet("");
  }
  function finish() {
    checkpoint(true);
    update({ finishedAt: new Date().toISOString() });
    setSheet("");
  }
  function leave() {
    checkpoint(true);
    onBack();
  }
  const r = running.current,
    elapsed =
      attempt.elapsedMs +
      (r
        ? Math.max(0, Date.now() - r.start - (attempt.timerParts[r.id] || 0))
        : 0);
  void tick;
  const timer = (
    <div className="cet-timer">
      <span>本次{attempt.sectionId ? "阅读" : "整卷"}用时</span>
      <TimerClock
        read={() => {
          const a = current.current!,
            r = running.current;
          return (
            a.elapsedMs +
            (r
              ? Math.max(0, Date.now() - r.start - (a.timerParts[r.id] || 0))
              : 0)
          );
        }}
        running={() => !!running.current}
      />
      <div>
        <button
          disabled={!!attempt.finishedAt}
          onClick={() => {
            if (running.current) checkpoint(true);
            else {
              running.current = { id: crypto.randomUUID(), start: Date.now() };
              setTick((x) => x + 1);
            }
          }}
        >
          {attempt.finishedAt
            ? "已停止"
            : r
              ? "暂停计时"
              : elapsed
                ? "继续计时"
                : "开始计时"}
        </button>
        <button
          disabled={!!attempt.finishedAt}
          onClick={() => setSheet("归零计时")}
        >
          归零
        </button>
      </div>
    </div>
  );
  const allQuestions = scope.flatMap((s) => s.questions.map((q) => ({ s, q }))),
    answered = allQuestions.filter(
      ({ s, q }) => attempt.answers[key(q, s)],
    ).length;
  const correctCount = allQuestions.filter(
    ({ s, q }) => q.answer && attempt.answers[key(q, s)] === q.answer,
  ).length;
  const lookupText = (
    text: string,
    lookup: (c: WordContext) => void,
    contextText?: string,
  ) => (
    <CetText
      text={text}
      locked={locked}
      lookup={lookup}
      active={activeToken}
      onActive={setActiveToken}
      contextText={contextText}
    />
  );
  const explanation = (q: CetQuestion) => {
    const k = key(q),
      correct = attempt.answers[k] === q.answer,
      open = !correct || expanded.includes(k);
    return (
      <div className="cet-explanation" data-correct={correct}>
        <button
          onClick={() =>
            setExpanded((prev) =>
              prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k],
            )
          }
        >
          {q.answer
            ? `${correct ? "回答正确" : attempt.answers[k] ? "答案需调整" : "未作答"} · 参考答案 ${q.answer}`
            : "答案待核对"}{" "}
          {correct ? (open ? "收起解析" : "展开解析") : ""}
        </button>
        {open && (
          <p>{q.explanation || "来源暂未提供可靠解析。此题暂不计入正确率。"}</p>
        )}
      </div>
    );
  };
  return (
    <>
      <ReaderView
        key={section.id}
        {...base}
        article={section.paragraphs
          .join("\n\n")
          .replace(/\[\[(\d+)\]\]/g, "（第 $1 空）")}
        importedArticle={{
          title: `${paper.title} · ${section.title}`,
          siteName: "四六级真题",
          url: paper.source,
          text: section.paragraphs.join("\n\n"),
          blocks: section.paragraphs.map((text, i) => ({
            id: `${section.id}-${i}`,
            type: "paragraph",
            text,
          })),
        }}
        onBack={leave}
        desktopViewportInsetLeft={132}
        examSurface={{
          locked,
          toolbar: (
            <>
              <PillNavAction
                className={toolbarStyles.action}
                label={`答题卡 ${answered}/${allQuestions.length}`}
                onClick={() => setSheet("答题卡")}
              />
              {locked && (
                <PillNavAction
                  className={toolbarStyles.action}
                  label="交卷并精读"
                  onClick={() => setSheet("交卷并精读")}
                />
              )}
            </>
          ),
          rail: (
            <div className={`${toolbarStyles.railActions} cet-rail`}>
              <button onClick={() => setSheet("选择真题")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5" />
                </svg>
                <span>选择真题</span>
                <small>按卷或题型选择阅读</small>
              </button>
              <button onClick={() => setSheet("练习历史")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v5l3 2" />
                </svg>
                <span>练习历史</span>
                <small>继续或回看练习</small>
              </button>
              <button onClick={() => setSheet("重新练习")}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9a8 8 0 1 1 0 6M4 3v6h6" />
                </svg>
                <span>重新练习</span>
                <small>保留记录并开始新一轮</small>
              </button>
            </div>
          ),
          timer,
          menu: (
            <div className="cet-menu">
              <button
                onClick={() => {
                  checkpoint(true);
                  update({ mode: "study" });
                }}
              >
                关闭考试模式
              </button>
              <button onClick={leave}>保存进度并返回首页</button>
            </div>
          ),
          render: (lookup) => (
            <div className="cet-reading">
              <div className="cet-reading-meta">
                <span>
                  {paper.title}
                  {attempt.sectionId ? " · 单篇练习" : " · 整卷练习"}
                </span>
                {attempt.finishedAt ? (
                  <span className="cet-notice">精读模式</span>
                ) : (
                  <div className="cet-mode">
                    <button
                      aria-pressed={attempt.mode === "exam"}
                      disabled={!!attempt.finishedAt}
                      onClick={() => {
                        if (attempt.mode !== "exam") {
                          if (
                            Object.values(attempt.answers).filter(Boolean)
                              .length
                          )
                            setSheet("重新考试");
                          else update({ mode: "exam" });
                        }
                      }}
                    >
                      考试模式
                    </button>
                    <button
                      aria-pressed={attempt.mode === "study"}
                      disabled={!!attempt.finishedAt}
                      onClick={() =>
                        locked
                          ? setSheet("关闭考试模式")
                          : update({ mode: "study" })
                      }
                    >
                      {locked ? "关闭考试模式" : "边读边做"}
                    </button>
                  </div>
                )}
              </div>
              <div className="cet-mobile-actions">
                <button onClick={() => setSheet("选择真题")}>选择真题</button>
                <button onClick={() => setSheet("练习历史")}>练习历史</button>
                <button onClick={() => setSheet("重新练习")}>重新练习</button>
              </div>
              <nav className="cet-sections" aria-label="阅读部分">
                {scope.map((s) => (
                  <button
                    key={s.id}
                    aria-current={s.id === section.id ? "page" : undefined}
                    onClick={() => switchSection(s.id)}
                  >
                    {s.type === "detail" ? s.title : names[s.type]}
                  </button>
                ))}
              </nav>
              {notice && (
                <p className="cet-notice" role="alert">
                  {notice}
                </p>
              )}
              {attempt.finishedAt && (
                <p className="cet-notice">
                  已交卷 · 答对 {correctCount}/{allQuestions.length} 题 · 已答{" "}
                  {answered} 题 · {formatTime(attempt.elapsedMs)}
                  {Object.keys(attempt.revealed).length
                    ? " · 曾提前查看答案，本次仅作练习记录"
                    : ""}
                </p>
              )}
              <div className="cet-mobile-timer">{timer}</div>
              <p className="cet-directions">
                {section.type === "cloze"
                  ? "从词库中选择合适单词填入空格，每词限用一次。"
                  : section.type === "matching"
                    ? "为每个陈述选择对应段落；段落可以被重复选择。"
                    : "阅读文章，并为每道题选择一个最佳答案。"}
              </p>
              <h1>{section.title}</h1>
              {section.bank && (
                <div className="cet-word-bank">
                  {section.bank.map((o) => (
                    <span key={o.key}>
                      <b>{o.key}</b> {lookupText(o.text, lookup)}
                    </span>
                  ))}
                </div>
              )}
              <div className="cet-passages">
                {section.paragraphs.map((text, i) => (
                  <p key={i}>
                    {section.type === "cloze"
                      ? text.split(/(\[\[\d+\]\])/g).map((part, j) => {
                          const n = Number(part.match(/\[\[(\d+)\]\]/)?.[1]);
                          const q = section.questions.find(
                            (q) => q.number === n,
                          );
                          return q ? (
                            <label
                              className="cet-gap"
                              id={`cet-q-${n}`}
                              key={j}
                            >
                              <span>{n}</span>
                              <select
                                aria-label={`第 ${n} 空`}
                                disabled={isShown(q)}
                                value={attempt.answers[key(q)] || ""}
                                onChange={(e) => choose(q, e.target.value)}
                              >
                                <option value="">选择单词</option>
                                {q.options.map((o) => (
                                  <option key={o.key} value={o.key}>
                                    {o.key}　{o.text}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : (
                            <span key={j}>
                              {lookupText(part, lookup, text)}
                            </span>
                          );
                        })
                      : lookupText(text, lookup)}
                  </p>
                ))}
              </div>
              {section.type !== "cloze" && (
                <div className="cet-questions">
                  {section.questions.map((q) => (
                    <section id={`cet-q-${q.number}`} key={q.number}>
                      <h2>
                        <b>{q.number}.</b> {lookupText(q.stem, lookup)}
                      </h2>
                      {section.type === "detail" ? (
                        <div
                          role="radiogroup"
                          aria-label={`第 ${q.number} 题选项`}
                        >
                          {q.options.map((o) => (
                            <div
                              className="cet-option"
                              data-chosen={attempt.answers[key(q)] === o.key}
                              key={o.key}
                            >
                              <button
                                role="radio"
                                aria-label={`第 ${q.number} 题选择 ${o.key}`}
                                aria-checked={attempt.answers[key(q)] === o.key}
                                disabled={isShown(q)}
                                onClick={() => choose(q, o.key)}
                              >
                                {o.key}
                              </button>
                              <span>{lookupText(o.text, lookup)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <select
                          aria-label={`第 ${q.number} 题对应段落`}
                          value={attempt.answers[key(q)] || ""}
                          disabled={isShown(q)}
                          onChange={(e) => choose(q, e.target.value)}
                        >
                          <option value="">选择段落</option>
                          {q.options.map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.key} 段
                            </option>
                          ))}
                        </select>
                      )}
                      {isShown(q) && explanation(q)}
                    </section>
                  ))}
                </div>
              )}
              {section.type === "cloze" && section.questions.some(isShown) && (
                <section className="cet-cloze-explanations">
                  <h2>选词填空解析</h2>
                  {section.questions.filter(isShown).map((q) => (
                    <div key={q.number}>
                      <h3>第 {q.number} 空</h3>
                      {explanation(q)}
                    </div>
                  ))}
                </section>
              )}
              {locked && !sectionRevealed && (
                <button
                  className="cet-reveal"
                  onClick={() => {
                    setDontRemind(false);
                    if (
                      getLearningStorage().getItem(
                        `context-reader:cet-skip-reveal-warning:${storageOwner()}`,
                      ) === "1"
                    )
                      reveal();
                    else setSheet("查看本篇答案");
                  }}
                >
                  仅查看本篇阅读答案
                </button>
              )}
              <p className="cet-source">
                试题来源：
                <a href={paper.source} target="_blank" rel="noreferrer">
                  CET46-Resources ↗
                </a>
                {paper.answerSource && (
                  <>
                    {" "}
                    ·{" "}
                    <a
                      href={paper.answerSource}
                      target="_blank"
                      rel="noreferrer"
                    >
                      参考答案与解析 ↗
                    </a>
                  </>
                )}
                。仅收录附有参考答案与解析的阅读材料。
              </p>
              <nav className="cet-bottom-nav">
                <button
                  disabled={scope.indexOf(section) === 0}
                  onClick={() =>
                    switchSection(scope[scope.indexOf(section) - 1].id, true)
                  }
                >
                  ← 上一篇
                </button>
                <span>
                  {scope.indexOf(section) + 1} / {scope.length}
                </span>
                <button
                  disabled={scope.indexOf(section) === scope.length - 1}
                  onClick={() =>
                    switchSection(scope[scope.indexOf(section) + 1].id, true)
                  }
                >
                  下一篇 →
                </button>
              </nav>
            </div>
          ),
        }}
      />
      {sheet && (
        <Sheet
          title={sheet}
          left={sheet === "选择真题"}
          onClose={() => setSheet("")}
        >
          {sheet === "选择真题" ? (
            <CetLibrary
              compact
              onOpen={(e) => {
                checkpoint(true);
                setSheet("");
                onOpen(e);
              }}
            />
          ) : sheet === "练习历史" ? (
            <div className="cet-history">
              {readCetAttempts()
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                .slice(0, historyLimit)
                .map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      checkpoint(true);
                      setSheet("");
                      onOpen({
                        paperId: a.paperId,
                        sectionId: a.sectionId,
                        attemptId: a.id,
                      });
                    }}
                  >
                    <small>
                      {a.sectionId ? "单篇" : "整卷"} ·{" "}
                      {a.mode === "exam" ? "考试" : "边读边做"}
                    </small>
                    <strong>{a.title}</strong>
                    <span>
                      {Object.values(a.answers).filter(Boolean).length} 题 ·{" "}
                      {formatTime(a.elapsedMs)} ·{" "}
                      {a.finishedAt ? "回看" : "继续"}
                    </span>
                  </button>
                ))}
              {readCetAttempts().length > historyLimit && (
                <button onClick={() => setHistoryLimit((n) => n + 30)}>
                  加载更多记录
                </button>
              )}
            </div>
          ) : sheet === "答题卡" ? (
            <div className="cet-answer-card">
              {scope.map((s) => (
                <section key={s.id}>
                  <h3>{names[s.type]}</h3>
                  {s.questions.map((q) => (
                    <button
                      key={q.number}
                      data-answered={!!attempt.answers[key(q, s)]}
                      onClick={() => {
                        switchSection(s.id);
                        setSheet("");
                        requestAnimationFrame(() =>
                          document
                            .getElementById(`cet-q-${q.number}`)
                            ?.scrollIntoView({ block: "center" }),
                        );
                      }}
                    >
                      {q.number}
                      {attempt.answers[key(q, s)] &&
                        ` · ${attempt.answers[key(q, s)]}`}
                    </button>
                  ))}
                </section>
              ))}
            </div>
          ) : (
            <>
              <p>
                {sheet === "查看本篇答案"
                  ? "建议全部做完再检查答案。提前查看后，本篇答案会锁定，本次记录会标为已查看答案。"
                  : sheet === "关闭考试模式"
                    ? "当前答案和用时会保留，切换后可以划词并查看已答题目的解析。"
                    : sheet === "交卷并精读"
                      ? `本次还有 ${allQuestions.length - answered} 题未作答。交卷后停止计时，保留答案并进入精读。`
                      : sheet === "归零计时"
                        ? "仅清零本次练习的计时，已选答案保留。"
                        : "当前进度会保留。确认后继续。"}
              </p>
              {sheet === "查看本篇答案" && (
                <label className="cet-checkbox">
                  <input
                    type="checkbox"
                    checked={dontRemind}
                    onChange={(e) => setDontRemind(e.target.checked)}
                  />
                  下次不再提醒
                </label>
              )}
              <div className="cet-dialog-actions">
                <button onClick={() => setSheet("")}>继续阅读</button>
                <button
                  onClick={() => {
                    if (sheet === "查看本篇答案") reveal();
                    else if (sheet === "交卷并精读") finish();
                    else if (sheet === "归零计时") {
                      running.current = null;
                      update({
                        timerEpoch: new Date().toISOString(),
                        timerParts: {},
                        elapsedMs: 0,
                      });
                      setSheet("");
                    } else if (sheet === "关闭考试模式") {
                      checkpoint(true);
                      update({ mode: "study" });
                      setSheet("");
                    } else {
                      checkpoint(true);
                      const a = newAttempt(paper);
                      if (sheet === "重新考试") a.mode = "exam";
                      persist(a);
                      setExpanded([]);
                      setSheet("");
                    }
                  }}
                >
                  {sheet === "查看本篇答案"
                    ? "仍然查看答案"
                    : sheet === "关闭考试模式"
                      ? "关闭考试模式"
                      : sheet === "归零计时"
                        ? "确认归零"
                        : sheet === "交卷并精读"
                          ? "确认交卷"
                          : "开始新一轮"}
                </button>
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
