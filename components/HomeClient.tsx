"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArticleInput } from "@/components/ArticleInput";
import { HomeRedesign } from "@/components/HomeRedesign";
import { ReaderView } from "@/components/ReaderView";
import { fetchJson } from "@/lib/apiClient";
import { ACCOUNT_DATA_MERGED_EVENT } from "@/lib/accountEvents";
import {
  deleteSavedArticle,
  getSavedArticles,
  replaceSavedArticleImportedArticle,
  saveArticleReadingProgress,
  touchSavedArticle,
} from "@/lib/articles";
import { getCachedArticleTranslation, setCachedArticleTranslation } from "@/lib/cache";
import { findBestSourceSentenceMatch, normalizeForSourceMatch } from "@/lib/sourceMatching";
import { hasClickableWords, tokenizeArticle } from "@/lib/tokenizer";
import { primeLeadingArticleImage } from "@/lib/articleImagePreload";
import { hasExternalImportedArticleImages } from "@/lib/articleImageUrls";
import type { ImportedArticle, ImportedImageLayoutWord, SavedArticle } from "@/types/article";
import type { PublicArticle, PublicExplanation } from "@/types/publicArticle";
import type { ReaderViewportAnchor } from "@/types/reader";
import type { VocabularyEntry, VocabularySourceArticle } from "@/types/vocabulary";
import { updateVocabularyEntry } from "@/lib/vocabulary";
import { useAccount } from "@/components/AccountProvider";
import {
  clearTemporaryReading,
  readTemporaryReading,
  updateTemporaryReadingProgress,
  writeTemporaryReading,
  type TemporaryReading,
} from "@/lib/temporaryReading";
import type { HomepageCuration } from "@/lib/homepageCurationShared";

interface HomeClientProps {
  initialPublicArticles: PublicArticle[];
  initialHomepageCuration?: HomepageCuration;
  homeVariant?: "immersive" | "book";
  forceGuestPreview?: boolean;
  forceMemberPreview?: boolean;
}

type PublicArticleDetails = Pick<
  PublicArticle,
  "id" | "title" | "body" | "importedArticle" | "explanations" | "articleTranslations"
>;

type ReaderOriginKind = "pasted-text" | "url-import" | "saved-article" | "temporary-article" | "public-article" | "demo" | "vocabulary";

interface ReaderOriginSnapshot {
  kind: ReaderOriginKind;
  scrollY: number;
  capturedAt: number;
}

interface ReadingProgressSession {
  startedAt: number;
  baselineAnchor: ReaderViewportAnchor | null;
  lastAnchor: ReaderViewportAnchor | null;
  cumulativeTravel: number;
}

const PROGRESS_INITIAL_SETTLE_MS = 3_000;
const PROGRESS_MIN_SESSION_MS = 20_000;
const PROGRESS_STABLE_DWELL_MS = 8_000;
const PROGRESS_MIN_TRAVEL_VIEWPORT_RATIO = 0.65;
const PROGRESS_MIN_FORWARD_VIEWPORT_RATIO = 0.35;

interface ReaderSessionSnapshot {
  article: string;
  importedArticle: ImportedArticle | null;
  preloadedExplanations: PublicExplanation[];
  articleSource?: VocabularySourceArticle;
  sourceSentenceToHighlight: string;
  sourceWordToHighlight: string;
  sourceJumpRequestId: number;
  viewportAnchor: ReaderViewportAnchor | null;
  savedArticleId: string | null;
  temporaryUserId: string | null;
}

const MAX_READER_SESSION_DEPTH = 5;
const READER_HISTORY_STATE_KEY = "contextReaderReaderDepth";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("图片读取失败，请换一张图片重试。"));
    };
    reader.onerror = () => reject(new Error("图片读取失败，请换一张图片重试。"));
    reader.readAsDataURL(file);
  });
}

function textFromLayoutWords(words: ImportedImageLayoutWord[]): string {
  const lines: string[] = [];
  for (const word of words) {
    const line = word.lineText?.trim() || word.text.trim();
    if (line && lines[lines.length - 1] !== line) {
      lines.push(line);
    }
  }
  return lines.join("\n").trim();
}

async function requestImageText(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("image", file);

  const { response, data } = await fetchJson<{ text?: string; error?: string }>("/api/ocr-image", {
    method: "POST",
    body: formData,
  }, "OCR 识别失败，请稍后重试。", {
    operation: "image_ocr",
    metadata: { fileType: file.type, fileBytes: file.size },
  });

  if (!response.ok || !data?.text?.trim()) {
    throw new Error(data?.error || "OCR 识别失败，请稍后重试。");
  }
  return data.text.trim();
}

async function requestImageLayoutWords(file: File): Promise<ImportedImageLayoutWord[]> {
  const formData = new FormData();
  formData.append("image", file);

  const { response, data } = await fetchJson<{ words?: ImportedImageLayoutWord[]; error?: string }>("/api/ocr-image-layout", {
    method: "POST",
    body: formData,
  }, "图片词框识别失败，请稍后重试。", {
    operation: "image_layout_ocr",
    metadata: { fileType: file.type, fileBytes: file.size },
  });

  if (!response.ok || !Array.isArray(data?.words) || data.words.length === 0) {
    throw new Error(data?.error || "图片词框识别失败。");
  }
  return data.words;
}

export function HomeClient({ initialPublicArticles, initialHomepageCuration, homeVariant = "immersive", forceGuestPreview = false, forceMemberPreview = false }: HomeClientProps) {
  const { account, isOffline, requireAccount } = useAccount();
  const [article, setArticle] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [urlPreview, setUrlPreview] = useState<ImportedArticle | null>(null);
  const [importedArticle, setImportedArticle] = useState<ImportedArticle | null>(null);
  const [preloadedExplanations, setPreloadedExplanations] = useState<PublicExplanation[]>([]);
  const [activeArticleSource, setActiveArticleSource] = useState<VocabularySourceArticle | undefined>();
  const [importingUrl, setImportingUrl] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [openingPublicArticleId, setOpeningPublicArticleId] = useState("");
  const [reading, setReading] = useState(false);
  const [homeDemoCompleted, setHomeDemoCompleted] = useState(false);
  const [sourceSentenceToHighlight, setSourceSentenceToHighlight] = useState("");
  const [sourceWordToHighlight, setSourceWordToHighlight] = useState("");
  const [sourceJumpRequestId, setSourceJumpRequestId] = useState(0);
  const [readerSessionId, setReaderSessionId] = useState(0);
  const [readerInitialViewportAnchor, setReaderInitialViewportAnchor] = useState<ReaderViewportAnchor | null>(null);
  const [error, setError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [temporaryReading, setTemporaryReading] = useState<TemporaryReading | null>(null);
  const publicArticleRequestsRef = useRef(new Map<string, Promise<PublicArticleDetails>>());
  const savedArticleImageRequestsRef = useRef(new Map<string, Promise<SavedArticle>>());
  const readingRef = useRef(false);
  const readerOriginRef = useRef<ReaderOriginSnapshot | null>(null);
  const readerSessionStackRef = useRef<ReaderSessionSnapshot[]>([]);
  const readerViewportAnchorRef = useRef<ReaderViewportAnchor | null>(null);
  const activeSavedArticleIdRef = useRef<string | null>(null);
  const activeTemporaryUserIdRef = useRef<string | null>(null);
  const progressSaveTimerRef = useRef<number | null>(null);
  const progressSessionRef = useRef<ReadingProgressSession>({
    startedAt: 0,
    baselineAnchor: null,
    lastAnchor: null,
    cumulativeTravel: 0,
  });
  const pendingHomeScrollRef = useRef<number | null>(null);
  const initialHomePositionedRef = useRef(false);
  const readerHistoryDepthRef = useRef(0);

  useLayoutEffect(() => {
    if (reading && sourceSentenceToHighlight) {
      return;
    }
    if (!reading && pendingHomeScrollRef.current !== null) {
      const scrollY = pendingHomeScrollRef.current;
      pendingHomeScrollRef.current = null;
      const frameId = window.requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
      });
      return () => window.cancelAnimationFrame(frameId);
    }
    if (!reading && !initialHomePositionedRef.current) {
      initialHomePositionedRef.current = true;
      let secondFrameId = 0;
      const firstFrameId = window.requestAnimationFrame(() => {
        secondFrameId = window.requestAnimationFrame(() => {
          window.scrollTo({ top: 0, left: 0, behavior: "auto" });
        });
      });
      return () => {
        window.cancelAnimationFrame(firstFrameId);
        if (secondFrameId) window.cancelAnimationFrame(secondFrameId);
      };
    }
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [reading]);

  useEffect(() => {
    readingRef.current = reading;
  }, [reading]);

  useEffect(() => {
    const refreshSavedArticles = () => setSavedArticles(getSavedArticles());
    refreshSavedArticles();
    window.addEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshSavedArticles);
    return () => window.removeEventListener(ACCOUNT_DATA_MERGED_EVENT, refreshSavedArticles);
  }, []);

  useEffect(() => {
    const userId = account.authenticated ? account.profile?.userId ?? "" : "";
    setTemporaryReading(userId ? readTemporaryReading(userId) : null);
  }, [account.authenticated, account.profile?.userId]);

  useEffect(() => {
    if (!sourceSentenceToHighlight) {
      setSourceWordToHighlight("");
    }
  }, [sourceSentenceToHighlight]);

  const cancelPendingReadingProgress = useCallback(() => {
    if (progressSaveTimerRef.current !== null) {
      window.clearTimeout(progressSaveTimerRef.current);
      progressSaveTimerRef.current = null;
    }
  }, []);

  const beginReadingProgressSession = useCallback((initialAnchor: ReaderViewportAnchor | null) => {
    cancelPendingReadingProgress();
    progressSessionRef.current = {
      startedAt: Date.now(),
      baselineAnchor: initialAnchor,
      lastAnchor: initialAnchor,
      cumulativeTravel: 0,
    };
  }, [cancelPendingReadingProgress]);

  useEffect(() => () => cancelPendingReadingProgress(), [cancelPendingReadingProgress]);

  const enterReader = useCallback((originKind: ReaderOriginKind) => {
    beginReadingProgressSession(readerViewportAnchorRef.current);
    if (!readingRef.current) {
      readerOriginRef.current = {
        kind: originKind,
        scrollY: window.scrollY,
        capturedAt: Date.now(),
      };
      readerSessionStackRef.current = [];
      readerHistoryDepthRef.current = 1;
      window.history.pushState(
        { ...(window.history.state ?? {}), [READER_HISTORY_STATE_KEY]: 1 },
        "",
        window.location.href,
      );
    }
    setReading(true);
  }, [beginReadingProgressSession]);

  const captureCurrentReaderSession = useCallback((): ReaderSessionSnapshot => ({
    article,
    importedArticle,
    preloadedExplanations,
    articleSource: activeArticleSource,
    sourceSentenceToHighlight,
    sourceWordToHighlight,
    sourceJumpRequestId,
    viewportAnchor: readerViewportAnchorRef.current,
    savedArticleId: activeSavedArticleIdRef.current,
    temporaryUserId: activeTemporaryUserIdRef.current,
  }), [
    activeArticleSource,
    article,
    importedArticle,
    preloadedExplanations,
    sourceJumpRequestId,
    sourceSentenceToHighlight,
    sourceWordToHighlight,
  ]);

  const pushCurrentReaderSession = useCallback(() => {
    if (!readingRef.current) return;
    cancelPendingReadingProgress();
    readerSessionStackRef.current = [
      ...readerSessionStackRef.current,
      captureCurrentReaderSession(),
    ].slice(-MAX_READER_SESSION_DEPTH);
    readerHistoryDepthRef.current += 1;
    window.history.pushState(
      { ...(window.history.state ?? {}), [READER_HISTORY_STATE_KEY]: readerHistoryDepthRef.current },
      "",
      window.location.href,
    );
  }, [cancelPendingReadingProgress, captureCurrentReaderSession]);

  const restoreReaderSession = useCallback((snapshot: ReaderSessionSnapshot) => {
    setArticle(snapshot.article);
    setImportedArticle(snapshot.importedArticle);
    setPreloadedExplanations(snapshot.preloadedExplanations);
    setActiveArticleSource(snapshot.articleSource);
    setSourceSentenceToHighlight(snapshot.sourceSentenceToHighlight);
    setSourceWordToHighlight(snapshot.sourceWordToHighlight);
    setSourceJumpRequestId(snapshot.sourceJumpRequestId);
    setReaderInitialViewportAnchor(snapshot.viewportAnchor);
    readerViewportAnchorRef.current = snapshot.viewportAnchor;
    activeSavedArticleIdRef.current = snapshot.savedArticleId;
    activeTemporaryUserIdRef.current = snapshot.temporaryUserId;
    beginReadingProgressSession(snapshot.viewportAnchor);
    setReaderSessionId((sessionId) => sessionId + 1);
    setError("");
  }, [beginReadingProgressSession]);

  const leaveOrRestoreReader = useCallback(() => {
    cancelPendingReadingProgress();
    const previousSession = readerSessionStackRef.current.pop();
    if (previousSession) {
      restoreReaderSession(previousSession);
      return;
    }

    pendingHomeScrollRef.current = readerOriginRef.current?.scrollY ?? 0;
    readerOriginRef.current = null;
    readerViewportAnchorRef.current = null;
    activeSavedArticleIdRef.current = null;
    activeTemporaryUserIdRef.current = null;
    setReaderInitialViewportAnchor(null);
    setHomeDemoCompleted(true);
    setSavedArticles(getSavedArticles());
    setArticle("");
    setImportedArticle(null);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    setSourceSentenceToHighlight("");
    setSourceWordToHighlight("");
    setError("");
    setReading(false);
  }, [cancelPendingReadingProgress, restoreReaderSession]);

  useEffect(() => {
    const handlePopState = () => {
      if (!readingRef.current) return;
      readerHistoryDepthRef.current = Math.max(0, readerHistoryDepthRef.current - 1);
      leaveOrRestoreReader();
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [leaveOrRestoreReader]);

  const handleReaderBack = useCallback(() => {
    if (readerHistoryDepthRef.current > 0) {
      window.history.back();
      return;
    }
    leaveOrRestoreReader();
  }, [leaveOrRestoreReader]);

  const handleReaderViewportAnchorChange = useCallback((anchor: ReaderViewportAnchor) => {
    readerViewportAnchorRef.current = anchor;
    if (!activeSavedArticleIdRef.current && !activeTemporaryUserIdRef.current) return;
    const session = progressSessionRef.current;
    const now = Date.now();
    if (!session.startedAt) {
      beginReadingProgressSession(anchor);
      return;
    }
    if (!session.baselineAnchor || now - session.startedAt < PROGRESS_INITIAL_SETTLE_MS) {
      session.baselineAnchor = anchor;
      session.lastAnchor = anchor;
      return;
    }

    const lastScrollY = session.lastAnchor?.scrollY ?? anchor.scrollY;
    session.cumulativeTravel += Math.abs(anchor.scrollY - lastScrollY);
    session.lastAnchor = anchor;
    if (progressSaveTimerRef.current !== null) window.clearTimeout(progressSaveTimerRef.current);
    progressSaveTimerRef.current = null;

    const enoughTime = now - session.startedAt >= PROGRESS_MIN_SESSION_MS;
    const enoughTravel = session.cumulativeTravel >= window.innerHeight * PROGRESS_MIN_TRAVEL_VIEWPORT_RATIO;
    const enoughForwardProgress = anchor.scrollY - session.baselineAnchor.scrollY
      >= window.innerHeight * PROGRESS_MIN_FORWARD_VIEWPORT_RATIO;
    if (!enoughTime || !enoughTravel || !enoughForwardProgress) return;

    progressSaveTimerRef.current = window.setTimeout(() => {
      progressSaveTimerRef.current = null;
      if (document.visibilityState !== "visible" || progressSessionRef.current.lastAnchor !== anchor) return;
      const savedArticleId = activeSavedArticleIdRef.current;
      if (savedArticleId) {
        saveArticleReadingProgress(savedArticleId, anchor);
      } else if (activeTemporaryUserIdRef.current) {
        setTemporaryReading(updateTemporaryReadingProgress(activeTemporaryUserIdRef.current, anchor));
      }
      progressSessionRef.current = {
        startedAt: Date.now(),
        baselineAnchor: anchor,
        lastAnchor: anchor,
        cumulativeTravel: 0,
      };
    }, PROGRESS_STABLE_DWELL_MS);
  }, [beginReadingProgressSession]);

  async function consumeGuestImport(kind: "text" | "url"): Promise<boolean> {
    if (account.authenticated) return true;
    try {
      const response = await fetch("/api/usage/guest-import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-context-action-id": crypto.randomUUID(),
        },
        body: JSON.stringify({ kind }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        const message = data?.error || "游客导入次数校验失败，请稍后重试。";
        if (response.status === 401 || response.status === 429) requireAccount(message);
        if (kind === "url") setUrlError(message);
        else setError(message);
        return false;
      }
      return true;
    } catch {
      const message = "暂时无法确认游客导入次数，请稍后重试。";
      if (kind === "url") setUrlError(message);
      else setError(message);
      return false;
    }
  }

  async function handleStartReading() {
    const trimmedArticle = article.trim();

    if (!trimmedArticle) {
      setError("");
      return;
    }

    if (!hasClickableWords(trimmedArticle)) {
      setError("文章中没有可点击的英文单词。");
      return;
    }

    if (!(await consumeGuestImport("text"))) return;

    setError("");
    setSourceSentenceToHighlight("");
    setImportedArticle(null);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    activeSavedArticleIdRef.current = null;
    const userId = account.authenticated ? account.profile?.userId ?? "" : "";
    activeTemporaryUserIdRef.current = userId || null;
    if (userId) setTemporaryReading(writeTemporaryReading(userId, trimmedArticle, null));
    readerViewportAnchorRef.current = null;
    setReaderInitialViewportAnchor(null);
    enterReader("pasted-text");
  }

  function handleOpenDemoArticle(demoArticle: ImportedArticle) {
    void primeLeadingArticleImage(demoArticle);
    setArticle(demoArticle.text);
    setImportedArticle(demoArticle);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    setSourceSentenceToHighlight("");
    setError("");
    activeSavedArticleIdRef.current = null;
    readerViewportAnchorRef.current = null;
    setReaderInitialViewportAnchor(null);
    enterReader("demo");
  }

  async function fetchUrlImport(): Promise<ImportedArticle | null> {
    const url = articleUrl.trim();

    if (!url) {
      setUrlError("");
      return null;
    }
    if (isOffline) {
      setUrlError("当前离线，网址导入需要联网。你仍可粘贴文章或打开本机保存的文章。");
      return null;
    }

    setImportingUrl(true);
    setUrlError("");

    try {
      const { response, data } = await fetchJson<{ article?: ImportedArticle; error?: string }>("/api/import-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      }, "网址导入失败，请稍后重试。", {
        operation: "url_import",
        metadata: { hostname: (() => { try { return new URL(url).hostname; } catch { return ""; } })() },
      });

      if (!response.ok || !data?.article?.text?.trim()) {
        throw new Error(data?.error || "网址导入失败，请稍后重试。");
      }

      if (!hasClickableWords(data.article.text)) {
        throw new Error("导入的正文里没有可点击的英文单词。");
      }

      setUrlError("");
      return data.article;
    } catch (importError) {
      setUrlError(importError instanceof Error ? importError.message : "网址导入失败，请稍后重试。");
      return null;
    } finally {
      setImportingUrl(false);
    }
  }

  function openImportedUrlArticle(nextArticle: ImportedArticle) {
    setArticle(nextArticle.text);
    setImportedArticle(nextArticle);
    void primeLeadingArticleImage(nextArticle);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    setSourceSentenceToHighlight("");
    setError("");
    setUrlError("");
    activeSavedArticleIdRef.current = null;
    const userId = account.authenticated ? account.profile?.userId ?? "" : "";
    activeTemporaryUserIdRef.current = userId || null;
    if (userId) setTemporaryReading(writeTemporaryReading(userId, nextArticle.text, nextArticle));
    readerViewportAnchorRef.current = null;
    setReaderInitialViewportAnchor(null);
    enterReader("url-import");
  }

  async function handlePrepareUrlImport() {
    const nextArticle = await fetchUrlImport();
    if (nextArticle) setUrlPreview(nextArticle);
  }

  async function handleConfirmUrlImport() {
    if (!urlPreview) return;
    if (!(await consumeGuestImport("url"))) return;
    openImportedUrlArticle(urlPreview);
  }

  async function handleImportUrl() {
    const nextArticle = await fetchUrlImport();
    if (nextArticle) openImportedUrlArticle(nextArticle);
  }

  async function handleOcrImage(file: File | null) {
    if (file && !requireAccount("图片 OCR 会产生上游成本，登录后才能使用。")) return;
    if (!file) {
      return;
    }

    setOcrLoading(true);
    setOcrError("");

    try {
      const [imageDataUrl, textResult, layoutResult] = await Promise.all([
        readFileAsDataUrl(file),
        requestImageText(file).then(
          (text) => ({ ok: true as const, text }),
          (error) => ({ ok: false as const, error: error instanceof Error ? error.message : "OCR 识别失败。" }),
        ),
        requestImageLayoutWords(file).then(
          (words) => ({ ok: true as const, words }),
          (error) => ({ ok: false as const, error: error instanceof Error ? error.message : "图片词框识别失败。" }),
        ),
      ]);

      const layoutWords = layoutResult.ok ? layoutResult.words : [];
      const recognizedText = textResult.ok ? textResult.text : textFromLayoutWords(layoutWords);
      if (!recognizedText.trim()) {
        throw new Error(textResult.ok ? layoutResult.ok ? "图片中没有识别到英文。" : layoutResult.error : textResult.error);
      }

      setArticle(recognizedText);
      setImportedArticle({
        title: file.name.replace(/\.[^.]+$/, "") || "图片阅读",
        url: "",
        siteName: "本地图片",
        text: recognizedText,
        blocks: [
          {
            id: `uploaded-image-${Date.now()}`,
            type: "image",
            src: imageDataUrl,
            alt: file.name,
            layoutWords,
            layoutError: layoutResult.ok ? "" : layoutResult.error,
          },
        ],
      });
      setPreloadedExplanations([]);
      setActiveArticleSource(undefined);
      setSourceSentenceToHighlight("");
      setError("");
      activeSavedArticleIdRef.current = null;
      readerViewportAnchorRef.current = null;
      setReaderInitialViewportAnchor(null);
      enterReader("pasted-text");
    } catch (ocrImageError) {
      setOcrError(ocrImageError instanceof Error ? ocrImageError.message : "OCR 识别失败，请稍后重试。");
    } finally {
      setOcrLoading(false);
    }
  }

  async function localizeSavedArticleImages(savedArticle: SavedArticle): Promise<SavedArticle> {
    if (isOffline || !hasExternalImportedArticleImages(savedArticle.importedArticle)) return savedArticle;
    const pending = savedArticleImageRequestsRef.current.get(savedArticle.id);
    if (pending) return pending;

    const request = (async () => {
      try {
        const response = await fetch("/api/article-images/localize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ article: savedArticle.importedArticle }),
        });
        const data = await response.json().catch(() => null) as {
          article?: ImportedArticle;
          localized?: number;
          failures?: Array<{ src: string; error: string }>;
        } | null;
        if (!response.ok || !data?.article || !data.localized) return savedArticle;
        const nextArticles = replaceSavedArticleImportedArticle(savedArticle.id, data.article);
        setSavedArticles(nextArticles);
        return nextArticles.find((article) => article.id === savedArticle.id) ?? savedArticle;
      } catch {
        return savedArticle;
      } finally {
        savedArticleImageRequestsRef.current.delete(savedArticle.id);
      }
    })();
    savedArticleImageRequestsRef.current.set(savedArticle.id, request);
    return request;
  }

  function handleOpenSavedArticle(savedArticle: SavedArticle) {
    const touchedArticles = touchSavedArticle(savedArticle.id);
    const openedArticle = touchedArticles.find((item) => item.id === savedArticle.id) ?? savedArticle;
    setSavedArticles(touchedArticles);
    setArticle(openedArticle.body);
    setImportedArticle(openedArticle.importedArticle ?? null);
    void primeLeadingArticleImage(openedArticle.importedArticle ?? null);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    setSourceSentenceToHighlight("");
    setError("");
    activeSavedArticleIdRef.current = savedArticle.id;
    activeTemporaryUserIdRef.current = null;
    readerViewportAnchorRef.current = openedArticle.readingProgress ?? null;
    setReaderInitialViewportAnchor(openedArticle.readingProgress ?? null);
    enterReader("saved-article");

    // Opening a saved article must never wait on a historical media migration.
    // Production data is repaired in bulk; a browser-only legacy copy repairs
    // quietly after Reader is already interactive and then follows normal sync.
    void localizeSavedArticleImages(openedArticle).then((localizedArticle) => {
      if (
        localizedArticle.importedArticle
        && localizedArticle !== openedArticle
        && activeSavedArticleIdRef.current === savedArticle.id
      ) {
        setImportedArticle(localizedArticle.importedArticle);
        void primeLeadingArticleImage(localizedArticle.importedArticle);
      }
    });
  }

  function handleOpenSavedArticleFromReader(savedArticle: SavedArticle) {
    pushCurrentReaderSession();
    handleOpenSavedArticle(savedArticle);
  }

  async function handleOpenImportedArticleFromReader(
    nextText: string,
    nextImportedArticle: ImportedArticle | null,
    kind: "text" | "url",
  ): Promise<boolean> {
    const trimmedArticle = nextText.trim();
    if (!trimmedArticle || !hasClickableWords(trimmedArticle)) {
      setError("文章中没有可点击的英文单词。");
      return false;
    }
    if (!(await consumeGuestImport(kind))) return false;

    pushCurrentReaderSession();
    setArticle(trimmedArticle);
    setImportedArticle(nextImportedArticle);
    if (nextImportedArticle) void primeLeadingArticleImage(nextImportedArticle);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    setSourceSentenceToHighlight("");
    setSourceWordToHighlight("");
    setError("");
    setUrlError("");
    activeSavedArticleIdRef.current = null;
    const userId = account.authenticated ? account.profile?.userId ?? "" : "";
    activeTemporaryUserIdRef.current = userId || null;
    if (userId) setTemporaryReading(writeTemporaryReading(userId, trimmedArticle, nextImportedArticle));
    readerViewportAnchorRef.current = null;
    setReaderInitialViewportAnchor(null);
    enterReader(kind === "url" ? "url-import" : "pasted-text");
    return true;
  }

  function handleOpenTemporaryReading(record: TemporaryReading) {
    setArticle(record.body);
    setImportedArticle(record.importedArticle);
    void primeLeadingArticleImage(record.importedArticle);
    setPreloadedExplanations([]);
    setActiveArticleSource(undefined);
    setSourceSentenceToHighlight("");
    setError("");
    activeSavedArticleIdRef.current = null;
    const userId = account.authenticated ? account.profile?.userId ?? "" : "";
    activeTemporaryUserIdRef.current = userId || null;
    readerViewportAnchorRef.current = record.readingProgress;
    setReaderInitialViewportAnchor(record.readingProgress);
    enterReader("temporary-article");
  }

  const loadPublicArticle = useCallback((id: string): Promise<PublicArticleDetails> => {
    const existingRequest = publicArticleRequestsRef.current.get(id);
    if (existingRequest) {
      return existingRequest;
    }

    const request = fetchJson<{ article?: PublicArticleDetails; error?: string }>(
      `/api/public-articles/${encodeURIComponent(id)}`,
      {},
      "公开文章读取失败，请稍后重试。",
      {
        operation: "public_article_open",
        metadata: { articleId: id },
      },
    ).then(({ response, data }) => {
      if (!response.ok || !data?.article?.body?.trim()) {
        throw new Error(data?.error || "公开文章读取失败，请稍后重试。");
      }
      return data.article;
    }).catch((loadError) => {
      publicArticleRequestsRef.current.delete(id);
      throw loadError;
    });

    publicArticleRequestsRef.current.set(id, request);
    return request;
  }, []);

  const handlePrefetchPublicArticle = useCallback((id: string) => {
    void loadPublicArticle(id).catch(() => {
      // Prefetch failure stays silent; an explicit click retries and reports the error.
    });
  }, [loadPublicArticle]);

  function applyPublicArticle(publicArticle: PublicArticleDetails, fallbackId: string) {
    // The recommendation cover belongs to the shared opening transition, not
    // the article body. Keep the source article's own image sequence untouched
    // so the first editorial image is never rendered twice.
    const sourceArticle = publicArticle.importedArticle ?? null;
    void primeLeadingArticleImage(sourceArticle);
    setArticle(publicArticle.body);
    setImportedArticle(sourceArticle);
    setPreloadedExplanations(publicArticle.explanations ?? []);
    setActiveArticleSource({
      kind: "public",
      id: publicArticle.id || fallbackId,
      title: publicArticle.title || initialPublicArticles.find((item) => item.id === fallbackId)?.title || "",
    });
    for (const item of publicArticle.articleTranslations ?? []) {
      if (!getCachedArticleTranslation(item.cacheKey)) {
        setCachedArticleTranslation(item.cacheKey, item.translations);
      }
    }
  }

  async function handleOpenPublicArticle(id: string) {
    if (openingPublicArticleId) {
      return;
    }

    setOpeningPublicArticleId(id);
    setError("");
    try {
      const publicArticle = await loadPublicArticle(id);

      applyPublicArticle(publicArticle, id);
      setSourceSentenceToHighlight("");
      activeSavedArticleIdRef.current = null;
      readerViewportAnchorRef.current = null;
      setReaderInitialViewportAnchor(null);
      enterReader("public-article");
    } catch (publicArticleError) {
      setError(isOffline
        ? "当前离线，而且这篇公开文章尚未缓存在此设备上。请选择本机保存文章，或联网后再打开。"
        : publicArticleError instanceof Error
          ? publicArticleError.message
          : "公开文章读取失败，请稍后重试。");
    } finally {
      setOpeningPublicArticleId("");
    }
  }

  function handleDeleteSavedArticle(id: string) {
    if (!window.confirm("确定要删除这篇已保存文章吗？")) {
      return;
    }
    setSavedArticles(deleteSavedArticle(id));
  }

  const handleImportedArticleChange = useCallback((nextImportedArticle: ImportedArticle) => {
    setImportedArticle(nextImportedArticle);
  }, []);

  function containsSourceSentence(body: string, sourceSentence: string): boolean {
    const normalizedBody = normalizeForSourceMatch(body);
    const normalizedSourceSentence = normalizeForSourceMatch(sourceSentence);
    return Boolean(normalizedSourceSentence && normalizedBody.includes(normalizedSourceSentence));
  }

  function findSimilarSourceSentence(body: string, entry: VocabularyEntry): string {
    const tokens = tokenizeArticle(body).flatMap((paragraph) => paragraph.tokens.filter((token) => token.type === "word"));
    return findBestSourceSentenceMatch(entry.sourceSentence, entry.word, tokens)?.sentence ?? "";
  }

  function findArticleForVocabularyEntry(entry: VocabularyEntry): SavedArticle | null {
    return savedArticles.find((savedArticle) =>
      containsSourceSentence(savedArticle.body, entry.sourceSentence) ||
      Boolean(findSimilarSourceSentence(savedArticle.body, entry)),
    ) ?? null;
  }

  function canJumpToVocabularySource(entry: VocabularyEntry): boolean {
    return (
      Boolean(entry.sourceArticle?.kind === "public" && entry.sourceArticle.id) ||
      Boolean(entry.sourceSentence.trim() && initialPublicArticles.length > 0) ||
      containsSourceSentence(article, entry.sourceSentence) ||
      Boolean(findSimilarSourceSentence(article, entry)) ||
      Boolean(findArticleForVocabularyEntry(entry))
    );
  }

  async function findPublicArticleForVocabularyEntry(
    entry: VocabularyEntry,
  ): Promise<{ article: PublicArticleDetails; matchedSentence: string } | null> {
    const candidateIds = entry.sourceArticle?.kind === "public"
      ? [
          entry.sourceArticle.id,
          ...initialPublicArticles.map((item) => item.id).filter((id) => id !== entry.sourceArticle?.id),
        ]
      : initialPublicArticles.map((item) => item.id);

    for (const id of candidateIds) {
      try {
        const publicArticle = await loadPublicArticle(id);
        const matchedSentence = containsSourceSentence(publicArticle.body, entry.sourceSentence)
          ? entry.sourceSentence
          : findSimilarSourceSentence(publicArticle.body, entry);
        if (matchedSentence) {
          return { article: publicArticle, matchedSentence };
        }
      } catch {
        // A removed or temporarily unavailable recommendation should not block checking the rest.
      }
    }
    return null;
  }

  async function handleJumpToVocabularySource(entry: VocabularyEntry): Promise<boolean> {
    const currentArticleMatchedSentence = containsSourceSentence(article, entry.sourceSentence)
      ? entry.sourceSentence
      : findSimilarSourceSentence(article, entry);
    if (currentArticleMatchedSentence) {
      setSourceSentenceToHighlight(currentArticleMatchedSentence);
      setSourceWordToHighlight(entry.word);
      setSourceJumpRequestId((requestId) => requestId + 1);
      setReaderSessionId((sessionId) => sessionId + 1);
      setError("");
      enterReader("vocabulary");
      return true;
    }

    const savedArticle = findArticleForVocabularyEntry(entry);
    if (savedArticle) {
      pushCurrentReaderSession();
      setArticle(savedArticle.body);
      setImportedArticle(savedArticle.importedArticle ?? null);
      setPreloadedExplanations([]);
      setActiveArticleSource(undefined);
      setSourceSentenceToHighlight(
        containsSourceSentence(savedArticle.body, entry.sourceSentence)
          ? entry.sourceSentence
          : findSimilarSourceSentence(savedArticle.body, entry),
      );
      setSourceWordToHighlight(entry.word);
      setSourceJumpRequestId((requestId) => requestId + 1);
      setReaderSessionId((sessionId) => sessionId + 1);
      setError("");
      activeSavedArticleIdRef.current = savedArticle.id;
      activeTemporaryUserIdRef.current = null;
      readerViewportAnchorRef.current = savedArticle.readingProgress ?? null;
      setReaderInitialViewportAnchor(savedArticle.readingProgress ?? null);
      enterReader("vocabulary");
      return true;
    }

    const publicMatch = await findPublicArticleForVocabularyEntry(entry);
    if (publicMatch) {
      pushCurrentReaderSession();
      const sourceArticle: VocabularySourceArticle = {
        kind: "public",
        id: publicMatch.article.id,
        title: publicMatch.article.title,
      };
      applyPublicArticle(publicMatch.article, sourceArticle.id);
      setSourceSentenceToHighlight(publicMatch.matchedSentence);
      setSourceWordToHighlight(entry.word);
      setSourceJumpRequestId((requestId) => requestId + 1);
      setReaderSessionId((sessionId) => sessionId + 1);
      setError("");
      if (
        entry.sourceArticle?.id !== sourceArticle.id ||
        entry.sourceArticle.title !== sourceArticle.title
      ) {
        updateVocabularyEntry({ ...entry, sourceArticle });
      }
      activeSavedArticleIdRef.current = null;
      readerViewportAnchorRef.current = null;
      setReaderInitialViewportAnchor(null);
      enterReader("vocabulary");
      return true;
    }

    setError("当前文章、本地保存文章和推荐文章里都没有找到这个词条的原句。");
    return false;
  }

  if (reading) {
    return (
      <ReaderView
        key={readerSessionId}
        article={article}
        importedArticle={importedArticle}
        preloadedExplanations={preloadedExplanations}
        articleSource={activeArticleSource}
        sourceSentenceToHighlight={sourceSentenceToHighlight}
        sourceWordToHighlight={sourceWordToHighlight}
        sourceJumpRequestId={sourceJumpRequestId}
        desktopViewportInsetLeft={132}
        initialViewportAnchor={readerInitialViewportAnchor}
        onViewportAnchorChange={handleReaderViewportAnchorChange}
        savedArticles={savedArticles}
        onOpenSavedArticle={handleOpenSavedArticleFromReader}
        onOpenImportedArticle={handleOpenImportedArticleFromReader}
        onImportedArticleChange={handleImportedArticleChange}
        onJumpToVocabularySourceOutsideArticle={handleJumpToVocabularySource}
        canJumpToVocabularySourceOutsideArticle={canJumpToVocabularySource}
        onArticleChange={(nextArticle, nextImportedArticle) => {
          setArticle(nextArticle);
          setImportedArticle(nextImportedArticle);
          if (activeTemporaryUserIdRef.current) {
            setTemporaryReading(writeTemporaryReading(
              activeTemporaryUserIdRef.current,
              nextArticle,
              nextImportedArticle,
              readerViewportAnchorRef.current,
            ));
          }
          setPreloadedExplanations([]);
          setActiveArticleSource(undefined);
          setSourceSentenceToHighlight("");
        }}
        onBack={handleReaderBack}
        onArticleSaved={() => {
          setSavedArticles(getSavedArticles());
          if (activeTemporaryUserIdRef.current) {
            clearTemporaryReading(activeTemporaryUserIdRef.current);
            activeTemporaryUserIdRef.current = null;
            setTemporaryReading(null);
          }
        }}
      />
    );
  }

  if (homeVariant === "book") {
    return (
      <HomeRedesign
        forceGuestPreview={forceGuestPreview}
        forceMemberPreview={forceMemberPreview}
        skipMemberOpening={homeDemoCompleted}
        article={article}
        articleUrl={articleUrl}
        urlPreview={urlPreview}
        error={error}
        urlError={urlError}
        importingUrl={importingUrl}
        openingPublicArticleId={openingPublicArticleId}
        publicArticles={initialPublicArticles}
        homepageCuration={initialHomepageCuration}
        savedArticles={savedArticles}
        temporaryReading={temporaryReading}
        onArticleChange={(value) => {
          setArticle(value);
          setImportedArticle(null);
          setActiveArticleSource(undefined);
          setSourceSentenceToHighlight("");
          if (error) setError("");
        }}
        onArticleUrlChange={(value) => {
          setArticleUrl(value);
          setUrlPreview(null);
          if (urlError) setUrlError("");
        }}
        onStartReading={handleStartReading}
        onPrepareUrlImport={handlePrepareUrlImport}
        onConfirmUrlImport={handleConfirmUrlImport}
        onOpenDemoArticle={handleOpenDemoArticle}
        onOpenSavedArticle={handleOpenSavedArticle}
        onOpenTemporaryReading={handleOpenTemporaryReading}
        onOpenPublicArticle={handleOpenPublicArticle}
        onPrefetchPublicArticle={handlePrefetchPublicArticle}
        onDeleteSavedArticle={handleDeleteSavedArticle}
        onJumpToVocabularySource={handleJumpToVocabularySource}
        canJumpToVocabularySource={canJumpToVocabularySource}
      />
    );
  }

  return (
    <ArticleInput
      article={article}
      articleUrl={articleUrl}
      error={error}
      urlError={urlError}
      ocrError={ocrError}
      importingUrl={importingUrl}
      ocrLoading={ocrLoading}
      openingPublicArticleId={openingPublicArticleId}
      homeDemoCompleted={homeDemoCompleted}
      initialPublicArticles={initialPublicArticles}
      savedArticles={savedArticles}
      onArticleChange={(value) => {
        setArticle(value);
        setImportedArticle(null);
        setActiveArticleSource(undefined);
        setSourceSentenceToHighlight("");
        if (error) {
          setError("");
        }
      }}
      onArticleUrlChange={(value) => {
        setArticleUrl(value);
        if (urlError) {
          setUrlError("");
        }
      }}
      onStartReading={handleStartReading}
      onImportUrl={handleImportUrl}
      onOcrImage={handleOcrImage}
      onOpenSavedArticle={handleOpenSavedArticle}
      onOpenPublicArticle={handleOpenPublicArticle}
      onPrefetchPublicArticle={handlePrefetchPublicArticle}
      onDeleteSavedArticle={handleDeleteSavedArticle}
      onJumpToVocabularySource={handleJumpToVocabularySource}
      canJumpToVocabularySource={canJumpToVocabularySource}
    />
  );
}
