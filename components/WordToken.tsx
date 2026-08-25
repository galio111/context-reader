"use client";

import { memo } from "react";
import type { ReaderToken } from "@/types/reader";

interface WordTokenProps {
  token: ReaderToken;
  selected: boolean;
  highlighted?: boolean;
  targeted?: boolean;
}

function WordTokenComponent({
  token,
  selected,
  highlighted = false,
  targeted = false,
}: WordTokenProps) {
  if (token.type === "text") {
    return <>{token.value}</>;
  }

  return (
    <span
      role="button"
      tabIndex={0}
      data-reader-token
      data-selected={selected ? "true" : undefined}
      data-highlighted={highlighted ? "true" : undefined}
      data-token-id={token.id}
      data-source-target={targeted ? "true" : undefined}
      aria-current={targeted ? "location" : undefined}
      className={`relative inline cursor-pointer select-none rounded transition-colors duration-150 ${
        targeted
          ? "bg-[#efc75e]/80 text-[#111111] ring-1 ring-[#9a6a08]/65 shadow-[inset_0_-2px_0_#a66f00]"
          : selected
          ? "bg-[#0066cc]/10 text-[#1d1d1f] ring-1 ring-[#0066cc]/30"
          : highlighted
            ? "bg-[#f5d76e]/45 text-[#111111] ring-1 ring-[#b78b00]/30"
          : "hover:bg-[#f5f5f7] hover:text-[#1d1d1f]"
      }`}
    >
      {token.value}
    </span>
  );
}

export const WordToken = memo(WordTokenComponent);
