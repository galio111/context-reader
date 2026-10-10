"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject, type CSSProperties } from "react";
import { ShowcaseRecording } from "./ShowcaseRecording";
import { GuideLanyard } from "./GuideLanyard";
import styles from "./FeatureShowcase.module.css";

// Reviewed silent recordings; remaining modules retain their placeholders.
export const FEATURE_SHOWCASE = [
  { id: "publications", label: "发现外刊", detail: "兴趣 × 难度", title: ["世界很大，", "从你想读的开始。"], paragraphs: ["科学的新发现，文化的新视角，商业与生活的另一面。让真实外刊成为你的日常读物。", "选好兴趣与阅读难度，找到既想读、又读得下去的内容。"], color: "#dce9f6", screens: [{ label: "外刊与个性化推荐", src: "/showcase/publications-v3.mp4" }] },
  { id: "context", label: "语境查词", detail: "单词 · 短语", title: ["划过不懂的，", "接着读下去。"], paragraphs: ["一个单词，一段短语，随手选中，就在原文旁理解它此刻的意思。", "从语境释义到用法、搭配与例句，把这一次读懂，变成下一次会用。"], color: "#dcece5", screens: [{ label: "划词与划短语演示", src: "" }] },
  { id: "import", label: "带来文章", detail: "粘贴 · 网址", title: ["想读的那篇，", "直接带进来。"], paragraphs: ["复制一段正文，或贴上文章链接。两种入口，都通向专注的阅读界面。", "收藏夹里没读完的长文，从这里继续。"], color: "#f3e8ca", screens: [{ label: "粘贴正文与网址导入", src: "" }] },
  { id: "vocabulary", label: "记住新词", detail: "生词本与复习", title: ["在文章里遇见，", "在复习中记住。"], paragraphs: ["把值得记住的词收入生词本，连同原句和语境释义一起留下。", "直接在本站复习，再回到文章里使用。"], color: "#e6e0f2", screens: [{ label: "收藏与背词", src: "" }] },
  { id: "explore", label: "继续探索", detail: "还有更多", title: ["读进去之后，", "还有更多发现。"], paragraphs: ["全文翻译、文章摘要、独立词典，还有为下一次阅读保存的进度。", "更多顺手的小功能，等你在阅读中发现。"], color: "#e3eaf0", screens: [] },
] as const;

export function FeatureShowcase({ sectionRef, onGuide, motionEnabled, guideOpen = false, enabled = true, prepareEnabled = true }: { sectionRef: RefObject<HTMLElement | null>; onGuide: () => void; motionEnabled: boolean; guideOpen?: boolean; enabled?: boolean; prepareEnabled?: boolean }) {
  const [active, setActive] = useState(0);
  const [replay, setReplay] = useState(0);
  const [visible, setVisible] = useState(false);
  const [warm, setWarm] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recordingBuffered, setRecordingBuffered] = useState(false);
  const mediaRef = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectionScrollY = useRef<number | null>(null);
  const feature = FEATURE_SHOWCASE[active];
  useEffect(() => {
    const section = mediaRef.current;
    if (!section) return;
    if (!enabled) { setVisible(false); return; }
    const updateVisibility = () => setVisible(section.getBoundingClientRect().bottom > 0 && section.getBoundingClientRect().top < window.innerHeight && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && !document.hidden), { threshold: 0 });
    observer.observe(section);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", updateVisibility); };
  }, [enabled]);
  // Resource preparation may overlap the retained opening; playback still waits
  // for enabled + visibility above. Only the current nearby recording is warmed.
  useEffect(() => {
    const section = mediaRef.current;
    if (!section || !prepareEnabled) return;
    const warmer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setWarm(true); warmer.disconnect(); }
    }, { rootMargin: `${Math.round(window.innerHeight * 1.5)}px 0px` });
    warmer.observe(section);
    return () => warmer.disconnect();
  }, [prepareEnabled]);
  useLayoutEffect(() => {
    const y = selectionScrollY.current;
    if (y === null) return;
    window.scrollTo({ top: y, left: 0, behavior: "auto" });
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: y, left: 0, behavior: "auto" });
      selectionScrollY.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, replay]);
  function select(index: number, focus = false) {
    const next = (index + FEATURE_SHOWCASE.length) % FEATURE_SHOWCASE.length;
    selectionScrollY.current = window.scrollY;
    setWarm(true); setActive(next); setReplay(value => value + 1); setPaused(false);
    const tab = tabs.current[next];
    // Scroll only the horizontal strip, never the page during module selection.
    if (tab?.parentElement) tab.parentElement.scrollTo({ left: tab.offsetLeft - tab.parentElement.offsetLeft - (tab.parentElement.clientWidth - tab.clientWidth) / 2, behavior: "smooth" });
    if (focus) tab?.focus({ preventScroll: true });
  }
  return <section ref={sectionRef} className={styles.showcase} aria-label="功能展示" data-feature={feature.id} data-motion={motionEnabled} data-playing={visible && !paused}>
    <div key={`ambience-${active}`} className={styles.ambience} aria-hidden="true" />
    <div className={styles.inner}>
      <div id="feature-showcase-panel" role="tabpanel" aria-labelledby={`feature-tab-${feature.id}`} className={styles.presentation}>
        {feature.id !== "explore" && <div className={styles.copy} key={`copy-${active}-${replay}`}>
          <h2>{feature.title.map(line => <span key={line}>{line}</span>)}</h2>
          {feature.paragraphs.map(text => <p key={text}>{text}</p>)}
          <button type="button" className={styles.next} onClick={() => select(active + 1)}>下一个 <span aria-hidden="true">↗</span></button>
        </div>}
        <div ref={mediaRef} className={styles.media} style={warm && feature.id === "publications" ? { "--poster": "url(/showcase/publications-v3.webp)" } as CSSProperties : undefined}>
          {feature.id === "explore" ? <div className={styles.finale}>
            <div className={styles.finaleCanvas} key={`finale-${replay}`}>
              <h2><i>更多</i><i>可能，</i><i>等你发现。</i></h2>
              <div className={styles.words}><span>全文翻译</span><span>文章摘要</span><span>独立词典</span><span>继续阅读</span></div>
              <p className={styles.dragHint}>拉一下吊牌，打开使用说明。</p>
              <button type="button" className={styles.mobileGuide} onClick={onGuide}>打开使用说明</button>
              <button type="button" className={styles.next} onClick={() => select(0)}>再看一遍 <span aria-hidden="true">↗</span></button>
            </div>
          </div> : feature.screens.map(screen => <ShowcaseRecording warm={warm} key={screen.label} src={screen.src} label={screen.label} playing={visible && !paused} onBuffered={() => setRecordingBuffered(true)} />)}
          <GuideLanyard active={feature.id === "explore"} preload={visible && (feature.id !== "publications" || recordingBuffered)} onOpen={onGuide} running={feature.id === "explore" && visible && !paused && !guideOpen} motionEnabled={motionEnabled} />
        </div>
      </div>
      <div className={styles.navigation}>
        <div className={styles.tabs} role="tablist" aria-label="选择功能演示" data-local-scroll-surface>
          {FEATURE_SHOWCASE.map((item, index) => <button type="button" key={item.id} ref={element => { tabs.current[index] = element; }} id={`feature-tab-${item.id}`} role="tab" aria-selected={index === active} aria-controls="feature-showcase-panel" tabIndex={index === active ? 0 : -1} style={{ "--tile": item.color } as CSSProperties} onClick={() => select(index)} onKeyDown={event => { const target = event.key === "ArrowRight" ? active + 1 : event.key === "ArrowLeft" ? active - 1 : event.key === "Home" ? 0 : event.key === "End" ? FEATURE_SHOWCASE.length - 1 : null; if (target !== null) { event.preventDefault(); select(target, true); } }}>
            <strong>{item.label}</strong><span className={styles.pillArrow} aria-hidden="true">↗</span>
          </button>)}
        </div>
        <div className={styles.arrows}><button type="button" aria-label="上一个功能" onClick={() => select(active - 1)}>←</button><button type="button" aria-label="下一个功能" onClick={() => select(active + 1)}>→</button></div>
      </div>
      <div className={styles.footer}>{(feature.id === "explore" || feature.screens.some(screen => Boolean(screen.src))) && <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "继续播放" : "暂停播放"}</button>}</div>
    </div>
  </section>;
}
