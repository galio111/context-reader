"use client";
import { createContext, useContext } from "react";
import type { ReaderToken } from "@/types/reader";
export interface ReaderTextAdapter {
  register: (id: string, tokens: ReaderToken[]) => () => void;
  selected: Set<string>;
}
export const ReaderTextContext = createContext<ReaderTextAdapter | null>(null);
export const useReaderTextAdapter = () => useContext(ReaderTextContext);
