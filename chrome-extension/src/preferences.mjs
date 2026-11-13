export const defaults = Object.freeze({ width: 420, height: 520, opacity: 96, background: "#ffffff", text: "#1d1d1f", accent: "#0066cc", autoLookup: false });
const bounded = (v, fallback, min, max) => Number.isFinite(Number(v)) ? Math.round(Math.min(max, Math.max(min, Number(v)))) : fallback;
export function normalizePreferences(value = {}) {
  const color = (key) => /^#[0-9a-f]{6}$/i.test(value[key]) ? value[key] : defaults[key];
  return { width: bounded(value.width, defaults.width, 300, 900), height: bounded(value.height, defaults.height, 240, 1000),
    opacity: bounded(value.opacity, defaults.opacity, 20, 100), background: color("background"), text: color("text"), accent: color("accent"), autoLookup: value.autoLookup === true };
}
export function rgba(hex, opacity) { return `rgba(${[1,3,5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(",")},${opacity / 100})`; }
