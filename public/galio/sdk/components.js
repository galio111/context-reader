/** Portable components. Only explicitly registered containers/elements are changed. */
import { mountMaterial, normalizeMaterial } from "./materials.js";
const base = new URL("../", import.meta.url);
const loaders = {
  controls: () => import("../studio/components/controls.js"),
  "motion-layout": () => import("../studio/components/motion-layout.js"),
  "source-library": () => import("../studio/components/source-library.js"),
  "material-library": () => import("../studio/components/material-library.js"),
};
const styles = new Map(),
  active = new WeakMap(),
  pending = new WeakMap();
export const COMPONENT_CATEGORIES = [
  ["buttons", "按钮"],
  ["inputs", "输入与选择"],
  ["navigation", "导航"],
  ["hover", "悬停与按压"],
  ["motion", "页面转场"],
  ["overlays", "弹窗与抽屉"],
  ["feedback", "结果与提示"],
  ["layout", "排版与布局"],
  ["backgrounds", "背景与材质"],
  ["typography", "字体与阅读"],
  ["data", "图表与数据"],
].map(([id, title]) => ({ id, title }));
export const COMPONENT_FONTS = {
  system: '"Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  reading: 'Georgia, "Noto Serif CJK SC", "Source Han Serif SC", SimSun, serif',
  humanist: '"Trebuchet MS", "Microsoft YaHei", sans-serif',
  mono: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace',
};
export async function loadComponentCatalog() {
  const rows = await Promise.all(
    ["controls", "motion-layout", "source-library", "material-library"].map(
      async (name) => {
        const r = await fetch(new URL(`content/components-${name}.json`, base));
        if (!r.ok) throw Error("组件目录暂时无法读取");
        const value = await r.json();
        return Array.isArray(value) ? value : value.items;
      },
    ),
  );
  return rows.flat();
}
export function componentOptions(item, input = {}) {
  const n = (v, min, max, otherwise) =>
    Number.isFinite(Number(v))
      ? Math.max(min, Math.min(max, Number(v)))
      : otherwise;
  return {
    ...input,
    material: normalizeMaterial(input.material),
    accent: /^#[\da-f]{6}$/i.test(input.accent || "")
      ? input.accent
      : "#222326",
    font:
      COMPONENT_FONTS[input.font] ||
      (Object.values(COMPONENT_FONTS).includes(input.font)
        ? input.font
        : COMPONENT_FONTS.system),
    fontSize: n(input.fontSize, 12, 24, 16),
    radius: n(input.radius, 0, 32, 10),
    duration: n(input.duration, 0, 4000, item.defaultDuration || 1000),
    speed: n(input.speed, 0.2, 2, 1),
    reducedMotion:
      input.reducedMotion ??
      globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
      false,
  };
}
function loadStyle(module) {
  const href = new URL(`studio/components/${module}.css`, base).href;
  if (styles.has(href)) return styles.get(href);
  const promise = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = resolve;
    link.onerror = () => {
      styles.delete(href);
      link.remove();
      reject(Error("组件样式暂时无法读取"));
    };
    document.head.append(link);
  });
  styles.set(href, promise);
  return promise;
}
/** Returns a cancellable handle immediately, including while the module is loading. */
export function createComponent(
  element,
  item,
  input = {},
  { enhance = false } = {},
) {
  if (!(element instanceof Element) || !loaders[item?.module])
    throw TypeError("请选择有效组件和页面位置");
  pending.get(element)?.destroy();
  let disposed = false,
    instance,
    material,
    options = componentOptions(item, input);
  const handle = {
    ready: null,
    update(next = {}) {
      options = componentOptions(item, { ...options, ...next });
      const patch = { ...options };
      if (!Object.hasOwn(next, "data")) delete patch.data;
      instance?.update?.(patch);
      material?.update(options);
    },
    replay() {
      instance?.replay?.();
    },
    pause() {
      instance?.pause?.();
    },
    seek(p) {
      instance?.seek?.(Math.max(0, Math.min(1, Number(p) || 0)));
    },
    play() {
      if (instance?.play) instance.play();
      else element.getAnimations({ subtree: true }).forEach((a) => a.play());
    },
    get progress() {
      return instance?.progress;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      material?.destroy();
      instance?.destroy?.();
      if (pending.get(element) === handle) pending.delete(element);
      if (active.get(element) === handle) active.delete(element);
    },
  };
  pending.set(element, handle);
  handle.ready = Promise.all([
    loaders[item.module](),
    loadStyle(item.module),
    loadStyle("materials"),
  ])
    .then(([module]) => {
      if (disposed) return handle;
      if (enhance && !module.applyToElement)
        throw Error("这个组件需要一个已注册的内容位置");
      active.get(element)?.destroy();
      if (!enhance) element.replaceChildren();
      instance = (enhance ? module.applyToElement : module.mount)(
        element,
        item,
        options,
      );
      material = mountMaterial(element, item, options, enhance);
      active.set(element, handle);
      if (pending.get(element) === handle) pending.delete(element);
      return handle;
    })
    .catch((error) => {
      handle.destroy();
      throw error;
    });
  return handle;
}
export async function mountComponent(element, item, options) {
  const h = createComponent(element, item, options);
  await h.ready;
  return h;
}
export async function enhanceComponent(element, item, options) {
  const h = createComponent(element, item, options, { enhance: true });
  await h.ready;
  return h;
}
/** Load once before a route transition; render itself remains synchronous. */
export async function loadPageTransitions() {
  const [module] = await Promise.all([
    loaders["motion-layout"](),
    loadStyle("motion-layout"),
  ]);
  return module.transition;
}
