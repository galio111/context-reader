/* React Bits SpecularButton shader and perimeter geometry, David Haz, MIT + Commons Clause.
 * Original: third-party/materials/react-bits/SpecularButton.jsx. DOM lifecycle port below. */
const PAD = 24;
const TAU = Math.PI * 2;

const VERTEX = `#version 300 es
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uPx;
uniform float uSpot;
uniform vec2 uEntry;
uniform vec3 uLineColor;
uniform vec3 uBaseColor;
uniform float uIntensity;
uniform vec2 uWindow;
uniform float uThickness;
uniform float uGlow;
out vec4 outColor;

float roundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

float loopPosition(vec2 p, vec2 b, float r) {
  vec2 inner = b - r;
  float arc = 1.5707963 * r;
  float quarter = inner.x + inner.y + arc;
  vec2 a = abs(p);
  vec2 q = a - inner;
  float s = q.x > 0.0 && q.y > 0.0
    ? inner.y + atan(q.y, q.x) * r
    : (q.x > q.y ? min(a.y, inner.y) : inner.y + arc + inner.x - min(a.x, inner.x));
  if (p.x < 0.0) s = p.y >= 0.0 ? 2.0 * quarter - s : 2.0 * quarter + s;
  else if (p.y < 0.0) s = 4.0 * quarter - s;
  return s / max(4.0 * quarter, 0.0001);
}

float lobe(float position, float center) {
  float gap = abs(fract(position - center + 0.5) - 0.5);
  return 1.0 - smoothstep(uWindow.x, uWindow.x + uWindow.y, gap);
}

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float d = roundedBox(p, uHalf, uRadius);
  float position = loopPosition(p, uHalf, uRadius);
  float key = lobe(position, uSpot);
  float back = lobe(position, uSpot + 0.5);
  float streak = key + back * 0.45;
  float width = max(uThickness * uPx * mix(1.0, max(key, back), 0.6), 0.35);
  float band = smoothstep(-width - 0.6, -width + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float hair = smoothstep(-uPx - 0.6, -uPx + 0.6, d) * (1.0 - smoothstep(-0.6, 0.6, d));
  float inside = 1.0 - smoothstep(-0.6, 0.6, d);
  vec2 pool = (p - uEntry) / (uHalf.y * vec2(1.6, 1.1));
  float glow = streak * 0.2 * exp(-abs(d + width * 0.5) / (5.0 * uPx)) + inside * 0.08 * exp(-dot(pool, pool));
  float light = clamp((band * streak + glow * uGlow) * uIntensity, 0.0, 1.0);
  vec4 base = vec4(uBaseColor, 1.0) * hair * 0.6;
  outColor = vec4(uLineColor, 1.0) * light + base * (1.0 - light);
}`;

const UNIFORMS = [
  "uCenter",
  "uHalf",
  "uRadius",
  "uPx",
  "uSpot",
  "uEntry",
  "uLineColor",
  "uBaseColor",
  "uIntensity",
  "uWindow",
  "uThickness",
  "uGlow",
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const wrap = (value) => value - Math.floor(value);

const loopPosition = (x, y, halfX, halfY, r) => {
  const innerX = halfX - r;
  const innerY = halfY - r;
  const arc = (Math.PI / 2) * r;
  const quarter = innerX + innerY + arc;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const qx = ax - innerX;
  const qy = ay - innerY;
  let s;
  if (qx > 0 && qy > 0) s = innerY + Math.atan2(qy, qx) * r;
  else if (qx > qy) s = Math.min(ay, innerY);
  else s = innerY + arc + innerX - Math.min(ax, innerX);
  if (x < 0) s = y >= 0 ? 2 * quarter - s : 2 * quarter + s;
  else if (y < 0) s = 4 * quarter - s;
  return wrap(s / Math.max(4 * quarter, 0.0001));
};

const rimPoint = (position, halfX, halfY, r) => {
  const innerX = halfX - r;
  const innerY = halfY - r;
  const arc = (Math.PI / 2) * r;
  const quarter = innerX + innerY + arc;
  let s = wrap(position) * 4 * quarter;
  let signX = 1;
  let signY = 1;
  if (s > 3 * quarter) {
    s = 4 * quarter - s;
    signY = -1;
  } else if (s > 2 * quarter) {
    s -= 2 * quarter;
    signX = -1;
    signY = -1;
  } else if (s > quarter) {
    s = 2 * quarter - s;
    signX = -1;
  }
  let x = innerX - (s - innerY - arc);
  let y = halfY;
  if (s <= innerY) {
    x = halfX;
    y = s;
  } else if (s <= innerY + arc) {
    const angle = (s - innerY) / Math.max(r, 0.0001);
    x = innerX + Math.cos(angle) * r;
    y = innerY + Math.sin(angle) * r;
  }
  return [x * signX, y * signY];
};

const compile = (gl, type, source) => {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  gl.deleteShader(shader);
  return null;
};

const link = (gl) => {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vertex || !fragment || !program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPosition");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
};

export function specularLight(button, initial) {
  let options = initial,
    disposed = false,
    paused = false,
    frame = 0,
    spot = 0.72,
    goal = 0.72,
    level = 0.65,
    burst = 0;
  const canvas = document.createElement("canvas");
  canvas.className = "ml-specular-canvas";
  canvas.setAttribute("aria-hidden", "true");
  button.append(canvas);
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) {
    canvas.remove();
    return {
      update() {},
      replay() {},
      pause() {},
      play() {},
      seek() {},
      destroy() {},
    };
  }
  const program = link(gl);
  if (!program) {
    canvas.remove();
    return {
      update() {},
      replay() {},
      pause() {},
      play() {},
      seek() {},
      destroy() {},
    };
  }
  const uniforms = Object.fromEntries(
      UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]),
    ),
    buffer = gl.createBuffer(),
    vao = gl.createVertexArray(),
    abort = new AbortController();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  let width = 1,
    height = 1,
    ratio = 1;
  const rgb = (hex) =>
    (hex.match(/[\da-f]{2}/gi) || ["24", "26", "29"]).map(
      (n) => parseInt(n, 16) / 255,
    );
  function draw() {
    if (disposed || gl.isContextLost()) return;
    const r = Math.min(options.radius, width / 2, height / 2),
      [x, y] = rimPoint(spot, width / 2, height / 2, r);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniform2f(
      uniforms.uCenter,
      (PAD + width / 2) * ratio,
      (PAD + height / 2) * ratio,
    );
    gl.uniform2f(uniforms.uHalf, (width / 2) * ratio, (height / 2) * ratio);
    gl.uniform1f(uniforms.uRadius, r * ratio);
    gl.uniform1f(uniforms.uPx, ratio);
    gl.uniform1f(uniforms.uSpot, spot);
    gl.uniform2f(uniforms.uEntry, x * 0.7 * ratio, y * 0.7 * ratio);
    gl.uniform3fv(uniforms.uLineColor, [1, 1, 1]);
    gl.uniform3fv(uniforms.uBaseColor, rgb(options.accent));
    gl.uniform1f(uniforms.uIntensity, level + burst);
    gl.uniform2f(uniforms.uWindow, 0.04, 0.12);
    gl.uniform1f(uniforms.uThickness, 1.7);
    gl.uniform1f(uniforms.uGlow, 1.2);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
  function tick() {
    frame = 0;
    if (paused || disposed || document.hidden) return;
    const diff = goal - spot - Math.round(goal - spot);
    spot = wrap(spot + diff * 0.14);
    burst *= 0.92;
    draw();
    if (Math.abs(diff) > 0.0002 || burst > 0.002)
      frame = requestAnimationFrame(tick);
  }
  const wake = () => {
    if (
      !paused &&
      !disposed &&
      !options.reducedMotion &&
      !frame &&
      !document.hidden
    )
      frame = requestAnimationFrame(tick);
    else if (options.reducedMotion) draw();
  };
  const on = (type, fn) =>
    button.addEventListener(type, fn, { signal: abort.signal, passive: true });
  on("pointermove", (e) => {
    if (options.reducedMotion || button.disabled) return;
    const box = button.getBoundingClientRect();
    goal = loopPosition(
      e.clientX - box.left - box.width / 2,
      box.height / 2 - (e.clientY - box.top),
      box.width / 2,
      box.height / 2,
      Math.min(options.radius, box.height / 2),
    );
    level = 1;
    wake();
  });
  on("pointerleave", () => {
    goal = 0.72;
    level = 0.65;
    wake();
  });
  on("pointerdown", () => {
    if (button.disabled) return;
    burst = 0.8;
    wake();
  });
  const resize = new ResizeObserver(() => {
    width = button.offsetWidth;
    height = button.offsetHeight;
    ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round((width + 48) * ratio);
    canvas.height = Math.round((height + 48) * ratio);
    draw();
  });
  resize.observe(button);
  return {
    update(next) {
      options = next;
      draw();
    },
    replay() {
      if (options.reducedMotion) {
        draw();
        return;
      }
      spot = 0.1;
      goal = 0.8;
      burst = 1;
      wake();
    },
    pause() {
      paused = true;
      cancelAnimationFrame(frame);
      frame = 0;
    },
    play() {
      paused = false;
      wake();
    },
    seek(p) {
      spot = p;
      draw();
    },
    destroy() {
      disposed = true;
      abort.abort();
      resize.disconnect();
      cancelAnimationFrame(frame);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}
