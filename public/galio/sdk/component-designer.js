import {
  COMPONENT_CATEGORIES,
  COMPONENT_FONTS,
  createComponent,
} from "./components.js";
import { MATERIALS, materialStyle } from "./materials.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clone = (value) => JSON.parse(JSON.stringify(value));
/** The host registers real business targets and applies recipes. No guessing or DOM-wide rewriting. */
export function mountComponentDesigner({
  container,
  catalog,
  initial,
  apply,
  save,
  notify = () => {},
  onExport,
}) {
  let recipe = clone(
      initial || {
        theme: {
          accent: "#292b30",
          font: "system",
          fontSize: 16,
          radius: 10,
          duration: 1100,
          speed: 1,
        },
        components: {},
      },
    ),
    category = "buttons",
    history = [],
    before = false,
    disposed = false;
  const abort = new AbortController();
  let observer,
    previews = new Map();
  function clearPreviews() {
    observer?.disconnect();
    for (const h of previews.values()) h.destroy();
    previews.clear();
  }
  function previewChoices() {
    observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          if (isIntersecting && !previews.has(target)) {
            const item = catalog.find(
              (c) => c.id === target.dataset.gcdPreview,
            );
            const h = createComponent(target, item, {
              ...recipe.theme,
              reducedMotion: true,
              externalControls: true,
            });
            previews.set(target, h);
            h.ready.catch(() => {});
          } else if (!isIntersecting && previews.has(target)) {
            previews.get(target).destroy();
            previews.delete(target);
          }
        }
      },
      { root: container, rootMargin: "80px" },
    );
    container
      .querySelectorAll("[data-gcd-preview]")
      .forEach((n) => observer.observe(n));
  }
  function draw() {
    const scroll = container.scrollTop;
    clearPreviews();
    const list = catalog
        .filter((c) => c.category === category)
        .sort(
          (a, b) =>
            Number(b.module === "material-library") -
            Number(a.module === "material-library"),
        ),
      selected = recipe.components[category];
    container.innerHTML = `<header class="gcd-heading"><b>换个设计</b><button data-gcd="undo" ${!history.length ? "disabled" : ""} aria-label="撤销上一处设计">↶</button></header><div class="gcd-shortcuts"><button data-gcd="before" aria-pressed="${before}">${before ? "查看修改后" : "查看修改前"}</button><button data-gcd="save">保存方案</button></div><details class="gcd-category"><summary>${COMPONENT_CATEGORIES.find((c) => c.id === category)?.title} <span>⌄</span></summary><div>${COMPONENT_CATEGORIES.map((c) => `<button data-gcd="category" data-id="${c.id}" aria-pressed="${category === c.id}">${c.title}</button>`).join("")}</div></details><div class="gcd-options"><label>颜色<input type="color" data-gcd-option="accent" value="${esc(recipe.theme.accent)}"></label>${category === "buttons" ? `<details class="gcd-materials"><summary>按钮材质</summary><div>${MATERIALS.map((m) => `<button data-gcd="material" data-id="${m.id}" aria-pressed="${(recipe.theme.material || "original") === m.id}"><span data-galio-material="${m.id}" style="${materialStyle(recipe.theme.accent || "#242629")};--gm-radius:9px">Aa</span><small>${m.title}</small></button>`).join("")}</div></details>` : ""}<details class="gcd-font"><summary>字体与尺寸</summary><div class="gcd-font-list">${Object.keys(
      COMPONENT_FONTS,
    )
      .map(
        (id, i) =>
          `<button data-gcd="font" data-id="${id}" aria-pressed="${recipe.theme.font === id}">${["现代黑体", "中英衬线", "人文黑体", "等宽字体"][i]}</button>`,
      )
      .join("")}</div>${[
      ["fontSize", "字号", 12, 24, 1],
      ["radius", "圆角", 0, 32, 1],
      ["duration", "时长", 400, 3000, 100],
    ]
      .map(
        ([id, label, min, max, step]) =>
          `<label>${label}<output>${recipe.theme[id]}</output><input type="range" data-gcd-option="${id}" aria-label="${label}" min="${min}" max="${max}" step="${step}" value="${recipe.theme[id]}"></label>`,
      )
      .join(
        "",
      )}</details></div><div class="gcd-variants"><button data-gcd="select" data-id="" aria-pressed="${!selected}"><b>原来的样子</b><small>恢复这个位置</small></button>${list.map((c) => `<div class="gcd-choice"><div class="gcd-thumb"><div inert data-gcd-preview="${esc(c.id)}"></div></div><button data-gcd="select" data-id="${esc(c.id)}" aria-pressed="${selected === c.id}"><b>${esc(c.title)}</b><small>${esc(c.source?.name)}</small></button></div>`).join("")}</div><footer><button data-gcd="export">导出方案</button><a href="/library.html#components/${category}" target="_blank" rel="noopener">看完整演示 ↗</a></footer>`;
    container.scrollTop = scroll;
    previewChoices();
  }
  function applyNow(previous) {
    if (disposed) return;
    Promise.resolve(
      apply(before ? { theme: {}, components: {} } : clone(recipe), previous),
    ).catch(() => notify("这次替换没能完成，原内容已保留"));
  }
  function change(next) {
    const previous = clone(recipe);
    history.push(previous);
    if (history.length > 50) history.shift();
    recipe = clone(next);
    before = false;
    applyNow(previous);
    draw();
  }
  container.addEventListener(
    "click",
    async (event) => {
      const b = event.target.closest("[data-gcd]");
      if (!b) return;
      const action = b.dataset.gcd;
      if (action === "category") {
        category = b.dataset.id;
        container.scrollTop = 0;
        draw();
      }
      if (action === "select") {
        const next = clone(recipe);
        if (b.dataset.id) next.components[category] = b.dataset.id;
        else delete next.components[category];
        change(next);
      }
      if (action === "font")
        change({ ...recipe, theme: { ...recipe.theme, font: b.dataset.id } });
      if (action === "material")
        change({
          ...recipe,
          theme: { ...recipe.theme, material: b.dataset.id },
        });
      if (action === "undo" && history.length) {
        const previous = clone(recipe);
        recipe = history.pop();
        before = false;
        applyNow(previous);
        draw();
      }
      if (action === "before") {
        before = !before;
        applyNow();
        draw();
      }
      if (action === "save") {
        b.disabled = true;
        try {
          await save?.(clone(recipe));
          notify("方案已保存");
        } catch (e) {
          notify(e.message || "保存未完成，请导出方案保留");
        } finally {
          b.disabled = false;
        }
      }
      if (action === "export") {
        const data = clone(recipe);
        if (onExport) onExport(data);
        else {
          const a = document.createElement("a"),
            url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
          a.href = url;
          a.download = "galio-project.json";
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 500);
        }
      }
    },
    { signal: abort.signal },
  );
  let dragBase;
  container.addEventListener(
    "input",
    (event) => {
      const key = event.target.dataset.gcdOption;
      if (!key) return;
      dragBase ||= clone(recipe);
      recipe.theme[key] =
        event.target.type === "range"
          ? Number(event.target.value)
          : event.target.value;
      before = false;
      const output = event.target.parentElement.querySelector("output");
      if (output) output.value = recipe.theme[key];
      applyNow(dragBase);
    },
    { signal: abort.signal },
  );
  container.addEventListener(
    "change",
    (event) => {
      if (!event.target.dataset.gcdOption) return;
      if (dragBase) {
        history.push(dragBase);
        dragBase = null;
      }
      draw();
    },
    { signal: abort.signal },
  );
  draw();
  applyNow();
  return {
    getRecipe: () => clone(recipe),
    select(id, options = {}) {
      const c = catalog.find((x) => x.id === id);
      if (!c) return;
      category = c.category;
      change({
        theme: { ...recipe.theme, ...options },
        components: { ...recipe.components, [category]: id },
      });
    },
    destroy() {
      disposed = true;
      clearPreviews();
      abort.abort();
      container.replaceChildren();
    },
  };
}
