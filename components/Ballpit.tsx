"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Color,
  InstancedMesh,
  MathUtils,
  MeshPhysicalMaterial,
  Object3D,
  PerspectiveCamera,
  Plane,
  PMREMGenerator,
  PointLight,
  Raycaster,
  Scene,
  ShaderChunk,
  SphereGeometry,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
  type MeshPhysicalMaterialParameters,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export interface BallpitProps {
  className?: string;
  style?: CSSProperties;
  count?: number;
  colors?: number[];
  ambientColor?: number;
  ambientIntensity?: number;
  lightIntensity?: number;
  materialParams?: MeshPhysicalMaterialParameters;
  minSize?: number;
  maxSize?: number;
  size0?: number;
  gravity?: number;
  friction?: number;
  wallBounce?: number;
  maxVelocity?: number;
  maxX?: number;
  maxY?: number;
  maxZ?: number;
  followCursor?: boolean;
  showCursorBall?: boolean;
}

interface BallpitConfig {
  count: number;
  colors: number[];
  ambientColor: number;
  ambientIntensity: number;
  lightIntensity: number;
  materialParams: MeshPhysicalMaterialParameters;
  minSize: number;
  maxSize: number;
  size0: number;
  gravity: number;
  friction: number;
  wallBounce: number;
  maxVelocity: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  controlSphere0: boolean;
  followCursor: boolean;
  showCursorBall: boolean;
}

const DEFAULT_CONFIG: BallpitConfig = {
  count: 200,
  colors: [0, 0, 0],
  ambientColor: 0xffffff,
  ambientIntensity: 1,
  lightIntensity: 200,
  materialParams: {
    metalness: 0.5,
    roughness: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.15,
  },
  minSize: 0.5,
  maxSize: 1,
  size0: 1,
  gravity: 0.5,
  friction: 0.9975,
  wallBounce: 0.95,
  maxVelocity: 0.15,
  maxX: 5,
  maxY: 5,
  maxZ: 2,
  controlSphere0: false,
  followCursor: true,
  showCursorBall: true,
};

class BallPhysics {
  readonly positionData: Float32Array;
  readonly velocityData: Float32Array;
  readonly sizeData: Float32Array;
  readonly center = new Vector3();

  private readonly position = new Vector3();
  private readonly velocity = new Vector3();
  private readonly otherPosition = new Vector3();
  private readonly otherVelocity = new Vector3();
  private readonly difference = new Vector3();
  private readonly correction = new Vector3();
  private readonly velocityCorrection = new Vector3();

  constructor(readonly config: BallpitConfig) {
    this.positionData = new Float32Array(3 * config.count);
    this.velocityData = new Float32Array(3 * config.count);
    this.sizeData = new Float32Array(config.count).fill(1);
    this.initializePositions();
    this.initializeSizes();
  }

  private initializePositions() {
    this.center.toArray(this.positionData, 0);
    for (let index = 1; index < this.config.count; index += 1) {
      const offset = index * 3;
      this.positionData[offset] = MathUtils.randFloatSpread(this.config.maxX * 2);
      this.positionData[offset + 1] = MathUtils.randFloatSpread(this.config.maxY * 2);
      this.positionData[offset + 2] = MathUtils.randFloatSpread(this.config.maxZ * 2);
    }
  }

  private initializeSizes() {
    this.sizeData[0] = this.config.size0;
    for (let index = 1; index < this.config.count; index += 1) {
      this.sizeData[index] = MathUtils.randFloat(this.config.minSize, this.config.maxSize);
    }
  }

  update(delta: number) {
    const { config, positionData, sizeData, velocityData } = this;
    const startIndex = config.controlSphere0 ? 1 : 0;

    if (config.controlSphere0) {
      this.position
        .fromArray(positionData, 0)
        .lerp(this.center, 0.1)
        .toArray(positionData, 0);
      this.velocity.set(0, 0, 0).toArray(velocityData, 0);
    }

    for (let index = startIndex; index < config.count; index += 1) {
      const offset = index * 3;
      this.position.fromArray(positionData, offset);
      this.velocity.fromArray(velocityData, offset);
      this.velocity.y -= delta * config.gravity * sizeData[index];
      this.velocity.multiplyScalar(config.friction);
      this.velocity.clampLength(0, config.maxVelocity);
      this.position.add(this.velocity);
      this.position.toArray(positionData, offset);
      this.velocity.toArray(velocityData, offset);
    }

    for (let index = startIndex; index < config.count; index += 1) {
      const offset = index * 3;
      const radius = sizeData[index];
      this.position.fromArray(positionData, offset);
      this.velocity.fromArray(velocityData, offset);

      for (let otherIndex = index + 1; otherIndex < config.count; otherIndex += 1) {
        const otherOffset = otherIndex * 3;
        const otherRadius = sizeData[otherIndex];
        this.otherPosition.fromArray(positionData, otherOffset);
        this.otherVelocity.fromArray(velocityData, otherOffset);
        this.difference.copy(this.otherPosition).sub(this.position);

        const distance = this.difference.length();
        const combinedRadius = radius + otherRadius;
        if (distance >= combinedRadius || distance === 0) continue;

        this.correction
          .copy(this.difference)
          .normalize()
          .multiplyScalar((combinedRadius - distance) * 0.5);
        this.velocityCorrection
          .copy(this.correction)
          .multiplyScalar(Math.max(this.velocity.length(), 1));

        this.position.sub(this.correction);
        this.velocity.sub(this.velocityCorrection);
        this.otherPosition.add(this.correction);
        this.otherVelocity.add(
          this.velocityCorrection
            .copy(this.correction)
            .multiplyScalar(Math.max(this.otherVelocity.length(), 1)),
        );

        this.position.toArray(positionData, offset);
        this.velocity.toArray(velocityData, offset);
        this.otherPosition.toArray(positionData, otherOffset);
        this.otherVelocity.toArray(velocityData, otherOffset);
      }

      if (config.controlSphere0) {
        this.otherPosition.fromArray(positionData, 0);
        this.difference.copy(this.otherPosition).sub(this.position);
        const distance = this.difference.length();
        const combinedRadius = radius + sizeData[0];

        if (distance < combinedRadius && distance > 0) {
          this.correction
            .copy(this.difference)
            .normalize()
            .multiplyScalar(combinedRadius - distance);
          this.velocityCorrection
            .copy(this.correction)
            .multiplyScalar(Math.max(this.velocity.length(), 2));
          this.position.sub(this.correction);
          this.velocity.sub(this.velocityCorrection);
        }
      }

      if (Math.abs(this.position.x) + radius > config.maxX) {
        this.position.x = Math.sign(this.position.x) * (config.maxX - radius);
        this.velocity.x *= -config.wallBounce;
      }

      if (config.gravity === 0) {
        if (Math.abs(this.position.y) + radius > config.maxY) {
          this.position.y = Math.sign(this.position.y) * (config.maxY - radius);
          this.velocity.y *= -config.wallBounce;
        }
      } else if (this.position.y - radius < -config.maxY) {
        this.position.y = -config.maxY + radius;
        this.velocity.y *= -config.wallBounce;
      }

      const depthBoundary = Math.max(config.maxZ, config.maxSize);
      if (Math.abs(this.position.z) + radius > depthBoundary) {
        this.position.z = Math.sign(this.position.z) * (config.maxZ - radius);
        this.velocity.z *= -config.wallBounce;
      }

      this.position.toArray(positionData, offset);
      this.velocity.toArray(velocityData, offset);
    }
  }
}

class TranslucentBallMaterial extends MeshPhysicalMaterial {
  private readonly thicknessUniforms = {
    thicknessDistortion: { value: 0.1 },
    thicknessAmbient: { value: 0 },
    thicknessAttenuation: { value: 0.1 },
    thicknessPower: { value: 2 },
    thicknessScale: { value: 10 },
  };

  constructor(parameters: MeshPhysicalMaterialParameters) {
    super(parameters);
    this.defines = { ...this.defines, USE_UV: "" };
    this.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.thicknessUniforms);
      shader.fragmentShader = `
        uniform float thicknessPower;
        uniform float thicknessScale;
        uniform float thicknessDistortion;
        uniform float thicknessAmbient;
        uniform float thicknessAttenuation;
      ${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `
          void RE_Direct_Scattering(
            const in IncidentLight directLight,
            const in vec2 uv,
            const in vec3 geometryPosition,
            const in vec3 geometryNormal,
            const in vec3 geometryViewDir,
            const in vec3 geometryClearcoatNormal,
            inout ReflectedLight reflectedLight
          ) {
            vec3 scatteringHalf = normalize(
              directLight.direction + (geometryNormal * thicknessDistortion)
            );
            float scatteringDot = pow(
              saturate(dot(geometryViewDir, -scatteringHalf)),
              thicknessPower
            ) * thicknessScale;
            #ifdef USE_COLOR
              vec3 scatteringIllu = (scatteringDot + thicknessAmbient) * vColor;
            #else
              vec3 scatteringIllu = (scatteringDot + thicknessAmbient) * diffuse;
            #endif
            reflectedLight.directDiffuse += scatteringIllu
              * thicknessAttenuation
              * directLight.color;
          }

          void main() {
        `,
      );
      const lightingChunk = ShaderChunk.lights_fragment_begin.replaceAll(
        "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );",
        `
          RE_Direct(
            directLight,
            geometryPosition,
            geometryNormal,
            geometryViewDir,
            geometryClearcoatNormal,
            material,
            reflectedLight
          );
          RE_Direct_Scattering(
            directLight,
            vUv,
            geometryPosition,
            geometryNormal,
            geometryViewDir,
            geometryClearcoatNormal,
            reflectedLight
          );
        `,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_begin>",
        lightingChunk,
      );
    };
  }
}

class BallSpheres extends InstancedMesh {
  readonly physics: BallPhysics;
  readonly config: BallpitConfig;

  private readonly transformObject = new Object3D();
  private readonly environmentTexture: Texture;
  private readonly ambientLight: AmbientLight;
  private readonly pointLight: PointLight;

  constructor(renderer: WebGLRenderer, config: BallpitConfig) {
    const environment = new RoomEnvironment();
    const environmentGenerator = new PMREMGenerator(renderer);
    const environmentTexture = environmentGenerator.fromScene(environment).texture;
    const geometry = new SphereGeometry(1, 24, 18);
    const material = new TranslucentBallMaterial({
      envMap: environmentTexture,
      ...config.materialParams,
    });
    material.envMapRotation.x = -Math.PI / 2;

    super(geometry, material, config.count);

    environment.dispose();
    environmentGenerator.dispose();

    this.config = config;
    this.environmentTexture = environmentTexture;
    this.physics = new BallPhysics(config);
    this.frustumCulled = false;

    this.ambientLight = new AmbientLight(config.ambientColor, config.ambientIntensity);
    this.pointLight = new PointLight(
      config.colors[0],
      config.showCursorBall ? config.lightIntensity : 0,
    );
    this.add(this.ambientLight, this.pointLight);
    this.setColors(config.colors);
    this.update(0);
  }

  private setColors(colors: number[]) {
    const palette = colors.length > 0 ? colors.map((value) => new Color(value)) : [new Color(0xffffff)];
    const output = new Color();

    for (let index = 0; index < this.count; index += 1) {
      const ratio = this.count <= 1 ? 0 : index / (this.count - 1);
      const scaled = ratio * (palette.length - 1);
      const paletteIndex = Math.floor(scaled);
      const start = palette[paletteIndex];
      const end = palette[Math.min(paletteIndex + 1, palette.length - 1)];
      output.copy(start).lerp(end, scaled - paletteIndex);
      this.setColorAt(index, output);
      if (index === 0) this.pointLight.color.copy(output);
    }

    if (this.instanceColor) this.instanceColor.needsUpdate = true;
  }

  update(delta: number) {
    this.physics.update(delta);

    for (let index = 0; index < this.count; index += 1) {
      this.transformObject.position.fromArray(this.physics.positionData, index * 3);
      this.transformObject.scale.setScalar(
        index === 0 && (!this.config.followCursor || !this.config.showCursorBall)
          ? 0
          : this.physics.sizeData[index],
      );
      this.transformObject.updateMatrix();
      this.setMatrixAt(index, this.transformObject.matrix);
      if (index === 0) this.pointLight.position.copy(this.transformObject.position);
    }

    this.instanceMatrix.needsUpdate = true;
  }

  disposeResources() {
    this.geometry.dispose();
    (this.material as MeshPhysicalMaterial).dispose();
    this.environmentTexture.dispose();
  }
}

class BallpitScene {
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 100);
  private readonly scene = new Scene();
  private readonly timer = new Timer();
  private readonly resizeObserver: ResizeObserver;
  private readonly intersectionObserver: IntersectionObserver;
  private readonly raycaster = new Raycaster();
  private readonly pointerPlane = new Plane(new Vector3(0, 0, 1), 0);
  private readonly intersectionPoint = new Vector3();
  private readonly pointerPosition = new Vector2();
  private readonly spheres: BallSpheres;

  private animationFrame = 0;
  private resizeFrame = 0;
  private isIntersecting = true;
  private isAnimating = false;
  private disposed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    config: BallpitConfig,
  ) {
    const rendererContext = canvas.getContext("webgl2", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    }) ?? canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    if (!rendererContext) {
      throw new Error("WebGL is unavailable.");
    }

    this.renderer = new WebGLRenderer({
      canvas,
      context: rendererContext,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.camera.position.set(0, 0, 20);
    this.camera.lookAt(0, 0, 0);

    this.spheres = new BallSpheres(this.renderer, config);
    this.scene.add(this.spheres);

    this.resizeObserver = new ResizeObserver(this.handleResize);
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);

    this.intersectionObserver = new IntersectionObserver(this.handleIntersection, {
      root: null,
      rootMargin: "0px",
      threshold: 0,
    });
    this.intersectionObserver.observe(canvas);

    window.addEventListener("resize", this.handleResize, { passive: true });
    window.addEventListener("blur", this.handlePointerLeave);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    if (config.followCursor) {
      window.addEventListener("pointermove", this.handlePointerMove, { passive: true });
    }

    this.resize();
    this.start();
  }

  private readonly handleResize = () => {
    if (this.resizeFrame) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = window.requestAnimationFrame(() => this.resize());
  };

  private readonly handleIntersection = (entries: IntersectionObserverEntry[]) => {
    this.isIntersecting = entries[0]?.isIntersecting ?? false;
    if (this.isIntersecting && !document.hidden) {
      this.start();
    } else {
      this.stop();
    }
  };

  private readonly handleVisibilityChange = () => {
    if (document.hidden) {
      this.stop();
    } else if (this.isIntersecting) {
      this.start();
    }
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") {
      this.handlePointerLeave();
      return;
    }

    const bounds = this.canvas.getBoundingClientRect();
    const inside = event.clientX >= bounds.left
      && event.clientX <= bounds.right
      && event.clientY >= bounds.top
      && event.clientY <= bounds.bottom;

    if (!inside || bounds.width === 0 || bounds.height === 0) {
      this.handlePointerLeave();
      return;
    }

    this.pointerPosition.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointerPosition, this.camera);
    this.camera.getWorldDirection(this.pointerPlane.normal);

    if (this.raycaster.ray.intersectPlane(this.pointerPlane, this.intersectionPoint)) {
      this.spheres.physics.center.copy(this.intersectionPoint);
      this.spheres.config.controlSphere0 = true;
    }
  };

  private readonly handlePointerLeave = () => {
    this.spheres.config.controlSphere0 = false;
  };

  private resize() {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();

    const fovRadians = MathUtils.degToRad(this.camera.fov);
    const worldHeight = 2 * Math.tan(fovRadians / 2) * this.camera.position.length();
    const worldWidth = worldHeight * this.camera.aspect;
    this.spheres.config.maxX = worldWidth / 2;
    this.spheres.config.maxY = worldHeight / 2;

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
  }

  private start() {
    if (this.isAnimating || this.disposed) return;

    this.isAnimating = true;
    this.timer.reset();
    const animate = () => {
      if (!this.isAnimating || this.disposed) return;
      this.animationFrame = window.requestAnimationFrame(animate);
      this.timer.update();
      this.spheres.update(Math.min(this.timer.getDelta(), 0.034));
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  private stop() {
    if (!this.isAnimating) return;
    window.cancelAnimationFrame(this.animationFrame);
    this.isAnimating = false;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    if (this.resizeFrame) window.cancelAnimationFrame(this.resizeFrame);

    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("blur", this.handlePointerLeave);
    window.removeEventListener("pointermove", this.handlePointerMove);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);

    this.scene.remove(this.spheres);
    this.spheres.disposeResources();
    this.timer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}

// Adapted from the open-source React Bits Ballpit component for a passive,
// book-cover layer. Pointer tracking is mouse-only and never cancels page touch.
export default function Ballpit({
  className = "",
  style,
  count = DEFAULT_CONFIG.count,
  colors = DEFAULT_CONFIG.colors,
  ambientColor = DEFAULT_CONFIG.ambientColor,
  ambientIntensity = DEFAULT_CONFIG.ambientIntensity,
  lightIntensity = DEFAULT_CONFIG.lightIntensity,
  materialParams = DEFAULT_CONFIG.materialParams,
  minSize = DEFAULT_CONFIG.minSize,
  maxSize = DEFAULT_CONFIG.maxSize,
  size0 = DEFAULT_CONFIG.size0,
  gravity = DEFAULT_CONFIG.gravity,
  friction = DEFAULT_CONFIG.friction,
  wallBounce = DEFAULT_CONFIG.wallBounce,
  maxVelocity = DEFAULT_CONFIG.maxVelocity,
  maxX = DEFAULT_CONFIG.maxX,
  maxY = DEFAULT_CONFIG.maxY,
  maxZ = DEFAULT_CONFIG.maxZ,
  followCursor = DEFAULT_CONFIG.followCursor,
  showCursorBall = DEFAULT_CONFIG.showCursorBall,
}: BallpitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let ballpitScene: BallpitScene | null = null;

    const createScene = () => {
      if (reducedMotion.matches || ballpitScene) return;
      canvas.style.display = "block";
      try {
        ballpitScene = new BallpitScene(canvas, {
          count: count + (followCursor && !showCursorBall ? 1 : 0),
          colors,
          ambientColor,
          ambientIntensity,
          lightIntensity,
          materialParams,
          minSize,
          maxSize,
          size0,
          gravity,
          friction,
          wallBounce,
          maxVelocity,
          maxX,
          maxY,
          maxZ,
          controlSphere0: false,
          followCursor,
          showCursorBall,
        });
      } catch (error) {
        canvas.style.display = "none";
        console.info("Ballpit is using its static cover fallback.", error);
      }
    };

    const handleMotionPreference = () => {
      if (reducedMotion.matches) {
        ballpitScene?.dispose();
        ballpitScene = null;
      } else {
        createScene();
      }
    };

    createScene();
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      reducedMotion.removeEventListener("change", handleMotionPreference);
      ballpitScene?.dispose();
    };
  }, [
    ambientColor,
    ambientIntensity,
    colors,
    count,
    followCursor,
    friction,
    gravity,
    lightIntensity,
    materialParams,
    maxSize,
    maxVelocity,
    maxX,
    maxY,
    maxZ,
    minSize,
    size0,
    showCursorBall,
    wallBounce,
  ]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden="true"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}
