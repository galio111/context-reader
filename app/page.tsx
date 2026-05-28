"use client";

import { useState } from "react";
import { ArticleInput } from "@/components/ArticleInput";
import { ReaderView } from "@/components/ReaderView";
import { hasClickableWords } from "@/lib/tokenizer";

export default function Home() {
  const [article, setArticle] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");

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

  if (reading) {
    return <ReaderView article={article} onBack={() => setReading(false)} />;
  }

  return (
    <ArticleInput
      article={article}
      error={error}
      onArticleChange={(value) => {
        setArticle(value);
        if (error) {
          setError("");
        }
      }}
      onStartReading={handleStartReading}
    />
  );
}
