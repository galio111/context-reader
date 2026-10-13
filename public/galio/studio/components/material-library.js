/* Source adaptations from Magic UI, React Bits, Kokonut UI and Motion Primitives.
 * Pinned originals, authors and licenses: third-party/materials/NOTICE.md.
 * Existing host nodes/listeners survive enhancement. Decorative nodes never receive clicks. */
import { contrastInk } from "../../sdk/materials.js";
import { specularLight } from "./specular-light.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const examples = () => [
  {
    id: "one",
    title: "The art of noticing",
    description: "换一种角度，看见日常。",
    label: "阅读",
  },
  {
    id: "two",
    title: "A slower afternoon",
    description: "给值得停留的内容，多一点时间。",
    label: "笔记",
  },
  {
    id: "three",
    title: "Room for a new idea",
    description: "留住一个念头，再继续向前。",
    label: "收藏",
  },
];
function instance(root, item, input, enhance) {
  let options = { ...input },
    disposed = false,
    paused = false,
    visible = true,
    animations = [],
    timers = [],
    progress = 0,
    light;
  const abort = new AbortController(),
    owned = new Set(),
    restores = [],
    styles = new Map(),
    emptyStyle = new Set(),
    classes = new Map(),
    attrs = new Map(),
    v = item.variant;
  const on = (el, type, fn, opts = {}) =>
    el.addEventListener(type, fn, { ...opts, signal: abort.signal });
  const style = (el, k, val) => {
    if (!styles.has(el)) {
      styles.set(el, new Map());
      if (!el.hasAttribute("style")) emptyStyle.add(el);
    }
    if (!styles.get(el).has(k))
      styles
        .get(el)
        .set(k, [
          el.style.getPropertyValue(k),
          el.style.getPropertyPriority(k),
        ]);
    el.style.setProperty(k, val);
  };
  const klass = (el, c) => {
    if (!classes.has(el))
      classes.set(el, { empty: !el.hasAttribute("class"), names: [] });
    if (!el.classList.contains(c)) {
      classes.get(el).names.push(c);
      el.classList.add(c);
    }
  };
  const attr = (el, k, val) => {
    if (!attrs.has(el)) attrs.set(el, new Map());
    if (!attrs.get(el).has(k)) attrs.get(el).set(k, el.getAttribute(k));
    el.setAttribute(k, val);
  };
  const add = (parent, tag, cls, html) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (html != null) n.innerHTML = html;
    parent.append(n);
    owned.add(n);
    return n;
  };
  const deco = (parent, cls) => {
    const n = add(parent, "span", cls);
    n.setAttribute("aria-hidden", "true");
    return n;
  };
  const data = () => options.data || {},
    items = () => data().items ?? examples();
  const emit = (action, detail = {}) => {
    if (!disposed) options.onAction?.(action, { ...detail });
  };
  const duration = () =>
    options.reducedMotion
      ? 0
      : Math.max(200, options.duration || 1600) / (options.speed || 1);
  const animate = (el, frames, extra = {}) => {
    const a = el.animate(frames, {
      duration: duration(),
      easing: "cubic-bezier(.2,.8,.2,1)",
      fill: "both",
      ...extra,
      ...(options.reducedMotion
        ? { duration: 0, delay: 0, iterations: 1 }
        : {}),
    });
    animations.push(a);
    if (animations.length > 256) animations.shift().cancel();
    if (paused || !visible || document.hidden) a.pause();
    return a;
  };
  const later = (fn, t) => {
    const id = setTimeout(() => {
      if (!disposed) fn();
    }, t);
    timers.push(id);
    return id;
  };
  const clear = () => {
    animations.forEach((a) => a.cancel());
    animations = [];
    timers.forEach(clearTimeout);
    timers = [];
  };
  const ownAnimations = () =>
    root.getAnimations({ subtree: true }).filter((a) => {
      const el = a.effect?.target;
      return el && (owned.has(el) || (!enhance && root.contains(el)));
    });
  const pauseAnimations = () => {
    for (const a of new Set([...animations, ...ownAnimations()])) {
      const at = a.currentTime;
      a.pause();
      if (at != null) a.currentTime = at;
    }
  };
  const resumeAnimations = () => {
    if (!paused && visible && !document.hidden && !options.reducedMotion)
      for (const a of new Set([...animations, ...ownAnimations()])) a.play();
  };
  let replayEffect = () => {},
    updateData = () => {},
    themedHeading;
  klass(root, "ml-root");
  if (!enhance) klass(root, "ml-demo");
  const theme = () => {
    style(root, "--ml-accent", options.accent);
    style(root, "--ml-ink", contrastInk(options.accent));
    style(root, "--ml-radius", options.radius + "px");
    style(root, "--ml-font", options.font);
    style(root, "--ml-size", options.fontSize + "px");
    style(root, "--ml-duration", duration() + "ms");
    attr(root, "data-ml-reduced", String(options.reducedMotion));
    if (themedHeading) {
      style(themedHeading, "font-family", options.font);
      style(
        themedHeading,
        "font-size",
        Math.round(options.fontSize * 2.4) + "px",
      );
    }
    light?.update(options);
  };
  theme();
  function buttonTarget() {
    if (enhance) {
      klass(root, "ml-button");
      return root;
    }
    const b = add(root, "button", "ml-button");
    b.type = "button";
    b.textContent =
      data().label || (v === "hold-button" ? "按住确认" : "保存这份灵感");
    return b;
  }
  function particles(target, count = 20, wide = false) {
    if (options.reducedMotion) return;
    const rect = target.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const p = deco(target, "ml-particle"),
        angle = (i / count) * Math.PI * 2,
        dist = 45 + (i % 5) * 16,
        dx = Math.cos(angle) * dist,
        dy = -45 - Math.abs(Math.sin(angle)) * 75;
      p.style.cssText = `--ml-particle-color:${i % 3 ? options.accent : "#d6b174"};left:${wide ? (i % 2 ? "85%" : "15%") : "50%"};top:${wide ? "85%" : "50%"};width:${4 + (i % 3) * 2}px;height:${7 + (i % 4)}px`;
      const a = animate(
        p,
        [
          { transform: "translate(-50%,-50%) rotate(0)", opacity: 1 },
          {
            transform: `translate(${dx}px,${dy}px) rotate(${180 + i * 13}deg)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(${dx * 1.5}px,${rect.height + 45}px) rotate(${360 + i * 27}deg)`,
            opacity: 0,
          },
        ],
        {
          duration: Math.max(900, duration()),
          easing: "cubic-bezier(.15,.6,.4,1)",
          fill: "none",
        },
      );
      a.finished
        .then(() => {
          p.remove();
          owned.delete(p);
        })
        .catch(() => {});
    }
  }
  if (item.category === "buttons") {
    const b = buttonTarget();
    klass(b, "ml-" + v);
    const content = [...b.childNodes],
      label = add(b, "span", "ml-label");
    content.forEach((n) => label.append(n));
    restores.push(() => {
      label.replaceWith(...content);
    });
    if (!enhance)
      on(b, "click", () => {
        if (v !== "hold-button") emit("complete", { value: true });
      });
    const ring = [
      "shimmer-button",
      "rainbow-button",
      "star-border",
      "specular-button",
    ].includes(v)
      ? deco(b, "ml-rim")
      : null;
    if (v === "shimmer-button") {
      const beam = deco(ring, "ml-orbit-beam");
      replayEffect = () =>
        animate(
          beam,
          [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }],
          { duration: duration() * 2, iterations: Infinity, easing: "linear" },
        );
    }
    if (v === "shiny-button") {
      const sheen = deco(b, "ml-button-sheen");
      replayEffect = () =>
        animate(
          sheen,
          [
            { transform: "translateX(-180%) skewX(-25deg)", opacity: 0 },
            { opacity: 1, offset: 0.3 },
            { transform: "translateX(280%) skewX(-25deg)", opacity: 0 },
          ],
          { duration: duration() * 2, iterations: Infinity },
        );
    }
    if (v === "interactive-hover-button") {
      deco(b, "ml-fill-dot");
      const arrow = deco(b, "ml-fill-arrow");
      arrow.textContent = "↗";
      const effect = () => {
        attr(b, "data-ml-hover", "true");
        later(() => attr(b, "data-ml-hover", "false"), duration());
      };
      replayEffect = effect;
    }
    if (v === "pulsating-button") {
      const halo = deco(b, "ml-halo");
      replayEffect = () =>
        animate(
          halo,
          [
            { transform: "scale(1)", opacity: 0.4 },
            { transform: "scale(1.18,1.6)", opacity: 0 },
          ],
          { duration: duration(), iterations: Infinity, easing: "ease-out" },
        );
    }
    if (v === "rainbow-button") {
      const color = deco(ring, "ml-rainbow-band");
      replayEffect = () =>
        animate(
          color,
          [
            { backgroundPosition: "0% 50%" },
            { backgroundPosition: "200% 50%" },
          ],
          { duration: duration() * 3, iterations: Infinity, easing: "linear" },
        );
    }
    if (v === "star-border") {
      const top = deco(ring, "ml-star ml-star-top"),
        bottom = deco(ring, "ml-star ml-star-bottom");
      replayEffect = () =>
        [top, bottom].forEach((n, i) =>
          animate(
            n,
            [
              { transform: `translateX(${i ? 100 : -100}%)` },
              { transform: `translateX(${i ? -100 : 100}%)` },
            ],
            {
              duration: duration() * 2,
              iterations: Infinity,
              easing: "linear",
            },
          ),
        );
    }
    if (v === "specular-button") {
      light = specularLight(b, options);
      restores.push(() => light.destroy());
      replayEffect = () => light.replay();
    }
    if (v === "glass-icons") {
      const plate = deco(b, "ml-glass-plate"),
        glass = deco(b, "ml-glass-front");
      b.prepend(plate, glass);
      replayEffect = () => {
        animate(
          plate,
          [
            { transform: "rotate(-8deg)" },
            { transform: "translate(12px,-12px) rotate(12deg)" },
            { transform: "rotate(-8deg)" },
          ],
          { fill: "none" },
        );
        animate(
          glass,
          [
            { transform: "translate(0)" },
            { transform: "translate(-5px,5px)" },
            { transform: "translate(0)" },
          ],
          { fill: "none" },
        );
      };
    }
    if (v === "particle-button") {
      on(b, "click", () => particles(b));
      replayEffect = () => particles(b);
    }
    if (v === "switch-button") {
      const icon = deco(b, "ml-switch-icon");
      icon.textContent = "☼";
      b.prepend(icon);
      let selected = !!data().value;
      const set = () => {
        attr(b, "aria-pressed", String(selected));
        attr(b, "data-ml-selected", String(selected));
      };
      on(b, "click", () => {
        selected = !selected;
        set();
        animate(
          icon,
          [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }],
          { fill: "none" },
        );
        emit("change", { value: selected });
      });
      set();
      replayEffect = () =>
        animate(
          icon,
          [{ transform: "rotate(0)" }, { transform: "rotate(360deg)" }],
          { fill: "none" },
        );
    }
    if (v === "hold-button") {
      const fill = deco(b, "ml-hold-fill");
      let holding = false,
        completed = false,
        permit = false,
        started = 0,
        timer;
      const cancel = () => {
        holding = false;
        clearTimeout(timer);
        fill.getAnimations().forEach((a) => a.cancel());
        fill.style.width = "0%";
        attr(b, "data-ml-holding", "false");
      };
      const start = () => {
        if (holding || b.disabled || b.getAttribute("aria-disabled") === "true")
          return;
        completed = false;
        holding = true;
        started = performance.now();
        attr(b, "data-ml-holding", "true");
        const ms = Math.max(900, options.duration || 1800);
        if (!options.reducedMotion)
          animate(fill, [{ width: "0%" }, { width: "100%" }], {
            duration: ms,
            easing: "linear",
          });
        else fill.style.width = "50%";
        timer = later(() => {
          if (!holding) return;
          completed = true;
          holding = false;
          fill.style.width = "100%";
          attr(b, "data-ml-holding", "false");
          permit = true;
          b.click();
          permit = false;
          emit("complete", { value: true, held: performance.now() - started });
          later(cancel, 450);
        }, ms);
      };
      on(
        b,
        "click",
        (e) => {
          if (!permit) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
        },
        { capture: true },
      );
      on(b, "pointerdown", (e) => {
        if (e.button !== 0) return;
        b.setPointerCapture(e.pointerId);
        start();
      });
      on(b, "pointerup", () => {
        if (!completed) cancel();
      });
      on(b, "pointercancel", cancel);
      on(b, "pointerleave", () => {
        if (holding) cancel();
      });
      on(b, "blur", cancel);
      on(b, "keydown", (e) => {
        if ([" ", "Enter"].includes(e.key)) {
          e.preventDefault();
          if (!e.repeat) start();
        }
        if (e.key === "Escape") cancel();
      });
      on(b, "keyup", (e) => {
        if ([" ", "Enter"].includes(e.key)) {
          e.preventDefault();
          if (!completed) cancel();
        }
      });
      on(document, "visibilitychange", () => {
        if (document.hidden) cancel();
      });
      restores.push(cancel);
      replayEffect = () =>
        animate(fill, [{ width: "0%" }, { width: "100%" }, { width: "0%" }], {
          fill: "none",
        });
    }
  }
  if (item.category === "navigation") {
    const nav = add(root, "nav", "ml-nav ml-" + v);
    nav.setAttribute("aria-label", data().label || "内容导航");
    let selected = data().value ?? items()[0]?.id,
      open = false;
    let indicator, goo;
    const filterId = "ml-goo-" + crypto.randomUUID();
    const moveGoo = (index, burst = false) => {
      if (!indicator) return;
      const b = nav.querySelectorAll("[data-ml-nav]")[index];
      if (!b) return;
      const r = b.getBoundingClientRect(),
        box = nav.getBoundingClientRect();
      indicator.style.cssText = `left:${r.left - box.left}px;top:${r.top - box.top}px;width:${r.width}px;height:${r.height}px`;
      if (burst && !options.reducedMotion) {
        for (let i = 0; i < 10; i++) {
          const n = deco(goo, "ml-goo-particle"),
            a = (i / 10) * Math.PI * 2;
          n.style.left = r.left - box.left + r.width / 2 + "px";
          n.style.top = r.top - box.top + r.height / 2 + "px";
          const anim = animate(
            n,
            [
              { transform: "translate(-50%,-50%) scale(.2)" },
              {
                transform: `translate(calc(-50% + ${Math.cos(a) * r.width * 0.56}px),calc(-50% + ${Math.sin(a) * r.height * 0.6}px)) scale(1)`,
                offset: 0.45,
              },
              { transform: "translate(-50%,-50%) scale(0)" },
            ],
            { duration: 650, fill: "none" },
          );
          anim.finished
            .then(() => {
              n.remove();
              owned.delete(n);
            })
            .catch(() => {});
        }
      }
    };
    const buildGoo = () => {
      if (v !== "gooey-nav") return;
      const defs = add(
        nav,
        "span",
        "ml-goo-defs",
        `<svg width="0" height="0" aria-hidden="true"><filter id="${filterId}"><feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 18 -7" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop"/></filter></svg>`,
      );
      goo = deco(nav, "ml-goo-layer");
      goo.style.filter = `url(#${filterId})`;
      indicator = deco(goo, "ml-goo-indicator");
      moveGoo(
        Math.max(
          0,
          items().findIndex(
            (x) => String(x.id ?? x.value) === String(selected),
          ),
        ),
      );
    };
    const render = () => {
      const list = items();
      nav.innerHTML = `${v !== "gooey-nav" ? `<button type="button" class="ml-menu-trigger" aria-expanded="${open}">探索 <span>${open ? "−" : "＋"}</span></button>` : ""}<div class="ml-nav-items" ${v !== "gooey-nav" && !open ? "hidden" : ""}>${list.map((it, i) => `<button type="button" data-ml-nav="${i}" style="--i:${i}" aria-current="${String(it.id ?? it.value) === String(selected) ? "page" : "false"}"><small>${String(i + 1).padStart(2, "0")}</small><span>${esc(it.label || it.title)}</span><i aria-hidden="true">↗</i></button>`).join("")}</div>`;
    };
    on(nav, "click", (e) => {
      if (e.target.closest(".ml-menu-trigger")) {
        open = !open;
        render();
        if (open)
          [...nav.querySelectorAll("[data-ml-nav]")].forEach((n, i) =>
            animate(
              n,
              [
                {
                  transform:
                    v === "bubble-menu"
                      ? "scale(.3) translateY(-24px)"
                      : "translateY(-20px)",
                  opacity: 0,
                },
                { transform: "none", opacity: 1 },
              ],
              {
                duration: Math.min(duration(), 650),
                delay: i * 65,
                fill: "none",
              },
            ),
          );
        nav.querySelector(".ml-menu-trigger")?.focus();
        return;
      }
      const b = e.target.closest("[data-ml-nav]");
      if (!b) return;
      const it = items()[Number(b.dataset.mlNav)];
      selected = it.id ?? it.value;
      if (v === "gooey-nav") {
        nav
          .querySelectorAll("[data-ml-nav]")
          .forEach((n) =>
            n.setAttribute("aria-current", n === b ? "page" : "false"),
          );
        moveGoo(Number(b.dataset.mlNav), true);
      } else {
        open = false;
        render();
        nav.querySelector(".ml-menu-trigger")?.focus();
      }
      emit("navigate", { id: selected, value: selected });
    });
    on(nav, "keydown", (e) => {
      if (e.key === "Escape" && open) {
        open = false;
        render();
        nav.querySelector(".ml-menu-trigger")?.focus();
      }
      if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) {
        const nodes = [...nav.querySelectorAll("[data-ml-nav]")],
          i = nodes.indexOf(document.activeElement);
        if (i >= 0) {
          e.preventDefault();
          nodes[
            (i +
              (["ArrowRight", "ArrowDown"].includes(e.key) ? 1 : -1) +
              nodes.length) %
              nodes.length
          ]?.focus();
        }
      }
    });
    render();
    buildGoo();
    const resize = new ResizeObserver(() =>
      moveGoo(
        Math.max(
          0,
          items().findIndex(
            (x) => String(x.id ?? x.value) === String(selected),
          ),
        ),
      ),
    );
    resize.observe(nav);
    restores.push(() => resize.disconnect());
    updateData = () => {
      selected = data().value ?? selected;
      render();
      buildGoo();
    };
    replayEffect = () => {
      const n = nav.querySelector(".ml-nav-items");
      if (v === "gooey-nav")
        moveGoo(
          Math.max(
            0,
            items().findIndex(
              (x) => String(x.id ?? x.value) === String(selected),
            ),
          ),
          true,
        );
      else if (n && !n.hidden)
        animate(
          n,
          [
            { opacity: 0.4, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
          { fill: "none" },
        );
    };
  }
  if (item.category === "layout") {
    const area = add(root, "div", "ml-layout ml-" + v);
    let selected = 0,
      opened = false,
      split = 50;
    const tile = (it, i) =>
      `<small>${String(i + 1).padStart(2, "0")}</small><strong>${esc(it.title || it.label)}</strong><span>${esc(it.description || it.meta || "打开内容")} ↗</span>`;
    const render = () => {
      const list = items();
      if (!list.length) {
        area.innerHTML = "<p>这里还没有内容</p>";
        return;
      }
      if (v === "folder")
        area.innerHTML = `<button type="button" class="ml-folder-back" aria-expanded="${opened}" aria-label="${opened ? "收起" : "打开"}文件夹"></button><div class="ml-folder-pages" data-open="${opened}">${list.map((it, i) => `<button type="button" data-ml-open="${i}" style="--i:${i};--n:${list.length}" ${!opened ? 'tabindex="-1"' : ""}>${tile(it, i)}</button>`).join("")}</div><button type="button" class="ml-folder-front" aria-label="${opened ? "收起" : "打开"}文件夹" aria-expanded="${opened}">阅读收藏 <span>${list.length}</span></button>`;
      if (v === "flip-card")
        area.innerHTML = `<div class="ml-flip-inner" data-flipped="${opened}"><button type="button" class="ml-flip-front" data-ml-flip ${opened ? "inert" : ""}>${tile(list[selected % list.length], selected)}</button><div class="ml-flip-back" ${!opened ? "inert" : ""}><p>${esc(list[selected % list.length].description || "打开这篇内容，继续探索。")}</p><button type="button" data-ml-open="${selected % list.length}">打开内容 ↗</button><button type="button" data-ml-flip>翻回正面 ↶</button></div></div><button type="button" class="ml-next-card">下一张 →</button>`;
      if (v === "accordion-gallery")
        area.innerHTML = list
          .map(
            (it, i) =>
              `<article class="ml-gallery-panel" data-active="${selected === i}"><button type="button" data-ml-expand="${i}" style="--i:${i}">${tile(it, i)}</button><button type="button" class="ml-gallery-open" data-ml-open="${i}" ${selected !== i ? "hidden" : ""}>打开 ↗</button></article>`,
          )
          .join("");
      if (v === "accordion")
        area.innerHTML = list
          .map(
            (it, i) =>
              `<div class="ml-accordion-row"><button type="button" data-ml-expand="${i}" aria-expanded="${selected === i && opened}">${esc(it.title || it.label)}<span>${selected === i && opened ? "−" : "＋"}</span></button><div class="ml-accordion-content" data-expanded="${selected === i && opened}"><div ${!(selected === i && opened) ? "inert" : ""}><p>${esc(it.description || "打开内容，继续阅读。")}</p><button type="button" data-ml-open="${i}">打开内容 ↗</button></div></div></div>`,
          )
          .join("");
      if (v === "image-comparison") {
        const it = list[selected % list.length];
        area.innerHTML = `<div class="ml-compare-base">${tile(it, selected)}</div><div class="ml-compare-after">${tile(it, selected)}</div><div class="ml-compare-line"><span>‹ ›</span></div><input class="ml-compare-range" type="range" min="0" max="100" value="${split}" aria-label="左右对照分界线"><div class="ml-compare-labels"><span>原稿</span><span>排版后</span></div><button type="button" data-ml-open="${selected % list.length}" class="ml-compare-open">打开内容 ↗</button>`;
        area.style.setProperty("--ml-split", split + "%");
      }
    };
    const syncOpen = () => {
      if (v === "folder") {
        area
          .querySelectorAll(".ml-folder-back,.ml-folder-front")
          .forEach((b) => {
            b.setAttribute("aria-expanded", String(opened));
            b.setAttribute("aria-label", `${opened ? "收起" : "打开"}文件夹`);
          });
        area.querySelector(".ml-folder-pages").dataset.open = String(opened);
        area.querySelectorAll("[data-ml-open]").forEach((b) => {
          if (opened) b.removeAttribute("tabindex");
          else b.tabIndex = -1;
        });
      }
      if (v === "flip-card") {
        area.querySelector(".ml-flip-inner").dataset.flipped = String(opened);
        area.querySelector(".ml-flip-front").inert = opened;
        area.querySelector(".ml-flip-back").inert = !opened;
      }
      if (v === "accordion")
        area.querySelectorAll(".ml-accordion-row").forEach((row, i) => {
          const expanded = selected === i && opened;
          const b = row.querySelector("[data-ml-expand]");
          b.setAttribute("aria-expanded", String(expanded));
          b.querySelector("span").textContent = expanded ? "−" : "＋";
          const content = row.querySelector(".ml-accordion-content");
          content.dataset.expanded = String(expanded);
          content.firstElementChild.inert = !expanded;
        });
    };
    const expand = (i, toggle) => {
      if (v === "accordion-gallery") {
        selected = i;
        area.querySelectorAll(".ml-gallery-panel").forEach((p, j) => {
          p.dataset.active = String(i === j);
          p.querySelector(".ml-gallery-open").hidden = i !== j;
        });
      } else {
        opened = toggle && selected === i ? !opened : true;
        selected = i;
        syncOpen();
      }
    };
    on(area, "pointerover", (e) => {
      const b = e.target.closest("[data-ml-expand]");
      if (b && v === "accordion-gallery") expand(Number(b.dataset.mlExpand));
    });
    on(area, "focusin", (e) => {
      const b = e.target.closest("[data-ml-expand]");
      if (b && v === "accordion-gallery") expand(Number(b.dataset.mlExpand));
    });
    on(area, "click", (e) => {
      if (e.target.closest("button")) clear();
      const b = e.target.closest("[data-ml-open]");
      if (b) {
        const it = items()[Number(b.dataset.mlOpen)];
        emit("open", { id: it.id, value: it.id });
      }
      if (e.target.closest(".ml-folder-back,.ml-folder-front")) {
        opened = !opened;
        syncOpen();
        area.querySelector(".ml-folder-front")?.focus();
      }
      if (e.target.closest("[data-ml-flip]")) {
        opened = !opened;
        syncOpen();
        area
          .querySelector(opened ? ".ml-flip-back button" : ".ml-flip-front")
          ?.focus();
      }
      if (e.target.closest(".ml-next-card")) {
        selected++;
        opened = false;
        render();
        area.querySelector(".ml-next-card")?.focus();
      }
      const x = e.target.closest("[data-ml-expand]");
      if (x) expand(Number(x.dataset.mlExpand), true);
    });
    on(area, "input", (e) => {
      if (e.target.matches(".ml-compare-range")) {
        split = Number(e.target.value);
        area.style.setProperty("--ml-split", split + "%");
      }
    });
    render();
    updateData = render;
    replayEffect = () => {
      if (!items().length) return;
      if (v === "image-comparison") {
        animate(
          area.querySelector(".ml-compare-after"),
          [
            { clipPath: "inset(0 75% 0 0)" },
            { clipPath: "inset(0 20% 0 0)" },
            { clipPath: `inset(0 ${100 - split}% 0 0)` },
          ],
          { fill: "none" },
        );
      } else if (v === "flip-card") {
        const start = opened ? 180 : 0;
        animate(
          area.querySelector(".ml-flip-inner"),
          [
            { transform: `rotateY(${start}deg)` },
            { transform: `rotateY(${start + 180}deg)`, offset: 0.48 },
            { transform: `rotateY(${start + 180}deg)`, offset: 0.66 },
            { transform: `rotateY(${start}deg)` },
          ],
          { fill: "none" },
        );
      } else if (v === "folder") {
        const front = area.querySelector(".ml-folder-front");
        const start = getComputedStyle(front).transform;
        animate(
          front,
          [
            { transform: start },
            { transform: "rotateX(-28deg) skewX(-4deg)" },
            { transform: start },
          ],
          { fill: "none" },
        );
        area
          .querySelectorAll(".ml-folder-pages > button")
          .forEach((page, i) => {
            const at = getComputedStyle(page).transform;
            animate(
              page,
              [
                { transform: at },
                {
                  transform: `translate(${(i - 1) * 55}px, -95px) rotate(${(i - 1) * 10}deg)`,
                },
                { transform: at },
              ],
              { fill: "none", delay: i * duration() * 0.06 },
            );
          });
      } else if (v === "accordion") {
        const content = area.querySelectorAll(".ml-accordion-content")[
          selected
        ];
        if (content)
          animate(
            content,
            [
              { gridTemplateRows: opened ? "1fr" : "0fr" },
              { gridTemplateRows: opened ? "0fr" : "1fr", offset: 0.45 },
              { gridTemplateRows: opened ? "0fr" : "1fr", offset: 0.65 },
              { gridTemplateRows: opened ? "1fr" : "0fr" },
            ],
            { fill: "none" },
          );
      } else
        animate(
          area,
          [
            { transform: "translateY(16px)", opacity: 0.3 },
            { transform: "none", opacity: 1 },
          ],
          { fill: "none" },
        );
    };
  }
  if (item.category === "typography") {
    const h = enhance
      ? root.matches("h1,h2,h3")
        ? root
        : root.querySelector("h1,h2,h3") || root
      : add(root, "h2", "ml-type-demo");
    themedHeading = h;
    theme();
    klass(h, "ml-type");
    klass(h, "ml-" + v);
    if (!enhance)
      h.textContent = data().text || "Make room for ideas. 给想法留白。";
    const nodes = [...h.childNodes],
      text = h.textContent,
      wrap = add(h, "span", "ml-type-content"),
      saved = document.createDocumentFragment();
    nodes.forEach((n) => saved.append(n));
    restores.push(() => {
      wrap.remove();
      h.append(saved);
    });
    if (v === "text-3d-flip") {
      wrap.setAttribute("aria-label", text);
      wrap.innerHTML = [
        ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
          text,
        ),
      ]
        .map(
          ({ segment }, i) =>
            `<span aria-hidden="true" class="ml-flip-letter" style="--i:${i}"><span>${segment === " " ? "&nbsp;" : esc(segment)}</span><span>${segment === " " ? "&nbsp;" : esc(segment)}</span></span>`,
        )
        .join("");
      replayEffect = () =>
        [...wrap.children].forEach((n, i) =>
          animate(
            n,
            [
              { transform: "rotateX(0)" },
              { transform: "rotateX(-90deg)" },
              { transform: "rotateX(0)" },
            ],
            { duration: duration(), delay: i * 30, fill: "none" },
          ),
        );
      on(h, "pointerenter", () => {
        clear();
        replayEffect();
      });
    } else {
      wrap.textContent = text;
      if (v === "line-shadow-text") {
        attr(wrap, "data-shadow", text);
        replayEffect = () =>
          animate(
            wrap,
            [{ "--ml-shadow-x": "0px" }, { "--ml-shadow-x": "16px" }],
            {
              duration: duration() * 2,
              iterations: Infinity,
              easing: "linear",
            },
          );
      } else
        replayEffect = () =>
          animate(
            wrap,
            [
              { backgroundPosition: "200% center" },
              { backgroundPosition: "-200% center" },
            ],
            {
              duration: duration() * (v === "gradient-text" ? 3 : 2),
              iterations: Infinity,
              easing: "linear",
            },
          );
    }
  }
  if (item.category === "backgrounds") {
    const cover = deco(root, "ml-background ml-" + v);
    if (enhance) {
      style(
        root,
        "position",
        getComputedStyle(root).position === "static"
          ? "relative"
          : getComputedStyle(root).position,
      );
      style(root, "isolation", "isolate");
    } else {
      const label = add(root, "div", "ml-bg-caption");
      label.innerHTML = "<small>MAKE ROOM</small><strong>留一点想象。</strong>";
    }
    if (v === "retro-grid") {
      const grid = deco(cover, "ml-perspective-grid");
      replayEffect = () =>
        animate(
          grid,
          [{ backgroundPosition: "0 0" }, { backgroundPosition: "0 48px" }],
          { duration: duration(), iterations: Infinity, easing: "linear" },
        );
    }
    if (v === "shine-border") {
      const band = deco(cover, "ml-shine-band");
      replayEffect = () =>
        animate(
          band,
          [
            { backgroundPosition: "0% 0%" },
            { backgroundPosition: "200% 200%" },
          ],
          { duration: duration() * 3, iterations: Infinity, easing: "linear" },
        );
    }
    if (v === "meteors") {
      const stars = Array.from({ length: 12 }, (_, i) => {
        const n = deco(cover, "ml-meteor");
        n.style.left = ((i * 19) % 110) + "%";
        n.style.top = -15 + (i % 3) * 8 + "%";
        return n;
      });
      replayEffect = () =>
        stars.forEach((n, i) =>
          animate(
            n,
            [
              { transform: "translate(0,0) rotate(-45deg)", opacity: 0 },
              { opacity: 0.8, offset: 0.15 },
              {
                transform: "translate(-240px,360px) rotate(-45deg)",
                opacity: 0,
              },
            ],
            {
              duration: duration() * (1.3 + (i % 3) * 0.3),
              delay: i * 180,
              iterations: Infinity,
              easing: "linear",
            },
          ),
        );
    }
  }
  if (item.category === "hover") {
    const target = enhance ? root : add(root, "button", "ml-pixel-target");
    if (!enhance) {
      target.type = "button";
      target.textContent = data().label || "触碰一片像素";
      on(target, "click", () => emit("complete", { value: true }));
    }
    klass(target, "ml-pixel-card");
    const pixels = deco(target, "ml-pixel-grid");
    for (let i = 0; i < 96; i++) {
      const n = deco(pixels, "ml-pixel");
      n.style.opacity = "0";
      n.style.setProperty(
        "--ml-pixel-strength",
        String(0.12 + ((i * 7) % 9) * 0.07),
      );
    }
    const reveal = () => {
      clear();
      [...pixels.children].forEach((n, i) => {
        const d = Math.hypot((i % 12) - 5.5, Math.floor(i / 12) - 3.5);
        animate(
          n,
          [
            { opacity: 0, transform: "scale(0)" },
            { opacity: 0.1 + ((i * 7) % 9) * 0.06, transform: "scale(1)" },
          ],
          { delay: d * 45, duration: 400 },
        );
      });
    };
    const hide = () => {
      clear();
      pixels.querySelectorAll("span").forEach((n) => (n.style.opacity = "0"));
    };
    on(target, "pointerenter", reveal);
    on(target, "focus", reveal);
    on(target, "pointerleave", hide);
    on(target, "blur", hide);
    replayEffect = reveal;
  }
  if (item.category === "data") {
    const display = add(root, "div", "ml-counter");
    let value = 0;
    const render = () => {
      value = Math.round(
        Number(
          data().value ??
            data().series?.reduce((n, x) => n + Number(x.value || 0), 0) ??
            248,
        ),
      );
      display.innerHTML = `<small>${esc(data().title || "收集的灵感")}</small><div class="ml-counter-digits" aria-label="${value}">${String(
        Math.abs(value),
      )
        .split("")
        .map(
          (digit, i) =>
            `<span class="ml-digit-window" aria-hidden="true"><span class="ml-digit-reel" data-digit="${digit}" style="--i:${i}">${Array.from({ length: 20 }, (_, j) => `<i>${j % 10}</i>`).join("")}</span></span>`,
        )
        .join("")}</div>`;
      if (value < 0) display.querySelector(".ml-counter-digits").prepend("−");
    };
    render();
    replayEffect = () =>
      display.querySelectorAll(".ml-digit-reel").forEach((n, i) =>
        animate(
          n,
          [
            { transform: "translateY(0)" },
            {
              transform: `translateY(-${(10 + Number(n.dataset.digit)) * 1.15}em)`,
            },
          ],
          {
            delay: i * 90,
            duration: duration(),
            easing: "cubic-bezier(.15,.7,.2,1)",
          },
        ),
      );
    updateData = () => {
      render();
      clear();
      replayEffect();
    };
  }
  if (item.category === "feedback") {
    const area = add(root, "div", "ml-feedback ml-" + v);
    if (v === "confetti") {
      area.innerHTML =
        '<button type="button" class="ml-button">完成了，庆祝一下 ↗</button><output aria-live="polite"></output>';
      on(area.querySelector("button"), "click", () => {
        particles(area, 32, true);
        area.querySelector("output").textContent = "已完成";
        emit("complete", { value: true });
      });
      replayEffect = () => particles(area, 32, true);
    }
    if (v === "animated-list") {
      const defaults = [
        { title: "一篇新的阅读", description: "刚刚加入收藏" },
        { title: "今天的复习完成", description: "给坚持留个记录" },
        { title: "新的想法", description: "已经保存到笔记" },
      ];
      const render = () => {
        area.innerHTML = (data().items || defaults)
          .map(
            (it, i) =>
              `<div class="ml-notification"><span>${["↗", "✓", "✦"][i % 3]}</span><div><strong>${esc(it.title || it.label)}</strong><small>${esc(it.description || it.meta || "已更新")}</small></div></div>`,
          )
          .join("");
      };
      render();
      updateData = render;
      replayEffect = () =>
        [...area.children].forEach((n, i) =>
          animate(
            n,
            [
              { transform: "translateY(-24px) scale(.94)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { delay: i * 420, duration: 500 },
          ),
        );
    }
    if (v === "stepper") {
      let current = 0;
      const defaults = [
        { title: "选择内容" },
        { title: "调整设计" },
        { title: "保存方案" },
      ];
      let steps = data().items || defaults;
      const render = () => {
        if (!steps.length) {
          area.innerHTML = "<p>还没有步骤</p>";
          return;
        }
        area.innerHTML = `<div class="ml-step-track">${steps.map((it, i) => `<span class="ml-step" data-done="${i < current}" data-active="${i === current}"><i>${i < current ? "✓" : i + 1}</i>${i < steps.length - 1 ? `<b data-filled="${i < current}"></b>` : ""}</span>`).join("")}</div><strong>${esc(current >= steps.length ? "已经完成" : steps[current]?.title || steps[current]?.label)}</strong><div class="ml-step-actions"><button type="button" data-prev ${current === 0 ? "disabled" : ""}>上一步</button><button type="button" data-next>${current >= steps.length ? "再试一次" : current === steps.length - 1 ? "完成" : "下一步 →"}</button></div>`;
      };
      const syncStep = () => {
        area.querySelectorAll(".ml-step").forEach((step, i) => {
          step.dataset.done = String(i < current);
          step.dataset.active = String(i === current);
          step.querySelector("i").textContent =
            i < current ? "✓" : String(i + 1);
          const line = step.querySelector("b");
          if (line) line.dataset.filled = String(i < current);
        });
        area.querySelector(":scope > strong").textContent =
          current >= steps.length
            ? "已经完成"
            : steps[current]?.title || steps[current]?.label;
        area.querySelector("[data-prev]").disabled = current === 0;
        area.querySelector("[data-next]").textContent =
          current >= steps.length
            ? "再试一次"
            : current === steps.length - 1
              ? "完成"
              : "下一步 →";
      };
      on(area, "click", (e) => {
        if (e.target.closest("[data-next]")) {
          current = current >= steps.length ? 0 : current + 1;
          syncStep();
          area.querySelector("[data-next]").focus();
          emit(current === steps.length ? "complete" : "change", {
            value: current,
          });
        }
        if (e.target.closest("[data-prev]")) {
          current = Math.max(0, current - 1);
          syncStep();
          area.querySelector("[data-prev]").focus();
          emit("change", { value: current });
        }
      });
      render();
      updateData = () => {
        steps = data().items || defaults;
        current = Math.min(current, Math.max(0, steps.length - 1));
        render();
      };
      replayEffect = () => {
        const track = area.querySelector(".ml-step-track");
        if (track)
          animate(
            track,
            [
              { opacity: 0.3, transform: "translateY(8px)" },
              { opacity: 1, transform: "none" },
            ],
            { fill: "none" },
          );
      };
    }
  }
  const media = matchMedia("(prefers-reduced-motion: reduce)");
  const onMedia = () => {
    options.reducedMotion = media.matches;
    theme();
    api.replay();
  };
  media.addEventListener("change", onMedia);
  restores.push(() => media.removeEventListener("change", onMedia));
  const observer = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (!visible) {
      pauseAnimations();
      light?.pause();
    } else {
      resumeAnimations();
      if (!paused) light?.play();
    }
  });
  observer.observe(root);
  restores.push(() => observer.disconnect());
  on(document, "visibilitychange", () => {
    if (document.hidden) {
      pauseAnimations();
      light?.pause();
    } else {
      resumeAnimations();
      if (!paused && visible) light?.play();
    }
  });
  const api = {
    replay() {
      clear();
      paused = false;
      progress = 0;
      replayEffect();
      if (options.reducedMotion) {
        animations.forEach((a) => a.finish());
        progress = 1;
      }
      if (!visible || document.hidden) pauseAnimations();
    },
    pause() {
      paused = true;
      pauseAnimations();
      light?.pause();
    },
    play() {
      paused = false;
      resumeAnimations();
      light?.play();
    },
    seek(p) {
      api.pause();
      progress = clamp(p);
      new Set([...animations, ...ownAnimations()]).forEach((a) => {
        const t = a.effect.getComputedTiming();
        a.currentTime = (t.delay || 0) + clamp(p) * Number(t.duration || 1600);
      });
      light?.seek(p);
    },
    get progress() {
      const a = animations[0] || ownAnimations()[0];
      if (a) {
        const d = Number(a.effect.getComputedTiming().duration) || 1;
        return clamp(((Number(a.currentTime) || 0) % d) / d);
      }
      return progress;
    },
    update(next) {
      const retime =
        (next.duration != null && next.duration !== options.duration) ||
        (next.speed != null && next.speed !== options.speed);
      options = { ...options, ...next };
      theme();
      if (Object.hasOwn(next, "data")) updateData();
      if (options.reducedMotion) {
        animations.forEach((a) => {
          a.effect.updateTiming({ iterations: 1 });
          a.finish();
        });
        light?.pause();
      } else if (retime) {
        const wasPaused = paused;
        clear();
        replayEffect();
        paused = wasPaused;
        if (paused) pauseAnimations();
      }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      clear();
      restores.reverse().forEach((fn) => fn());
      for (const n of owned) n.remove();
      for (const [el, map] of styles)
        for (const [k, [value, priority]] of map) {
          if (value) el.style.setProperty(k, value, priority);
          else el.style.removeProperty(k);
        }
      for (const el of emptyStyle)
        if (!el.getAttribute("style")) el.removeAttribute("style");
      for (const [el, map] of attrs)
        for (const [k, value] of map) {
          if (value === null) el.removeAttribute(k);
          else el.setAttribute(k, value);
        }
      for (const [el, { empty, names }] of classes) {
        names.forEach((n) => el.classList.remove(n));
        if (empty && !el.className) el.removeAttribute("class");
      }
      if (!root.getAttribute("style")) root.removeAttribute("style");
    },
  };
  api.replay();
  return api;
}
export const mount = (root, item, options) =>
  instance(root, item, options, false);
export const applyToElement = (root, item, options) =>
  instance(root, item, options, true);
