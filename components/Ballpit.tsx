"use client";

import { useEffect, useRef, type CSSProperties, type MutableRefObject } from "react";
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
  driftSpeed?: number;
  collectiveCenterX?: number;
  collectiveCenterY?: number;
  collectiveHalfWidth?: number;
  collectiveHalfHeight?: number;
  collectiveStrength?: number;
  thermalMotion?: number;
  followCursor?: boolean;
  showCursorBall?: boolean;
  departureProgress?: number;
  initialLayout?: "full" | "right";
  controllerRef?: MutableRefObject<BallpitHandle | null>;
  onReady?: () => void;
}

export interface BallpitHandle {
  setDepartureProgress: (progress: number) => void;
  setGatherProgress: (progress: number) => void;
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
  driftSpeed: number;
  collectiveCenterX: number;
  collectiveCenterY: number;
  collectiveHalfWidth: number;
  collectiveHalfHeight: number;
  collectiveStrength: number;
  thermalMotion: number;
  controlSphere0: boolean;
  followCursor: boolean;
  showCursorBall: boolean;
  initialLayout: "full" | "right";
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
  driftSpeed: 0,
  collectiveCenterX: 0,
  collectiveCenterY: 0,
  collectiveHalfWidth: 1,
  collectiveHalfHeight: 1,
  collectiveStrength: 0,
  thermalMotion: 0,
  controlSphere0: false,
  followCursor: true,
  showCursorBall: true,
  initialLayout: "full",
};

// Keep pointer/scroll responses fluid, then lower the idle WebGL cadence. The
// balls still move continuously, but a motionless cover no longer consumes the
// same GPU budget as an actively manipulated one.
const ACTIVE_FRAME_INTERVAL = 1000 / 60;
const IDLE_FRAME_INTERVAL = 1000 / 36;
const ACTIVE_AFTER_INTERACTION_MS = 1_200;
const MAX_RENDER_PIXELS = 1_300_000;

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
  private thermalTime = 0;

  constructor(readonly config: BallpitConfig) {
    this.positionData = new Float32Array(3 * config.count);
    this.velocityData = new Float32Array(3 * config.count);
    this.sizeData = new Float32Array(config.count).fill(1);
    this.initializePositions();
    this.initializeSizes();
    this.initializeVelocities();
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

  private initializeVelocities() {
    if (this.config.driftSpeed <= 0) return;
    const startIndex = this.config.followCursor ? 1 : 0;

    for (let index = startIndex; index < this.config.count; index += 1) {
      this.velocity.set(
        MathUtils.randFloatSpread(2),
        MathUtils.randFloatSpread(2),
        MathUtils.randFloatSpread(1.2),
      );
      if (this.velocity.lengthSq() < 0.0001) this.velocity.set(1, 0, 0);
      this.velocity
        .normalize()
        .multiplyScalar(this.config.driftSpeed)
        .toArray(this.velocityData, index * 3);
    }
  }

  update(delta: number) {
    const { config, positionData, sizeData, velocityData } = this;
    const startIndex = config.followCursor ? 1 : 0;
    const movingCount = Math.max(1, config.count - startIndex);
    let centerX = 0;
    let centerY = 0;

    for (let index = startIndex; index < config.count; index += 1) {
      centerX += positionData[index * 3];
      centerY += positionData[index * 3 + 1];
    }

    // This is a center-of-mass force, not a per-ball destination. It gives the
    // cloud a weak macroscopic home region while collisions, cursor impulses,
    // and thermal motion keep every individual trajectory irregular.
    const layoutBiasX = config.initialLayout === "right" ? config.maxX * 0.34 : 0;
    const visibleCenterX = centerX / movingCount + layoutBiasX;
    const visibleCenterY = centerY / movingCount;
    const centerErrorX = config.collectiveCenterX * config.maxX - visibleCenterX;
    const centerErrorY = config.collectiveCenterY * config.maxY - visibleCenterY;
    const zoneX = Math.max(0.001, config.collectiveHalfWidth * config.maxX);
    const zoneY = Math.max(0.001, config.collectiveHalfHeight * config.maxY);
    const xGain = 0.18 + 0.82 * MathUtils.smoothstep(Math.abs(centerErrorX), zoneX * 0.12, zoneX);
    const yGain = 0.18 + 0.82 * MathUtils.smoothstep(Math.abs(centerErrorY), zoneY * 0.12, zoneY);
    const stepScale = Math.min(2, Math.max(0.35, delta * 60));
    const collectiveForceX = centerErrorX * config.collectiveStrength * xGain * stepScale;
    const collectiveForceY = centerErrorY * config.collectiveStrength * yGain * stepScale;
    this.thermalTime += delta;

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
      this.velocity.x += collectiveForceX;
      this.velocity.y += collectiveForceY;

      // A center-of-mass correction alone can leave a balanced cloud with many
      // balls outside the intended composition. Add a soft statistical pressure
      // only near and beyond the group's envelope. Each ball follows a different
      // moving target and tangent, so the cloud returns visibly without looking
      // like a set of particles marching toward fixed slots.
      const visibleX = this.position.x + layoutBiasX;
      const localX = visibleX - config.collectiveCenterX * config.maxX;
      const localY = this.position.y - config.collectiveCenterY * config.maxY;
      const pressureZoneX = zoneX * 0.86;
      const pressureZoneY = zoneY * 0.86;
      const overflowX = Math.max(0, Math.abs(localX) - pressureZoneX) / pressureZoneX;
      const overflowY = Math.max(0, Math.abs(localY) - pressureZoneY) / pressureZoneY;
      const overflow = Math.hypot(overflowX, overflowY);
      if (overflow > 0 && config.collectiveStrength > 0) {
        const returnPhase = this.thermalTime * (0.31 + (index % 5) * 0.037) + index * 2.173;
        const wanderingX = Math.sin(returnPhase) * zoneX * 0.2;
        const wanderingY = Math.cos(returnPhase * 1.17) * zoneY * 0.18;
        const returnX = wanderingX - localX;
        const returnY = wanderingY - localY;
        const returnLength = Math.max(0.001, Math.hypot(returnX, returnY));
        const edgeGain = MathUtils.smoothstep(overflow, 0, 0.38);
        const pressure = config.collectiveStrength
          * (4 + Math.min(1.5, overflow) * 10)
          * edgeGain
          * stepScale;
        const tangent = Math.sin(returnPhase * 1.43) * 0.34;
        this.velocity.x += (returnX / returnLength - returnY / returnLength * tangent) * pressure;
        this.velocity.y += (returnY / returnLength + returnX / returnLength * tangent) * pressure;
      }
      if (config.thermalMotion > 0) {
        const phase = this.thermalTime * (0.74 + (index % 7) * 0.11) + index * 2.399;
        this.velocity.x += Math.sin(phase) * config.thermalMotion * stepScale;
        this.velocity.y += Math.cos(phase * 1.31) * config.thermalMotion * stepScale;
        this.velocity.z += Math.sin(phase * 0.83 + index) * config.thermalMotion * 0.45 * stepScale;
      }
      this.velocity.y -= delta * config.gravity * sizeData[index];
      this.velocity.multiplyScalar(config.friction);
      this.velocity.clampLength(0, config.maxVelocity);
      if (
        config.gravity === 0
        && config.driftSpeed > 0
        && this.velocity.lengthSq() < config.driftSpeed * config.driftSpeed
      ) {
        if (this.velocity.lengthSq() < 0.000001) {
          this.velocity.set(
            Math.sin(index * 12.9898),
            Math.cos(index * 78.233),
            Math.sin(index * 37.719) * 0.6,
          );
        }
        this.velocity.setLength(config.driftSpeed);
      }
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

        this.difference.multiplyScalar(1 / distance);
        const inverseMass = 1 / Math.max(radius ** 3, 0.001);
        const otherInverseMass = 1 / Math.max(otherRadius ** 3, 0.001);
        const totalInverseMass = inverseMass + otherInverseMass;

        this.correction
          .copy(this.difference)
          .multiplyScalar((combinedRadius - distance) / totalInverseMass);
        this.position.addScaledVector(this.correction, -inverseMass);
        this.otherPosition.addScaledVector(this.correction, otherInverseMass);

        const velocityAlongNormal = this.velocityCorrection
          .copy(this.otherVelocity)
          .sub(this.velocity)
          .dot(this.difference);
        if (velocityAlongNormal < 0) {
          const impulseMagnitude = -(
            (1 + config.wallBounce) * velocityAlongNormal
          ) / totalInverseMass;
          this.velocityCorrection
            .copy(this.difference)
            .multiplyScalar(impulseMagnitude);
          this.velocity.addScaledVector(this.velocityCorrection, -inverseMass);
          this.otherVelocity.addScaledVector(this.velocityCorrection, otherInverseMass);
          this.velocity.clampLength(0, config.maxVelocity);
          this.otherVelocity.clampLength(0, config.maxVelocity);
        }

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
  departureProgress = 0;
  gatherProgress = 0;
  private gatherStartPositions: Float32Array | null = null;

  constructor(renderer: WebGLRenderer, config: BallpitConfig) {
    const environment = new RoomEnvironment();
    const environmentGenerator = new PMREMGenerator(renderer);
    const environmentTexture = environmentGenerator.fromScene(environment).texture;
    const geometry = new SphereGeometry(1, 16, 12);
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
    const gather = MathUtils.smoothstep(this.gatherProgress, 0.03, 0.82);
    const aperture = MathUtils.smoothstep(this.gatherProgress, 0.82, 1);

    for (let index = 0; index < this.count; index += 1) {
      this.transformObject.position.fromArray(this.physics.positionData, index * 3);
      if (this.config.initialLayout === "right" && gather === 0) {
        const fullX = this.transformObject.position.x;
        const fullY = this.transformObject.position.y;
        const layoutX = Math.sin((index + 1) * 12.9898);
        const layoutY = Math.cos((index + 1) * 9.173);
        this.transformObject.position.x = fullX * 1.1
          + layoutX * this.config.maxX * 0.17
          + this.config.maxX * 0.34;
        this.transformObject.position.y = fullY * 0.98 + layoutY * this.config.maxY * 0.1;
      }
      if (gather > 0 && this.gatherStartPositions) {
        const startOffset = index * 3;
        const startX = this.gatherStartPositions[startOffset];
        const startY = this.gatherStartPositions[startOffset + 1];
        const startRadius = Math.hypot(startX, startY);
        const startAngle = Math.atan2(startY, startX);
        const layer = (index % 7) / 6;
        const arm = index % 3;
        const lane = Math.floor(index / 3);
        const coherentAngle = arm * (Math.PI * 2 / 3) + lane * 0.22;
        const wrappedAngle = Math.atan2(
          Math.sin(coherentAngle - startAngle),
          Math.cos(coherentAngle - startAngle),
        );
        const trackCoherence = Math.sin(gather * Math.PI) * 0.72;
        const spiralAngle = startAngle
          + gather * Math.PI * (4.2 + layer * 2.2)
          + wrappedAngle * trackCoherence;
        const clusterRadius = 0.52 + layer * 1.72;
        const trackSeparation = Math.sin(gather * Math.PI) * (1.2 + layer * 2.4);
        const currentRadius = MathUtils.lerp(startRadius, clusterRadius, gather) + trackSeparation;
        const spiralX = Math.cos(spiralAngle) * currentRadius;
        const spiralY = Math.sin(spiralAngle) * currentRadius;
        const spiralZ = ((index % 9) - 4) * 0.2;
        const settle = MathUtils.smoothstep(gather, 0.68, 1);
        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
        const sphereT = (index + 0.5) / this.count;
        const sphereY = 1 - sphereT * 2;
        const sphereRing = Math.sqrt(Math.max(0, 1 - sphereY * sphereY));
        const sphereAngle = index * goldenAngle;
        const sphereRadius = 2.15;
        const targetX = MathUtils.lerp(spiralX, Math.cos(sphereAngle) * sphereRing * sphereRadius, settle);
        const targetY = MathUtils.lerp(spiralY, sphereY * sphereRadius, settle);
        const targetZ = MathUtils.lerp(spiralZ, Math.sin(sphereAngle) * sphereRing * sphereRadius * 0.72, settle);
        this.transformObject.position.set(
          targetX,
          targetY,
          MathUtils.lerp(this.gatherStartPositions[startOffset + 2], targetZ, gather),
        );
        const openingLength = Math.max(0.28, Math.hypot(targetX, targetY));
        this.transformObject.position.x += (targetX / openingLength) * aperture * (this.config.maxX * 1.32 + 2);
        this.transformObject.position.y += (targetY / openingLength) * aperture * (this.config.maxY * 1.18 + 1.5);
      }
      const ballPhase = ((index * 37) % 17) / 16;
      const departureLane = MathUtils.smoothstep(this.departureProgress, 0.04 + ballPhase * 0.09, 0.7 + ballPhase * 0.08);
      const departureExit = MathUtils.smoothstep(this.departureProgress, 0.64 + ballPhase * 0.08, 0.98);
      const liveX = this.physics.positionData[index * 3];
      const liveVelocityX = this.physics.velocityData[index * 3];
      const splitSignal = liveX + liveVelocityX * 18 + Math.sin(index * 1.71) * 0.34;
      const side = Math.abs(splitSignal) > 0.08
        ? Math.sign(splitSignal)
        : index % 2 === 0 ? 1 : -1;
      const relativeSpeed = 0.78 + ballPhase * 0.48;
      this.transformObject.position.x += side * (
        departureLane * this.config.maxX * (0.47 + relativeSpeed * 0.18)
        + departureExit * (this.config.maxX * (1.24 + relativeSpeed * 0.24) + this.physics.sizeData[index] * 2.1)
      );
      this.transformObject.position.y += Math.sin(index * 1.73 + ballPhase) * (departureLane * 0.48 + departureExit * 0.72);
      const gatherScale = 1 - aperture;
      this.transformObject.scale.setScalar(gatherScale * (
        index === 0 && this.config.followCursor && !this.config.showCursorBall
          ? 0
          : this.physics.sizeData[index]
      ));
      this.transformObject.updateMatrix();
      this.setMatrixAt(index, this.transformObject.matrix);
      if (index === 0) this.pointLight.position.copy(this.transformObject.position);
    }

    this.instanceMatrix.needsUpdate = true;
  }

  setGatherProgress(progress: number) {
    const next = Math.min(1, Math.max(0, progress));
    if (next > 0 && this.gatherProgress === 0) {
      this.gatherStartPositions = this.physics.positionData.slice();
    } else if (next === 0) {
      this.gatherStartPositions = null;
    }
    this.gatherProgress = next;
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
  private canvasBounds = { left: 0, top: 0, right: 1, bottom: 1, width: 1, height: 1 };

  private animationFrame = 0;
  private resizeFrame = 0;
  private lastRenderedAt = 0;
  private lastInteractionAt = performance.now();
  private isIntersecting = true;
  private isAnimating = false;
  private disposed = false;
  private readonly debugPerformance = typeof window !== "undefined"
    && new URLSearchParams(window.location.search).has("perf");
  private performanceSampleStart = 0;
  private performanceLastFrame = 0;
  private performanceFrameCount = 0;
  private performanceWorkTotal = 0;
  private performanceWorstGap = 0;

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

    const bounds = this.canvasBounds;
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
      this.lastInteractionAt = performance.now();
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
    const bounds = this.canvas.getBoundingClientRect();
    this.canvasBounds = {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: Math.max(1, bounds.width),
      height: Math.max(1, bounds.height),
    };

    this.camera.aspect = width / height;
    this.camera.fov = 50;
    this.camera.updateProjectionMatrix();

    const fovRadians = MathUtils.degToRad(this.camera.fov);
    const worldHeight = 2 * Math.tan(fovRadians / 2) * this.camera.position.length();
    const worldWidth = worldHeight * this.camera.aspect;
    this.spheres.config.maxX = worldWidth / 2;
    this.spheres.config.maxY = worldHeight / 2;

    const pixelBudgetRatio = Math.sqrt(MAX_RENDER_PIXELS / Math.max(1, width * height));
    this.renderer.setPixelRatio(Math.max(0.8, Math.min(window.devicePixelRatio || 1, 1, pixelBudgetRatio)));
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, this.camera);
  }

  private start() {
    if (this.isAnimating || this.disposed) return;

    this.isAnimating = true;
    this.timer.reset();
    this.lastRenderedAt = 0;
    const animate = (time: number) => {
      if (!this.isAnimating || this.disposed) return;
      this.animationFrame = window.requestAnimationFrame(animate);
      const targetFrameInterval = time - this.lastInteractionAt < ACTIVE_AFTER_INTERACTION_MS
        ? ACTIVE_FRAME_INTERVAL
        : IDLE_FRAME_INTERVAL;
      if (this.lastRenderedAt && time - this.lastRenderedAt < targetFrameInterval - 0.75) {
        return;
      }
      this.lastRenderedAt = time;
      const frameStartedAt = performance.now();
      if (this.debugPerformance) {
        if (!this.performanceSampleStart) {
          this.performanceSampleStart = frameStartedAt;
          this.performanceLastFrame = frameStartedAt;
        }
        this.performanceWorstGap = Math.max(
          this.performanceWorstGap,
          frameStartedAt - this.performanceLastFrame,
        );
        this.performanceLastFrame = frameStartedAt;
      }
      this.timer.update();
      this.spheres.update(Math.min(this.timer.getDelta(), 0.034));
      this.renderer.render(this.scene, this.camera);
      if (this.debugPerformance) {
        this.performanceFrameCount += 1;
        this.performanceWorkTotal += performance.now() - frameStartedAt;
        if (frameStartedAt - this.performanceSampleStart >= 3_000) {
          const duration = frameStartedAt - this.performanceSampleStart;
          console.info(
            `[Ballpit perf] fps=${(this.performanceFrameCount * 1000 / duration).toFixed(1)} `
            + `work=${(this.performanceWorkTotal / this.performanceFrameCount).toFixed(2)}ms `
            + `worstGap=${this.performanceWorstGap.toFixed(1)}ms count=${this.spheres.count}`,
          );
          this.performanceSampleStart = frameStartedAt;
          this.performanceFrameCount = 0;
          this.performanceWorkTotal = 0;
          this.performanceWorstGap = 0;
        }
      }
    };
    this.animationFrame = window.requestAnimationFrame(animate);
  }

  private stop() {
    if (!this.isAnimating) return;
    window.cancelAnimationFrame(this.animationFrame);
    this.isAnimating = false;
    this.lastRenderedAt = 0;
  }

  setDepartureProgress(progress: number) {
    const next = Math.min(1, Math.max(0, progress));
    const previous = this.spheres.departureProgress;
    if (Math.abs(next - previous) < 0.0005) return;
    this.lastInteractionAt = performance.now();
    this.spheres.departureProgress = next;
    this.canvas.style.visibility = next >= 0.985 ? "hidden" : "visible";
    if (next >= 0.985) {
      if (previous < 0.985) {
        this.spheres.update(0);
        this.renderer.render(this.scene, this.camera);
      }
      this.stop();
    }
    else if (this.isIntersecting && !document.hidden) this.start();
  }

  setGatherProgress(progress: number) {
    this.spheres.setGatherProgress(progress);
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
  driftSpeed = DEFAULT_CONFIG.driftSpeed,
  collectiveCenterX = DEFAULT_CONFIG.collectiveCenterX,
  collectiveCenterY = DEFAULT_CONFIG.collectiveCenterY,
  collectiveHalfWidth = DEFAULT_CONFIG.collectiveHalfWidth,
  collectiveHalfHeight = DEFAULT_CONFIG.collectiveHalfHeight,
  collectiveStrength = DEFAULT_CONFIG.collectiveStrength,
  thermalMotion = DEFAULT_CONFIG.thermalMotion,
  followCursor = DEFAULT_CONFIG.followCursor,
  showCursorBall = DEFAULT_CONFIG.showCursorBall,
  departureProgress = 0,
  initialLayout = DEFAULT_CONFIG.initialLayout,
  controllerRef,
  onReady,
}: BallpitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BallpitScene | null>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

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
          driftSpeed,
          collectiveCenterX,
          collectiveCenterY,
          collectiveHalfWidth,
          collectiveHalfHeight,
          collectiveStrength,
          thermalMotion,
          controlSphere0: false,
          followCursor,
          showCursorBall,
          initialLayout,
        });
        ballpitScene.setDepartureProgress(departureProgress);
        sceneRef.current = ballpitScene;
        if (controllerRef) {
          controllerRef.current = {
            setDepartureProgress: (progress) => sceneRef.current?.setDepartureProgress(progress),
            setGatherProgress: (progress) => sceneRef.current?.setGatherProgress(progress),
          };
        }
        onReadyRef.current?.();
      } catch (error) {
        canvas.style.display = "none";
        console.info("Ballpit is using its static cover fallback.", error);
      }
    };

    const handleMotionPreference = () => {
      if (reducedMotion.matches) {
        ballpitScene?.dispose();
        ballpitScene = null;
        sceneRef.current = null;
        if (controllerRef) controllerRef.current = null;
      } else {
        createScene();
      }
    };

    createScene();
    reducedMotion.addEventListener("change", handleMotionPreference);

    return () => {
      reducedMotion.removeEventListener("change", handleMotionPreference);
      ballpitScene?.dispose();
      sceneRef.current = null;
      if (controllerRef) controllerRef.current = null;
    };
  }, [
    ambientColor,
    ambientIntensity,
    colors,
    count,
    driftSpeed,
    collectiveCenterX,
    collectiveCenterY,
    collectiveHalfWidth,
    collectiveHalfHeight,
    collectiveStrength,
    thermalMotion,
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
    initialLayout,
    wallBounce,
    controllerRef,
  ]);

  useEffect(() => {
    sceneRef.current?.setDepartureProgress(departureProgress);
  }, [departureProgress]);

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
