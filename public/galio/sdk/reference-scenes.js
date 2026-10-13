/** Reference exhibits can be embedded as an explicit component of a real project. */
const active = new WeakMap();
const pending = new WeakMap();
const groups = { O: "objects", E: "editorial", M: "motion" };
const root = new URL("../", import.meta.url);
const styles = new Map();
function loadStyle(group) {
  const url = new URL(`studio/exhibits/${group}.css`, root).href;
  if (styles.has(url)) return styles.get(url);
  const ready = new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = resolve;
    link.onerror = () => {
      styles.delete(url);
      link.remove();
      reject(Error("场景样式暂时无法读取"));
    };
    document.head.append(link);
  });
  styles.set(url, ready);
  return ready;
}
export async function mountReference(element, id, options = {}) {
  const group = groups[String(id)[0]];
  if (
    !(element instanceof Element) ||
    !group ||
    !/^(?:[OE]0[1-7]|M0[1-8])$/.test(id)
  )
    throw new TypeError("请选择已收录的设计与页面容器");
  pending.get(element)?.destroy();
  let disposed = false,
    instance;
  const handle = {
    replay() {
      instance?.replay?.();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      instance?.destroy?.();
      if (pending.get(element) === handle) pending.delete(element);
      if (active.get(element) === handle) {
        active.delete(element);
        element.replaceChildren();
      }
    },
  };
  pending.set(element, handle);
  try {
    const [module] = await Promise.all([
      import(new URL(`studio/exhibits/${group}.js`, root).href),
      loadStyle(group),
    ]);
    if (!disposed) {
      active.get(element)?.destroy();
      instance = module.mount(element, id, options);
      active.set(element, handle);
      if (pending.get(element) === handle) pending.delete(element);
    }
    return handle;
  } catch (e) {
    handle.destroy();
    throw e;
  }
}
export { transitionReference } from "../studio/exhibits/motion.js";
