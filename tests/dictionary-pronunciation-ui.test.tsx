import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as React from "react";
import { JSDOM } from "jsdom";
import { groupDictionaryPronunciations, dictionaryPronunciationRows } from "../lib/dictionaryPronunciation";
import { requiresCurrentFormPhonetic } from "../lib/pronunciation";
import type { DictionaryResult } from "../types/dictionary";

test("real pronunciation rows omit redundant labels, send only the word and IPA, and do not fall back to an uncontrolled reading", async () => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://context-reader.com" });
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  let spoken = 0;
  Object.defineProperty(dom.window, "speechSynthesis", { value: { cancel() {}, speak() { spoken++; }, getVoices() { return []; } } });
  Object.defineProperty(dom.window, "SpeechSynthesisUtterance", { value: class {} });
  const calls: Array<{ text: string; accent: string; phonetic: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ code: "provider_tts_failed" }, { status: 502 });
  };
  const { PronunciationButtons } = await import("../components/PronunciationButtons");
  const { render, cleanup, waitFor } = await import("@testing-library/react");
  const { default: userEvent } = await import("@testing-library/user-event");
  // Execute the production rendering function, with its real playback controls.
  const source = readFileSync(new URL("../components/BookDictionary.tsx", import.meta.url), "utf8");
  const start = source.indexOf("function DictionaryPronunciations(");
  const end = source.indexOf("\nfunction readSession", start);
  const js = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const Component = runInNewContext(js + "\nDictionaryPronunciations", { React, PronunciationButtons, groupDictionaryPronunciations, dictionaryPronunciationRows, requiresCurrentFormPhonetic, styles: {}, partOfSpeechLabels: { noun: "名词", verb: "动词" } }) as React.ComponentType<{result: DictionaryResult}>;
  try {
    const pronunciations = [
      { accent: "en-US", partOfSpeech: "noun", phonetic: "/ˈredʒɪment/" },
      { accent: "en-GB", partOfSpeech: "noun", phonetic: "/ˈredʒɪment/" },
      { accent: "en-US", partOfSpeech: "verb", phonetic: "/ˈredʒɪment/" },
      { accent: "en-GB", partOfSpeech: "verb", phonetic: "/ˈredʒɪment/" },
    ] as DictionaryResult["pronunciations"];
    const ui = render(<Component result={{ query: "regiment", pronunciations } as DictionaryResult} />);
    assert.equal(ui.container.querySelectorAll("strong").length, 0);
    assert.equal(ui.container.querySelectorAll("button").length, 2);
    assert.doesNotMatch(ui.container.textContent ?? "", /英美共用|语境发音|the regiment|to regiment/);
    const user = userEvent.setup({ document: dom.window.document });
    await user.click(ui.getByRole("button", { name: "播放 regiment 的美式发音" }));
    await waitFor(() => assert.equal(calls.length, 1));
    await waitFor(() => assert.ok(ui.getByText("云端美音暂时不可用，请稍后重试。")));
    assert.deepEqual(calls[0], { text: "regiment", accent: "en-US", phonetic: "/ˈredʒɪment/" });
    assert.equal(spoken, 0);
    ui.rerender(<Component result={{ query: "record", pronunciations: [
      { accent: "en-US", partOfSpeech: "noun", phonetic: "/ˈrekərd/" },
      { accent: "en-US", partOfSpeech: "verb", phonetic: "/rɪˈkɔːrd/" },
    ] } as DictionaryResult} />);
    assert.deepEqual(Array.from(ui.container.querySelectorAll("strong"), el => el.textContent), ["名词", "动词"]);
    await user.click(ui.getAllByRole("button", { name: "播放 record 的美式发音" })[1]);
    await waitFor(() => assert.equal(calls.length, 2));
    assert.deepEqual(calls[1], { text: "record", accent: "en-US", phonetic: "/rɪˈkɔːrd/" });
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
