/* Context Reader PillNavAction port: measured bottom-circle fill and two label layers.
 * Geometry originated in React Bits PillNav, Copyright (c) 2026 David Haz.
 * MIT + Commons Clause: third-party/controls/react-bits/LICENSE.md and NOTICE.md.
 * Only our visual layer is animated. The original button/link and its business nodes survive.
 */
import { contrastInk } from '../../sdk/materials.js';

const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const power3Out = (value) => 1 - (1 - value) ** 4;

export function applyToElement(target, item, initial = {}) {
  let options = { ...initial }, disposed = false, frame = 0, position = 0;
  let tween = null, paused = false, replayTimer = 0, height = 0, syncing = false;
  const savedStyles = new Map(), hadStyle = target.hasAttribute('style');
  const hadClass = target.hasAttribute('class'), hadHost = target.classList.contains('gcp-host');
  const initialInk = getComputedStyle(target).color;
  const abort = new AbortController();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const on = (node, event, handler) => node.addEventListener(event, handler, { signal: abort.signal });
  const setStyle = (name, value, priority = '') => {
    if (!savedStyles.has(name)) savedStyles.set(name, [target.style.getPropertyValue(name), target.style.getPropertyPriority(name)]);
    target.style.setProperty(name, value, priority);
  };
  const visual = document.createElement('span');
  visual.className = 'gcp-visual';
  visual.setAttribute('aria-hidden', 'true');
  visual.inert = true;
  const circle = document.createElement('span'); circle.className = 'gcp-circle';
  const stack = document.createElement('span'); stack.className = 'gcp-stack';
  const primary = document.createElement('span'); primary.className = 'gcp-primary';
  const hover = document.createElement('span'); hover.className = 'gcp-hover';
  stack.append(primary, hover); visual.append(circle, stack);

  const isDisabled = () => target.matches(':disabled,[aria-disabled="true"]');
  const isReduced = () => options.reducedMotion || reduced.matches;
  const duration = (enter) => Math.max(0, Number(options.duration ?? item.defaultDuration ?? 300)) * (enter ? 1 : 2 / 3) / Math.max(.2, Number(options.speed) || 1);

  function draw(value) {
    position = clamp(value);
    // GSAP timeline.tweenTo(power3.out) drives three power3.out tracks in the source.
    const eased = power3Out(position);
    circle.style.transform = `translateX(-50%) scale(${eased * 1.2})`;
    primary.style.transform = `translateY(${-eased * (height + 8)}px)`;
    hover.style.transform = `translateY(${Math.ceil(height + 100) * (1 - eased)}px)`;
    hover.style.opacity = String(eased);
  }
  function cancel() {
    cancelAnimationFrame(frame); frame = 0; tween = null;
    clearTimeout(replayTimer); replayTimer = 0;
  }
  function tick(now) {
    frame = 0;
    if (disposed || paused || !tween) return;
    const progress = clamp((now - tween.started) / tween.duration);
    draw(tween.from + (tween.to - tween.from) * power3Out(progress));
    if (progress < 1) frame = requestAnimationFrame(tick);
    else tween = null;
  }
  function move(to, { demo = false } = {}) {
    cancel(); paused = false;
    if (isDisabled() || document.hidden) { draw(0); return; }
    if (isReduced()) { draw(to); return; }
    if (!demo && !finePointer.matches) { draw(0); return; }
    const time = duration(to > 0);
    if (!time) { draw(to); return; }
    tween = { from: position, to, started: performance.now(), duration: time };
    frame = requestAnimationFrame(tick);
  }
  function layout() {
    if (disposed) return;
    // offset dimensions stay correct when the host page is scaled inside a preview iframe.
    const width = target.offsetWidth || target.getBoundingClientRect().width;
    height = target.offsetHeight || target.getBoundingClientRect().height || 1;
    const radius = ((width * width) / 4 + height * height) / (2 * height);
    const diameter = Math.ceil(2 * radius) + 2;
    const delta = Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - (width * width) / 4))) + 1;
    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.bottom = `-${delta}px`;
    circle.style.transformOrigin = `50% ${diameter - delta}px`;
    draw(isDisabled() ? 0 : position);
  }
  function syncContent() {
    if (disposed || syncing) return;
    syncing = true;
    observer.disconnect();
    // Context Reader supplies one authoritative primary label, not both native label copies.
    const source = target.querySelector('[data-pill-primary]');
    const nodes = [...(source || target).childNodes].filter(node => node !== visual && !(node.nodeType === 1 && node.matches('[data-pill-hover],[data-pill-circle],.gc-decoration,.sl-glare,script,style')));
    const clones = () => nodes.map(node => {
      const clone = node.cloneNode(true);
      if (clone.nodeType === 1) {
        clone.removeAttribute('id');
        clone.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
      }
      return clone;
    });
    primary.replaceChildren(...clones()); hover.replaceChildren(...clones());
    if (!visual.isConnected || visual.parentElement !== target) target.append(visual);
    observer.observe(target, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled', 'aria-label', 'd', 'viewBox', 'fill', 'stroke', 'width', 'height', 'href', 'src'] });
    syncing = false;
    layout();
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => !visual.contains(record.target))) syncContent();
    if (isDisabled()) { cancel(); draw(0); }
  });
  function theme() {
    setStyle('--gcp-fill', options.accent || '#387887');
    setStyle('--gcp-hover-ink', contrastInk(options.accent || '#387887'));
    const explicitInk = options.textColor && CSS.supports('color', options.textColor) ? options.textColor : null;
    setStyle('--gcp-base-ink', explicitInk || initialInk);
    setStyle('--gcp-explicit-ink', explicitInk || '');
    setStyle('font-family', options.font || 'inherit');
    setStyle('font-size', `${options.fontSize || 16}px`);
    setStyle('border-radius', `${options.radius ?? 28}px`);
    // Direct text nodes cannot be hidden with a selector. Keep their accessible name and sizing.
    setStyle('color', 'transparent', 'important');
    target.classList.add('gcp-host');
  }
  theme(); syncContent();
  const resize = new ResizeObserver(layout); resize.observe(target);
  const mediaChanged = () => { cancel(); draw(0); layout(); };
  on(target, 'pointerenter', () => move(1));
  on(target, 'pointerleave', () => move(0));
  on(target, 'focus', () => move(1, { demo: true }));
  on(target, 'blur', () => move(0, { demo: true }));
  on(document, 'visibilitychange', () => { if (document.hidden) { cancel(); draw(0); } });
  on(reduced, 'change', mediaChanged); on(finePointer, 'change', mediaChanged);
  document.fonts?.ready.then(() => { if (!disposed) layout(); }).catch(() => {});

  return {
    replay() {
      cancel(); draw(0); move(1, { demo: true });
      // Include leaving in the demonstration. Manual hover holds the filled state until leave.
      if (!isReduced() && !isDisabled()) replayTimer = setTimeout(() => move(0, { demo: true }), duration(true) + 600 / Math.max(.2, options.speed || 1));
    },
    pause() {
      if (tween) { tween.remaining = Math.max(0, tween.duration - (performance.now() - tween.started)); }
      paused = true; cancelAnimationFrame(frame); frame = 0; clearTimeout(replayTimer);
    },
    play() {
      paused = false;
      if (tween) { tween = { from: position, to: tween.to, started: performance.now(), duration: tween.remaining ?? tween.duration }; frame = requestAnimationFrame(tick); }
    },
    seek(value) { cancel(); paused = true; draw(isDisabled() ? 0 : clamp(value)); },
    get progress() { return position; },
    update(next = {}) {
      options = { ...options, ...next }; theme();
      if (isReduced() || isDisabled()) { cancel(); draw(0); }
      syncContent();
    },
    destroy() {
      if (disposed) return;
      disposed = true; cancel(); abort.abort(); observer.disconnect(); resize.disconnect(); visual.remove();
      if (!hadHost) target.classList.remove('gcp-host');
      for (const [name, [value, priority]] of savedStyles) {
        if (value) target.style.setProperty(name, value, priority); else target.style.removeProperty(name);
      }
      if (!hadStyle && !target.getAttribute('style')) target.removeAttribute('style');
      if (!hadClass && !target.getAttribute('class')) target.removeAttribute('class');
      // data-ui-effect-owner belongs to the project runtime, never this adapter.
    },
  };
}

export function mount(root, item, initial = {}) {
  const hadStage = root.classList.contains('gcp-stage'), hadClass = root.hasAttribute('class');
  root.classList.add('gcp-stage');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'gcp-sample';
  let options = { ...initial };
  const label = document.createElement('span');
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24'); icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<path d="M5 12h14m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.5"/>';
  label.textContent = options.data?.label ?? '继续阅读'; button.append(label, icon); root.append(button);
  const click = () => { if (!button.disabled) options.onAction?.('complete', { id: item.id }); };
  button.addEventListener('click', click);
  const controller = applyToElement(button, item, options);
  return {
    ...controller,
    get progress() { return controller.progress; },
    update(next) {
      options = { ...options, ...next };
      if (Object.hasOwn(next, 'data')) { label.textContent = next.data?.label ?? '继续阅读'; button.disabled = !!next.data?.disabled; }
      controller.update(next);
    },
    destroy() {
      controller.destroy(); button.removeEventListener('click', click); button.remove();
      if (!hadStage) root.classList.remove('gcp-stage');
      if (!hadClass && !root.getAttribute('class')) root.removeAttribute('class');
    },
  };
}
