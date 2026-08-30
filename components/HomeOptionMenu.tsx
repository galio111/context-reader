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
import { AnkiSettingsPanel, defaultAnkiSettings } from "@/components/AnkiSettingsPanel";
import { AccountUsagePageContent } from "@/components/AccountUsagePageContent";
import ClearableField from "@/components/ClearableField";
import { GuidePageContent } from "@/components/GuidePageContent";
import InvitationCodeRedeemContent from "@/components/InvitationCodeRedeemContent";
import { PronunciationButtons } from "@/components/PronunciationButtons";
import { VocabularyLearningDetails } from "@/components/VocabularyLearningDetails";
import { MOBILE_SHEET_TALL_HEIGHT, useMobileBottomSheet } from "@/components/useMobileBottomSheet";
import { useDocumentScrollLock } from "@/components/useDocumentScrollLock";
import { describeApiFailure, describeCaughtRequestError } from "@/lib/clientErrorReporting";
import { addVocabularyNote, checkAnki } from "@/lib/ankiConnect";
import { downloadVocabularyCsv } from "@/lib/csv";
import { normalizePartOfSpeechLabel, originalFormLabel } from "@/lib/displayLabels";
import { currentFormPhonetic } from "@/lib/pronunciation";
import type { LocalAccountSession } from "@/lib/localAccountSession";
import { savedArticleOpenTimestamp } from "@/lib/savedArticleMerge";
import { sortVocabularyEntriesByCreatedAt } from "@/lib/vocabularyMerge";
import { clearVocabularyEntries, deleteVocabularyEntry, markVocabularyEntryImported } from "@/lib/vocabulary";
import { createVocabularySearchIndex, searchVocabularyIndex } from "@/lib/vocabularySearch";
import type { AccountSessionState } from "@/types/account";
import type { AnkiSettings } from "@/types/anki";
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
  initialPreview?: PreviewKind | null;
  onOpenImport?: () => void;
  onOpenDictionary?: () => void;
  onOpenGuide?: (section?: GuideSection) => void;
  initialGuideSection?: GuideSection | null;
  theme?: "day" | "night";
  letterMotionEnabled?: boolean;
  recommendationMotionEnabled?: boolean;
  onThemeChange?: (theme: "day" | "night") => void;
  onLetterMotionChange?: (enabled: boolean) => void;
  onRecommendationMotionChange?: (enabled: boolean) => void;
  placement?: "left" | "right";
  standalonePreview?: boolean;
  avoidHomeQuickNav?: boolean;
  onVocabularyEntriesChange?: (entries: VocabularyEntry[]) => void;
  ankiTools?: HomeMenuAnkiTools;
  vocabularyTools?: HomeMenuVocabularyTools;
}

export interface HomeMenuAnkiTools {
  settings: AnkiSettings;
  status: string;
  checking: boolean;
  importingId: string;
  importError: string;
  onSettingsChange: (settings: AnkiSettings) => void;
  onCheck: () => void;
  onImport: (entry: VocabularyEntry) => void;
  onImportAll: () => void;
}

export interface HomeMenuVocabularyTools {
  onDelete: (id: string) => void;
  onClear: () => void;
  onExportCsv: () => void;
  onCopy: (entry: VocabularyEntry) => void;
}

export type PreviewKind = "guide" | "vocabulary" | "saved" | "account" | "invite" | "feedback" | "settings";
export type GuideSection = "anki" | "updates";
type MenuAction = "import" | "dictionary";
interface MenuItem {
  label: string;
  preview?: PreviewKind;
  action?: MenuAction;
  adminOnly?: boolean;
  quick?: boolean;
}
const PREVIEW_ANCHOR_MIN = 72;
const FEEDBACK_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FEEDBACK_IMAGES = 3;
const MAX_FEEDBACK_IMAGE_BYTES = 5 * 1024 * 1024;

const menuItems: MenuItem[] = [
  { label: "账号与用量", preview: "account" },
  { label: "兑换邀请码", preview: "invite" },
  { label: "使用说明", preview: "guide" },
  { label: "设置", preview: "settings" },
  { label: "意见反馈", preview: "feedback" },
  { label: "admin后台", adminOnly: true },
];

const mobileQuickItems: MenuItem[] = [
  { label: "导入文章", action: "import", quick: true },
  { label: "单独查词", action: "dictionary", quick: true },
  { label: "生词本", preview: "vocabulary", quick: true },
  { label: "我的文章", preview: "saved", quick: true },
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

function vocabularyEntryClipboardText(entry: VocabularyEntry): string {
  return [
    entry.word,
    entry.contextMeaning || entry.basicMeaning,
    entry.sourceSentence,
    entry.sentenceTranslation,
  ].filter(Boolean).join("\n");
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
  initialPreview = null,
  onOpenImport,
  onOpenDictionary,
  onOpenGuide,
  initialGuideSection = null,
  theme = "day",
  letterMotionEnabled = true,
  recommendationMotionEnabled = true,
  onThemeChange,
  onLetterMotionChange,
  onRecommendationMotionChange,
  placement = "right",
  standalonePreview = false,
  avoidHomeQuickNav = false,
  onVocabularyEntriesChange,
  ankiTools,
  vocabularyTools,
}: HomeOptionMenuProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const vocabularyListRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(open);
  const [hoveredVocabularyId, setHoveredVocabularyId] = useState<string | null>(null);
  const [vocabularySearchQuery, setVocabularySearchQuery] = useState("");
  const [pinnedPreview, setPinnedPreview] = useState<PreviewKind | null>(null);
  const [previewAnchorY, setPreviewAnchorY] = useState<number | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const mobileSheet = useMobileBottomSheet(
    open,
    mobileMenu,
    mobileMenu && pinnedPreview === "vocabulary" ? MOBILE_SHEET_TALL_HEIGHT : undefined,
  );
  const [internalAnkiSettings, setInternalAnkiSettings] = useState<AnkiSettings>(() => defaultAnkiSettings());
  const [internalAnkiStatus, setInternalAnkiStatus] = useState("");
  const [internalAnkiChecking, setInternalAnkiChecking] = useState(false);
  const [internalImportingId, setInternalImportingId] = useState("");
  const [internalImportError, setInternalImportError] = useState("");
  const [ankiSettingsOpen, setAnkiSettingsOpen] = useState(false);
  const [ankiHelpOpen, setAnkiHelpOpen] = useState(false);
  const [guideScrollTarget, setGuideScrollTarget] = useState<GuideSection | null>(null);
  const items = useMemo(
    () => [
      ...(mobileMenu ? mobileQuickItems : []),
      ...menuItems,
    ].filter((item) => !item.adminOnly || isAdmin),
    [isAdmin, mobileMenu],
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
    estimateSize: () => 84,
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
  const visiblePreview = pinnedPreview;
  const effectiveAnkiSettings = ankiTools?.settings ?? internalAnkiSettings;
  const effectiveAnkiStatus = ankiTools?.status ?? internalAnkiStatus;
  const effectiveAnkiChecking = ankiTools?.checking ?? internalAnkiChecking;
  const effectiveImportingId = ankiTools?.importingId ?? internalImportingId;
  const effectiveImportError = ankiTools?.importError ?? internalImportError;
  const unimportedVocabularyCount = vocabularyEntries.filter((entry) => !entry.anki.ankiNoteId).length;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useDocumentScrollLock(mounted);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = (event?: MediaQueryListEvent) => {
      setMobileMenu(query.matches);
      if (!event) return;
      setHoveredVocabularyId(null);
      setAnkiHelpOpen(false);
      if (query.matches) setAnkiSettingsOpen(false);
      setPreviewAnchorY((current) => current === null
        ? null
        : query.matches
          ? PREVIEW_ANCHOR_MIN
          : standalonePreview
            ? PREVIEW_ANCHOR_MIN + 12
            : PREVIEW_ANCHOR_MIN + 54);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [standalonePreview]);

  useEffect(() => {
    if (!open) return;
    if (initialPreview) {
      setPreviewAnchorY(standalonePreview ? PREVIEW_ANCHOR_MIN + 12 : PREVIEW_ANCHOR_MIN + 54);
      setPinnedPreview(initialPreview);
      setGuideScrollTarget(initialPreview === "guide" ? initialGuideSection : null);
      return;
    }
    if (!standalonePreview) {
      setPinnedPreview(null);
      setPreviewAnchorY(null);
    }
  }, [initialGuideSection, initialPreview, open, standalonePreview]);

  useEffect(() => {
    if (!guideScrollTarget || visiblePreview !== "guide") return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(`[data-home-menu-preview] #${guideScrollTarget}`);
      const scroller = target?.closest<HTMLElement>("[data-local-scroll-surface]");
      if (target && scroller) {
        scroller.scrollTo({
          top: Math.max(0, target.offsetTop - 82),
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
      setGuideScrollTarget(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [guideScrollTarget, visiblePreview]);

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
    setHoveredVocabularyId(null);
    setVocabularySearchQuery("");
    setPinnedPreview(null);
    setPreviewAnchorY(null);
    setAnkiSettingsOpen(false);
    setAnkiHelpOpen(false);
    if (mounted && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMounted(false);
      return;
    }
    if (!mounted) return;
    const unmountTimer = window.setTimeout(() => setMounted(false), 360);
    return () => window.clearTimeout(unmountTimer);
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

  async function checkInternalAnki() {
    setInternalAnkiChecking(true);
    setInternalAnkiStatus("");
    try {
      const version = await checkAnki(internalAnkiSettings.endpoint);
      setInternalAnkiStatus(`连接成功，AnkiConnect version: ${version}`);
    } catch (error) {
      setInternalAnkiStatus(error instanceof Error ? error.message : "AnkiConnect 检测失败。");
    } finally {
      setInternalAnkiChecking(false);
    }
  }

  async function importInternalAnki(entry: VocabularyEntry) {
    if (internalImportingId) return;
    if (entry.anki.ankiNoteId) {
      setInternalImportError("这个词条已经导入过 Anki，不会重复导入。");
      return;
    }
    setInternalImportingId(entry.id);
    setInternalImportError("");
    try {
      const noteId = await addVocabularyNote(entry, internalAnkiSettings.deckName, internalAnkiSettings.endpoint);
      onVocabularyEntriesChange?.(markVocabularyEntryImported(entry.id, noteId));
    } catch (error) {
      setInternalImportError(error instanceof Error ? error.message : "导入 Anki 失败，请稍后重试。");
    } finally {
      setInternalImportingId("");
    }
  }

  async function importAllInternalAnki() {
    if (internalImportingId) return;
    const pending = vocabularyEntries.filter((entry) => !entry.anki.ankiNoteId);
    if (!pending.length) {
      setInternalImportError("没有未导入的词条。");
      return;
    }
    setInternalImportingId("__all__");
    setInternalImportError("");
    let completed = 0;
    try {
      for (const entry of pending) {
        const noteId = await addVocabularyNote(entry, internalAnkiSettings.deckName, internalAnkiSettings.endpoint);
        onVocabularyEntriesChange?.(markVocabularyEntryImported(entry.id, noteId));
        completed += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "批量导入 Anki 失败，请稍后重试。";
      setInternalImportError(completed ? `已导入 ${completed} 个词条，随后失败：${message}` : message);
    } finally {
      setInternalImportingId("");
    }
  }

  const checkAnkiConnection = ankiTools?.onCheck ?? (() => void checkInternalAnki());
  const importOneToAnki = ankiTools?.onImport ?? ((entry: VocabularyEntry) => void importInternalAnki(entry));
  const importAllToAnki = ankiTools?.onImportAll ?? (() => void importAllInternalAnki());
  const updateAnkiSettings = ankiTools?.onSettingsChange ?? setInternalAnkiSettings;
  const deleteVocabulary = vocabularyTools?.onDelete ?? ((id: string) => {
    if (!window.confirm("确定删除这个生词吗？")) return;
    onVocabularyEntriesChange?.(deleteVocabularyEntry(id));
    setHoveredVocabularyId(null);
  });
  const clearVocabulary = vocabularyTools?.onClear ?? (() => {
    if (!window.confirm(`将删除生词本中的 ${vocabularyEntries.length} 条词条，此操作无法撤销。`)) return;
    clearVocabularyEntries();
    onVocabularyEntriesChange?.([]);
    setHoveredVocabularyId(null);
  });
  const exportVocabulary = vocabularyTools?.onExportCsv ?? (() => downloadVocabularyCsv(vocabularyEntries));
  const copyVocabulary = vocabularyTools?.onCopy ?? ((entry: VocabularyEntry) => {
    void navigator.clipboard.writeText(vocabularyEntryClipboardText(entry)).catch(() => {
      window.alert("复制失败，请检查浏览器剪贴板权限。");
    });
  });

  function anchorPreview(trigger: HTMLElement) {
    const rect = trigger.getBoundingClientRect();
    setPreviewAnchorY(Math.max(PREVIEW_ANCHOR_MIN, rect.top));
  }

  function activateItem(item: (typeof items)[number], trigger: HTMLButtonElement) {
    if (item.action) {
      onClose();
      if (item.action === "import") onOpenImport?.();
      else onOpenDictionary?.();
      return;
    }
    if (item.preview) {
      const preview = item.preview;
      anchorPreview(trigger);
      setPinnedPreview((current) => current === preview ? null : preview);
      return;
    }
    setPinnedPreview(null);
    if (item.adminOnly && isAdmin) navigate("/admin");
  }

  function handleItemHover(item: (typeof items)[number], event: PointerEvent<HTMLButtonElement> | FocusEvent<HTMLButtonElement>) {
    if ("pointerType" in event && event.pointerType !== "mouse") return;
    if (item.preview) anchorPreview(event.currentTarget);
  }

  function openDetailedAnkiGuide() {
    setAnkiHelpOpen(false);
    setAnkiSettingsOpen(false);
    setHoveredVocabularyId(null);
    setGuideScrollTarget("anki");
    if (onOpenGuide) {
      onOpenGuide("anki");
      return;
    }
    setPreviewAnchorY(PREVIEW_ANCHOR_MIN);
    setPinnedPreview("guide");
  }

  function keepAnkiHelpOpen() {
    setAnkiHelpOpen(true);
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
      style={{ "--mobile-sheet-height": `${mobileSheet.height}dvh` } as CSSProperties}
      role="presentation"
      data-open={open || undefined}
      data-theme={theme}
      data-placement={placement}
      data-standalone={standalonePreview || undefined}
      data-home-quick-nav-offset={avoidHomeQuickNav || undefined}
      onKeyDown={handleDialogKeyDown}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.backdrop} aria-hidden="true" />
      <div
        className={styles.mobileSheetHandle}
        aria-label="拖动调整面板高度"
        onPointerDown={mobileSheet.onResizeStart}
        onPointerMove={mobileSheet.onResizeMove}
        onPointerUp={mobileSheet.onResizeEnd}
        onPointerCancel={mobileSheet.onResizeEnd}
      ><span /></div>
      {!standalonePreview && <>
        <div className={styles.prelayers} aria-hidden="true">
          <div className={styles.prelayer} style={{ "--layer-color": "#dfecef" } as CSSProperties} />
          <div className={styles.prelayer} style={{ "--layer-color": "#d8e2f0" } as CSSProperties} />
          <div className={styles.prelayer} style={{ "--layer-color": "#eadfd8" } as CSSProperties} />
        </div>

        <section
          id="home-option-menu"
          ref={dialogRef}
          className={styles.panel}
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-option-menu-title"
          onPointerDown={(event) => event.stopPropagation()}
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
              <li className={styles.itemWrap} key={item.label} data-quick={item.quick || undefined}>
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

        <button
          type="button"
          className={styles.accountIdentity}
          aria-label={account.authenticated ? "打开当前账号与用量" : "打开登录与账号入口"}
          onClick={(event) => {
            anchorPreview(event.currentTarget);
            setPinnedPreview("account");
          }}
        >
          <span>{isOffline ? "离线身份" : account.authenticated ? "当前账号" : "账号状态"}</span>
          <strong>
            {isOffline
              ? (localAccount?.nickname || (localAccount ? "上次登录账号" : "未确认账号"))
              : account.authenticated
                ? (account.profile?.nickname || "已登录")
                : "未登录，点击登录"}
          </strong>
          <i aria-hidden="true">→</i>
        </button>
        </section>
      </>}

      {visiblePreview && (
        <button
          className={`${styles.mobilePreviewBack} ${visiblePreview === "guide" ? styles.mobileGuideBack : ""}`}
          type="button"
          onClick={() => {
            if (hoveredVocabularyId) {
              setHoveredVocabularyId(null);
              return;
            }
            if (standalonePreview) {
              onClose();
              return;
            }
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
          <GuidePageContent
            embedded
            onOpenFeedback={() => {
              setPreviewAnchorY(PREVIEW_ANCHOR_MIN);
              setPinnedPreview("feedback");
            }}
          />
        </div>
      </MenuPreview>

      <section
        ref={standalonePreview && visiblePreview === "vocabulary" ? dialogRef : undefined}
        className={`${styles.savedPreview} ${orderedVocabularyEntries.length ? "" : styles.previewCompact} ${visiblePreview === "vocabulary" ? styles.savedPreviewVisible : ""}`}
        style={{ "--preview-anchor-y": `${previewAnchorY ?? window.innerHeight / 2}px` } as CSSProperties}
        role={standalonePreview ? "dialog" : undefined}
        aria-modal={standalonePreview ? "true" : undefined}
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
          <div className={styles.savedHeaderActions}>
            <span>{vocabularyEntries.length} 条</span>
            {standalonePreview && visiblePreview === "vocabulary" && (
              <button
                ref={closeButtonRef}
                className={`${styles.close} ${styles.previewClose}`}
                type="button"
                aria-label="关闭生词本"
                onClick={onClose}
                autoFocus
              >
                <span>Close</span>
                <i aria-hidden="true"><b /><b /></i>
              </button>
            )}
          </div>
        </header>
        {orderedVocabularyEntries.length ? (
          ankiSettingsOpen && !mobileMenu ? (
            <div className={styles.ankiSettingsView} data-local-scroll-surface>
              <button
                className={styles.ankiSettingsBack}
                type="button"
                onClick={() => setAnkiSettingsOpen(false)}
              >
                ← 返回生词本
              </button>
              <div className={styles.ankiSettings}>
                <AnkiSettingsPanel
                  settings={effectiveAnkiSettings}
                  status={effectiveAnkiStatus}
                  checking={effectiveAnkiChecking}
                  onChange={updateAnkiSettings}
                  onCheck={checkAnkiConnection}
                />
                {effectiveImportError && <p className={styles.ankiError} role="status">{effectiveImportError}</p>}
              </div>
            </div>
          ) : (
            <>
            {!mobileMenu && <div className={styles.ankiToolbar}>
              <button
                type="button"
                onClick={importAllToAnki}
                disabled={Boolean(effectiveImportingId) || unimportedVocabularyCount === 0}
              >
                {effectiveImportingId === "__all__" ? "批量导入中…" : `批量导入 ${unimportedVocabularyCount}`}
              </button>
              <div
                className={styles.ankiSettingsHelpGroup}
                onPointerEnter={(event) => { if (event.pointerType === "mouse") keepAnkiHelpOpen(); }}
                onPointerLeave={(event) => { if (event.pointerType === "mouse") setAnkiHelpOpen(false); }}
                onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAnkiHelpOpen(false); }}
              >
                <button
                  type="button"
                  aria-expanded={ankiSettingsOpen}
                  onClick={() => {
                    setHoveredVocabularyId(null);
                    setAnkiHelpOpen(false);
                    setAnkiSettingsOpen(true);
                  }}
                >
                  Anki 设置
                </button>
                <button
                  type="button"
                  className={styles.ankiHelpTrigger}
                  aria-label="Anki 是什么"
                  aria-expanded={ankiHelpOpen}
                  onFocus={() => setAnkiHelpOpen(true)}
                  onClick={keepAnkiHelpOpen}
                >
                  ?
                </button>
                {ankiHelpOpen && (
                  <div
                    className={styles.ankiHelpPopover}
                    role="tooltip"
                    onPointerEnter={keepAnkiHelpOpen}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <strong>Anki 是什么？</strong>
                    <p>Anki 是一款间隔重复记忆软件。Context Reader 把阅读中保存的词和原句做成卡片，Anki 再安排它们何时复习。</p>
                    <button
                      type="button"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        openDetailedAnkiGuide();
                      }}
                      onClick={openDetailedAnkiGuide}
                    >
                      查看安装与详细用法 →
                    </button>
                  </div>
                )}
              </div>
            </div>}
            <div className={styles.vocabularyManageBar}>
              <button type="button" onClick={exportVocabulary}>导出 CSV</button>
              <button type="button" onClick={clearVocabulary}>清空生词本</button>
            </div>
            {!mobileMenu && (effectiveAnkiStatus || effectiveImportError) && (
              <p className={effectiveImportError ? styles.ankiError : styles.ankiStatus} role="status">
                {effectiveImportError || effectiveAnkiStatus}
              </p>
            )}
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
                        onPointerUp={(event) => {
                          if (event.pointerType === "mouse" || vocabularyVirtualizer.isScrolling) return;
                          setHoveredVocabularyId(entry.id);
                        }}
                        onFocus={() => setHoveredVocabularyId(entry.id)}
                        onClick={() => setHoveredVocabularyId(entry.id)}
                        aria-expanded={hoveredVocabularyId === entry.id}
                      >
                        <strong>{entry.word}</strong>
                        <span>{entry.contextMeaning || entry.basicMeaning || "暂无释义"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className={styles.empty}>没有匹配的生词。</p>
            )}
            </>
          )
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
            importing={effectiveImportingId === hoveredVocabularyEntry.id || effectiveImportingId === "__all__"}
            onImportAnki={() => importOneToAnki(hoveredVocabularyEntry)}
            onCopy={() => copyVocabulary(hoveredVocabularyEntry)}
            onDelete={() => deleteVocabulary(hoveredVocabularyEntry.id)}
            showAnkiActions={!mobileMenu}
          />
        )}
      </section>

      <section
        ref={standalonePreview && visiblePreview === "saved" ? dialogRef : undefined}
        className={`${styles.savedPreview} ${sortedSavedArticles.length ? "" : styles.previewCompact} ${visiblePreview === "saved" ? styles.savedPreviewVisible : ""}`}
        style={{ "--preview-anchor-y": `${previewAnchorY ?? window.innerHeight / 2}px` } as CSSProperties}
        role={standalonePreview ? "dialog" : undefined}
        aria-modal={standalonePreview ? "true" : undefined}
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
          <div className={styles.savedHeaderActions}>
            <span>{sortedSavedArticles.length} 篇</span>
            {standalonePreview && visiblePreview === "saved" && (
              <button
                ref={closeButtonRef}
                className={`${styles.close} ${styles.previewClose}`}
                type="button"
                aria-label="关闭保存文章"
                onClick={onClose}
                autoFocus
              >
                <span>Close</span>
                <i aria-hidden="true"><b /><b /></i>
              </button>
            )}
          </div>
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
        kind="invite"
        visiblePreview={visiblePreview}
        previewAnchorY={previewAnchorY}
        title="兑换邀请码"
        subtitle="兑换后绑定当前账号"
      >
        <InvitationCodeRedeemContent active={visiblePreview === "invite"} />
      </MenuPreview>

      <MenuPreview
        kind="settings"
        visiblePreview={visiblePreview}
        previewAnchorY={previewAnchorY}
        title="设置"
        subtitle="只改变这台设备上的显示"
      >
        <div className={styles.settingsPanel} data-local-scroll-surface>
          {onLetterMotionChange && <section data-mobile-hidden>
            <div>
              <strong>鼠标字母轨迹</strong>
              <p>关闭后，鼠标移动时不再飘出彩色字母。</p>
            </div>
            <button
              type="button"
              className={styles.toggle}
              role="switch"
              aria-checked={letterMotionEnabled}
              onClick={() => onLetterMotionChange?.(!letterMotionEnabled)}
            ><i /></button>
          </section>}
          {onThemeChange && <section data-mobile-theme>
            <div>
              <strong>界面外观</strong>
              <p>在明亮和深色阅读环境之间切换。</p>
            </div>
            <div className={styles.themeChoices} aria-label="选择界面外观">
              <button type="button" aria-pressed={theme === "day"} onClick={() => onThemeChange?.("day")}>日间</button>
              <button type="button" aria-pressed={theme === "night"} onClick={() => onThemeChange?.("night")}>夜间</button>
            </div>
          </section>}
          {onRecommendationMotionChange && <section data-mobile-hidden>
            <div>
              <strong>外刊图片 3D</strong>
              <p>关闭后保留图片入场，但不再跟随鼠标倾斜。</p>
            </div>
            <button
              type="button"
              className={styles.toggle}
              role="switch"
              aria-checked={recommendationMotionEnabled}
              onClick={() => onRecommendationMotionChange?.(!recommendationMotionEnabled)}
            ><i /></button>
          </section>}
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
        <ClearableField value={message} onClear={() => { setMessage(""); setStatus(""); }} label="清空反馈内容" multiline>
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
        </ClearableField>
      </label>
      <label>联系方式（可不填）
        <ClearableField value={contact} onClear={() => setContact("")} label="清空联系方式">
          <input value={contact} onChange={(event) => setContact(event.target.value)} maxLength={160} placeholder="留下邮箱、微信或其他联系方式，我可以回信联系你" />
        </ClearableField>
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
  importing,
  onImportAnki,
  onCopy,
  onDelete,
  showAnkiActions,
}: {
  entry: VocabularyEntry;
  canJumpToSource: boolean;
  showJumpToSource: boolean;
  onJumpToSource: () => void;
  importing: boolean;
  onImportAnki: () => void;
  onCopy: () => void;
  onDelete: () => void;
  showAnkiActions: boolean;
}) {
  const isStandalone = !entry.sourceSentence.trim();
  const entryPhonetic = currentFormPhonetic(entry);
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
          <p>原型：{originalFormLabel(entry.lemma, entry.word)} · {normalizePartOfSpeechLabel(entry.partOfSpeech)}</p>
          {entryPhonetic && <p><strong>当前词音标：</strong>{entryPhonetic}</p>}
        </div>
        <PronunciationButtons text={entry.word} preload />
      </header>

      <div className={styles.vocabularyDetailActions}>
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
        {showAnkiActions && <button
          className={styles.importAnkiAction}
          type="button"
          onClick={onImportAnki}
          disabled={Boolean(entry.anki.ankiNoteId) || importing}
        >
          {entry.anki.ankiNoteId ? "已导入 Anki" : importing ? "导入中…" : "导入 Anki"}
        </button>}
        <button className={styles.secondaryDetailAction} type="button" onClick={onCopy}>复制词条</button>
        <button className={styles.dangerDetailAction} type="button" onClick={onDelete}>删除</button>
      </div>

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
        {showAnkiActions && <span className={styles.ankiMeta}>{entry.anki.ankiNoteId ? "已导入 Anki" : "未导入 Anki"}</span>}
      </footer>
    </div>
  );
}
