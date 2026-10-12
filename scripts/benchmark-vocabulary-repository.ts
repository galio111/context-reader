import { JSDOM } from "jsdom";
import { IDBFactory } from "fake-indexeddb";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getLearningStorage, initializeLearningStorage, isLearningStorage } from "../lib/learningStorage";

async function main() {
  const modulePath = process.argv[2] || "lib/vocabulary.ts";
  const { getVocabularyEntries, normalizeVocabularyEntries } = await import(pathToFileURL(resolve(modulePath)).href);
  const dom = new JSDOM("", { url: "https://context-reader.com" });
  Object.defineProperty(dom.window, "indexedDB", { value: new IDBFactory() });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: dom.window.CustomEvent });
  await initializeLearningStorage();
  const storage = getLearningStorage();
  try {
    const entries = normalizeVocabularyEntries(Array.from({ length: 1500 }, (_, i) => ({
      id: `entry-${i}`, word: `word-${i}`, sourceSentence: `Sentence number ${i} gives the word a context.`,
      basicMeaning: "示例释义", contextMeaning: "语境释义", createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-01T00:00:00.000Z", anki: { ankiNoteId: i + 1 },
    })));
    storage.setItem("context-reader:vocabulary:v1", JSON.stringify(entries));
    getVocabularyEntries();
    for (let i = 0; i < 10; i++) getVocabularyEntries();
    const samples: number[] = [];
    let count = 0;
    for (let i = 0; i < 60; i++) {
      const start = performance.now();
      count = getVocabularyEntries().length;
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    console.log(JSON.stringify({ modulePath, entries: count, repetitions: samples.length,
      medianMs: samples[Math.floor(samples.length / 2)], p95Ms: samples[Math.floor(samples.length * 0.95)] }));
  } finally { if (isLearningStorage(storage)) storage.close(); dom.window.close(); }
}
void main();
