"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArticleInput } from "@/components/ArticleInput";
import { ReaderView } from "@/components/ReaderView";
import { fetchJson } from "@/lib/apiClient";
import { deleteSavedArticle, getSavedArticles, touchSavedArticle } from "@/lib/articles";
import { setCachedArticleTranslation } from "@/lib/cache";
import { findBestSourceSentenceMatch, normalizeForSourceMatch } from "@/lib/sourceMatching";
import { hasClickableWords, tokenizeArticle } from "@/lib/tokenizer";
import type { ImportedArticle, ImportedImageLayoutWord, SavedArticle } from "@/types/article";
import type { PublicArticle, PublicArticleTranslation, PublicExplanation } from "@/types/publicArticle";
import type { VocabularyEntry } from "@/types/vocabulary";
import { useAccount } from "@/components/AccountProvider";

interface HomeClientProps {
  initialPublicArticles: PublicArticle[];
}

interface PublicArticleDetails {
  body: string;
  importedArticle?: ImportedArticle;
  explanations?: PublicExplanation[];
  articleTranslations?: PublicArticleTranslation[];
}

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
  }, "OCR 识别失败，请稍后重试。");

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
  }, "图片词框识别失败，请稍后重试。");

  if (!response.ok || !Array.isArray(data?.words) || data.words.length === 0) {
    throw new Error(data?.error || "图片词框识别失败。");
  }
  return data.words;
}

export function HomeClient({ initialPublicArticles }: HomeClientProps) {
  const { requireAccount } = useAccount();
  const [article, setArticle] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [importedArticle, setImportedArticle] = useState<ImportedArticle | null>(null);
  const [preloadedExplanations, setPreloadedExplanations] = useState<PublicExplanation[]>([]);
  const [importingUrl, setImportingUrl] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [openingPublicArticleId, setOpeningPublicArticleId] = useState("");
  const [reading, setReading] = useState(false);
  const [homeDemoCompleted, setHomeDemoCompleted] = useState(false);
  const [sourceSentenceToHighlight, setSourceSentenceToHighlight] = useState("");
  const [sourceWordToHighlight, setSourceWordToHighlight] = useState("");
  const [sourceJumpRequestId, setSourceJumpRequestId] = useState(0);
  const [readerSessionId, setReaderSessionId] = useState(0);
  const [error, setError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const publicArticleRequestsRef = useRef(new Map<string, Promise<PublicArticleDetails>>());

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [reading]);

  useEffect(() => {
    setSavedArticles(getSavedArticles());
  }, []);

  useEffect(() => {
    if (!sourceSentenceToHighlight) {
      setSourceWordToHighlight("");
    }
  }, [sourceSentenceToHighlight]);

  function handleStartReading() {
    const trimmedArticle = article.trim();

    if (!trimmedArticle) {
      setError("");
      return;
    }

    if (!hasClickableWords(trimmedArticle)) {
      setError("文章中没有可点击的英文单词。");
      return;
    }

    setError("");
    setSourceSentenceToHighlight("");
    setImportedArticle(null);
    setPreloadedExplanations([]);
    setReading(true);
  }

  async function handleImportUrl() {
    const url = articleUrl.trim();

    if (!url) {
      setUrlError("");
      return;
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
      }, "URL 导入失败，请稍后重试。");

      if (!response.ok || !data?.article?.text?.trim()) {
        throw new Error(data?.error || "URL 导入失败，请稍后重试。");
      }

      if (!hasClickableWords(data.article.text)) {
        throw new Error("导入的正文里没有可点击的英文单词。");
      }

      setArticle(data.article.text);
      setArticleUrl("");
      setImportedArticle(data.article);
      setPreloadedExplanations([]);
      setSourceSentenceToHighlight("");
      setError("");
      setUrlError("");
      setReading(true);
    } catch (importError) {
      setUrlError(importError instanceof Error ? importError.message : "URL 导入失败，请稍后重试。");
    } finally {
      setImportingUrl(false);
    }
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
      setSourceSentenceToHighlight("");
      setError("");
      setReading(true);
    } catch (ocrImageError) {
      setOcrError(ocrImageError instanceof Error ? ocrImageError.message : "OCR 识别失败，请稍后重试。");
    } finally {
      setOcrLoading(false);
    }
  }

  function handleOpenSavedArticle(savedArticle: SavedArticle) {
    const nextSavedArticles = touchSavedArticle(savedArticle.id);
    const touchedArticle = nextSavedArticles.find((articleItem) => articleItem.id === savedArticle.id) ?? savedArticle;
    setSavedArticles(nextSavedArticles);
    setArticle(touchedArticle.body);
    setImportedArticle(touchedArticle.importedArticle ?? null);
    setPreloadedExplanations([]);
    setSourceSentenceToHighlight("");
    setError("");
    setReading(true);
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

  async function handleOpenPublicArticle(id: string) {
    if (openingPublicArticleId) {
      return;
    }

    setOpeningPublicArticleId(id);
    setError("");
    try {
      const publicArticle = await loadPublicArticle(id);

      setArticle(publicArticle.body);
      setImportedArticle(publicArticle.importedArticle ?? null);
      setPreloadedExplanations(publicArticle.explanations ?? []);
      for (const item of publicArticle.articleTranslations ?? []) {
        setCachedArticleTranslation(item.cacheKey, item.translations);
      }
      setSourceSentenceToHighlight("");
      setReading(true);
    } catch (publicArticleError) {
      setError(publicArticleError instanceof Error ? publicArticleError.message : "公开文章读取失败，请稍后重试。");
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
      containsSourceSentence(article, entry.sourceSentence) ||
      Boolean(findSimilarSourceSentence(article, entry)) ||
      Boolean(findArticleForVocabularyEntry(entry))
    );
  }

  function handleJumpToVocabularySource(entry: VocabularyEntry) {
    const currentArticleMatchedSentence = containsSourceSentence(article, entry.sourceSentence)
      ? entry.sourceSentence
      : findSimilarSourceSentence(article, entry);
    if (currentArticleMatchedSentence) {
      setSourceSentenceToHighlight(currentArticleMatchedSentence);
      setSourceWordToHighlight(entry.word);
      setSourceJumpRequestId((requestId) => requestId + 1);
      setReaderSessionId((sessionId) => sessionId + 1);
      setError("");
      setReading(true);
      return true;
    }

    const savedArticle = findArticleForVocabularyEntry(entry);
    if (savedArticle) {
      const nextSavedArticles = touchSavedArticle(savedArticle.id);
      const touchedArticle = nextSavedArticles.find((articleItem) => articleItem.id === savedArticle.id) ?? savedArticle;
      setSavedArticles(nextSavedArticles);
      setArticle(touchedArticle.body);
      setImportedArticle(touchedArticle.importedArticle ?? null);
      setPreloadedExplanations([]);
      setSourceSentenceToHighlight(
        containsSourceSentence(touchedArticle.body, entry.sourceSentence)
          ? entry.sourceSentence
          : findSimilarSourceSentence(touchedArticle.body, entry),
      );
      setSourceWordToHighlight(entry.word);
      setSourceJumpRequestId((requestId) => requestId + 1);
      setReaderSessionId((sessionId) => sessionId + 1);
      setError("");
      setReading(true);
      return true;
    }

    setError("当前文章和已保存文章里没有找到这个词条的原句。");
    return false;
  }

  if (reading) {
    return (
      <ReaderView
        key={readerSessionId}
        article={article}
        importedArticle={importedArticle}
        preloadedExplanations={preloadedExplanations}
        sourceSentenceToHighlight={sourceSentenceToHighlight}
        sourceWordToHighlight={sourceWordToHighlight}
        sourceJumpRequestId={sourceJumpRequestId}
        onImportedArticleChange={handleImportedArticleChange}
        onJumpToVocabularySourceOutsideArticle={handleJumpToVocabularySource}
        canJumpToVocabularySourceOutsideArticle={canJumpToVocabularySource}
        onArticleChange={(nextArticle, nextImportedArticle) => {
          setArticle(nextArticle);
          setImportedArticle(nextImportedArticle);
          setPreloadedExplanations([]);
          setSourceSentenceToHighlight("");
        }}
        onBack={() => {
          setHomeDemoCompleted(true);
          setSavedArticles(getSavedArticles());
          setArticle("");
          setImportedArticle(null);
          setPreloadedExplanations([]);
          setSourceSentenceToHighlight("");
          setError("");
          setReading(false);
        }}
        onArticleSaved={() => setSavedArticles(getSavedArticles())}
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
