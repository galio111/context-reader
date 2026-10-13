/** Composable surface finishes; independent of a button's action and motion. */
export const MATERIALS = [
  ["original", "原有外观"],
  ["matte", "哑光"],
  ["frosted", "磨砂玻璃"],
  ["clear", "清透玻璃"],
  ["ceramic", "釉面陶瓷"],
  ["chrome", "抛光金属"],
  ["brushed", "拉丝金属"],
  ["soft", "柔软硅胶"],
  ["gel", "透明果冻"],
  ["paper", "压纹纸"],
].map(([id, title]) => ({ id, title }));
export const normalizeMaterial = (value) =>
  MATERIALS.some((m) => m.id === value) ? value : "original";
export function contrastInk(hex) {
  const rgb = (hex.match(/[\da-f]{2}/gi) || ["24", "26", "29"])
    .slice(0, 3)
    .map((n) => parseInt(n, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.179
    ? "#17191c"
    : "#ffffff";
}
export function materialStyle(accent = "#242629") {
  return `--gm-color:${accent};--gm-ink:${contrastInk(accent)}`;
}
export function mountMaterial(root, item, initial, enhance = false) {
  if (item.category !== "buttons") return { update() {}, destroy() {} };
  const target = enhance ? root : root.querySelector("button");
  if (!target) return { update() {}, destroy() {} };
  const attributes = ["data-galio-material"],
    props = ["--gm-color", "--gm-ink", "--gm-x", "--gm-y", "--gm-radius"];
  const originalAttr = attributes.map((k) => [k, target.getAttribute(k)]),
    originalStyle = props.map((k) => [
      k,
      target.style.getPropertyValue(k),
      target.style.getPropertyPriority(k),
    ]);
  const abort = new AbortController();
  let options = initial;
  const update = (next) => {
    options = { ...options, ...next };
    const material = normalizeMaterial(options.material);
    target.dataset.galioMaterial = material;
    target.style.setProperty("--gm-color", options.accent);
    target.style.setProperty("--gm-ink", contrastInk(options.accent));
    target.style.setProperty("--gm-radius", options.radius + "px");
  };
  target.addEventListener(
    "pointermove",
    (e) => {
      if (options.reducedMotion || target.disabled) return;
      const r = target.getBoundingClientRect();
      target.style.setProperty(
        "--gm-x",
        `${((e.clientX - r.left) / r.width) * 100}%`,
      );
      target.style.setProperty(
        "--gm-y",
        `${((e.clientY - r.top) / r.height) * 100}%`,
      );
    },
    { signal: abort.signal, passive: true },
  );
  target.addEventListener(
    "pointerleave",
    () => {
      target.style.removeProperty("--gm-x");
      target.style.removeProperty("--gm-y");
    },
    { signal: abort.signal },
  );
  update(initial);
  return {
    update,
    destroy() {
      abort.abort();
      for (const [k, v] of originalAttr) {
        if (v === null) target.removeAttribute(k);
        else target.setAttribute(k, v);
      }
      for (const [k, v, p] of originalStyle) {
        if (v) target.style.setProperty(k, v, p);
        else target.style.removeProperty(k);
      }
      if (!target.getAttribute("style")) target.removeAttribute("style");
    },
  };
}
