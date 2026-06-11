"use client";

import { useCallback, useEffect, useState } from "react";
import { ArticleInput } from "@/components/ArticleInput";
import { ReaderView } from "@/components/ReaderView";
import { deleteSavedArticle, getSavedArticles } from "@/lib/articles";
import { hasClickableWords } from "@/lib/tokenizer";
import type { ImportedArticle, SavedArticle } from "@/types/article";
import type { PublicArticle, PublicExplanation } from "@/types/publicArticle";

interface HomeClientProps {
  initialPublicArticles: PublicArticle[];
}

export function HomeClient({ initialPublicArticles }: HomeClientProps) {
  const [article, setArticle] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [importedArticle, setImportedArticle] = useState<ImportedArticle | null>(null);
  const [preloadedExplanations, setPreloadedExplanations] = useState<PublicExplanation[]>([]);
  const [importingUrl, setImportingUrl] = useState(false);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [openingPublicArticleId, setOpeningPublicArticleId] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [urlError, setUrlError] = useState("");
  const [ocrError, setOcrError] = useState("");
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);

  useEffect(() => {
    setSavedArticles(getSavedArticles());
  }, []);

  function handleStartReading() {
    const trimmedArticle = article.trim();

    if (!trimmedArticle) {
      setError("请先粘贴一篇英文文章。");
      return;
    }

    if (!hasClickableWords(trimmedArticle)) {
      setError("文章中没有可点击的英文单词。");
      return;
    }

    setError("");
    setImportedArticle(null);
    setPreloadedExplanations([]);
    setReading(true);
  }

  async function handleImportUrl() {
    const url = articleUrl.trim();

    if (!url) {
      setUrlError("请先输入文章 URL。");
      return;
    }

    setImportingUrl(true);
    setUrlError("");

    try {
      const response = await fetch("/api/import-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });
      const data = (await response.json().catch(() => null)) as
        | { article?: ImportedArticle; error?: string }
        | null;

      if (!response.ok || !data?.article?.text?.trim()) {
        throw new Error(data?.error || "URL 导入失败，请稍后重试。");
      }

      if (!hasClickableWords(data.article.text)) {
        throw new Error("导入的正文里没有可点击的英文单词。");
      }

      setArticle(data.article.text);
      setImportedArticle(data.article);
      setPreloadedExplanations([]);
      setError("");
      setReading(true);
    } catch (importError) {
      setUrlError(importError instanceof Error ? importError.message : "URL 导入失败，请稍后重试。");
    } finally {
      setImportingUrl(false);
    }
  }

  async function handleOcrImage(file: File | null) {
    if (!file) {
      return;
    }

    setOcrLoading(true);
    setOcrError("");

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/ocr-image", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;

      if (!response.ok || !data?.text?.trim()) {
        throw new Error(data?.error || "OCR 识别失败，请稍后重试。");
      }

      setArticle(data.text.trim());
      setImportedArticle(null);
      setPreloadedExplanations([]);
      setError("");
    } catch (ocrImageError) {
      setOcrError(ocrImageError instanceof Error ? ocrImageError.message : "OCR 识别失败，请稍后重试。");
    } finally {
      setOcrLoading(false);
    }
  }

  function handleOpenSavedArticle(savedArticle: SavedArticle) {
    setArticle(savedArticle.body);
    setImportedArticle(savedArticle.importedArticle ?? null);
    setPreloadedExplanations([]);
    setError("");
    setReading(true);
  }

  async function handleOpenPublicArticle(id: string) {
    if (openingPublicArticleId) {
      return;
    }

    setOpeningPublicArticleId(id);
    setError("");
    try {
      const response = await fetch(`/api/public-articles/${encodeURIComponent(id)}`);
      const data = (await response.json().catch(() => null)) as
        | {
            article?: {
              body: string;
              importedArticle?: ImportedArticle;
              explanations?: PublicExplanation[];
            };
            error?: string;
          }
        | null;

      if (!response.ok || !data?.article?.body?.trim()) {
        throw new Error(data?.error || "公开文章读取失败，请稍后重试。");
      }

      setArticle(data.article.body);
      setImportedArticle(data.article.importedArticle ?? null);
      setPreloadedExplanations(data.article.explanations ?? []);
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

  if (reading) {
    return (
      <ReaderView
        article={article}
        importedArticle={importedArticle}
        preloadedExplanations={preloadedExplanations}
        onImportedArticleChange={handleImportedArticleChange}
        onBack={() => {
          setSavedArticles(getSavedArticles());
          setArticle("");
          setImportedArticle(null);
          setPreloadedExplanations([]);
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
      initialPublicArticles={initialPublicArticles}
      savedArticles={savedArticles}
      onArticleChange={(value) => {
        setArticle(value);
        setImportedArticle(null);
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
      onDeleteSavedArticle={handleDeleteSavedArticle}
    />
  );
}
