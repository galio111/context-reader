"use client";

import { useEffect, useState } from "react";
import { ArticleInput } from "@/components/ArticleInput";
import { ReaderView } from "@/components/ReaderView";
import { deleteSavedArticle, getSavedArticles } from "@/lib/articles";
import { hasClickableWords } from "@/lib/tokenizer";
import type { SavedArticle } from "@/types/article";

export default function Home() {
  const [article, setArticle] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
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
    setReading(true);
  }

  function handleOpenSavedArticle(savedArticle: SavedArticle) {
    setArticle(savedArticle.body);
    setError("");
    setReading(true);
  }

  function handleDeleteSavedArticle(id: string) {
    if (!window.confirm("确定要删除这篇已保存文章吗？")) {
      return;
    }
    setSavedArticles(deleteSavedArticle(id));
  }

  if (reading) {
    return (
      <ReaderView
        article={article}
        onBack={() => {
          setSavedArticles(getSavedArticles());
          setReading(false);
        }}
        onArticleSaved={() => setSavedArticles(getSavedArticles())}
      />
    );
  }

  return (
    <ArticleInput
      article={article}
      error={error}
      savedArticles={savedArticles}
      onArticleChange={(value) => {
        setArticle(value);
        if (error) {
          setError("");
        }
      }}
      onStartReading={handleStartReading}
      onOpenSavedArticle={handleOpenSavedArticle}
      onDeleteSavedArticle={handleDeleteSavedArticle}
    />
  );
}
