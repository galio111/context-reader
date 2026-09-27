import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("real scene lifecycle applies departure before its first renderer call and pauses departed scenes", () => {
  const source = readFileSync(new URL("../components/Ballpit.tsx", import.meta.url), "utf8");
  const component = source.slice(source.indexOf("class BallpitScene"), source.indexOf("// Adapted from"));
  const renders = []; let frames = 0;
  class Empty { observe() {} disconnect() {} dispose() {} reset() {} }
  class Renderer extends Empty { setClearColor() {} setPixelRatio() {} setSize() {} render(scene) { renders.push(scene.spheres.departureProgress); } }
  class Scene { add(spheres) { this.spheres = spheres; } remove() {} }
  class Camera { position = { set() {}, length: () => 20 }; lookAt() {} updateProjectionMatrix() {} }
  class Spheres { departureProgress = 0; constructor(_renderer, config) { this.config = config; } update() {} disposeResources() {} }
  const context = { WebGLRenderer: Renderer, PerspectiveCamera: Camera, Scene, Timer: Empty, Raycaster: Empty, Plane: Empty, Vector3: Empty, Vector2: Empty, ResizeObserver: Empty, IntersectionObserver: Empty, BallSpheres: Spheres, URLSearchParams, performance, MathUtils: { degToRad: n => n * Math.PI / 180 }, MAX_RENDER_PIXELS: 2e6, SRGBColorSpace: 1, ACESFilmicToneMapping: 1,
    window: { location: { search: "" }, innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame() { frames++; return frames; }, cancelAnimationFrame() {} }, document: { hidden: false, addEventListener() {}, removeEventListener() {} } };
  vm.runInNewContext(ts.transpileModule(component + "\nglobalThis.SceneUnderTest=BallpitScene;", { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const canvas = { getContext: () => ({}), parentElement: { clientWidth: 1440, clientHeight: 900 }, style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, right: 1440, bottom: 900, width: 1440, height: 900 }) };
  const scene = new context.SceneUnderTest(canvas, { followCursor: false });
  assert.equal(renders.length, 0); assert.equal(frames, 0);
  scene.setDepartureProgress(1); scene.activate();
  assert.deepEqual(renders, [1]); assert.equal(canvas.style.visibility, "hidden"); assert.equal(frames, 0);
  scene.setDepartureProgress(.5); assert.equal(canvas.style.visibility, "visible"); assert.equal(frames, 1);
  scene.dispose();
});
