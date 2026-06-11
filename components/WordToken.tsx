"use client";

import { memo } from "react";
import type { ReaderToken } from "@/types/reader";

interface WordTokenProps {
  token: ReaderToken;
  selected: boolean;
}

function WordTokenComponent({
  token,
  selected,
}: WordTokenProps) {
  if (token.type === "text") {
    return <>{token.value}</>;
  }

  return (
    <span
      role="button"
      tabIndex={0}
      data-token-id={token.id}
      className={`relative inline cursor-pointer rounded px-0.5 transition ${
        selected
          ? "bg-[#0066cc]/10 text-[#1d1d1f] ring-1 ring-[#0066cc]/30"
          : "hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
      }`}
    >
      {token.value}
    </span>
  );
}

export const WordToken = memo(WordTokenComponent);
