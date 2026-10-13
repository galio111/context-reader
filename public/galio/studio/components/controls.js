/* Portable controls. No assets, global listeners, portals, or business-node replacement.
 * Magnet / TiltedCard / SpotlightCard / Dock / PillNav / ClickSpark calculations adapted
 * from React Bits, Copyright (c) 2026 David Haz, MIT + Commons Clause.
 * Full notice, exact fetched upstream files, and adaptation scope: third-party/controls/react-bits/.
 */
const activeElements = new WeakMap();
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cssProps = [
  "--gc-accent",
  "--gc-on-accent",
  "--gc-font",
  "--gc-size",
  "--gc-radius",
  "--gc-duration",
];
const arrow =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.5"/></svg>';
const check =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const close =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.5"/></svg>';
let nextId = 0;
function styling(el, options, item) {
  const duration =
    Math.max(
      0,
      Math.min(10000, Number(options.duration ?? item.defaultDuration ?? 800)),
    ) / Math.max(0.1, Number(options.speed ?? 1));
  const reduced =
    options.reducedMotion ??
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.style.setProperty("--gc-duration", `${reduced ? 0 : duration}ms`);
  const accent = CSS.supports("color", options.accent || "")
    ? options.accent
    : "#252528";
  el.style.setProperty("--gc-accent", accent);
  const swatch = document.createElement("span");
  swatch.style.color = accent;
  swatch.hidden = true;
  el.append(swatch);
  const rgb = getComputedStyle(swatch)
    .color.match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number) || [37, 37, 40];
  swatch.remove();
  const linear = rgb.map((x) => {
      const v = x / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }),
    luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  el.style.setProperty(
    "--gc-on-accent",
    luminance > 0.179 ? "#18181b" : "#ffffff",
  );
  el.style.setProperty("--gc-font", options.font || "inherit");
  el.style.setProperty(
    "--gc-size",
    `${Math.max(11, Math.min(28, Number(options.fontSize) || 15))}px`,
  );
  el.style.setProperty(
    "--gc-radius",
    options.radius != null
      ? `${Math.max(0, Math.min(32, Number(options.radius) || 0))}px`
      : "10px",
  );
  el.dataset.gcReduced = String(!!reduced);
  return reduced ? 0 : duration;
}
function engine(root, item, initial) {
  let options = { ...initial },
    alive = true,
    duration = styling(root, options, item),
    animations = [],
    timers = [];
  const abort = new AbortController();
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const on = (el, type, fn) =>
    el.addEventListener(type, fn, { signal: abort.signal });
  function animate(el, frames, extra = {}) {
    if (!el || !alive) return;
    const animation = el.animate(frames, {
      duration,
      easing: "cubic-bezier(.22,1,.36,1)",
      fill: "both",
      ...extra,
      ...(duration === 0 ? { duration: 0, delay: 0 } : {}),
    });
    animations.push(animation);
    return animation;
  }
  function cancel() {
    animations.forEach((a) => a.cancel());
    animations = [];
    timers.forEach(clearTimeout);
    timers = [];
  }
  const controller = {
    on,
    animate,
    cancel,
    get options() {
      return options;
    },
    get duration() {
      return duration;
    },
    action(action, detail = {}) {
      if (alive) options.onAction?.(action, { id: item.id, ...detail });
    },
    later(fn, ms) {
      timers.push(
        setTimeout(() => {
          if (alive) fn();
        }, ms),
      );
    },
    update(next = {}) {
      options = { ...options, ...next };
      duration = styling(root, options, item);
      if (!duration) animations.forEach((a) => a.finish());
    },
    pause() {
      animations.forEach((a) => a.pause());
      if (!options.__ownedOnly)
        root.getAnimations({ subtree: true }).forEach((a) => a.pause());
    },
    seek(p) {
      const progress = Math.max(0, Math.min(1, Number(p) || 0));
      (options.__ownedOnly
        ? animations
        : root.getAnimations({ subtree: true })
      ).forEach((a) => {
        a.pause();
        const t = a.effect.getComputedTiming();
        a.currentTime = (t.delay || 0) + progress * (t.duration || duration);
      });
    },
    destroy() {
      alive = false;
      cancel();
      abort.abort();
      media.removeEventListener("change", mediaChanged);
    },
  };
  function mediaChanged() {
    if (options.reducedMotion == null) controller.update({});
  }
  media.addEventListener("change", mediaChanged);
  return controller;
}

// React Bits ClickSpark: evenly spaced rays, eased radial distance, shrinking ray length.
// DOM lines replace the upstream canvas so the library can pause and scrub exact keyframes.
function sparkBurst(element, e, x, y) {
  if (!e.duration) return;
  element.querySelectorAll(".gc-spark").forEach((n) => n.remove());
  const r = element.getBoundingClientRect(),
    cx = x ?? r.width / 2,
    cy = y ?? r.height / 2;
  for (let i = 0; i < 8; i++) {
    const ray = document.createElement("i");
    ray.className = "gc-spark";
    ray.setAttribute("aria-hidden", "true");
    ray.style.left = `${cx}px`;
    ray.style.top = `${cy}px`;
    element.append(ray);
    const angle = (Math.PI * 2 * i) / 8;
    const frames = Array.from({ length: 21 }, (_, n) => {
      const t = n / 20,
        eased = t * (2 - t),
        distance = eased * 28,
        length = 11 * (1 - eased);
      return {
        transform: `translate(${Math.cos(angle) * distance}px,${Math.sin(angle) * distance}px) rotate(${angle}rad) scaleX(${length / 11})`,
        opacity: 1 - t,
        offset: t,
      };
    });
    e.animate(ray, frames, { easing: "linear" });
  }
}

/** Enhance an existing button/link. Text, nodes, listeners, type and form semantics survive. */
export function applyToElement(element, item, options = {}) {
  if (!["buttons", "hover"].includes(item.category))
    throw new Error("This design uses mount() on a registered slot.");
  activeElements.get(element)?.destroy();
  const previous = {
    attrs: ["data-gc-variant", "data-gc-label", "data-gc-reduced"].map((k) => [
      k,
      element.getAttribute(k),
    ]),
    styles: cssProps.map((k) => [k, element.style.getPropertyValue(k)]),
    styleAttribute: element.hasAttribute("style"),
    classAttribute: element.hasAttribute("class"),
    class: element.classList.contains("gc-portable"),
  };
  const variant = item.variant;
  element.classList.add("gc-portable");
  element.dataset.gcVariant = variant;
  // Native capsule buttons carry two visual labels. Only their primary content is business text.
  // For ordinary buttons preserve every original text node, excluding only known effect layers.
  const readLabel = () => {
    const primary = element.querySelector('[data-pill-primary]');
    if (primary) return primary.textContent.trim();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('.gc-decoration,.gcp-visual,[data-pill-hover],[data-pill-circle]')
          ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    let node, text = '';
    while ((node = walker.nextNode())) text += node.textContent;
    return text.trim();
  };
  let plainText = readLabel();
  element.dataset.gcLabel = plainText;
  const decoration = document.createElement("span");
  decoration.className = "gc-decoration";
  decoration.setAttribute("aria-hidden", "true");
  decoration.innerHTML = `<span class="gc-deco-fill"></span><span class="gc-deco-arrow">${arrow}</span><span class="gc-deco-line"></span><span class="gc-deco-copy">${esc(plainText)}</span><span class="gc-deco-key">↵</span>`;
  element.append(decoration);
  const e = engine(element, item, { ...options, __ownedOnly: true });
  let destroyed = false;
  const isDisabled = () => element.matches(':disabled,[aria-disabled="true"]');
  const observer = new MutationObserver(() => {
    syncLabel();
    if (isDisabled()) e.cancel();
  });
  function syncLabel() {
    if (destroyed) return;
    observer.disconnect();
    plainText = readLabel();
    if (element.dataset.gcLabel !== plainText) element.dataset.gcLabel = plainText;
    const copy = decoration.querySelector('.gc-deco-copy');
    if (copy.textContent !== plainText) copy.textContent = plainText;
    if (decoration.parentElement !== element) element.append(decoration);
    observer.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });
  }
  syncLabel();
  function play() {
    e.cancel();
    if (isDisabled()) return;
    const target = decoration.querySelector(
      ["rolling", "roll"].includes(variant)
        ? ".gc-deco-copy"
        : ["underline", "line-draw", "border-trace"].includes(variant)
          ? ".gc-deco-line"
          : ["fill", "radial", "outline", "flip"].includes(variant)
            ? ".gc-deco-fill"
            : ".gc-deco-arrow",
    );
    const frames = {
      rolling: [
        { transform: "translateY(120%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      roll: [
        { transform: "translateY(120%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      fill: [{ transform: "translateY(102%)" }, { transform: "translateY(0)" }],
      radial: [
        { clipPath: "circle(0% at 50% 100%)" },
        { clipPath: "circle(140% at 50% 100%)" },
      ],
      underline: [
        { transform: "scaleX(0)", transformOrigin: "left" },
        { transform: "scaleX(1)", transformOrigin: "left" },
      ],
      "line-draw": [
        { transform: "scaleX(0)", transformOrigin: "left" },
        { transform: "scaleX(1)", transformOrigin: "left" },
      ],
      "border-trace": [
        { clipPath: "inset(0 100% 0 0)" },
        { clipPath: "inset(0 0 0 0)" },
      ],
      flip: [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0)" }],
      outline: [
        { transform: "scale(.8)", opacity: 0 },
        { transform: "scale(1)", opacity: 1 },
      ],
      "arrow-loop": [
        { transform: "translate(-15px,15px)", opacity: 0 },
        { transform: "translate(0,0)", opacity: 1 },
      ],
      split: [
        { transform: "translateX(-9px)", opacity: 0.2 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      circle: [{ transform: "rotate(-45deg)" }, { transform: "rotate(0)" }],
    };
    e.animate(
      target,
      frames[variant] || [
        { transform: "translateX(-8px)", opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
    );
    if (variant === "spotlight") {
      const light = decoration.querySelector(".gc-deco-fill");
      light.style.background =
        "radial-gradient(circle at 50% 50%,#ffffffaa 0%,#ffffff33 35%,transparent 68%)";
      light.style.backgroundSize = "180% 180%";
      e.animate(light, [
        { backgroundPosition: "100% 100%", opacity: 0 },
        { backgroundPosition: "70% 40%", opacity: 0.6, offset: 0.35 },
        { backgroundPosition: "10% 20%", opacity: 0.25 },
      ]);
    }
    if (["magnet", "lift", "tilt", "physical", "reveal"].includes(variant)) {
      const f =
        variant === "tilt"
          ? [
              { transform: "perspective(600px) rotateX(0) rotateY(0)" },
              { transform: "perspective(600px) rotateX(7deg) rotateY(-8deg)" },
            ]
          : variant === "magnet"
            ? [
                { transform: "translate(0,0)" },
                { transform: "translate(18px,-8px)" },
              ]
            : variant === "physical"
              ? [
                  { transform: "translateY(0)" },
                  { transform: "translateY(4px)", offset: 0.3 },
                  { transform: "translateY(0)" },
                ]
              : [
                  { transform: "translateY(0)" },
                  { transform: "translateY(-8px)" },
                ];
      e.animate(element, f);
    }
  }
  e.on(element, "pointerenter", play);
  e.on(element, "focus", play);
  e.on(element, "pointerleave", () => e.cancel());
  e.on(element, "blur", () => e.cancel());
  // The upstream Magnet computes offset / magnetStrength (2). Keep its characteristic
  // attraction but scope movement to this node rather than the entire window.
  if (variant === "magnet")
    e.on(element, "pointermove", (event) => {
      if (e.duration === 0) return;
      const r = element.getBoundingClientRect(),
        from = getComputedStyle(element).transform;
      e.cancel();
      e.animate(
        element,
        [
          { transform: from },
          {
            transform: `translate3d(${(event.clientX - r.left - r.width / 2) / 2}px,${(event.clientY - r.top - r.height / 2) / 2}px,0)`,
          },
        ],
        { duration: Math.min(e.duration, 300) },
      );
    });
  if (variant === "tilt")
    e.on(element, "pointermove", (event) => {
      if (!e.duration) return;
      const r = element.getBoundingClientRect(),
        ox = event.clientX - r.left - r.width / 2,
        oy = event.clientY - r.top - r.height / 2,
        from = getComputedStyle(element).transform;
      e.cancel();
      e.animate(
        element,
        [
          { transform: from },
          {
            transform: `perspective(800px) rotateX(${(oy / (r.height / 2)) * -14}deg) rotateY(${(ox / (r.width / 2)) * 14}deg) scale(1.08)`,
          },
        ],
        { duration: Math.min(e.duration, 300) },
      );
    });
  if (variant === "spotlight") {
    const light = decoration.querySelector(".gc-deco-fill");
    const falloff = (color) => {
      const soft = 0.7,
        core = (1 - soft) ** 1.5 * 0.85;
      const stop = (alpha, at) =>
        `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
      const stops = [stop(1, 0)];
      for (let i = 0; i <= 14; i++) {
        const t = core + ((1 - core) * i) / 14,
          g = (t - core) / (1 - core),
          smooth = 1 - g * g * (3 - 2 * g),
          glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
        stops.push(stop(smooth + (glow - smooth) * soft, t));
      }
      return stops.join(", ");
    };
    const stops = falloff("#fff");
    e.on(element, "pointermove", (event) => {
      const r = element.getBoundingClientRect();
      light.style.backgroundSize = "auto";
      light.style.background = `radial-gradient(circle 150px at ${event.clientX - r.left}px ${event.clientY - r.top}px,${stops})`;
    });
    e.on(element, "pointerdown", () =>
      e.animate(light, [{ opacity: 0.3 }, { opacity: 0.6 }, { opacity: 0.3 }]),
    );
  }
  e.on(element, "click", () => {
    if (isDisabled()) return;
    syncLabel();
    e.action("activate", { label: plainText, value: e.options.data?.value });
    if (variant === "physical") play();
  });
  const result = {
    replay: play,
    update(next) {
      e.update(next);
      syncLabel();
    },
    pause: e.pause,
    seek: e.seek,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      e.destroy();
      decoration.remove();
      if (!previous.class) element.classList.remove("gc-portable");
      if (!previous.classAttribute && !element.classList.length)
        element.removeAttribute("class");
      for (const [k, v] of previous.attrs)
        v == null ? element.removeAttribute(k) : element.setAttribute(k, v);
      for (const [k, v] of previous.styles)
        v ? element.style.setProperty(k, v) : element.style.removeProperty(k);
      if (!previous.styleAttribute && !element.style.length)
        element.removeAttribute("style");
      activeElements.delete(element);
    },
  };
  activeElements.set(element, result);
  return result;
}

export function mount(container, item, options = {}) {
  const root = document.createElement("div");
  root.className = `gc-demo gc-${item.category} gc-v-${item.variant}`;
  root.dataset.component = item.id;
  container.append(root);
  const e = engine(root, item, options),
    uid = `gc-${++nextId}`;
  const data = () => e.options.data || {};
  const label = (fallback) => esc(data().label || fallback);
  const items = (fallback) =>
    Array.isArray(data().items) && data().items.length
      ? data().items
      : fallback.map((label, i) => ({ id: String(i), label, value: label }));
  const status = () => root.querySelector(".gc-status");
  const announce = (text) => {
    if (status()) status().textContent = text;
  };
  let delegated = null,
    replay = () => {},
    updateData = () => {},
    seekState = () => {},
    disposed = false;
  const btn = (text, action, extra = "") =>
    `<button type="button" data-gc-action="${action}" ${extra}>${text}</button>`;
  const animateIn = (target = root.querySelector(".gc-surface"), frames) => {
    e.cancel();
    e.animate(
      target,
      frames || [
        { opacity: 0, transform: "translateY(20px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
    );
  };

  if (["buttons", "hover"].includes(item.category)) {
    const fallback = item.category === "hover" ? "阅读这篇文章" : "开始阅读";
    const card =
      item.category === "hover" &&
      ["tilt", "spotlight", "lift"].includes(item.variant);
    root.innerHTML = `<div class="gc-button-space"><button type="button" class="gc-demo-target ${card ? "gc-preview-card" : ""}">${card ? `<span class="gc-preview-symbol" aria-hidden="true">↗</span><strong>${label(fallback)}</strong><span class="gc-preview-meta">${esc(data().text || "城市、文化与值得再读的故事")}</span>` : label(fallback)}</button></div><output class="gc-status" aria-live="polite"></output>`;
    const target = root.querySelector(".gc-demo-target");
    delegated = applyToElement(target, item, {
      ...options,
      onAction: (a, d) => {
        announce("已打开 · 再次点击可重试");
        e.action(a, d);
      },
    });
    replay = () => delegated.replay();
    updateData = () => {
      const nextLabel = data().label || fallback;
      if (card) {
        target.querySelector("strong").textContent = nextLabel;
        target.querySelector(".gc-preview-meta").textContent =
          data().text || "城市、文化与值得再读的故事";
      } else if (target.firstChild?.nodeType === Node.TEXT_NODE)
        target.firstChild.textContent = nextLabel;
      target.dataset.gcLabel = nextLabel;
      target.querySelector(".gc-deco-copy").textContent = nextLabel;
    };
  }

  if (item.category === "inputs") {
    const v = item.variant;
    const heading = label(
      {
        floating: "你的邮箱",
        search: "搜索文章",
        tags: "文章标签",
        code: "输入验证码",
        stepper: "每日复习上限",
        password: "登录密码",
        editor: "阅读笔记",
        choices: "阅读兴趣",
        slider: "字号",
        select: "排序方式",
      }[v],
    );
    const val =
      data().value ??
      {
        floating: "",
        search: "",
        tags: ["设计"],
        code: "",
        stepper: 100,
        password: "",
        editor: "今天读到了一段很有意思的观点。",
        choices: ["设计"],
        slider: 18,
        select: "最近加入",
      }[v];
    const arr = items(
      v === "select"
        ? ["最近加入", "按字母排序", "最近阅读"]
        : ["设计", "科技", "文化", "商业"],
    );
    let content = "";
    if (v === "floating")
      content = `<div class="gc-floating"><input id="${uid}" type="email" placeholder=" " value="${esc(val)}"><label for="${uid}">${heading}</label></div>`;
    if (v === "search")
      content = `<label for="${uid}">${heading}</label><div class="gc-search-field"><span aria-hidden="true">⌕</span><input id="${uid}" type="search" placeholder="输入关键词" value="${esc(val)}"><kbd>⌘ K</kbd></div><div class="gc-suggestions">${items(
        ["城市与自然", "设计中的留白", "阅读与记忆"],
      )
        .map((i) =>
          btn(
            `${esc(i.label)}<span>↗</span>`,
            "suggest",
            `data-value="${esc(i.value ?? i.label)}" data-id="${esc(i.id)}"`,
          ),
        )
        .join("")}</div>`;
    if (v === "tags")
      content = `<label for="${uid}">${heading}</label><div class="gc-token-field"><div class="gc-tokens"></div><input id="${uid}" placeholder="输入后按回车" aria-label="添加标签"></div>`;
    if (v === "code")
      content = `<label for="${uid}">${heading}</label><input class="gc-code-input" id="${uid}" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${esc(val)}" placeholder="○ ○ ○ ○ ○ ○"><p class="gc-caption">6 位数字</p>`;
    if (v === "stepper")
      content = `<label for="${uid}">${heading}</label><div class="gc-stepper">${btn("−", "minus", 'aria-label="减少"')}<input id="${uid}" type="number" min="0" max="1000" value="${esc(val)}">${btn("+", "plus", 'aria-label="增加"')}</div><p class="gc-caption">个词</p>`;
    if (v === "password")
      content = `<label for="${uid}">${heading}</label><div class="gc-password"><input id="${uid}" type="password" autocomplete="new-password" value="${esc(val)}" placeholder="输入密码">${btn("显示", "reveal", 'aria-pressed="false"')}</div>`;
    if (v === "editor")
      content = `<label for="${uid}">${heading}</label><div class="gc-editor"><textarea id="${uid}" maxlength="240" rows="4">${esc(val)}</textarea><output class="gc-count">${String(val).length} / 240</output></div>`;
    if (v === "choices")
      content = `<span class="gc-label" id="${uid}">${heading}</span><div class="gc-choice-row" role="group" aria-labelledby="${uid}">${arr.map((i) => btn(`${esc(i.label)} <span>${[].concat(val).includes(i.value ?? i.label) ? "✓" : "+"}</span>`, "choice", `data-value="${esc(i.value ?? i.label)}" aria-pressed="${[].concat(val).includes(i.value ?? i.label)}"`)).join("")}</div>`;
    if (v === "slider")
      content = `<label for="${uid}">${heading}<output class="gc-range-value">${esc(val)} px</output></label><input class="gc-range" id="${uid}" type="range" min="12" max="28" step="1" value="${esc(val)}"><p class="gc-type-sample" style="font-size:${Math.max(12, Math.min(28, Number(val) || 18))}px">阅读，让世界慢下来。</p>`;
    if (v === "select")
      content = `<span class="gc-label" id="${uid}">${heading}</span>${btn(`<span class="gc-select-value">${esc(arr.find((i) => String(i.value ?? i.label) === String(val))?.label ?? val)}</span><span>⌄</span>`, "dropdown", `class="gc-select-trigger" aria-expanded="false" aria-haspopup="listbox" aria-labelledby="${uid}"`)}<div class="gc-select-list" role="listbox" hidden>${arr.map((i) => btn(`${esc(i.label)} <span class="gc-selected-tick">✓</span>`, "option", `role="option" aria-selected="${(i.value ?? i.label) === val}" data-value="${esc(i.value ?? i.label)}"`)).join("")}</div>`;
    root.innerHTML = `<div class="gc-field gc-surface">${content}<output class="gc-status" aria-live="polite"></output></div>`;
    let tokens = Array.isArray(val) ? val.map(String) : [];
    function drawTokens() {
      const area = root.querySelector(".gc-tokens");
      if (area)
        area.innerHTML = tokens
          .map(
            (t, i) =>
              `<span>${esc(t)}${btn("×", "remove-token", `data-index="${i}" aria-label="移除 ${esc(t)}"`)}</span>`,
          )
          .join("");
    }
    drawTokens();
    const input = root.querySelector("input,textarea");
    const change = (value) => {
      e.action("change", { value });
      announce(
        v === "search"
          ? ""
          : v === "code" && String(value).length !== 6
            ? ""
            : "已更新",
      );
    };
    if (input)
      e.on(input, "input", () => {
        if (v === "code")
          input.value = input.value.replace(/\D/g, "").slice(0, 6);
        if (v === "editor")
          root.querySelector(".gc-count").textContent =
            `${input.value.length} / 240`;
        if (v === "slider") {
          root.querySelector(".gc-range-value").textContent =
            `${input.value} px`;
          root.querySelector(".gc-type-sample").style.fontSize =
            `${input.value}px`;
        }
        if (v === "search")
          root
            .querySelectorAll("[data-gc-action=suggest]")
            .forEach((b) => (b.hidden = !b.textContent.includes(input.value)));
        if (v !== "tags")
          change(
            ["slider", "stepper"].includes(v)
              ? Number(input.value)
              : input.value,
          );
      });
    if (input)
      e.on(input, "keydown", (event) => {
        if (v === "tags" && event.key === "Enter") {
          event.preventDefault();
          const t = input.value.trim();
          if (t && !tokens.includes(t)) {
            tokens.push(t);
            drawTokens();
            change([...tokens]);
          }
          input.value = "";
        }
        if (event.key === "Escape" && v === "search") {
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    e.on(root, "click", (event) => {
      const b = event.target.closest("[data-gc-action]");
      if (!b) return;
      const a = b.dataset.gcAction;
      if (a === "plus" || a === "minus") {
        input.value = Math.max(
          0,
          Math.min(1000, Number(input.value) + (a === "plus" ? 5 : -5)),
        );
        change(Number(input.value));
      }
      if (a === "reveal") {
        const shown = input.type === "password";
        input.type = shown ? "text" : "password";
        b.textContent = shown ? "隐藏" : "显示";
        b.setAttribute("aria-pressed", shown);
      }
      if (a === "suggest") {
        input.value = b.dataset.value;
        change(input.value);
      }
      if (a === "remove-token") {
        tokens.splice(Number(b.dataset.index), 1);
        drawTokens();
        change([...tokens]);
      }
      if (a === "choice") {
        const selected = b.getAttribute("aria-pressed") !== "true";
        b.setAttribute("aria-pressed", selected);
        b.querySelector("span").textContent = selected ? "✓" : "+";
        change(
          [
            ...root.querySelectorAll(
              "[data-gc-action=choice][aria-pressed=true]",
            ),
          ].map((n) => n.dataset.value),
        );
      }
      if (a === "dropdown") {
        const list = root.querySelector(".gc-select-list"),
          open = list.hidden;
        list.hidden = !open;
        b.setAttribute("aria-expanded", open);
        if (open) {
          animateIn(list, [
            { opacity: 0, transform: "translateY(-8px)" },
            { opacity: 1, transform: "translateY(0)" },
          ]);
          list.querySelector("button").focus();
        }
      }
      if (a === "option") {
        root.querySelector(".gc-select-value").textContent =
          arr.find((i) => String(i.value ?? i.label) === b.dataset.value)?.label ?? b.dataset.value;
        root
          .querySelectorAll("[role=option]")
          .forEach((n) => n.setAttribute("aria-selected", n === b));
        root.querySelector(".gc-select-list").hidden = true;
        const t = root.querySelector(".gc-select-trigger");
        t.setAttribute("aria-expanded", false);
        t.focus();
        change(b.dataset.value);
      }
    });
    e.on(root, "keydown", (event) => {
      if (
        v === "search" &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        input.focus();
      }
      if (v === "select") {
        const list = root.querySelector(".gc-select-list");
        if (event.key === "Escape") {
          list.hidden = true;
          root
            .querySelector(".gc-select-trigger")
            .setAttribute("aria-expanded", false);
          root.querySelector(".gc-select-trigger").focus();
        }
        if (["ArrowDown", "ArrowUp"].includes(event.key) && !list.hidden) {
          event.preventDefault();
          const bs = [...list.querySelectorAll("button")],
            n = bs.indexOf(document.activeElement);
          bs[
            (n + (event.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length
          ].focus();
        }
      }
    });
    replay = () => {
      if (v === "select") {
        const t = root.querySelector(".gc-select-trigger");
        if (t.getAttribute("aria-expanded") === "false") t.click();
        else animateIn(root.querySelector(".gc-select-list"));
      } else {
        input?.focus();
        animateIn(root.querySelector(".gc-field"), [
          { opacity: 0.55, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0)" },
        ]);
      }
    };
    updateData = () => {
      if (!Object.hasOwn(data(), "value")) return;
      const value = data().value;
      if (input && v !== "tags") {
        input.value = value;
        if (v === "editor")
          root.querySelector(".gc-count").textContent =
            `${String(value).length} / 240`;
        if (v === "slider") {
          root.querySelector(".gc-range-value").textContent = `${value} px`;
          root.querySelector(".gc-type-sample").style.fontSize = `${value}px`;
        }
        if (v === "search")
          root
            .querySelectorAll("[data-gc-action=suggest]")
            .forEach(
              (b) => (b.hidden = !b.textContent.includes(String(value))),
            );
      }
      if (v === "tags") {
        tokens = [].concat(value || []).map(String);
        drawTokens();
      }
      if (v === "select") {
        root.querySelector(".gc-select-value").textContent =
          arr.find((i) => String(i.value ?? i.label) === String(value))?.label ?? value;
        root
          .querySelectorAll("[role=option]")
          .forEach((n) =>
            n.setAttribute("aria-selected", n.dataset.value === String(value)),
          );
      }
      if (v === "choices")
        root.querySelectorAll("[data-gc-action=choice]").forEach((n) => {
          const selected = [].concat(value).includes(n.dataset.value);
          n.setAttribute("aria-pressed", selected);
          n.querySelector("span").textContent = selected ? "✓" : "+";
        });
    };
  }

  if (item.category === "navigation") {
    const v = item.variant,
      list = items(["全部文章", "稍后阅读", "阅读笔记"]);
    const initial = list.findIndex((i) => (i.value ?? i.id) === data().value);
    let index = Math.max(0, initial);
    const navButtons = list
      .map((i, n) =>
        btn(
          `${v === "steps" ? `<i>${n + 1}</i>` : ""}${v === "dock" ? `<span class="gc-dock-glyph">${["⌂", "▤", "✎", "◷", "☆"][n % 5]}</span><span class="gc-dock-label">${esc(i.label)}</span>` : v === "pills" ? `<i class="gc-pill-circle" aria-hidden="true"></i><span class="gc-pill-label">${esc(i.label)}</span><span class="gc-pill-hover" aria-hidden="true">${esc(i.label)}</span>` : esc(i.label)}${v === "sidebar" ? "<span>↗</span>" : ""}`,
          "navigate",
          `data-index="${n}" aria-pressed="${n === index}" aria-label="${esc(i.label)}"`,
        ),
      )
      .join("");
    const content = `<div class="gc-nav-content" aria-live="polite"><span class="gc-caption">${label("阅读空间")}</span><h3>${esc(list[index].label)}</h3><p>${esc(data().text || "把值得再读的内容，留在这里。")}</p></div>`;
    const extra =
      v === "mega"
        ? `<div class="gc-mega-list" hidden>${navButtons}</div>`
        : v === "command"
          ? `<div class="gc-command-results" hidden>${navButtons}</div>`
          : "";
    const navigation =
      v === "mega"
        ? btn(
            `${label("浏览文章")} <span>⌄</span>`,
            "nav-open",
            'aria-expanded="false"',
          )
        : v === "command"
          ? `<button type="button" data-gc-action="nav-open" class="gc-command-trigger">⌕ <span>${label("去往…")}</span><kbd>⌘ K</kbd></button>`
          : navButtons;
    root.innerHTML = `<div class="gc-navigation gc-surface"><nav aria-label="${label("阅读分类")}" class="gc-nav-${v}">${navigation}${extra}</nav>${content}</div>`;
    if (v === "dock") {
      const dock = root.querySelector(".gc-nav-dock"),
        tiles = [...dock.querySelectorAll("button")];
      const magnify = (clientX) => {
        if (!e.duration) return;
        tiles.forEach((tile) => {
          const r = tile.getBoundingClientRect(),
            reach = Math.abs(clientX - r.left - r.width / 2) / 120,
            scale =
              1 + 0.55 * (reach < 1 ? Math.cos((reach * Math.PI) / 2) ** 2 : 0);
          tile.style.transform = `translateY(${-((scale - 1) * 23)}px) scale(${scale})`;
        });
      };
      e.on(dock, "pointermove", (event) => magnify(event.clientX));
      e.on(dock, "pointerleave", () =>
        tiles.forEach((t) => (t.style.transform = "")),
      );
      tiles.forEach((tile) => {
        e.on(tile, "focus", () => {
          const r = tile.getBoundingClientRect();
          magnify(r.left + r.width / 2);
        });
        e.on(tile, "blur", () =>
          tiles.forEach((t) => (t.style.transform = "")),
        );
      });
    }
    if (v === "pills")
      root.querySelectorAll("[data-gc-action=navigate]").forEach((tile) => {
        const circle = tile.querySelector(".gc-pill-circle"),
          normal = tile.querySelector(".gc-pill-label"),
          hover = tile.querySelector(".gc-pill-hover");
        const enter = () => {
          const { width: w, height: h } = tile.getBoundingClientRect(),
            R = ((w * w) / 4 + h * h) / (2 * h),
            D = Math.ceil(2 * R) + 2,
            delta =
              Math.ceil(R - Math.sqrt(Math.max(0, R * R - (w * w) / 4))) + 1;
          circle.style.width = `${D}px`;
          circle.style.height = `${D}px`;
          circle.style.bottom = `-${delta}px`;
          circle.style.transformOrigin = `50% ${D - delta}px`;
          e.animate(circle, [
            { transform: "translateX(-50%) scale(0)" },
            { transform: "translateX(-50%) scale(1.2)" },
          ]);
          e.animate(normal, [
            { transform: "translateY(0)" },
            { transform: `translateY(-${h + 8}px)` },
          ]);
          e.animate(hover, [
            { transform: `translateY(${h + 12}px)`, opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ]);
        };
        e.on(tile, "pointerenter", enter);
        e.on(tile, "focus", enter);
        e.on(tile, "pointerleave", () => e.cancel());
        e.on(tile, "blur", () => e.cancel());
      });
    function select(n, notify = true) {
      index = n;
      root
        .querySelectorAll("[data-gc-action=navigate]")
        .forEach((b) =>
          b.setAttribute("aria-pressed", Number(b.dataset.index) === index),
        );
      root.querySelector(".gc-nav-content h3").textContent = list[index].label;
      const r = root.querySelector(".gc-mega-list,.gc-command-results");
      if (r) {
        r.hidden = true;
        root
          .querySelector("[data-gc-action=nav-open]")
          .setAttribute("aria-expanded", false);
      }
      animateIn(root.querySelector(".gc-nav-content"), [
        {
          opacity: 0,
          transform: v === "sidebar" ? "translateX(18px)" : "translateY(12px)",
        },
        { opacity: 1, transform: "translate(0,0)" },
      ]);
      if (notify)
        e.action("navigate", {
          ...list[index],
          value: list[index].value ?? list[index].id,
        });
    }
    e.on(root, "click", (event) => {
      const b = event.target.closest("[data-gc-action]");
      if (!b) return;
      if (b.dataset.gcAction === "navigate") select(Number(b.dataset.index));
      if (b.dataset.gcAction === "nav-open") {
        const r = root.querySelector(".gc-mega-list,.gc-command-results");
        r.hidden = !r.hidden;
        b.setAttribute("aria-expanded", !r.hidden);
        if (!r.hidden) animateIn(r);
      }
    });
    e.on(root, "keydown", (event) => {
      if (
        v === "command" &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        root.querySelector("[data-gc-action=nav-open]").click();
      }
      if (event.key === "Escape") {
        const r = root.querySelector(".gc-mega-list,.gc-command-results");
        if (r && !r.hidden) {
          r.hidden = true;
          root
            .querySelector("[data-gc-action=nav-open]")
            .setAttribute("aria-expanded", false);
          root.querySelector("[data-gc-action=nav-open]").focus();
        }
      }
      const bs = [...root.querySelectorAll("[data-gc-action=navigate]")];
      if (
        ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(
          event.key,
        ) &&
        bs.includes(document.activeElement)
      ) {
        event.preventDefault();
        const i = bs.indexOf(document.activeElement);
        bs[
          (i +
            (["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1) +
            bs.length) %
            bs.length
        ].focus();
      }
    });
    replay = () => {
      if (v === "dock") {
        e.cancel();
        root
          .querySelectorAll(".gc-nav-dock>button")
          .forEach((tile, n) =>
            e.animate(
              tile,
              [
                { transform: "translateY(0) scale(1)" },
                {
                  transform: `translateY(${-12 + n * 3}px) scale(${1.45 - n * 0.08})`,
                },
              ],
              { delay: n * 70 },
            ),
          );
        return;
      }
      if (v === "pills") {
        (
          root.querySelector("[data-gc-action=navigate][aria-pressed=false]") ||
          root.querySelector("[data-gc-action=navigate]")
        ).dispatchEvent(new Event("pointerenter"));
        return;
      }
      if (["mega", "command"].includes(v)) {
        const trigger = root.querySelector("[data-gc-action=nav-open]");
        if (trigger.getAttribute("aria-expanded") === "false") trigger.click();
        else animateIn(root.querySelector(".gc-mega-list,.gc-command-results"));
      } else select((index + 1) % list.length, false);
    };
    updateData = () => {
      const n = list.findIndex((i) => (i.value ?? i.id) === data().value);
      if (n >= 0) select(n, false);
    };
  }

  if (item.category === "overlays") {
    const v = item.variant;
    const list = items(["收藏这篇文章", "加入阅读计划", "复制文章标题"]);
    root.innerHTML = `<div class="gc-overlay-base"><span class="gc-caption">${label("阅读空间")}</span><h3>${esc(data().text || "值得再读的一篇。")}</h3>${btn({ modal: "打开详情", drawer: "阅读设置", sheet: "选择收藏夹", menu: "更多操作", command: "快速查找", popover: "查看作者", fullscreen: "打开目录", confirm: "移出收藏", inline: "编辑笔记", share: "分享文章" }[v], "open", 'class="gc-launch" aria-expanded="false"')}</div><output class="gc-status" aria-live="polite"></output><div class="gc-layer" hidden></div>`;
    const layer = root.querySelector(".gc-layer"),
      trigger = root.querySelector("[data-gc-action=open]");
    let previousFocus = null, interactiveOpen = false;
    const dialogContent = () => {
      if (v === "menu" || v === "fullscreen" || v === "sheet")
        return list
          .map((i) =>
            btn(
              `${esc(i.label)}<span>↗</span>`,
              "select",
              `data-id="${esc(i.id)}" data-value="${esc(i.value ?? i.id)}"`,
            ),
          )
          .join("");
      if (v === "command")
        return `<label class="gc-search-field"><span>⌕</span><input aria-label="搜索操作" placeholder="输入关键词"></label><div class="gc-command-list">${list.map((i) => btn(`${esc(i.label)}<kbd>↵</kbd>`, "select", `data-id="${esc(i.id)}" data-value="${esc(i.value ?? i.id)}"`)).join("")}</div>`;
      if (v === "drawer")
        return `<label class="gc-toggle-row">中文提示 <input type="checkbox" ${(data().values?.hint ?? data().value) ? "checked" : ""}></label><label class="gc-toggle-row">自动播放 <input type="checkbox" ${data().values?.autoplay ? "checked" : ""}></label>${btn("完成", "confirm", 'class="gc-primary"')}`;
      if (v === "share")
        return `<div class="gc-share-value">${esc(data().value || "一篇值得再读的文章")}</div>${btn("复制标题", "copy", 'class="gc-primary"')}`;
      if (v === "inline")
        return `<textarea aria-label="阅读笔记" rows="3">${esc(data().value ?? "记下这次阅读的想法。")}</textarea>${btn("完成", "confirm", 'class="gc-primary"')}`;
      if (v === "confirm")
        return `<p>这篇文章仍保留在阅读历史中。</p><div class="gc-dialog-actions">${btn("保留", "close")}${btn("移出收藏", "confirm", 'class="gc-primary"')}</div>`;
      if (v === "popover")
        return `<p>${esc(data().value || "一位关注文化与城市的作者。")}</p>${btn("关注作者", "confirm", 'class="gc-primary"')}`;
      return `<p>${esc(data().value || "保存好内容，让下一次阅读从这里继续。")}</p>${btn("加入收藏", "confirm", 'class="gc-primary"')}`;
    };
    function open(notify = true) {
      if (!layer.hidden) return;
      interactiveOpen = notify;
      previousFocus = document.activeElement;
      layer.hidden = false;
      trigger.setAttribute("aria-expanded", true);
      layer.innerHTML = `<div class="gc-backdrop" data-gc-action="close"></div><section class="gc-dialog gc-dialog-${v}" role="dialog" aria-label="${label("文章操作")}" tabindex="-1"><header><h3>${label({ modal: "文章详情", drawer: "阅读设置", sheet: "收藏到", menu: "文章操作", command: "快速查找", popover: "关于作者", fullscreen: "阅读目录", confirm: "移出收藏？", inline: "阅读笔记", share: "分享文章" }[v])}</h3>${btn(close, "close", 'class="gc-close" aria-label="关闭"')}</header>${dialogContent()}</section>`;
      const dialog = layer.querySelector(".gc-dialog");
      const frames = {
        drawer: [
          { transform: "translateX(105%)" },
          { transform: "translateX(0)" },
        ],
        sheet: [
          { transform: "translateY(110%)" },
          { transform: "translateY(0)" },
        ],
        fullscreen: [
          { clipPath: "inset(0 0 100% 0)" },
          { clipPath: "inset(0 0 0 0)" },
        ],
        popover: [
          { transform: "translateY(10px) scale(.94)", opacity: 0 },
          { transform: "translateY(0) scale(1)", opacity: 1 },
        ],
        inline: [
          { clipPath: "inset(0 0 100% 0)" },
          { clipPath: "inset(0 0 0 0)" },
        ],
      };
      animateIn(dialog, frames[v]);
      if (notify) (dialog.querySelector("input,textarea,button") || dialog).focus({
        preventScroll: true,
      });
      if (notify) e.action("open");
    }
    function dismiss(notify = true) {
      if (layer.hidden) return;
      e.cancel();
      layer.hidden = true;
      trigger.setAttribute("aria-expanded", false);
      if (interactiveOpen && previousFocus?.isConnected)
        previousFocus.focus({ preventScroll: true });
      if (notify) e.action("close");
    }
    e.on(root, "click", async (event) => {
      const b = event.target.closest("[data-gc-action]");
      if (!b) return;
      const a = b.dataset.gcAction;
      if (a === "open") open();
      if (a === "close") dismiss();
      if (a === "confirm") {
        const value =
          layer.querySelector("textarea")?.value ??
          layer.querySelector("input[type=checkbox]")?.checked ??
          data().value;
        e.action("confirm", {
          value,
          text: data().text,
          ...(v === "drawer"
            ? {
                values: {
                  hint: !!layer.querySelectorAll("input[type=checkbox]")[0]
                    ?.checked,
                  autoplay: !!layer.querySelectorAll("input[type=checkbox]")[1]
                    ?.checked,
                },
              }
            : {}),
        });
        dismiss(false);
        announce(v === "confirm" ? "已移出收藏" : "已完成");
      }
      if (a === "select") {
        const entry = list.find((i) => String(i.id) === b.dataset.id);
        e.action("select", { ...entry, value: entry?.value ?? entry?.id });
        dismiss(false);
        announce(`已选择 · ${entry?.label || ""}`);
      }
      if (a === "copy") {
        try {
          await navigator.clipboard.writeText(
            String(data().value || data().text || "一篇值得再读的文章"),
          );
          if (disposed) return;
          announce("已复制");
          b.textContent = "已复制";
          e.action("copy", { text: data().value || data().text });
        } catch {
          if (!disposed) announce("复制未成功，请选中文字复制");
        }
      }
    });
    e.on(root, "input", (event) => {
      if (v === "command")
        layer
          .querySelectorAll("[data-gc-action=select]")
          .forEach(
            (n) => (n.hidden = !n.textContent.includes(event.target.value)),
          );
    });
    e.on(root, "keydown", (event) => {
      if (event.key === 'Tab' && !layer.hidden && interactiveOpen) {
        const stops = [...layer.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(n=>n.getClientRects().length);
        const first = stops[0], last = stops.at(-1);
        if (stops.length && ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first))) {
          event.preventDefault(); (event.shiftKey ? last : first).focus();
        }
      }
      if (event.key === "Escape" && !layer.hidden) {
        event.stopPropagation();
        dismiss();
      }
    });
    replay = () => {
      dismiss(false);
      open(false);
    };
    updateData = () => {
      root.querySelector('.gc-overlay-base h3').textContent = data().text || '值得再读的一篇。';
    };
  }

  if (item.category === "feedback") {
    const v = item.variant;
    root.innerHTML = `<div class="gc-feedback-space"><div class="gc-feedback-context"><span class="gc-caption">${label("阅读清单")}</span><h3>${esc(data().text || "留住这次灵感。")}</h3></div>${btn({ toast: "加入收藏", button: "保存笔记", inline: "完成阅读", banner: "开启提醒", error: "尝试同步", progress: "整理清单", steps: "导入文章", empty: "建立清单", copy: "复制标题", favorite: "收藏文章", spark: "点一下试试" }[v], "run", 'class="gc-feedback-trigger"')}<div class="gc-feedback-result" aria-live="polite"></div><output class="gc-status" aria-live="polite"></output></div>`;
    const result = root.querySelector(".gc-feedback-result"),
      trigger = root.querySelector(".gc-feedback-trigger");
    let selected = !!data().value,
      runCount = 0;
    const original = trigger.textContent;
    function run(event, notify = true) {
      e.cancel();
      if (notify) runCount++;
      const emit = (action, detail) => {
        if (notify) e.action(action, detail);
      };
      if (v === "toast") {
        result.innerHTML = `<div class="gc-toast">${check}<span>已加入收藏</span>${btn("撤销", "undo")}</div>`;
        animateIn(result.firstChild, [
          { transform: "translateY(30px) scale(.92)", opacity: 0 },
          { transform: "translateY(0) scale(1)", opacity: 1 },
        ]);
        emit("complete", { value: true });
      }
      if (v === "button") {
        trigger.innerHTML = `${check}<span>已保存</span>`;
        e.animate(trigger, [
          { transform: "scale(.94)" },
          { transform: "scale(1)" },
        ]);
        emit("complete", { value: data().value });
      }
      if (v === "inline") {
        result.innerHTML = `<div class="gc-inline-success">${check}<span>已读完，进度已更新</span></div>`;
        animateIn(result.firstChild);
        emit("complete", { value: true });
      }
      if (v === "banner") {
        result.innerHTML = `<div class="gc-banner"><span>下次阅读时提醒你继续</span>${btn(close, "dismiss", 'aria-label="关闭提醒"')}</div>`;
        animateIn(result.firstChild, [
          { transform: "translateY(-100%)", opacity: 0 },
          { transform: "translateY(0)", opacity: 1 },
        ]);
        emit("complete", { value: true });
      }
      if (v === "error") {
        result.innerHTML = `<div class="gc-error"><strong>连接暂时中断</strong><p>笔记已保留，可以再试一次。</p>${btn("重试", "retry")}</div>`;
        animateIn(result.firstChild, [
          { transform: "translateX(-8px)", opacity: 0 },
          { transform: "translateX(6px)", offset: 0.3 },
          { transform: "translateX(-3px)", offset: 0.6 },
          { transform: "translateX(0)", opacity: 1 },
        ]);
        emit("error", { text: "示例连接中断" });
      }
      if (v === "progress") {
        result.innerHTML =
          '<div class="gc-progress-head"><span>整理中</span><output>0%</output></div><div class="gc-progress-track"><i></i></div>';
        const bar = result.querySelector("i");
        const a = e.animate(bar, [
          { transform: "scaleX(0)" },
          { transform: "scaleX(1)" },
        ]);
        a?.finished
          .then(() => {
            if (disposed) return;
            result.querySelector("output").textContent = "100%";
            result.querySelector(".gc-progress-head span").textContent =
              "已整理";
            emit("complete", { value: 100 });
          })
          .catch(() => {});
      }
      if (v === "steps") {
        result.innerHTML =
          '<ol class="gc-process"><li>读取内容</li><li>整理段落</li><li>可以阅读</li></ol>';
        result.querySelectorAll("li").forEach((li, n) => {
          const a = e.animate(
            li,
            [
              { opacity: 0.3, transform: "translateY(10px)" },
              { opacity: 1, transform: "translateY(0)" },
            ],
            { delay: (e.duration * n) / 3, duration: e.duration / 2 },
          );
          if (n === 2)
            a.finished
              .then(() => {
                if (!disposed) emit("complete", { value: true });
              })
              .catch(() => {});
        });
      }
      if (v === "empty") {
        result.innerHTML = `<div class="gc-created"><span>${check}</span><h4>${esc(data().value || "我的阅读清单")}</h4><p>第一篇文章已加入</p></div>`;
        animateIn(result.firstChild, [
          { transform: "scale(.85)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ]);
        emit("complete", { value: data().value || "我的阅读清单" });
      }
      if (v === "copy") {
        navigator.clipboard
          .writeText(String(data().value || data().text || "留住这次灵感。"))
          .then(() => {
            if (disposed) return;
            trigger.innerHTML = `${check}<span>已复制</span>`;
            emit("copy", { text: data().value || data().text });
            announce("已复制到剪贴板");
          })
          .catch(() => {
            if (!disposed) announce("复制未成功，请选中文字复制");
          });
      }
      if (v === "favorite") {
        const visualSelected = notify ? !selected : true;
        if (notify) selected = visualSelected;
        trigger.setAttribute("aria-pressed", visualSelected);
        trigger.innerHTML = `<span class="gc-star">${visualSelected ? "★" : "☆"}</span>${visualSelected ? "已收藏" : "收藏文章"}`;
        e.animate(trigger.querySelector(".gc-star"), [
          { transform: "scale(.5) rotate(-35deg)" },
          { transform: "scale(1.35) rotate(15deg)", offset: 0.65 },
          { transform: "scale(1) rotate(0)" },
        ]);
        emit("toggle", { value: selected });
      }
      if (v === "spark") {
        const r = trigger.getBoundingClientRect();
        sparkBurst(
          trigger,
          e,
          event?.detail ? event.clientX - r.left : undefined,
          event?.detail ? event.clientY - r.top : undefined,
        );
        announce(`已响应 ${notify ? runCount : 1} 次`);
        emit("complete", { value: runCount });
      }
    }
    if (v === "favorite") {
      trigger.setAttribute("aria-pressed", selected);
      trigger.innerHTML = `<span class="gc-star">${selected ? "★" : "☆"}</span>${selected ? "已收藏" : "收藏文章"}`;
    }
    updateData = () => {
      root.querySelector('.gc-feedback-context h3').textContent = data().text || '留住这次灵感。';
      if (v === 'favorite') {
        selected = !!data().value;
        trigger.setAttribute('aria-pressed', selected);
        trigger.innerHTML = `<span class="gc-star">${selected ? '★' : '☆'}</span>${selected ? '已收藏' : '收藏文章'}`;
      }
    };
    e.on(root, "click", (event) => {
      const b = event.target.closest("[data-gc-action]");
      if (!b) return;
      const a = b.dataset.gcAction;
      if (a === "run") run(event);
      if (a === "undo") {
        result.innerHTML = "";
        announce("已撤销");
        e.action("undo", { value: false });
      }
      if (a === "dismiss") {
        result.innerHTML = "";
        e.action("close");
      }
      if (a === "retry") {
        result.innerHTML = `<div class="gc-inline-success">${check} 已重新连接</div>`;
        e.action("retry", { value: true });
        animateIn(result.firstChild);
      }
    });
    replay = () => {
      if (v === "copy") {
        e.cancel();
        e.animate(trigger, [
          { transform: "scale(.95)" },
          { transform: "scale(1)" },
        ]);
        return;
      }
      trigger.textContent = original;
      run(undefined, false);
    };
    seekState = (progress) => {
      if (v === "progress" && result.querySelector("output"))
        result.querySelector("output").textContent =
          `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    };
  }

  const api = {
    replay() {
      if (!disposed) replay();
    },
    pause() {
      delegated?.pause?.();
      e.pause();
    },
    seek(progress) {
      delegated?.seek?.(progress);
      e.seek(progress);
      seekState(progress);
    },
    update(next = {}) {
      if (disposed) return;
      e.update(next);
      delegated?.update(next);
      if (Object.hasOwn(next, "data")) updateData();
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      delegated?.destroy();
      e.destroy();
      root.remove();
    },
  };
  return api;
}
