import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
test("component mount preserves onReady departure restoration unless a controlled prop is supplied", () => {
 const source=readFileSync(new URL("../components/Ballpit.tsx",import.meta.url),"utf8");
 const component=source.slice(source.indexOf("export default function Ballpit"));
 function mount(controlled) {
  const effects=[], calls=[], refs=[]; const canvas={style:{}};
  class Scene {setDepartureProgress(n){calls.push(n);}setGatherProgress(){}activate(){}dispose(){}}
  const ctx={DEFAULT_CONFIG:{materialParams:{}},BallpitScene:Scene,useRef(v){const ref={current:refs.length===0?canvas:v};refs.push(ref);return ref;},useEffect(fn){effects.push(fn);},window:{matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})},console,React:{createElement:()=>null}};
  vm.runInNewContext(ts.transpileModule(component.replace("export default ","")+"\nglobalThis.Subject=Ballpit;",{compilerOptions:{target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.React}}).outputText,ctx);
  const controller={current:null};ctx.Subject({controllerRef:controller,onReady:()=>controller.current.setDepartureProgress(1),...(controlled===undefined?{}:{departureProgress:controlled})});
  effects.forEach(fn=>fn());return calls;
 }
 assert.deepEqual(mount(undefined),[0,1]);
 assert.deepEqual(mount(.5),[.5,1,.5]);
});

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
