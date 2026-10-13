/* Reusable structures, not source-site artwork. See COMPONENTS-MOTION-RESEARCH.md. */
const running = new WeakMap();
const cleanups = new WeakMap();
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n) || 0));
const variants = [
  "pixel",
  "float",
  "push",
  "rise",
  "iris",
  "curtain",
  "diagonal",
  "shutters",
  "doors",
  "page-turn",
  "shared",
  "depth",
  "stagger",
  "animated-content",
];
const easing = "cubic-bezier(.65,0,.25,1)";

function snapshot(element) {
  const clone = element.cloneNode(true);
  clone.removeAttribute("id");
  clone.removeAttribute("name");
  clone.removeAttribute("autofocus");
  clone.removeAttribute("style");
  for (const n of clone.querySelectorAll("[id],[name],[autofocus]")) {
    n.removeAttribute("id");
    n.removeAttribute("name");
    n.removeAttribute("autofocus");
  }
  for (const [i, n] of [
    ...clone.querySelectorAll("input,textarea,select"),
  ].entries()) {
    const original = element.querySelectorAll("input,textarea,select")[i];
    n.value = original.value;
    if ("checked" in n) n.checked = original.checked;
  }
  clone.inert = true;
  clone.setAttribute("aria-hidden", "true");
  return clone;
}

/** Render real destination synchronously; old inert pixels provide the animation only.
 * No wrappers around live content, preserving selectors, focus and event handlers.
 */
export function transition(
  element,
  render,
  {
    variant = "float",
    duration = 1000,
    speed = 1,
    reverse = false,
    reducedMotion = false,
    paused = false,
  } = {},
) {
  running.get(element)?.cancel();
  const bounds = element.getBoundingClientRect(),
    media = matchMedia("(prefers-reduced-motion: reduce)");
  const before = snapshot(element),
    oldShared = element.querySelector("[data-motion-shared]");
  const oldRect = oldShared?.getBoundingClientRect(),
    shared = oldShared ? snapshot(oldShared) : null;
  render();
  const after =
    reverse && ["curtain", "doors"].includes(variant)
      ? snapshot(element)
      : null;
  if (reducedMotion || media.matches || duration <= 0 || !bounds.width)
    return {
      finished: Promise.resolve(),
      cancel() {},
      pause() {},
      seek() {},
      play() {},
      progress: 1,
    };
  const time = clamp(duration, 100, 10000) / Math.max(0.1, Number(speed) || 1);
  const saved = {
    position: element.style.position,
    overflow: element.style.overflow,
    isolation: element.style.isolation,
  };
  if (getComputedStyle(element).position === "static")
    element.style.position = "relative";
  element.style.overflow = "hidden";
  element.style.isolation = "isolate";
  const live = [...element.children],
    animations = [],
    layers = [],
    restorers = [];
  let drawFrame = null,
    pixelRaf = 0;
  let done = false,
    resolveDone;
  const finished = new Promise((resolve) => (resolveDone = resolve));
  const layer = (clone) => {
    Object.assign(clone.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      margin: "0",
      zIndex: "4",
      pointerEvents: "none",
      overflow: "hidden",
      background: getComputedStyle(element).backgroundColor,
    });
    clone.classList.add("gcm-snapshot");
    layers.push(clone);
    element.append(clone);
    return clone;
  };
  const old = layer(before);
  const animate = (node, frames, delay = 0, length = 1) => {
    const a = node.animate(frames, {
      duration: time * length,
      delay: time * delay,
      easing,
      fill: "both",
    });
    if (paused) a.pause();
    animations.push(a);
    return a;
  };
  const enter = (frames, delay = 0, length = 1) =>
    live.forEach((n) => animate(n, frames, delay, length));
  const front = () =>
    live.forEach((n) => {
      const p = n.style.position,
        z = n.style.zIndex;
      if (getComputedStyle(n).position === "static")
        n.style.position = "relative";
      n.style.zIndex = "5";
      restorers.push(() => {
        n.style.position = p;
        n.style.zIndex = z;
      });
    });
  const sign = reverse ? -1 : 1;
  switch (variant) {
    case "pixel": {
      // React Bits PixelTransition: seeded cell threshold, cover, switch, uncover.
      // Copyright (c) 2026 David Haz, MIT + Commons Clause; retained under third-party/motion-layout.
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        zIndex: "7",
        pointerEvents: "none",
      });
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = bounds.width * dpr;
      canvas.height = bounds.height * dpr;
      const ctx = canvas.getContext("2d");
      layers.push(canvas);
      element.append(canvas);
      const clock = animate(old, [{ opacity: 1 }, { opacity: 1 }]);
      const hash = (x, y, seed) => {
        let h =
          Math.imul(x + 1, 0x27d4eb2d) ^
          Math.imul(y + 1, 0x165667b1) ^
          Math.imul(seed + 1, 0x2c1b3c6d);
        h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
        h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
        return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
      };
      const cols = 10,
        cell = canvas.width / cols,
        rows = Math.ceil(canvas.height / cell),
        top = (canvas.height - rows * cell) / 2;
      drawFrame = () => {
        const progress = clamp((clock.currentTime || 0) / time, 0, 1);
        old.style.visibility = progress < 0.5 ? "visible" : "hidden";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (progress <= 0 || progress >= 1) return;
        const covering = progress < 0.5,
          local = covering ? progress * 2 : progress * 2 - 1;
        ctx.fillStyle =
          getComputedStyle(element).getPropertyValue("--gcm-accent").trim() ||
          "#292929";
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++) {
            const noise = hash(col, row, reverse ? 8 : 1);
            const amount = local >= noise === covering ? 1 : 0;
            if (amount) {
              const left = Math.round(col * cell),
                upper = Math.round(top + row * cell);
              ctx.fillRect(
                left,
                upper,
                Math.round((col + 1) * cell) - left,
                Math.round(top + (row + 1) * cell) - upper,
              );
            }
          }
      };
      const tick = () => {
        drawFrame();
        if (clock.playState === "running")
          pixelRaf = requestAnimationFrame(tick);
      };
      drawFrame();
      if (!paused) pixelRaf = requestAnimationFrame(tick);
      drawFrame.resume = () => {
        cancelAnimationFrame(pixelRaf);
        pixelRaf = requestAnimationFrame(tick);
      };
      break;
    }
    case "push":
      animate(old, [
        { transform: "translateX(0)" },
        { transform: `translateX(${-100 * sign}%)` },
      ]);
      enter([
        { transform: `translateX(${100 * sign}%)` },
        { transform: "translateX(0)" },
      ]);
      break;
    case "rise":
      animate(old, [
        { transform: "translateY(0)" },
        { transform: `translateY(${-100 * sign}%)` },
      ]);
      enter([
        { transform: `translateY(${100 * sign}%)` },
        { transform: "translateY(0)" },
      ]);
      break;
    case "iris":
      front();
      animate(old, [{ transform: "scale(1)" }, { transform: "scale(.9)" }]);
      enter([
        {
          clipPath: reverse
            ? "circle(150% at 50% 50%)"
            : "circle(0% at 50% 50%)",
        },
        {
          clipPath: reverse
            ? "circle(0% at 50% 50%)"
            : "circle(150% at 50% 50%)",
        },
      ]);
      if (reverse) {
        // Put outgoing content on top when closing the aperture.
        live.forEach((n) => (n.style.zIndex = "3"));
        old.style.zIndex = "5";
        animations.forEach((a) => a.cancel());
        animations.length = 0;
        animate(old, [
          { clipPath: "circle(150% at 50% 50%)" },
          { clipPath: "circle(0% at 50% 50%)" },
        ]);
      }
      break;
    case "curtain":
      if (!reverse) old.remove();
      for (let i = 0; i < 2; i++) {
        const half = layer((reverse ? after : before).cloneNode(true));
        half.style.clipPath = i ? "inset(0 0 0 50%)" : "inset(0 50% 0 0)";
        const frames = [
          { transform: "translateX(0)" },
          { transform: `translateX(${i ? 100 : -100}%)` },
        ];
        animate(half, reverse ? frames.reverse() : frames);
      }
      if (!reverse)
        enter([{ transform: "scale(.86)" }, { transform: "scale(1)" }]);
      break;
    case "diagonal":
      animate(old, [
        {
          clipPath: reverse
            ? "polygon(0 0,100% 0,100% 100%,0 100%)"
            : "polygon(0 0,100% 0,100% 100%,0 100%)",
        },
        {
          clipPath: reverse
            ? "polygon(100% 0,100% 0,100% 0,100% 0)"
            : "polygon(0 100%,0 100%,0 100%,0 100%)",
        },
      ]);
      enter([
        { transform: `translate(${8 * sign}%,${-8 * sign}%)` },
        { transform: "translate(0,0)" },
      ]);
      break;
    case "shutters":
      old.remove();
      for (let i = 0; i < 6; i++) {
        const strip = layer(before.cloneNode(true));
        strip.style.clipPath = `inset(${(i * 100) / 6}% 0 ${100 - ((i + 1) * 100) / 6}% 0)`;
        animate(
          strip,
          [
            { transform: "translateX(0)" },
            { transform: `translateX(${-105 * sign}%)` },
          ],
          i * 0.055,
          0.7,
        );
      }
      enter([{ transform: "scale(1.05)" }, { transform: "scale(1)" }]);
      break;
    case "doors":
      if (!reverse) old.remove();
      for (let i = 0; i < 2; i++) {
        const half = layer((reverse ? after : before).cloneNode(true));
        half.style.clipPath = i ? "inset(0 0 0 50%)" : "inset(0 50% 0 0)";
        half.style.transformOrigin = i ? "100% 50%" : "0% 50%";
        const frames = [
          { transform: "perspective(1000px) rotateY(0deg)", opacity: 1 },
          {
            transform: `perspective(1000px) rotateY(${i ? -100 : 100}deg)`,
            opacity: 0,
          },
        ];
        animate(half, reverse ? frames.reverse() : frames);
      }
      if (!reverse)
        enter([{ transform: "scale(.7)" }, { transform: "scale(1)" }]);
      break;
    case "page-turn":
      old.style.transformOrigin = reverse ? "100% 50%" : "0% 50%";
      old.style.backfaceVisibility = "hidden";
      animate(old, [
        {
          transform: "perspective(1300px) rotateY(0deg)",
          filter: "brightness(1)",
        },
        {
          transform: `perspective(1300px) rotateY(${-115 * sign}deg)`,
          filter: "brightness(.5)",
        },
      ]);
      enter([
        { transform: "translateX(5%)", filter: "brightness(.7)" },
        { transform: "translateX(0)", filter: "brightness(1)" },
      ]);
      break;
    case "shared": {
      const target = element.querySelector("[data-motion-shared]"),
        nextRect = target?.getBoundingClientRect();
      animate(old, [{ opacity: 1 }, { opacity: 0 }], 0, 0.65);
      enter([{ opacity: 0 }, { opacity: 1 }], 0.3, 0.7);
      if (shared && oldRect && nextRect) {
        const hidden = target.style.visibility;
        target.style.visibility = "hidden";
        restorers.push(() => (target.style.visibility = hidden));
        const source = layer(shared);
        Object.assign(source.style, {
          inset: "auto",
          left: `${nextRect.left - bounds.left}px`,
          top: `${nextRect.top - bounds.top}px`,
          width: `${nextRect.width}px`,
          height: `${nextRect.height}px`,
          zIndex: "6",
          transformOrigin: "0 0",
          background: getComputedStyle(target).background,
        });
        animate(source, [
          {
            transform: `translate(${oldRect.left - nextRect.left}px,${oldRect.top - nextRect.top}px) scale(${oldRect.width / nextRect.width},${oldRect.height / nextRect.height})`,
            borderRadius: "16px",
          },
          {
            transform: "translate(0,0) scale(1)",
            borderRadius: getComputedStyle(target).borderRadius,
          },
        ]);
      }
      break;
    }
    case "depth":
      animate(old, [
        { transform: "scale(1)", filter: "blur(0px)", opacity: 1 },
        {
          transform: `scale(${reverse ? 0.6 : 1.7})`,
          filter: "blur(9px)",
          opacity: 0,
        },
      ]);
      enter([
        {
          transform: `scale(${reverse ? 1.7 : 0.6})`,
          filter: "blur(9px)",
          opacity: 0,
        },
        { transform: "scale(1)", filter: "blur(0px)", opacity: 1 },
      ]);
      break;
    case "stagger": {
      animate(
        old,
        [
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: `translateY(${-12 * sign}%)` },
        ],
        0,
        0.3,
      );
      const content = live.flatMap((n) =>
        n.matches("[data-motion-item]")
          ? [n]
          : [...n.querySelectorAll("[data-motion-item]")],
      );
      (content.length ? content : live).slice(0, 12).forEach((n, i) =>
        animate(
          n,
          [
            { transform: `translateY(${70 * sign}px)`, opacity: 0 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          0.12 + i * 0.045,
          0.5,
        ),
      );
      break;
    }
    case "animated-content":
      // React Bits AnimatedContent defaults: 100px vertical, opacity 0, power3.out.
      animate(old, [{ opacity: 1 }, { opacity: 0 }], 0, 0.2);
      live.forEach((n) => {
        const a = n.animate(
          [
            { transform: `translateY(${100 * sign}px) scale(.9)`, opacity: 0 },
            { transform: "translateY(0) scale(1)", opacity: 1 },
          ],
          {
            duration: time,
            easing: "cubic-bezier(.215,.61,.355,1)",
            fill: "both",
          },
        );
        if (paused) a.pause();
        animations.push(a);
      });
      break;
    default:
      front();
      animate(old, [
        { transform: "scale(1)", filter: "brightness(1)" },
        { transform: "scale(.88)", filter: "brightness(.65)" },
      ]);
      enter([
        {
          transform: `translateY(${reverse ? -110 : 110}%) rotateX(${reverse ? 8 : -8}deg)`,
          borderRadius: "24px",
        },
        { transform: "translateY(0) rotateX(0deg)", borderRadius: "0px" },
      ]);
  }
  function cleanup() {
    if (done) return;
    done = true;
    cancelAnimationFrame(pixelRaf);
    animations.forEach((a) => a.cancel());
    layers.forEach((n) => n.remove());
    restorers.forEach((fn) => fn());
    Object.assign(element.style, saved);
    media.removeEventListener("change", onReduced);
    if (running.get(element) === controller) running.delete(element);
    resolveDone();
  }
  function onReduced(e) {
    if (e.matches) cleanup();
  }
  const controller = {
    finished,
    cancel: cleanup,
    pause() {
      animations.forEach((a) => a.pause());
      cancelAnimationFrame(pixelRaf);
    },
    play() {
      if (!done) {
        animations.forEach((a) => a.play());
        drawFrame?.resume?.();
      }
    },
    seek(progress) {
      if (done) return;
      animations.forEach((a) => {
        a.pause();
        a.currentTime = clamp(progress, 0, 1) * time;
      });
      cancelAnimationFrame(pixelRaf);
      drawFrame?.();
    },
    get progress() {
      return done
        ? 1
        : clamp(
            Math.max(0, ...animations.map((a) => a.currentTime || 0)) / time,
            0,
            1,
          );
    },
  };
  running.set(element, controller);
  media.addEventListener("change", onReduced);
  Promise.allSettled(animations.map((a) => a.finished)).then(() => {
    if (!animations.some((a) => a.playState === "paused")) cleanup();
  });
  return controller;
}

function setOptions(element, options = {}) {
  if (options.accent && CSS.supports("color", options.accent)) {
    element.style.setProperty("--gcm-accent", options.accent);
    if (/^#[0-9a-f]{6}$/i.test(options.accent)) {
      const rgb = [1,3,5].map(i => parseInt(options.accent.slice(i,i+2),16) / 255)
        .map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
      const light = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] > .179;
      element.style.setProperty("--gcm-on-accent", light ? "#202022" : "#ffffff");
    }
  }
  if (options.font)
    element.style.setProperty("--gcm-font", String(options.font));
  if (options.fontSize != null)
    {
    element.style.setProperty("--gcm-scale", String(clamp(options.fontSize, 12, 36) / 16));
    element.style.setProperty(
      "--gcm-size",
      `${clamp(options.fontSize, 12, 36)}px`,
    );
    }
  if (options.radius != null)
    element.style.setProperty(
      "--gcm-radius",
      `${clamp(options.radius, 0, 40)}px`,
    );
  if ("reducedMotion" in options)
    element.classList.toggle("gcm-reduced", Boolean(options.reducedMotion));
}

// Registered project surfaces can have ID-level styles. Inline changes remain
// reversible and never replace their business nodes or event listeners.
function reversibleStyles() {
  const records = new Map();
  return {
    set(node, property, value) {
      if (!records.has(node))
        records.set(node, {
          original: node.getAttribute("style"),
          baseline: node.style.cssText,
          values: new Map(),
        });
      const record = records.get(node);
      const properties = property === "background"
        ? ["background-color", "background-image", "background-position", "background-size", "background-repeat", "background-origin", "background-clip", "background-attachment"]
        : [property];
      const baseline = document.createElement("span");
      baseline.style.cssText = record.baseline;
      for (const key of properties) if (!record.values.has(key))
        record.values.set(key, [baseline.style.getPropertyValue(key), baseline.style.getPropertyPriority(key)]);
      node.style.setProperty(property, value);
    },
    restore() {
      for (const [node, record] of records) {
        for (const key of record.values.keys()) node.style.removeProperty(key);
        for (const [key, [value, priority]] of record.values)
          if (value) node.style.setProperty(key, value, priority);
        // Preserve an unrelated style edited by the application while mounted.
        const baseline = document.createElement("span");
        baseline.style.cssText = record.baseline;
        if (node.style.cssText === baseline.style.cssText) {
          if (record.original == null) node.removeAttribute("style");
          else node.setAttribute("style", record.original);
        }
        if (!node.style.cssText && record.original == null)
          node.removeAttribute("style");
      }
    },
  };
}

function applyProjectSurface(element, item, options, styles) {
  if (item.category === "backgrounds") {
    styles.set(element, "background", "none");
    // Copy the actual public component declarations, retaining dynamic CSS vars.
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.selectorText !== `.gcm-backgrounds-${item.variant}`) continue;
        for (const key of rule.style)
          if (key.startsWith("background") || ["color", "box-shadow"].includes(key))
            styles.set(element, key, rule.style.getPropertyValue(key));
      }
    }
    if (getComputedStyle(element).position === "static") styles.set(element, "position", "relative");
    styles.set(element, "isolation", "isolate");
    return;
  }
  if (item.category !== "typography") return;
  const sans = options.font || 'Arial, "Microsoft YaHei", sans-serif';
  const serif = 'Georgia, "SimSun", serif';
  const mono = '"Cascadia Mono", Consolas, "Microsoft YaHei", monospace';
  const size = clamp(options.fontSize ?? 16, 12, 36);
  const scheme = {
    system: [sans, sans, 600, "normal", 2.3],
    editorial: [serif, '"SimSun", Georgia, serif', 400, "normal", 2.5],
    "mono-label": [sans, sans, 700, "normal", 2.3],
    condensed: ['"Arial Narrow", Impact, sans-serif', sans, 400, "normal", 2.7],
    "serif-title": [serif, sans, 400, "italic", 2.4],
    mono: [mono, mono, 400, "normal", 1.8],
    bilingual: [serif, '"SimSun", serif', 400, "italic", 2.1],
    contrast: [sans, serif, 700, "normal", 2.5],
    underlined: [serif, sans, 400, "normal", 2.3],
    centered: [sans, sans, 700, "normal", 2.4],
    "blur-text": [sans, sans, 500, "normal", 2.3],
    decrypted: [mono, sans, 500, "normal", 2.2],
  }[item.variant] || [sans, sans, 500, "normal", 2.3];
  const nodes = [element, ...element.querySelectorAll("h1,h2,h3,p,blockquote,li,small,[data-typography-label]")];
  for (const node of nodes) {
    const heading = node.matches("h1,h2,h3");
    const label = node.matches("small,[data-typography-label]");
    styles.set(node, "font-family", heading ? scheme[0] : label && item.variant === "mono-label" ? mono : scheme[1]);
    styles.set(node, "font-size", `${size * (heading ? scheme[4] * (node.matches("h3") ? .64 : 1) : label ? .76 : 1)}px`);
    styles.set(node, "line-height", heading ? "1.22" : "1.9");
    if (heading) {
      styles.set(node, "font-weight", String(scheme[2]));
      styles.set(node, "font-style", scheme[3]);
      styles.set(node, "letter-spacing", item.variant === "condensed" ? "0" : "-.025em");
      if (options.accent && CSS.supports("color", options.accent))
        styles.set(node, "color", options.accent);
      if (item.variant === "underlined") {
        styles.set(node, "text-decoration-line", "underline");
        styles.set(node, "text-decoration-thickness", "1px");
        styles.set(node, "text-underline-offset", "6px");
      }
    }
    if (item.variant === "centered") styles.set(node, "text-align", "center");
  }
}

/** Styles only: live contents and listeners are untouched. Must load motion-layout.css. */
export function applyToElement(element, item, options = {}) {
  cleanups.get(element)?.destroy();
  if (!["backgrounds", "typography", "layout"].includes(item.category))
    throw new Error("This component needs mount() or transition().");
  const cls = [
    "gcm-applied",
    `gcm-${item.category}`,
    `gcm-${item.category}-${item.variant}`,
  ];
  const already = cls.filter((c) => element.classList.contains(c));
  const hadClassAttribute = element.hasAttribute("class");
  const hadStyleAttribute = element.hasAttribute("style");
  const properties = [
    "--gcm-accent",
    "--gcm-on-accent",
    "--gcm-font",
    "--gcm-size",
    "--gcm-scale",
    "--gcm-radius",
    "--gcm-x",
    "--gcm-y",
  ];
  const previous = properties.map((p) => [
    p,
    element.style.getPropertyValue(p),
    element.style.getPropertyPriority(p),
  ]);
  const reduced = element.classList.contains("gcm-reduced");
  const surface = reversibleStyles();
  element.classList.add(...cls);
  setOptions(element, options);
  applyProjectSurface(element, item, options, surface);
  let dead = false,
    textEffect = null,
    opts = { ...options };
  const abort = new AbortController();
  let material = null;
  const playText = () => {
    if (
      item.category !== "typography" ||
      !["blur-text", "decrypted"].includes(item.variant)
    )
      return;
    textEffect?.cancel();
    const heading = element.matches("h1,h2,h3")
      ? element
      : element.querySelector("h1,h2,h3");
    if (heading && !heading.childElementCount)
      textEffect = animateText(heading, item.variant, {
        duration: opts.duration ?? 1600,
        speed: opts.speed,
        reducedMotion: opts.reducedMotion,
      });
  };
  if (item.category === "backgrounds" && item.variant === "magnet-lines") {
    material = document.createElement("div");
    material.className = "gcm-background-layer";
    material.setAttribute("aria-hidden", "true");
    material.style.zIndex = "-1";
    material.innerHTML = Array.from(
      { length: 140 },
      () => "<span></span>",
    ).join("");
    element.prepend(material);
    element.addEventListener(
      "pointermove",
      (e) => {
        if (
          opts.reducedMotion ||
          matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          return;
        const nodes = [...material.children],
          rects = nodes.map((n) => n.getBoundingClientRect());
        nodes.forEach((n, i) => {
          const rect = rects[i],
            b = e.clientX - rect.x - rect.width / 2,
            a = e.clientY - rect.y - rect.height / 2,
            c = Math.sqrt(a * a + b * b) || 1;
          n.style.setProperty(
            "--rotate",
            `${((Math.acos(b / c) * 180) / Math.PI) * (a > 0 ? 1 : -1)}deg`,
          );
        });
      },
      { signal: abort.signal },
    );
  }
  if (item.category === "backgrounds" && item.variant === "spotlight")
    element.addEventListener(
      "pointermove",
      (e) => {
        if (opts.reducedMotion) return;
        const rect = element.getBoundingClientRect();
        element.style.setProperty(
          "--gcm-x",
          `${((e.clientX - rect.left) / rect.width) * 100}%`,
        );
        element.style.setProperty(
          "--gcm-y",
          `${((e.clientY - rect.top) / rect.height) * 100}%`,
        );
      },
      { signal: abort.signal },
    );
  const controller = {
    update(next) {
      if (!dead) {
        opts = { ...opts, ...next };
        setOptions(element, next);
        applyProjectSurface(element, item, opts, surface);
        if (next.reducedMotion) textEffect?.cancel();
      }
    },
    replay: playText,
    seek(progress) {
      textEffect?.seek(progress);
    },
    pause() {
      textEffect?.pause();
    },
    play() {
      textEffect?.play();
    },
    get progress() {
      return textEffect?.progress ?? 1;
    },
    destroy() {
      if (dead) return;
      dead = true;
      textEffect?.cancel();
      abort.abort();
      material?.remove();
      surface.restore();
      cls
        .filter((c) => !already.includes(c))
        .forEach((c) => element.classList.remove(c));
      previous.forEach(([p, v, priority]) =>
        v
          ? element.style.setProperty(p, v, priority)
          : element.style.removeProperty(p),
      );
      element.classList.toggle("gcm-reduced", reduced);
      if (!hadClassAttribute && !element.className)
        element.removeAttribute("class");
      if (!hadStyleAttribute && !element.style.cssText)
        element.removeAttribute("style");
      if (cleanups.get(element) === controller) cleanups.delete(element);
    },
  };
  playText();
  cleanups.set(element, controller);
  return controller;
}

const defaultItems = [
  {
    id: "reading",
    title: "让阅读回到日常",
    description: "从一篇短文开始，留意那些值得停下来的句子。",
    meta: "阅读 · 6 分钟",
  },
  {
    id: "notes",
    title: "把想法留在身边",
    description: "一条小小的批注，下一次读到时就有了新的意义。",
    meta: "笔记 · 12 条",
  },
  {
    id: "collection",
    title: "整理自己的书架",
    description: "喜欢的文章和刚认识的词，都可以慢慢积累。",
    meta: "收藏 · 24 篇",
  },
  {
    id: "review",
    title: "回顾本周收获",
    description: "没有固定的速度，按照自己的节奏继续。",
    meta: "回顾 · 本周",
  },
];
const defaultData = {
  title: "留一点时间，给好内容。",
  subtitle: "你的阅读空间",
  body: "读一篇文章，写几行笔记。让那些一闪而过的想法，有机会变成自己的东西。",
  english: "Make room for a good idea.",
  items: defaultItems,
  series: [
    { label: "一", value: 24, secondary: 14 },
    { label: "二", value: 42, secondary: 22 },
    { label: "三", value: 31, secondary: 18 },
    { label: "四", value: 58, secondary: 32 },
    { label: "五", value: 44, secondary: 27 },
    { label: "六", value: 76, secondary: 41 },
    { label: "日", value: 62, secondary: 36 },
  ],
  target: 60,
};
const normalize = (raw) => ({
  ...defaultData,
  ...raw,
  items: Array.isArray(raw?.items) ? raw.items : defaultItems,
  series: Array.isArray(raw?.series) ? raw.series : defaultData.series,
});
const button = (label, action, extra = "") =>
  `<button type="button" data-gcm-action="${action}" ${extra}>${label}</button>`;

function pageMarkup(data, page) {
  return `<article class="gcm-page gcm-page-${page}"><header data-motion-item><span>${esc(data.subtitle)}</span><span>${page ? "文章" : "书架"}</span></header>${page ? `<div class="gcm-page-cover gcm-cover-expanded" data-motion-shared><span>READING</span><b>打开新的视角</b></div><h2 data-motion-item>${esc(data.items[0]?.title || data.title)}</h2><p data-motion-item>${esc(data.body)}</p><div data-motion-item>${button("← 返回书架", "back")}</div>` : `<h2 data-motion-item>${esc(data.title)}</h2><p data-motion-item>${esc(data.body)}</p><button class="gcm-page-cover" data-motion-shared data-gcm-action="next" type="button"><span>READING</span><b>${esc(data.items[0]?.title)}</b><i>打开文章 ↗</i></button><footer data-motion-item>${esc(data.items[0]?.meta)}<span>01 / 04</span></footer>`}</article>`;
}

function renderLayout(v, data, selected = 0) {
  if (!data.items.length)
    return `<div class="gcm-layout gcm-empty"><h3>${esc(data.title)}</h3><p>没有符合条件的内容</p></div>`;
  selected = clamp(selected, 0, data.items.length - 1);
  const item = (x, i) =>
    `<button type="button" class="gcm-content-item" data-gcm-action="select" data-index="${i}" aria-pressed="${selected === i}"><span class="gcm-item-meta">${esc(x.meta || `${i + 1}`)}</span><h3>${esc(x.title)}</h3><p>${esc(x.description)}</p><i aria-hidden="true">↗</i></button>`;
  const intro = `<header class="gcm-layout-intro"><span>${esc(data.subtitle)}</span><h2>${esc(data.title)}</h2><p>${esc(data.body)}</p></header>`;
  const rows = data.items.map(item).join("");
  const current = data.items[selected % data.items.length];
  const detail = `<article class="gcm-layout-detail"><span>${esc(current.meta)}</span><h2>${esc(current.title)}</h2><p>${esc(current.description)}</p>${button("打开内容 ↗", "open", `data-index="${selected}"`)}</article>`;
  const toolbar = `<div class="gcm-layout-toolbar">${button("重新排列", "reorder")}${button("下一项 →", "next-item")}</div>`;
  if (v === "master-detail")
    return `<div class="gcm-layout gcm-layout-${v}"><nav aria-label="内容列表">${rows}</nav>${detail}</div>${toolbar}`;
  if (v === "sidebar")
    return `<div class="gcm-layout gcm-layout-${v}"><nav aria-label="分类">${data.items.map((x, i) => button(esc(x.title), "select", `data-index="${i}" aria-current="${i === selected ? "page" : "false"}"`)).join("")}</nav><main>${intro}${detail}</main></div>${toolbar}`;
  if (v === "tabs")
    return `<div class="gcm-layout gcm-layout-${v}">${intro}<nav aria-label="内容分类">${data.items.map((x, i) => button(esc(x.title), "select", `data-index="${i}" aria-pressed="${i === selected}"`)).join("")}</nav>${detail}</div>${toolbar}`;
  if (v === "split")
    return `<div class="gcm-layout gcm-layout-${v}">${intro}<div class="gcm-layout-content">${detail}<div class="gcm-split-progress">${data.items.map((x, i) => button(String(i + 1).padStart(2, "0"), "select", `data-index="${i}" aria-pressed="${i === selected}"`)).join("")}</div></div></div>${toolbar}`;
  return `<div class="gcm-layout gcm-layout-${v}">${intro}<div class="gcm-layout-content">${rows}</div></div>${toolbar}`;
}

function renderTypography(v, data, externalControls = false) {
  const words = esc(data.english).split(" ");
  return `<div class="gcm-type-preview gcm-typography gcm-typography-${v}"><span class="gcm-type-meta">${esc(data.subtitle)}</span><h2>${v === "contrast" ? `<span>${words.slice(0, 2).join(" ")}</span><em>${words.slice(2).join(" ")}</em>` : esc(data.english)}</h2><h3>${esc(data.title)}</h3><p>${esc(data.body)}</p><div class="gcm-type-numbers">Aa · 中文 · 0123456789</div></div><div class="gcm-type-tools">${!externalControls && ["blur-text", "decrypted"].includes(v) ? button("播放文字", "text-replay") : ""}${button("英文 / 中文", "language")}${button("试读长段落", "long-copy")}</div>`;
}

function animateText(
  element,
  variant,
  { duration = 1600, speed = 1, reducedMotion = false } = {},
) {
  const settled = { cancel() {}, pause() {}, seek() {}, play() {}, progress: 1 };
  if (!element) return settled;
  duration = Math.max(1, Number(duration) || 1600) / Math.max(.1, Number(speed) || 1);
  const text = element.textContent,
    aria = element.getAttribute("aria-label"),
    animations = [],
    media = matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0,
    dead = false,
    elapsed = 0,
    last = 0;
  const restore = () => {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf);
    animations.forEach((a) => a.cancel());
    element.textContent = text;
    aria == null
      ? element.removeAttribute("aria-label")
      : element.setAttribute("aria-label", aria);
    media.removeEventListener("change", onReduced);
  };
  const onReduced = (e) => {
    if (e.matches) restore();
  };
  if (reducedMotion || media.matches)
    return settled;
  media.addEventListener("change", onReduced);
  element.setAttribute("aria-label", text);
  element.textContent = "";
  if (variant === "blur-text") {
    // React Bits BlurText: identical blur 10→5→0, opacity 0→.5→1, y -50→5→0 keyframes.
    const words = text.includes(" ") ? text.split(" ") : [...text];
    words.forEach((word, i) => {
      const span = document.createElement("span");
      span.style.display = "inline-block";
      span.setAttribute("aria-hidden", "true");
      span.textContent =
        word + (text.includes(" ") && i < words.length - 1 ? "\u00a0" : "");
      element.append(span);
      animations.push(
        span.animate(
          [
            {
              filter: "blur(10px)",
              opacity: 0,
              transform: "translateY(-50px)",
            },
            {
              filter: "blur(5px)",
              opacity: 0.5,
              transform: "translateY(5px)",
              offset: 0.5,
            },
            { filter: "blur(0px)", opacity: 1, transform: "translateY(0)" },
          ],
          {
            duration: duration * 0.62,
            delay: (i / (words.length || 1)) * duration * 0.38,
            easing: "linear",
            fill: "both",
          },
        ),
      );
    });
    Promise.allSettled(animations.map((a) => a.finished)).then(() => {
      if (!animations.some((a) => a.playState === "paused")) restore();
    });
  } else {
    // React Bits DecryptedText: same center-out computeOrder and revealed-index shuffle.
    const span = document.createElement("span");
    span.setAttribute("aria-hidden", "true");
    element.append(span);
    const order = [],
      middle = Math.floor(text.length / 2);
    let offset = 0;
    while (order.length < text.length) {
      const idx =
        offset % 2 === 0 ? middle + offset / 2 : middle - Math.ceil(offset / 2);
      if (idx >= 0 && idx < text.length) order.push(idx);
      offset++;
    }
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+";
    const paint = (progress) => {
      const revealed = new Set(
        order.slice(0, Math.ceil(progress * order.length)),
      );
      span.textContent = [...text]
        .map((char, i) =>
          char === " "
            ? " "
            : revealed.has(i)
              ? char
              : chars[Math.floor(Math.random() * chars.length)],
        )
        .join("");
    };
    const tick = (now) => {
      elapsed += last ? now - last : 0;
      last = now;
      paint(clamp(elapsed / duration, 0, 1));
      if (elapsed < duration) raf = requestAnimationFrame(tick);
      else restore();
    };
    paint(0);
    raf = requestAnimationFrame(tick);
    return {
      cancel: restore,
      pause() {
        cancelAnimationFrame(raf);
        last = 0;
      },
      play() {
        if (dead) return;
        cancelAnimationFrame(raf);
        last = 0;
        raf = requestAnimationFrame(tick);
      },
      seek(progress) {
        if (dead) return;
        cancelAnimationFrame(raf);
        last = 0;
        elapsed = clamp(progress, 0, 1) * duration;
        paint(clamp(progress, 0, 1));
      },
      get progress() { return dead ? 1 : clamp(elapsed / duration, 0, 1); },
    };
  }
  return {
    cancel: restore,
    pause() {
      animations.forEach((a) => a.pause());
    },
    play() {
      if (!dead) animations.forEach((a) => a.play());
    },
    seek(progress) {
      if (dead) return;
      animations.forEach((a) => {
        a.pause();
        a.currentTime = clamp(progress, 0, 1) * duration;
      });
    },
    get progress() {
      return dead ? 1 : clamp(Math.max(0, ...animations.map(a => a.currentTime || 0)) / duration, 0, 1);
    },
  };
}

function chartSeries(data, range) {
  const safe = data.series.slice(0, 56).map((x, i) => ({
    label: String(x.label ?? i + 1),
    value: Math.max(0, Number(x.value) || 0),
    secondary: Math.max(0, Number(x.secondary) || 0),
  }));
  return range === "recent"
    ? safe.slice(-Math.max(3, Math.ceil(safe.length / 2)))
    : safe;
}
function renderData(v, data, range = "all", selected = -1, sort = false) {
  let values = chartSeries(data, range);
  if (!values.length)
    return `<div class="gcm-data gcm-empty"><h3>${esc(data.title)}</h3><p>暂无记录</p></div>`;
  if (sort) values = [...values].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...values.map((x) => x.value + x.secondary)),
    total = values.reduce((a, x) => a + x.value, 0),
    w = 440,
    h = 190,
    pad = 26;
  const x = (i) => pad + (w - pad * 2) * (i / Math.max(1, values.length - 1));
  const y = (n) => h - pad - ((h - pad * 2) * n) / max;
  const points = values.map((n, i) => `${x(i)},${y(n.value)}`).join(" ");
  const dots = values
    .map(
      (n, i) =>
        `<circle cx="${x(i)}" cy="${y(n.value)}" r="${i === selected ? 6 : 4}" tabindex="0" role="button" data-gcm-action="point" data-index="${i}" aria-label="${esc(n.label)}：${n.value}"><title>${esc(n.label)}：${n.value}</title></circle>`,
    )
    .join("");
  const lines = [0, 0.5, 1]
    .map(
      (n) =>
        `<line x1="${pad}" x2="${w - pad}" y1="${y(n * max)}" y2="${y(n * max)}"/><text x="4" y="${y(n * max) + 4}">${Math.round(n * max)}</text>`,
    )
    .join("");
  let chart = "";
  if (["line", "area", "sparkline", "target"].includes(v))
    chart = `<svg class="gcm-chart gcm-chart-${v}" viewBox="0 0 ${w} ${h}" aria-label="${esc(data.subtitle)}趋势"><g class="gcm-grid">${v === "sparkline" ? "" : lines}</g>${v === "area" ? `<polygon class="gcm-area" points="${pad},${h - pad} ${points} ${w - pad},${h - pad}"/>` : ""}<polyline points="${points}" class="gcm-line"/>${v === "target" ? `<line class="gcm-target-line" x1="${pad}" x2="${w - pad}" y1="${y(Math.min(max, Number(data.target) || 60))}" y2="${y(Math.min(max, Number(data.target) || 60))}"/><text x="${w - pad}" y="${y(Math.min(max, Number(data.target) || 60)) - 7}" text-anchor="end">目标 ${esc(data.target)}</text>` : ""}${dots}</svg>`;
  if (["bars", "stacked"].includes(v))
    chart = `<div class="gcm-bars">${values.map((n, i) => `<button type="button" data-gcm-action="point" data-index="${i}" aria-label="${esc(n.label)}：${n.value}${v === "stacked" ? `，复习 ${n.secondary}` : ""}" style="--value:${(n.value / max) * 100}%;--secondary:${(n.secondary / max) * 100}%"><span class="gcm-bar-space"><i class="gcm-bar-main">${n.value}</i>${v === "stacked" ? `<i class="gcm-bar-second">${n.secondary}</i>` : ""}</span><span>${esc(n.label)}</span></button>`).join("")}</div>`;
  if (v === "donut") {
    let offset = 0;
    chart = `<div class="gcm-donut"><svg viewBox="0 0 180 180"><circle class="gcm-donut-base" cx="90" cy="90" r="62"/>${values
      .map((n, i) => {
        const length = total ? (n.value / total) * 389.56 : 0;
        const markup = `<circle tabindex="0" role="button" data-gcm-action="point" data-index="${i}" aria-label="${esc(n.label)}：${n.value}" cx="90" cy="90" r="62" stroke-dasharray="${length} ${389.56 - length}" stroke-dashoffset="${-offset}" style="--slice:${i};opacity:${0.4 + (0.6 * (i + 1)) / values.length}"/>`;
        offset += length;
        return markup;
      })
      .join(
        "",
      )}</svg><div><strong>${total}</strong><span>合计</span></div></div>`;
  }
  if (v === "heatmap")
    chart = `<div class="gcm-heatmap">${values.map((n, i) => `<button type="button" data-gcm-action="point" data-index="${i}" style="--level:${Math.max(0.08, n.value / max)}" aria-label="${esc(n.label)}，${n.value}">${esc(n.label)}</button>`).join("")}</div>`;
  if (v === "ranking")
    chart = `<div class="gcm-ranking">${values.map((n, i) => `<button type="button" data-gcm-action="point" data-index="${i}" style="--value:${(n.value / max) * 100}%"><span>${esc(n.label)}</span><i></i><strong>${n.value}</strong></button>`).join("")}</div>`;
  if (v === "table")
    chart = `<table class="gcm-table"><thead><tr><th>日期</th><th>${button("数量 ↕", "sort")}</th><th>占比</th></tr></thead><tbody>${values.map((n, i) => `<tr><td>${esc(n.label)}</td><td>${button(String(n.value), "point", `data-index="${i}"`)}</td><td><meter min="0" max="${total || 1}" value="${n.value}"></meter><span>${total ? Math.round((n.value / total) * 100) : 0}%</span></td></tr>`).join("")}</tbody></table>`;
  const picked = values[selected];
  return `<div class="gcm-data"><header><div><span>${esc(data.subtitle)}</span><h3>${v === "sparkline" ? `${total} · ${esc(data.title)}` : esc(data.title)}</h3></div><nav aria-label="时间范围">${button("全部", "range", `data-range="all" aria-pressed="${range === "all"}"`)}${button("近期", "range", `data-range="recent" aria-pressed="${range === "recent"}"`)}</nav></header>${chart}<footer><span>${v === "stacked" ? "● 新学　○ 复习" : esc(values[0]?.label || "")}<span>${v === "stacked" ? "" : esc(values.at(-1)?.label || "")}</span></span><output aria-live="polite">${picked ? `${esc(picked.label)}：${picked.value}${v === "stacked" ? `，复习 ${picked.secondary}` : ""}` : "点击或悬停查看"}</output></footer></div>`;
}

export function mount(container, item, options = {}) {
  let opts = { ...options },
    data = normalize(options.data),
    selected = 0,
    range = "all",
    sort = false,
    page = 0,
    controller = null,
    dead = false,
    paused = false,
    language = false,
    longCopy = false,
    frame = 0,
    textAnimation = null,
    layoutObserver = null,
    layoutPosition = null;
  const abort = new AbortController();
  const root = document.createElement("div");
  root.className = `gcm-root gcm-kind-${item.category}`;
  root.dataset.gcmVariant = item.variant;
  container.append(root);
  setOptions(root, opts);
  function render() {
    if (dead) return;
    textAnimation?.cancel();
    layoutObserver?.disconnect();
    layoutPosition = null;
    if (item.category === "motion") {
      root.innerHTML = `<div class="gcm-motion-stage" aria-label="页面转场预览">${pageMarkup(data, page)}</div>${opts.externalControls ? `<div class="gcm-motion-tools gcm-motion-tools-external">${button(page ? "← 返回" : "进入下一页 →", page ? "back" : "next")}</div>` : `<div class="gcm-motion-tools">${button(page ? "← 返回" : "进入下一页 →", page ? "back" : "next")}${button("重播", "replay")}${button("暂停", "pause")}<label>进度<input type="range" min="0" max="100" value="0" data-gcm-progress aria-label="动画进度"/></label><output data-gcm-percent>0%</output></div>`}`;
    } else if (item.category === "layout")
      root.innerHTML = renderLayout(item.variant, data, selected);
    else if (item.category === "backgrounds")
      root.innerHTML = `<div class="gcm-backgrounds gcm-backgrounds-${esc(item.variant)}"><article class="gcm-background-copy"><span>${esc(data.subtitle)}</span><h2>${esc(data.title)}</h2><p>${esc(data.body)}</p>${button("打开内容 ↗", "open")}</article><div class="gcm-background-layer" aria-hidden="true">${item.variant === "magnet-lines" ? Array.from({ length: 140 }, () => "<span></span>").join("") : ""}</div></div>`;
    else if (item.category === "typography") {
      const text = {
        ...data,
        english: language ? data.title : data.english,
        body: longCopy ? `${data.body} ${data.body} ${data.body}` : data.body,
      };
      root.innerHTML = renderTypography(item.variant, text, opts.externalControls);
    } else
      root.innerHTML = renderData(item.variant, data, range, selected, sort);
    if (
      item.category === "layout" &&
      item.variant === "masonry" &&
      data.items.length
    ) {
      // React Bits Masonry: shortest-column placement, recalculated by ResizeObserver.
      const grid = root.querySelector(".gcm-layout-content");
      let first = true;
      const position = () => {
        const nodes = [...grid.children],
          columns = grid.clientWidth < 300 ? 1 : 2,
          colHeights = new Array(columns).fill(0),
          columnWidth = grid.clientWidth / columns;
        nodes.forEach((n, i) => {
          n.dataset.index = String(i);
          if (first) n.style.transition = "none";
          const col = colHeights.indexOf(Math.min(...colHeights));
          const height = Math.max(
            130,
            Number(data.items[i]?.height) || [205, 155, 175, 230][i % 4],
          );
          Object.assign(n.style, {
            width: `${columnWidth - 10}px`,
            height: `${height}px`,
            transform: `translate(${col * columnWidth}px,${colHeights[col]}px)`,
          });
          colHeights[col] += height + 10;
        });
        grid.style.height = `${Math.max(...colHeights)}px`;
        if (first) {
          grid.getBoundingClientRect();
          nodes.forEach((n) => (n.style.transition = ""));
          first = false;
        }
      };
      layoutPosition = position;
      layoutObserver = new ResizeObserver(position);
      layoutObserver.observe(grid);
      position();
    }
  }
  function tick() {
    cancelAnimationFrame(frame);
    if (dead || !controller) return;
    const amount = Math.round(controller.progress * 100);
    const slider = root.querySelector("[data-gcm-progress]"),
      output = root.querySelector("[data-gcm-percent]");
    if (slider) slider.value = amount;
    if (output) output.value = `${amount}%`;
    if (amount < 100 && !paused) frame = requestAnimationFrame(tick);
  }
  function changePage(next, { hold = false, progress } = {}) {
    controller?.cancel();
    const stage = root.querySelector(".gcm-motion-stage");
    if (!stage) return;
    const reverse = next < page;
    page = next;
    controller = transition(
      stage,
      () => (stage.innerHTML = pageMarkup(data, page)),
      {
        variant: item.variant,
        duration: opts.duration ?? item.defaultDuration ?? 1000,
        speed: opts.speed ?? 1,
        reverse,
        reducedMotion: opts.reducedMotion,
        paused: hold,
      },
    );
    const tools = root.querySelector(".gcm-motion-tools");
    const primary = tools?.querySelector("button");
    if (primary) {
      primary.dataset.gcmAction = page ? "back" : "next";
      primary.textContent = page ? "← 返回" : "进入下一页 →";
    }
    paused = hold;
    if (progress != null) controller.seek(progress);
    tick();
    opts.onAction?.("page", { page });
  }
  function replay(hold = false, progress) {
    if (
      item.category === "typography" &&
      ["blur-text", "decrypted"].includes(item.variant)
    ) {
      textAnimation?.cancel();
      textAnimation = animateText(root.querySelector("h2"), item.variant, {
        ...opts,
        duration: opts.duration ?? 1600,
      });
      if (hold) {
        textAnimation.pause();
        textAnimation.seek(progress || 0);
      }
      return;
    }
    if (item.category !== "motion") {
      render();
      return;
    }
    controller?.cancel();
    page = 0;
    root.querySelector(".gcm-motion-stage").innerHTML = pageMarkup(data, 0);
    changePage(1, { hold, progress });
  }
  const action = (e) => {
    const target = e.target.closest("[data-gcm-action]");
    if (
      !target ||
      !root.contains(target) ||
      (e.type === "keydown" && !["Enter", " "].includes(e.key))
    )
      return;
    if (e.type === "keydown") {
      if (target.tagName === "BUTTON") return;
      e.preventDefault();
    }
    const act = target.dataset.gcmAction;
    if (act === "text-replay") return replay();
    if (act === "next" || act === "back")
      return changePage(act === "next" ? 1 : 0);
    if (act === "replay") return replay();
    if (act === "pause") {
      if (!controller) return;
      paused = !paused;
      if (paused) controller.pause();
      else controller.play();
      target.textContent = paused ? "继续" : "暂停";
      tick();
      return;
    }
    if (act === "range") {
      range = target.dataset.range;
      selected = -1;
      render();
      opts.onAction?.("range", { range });
      return;
    }
    if (act === "sort") {
      sort = !sort;
      render();
      return;
    }
    if (act === "point") {
      selected = Number(target.dataset.index);
      const values = chartSeries(data, range);
      if (sort) values.sort((a, b) => b.value - a.value);
      const n = values[selected];
      root.querySelector("output").textContent =
        `${n?.label}：${n?.value}${item.variant === "stacked" ? `，复习 ${n?.secondary}` : ""}`;
      opts.onAction?.("point", { index: selected, point: n });
      return;
    }
    if (act === "select" || act === "next-item") {
      selected =
        act === "select"
          ? Number(target.dataset.index)
          : (selected + 1) % data.items.length;
      render();
      opts.onAction?.("select", {
        id: data.items[selected]?.id,
        item: data.items[selected],
      });
      return;
    }
    if (act === "reorder") {
      data = { ...data, items: [...data.items.slice(1), data.items[0]] };
      if (layoutPosition) {
        const grid = root.querySelector(".gcm-layout-content");
        grid.append(grid.firstElementChild);
        layoutPosition();
      } else render();
      opts.onAction?.("reorder", { items: data.items });
      return;
    }
    if (act === "language") {
      language = !language;
      render();
      return;
    }
    if (act === "long-copy") {
      longCopy = !longCopy;
      render();
      return;
    }
    if (act === "close-detail") {
      root.querySelector(".gcm-local-detail")?.remove();
      return;
    }
    if (act === "open") {
      const selectedItem = data.items[selected];
      if (opts.onAction)
        opts.onAction("open", { item: selectedItem, id: selectedItem?.id });
      else {
        root.querySelector(".gcm-local-detail")?.remove();
        const panel = document.createElement("article");
        panel.className = "gcm-local-detail";
        panel.innerHTML = `${button("← 返回", "close-detail")}<h3>${esc(selectedItem?.title)}</h3><p>${esc(selectedItem?.description)}</p>`;
        root.append(panel);
        panel.querySelector("button").focus();
      }
    }
  };
  root.addEventListener("click", action, { signal: abort.signal });
  root.addEventListener("keydown", action, { signal: abort.signal });
  root.addEventListener(
    "input",
    (e) => {
      if (e.target.matches("[data-gcm-progress]")) {
        const progress = Number(e.target.value) / 100;
        if (!controller || controller.progress >= 1) replay(true, progress);
        else {
          paused = true;
          controller.seek(progress);
          tick();
        }
        const b = root.querySelector('[data-gcm-action="pause"]');
        if (b) b.textContent = "继续";
      }
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    "pointerover",
    (e) => {
      if (item.category !== "data") return;
      const target = e.target.closest('[data-gcm-action="point"]');
      if (target) action({ target, type: "pointerover" });
    },
    { signal: abort.signal },
  );
  root.addEventListener(
    "pointermove",
    (e) => {
      if (
        item.category !== "backgrounds" ||
        opts.reducedMotion ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      if (item.variant === "magnet-lines") {
        // React Bits MagnetLines pointer-angle algorithm, scoped to this instance.
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (dead) return;
          const items = [
              ...root.querySelectorAll(".gcm-background-layer span"),
            ],
            rects = items.map((n) => n.getBoundingClientRect());
          items.forEach((n, i) => {
            const rect = rects[i],
              centerX = rect.x + rect.width / 2,
              centerY = rect.y + rect.height / 2,
              b = e.clientX - centerX,
              a = e.clientY - centerY,
              c = Math.sqrt(a * a + b * b) || 1,
              r =
                ((Math.acos(b / c) * 180) / Math.PI) *
                (e.clientY > centerY ? 1 : -1);
            n.style.setProperty("--rotate", `${r}deg`);
          });
        });
      }
      if (item.variant === "spotlight") {
        const box = root.getBoundingClientRect();
        root.style.setProperty(
          "--gcm-x",
          `${((e.clientX - box.left) / box.width) * 100}%`,
        );
        root.style.setProperty(
          "--gcm-y",
          `${((e.clientY - box.top) / box.height) * 100}%`,
        );
      }
    },
    { signal: abort.signal },
  );
  render();
  return {
    destroy() {
      if (dead) return;
      dead = true;
      abort.abort();
      cancelAnimationFrame(frame);
      controller?.cancel();
      textAnimation?.cancel();
      layoutObserver?.disconnect();
      root.remove();
    },
    replay,
    update(next = {}) {
      if (dead) return;
      opts = { ...opts, ...next };
      setOptions(root, opts);
      if (next.reducedMotion) {
        controller?.cancel();
        textAnimation?.cancel();
      }
      if ("data" in next) {
        controller?.cancel();
        data = normalize(next.data);
        selected = Math.min(selected, data.items.length - 1);
        render();
      }
    },
    seek(progress) {
      if (item.category === "typography") return replay(true, progress);
      if (item.category !== "motion") return;
      if (!controller || controller.progress >= 1) replay(true, progress);
      else {
        paused = true;
        controller.seek(progress);
        tick();
      }
    },
    pause() {
      paused = true;
      controller?.pause();
      textAnimation?.pause();
      cancelAnimationFrame(frame);
    },
    play() {
      if (dead) return;
      paused = false;
      controller?.play();
      textAnimation?.play();
      tick();
    },
    get progress() {
      return item.category === "typography"
        ? textAnimation?.progress ?? 1
        : controller?.progress ?? 0;
    },
  };
}

export const motionVariants = [...variants];
