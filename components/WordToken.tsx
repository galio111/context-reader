"use client";

import type { ReaderToken } from "@/types/reader";

interface WordTokenProps {
  token: ReaderToken;
  selected: boolean;
}

export function WordToken({
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
          ? "bg-amber-100 text-amber-950 ring-1 ring-amber-300"
          : "hover:bg-gray-100 hover:text-gray-950"
      }`}
    >
      {token.value}
    </span>
  );
}
