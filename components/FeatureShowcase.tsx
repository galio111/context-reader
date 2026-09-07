"use client";

import { useEffect, useRef, useState, type RefObject, type CSSProperties } from "react";
import styles from "./FeatureShowcase.module.css";

// Replace these optional sources with reviewed, silent recordings after layout acceptance.
export const FEATURE_SHOWCASE = [
  { id: "publications", label: "发现外刊", detail: "兴趣 × 难度", title: ["世界很大，", "从你想读的开始。"], paragraphs: ["科技的新发现，文化的新视角，商业与生活的另一面。让真实外刊成为你的日常读物。", "选好兴趣与阅读难度，找到既想读、又读得下去的内容。"], color: "#dce9f6", screens: [{ label: "外刊与个性化推荐", src: "" }] },
  { id: "context", label: "语境查词", detail: "单词 · 短语", title: ["划过不懂的，", "接着读下去。"], paragraphs: ["一个单词，一段短语，随手选中，就在原文旁理解它此刻的意思。", "从语境释义到用法、搭配与例句，把这一次读懂，变成下一次会用。"], color: "#dcece5", screens: [{ label: "划词与划短语演示", src: "" }] },
  { id: "import", label: "带来文章", detail: "粘贴 · 网址", title: ["想读的那篇，", "直接带进来。"], paragraphs: ["复制一段正文，或贴上文章链接。两种入口，都通向专注的阅读界面。", "收藏夹里没读完的长文，从这里继续。"], color: "#f3e8ca", screens: [{ label: "粘贴文章", src: "" }, { label: "输入网址", src: "" }] },
  { id: "vocabulary", label: "记住新词", detail: "生词本 × Anki", title: ["在文章里遇见，", "在复习中记住。"], paragraphs: ["把值得记住的词收入生词本，连同原句和语境释义一起留下。", "再带进 Anki 持续复习，让阅读、积累与记忆连成一个完整的过程。"], color: "#e6e0f2", screens: [{ label: "生词本与 Anki 协作", src: "" }] },
  { id: "explore", label: "继续探索", detail: "还有更多", title: ["读进去之后，", "还有更多发现。"], paragraphs: ["全文翻译、文章摘要、独立词典，还有为下一次阅读保存的进度。", "更多顺手的小功能，等你在阅读中发现。"], color: "#e3eaf0", screens: [] },
] as const;

function Recording({ src, label, playing }: { src: string; label: string; playing: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element || !src) return;
    if (playing) { void element.play().then(() => setBlocked(false)).catch(() => setBlocked(true)); }
    else element.pause();
  }, [playing, src]);
  return <div className={styles.recording}>
    <div className={styles.windowBar}><span aria-hidden="true">● ● ●</span><span>{label}</span></div>
    {src && !failed ? <>
      <video ref={video} src={src} muted loop playsInline preload="metadata" onError={() => setFailed(true)} aria-label={label} />
      {blocked && <button className={styles.play} onClick={() => { void video.current?.play().then(() => setBlocked(false)).catch(() => {}); }}>播放演示</button>}
    </> : <div className={styles.placeholder}><span className={styles.frameCorners} aria-hidden="true" /><span className={styles.placeholderIcon} aria-hidden="true">▷</span><strong>{label}</strong><span>{failed ? "演示暂时无法播放" : "录屏预留画面"}</span></div>}
  </div>;
}

export function FeatureShowcase({ sectionRef, onGuide, motionEnabled }: { sectionRef: RefObject<HTMLElement | null>; onGuide: () => void; motionEnabled: boolean }) {
  const [active, setActive] = useState(0);
  const [replay, setReplay] = useState(0);
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const feature = FEATURE_SHOWCASE[active];
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const updateVisibility = () => setVisible(section.getBoundingClientRect().bottom > 0 && section.getBoundingClientRect().top < window.innerHeight && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting && !document.hidden), { threshold: 0 });
    observer.observe(section);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", updateVisibility); };
  }, [sectionRef]);
  function select(index: number, focus = false) {
    const next = (index + FEATURE_SHOWCASE.length) % FEATURE_SHOWCASE.length;
    setActive(next); setReplay(value => value + 1); setPaused(false);
    const tab = tabs.current[next];
    // Scroll only the horizontal strip, never the page during module selection.
    if (tab?.parentElement) tab.parentElement.scrollTo({ left: tab.offsetLeft - tab.parentElement.offsetLeft - (tab.parentElement.clientWidth - tab.clientWidth) / 2, behavior: "smooth" });
    if (focus) tab?.focus({ preventScroll: true });
  }
  return <section ref={sectionRef} className={styles.showcase} aria-label="功能展示" data-motion={motionEnabled} data-playing={visible && !paused}>
    <div className={styles.inner}>
      <div id="feature-showcase-panel" role="tabpanel" aria-labelledby={`feature-tab-${feature.id}`} className={styles.presentation}>
        <div className={styles.copy} key={`copy-${active}-${replay}`}>
          <h2>{feature.title.map(line => <span key={line}>{line}</span>)}</h2>
          {feature.paragraphs.map(text => <p key={text}>{text}</p>)}
          <button type="button" className={styles.next} onClick={() => select(active + 1)}>下一个 <span aria-hidden="true">↗</span></button>
        </div>
        <div key={`media-${active}-${replay}`} className={`${styles.media} ${feature.id === "import" ? styles.dual : ""}`}>
          {feature.id === "explore" ? <div className={styles.finale}>
            <div className={styles.windowBar}><span aria-hidden="true">● ● ●</span><span>Context Reader</span></div>
            <div className={styles.finaleCanvas}><span>读懂，只是开始。</span><strong><i>更多</i><i>可能，</i><i>等你发现。</i></strong><div className={styles.words}><span>全文翻译</span><span>文章摘要</span><span>独立词典</span><span>继续阅读</span></div><b aria-hidden="true">↗</b></div>
          </div> : feature.screens.map(screen => <Recording key={screen.label} src={screen.src} label={screen.label} playing={visible && !paused} />)}
        </div>
      </div>
      <div className={styles.navigation}>
        <div className={styles.tabs} role="tablist" aria-label="选择功能演示" data-local-scroll-surface>
          {FEATURE_SHOWCASE.map((item, index) => <button type="button" key={item.id} ref={element => { tabs.current[index] = element; }} id={`feature-tab-${item.id}`} role="tab" aria-selected={index === active} aria-controls="feature-showcase-panel" tabIndex={index === active ? 0 : -1} style={{ "--tile": item.color } as CSSProperties} onClick={() => select(index)} onKeyDown={event => { const target = event.key === "ArrowRight" ? active + 1 : event.key === "ArrowLeft" ? active - 1 : event.key === "Home" ? 0 : event.key === "End" ? FEATURE_SHOWCASE.length - 1 : null; if (target !== null) { event.preventDefault(); select(target, true); } }}>
            <span><strong>{item.label}</strong><small>{item.detail}</small></span><span className={styles.thumbnail} aria-hidden="true">{item.id === "import" ? "▥" : item.id === "explore" ? "↗" : "▷"}</span>
          </button>)}
        </div>
        <div className={styles.arrows}><button type="button" aria-label="上一个功能" onClick={() => select(active - 1)}>←</button><button type="button" aria-label="下一个功能" onClick={() => select(active + 1)}>→</button></div>
      </div>
      <div className={styles.footer}><button type="button" onClick={onGuide}>查看使用说明 ↗</button>{(feature.id === "explore" || feature.screens.some(screen => Boolean(screen.src))) && <button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? "继续播放" : "暂停播放"}</button>}</div>
    </div>
  </section>;
}
