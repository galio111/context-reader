"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { SavedArticle } from "@/types/article";
import type { PublicArticle } from "@/types/publicArticle";
import { AccountNav } from "@/components/AccountProvider";
import { savedArticleOpenTimestamp } from "@/lib/savedArticleMerge";

type InputMode = "paste" | "url";
type Scene = "word" | "phrase" | "articles" | "final";

function isLocalScrollSurfaceEvent(event: Event): boolean {
  return event.target instanceof Element && Boolean(event.target.closest("[data-local-scroll-surface]"));
}

interface ImmersiveHomeProps {
  article: string;
  articleUrl: string;
  error: string;
  urlError: string;
  ocrError: string;
  importingUrl: boolean;
  ocrLoading: boolean;
  openingPublicArticleId: string;
  demoCompleted: boolean;
  publicArticles: PublicArticle[];
  savedArticles: SavedArticle[];
  vocabularyCount: number;
  onArticleChange: (value: string) => void;
  onArticleUrlChange: (value: string) => void;
  onStartReading: () => void;
  onImportUrl: () => void;
  onOcrImage: (file: File | null) => void;
  onOpenPublicArticle: (id: string) => Promise<void>;
  onPrefetchPublicArticle: (id: string) => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onDeleteSavedArticle: (id: string) => void;
  onOpenVocabulary: () => void;
}

const heroSentence = "A word rarely travels alone; context decides what it carries.";
const heroHintText = "尝试点击任意单词，体验语境翻译";
const demoMeaningText = "没有直接做到或说到某一步，只差一点";
const phraseInstructionText = "把鼠标移到蓝色词组上，尝试从左向右划过它";
const heroMeanings: Record<string, string> = {
  A: "一（个），用于引出单数事物",
  word: "词语，此处指需要结合上下文理解的表达",
  rarely: "很少，强调这种情况并不常见",
  travels: "出现、存在；travels alone 在这里表示“孤立出现”",
  alone: "孤立地，与 travels 一起强调词语总带着上下文",
  context: "语境，决定这个词在此处真正表达什么",
  decides: "决定、赋予方向，突出语境对词义的作用",
  what: "什么，引导它所承载的内容",
  it: "它，指前面的 word",
  carries: "承载某种含义，不是字面上的搬运",
};

const phraseRows = [
  ["The committee", "backed away from", "the proposal.", "最终没有继续支持这个提案"],
  ["Her explanation", "left room for", "doubt.", "给怀疑留下了余地"],
  ["The results", "fell short of", "expectations.", "没有达到原本的预期"],
  ["He finally", "came to terms with", "the decision.", "逐渐接受并面对了这个决定"],
  ["The detail", "slipped through the cracks", ".", "在过程中被疏忽遗漏了"],
  ["The plan", "hinges on", "public support.", "能否实现取决于公众支持"],
  ["His comment", "struck a chord with", "the audience.", "引起了听众的强烈共鸣"],
  ["The policy", "paved the way for", "further reforms.", "为进一步改革铺平了道路"],
] as const;

const sceneWords: Record<Scene, [string, string]> = {
  word: ["CONTEXT", "MEANING"],
  phrase: ["PHRASE", "EXPRESSION"],
  articles: ["STORIES", "READING"],
  final: ["YOUR", "ARTICLE"],
};

function Arrow() {
  return <span aria-hidden="true">→</span>;
}

function RollingLabel({ children }: { children: string }) {
  return <span className="cr-roll"><span>{children}</span><span aria-hidden="true">{children}</span></span>;
}

const savedArticleDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function savedArticleTimestamp(article: SavedArticle): number {
  return savedArticleOpenTimestamp(article);
}

function savedArticlePreview(article: SavedArticle): string {
  const summary = article.summary?.trim();
  if (summary) return summary;
  return article.body.trim().replace(/\s+/g, " ").slice(0, 90);
}

function formatSavedArticleDate(article: SavedArticle): string {
  const value = savedArticleTimestamp(article);
  return value ? savedArticleDateFormatter.format(new Date(value)) : "时间未知";
}

function SavedArticlesMenu({
  articles,
  onOpen,
  onDelete,
}: {
  articles: SavedArticle[];
  onOpen: (article: SavedArticle) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const sortedArticles = useMemo(
    () => [...articles].sort((left, right) => savedArticleTimestamp(right) - savedArticleTimestamp(left)),
    [articles],
  );

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className={`cr-saved-menu ${open ? "is-open" : ""}`} data-local-scroll-surface>
      <button
        className="cr-saved-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-label={`已保存文章，共 ${articles.length} 篇`}
        aria-expanded={open}
        aria-controls="cr-saved-articles-panel"
        onClick={(event) => {
          if (open) event.currentTarget.blur();
          setOpen((current) => !current);
        }}
      >
        <span className="cr-saved-label-full">已保存</span>
        <span className="cr-saved-label-short">保存</span>
        <span className="cr-saved-count" aria-label={`${articles.length} 篇`}>{articles.length}</span>
        <span className="cr-saved-chevron" aria-hidden="true">⌄</span>
      </button>
      <section id="cr-saved-articles-panel" className="cr-saved-panel" aria-label="已保存文章，按最近打开排序">
        <header>
          <div><strong>已保存文章</strong><span>按最近打开排序</span></div>
          <span>{articles.length} 篇</span>
        </header>
        {sortedArticles.length ? (
          <div className="cr-saved-list">
            {sortedArticles.map((article) => (
              <div className="cr-saved-row" key={article.id}>
                <button
                  className="cr-saved-open"
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onOpen(article);
                  }}
                >
                  <span className="cr-saved-title">{article.title || "未命名文章"}</span>
                  <span className="cr-saved-summary">{savedArticlePreview(article)}</span>
                  <span className="cr-saved-time">最近打开 {formatSavedArticleDate(article)}</span>
                </button>
                <button
                  className="cr-saved-delete"
                  type="button"
                  aria-label={`删除 ${article.title || "这篇文章"}`}
                  onClick={() => {
                    if (window.confirm(`确定删除“${article.title || "这篇文章"}”吗？`)) onDelete(article.id);
                  }}
                >删除</button>
              </div>
            ))}
          </div>
        ) : (
          <div className="cr-saved-empty"><strong>还没有保存文章</strong><span>阅读时保存的文章会出现在这里。</span></div>
        )}
      </section>
    </div>
  );
}

function PhraseTarget({ phrase, meaning }: { phrase: string; meaning: string }) {
  const targetRef = useRef<HTMLButtonElement | null>(null);
  const startRef = useRef<{ id: number; left: number; width: number; valid: boolean; max: number } | null>(null);
  const streamRef = useRef<number | null>(null);
  const [progress, setProgress] = useState(0);
  const [meaningText, setMeaningText] = useState("");
  const [selecting, setSelecting] = useState(false);

  useEffect(() => () => {
    if (streamRef.current !== null) window.clearInterval(streamRef.current);
  }, []);

  function finish(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = startRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    startRef.current = null;
    setSelecting(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.valid || drag.max < 0.78) {
      setProgress(0);
      setMeaningText("");
      return;
    }
    setProgress(1);
    if (streamRef.current !== null) window.clearInterval(streamRef.current);
    let index = 0;
    setMeaningText("");
    streamRef.current = window.setInterval(() => {
      index += 1;
      setMeaningText(meaning.slice(0, index));
      if (index >= meaning.length && streamRef.current !== null) {
        window.clearInterval(streamRef.current);
        streamRef.current = null;
      }
    }, 24);
  }

  return (
    <span className={`cr-phrase-unit ${progress === 1 ? "is-explained" : ""} ${selecting ? "is-selecting" : ""}`} style={{ "--select": `${progress * 100}%` } as CSSProperties}>
      <button
        ref={targetRef}
        className="cr-phrase-target"
        type="button"
        onPointerEnter={() => {
          const width = targetRef.current?.getBoundingClientRect().width ?? 100;
          targetRef.current?.style.setProperty("--gesture-width", `${width}px`);
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          const localX = event.clientX - rect.left;
          startRef.current = { id: event.pointerId, left: rect.left, width: rect.width, valid: localX <= rect.width * 0.34, max: 0 };
          event.currentTarget.setPointerCapture(event.pointerId);
          setProgress(0);
          setMeaningText("");
          setSelecting(true);
        }}
        onPointerMove={(event) => {
          const drag = startRef.current;
          if (!drag || drag.id !== event.pointerId) return;
          const next = drag.valid ? Math.max(0, Math.min(1, (event.clientX - drag.left) / drag.width)) : 0;
          drag.max = Math.max(drag.max, next);
          setProgress(next);
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <span>{phrase}</span><i className="cr-gesture-hand" aria-hidden="true" />
      </button>
      <span className={`cr-phrase-meaning ${meaningText && meaningText.length < meaning.length ? "is-streaming" : ""}`}>{meaningText}</span>
    </span>
  );
}

export function ImmersiveHome(props: ImmersiveHomeProps) {
  const [ready, setReady] = useState(props.demoCompleted);
  const [loadPercent, setLoadPercent] = useState(props.demoCompleted ? 100 : 0);
  const [guideReady, setGuideReady] = useState(props.demoCompleted);
  const [guidePressed, setGuidePressed] = useState(false);
  const [heroUnlocked, setHeroUnlocked] = useState(props.demoCompleted);
  const [activeWord, setActiveWord] = useState(props.demoCompleted ? "travels" : "");
  const [heroMeaning, setHeroMeaning] = useState(props.demoCompleted ? heroMeanings.travels : "");
  const [heroMeaningStreaming, setHeroMeaningStreaming] = useState(false);
  const [heroHint, setHeroHint] = useState(props.demoCompleted ? heroHintText : "");
  const [heroHintStreaming, setHeroHintStreaming] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(!props.demoCompleted);
  const [cursorPosition, setCursorPosition] = useState({ left: 0, top: 0 });
  const [phraseStage, setPhraseStage] = useState(props.demoCompleted ? 4 : 0);
  const [demoMeaning, setDemoMeaning] = useState(props.demoCompleted ? demoMeaningText : "");
  const [phraseInstruction, setPhraseInstruction] = useState(props.demoCompleted ? phraseInstructionText : "");
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [activeScene, setActiveScene] = useState<Scene>("word");
  const [sceneChanging, setSceneChanging] = useState(false);
  const [transition, setTransition] = useState<{ x: number; y: number; phase: "show" | "out" } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const heroRef = useRef<HTMLElement | null>(null);
  const heroContentRef = useRef<HTMLDivElement | null>(null);
  const travelsRef = useRef<HTMLButtonElement | null>(null);
  const phraseRef = useRef<HTMLElement | null>(null);
  const phraseBrowserRef = useRef<HTMLDivElement | null>(null);
  const phraseTrackRef = useRef<HTMLDivElement | null>(null);
  const articlesRef = useRef<HTMLElement | null>(null);
  const finalRef = useRef<HTMLElement | null>(null);
  const phraseStarted = useRef(props.demoCompleted);
  const heroStreamRef = useRef<number | null>(null);
  const hintStreamRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const wheelSnapLockedRef = useRef(false);

  function later(callback: () => void, delay: number) {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
    return timer;
  }

  useEffect(() => {
    window.history.scrollRestoration = "manual";
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    if (props.demoCompleted) {
      document.body.classList.remove("cr-home-locked");
      return () => document.body.classList.remove("cr-home-locked");
    }

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.body.classList.add("cr-home-locked");
    if (reduced) {
      setLoadPercent(100);
      setReady(true);
      setGuideReady(true);
      return () => document.body.classList.remove("cr-home-locked");
    }
    const started = performance.now();
    let frame = 0;
    const load = (now: number) => {
      const progress = Math.min(1, (now - started) / 1450);
      const eased = 1 - Math.pow(1 - progress, 3);
      setLoadPercent(Math.round(eased * 100));
      if (progress < 1) frame = requestAnimationFrame(load);
      else later(() => {
        setReady(true);
        later(() => setGuideReady(true), 1250);
      }, 150);
    };
    frame = requestAnimationFrame(load);
    return () => {
      cancelAnimationFrame(frame);
      document.body.classList.remove("cr-home-locked");
    };
  }, [props.demoCompleted]);

  useEffect(() => () => {
    timersRef.current.forEach(window.clearTimeout);
    if (heroStreamRef.current !== null) window.clearInterval(heroStreamRef.current);
    if (hintStreamRef.current !== null) window.clearInterval(hintStreamRef.current);
  }, []);

  useEffect(() => {
    if (!guideReady || !cursorVisible) return;
    const positionCursor = () => {
      const stage = heroContentRef.current;
      const target = travelsRef.current;
      if (!stage || !target) return;
      const stageRect = stage.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      setCursorPosition({
        left: targetRect.left - stageRect.left + targetRect.width * 0.58,
        top: targetRect.top - stageRect.top + targetRect.height * 0.58,
      });
    };
    positionCursor();
    window.addEventListener("resize", positionCursor);
    return () => window.removeEventListener("resize", positionCursor);
  }, [guideReady, cursorVisible]);

  useEffect(() => {
    const shouldBlock = !heroUnlocked || (activeScene === "phrase" && phraseStage < 4);
    if (!shouldBlock) return;

    const stopScroll = (event: Event) => {
      if (isLocalScrollSurfaceEvent(event)) return;
      event.preventDefault();
    };
    const stopScrollKeys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("[data-local-scroll-surface]")
        || target?.matches("input, textarea, [contenteditable='true']")
      ) return;
      if (["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(event.key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("wheel", stopScroll, { passive: false });
    window.addEventListener("touchmove", stopScroll, { passive: false });
    window.addEventListener("keydown", stopScrollKeys);
    return () => {
      window.removeEventListener("wheel", stopScroll);
      window.removeEventListener("touchmove", stopScroll);
      window.removeEventListener("keydown", stopScrollKeys);
    };
  }, [activeScene, heroUnlocked, phraseStage]);

  useEffect(() => {
    if (activeScene !== "articles") return;
    props.publicArticles.slice(0, 5).forEach((article) => props.onPrefetchPublicArticle(article.id));
  }, [activeScene, props.onPrefetchPublicArticle, props.publicArticles]);

  useEffect(() => {
    const sections = [
      [heroRef.current, "word"],
      [phraseRef.current, "phrase"],
      [articlesRef.current, "articles"],
      [finalRef.current, "final"],
    ] as const;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const match = sections.find(([element]) => element === visible.target);
      if (!match) return;
      const next = match[1];
      setActiveScene((current) => {
        if (current === next) return current;
        setSceneChanging(true);
        later(() => setSceneChanging(false), 520);
        return next;
      });
      if (next === "phrase" && !phraseStarted.current) {
        phraseStarted.current = true;
        phraseRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        setPhraseStage(1);
        later(() => setPhraseStage(2), 520);
        later(() => {
          setPhraseStage(3);
          const meaning = demoMeaningText;
          let index = 0;
          const meaningTimer = window.setInterval(() => {
            index += 1;
            setDemoMeaning(meaning.slice(0, index));
            if (index >= meaning.length) {
              window.clearInterval(meaningTimer);
              later(() => {
                const instruction = phraseInstructionText;
                let instructionIndex = 0;
                const instructionTimer = window.setInterval(() => {
                  instructionIndex += 1;
                  setPhraseInstruction(instruction.slice(0, instructionIndex));
                  if (instructionIndex >= instruction.length) {
                    window.clearInterval(instructionTimer);
                    setPhraseStage(4);
                  }
                }, 30);
              }, 180);
            }
          }, 22);
        }, 2180);
      }
    }, { threshold: [0.18, 0.42, 0.65] });
    sections.forEach(([element]) => element && observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let targetTravel = 0;
    let currentTravel = 0;
    let frame = 0;
    let last = performance.now();
    const updateTarget = () => {
      const section = phraseRef.current;
      const browser = phraseBrowserRef.current;
      const track = phraseTrackRef.current;
      if (!section || !browser || !track || phraseStage < 4) return;
      const travel = Math.max(1, section.offsetHeight - window.innerHeight);
      const raw = (window.scrollY - section.offsetTop) / travel;
      const progress = Math.max(0, Math.min(1, (raw - 0.025) / 0.95));
      targetTravel = progress * Math.max(0, track.scrollHeight - browser.clientHeight);
    };
    const render = (now: number) => {
      const browser = phraseBrowserRef.current;
      const track = phraseTrackRef.current;
      if (browser && track && phraseStage >= 4) {
        const delta = Math.min(42, now - last);
        const smoothing = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 1 - Math.exp(-delta * 0.02);
        currentTravel += (targetTravel - currentTravel) * smoothing;
        track.style.transform = `translate3d(0, ${-currentTravel}px, 0)`;
        const center = browser.clientHeight / 2;
        track.querySelectorAll<HTMLElement>(".cr-practice-row").forEach((row) => {
          const rowCenter = row.offsetTop - currentTravel + row.offsetHeight / 2;
          const distance = Math.max(-1.15, Math.min(1.15, (rowCenter - center) / center));
          const depth = Math.min(1, Math.abs(distance));
          row.style.transform = `translate3d(0,0,${-depth * 82}px) rotateX(${-distance * 18}deg) scaleX(${1 - depth * 0.075})`;
          row.style.opacity = String(0.58 + (1 - depth) * 0.42);
        });
      }
      last = now;
      frame = requestAnimationFrame(render);
    };
    updateTarget();
    window.addEventListener("scroll", updateTarget, { passive: true });
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateTarget);
    };
  }, [phraseStage]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const snapTo = (top: number) => {
      wheelSnapLockedRef.current = true;
      window.scrollTo({ top, left: 0, behavior: "smooth" });
      later(() => {
        wheelSnapLockedRef.current = false;
      }, 760);
    };

    const previousViewportTop = (section: HTMLElement) => (
      section.offsetTop + Math.max(0, section.offsetHeight - window.innerHeight)
    );

    const onWheel = (event: WheelEvent) => {
      if (
        isLocalScrollSurfaceEvent(event)
        || window.innerWidth <= 820
        || reducedMotion.matches
        || Math.abs(event.deltaY) < 18
        || Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) return;

      if (wheelSnapLockedRef.current) {
        event.preventDefault();
        return;
      }

      if (event.deltaY < 0) {
        const pairs: Array<[HTMLElement | null, HTMLElement | null]> = [
          [phraseRef.current, heroRef.current],
          [articlesRef.current, phraseRef.current],
          [finalRef.current, articlesRef.current],
        ];
        for (const [section, previous] of pairs) {
          if (!section || !previous) continue;
          const distanceFromStart = window.scrollY - section.offsetTop;
          if (distanceFromStart < -window.innerHeight * 0.08 || distanceFromStart > window.innerHeight * 0.14) continue;
          event.preventDefault();
          snapTo(previousViewportTop(previous));
          return;
        }
        return;
      }

      if (activeScene === "word" && heroUnlocked && phraseRef.current) {
        event.preventDefault();
        snapTo(phraseRef.current.offsetTop);
        return;
      }
      const pairs: Array<[HTMLElement | null, HTMLElement | null]> = [
        [phraseRef.current, articlesRef.current],
        [articlesRef.current, finalRef.current],
      ];
      for (const [section, next] of pairs) {
        if (!section || !next) continue;
        const travel = Math.max(1, section.offsetHeight - window.innerHeight);
        const progress = (window.scrollY - section.offsetTop) / travel;
        if (progress < 0.86 || progress > 1.08) continue;
        event.preventDefault();
        snapTo(next.offsetTop);
        break;
      }
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, [activeScene, heroUnlocked]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let pointerX = width * 0.5;
    let pointerY = height * 0.38;
    let smoothX = pointerX;
    let smoothY = pointerY;
    let targetScroll = window.scrollY;
    let smoothScroll = targetScroll;
    let lastEmit = 0;
    let frame = 0;
    const palette = ["0,122,255", "232,91,75", "0,158,143", "130,84,218", "226,151,32"];
    const particles: Array<{ letter: string; x: number; y: number; vx: number; vy: number; life: number; depth: number; spin: number; color: string }> = [];
    const ambient = Array.from({ length: 38 }, (_, index) => ({
      letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)),
      x: Math.random(), y: Math.random(), depth: 0.22 + Math.random() * 0.9,
      size: 11 + Math.random() * 24, drift: (Math.random() - 0.5) * 0.16,
      alpha: 0.055 + Math.random() * 0.115, phase: index * 0.71,
    }));
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const pointerMove = (event: PointerEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      document.documentElement.style.setProperty("--cr-mx", `${pointerX / width * 100}%`);
      document.documentElement.style.setProperty("--cr-my", `${pointerY / height * 100}%`);
      const now = performance.now();
      if (!reduced && now - lastEmit > 52) {
        lastEmit = now;
        particles.push({
          letter: String.fromCharCode(65 + Math.floor(Math.random() * 26)), x: pointerX, y: pointerY,
          vx: (Math.random() - 0.5) * 1.35, vy: -0.55 - Math.random() * 0.9,
          life: 1, depth: 0.68 + Math.random() * 1.25, spin: (Math.random() - 0.5) * 0.045,
          color: palette[Math.floor(Math.random() * palette.length)],
        });
      }
    };
    const onScroll = () => { targetScroll = window.scrollY; };
    const render = (now: number) => {
      smoothX += (pointerX - smoothX) * 0.075;
      smoothY += (pointerY - smoothY) * 0.075;
      smoothScroll += (targetScroll - smoothScroll) * 0.075;
      const px = smoothX / width - 0.5;
      const py = smoothY / height - 0.5;
      document.documentElement.style.setProperty("--cr-word-x1", `${px * -14}px`);
      document.documentElement.style.setProperty("--cr-word-y1", `${py * -8}px`);
      document.documentElement.style.setProperty("--cr-word-x2", `${px * 20}px`);
      document.documentElement.style.setProperty("--cr-word-y2", `${py * 13}px`);
      context.clearRect(0, 0, width, height);
      const ribbonPhase = smoothScroll * 0.0015 + now * 0.00008;
      const ribbonY = height * (0.52 + Math.sin(ribbonPhase) * 0.12);
      context.save();
      context.beginPath();
      context.moveTo(-100, ribbonY + height * 0.22);
      context.bezierCurveTo(width * 0.22, ribbonY - height * 0.38, width * 0.62, ribbonY + height * 0.34, width + 120, ribbonY - height * 0.2);
      context.lineCap = "round";
      context.strokeStyle = "rgba(214,108,93,.105)";
      context.lineWidth = Math.max(38, width * 0.052);
      context.stroke();
      context.beginPath();
      context.moveTo(-120, ribbonY + height * 0.18);
      context.bezierCurveTo(width * 0.28, ribbonY - height * 0.31, width * 0.57, ribbonY + height * 0.28, width + 140, ribbonY - height * 0.16);
      context.strokeStyle = "rgba(40,104,173,.12)";
      context.lineWidth = Math.max(6, width * 0.008);
      context.stroke();
      ["word", "phrase", "context", "meaning", "read", "understand"].forEach((word, index, all) => {
        const t = (index / all.length + smoothScroll * 0.000055) % 1;
        const x = -80 + t * (width + 160);
        const y = ribbonY + Math.sin(t * Math.PI * 2.4 + ribbonPhase) * height * 0.12;
        context.save();
        context.translate(x, y);
        context.rotate(Math.cos(t * Math.PI * 2.4 + ribbonPhase) * 0.14);
        context.fillStyle = index % 2 ? "rgba(40,104,173,.18)" : "rgba(214,108,93,.16)";
        context.font = `${Math.max(12, width * 0.012)}px Georgia`;
        context.fillText(word, 0, 0);
        context.restore();
      });
      context.restore();
      ambient.forEach((item) => {
        const parallaxX = (smoothX / width - 0.5) * 48 * item.depth;
        const parallaxY = (smoothY / height - 0.5) * 34 * item.depth;
        const y = ((item.y * height + smoothScroll * item.drift) % (height + 120)) - 60;
        context.save();
        context.translate(item.x * width + parallaxX, y + parallaxY);
        context.rotate(Math.sin(now * 0.00025 + item.phase) * 0.08);
        context.fillStyle = `rgba(40,104,173,${item.alpha})`;
        context.font = `${Math.round(item.size * item.depth)}px Georgia`;
        context.filter = item.depth < 0.55 ? "blur(1.8px)" : "none";
        context.fillText(item.letter, 0, 0);
        context.restore();
      });
      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const item = particles[index];
        item.x += item.vx; item.y += item.vy; item.life -= 0.014;
        context.save();
        context.translate(item.x, item.y);
        context.rotate((1 - item.life) * item.spin * 30);
        context.filter = item.depth < 0.8 ? "blur(.75px)" : "none";
        context.shadowColor = `rgba(${item.color},.32)`;
        context.shadowBlur = 7;
        context.fillStyle = `rgba(${item.color},${Math.max(0, item.life) * 0.94})`;
        context.font = `600 ${19 * item.depth}px Georgia`;
        context.fillText(item.letter, 0, 0);
        context.restore();
        if (item.life <= 0) particles.splice(index, 1);
      }
      frame = requestAnimationFrame(render);
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", pointerMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  function unlockPage() {
    setHeroUnlocked(true);
    document.body.classList.remove("cr-home-locked");
  }

  function streamHint() {
    const text = heroHintText;
    let index = 0;
    setHeroHint("");
    setHeroHintStreaming(true);
    hintStreamRef.current = window.setInterval(() => {
      index += 1;
      setHeroHint(text.slice(0, index));
      if (index >= text.length && hintStreamRef.current !== null) {
        window.clearInterval(hintStreamRef.current);
        hintStreamRef.current = null;
        setHeroHintStreaming(false);
        unlockPage();
      }
    }, 48);
  }

  function streamMeaning(clean: string, firstInteraction: boolean) {
    if (heroStreamRef.current !== null) window.clearInterval(heroStreamRef.current);
    const meaning = heroMeanings[clean] || "结合当前句子理解它在这里承担的含义";
    let index = 0;
    setHeroMeaning("");
    setHeroMeaningStreaming(true);
    heroStreamRef.current = window.setInterval(() => {
      index += 1;
      setHeroMeaning(meaning.slice(0, index));
      if (index >= meaning.length && heroStreamRef.current !== null) {
        window.clearInterval(heroStreamRef.current);
        heroStreamRef.current = null;
        setHeroMeaningStreaming(false);
        if (firstInteraction) later(streamHint, 480);
      }
    }, 30);
  }

  function chooseWord(raw: string) {
    const clean = raw.replace(/[^A-Za-z]/g, "");
    if (!heroUnlocked && (!guideReady || clean !== "travels" || guidePressed)) return;
    setActiveWord(clean);
    if (!heroUnlocked) {
      setGuidePressed(true);
      later(() => {
        setCursorVisible(false);
        streamMeaning(clean, true);
      }, 240);
      return;
    }
    streamMeaning(clean, false);
  }

  function goTo(id: "word" | "articles" | "final") {
    if (!heroUnlocked) unlockPage();
    document.body.classList.remove("cr-home-locked");
    const target = ({ word: heroRef, articles: articlesRef, final: finalRef } as const)[id].current;
    setActiveScene(id);
    if (target) window.scrollTo({ top: target.offsetTop, left: 0, behavior: "auto" });
  }

  function runWithTransition(event: ReactMouseEvent<HTMLButtonElement>, action: () => void | Promise<void>) {
    if (transition) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      void action();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    setTransition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, phase: "show" });
    later(() => {
      const finish = () => {
        later(() => setTransition((current) => current ? { ...current, phase: "out" } : null), 280);
        later(() => setTransition(null), 950);
      };
      try {
        Promise.resolve(action()).then(finish, finish);
      } catch {
        finish();
      }
    }, 620);
  }

  function startReading(event: ReactMouseEvent<HTMLButtonElement>) {
    const value = inputMode === "url" ? props.articleUrl : props.article;
    if (!value.trim() || props.importingUrl) return;
    runWithTransition(event, inputMode === "url" ? props.onImportUrl : props.onStartReading);
  }

  const compactInput = (
    <div className="cr-compact-entry">
      <div className="cr-entry-modes">
        <button type="button" className={inputMode === "paste" ? "is-active" : ""} onClick={() => setInputMode("paste")}>粘贴文章</button>
        <button type="button" className={inputMode === "url" ? "is-active" : ""} onClick={() => setInputMode("url")}>输入网址</button>
      </div>
      {inputMode === "url" ? (
        <div className="cr-compact-field">
          <input value={props.articleUrl} onChange={(event) => props.onArticleUrlChange(event.target.value)} placeholder="输入公开文章网址" />
        </div>
      ) : (
        <div className={`cr-compact-field ${props.article.trim().length > 80 ? "has-preview" : ""}`}>
          <input value={props.article} onChange={(event) => props.onArticleChange(event.target.value)} placeholder="粘贴一篇你想读的英文文章" />
          {props.article.trim().length > 80 && <div className="cr-input-preview" role="tooltip">{props.article}</div>}
        </div>
      )}
      <button
        className="cr-primary cr-magnetic"
        type="button"
        onClick={startReading}
        disabled={props.importingUrl}
      >
        <RollingLabel>{props.importingUrl ? "正在导入" : "开始阅读"}</RollingLabel>
      </button>
    </div>
  );

  const words = sceneWords[activeScene];

  return (
    <main className={`cr-home ${ready ? "is-ready" : "is-loading"} ${props.demoCompleted ? "is-completed" : ""}`} data-scene={activeScene}>
      <canvas ref={canvasRef} className="cr-world" aria-hidden="true" />
      <div className="cr-wash" aria-hidden="true" />
      <div className={`cr-ambient-words ${sceneChanging ? "is-changing" : ""}`} aria-hidden="true">
        <span>{words[0]}</span><span>{words[1]}</span>
      </div>
      {!props.demoCompleted && <div className="cr-loader" aria-hidden="true" style={{ "--load": `${loadPercent}%` } as CSSProperties}>
        <div className="cr-loader-top"><span>Context Reader</span><span>{String(loadPercent).padStart(3, "0")} / 100</span></div>
        <div className="cr-loader-title"><span><i>Read the word.</i></span><span><i>Keep the context.</i></span></div>
        <div className="cr-loader-foot"><span className="cr-loader-progress"><i /></span><span>Preparing the reading space</span></div>
      </div>}
      {transition && (
        <div className={`cr-page-transition ${transition.phase}`} style={{ "--tx": `${transition.x}px`, "--ty": `${transition.y}px` } as CSSProperties} role="status" aria-live="polite">
          <div className="cr-page-transition-status">
            <div className="cr-page-transition-top"><span>Context Reader</span><span>Opening article</span></div>
            <div className="cr-page-transition-title" aria-hidden="true">
              <span><i>Read the article.</i></span>
              <span><i>Keep the context.</i></span>
            </div>
            <div className="cr-page-transition-foot">
              <i className="cr-page-transition-ring" aria-hidden="true">
                <svg viewBox="0 0 52 52"><circle className="cr-page-transition-track" cx="26" cy="26" r="22" /><circle className="cr-page-transition-buffer" cx="26" cy="26" r="22" /></svg>
              </i>
              <span>Preparing the reading space</span>
            </div>
          </div>
        </div>
      )}

      <header className="cr-nav">
        <button type="button" className="cr-brand" onClick={() => goTo("word")}>Context Reader</button>
        <span className="cr-chapter-count">{({ word: "01", phrase: "02", articles: "03", final: "04" } as const)[activeScene]} / 04</span>
        <nav aria-label="首页导航">
          <button className="cr-nav-skip" type="button" onClick={() => goTo("final")}><RollingLabel>跳过演示</RollingLabel></button>
          <button type="button" onClick={() => goTo("articles")}><RollingLabel>推荐文章</RollingLabel></button>
          <Link className="cr-nav-guide" href="/guide"><RollingLabel>使用说明</RollingLabel></Link>
          <SavedArticlesMenu articles={props.savedArticles} onOpen={props.onOpenSavedArticle} onDelete={props.onDeleteSavedArticle} />
          <button className="cr-nav-primary cr-vocabulary-trigger" type="button" onClick={props.onOpenVocabulary}><RollingLabel>{`打开生词本${props.vocabularyCount ? ` · ${props.vocabularyCount}` : ""}`}</RollingLabel></button>
          <AccountNav />
        </nav>
      </header>

      <section ref={heroRef} className={`cr-hero ${activeScene === "word" ? "is-active" : ""}`} aria-labelledby="cr-hero-sentence">
        <div className="cr-hero-entry">{compactInput}</div>
        <div ref={heroContentRef} className="cr-hero-content">
          <p className="cr-translation">一个词很少孤立出现；它承载什么含义，由语境决定。</p>
          <h1 id="cr-hero-sentence" className="cr-sentence">
            {heroSentence.split(" ").map((word, index) => {
              const clean = word.replace(/[^A-Za-z]/g, "");
              return (
                <button
                  ref={clean === "travels" ? travelsRef : undefined}
                  key={`${word}-${index}`}
                  type="button"
                  style={{ "--word-index": index } as CSSProperties}
                  className={`${activeWord === clean ? "is-active" : ""} ${clean === "travels" && guideReady && !heroUnlocked ? "is-guided" : ""} ${clean === "travels" && guidePressed ? "is-pressed" : ""}`}
                  onClick={() => chooseWord(word)}
                >{word}</button>
              );
            })}
          </h1>
          {cursorVisible && <span className={`cr-hero-cursor ${guideReady ? "is-arriving" : ""} ${guideReady && !guidePressed ? "is-waiting" : ""} ${guidePressed ? "is-pressing" : ""}`} style={{ left: cursorPosition.left, top: cursorPosition.top }} aria-hidden="true" />}
          {guideReady && !heroUnlocked && <p className="cr-click-guide">尝试点击一下</p>}
          <p className={`cr-word-meaning ${heroMeaningStreaming ? "is-streaming" : ""}`} aria-live="polite">{heroMeaning}</p>
          {heroHint !== "" && <p className={`cr-hero-hint ${heroHintStreaming ? "is-streaming" : ""}`}>{heroHint}</p>}
        </div>
        <div className="cr-section-handoff" aria-hidden="true"><span>PHRASE</span></div>
      </section>

      <section ref={phraseRef} className={`cr-phrase-section stage-${phraseStage} ${activeScene === "phrase" ? "is-active" : ""}`}>
        <div className="cr-sticky cr-phrase-layout">
          <h2><span>不止一个词，</span><span>也划过一段表达</span></h2>
          <div className="cr-phrase-wall">
            <div className="cr-demo-row">
              <p>
                The report{" "}
                <span className="cr-demo-unit">
                  <span className={`cr-demo-target ${phraseStage >= 2 ? "is-selecting" : ""} ${phraseStage >= 3 ? "is-selected" : ""}`}>stopped short of</span>
                  <span className={`cr-demo-meaning ${phraseStage === 3 && demoMeaning.length < 19 ? "is-streaming" : ""}`}>{demoMeaning}</span>
                  {phraseStage === 2 && <span className="cr-demo-cursor" aria-hidden="true" />}
                </span>{" "}
                calling the plan a failure.
              </p>
            </div>
            <p className={`cr-phrase-instruction ${phraseStage === 3 && phraseInstruction ? "is-streaming" : ""}`}>{phraseInstruction}</p>
            <div className={`cr-phrase-list-wrap ${phraseStage >= 4 ? "is-ready" : ""}`}>
              <div ref={phraseBrowserRef} className="cr-phrase-list">
                <div ref={phraseTrackRef} className="cr-phrase-track">
                  {phraseRows.map(([before, phrase, after, meaning]) => (
                    <div className="cr-practice-row" key={phrase}><p>{before} <PhraseTarget phrase={phrase} meaning={meaning} /> {after}</p></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="cr-section-handoff" aria-hidden="true"><span>READ</span></div>
      </section>

      <section ref={articlesRef} className={`cr-articles-section ${activeScene === "articles" ? "is-active" : ""}`}>
        <div className="cr-sticky cr-articles-inner">
          <div className="cr-articles-head">
            <h2>推荐阅读</h2>
            <p>从一篇整理好的英文文章开始，直接进入语境阅读。</p>
          </div>
          <div className="cr-article-list">
            {props.publicArticles.length ? props.publicArticles.slice(0, 5).map((item, index) => (
              <button
                style={{ "--row-index": index } as CSSProperties}
                type="button"
                key={item.id}
                onPointerEnter={() => props.onPrefetchPublicArticle(item.id)}
                onFocus={() => props.onPrefetchPublicArticle(item.id)}
                onClick={(event) => runWithTransition(event, () => props.onOpenPublicArticle(item.id))}
                disabled={Boolean(props.openingPublicArticleId)}
              >
                <small>{String(index + 1).padStart(2, "0")}</small><span><strong>{item.title}</strong><em>{props.openingPublicArticleId === item.id ? "正在打开…" : item.summary}</em></span><Arrow />
              </button>
            )) : <p className="cr-empty">暂时没有推荐文章，可以带一篇自己的文章开始阅读。</p>}
          </div>
        </div>
        <div className="cr-section-handoff" aria-hidden="true"><span>YOUR TEXT</span></div>
      </section>

      <section ref={finalRef} className={`cr-final-section ${activeScene === "final" ? "is-active" : ""}`}>
        <div className="cr-final-inner">
          <h2>带一篇文章开始阅读</h2>
          <div className="cr-final-tabs">
            {(["paste", "url"] as InputMode[]).map((mode) => <button type="button" key={mode} className={inputMode === mode ? "is-active" : ""} onClick={() => setInputMode(mode)}>{mode === "paste" ? "粘贴文章" : "输入网址"}</button>)}
          </div>
          {inputMode === "paste" && <textarea value={props.article} onChange={(event) => props.onArticleChange(event.target.value)} placeholder="粘贴英文文章内容" />}
          {inputMode === "url" && <input className="cr-final-input" value={props.articleUrl} onChange={(event) => props.onArticleUrlChange(event.target.value)} placeholder="https://example.com/article" />}
          <button
            className="cr-primary cr-final-start"
            type="button"
            onClick={startReading}
            disabled={props.importingUrl}
          >
            {inputMode === "url" && props.importingUrl ? "正在导入…" : "开始阅读"}
          </button>
          <p className="cr-error" role="alert">{inputMode === "url" ? props.urlError : props.error}</p>
        </div>
      </section>
    </main>
  );
}
