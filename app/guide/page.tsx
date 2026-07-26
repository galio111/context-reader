import type { Metadata } from "next";
import { GuidePageContent } from "@/components/GuidePageContent";

export const metadata: Metadata = {
  title: "新手使用指南 | Context Reader",
  description: "从第一次语境阅读到 Anki（背单词的软件）复习，完整了解 Context Reader 的使用方式。",
};

export default function GuidePage() {
  return <GuidePageContent />;
}
