import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";
import * as React from "react";

interface ReaderProps { article: string; onBack: () => void }
const noop = () => {};
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const chunkError = (file: string) => {
  const error = new Error(`Loading chunk 6063 failed. (error: https://context-reader.com/_next/static/chunks/${file}.js?private=secret#private)`);
  error.name = "ChunkLoadError";
  return error;
};

test("Reader recovery catches real React failures without losing the parent or reloading the page", async t => {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://context-reader.com/?private=secret#private", pretendToBeVisual: true });
  const globals = {
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, CustomEvent: dom.window.CustomEvent,
    Event: dom.window.Event, localStorage: dom.window.localStorage, React,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.scrollTo = noop;
  const require = createRequire(import.meta.url);
  const cssLoader = require.extensions[".css"];
  require.extensions[".css"] = module => { module.exports = {}; };
  const { createRecoverableReader } = await import("../components/RecoverableReader");
  const { reportReaderFailure } = await import("../lib/readerFailureReporting");
  const { render, waitFor, fireEvent, cleanup, act } = await import("@testing-library/react");
  const originalFetch = globalThis.fetch;
  const originalConsoleError = console.error;
  const consoleErrors: unknown[][] = [];
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  console.error = (...args) => { consoleErrors.push(args); };
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return Response.json({ id: "test-reader-report" });
  };
  const originalHref = dom.window.location.href;
  const ReadyReader = ({ article }: ReaderProps) => <article>{article}</article>;
  try {
    await t.test("a rejected import is retried with a fresh lazy instance and the same article", async () => {
      const first = deferred<{ default: React.ComponentType<ReaderProps> }>();
      let loads = 0;
      const Reader = createRecoverableReader<ReaderProps>(() => ++loads === 1 ? first.promise : Promise.resolve({ default: ReadyReader }), "article");
      const article = "Private pasted article that must stay in the browser.";
      const ui = render(<Reader article={article} onBack={noop} />);
      assert.match(ui.getByRole("status").textContent ?? "", /正在打开文章/);
      const error = chunkError("first-recovery");
      await act(async () => { first.reject(error); });
      assert.ok(ui.getByRole("heading", { name: "文章暂时无法打开" }));
      assert.equal(dom.window.document.activeElement?.tagName, "H1");
      assert.ok(consoleErrors.some(args => args.includes(error)), "original exception is retained in the local console");
      assert.equal(loads, 1, "no automatic retry");
      fireEvent.click(ui.getByRole("button", { name: "重新打开" }));
      await waitFor(() => assert.ok(ui.getByText(article)));
      assert.equal(loads, 2, "retry actually calls the rejected loader again");
      assert.equal(dom.window.location.href, originalHref);
      const report = requests.find(item => item.body.code === "READER_CHUNK_LOAD_FAILED")!;
      assert.equal(report.url, "/api/error-reports");
      assert.equal(report.body.page, "https://context-reader.com/");
      assert.match(String(report.body.stack), /first-recovery\.js/);
      assert.doesNotMatch(JSON.stringify(report.body), /secret|private|Private pasted article/);
      cleanup();
    });

    await t.test("ordinary renders retain the loaded Reader's local state and do not reload it", async () => {
      let loads = 0;
      function StatefulReader({ article }: ReaderProps) {
        const [count, setCount] = React.useState(0);
        return <><article>{article}</article><button onClick={() => setCount(value => value + 1)}>Local count {count}</button></>;
      }
      const Reader = createRecoverableReader<ReaderProps>(async () => { loads++; return { default: StatefulReader }; }, "article");
      const ui = render(<Reader article="First article" onBack={noop} />);
      fireEvent.click(await ui.findByRole("button", { name: "Local count 0" }));
      ui.rerender(<Reader article="Updated article" onBack={noop} />);
      assert.ok(ui.getByRole("button", { name: "Local count 1" }));
      assert.ok(ui.getByText("Updated article"));
      assert.equal(loads, 1);
      cleanup();
    });

    await t.test("repeated failures stay recoverable, are deduplicated and never loop", async () => {
      const error = chunkError("repeated-recovery");
      let loads = 0;
      const beforeReports = requests.length;
      const Reader = createRecoverableReader<ReaderProps>(async () => { loads++; throw error; }, "cet");
      const ui = render(<Reader article="CET source" onBack={noop} />);
      await ui.findByRole("heading", { name: "真题暂时无法打开" });
      for (let index = 0; index < 3; index++) {
        fireEvent.click(ui.getByRole("button", { name: "重新打开" }));
        await ui.findByRole("heading", { name: "真题暂时无法打开" });
      }
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
      assert.equal(loads, 4, "exactly one import per explicit attempt");
      assert.equal(requests.length, beforeReports + 1, "the same bundle failure is reported once per minute");
      assert.equal(dom.window.location.href, originalHref);
      cleanup();
    });

    await t.test("render and effect exceptions get safe diagnostics and can be retried", async () => {
      let failRender = true;
      function RenderFailure({ article }: ReaderProps) {
        if (failRender) {
          const error = new TypeError(`Private article: ${article}`);
          error.stack = `TypeError: ${article}\n at render (https://context-reader.com/_next/static/chunks/render-recovery.js:12:7)`;
          throw error;
        }
        return <article>{article}</article>;
      }
      const Reader = createRecoverableReader<ReaderProps>(async () => ({ default: RenderFailure }), "article");
      const article = "secret paragraph contents";
      const ui = render(<Reader article={article} onBack={noop} />);
      await ui.findByRole("heading", { name: "文章暂时无法打开" });
      const report = requests.find(item => item.body.code === "READER_RENDER_FAILED")!;
      assert.match(String(report.body.stack), /render-recovery\.js:12:7/);
      assert.doesNotMatch(JSON.stringify(report.body), /secret|Private article/);
      failRender = false;
      fireEvent.click(ui.getByRole("button", { name: "重新打开" }));
      await ui.findByText(article);
      cleanup();

      function EffectFailure() {
        React.useEffect(() => { throw new Error("private effect payload"); }, []);
        return <article>Before effect</article>;
      }
      const EffectReader = createRecoverableReader<ReaderProps>(async () => ({ default: EffectFailure }), "article");
      const effectUi = render(<EffectReader article={article} onBack={noop} />);
      await effectUi.findByRole("heading", { name: "文章暂时无法打开" });
      assert.doesNotMatch(JSON.stringify(requests), /private effect payload/);
      cleanup();
    });

    await t.test("return during loading ignores late completion and a new article stays selected", async () => {
      const pending = [deferred<{ default: React.ComponentType<ReaderProps> }>(), deferred<{ default: React.ComponentType<ReaderProps> }>()];
      let loads = 0;
      const Reader = createRecoverableReader<ReaderProps>(() => pending[loads++].promise, "article");
      function Parent() {
        const [article, setArticle] = React.useState("First article");
        return article ? <Reader key={article} article={article} onBack={() => setArticle("")} />
          : <button onClick={() => setArticle("Second article")}>Open second article</button>;
      }
      const ui = render(<Parent />);
      fireEvent.click(ui.getByRole("button", { name: "返回首页" }));
      fireEvent.click(ui.getByRole("button", { name: "Open second article" }));
      await act(async () => { pending[0].resolve({ default: ReadyReader }); });
      assert.ok(ui.getByRole("status"));
      assert.equal(ui.queryByText("First article"), null);
      await act(async () => { pending[1].resolve({ default: ReadyReader }); });
      assert.ok(ui.getByText("Second article"));
      assert.equal(loads, 2);
      assert.equal(dom.window.location.href, originalHref);
      cleanup();
    });

    await t.test("offline recovery remains actionable without sending an error report", async () => {
      const online = Object.getOwnPropertyDescriptor(dom.window.navigator, "onLine");
      Object.defineProperty(dom.window.navigator, "onLine", { configurable: true, value: false });
      const beforeReports = requests.length;
      const Reader = createRecoverableReader<ReaderProps>(async () => { throw chunkError("offline-recovery"); }, "article");
      const ui = render(<Reader article="Offline article" onBack={noop} />);
      await ui.findByText("当前离线，联网后可重试。");
      assert.ok(ui.getByRole("button", { name: "重新打开" }));
      assert.equal(requests.length, beforeReports);
      cleanup();
      if (online) Object.defineProperty(dom.window.navigator, "onLine", online);
      else Reflect.deleteProperty(dom.window.navigator, "onLine");
    });

    await t.test("telemetry strips arbitrary content, query strings and non-static stack frames", async () => {
      const error = new RangeError("secret article source");
      error.stack = "RangeError: secret article source\nhttps://other.example/private?token=secret\n/private/source.txt:2\nat https://context-reader.com/_next/static/chunks/privacy-recovery.js:22:3";
      await reportReaderFailure(error, "PrivateComponent(secret) https://context-reader.com/_next/static/chunks/component-recovery.js:1:2", "article", 2);
      const report = requests.at(-1)!.body;
      assert.equal(report.page, "https://context-reader.com/");
      assert.equal(report.technicalMessage, "RangeError: reader component failed");
      assert.doesNotMatch(JSON.stringify(report), /secret|private|PrivateComponent|other\.example/);
      assert.match(String(report.stack), /component-recovery\.js:1:2/);
    });

    await t.test("the real HomeClient returns a failed imported article to its existing homepage draft", async () => {
      const replacements = new Map<string, NodeModule | undefined>();
      const mockModule = (path: string, exports: object) => {
        const filename = require.resolve(path);
        replacements.set(filename, require.cache[filename]);
        require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule;
      };
      let readerFails = true;
      mockModule("../components/AccountProvider", { useAccount: () => ({ account: { authenticated: false, profile: null }, isOffline: false, requireAccount: noop }) });
      mockModule("../components/HomeRedesign", { HomeRedesign: ({ article, onArticleChange, onStartReading }: { article: string; onArticleChange: (value: string) => void; onStartReading: () => void }) =>
        <><textarea aria-label="Imported draft" value={article} onChange={event => onArticleChange(event.target.value)} /><button onClick={onStartReading}>Read draft</button></> });
      mockModule("../components/ReaderView", { ReaderView: ({ article }: ReaderProps) => {
        if (readerFails) throw new Error("home integration failure");
        return <article>{article}</article>;
      } });
      mockModule("../lib/billingClient", { preparePublicBilling: noop });
      mockModule("../lib/coverMediaQueue", { warmCovers: noop });
      const originalGo = dom.window.history.go;
      // Deliver the browser's history event synchronously; HomeClient's genuine
      // popstate and return logic still own navigation and preserve the draft.
      dom.window.history.go = () => dom.window.dispatchEvent(new dom.window.PopStateEvent("popstate"));
      try {
        const { HomeClient } = await import("../components/HomeClient");
        const ui = render(<HomeClient initialPublicArticles={[]} initialCatalogueComplete homeVariant="book" />);
        const article = "This imported article remains available after the Reader fails.";
        fireEvent.change(ui.getByRole("textbox", { name: "Imported draft" }), { target: { value: article } });
        fireEvent.click(ui.getByRole("button", { name: "Read draft" }));
        await ui.findByRole("heading", { name: "文章暂时无法打开" });
        readerFails = false;
        fireEvent.click(ui.getByRole("button", { name: "重新打开" }));
        await ui.findByText(article);
        assert.equal(requests.filter(item => item.url.includes("guest-import")).length, 1, "recovery retries do not consume another guest import");
        readerFails = true;
        ui.rerender(<HomeClient initialPublicArticles={[]} initialCatalogueComplete homeVariant="book" />);
        await ui.findByRole("heading", { name: "文章暂时无法打开" });
        fireEvent.click(ui.getByRole("button", { name: "返回首页" }));
        assert.equal((ui.getByRole("textbox", { name: "Imported draft" }) as HTMLTextAreaElement).value, article);
        readerFails = false;
        fireEvent.click(ui.getByRole("button", { name: "Read draft" }));
        await ui.findByText(article);
        assert.equal(requests.filter(item => item.url.includes("guest-import")).length, 2, "only a new explicit import entry consumes its ordinary guest allowance");
        cleanup();
      } finally {
        dom.window.history.go = originalGo;
        for (const [filename, previous] of replacements) {
          if (previous) require.cache[filename] = previous;
          else delete require.cache[filename];
        }
      }
    });
  } finally {
    cleanup();
    globalThis.fetch = originalFetch;
    console.error = originalConsoleError;
    if (cssLoader) require.extensions[".css"] = cssLoader;
    else delete require.extensions[".css"];
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
