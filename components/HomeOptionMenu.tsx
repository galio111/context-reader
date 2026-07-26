"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AccountUsagePageContent } from "@/components/AccountUsagePageContent";
import { GuidePageContent } from "@/components/GuidePageContent";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import { VocabularyLearningDetails } from "@/components/VocabularyLearningDetails";
import { describeApiFailure, describeCaughtRequestError } from "@/lib/clientErrorReporting";
import { normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import type { LocalAccountSession } from "@/lib/localAccountSession";
import { savedArticleOpenTimestamp } from "@/lib/savedArticleMerge";
import { sortVocabularyEntriesByCreatedAt } from "@/lib/vocabularyMerge";
import { createVocabularySearchIndex, searchVocabularyIndex } from "@/lib/vocabularySearch";
import type { AccountSessionState } from "@/types/account";
import type { SavedArticle } from "@/types/article";
import type { VocabularyEntry } from "@/types/vocabulary";
import styles from "./HomeOptionMenu.module.css";

interface HomeOptionMenuProps {
  open: boolean;
  isAdmin: boolean;
  account: AccountSessionState;
  isOffline: boolean;
  localAccount: LocalAccountSession | null;
  savedArticles: SavedArticle[];
  vocabularyEntries: VocabularyEntry[];
  onClose: () => void;
  onOpenSavedArticle: (article: SavedArticle) => void;
  onJumpToVocabularySource?: (entry: VocabularyEntry) => void;
  canJumpToVocabularySource?: (entry: VocabularyEntry) => boolean;
}

type PreviewKind = "guide" | "vocabulary" | "saved" | "account" | "feedback";
const PREVIEW_ANCHOR_MIN = 72;
const FEEDBACK_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FEEDBACK_IMAGES = 3;
const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;

const menuItems: Array<{ label: string; preview?: PreviewKind; adminOnly?: boolean }> = [
  { label: "使用说明", preview: "guide" },
  { label: "生词本", preview: "vocabulary" },
  { label: "保存文章", preview: "saved" },
  { label: "账号与用量", preview: "account" },
  { label: "意见反馈", preview: "feedback" },
  { label: "admin后台", adminOnly: true },
];

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
  account,
  isOffline,
  localAccount,
  savedArticles,
  vocabularyEntries,
  onClose,
  onOpenSavedArticle,
  onJumpToVocabularySource,
  canJumpToVocabularySource,
}: HomeOptionMenuProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const vocabularyListRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [hoveredPreview, setHoveredPreview] = useState<PreviewKind | null>(null);
  const [hoveredVocabularyId, setHoveredVocabularyId] = useState<string | null>(null);
  const [vocabularySearchQuery, setVocabularySearchQuery] = useState("");
  const [pinnedPreview, setPinnedPreview] = useState<PreviewKind | null>(null);
  const [previewAnchorY, setPreviewAnchorY] = useState<number | null>(null);
  const items = useMemo(
    () => menuItems.filter((item) => !item.adminOnly || isAdmin),
    [isAdmin],
  );
  const sortedSavedArticles = useMemo(
    () => [...savedArticles].sort(
      (left, right) => savedArticleOpenTimestamp(right) - savedArticleOpenTimestamp(left),
    ),
    [savedArticles],
  );
  const orderedVocabularyEntries = useMemo(
    () => sortVocabularyEntriesByCreatedAt(vocabularyEntries),
    [vocabularyEntries],
  );
  const deferredVocabularySearch = useDeferredValue(vocabularySearchQuery);
  const vocabularySearchIndex = useMemo(
    () => createVocabularySearchIndex(orderedVocabularyEntries),
    [orderedVocabularyEntries],
  );
  const filteredVocabularyEntries = useMemo(
    () => searchVocabularyIndex(vocabularySearchIndex, deferredVocabularySearch),
    [deferredVocabularySearch, vocabularySearchIndex],
  );
  const filteredVocabularyIds = useMemo(
    () => new Set(filteredVocabularyEntries.map((entry) => entry.id)),
    [filteredVocabularyEntries],
  );
  const getVocabularyEntryKey = useCallback(
    (index: number) => filteredVocabularyEntries[index]?.id ?? index,
    [filteredVocabularyEntries],
  );
  const vocabularyVirtualizer = useVirtualizer({
    count: filteredVocabularyEntries.length,
    getScrollElement: () => vocabularyListRef.current,
    estimateSize: () => 118,
    getItemKey: getVocabularyEntryKey,
    gap: 0,
    overscan: 4,
  });
  const vocabularyEntriesById = useMemo(
    () => new Map(orderedVocabularyEntries.map((entry) => [entry.id, entry])),
    [orderedVocabularyEntries],
  );
  const hoveredVocabularyEntry = useMemo(
    () => hoveredVocabularyId ? vocabularyEntriesById.get(hoveredVocabularyId) ?? null : null,
    [hoveredVocabularyId, vocabularyEntriesById],
  );
  const visiblePreview = hoveredPreview ?? pinnedPreview;

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
    setHoveredPreview(null);
    setHoveredVocabularyId(null);
    setVocabularySearchQuery("");
    setPinnedPreview(null);
    setPreviewAnchorY(null);
    if (mounted && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
    }
  }, [mounted, open]);

  useEffect(() => {
    if (visiblePreview !== "vocabulary") {
      setHoveredVocabularyId(null);
      setVocabularySearchQuery("");
      return;
    }
    vocabularyVirtualizer.scrollToOffset(0);
  }, [visiblePreview, vocabularyVirtualizer]);

  useEffect(() => {
    if (visiblePreview === "vocabulary") vocabularyVirtualizer.scrollToOffset(0);
  }, [deferredVocabularySearch, filteredVocabularyEntries.length, visiblePreview, vocabularyVirtualizer]);

  useEffect(() => {
    if (hoveredVocabularyId && !filteredVocabularyIds.has(hoveredVocabularyId)) {
      setHoveredVocabularyId(null);
    }
  }, [filteredVocabularyIds, hoveredVocabularyId]);

  if (!mounted || typeof document === "undefined") return null;

  function navigate(href: string) {
    onClose();
    router.push(href);
  }

  function anchorPreview(trigger: HTMLElement) {
    const rect = trigger.getBoundingClientRect();
    setPreviewAnchorY(Math.max(PREVIEW_ANCHOR_MIN, rect.top));
  }

  function activateItem(item: (typeof items)[number], trigger: HTMLButtonElement) {
    if (item.preview) {
      const preview = item.preview;
      anchorPreview(trigger);
      setHoveredPreview(preview);
      setPinnedPreview((current) => current === preview ? null : preview);
      return;
    }
    setPinnedPreview(null);
    if (item.adminOnly && isAdmin) navigate("/admin");
  }

  function handleItemHover(item: (typeof items)[number], event: PointerEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) {
    if ("pointerType" in event && event.pointerType !== "mouse") return;
    if (!item.preview) {
      setPinnedPreview(null);
      setHoveredPreview(null);
      return;
    }
    anchorPreview(event.currentTarget);
    setPinnedPreview(null);
    setHoveredPreview(item.preview);
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
            {items.map((item, index) => (
              <li className={styles.itemWrap} key={item.label}>
                <button
                  className={styles.menuItem}
                  type="button"
                  data-index={String(index + 1).padStart(2, "0")}
                  style={{
                    "--item-delay": `${.25 + index * .085}s`,
                    "--number-delay": `${.28 + index * .065}s`,
                  } as CSSProperties}
                  onPointerEnter={(event) => handleItemHover(item, event)}
                  onFocus={(event) => handleItemHover(item, event)}
                  onClick={(event) => activateItem(item, event.currentTarget)}
                  aria-haspopup={item.preview ? "true" : undefined}
                  aria-expanded={item.preview ? visiblePreview === item.preview : undefined}
                >
                  <span className={styles.itemLabel}>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <footer className={styles.accountIdentity}>
          <span>{isOffline ? "离线身份" : account.authenticated ? "当前账号" : "账号状态"}</span>
          <strong>
            {isOffline
              ? (localAccount?.nickname || (localAccount ? "上次登录账号" : "未确认账号"))
              : account.authenticated
                ? (account.profile?.nickname || "已登录")
                : "未登录"}
          </strong>
        </footer>
      </section>

      {visiblePreview && (
        <button
          className={styles.mobilePreviewBack}
          type="button"
          onClick={() => {
            if (hoveredVocabularyId) {
              setHoveredVocabularyId(null);
              return;
            }
            setHoveredPreview(null);
            setPinnedPreview(null);
          }}
        >
          {hoveredVocabularyId ? "返回生词列表" : "返回菜单"}
        </button>
      )}

      <MenuPreview
        kind="guide"
        visiblePreview={visiblePreview}
        previewAnchorY={previewAnchorY}
        title="使用说明"
        subtitle="完整使用说明"
      >
        <div className={styles.pageContent} data-local-scroll-surface>
          <GuidePageContent embedded />
        </div>
      </MenuPreview>

      <section
        className={`${styles.savedPreview} ${orderedVocabularyEntries.length ? "" : styles.previewCompact} ${visiblePreview === "vocabulary" ? styles.savedPreviewVisible : ""}`}
        style={{ "--preview-anchor-y": `${previewAnchorY ?? window.innerHeight / 2}px` } as CSSProperties}
        aria-label="生词本"
        aria-hidden={visiblePreview !== "vocabulary"}
        inert={visiblePreview !== "vocabulary"}
        data-home-menu-preview
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className={styles.savedHeader}>
          <div>
            <h3>生词本</h3>
            <p>最近收录的词语与语境</p>
          </div>
          <span>{vocabularyEntries.length} 条</span>
        </header>
        {orderedVocabularyEntries.length ? (
          <>
            <label className={styles.vocabularySearch}>
              <span className={styles.srOnly}>检索生词本</span>
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.4" cy="8.4" r="5.4" />
                <path d="m12.4 12.4 4 4" />
              </svg>
              <input
                type="search"
                value={vocabularySearchQuery}
                placeholder="输入词头检索"
                onChange={(event) => setVocabularySearchQuery(event.target.value)}
              />
              {vocabularySearchQuery && (
                <button type="button" onClick={() => setVocabularySearchQuery("")} aria-label="清空检索">×</button>
              )}
            </label>
            {filteredVocabularyEntries.length ? (
              <div
                ref={vocabularyListRef}
                className={styles.savedList}
                data-local-scroll-surface
                data-scrolling={vocabularyVirtualizer.isScrolling || undefined}
              >
                <div className={styles.virtualVocabularyList} style={{ height: vocabularyVirtualizer.getTotalSize() }}>
                  {vocabularyVirtualizer.getVirtualItems().map((virtualRow) => {
                    const entry = filteredVocabularyEntries[virtualRow.index];
                    if (!entry) return null;
                    return (
                      <button
                        data-index={virtualRow.index}
                        className={`${styles.savedArticle} ${styles.vocabularyEntry}`}
                        type="button"
                        key={entry.id}
                        style={{
                          height: `${virtualRow.size}px`,
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        onPointerEnter={(event) => {
                          if (event.pointerType !== "mouse") return;
                          if (!vocabularyVirtualizer.isScrolling) setHoveredVocabularyId(entry.id);
                        }}
                        onFocus={() => setHoveredVocabularyId(entry.id)}
                        onClick={() => setHoveredVocabularyId(entry.id)}
                        aria-expanded={hoveredVocabularyId === entry.id}
                      >
                        <strong>{entry.word}</strong>
                        {(entry.phonetic || entry.partOfSpeech) && (
                          <small>{[entry.phonetic, normalizePartOfSpeechLabel(entry.partOfSpeech)].filter(Boolean).join(" · ")}</small>
                        )}
                        <span>{entry.contextMeaning || entry.basicMeaning || "暂无释义"}</span>
                        {entry.sourceSentence && <em>{entry.sourceSentence}</em>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className={styles.empty}>没有匹配的生词。</p>
            )}
          </>
        ) : (
          <p className={styles.empty}>还没有收录生词。阅读时加入的词语会出现在这里。</p>
        )}
      </section>

      <section
        className={`${styles.vocabularyDetail} ${visiblePreview === "vocabulary" && hoveredVocabularyEntry ? styles.vocabularyDetailVisible : ""}`}
        style={{ "--preview-anchor-y": `${previewAnchorY ?? PREVIEW_ANCHOR_MIN}px` } as CSSProperties}
        aria-label={hoveredVocabularyEntry ? `${hoveredVocabularyEntry.word} 的完整信息` : "生词详情"}
        aria-hidden={!hoveredVocabularyEntry}
        inert={!hoveredVocabularyEntry}
        data-home-menu-preview
        onPointerDown={(event) => event.stopPropagation()}
      >
        {hoveredVocabularyEntry && (
          <VocabularyHoverDetail
            entry={hoveredVocabularyEntry}
            canJumpToSource={canJumpToVocabularySource?.(hoveredVocabularyEntry) ?? false}
            showJumpToSource={Boolean(onJumpToVocabularySource && hoveredVocabularyEntry.sourceSentence.trim())}
            onJumpToSource={() => {
              onClose();
              onJumpToVocabularySource?.(hoveredVocabularyEntry);
            }}
          />
        )}
      </section>

      <section
        className={`${styles.savedPreview} ${sortedSavedArticles.length ? "" : styles.previewCompact} ${visiblePreview === "saved" ? styles.savedPreviewVisible : ""}`}
        style={{ "--preview-anchor-y": `${previewAnchorY ?? window.innerHeight / 2}px` } as CSSProperties}
        aria-label="保存文章"
        aria-hidden={visiblePreview !== "saved"}
        inert={visiblePreview !== "saved"}
        data-home-menu-preview
        onPointerDown={(event) => event.stopPropagation()}
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

      <MenuPreview
        kind="account"
        visiblePreview={visiblePreview}
        previewAnchorY={previewAnchorY}
        title="账号与用量"
        subtitle="完整账号与用量页面"
      >
        <div className={styles.pageContent} data-local-scroll-surface>
          <AccountUsagePageContent embedded />
        </div>
      </MenuPreview>

      <MenuPreview
        kind="feedback"
        visiblePreview={visiblePreview}
        previewAnchorY={previewAnchorY}
        title="意见反馈"
        subtitle="内容只会进入开发者的私有反馈箱"
      >
        <MenuFeedbackForm isOffline={isOffline} />
      </MenuPreview>
    </div>,
    document.body,
  );
}

function MenuPreview({
  kind,
  visiblePreview,
  previewAnchorY,
  title,
  subtitle,
  children,
}: {
  kind: PreviewKind;
  visiblePreview: PreviewKind | null;
  previewAnchorY: number | null;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const visible = visiblePreview === kind;
  const variantClass = kind === "guide" || kind === "account"
    ? styles.pagePreview
    : kind === "feedback"
      ? styles.feedbackPreview
      : "";
  return (
    <section
      className={`${styles.savedPreview} ${styles.generalPreview} ${variantClass} ${visible ? styles.savedPreviewVisible : ""}`}
      style={{ "--preview-anchor-y": `${previewAnchorY ?? 320}px` } as CSSProperties}
      aria-label={title}
      aria-hidden={!visible}
      inert={!visible}
      data-home-menu-preview
      onPointerDown={(event) => event.stopPropagation()}
    >
      {kind !== "guide" && kind !== "account" && (
        <header className={styles.savedHeader}>
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
        </header>
      )}
      {children}
    </section>
  );
}

function MenuFeedbackForm({ isOffline }: { isOffline: boolean }) {
  const [category, setCategory] = useState("产品建议");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [sent, setSent] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const imagePreviews = useMemo(
    () => images.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [images],
  );

  useEffect(() => () => {
    imagePreviews.forEach((item) => URL.revokeObjectURL(item.url));
  }, [imagePreviews]);

  function addImages(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!selected.length) return;
    const unsupported = selected.find((file) => !FEEDBACK_IMAGE_TYPES.has(file.type));
    if (unsupported) {
      setStatus("图片仅支持 JPG、PNG、WebP 或 GIF。");
      return;
    }
    const oversized = selected.find((file) => file.size > MAX_FEEDBACK_IMAGE_BYTES);
    if (oversized) {
      setStatus(`单张图片不能超过 5MB：${oversized.name}`);
      return;
    }
    if (images.length + selected.length > MAX_FEEDBACK_IMAGES) {
      setStatus(`最多上传 ${MAX_FEEDBACK_IMAGES} 张图片。`);
      return;
    }
    setStatus("");
    setImages((current) => [...current, ...selected]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (isOffline) {
      setStatus("当前离线，意见反馈需要联网后才能提交。你填写的内容会保留在当前页面。");
      return;
    }
    setSubmitting(true);
    setStatus("");
    try {
      const body = new FormData();
      body.append("category", category);
      body.append("message", message);
      body.append("contact", contact);
      body.append("website", website);
      body.append("page", window.location.href);
      images.forEach((file) => body.append("images", file, file.name));
      const response = await fetch("/api/feedback", {
        method: "POST",
        body,
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        setStatus(await describeApiFailure(response, data, {
          operation: "feedback_submit",
          endpoint: "/api/feedback",
          fallbackMessage: "反馈提交失败，请稍后重试。",
          metadata: { attachmentCount: images.length },
        }));
        return;
      }
      setSent(true);
    } catch (error) {
      setStatus(await describeCaughtRequestError(error, {
        operation: "feedback_submit",
        endpoint: "/api/feedback",
        fallbackMessage: "反馈提交失败，请稍后重试。",
        metadata: { attachmentCount: images.length },
      }));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.feedbackSuccess} role="status">
        <i aria-hidden="true">✓</i>
        <strong>建议已经送达</strong>
        <p>感谢你帮助 Context Reader 变得更好。</p>
        <button
          className={styles.previewSecondaryAction}
          type="button"
          onClick={() => {
            setSent(false);
            setMessage("");
            setContact("");
            setImages([]);
          }}
        >
          再写一条
        </button>
      </div>
    );
  }

  return (
    <form className={styles.feedbackForm} onSubmit={(event) => void submit(event)} data-local-scroll-surface>
      <label>类型
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          <option>产品建议</option><option>使用问题</option><option>文章与推荐</option><option>翻译或解释问题</option><option>界面与动效</option>
        </select>
      </label>
      <label>你的想法
        <textarea
          value={message}
          onChange={(event) => {
            setMessage(event.target.value);
            if (status) setStatus("");
          }}
          minLength={10}
          maxLength={3000}
          placeholder="请描述发生了什么，或你希望怎样改…"
          required
        />
      </label>
      <label>联系方式（可不填）
        <input value={contact} onChange={(event) => setContact(event.target.value)} maxLength={160} placeholder="邮箱、微信或其他联系方式" />
      </label>
      <div className={styles.feedbackImages}>
        <div>
          <strong>补充图片（可不填）</strong>
          <span>最多 3 张，每张不超过 5MB</span>
        </div>
        {imagePreviews.length > 0 && (
          <ul>
            {imagePreviews.map(({ file, url }, index) => (
              <li key={`${file.name}-${file.lastModified}-${index}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`待上传图片 ${index + 1}`} />
                <button
                  type="button"
                  aria-label={`移除图片 ${file.name}`}
                  onClick={() => setImages((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {images.length < MAX_FEEDBACK_IMAGES && (
          <label className={styles.feedbackImagePicker}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              onChange={addImages}
              disabled={isOffline || submitting}
            />
            <span>{images.length ? "继续添加图片" : "选择图片"}</span>
          </label>
        )}
      </div>
      <label className={styles.honeypot} aria-hidden="true">Website
        <input value={website} onChange={(event) => setWebsite(event.target.value)} tabIndex={-1} autoComplete="off" />
      </label>
      <div className={styles.feedbackFooter}>
        <span>{message.length} / 3000</span>
        <button type="submit" disabled={isOffline || submitting || message.trim().length < 10}>{isOffline ? "联网后可提交" : submitting ? "正在提交…" : "提交建议"}</button>
      </div>
      {status && <p className={styles.feedbackError} role="alert">{status}</p>}
    </form>
  );
}

function VocabularyHoverDetail({
  entry,
  canJumpToSource,
  showJumpToSource,
  onJumpToSource,
}: {
  entry: VocabularyEntry;
  canJumpToSource: boolean;
  showJumpToSource: boolean;
  onJumpToSource: () => void;
}) {
  const isStandalone = !entry.sourceSentence.trim();
  const detailSections = [
    [entry.sourceSentence ? "所选词在本句中的含义" : "中文释义", entry.contextMeaning || entry.basicMeaning],
    ...(entry.sourceSentence ? [["基础释义", entry.basicMeaning]] : []),
    ["原句", entry.sourceSentence],
    ["自然翻译", entry.sentenceTranslation],
    ...(!isStandalone ? [
      ["用法提示", entry.usageNote],
      ["常见搭配", entry.collocation],
      ["英文例句", entry.exampleEnglish],
      ["例句翻译", entry.exampleChinese],
    ] : []),
  ].filter((section): section is string[] => Boolean(section[1]?.trim()));

  return (
    <div className={styles.vocabularyDetailInner} data-local-scroll-surface>
      <header className={styles.vocabularyDetailHeader}>
        <div>
          <h3>{entry.word}</h3>
          <p>
            {[
              originalFormLabel(entry.lemma, entry.word),
              normalizePartOfSpeechLabel(entry.partOfSpeech),
              entry.phonetic,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>
        <PronunciationButtons text={entry.word} />
      </header>

      {showJumpToSource && (
        <button
          className={styles.jumpToSource}
          type="button"
          onClick={onJumpToSource}
          disabled={!canJumpToSource}
          title={canJumpToSource ? "跳转到原文句子" : "当前文章和已保存文章里没有找到这句话"}
        >
          定位原句
        </button>
      )}

      <dl className={styles.vocabularyDetails}>
        {detailSections.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {isStandalone && <VocabularyLearningDetails entry={entry} variant="compact" />}

      <footer className={styles.vocabularyDetailMeta}>
        <span>难度：{entry.difficulty === "easy" ? "基础" : entry.difficulty === "hard" ? "较难" : "适中"}</span>
        <span className={styles.ankiMeta}>{entry.anki.ankiNoteId ? "已导入 Anki" : "未导入 Anki"}</span>
      </footer>
    </div>
  );
}
