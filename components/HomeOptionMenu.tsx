"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { savedArticleOpenTimestamp } from "@/lib/savedArticleMerge";
import type { SavedArticle } from "@/types/article";
import styles from "./HomeOptionMenu.module.css";

interface HomeOptionMenuProps {
  open: boolean;
  isAdmin: boolean;
  savedArticles: SavedArticle[];
  onClose: () => void;
  onOpenVocabulary: () => void;
  onOpenFeedback: () => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
}

const savedArticleDateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function savedArticlePreview(article: SavedArticle): string {
  return article.summary?.trim() || article.body.trim().replace(/\s+/g, " ").slice(0, 96);
}

function formatSavedArticleDate(article: SavedArticle): string {
  const timestamp = savedArticleOpenTimestamp(article);
  return timestamp ? savedArticleDateFormatter.format(new Date(timestamp)) : "时间未知";
}

export function HomeOptionMenu({
  open,
  isAdmin,
  savedArticles,
  onClose,
  onOpenVocabulary,
  onOpenFeedback,
  onOpenSavedArticle,
}: HomeOptionMenuProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const savedCloseTimerRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(open);
  const [savedHovered, setSavedHovered] = useState(false);
  const [savedPinned, setSavedPinned] = useState(false);
  const items = useMemo(
    () => [
      "使用说明",
      "生词本",
      "保存文章",
      "账号与用量",
      "意见反馈",
      ...(isAdmin ? ["admin后台"] : []),
    ],
    [isAdmin],
  );
  const sortedSavedArticles = useMemo(
    () => [...savedArticles].sort(
      (left, right) => savedArticleOpenTimestamp(right) - savedArticleOpenTimestamp(left),
    ),
    [savedArticles],
  );
  const savedPreviewVisible = savedHovered || savedPinned;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    return () => {
      window.cancelAnimationFrame(focusFrame);
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [mounted]);

  useEffect(() => {
    if (open) return;
    setSavedHovered(false);
    setSavedPinned(false);
    if (mounted && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
    }
  }, [mounted, open]);

  useEffect(() => () => {
    if (savedCloseTimerRef.current !== null) window.clearTimeout(savedCloseTimerRef.current);
  }, []);

  if (!mounted || typeof document === "undefined") return null;

  function cancelSavedClose() {
    if (savedCloseTimerRef.current !== null) {
      window.clearTimeout(savedCloseTimerRef.current);
      savedCloseTimerRef.current = null;
    }
  }

  function closeSavedPreviewSoon() {
    cancelSavedClose();
    savedCloseTimerRef.current = window.setTimeout(() => setSavedHovered(false), 170);
  }

  function navigate(href: string) {
    onClose();
    router.push(href);
  }

  function activateItem(label: string) {
    if (label === "保存文章") {
      setSavedPinned((current) => !current);
      setSavedHovered(true);
      return;
    }
    setSavedPinned(false);
    if (label === "使用说明") navigate("/guide");
    else if (label === "生词本") {
      onClose();
      onOpenVocabulary();
    } else if (label === "账号与用量") navigate("/account/usage");
    else if (label === "意见反馈") {
      onClose();
      onOpenFeedback();
    } else if (label === "admin后台" && isAdmin) navigate("/admin");
  }

  function handleItemHover(index: number | null) {
    if (index === 2) {
      cancelSavedClose();
      setSavedHovered(true);
      return;
    }
    setSavedPinned(false);
    closeSavedPreviewSoon();
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
      ) ?? [],
    ).filter((element) => !element.hasAttribute("inert"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      data-open={open || undefined}
      data-local-scroll-surface
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <div className={styles.prelayers} aria-hidden="true">
        <div className={styles.prelayer} style={{ "--layer-color": "#87b8d2" } as CSSProperties} />
        <div className={styles.prelayer} style={{ "--layer-color": "#345f78" } as CSSProperties} />
      </div>

      <section
        id="home-option-menu"
        ref={dialogRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="home-option-menu-title"
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget && !open) setMounted(false);
        }}
      >
        <header className={styles.panelHeader}>
          <div>
            <span>Context Reader</span>
            <h2 id="home-option-menu-title">Menu</h2>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.close}
            type="button"
            aria-label="关闭菜单"
            onClick={onClose}
          >
            <span>Close</span>
            <i aria-hidden="true"><b /><b /></i>
          </button>
        </header>

        <div className={styles.panelInner}>
          <ul className={styles.menuList}>
            {items.map((label, index) => (
              <li className={styles.itemWrap} key={label}>
                <button
                  className={styles.menuItem}
                  type="button"
                  data-index={String(index + 1).padStart(2, "0")}
                  style={{
                    "--item-delay": `${.25 + index * .085}s`,
                    "--number-delay": `${.28 + index * .065}s`,
                  } as CSSProperties}
                  onPointerEnter={() => handleItemHover(index)}
                  onPointerLeave={index === 2 ? closeSavedPreviewSoon : undefined}
                  onFocus={() => handleItemHover(index)}
                  onBlur={index === 2 ? closeSavedPreviewSoon : undefined}
                  onClick={() => activateItem(label)}
                >
                  <span className={styles.itemLabel}>{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        className={`${styles.savedPreview} ${savedPreviewVisible ? styles.savedPreviewVisible : ""}`}
        aria-label="保存文章"
        aria-hidden={!savedPreviewVisible}
        inert={!savedPreviewVisible}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={() => {
          cancelSavedClose();
          setSavedHovered(true);
        }}
        onPointerLeave={closeSavedPreviewSoon}
      >
        <header className={styles.savedHeader}>
          <div>
            <h3>保存文章</h3>
            <p>按最近打开排序</p>
          </div>
          <span>{sortedSavedArticles.length} 篇</span>
        </header>
        {sortedSavedArticles.length ? (
          <div className={styles.savedList} data-local-scroll-surface>
            {sortedSavedArticles.map((article) => (
              <button
                className={styles.savedArticle}
                type="button"
                key={article.id}
                onClick={() => {
                  onClose();
                  onOpenSavedArticle(article);
                }}
              >
                <strong>{article.title || "未命名文章"}</strong>
                <span>{savedArticlePreview(article)}</span>
                <time>最近打开 {formatSavedArticleDate(article)}</time>
              </button>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>还没有保存文章。阅读时保存的内容会出现在这里。</p>
        )}
      </section>
    </div>,
    document.body,
  );
}
