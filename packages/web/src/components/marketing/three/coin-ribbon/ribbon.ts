import * as THREE from 'three';

export interface RibbonSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  normal: THREE.Vector3;
  binormal: THREE.Vector3;
  u: number;
}

export class RibbonPath {
  readonly xStart = 8.4;
  readonly xEnd = -8.4;
  readonly width = 3.25;
  readonly thickness = 0.03;
  readonly samplesCount = 420;

  private readonly arcLengths: Float32Array;
  readonly totalLength: number;

  constructor() {
    this.arcLengths = new Float32Array(this.samplesCount + 1);
    let accum = 0;
    let prev = this.evalCenterline(0);
    this.arcLengths[0] = 0;

    for (let i = 1; i <= this.samplesCount; i++) {
      const u = i / this.samplesCount;
      const curr = this.evalCenterline(u);
      accum += curr.distanceTo(prev);
      this.arcLengths[i] = accum;
      prev = curr;
    }
    this.totalLength = accum;
  }

  evalY(x: number): number {
    const k = 0.86;
    const xCrest = 3.9;
    const phase = k * (x - xCrest);
    const amp = 1.38 + 0.24 * Math.tanh((x + 1.2) * 0.35);
    const tilt = 0.14 * x - 0.12;
    return amp * Math.cos(phase) + tilt;
  }

  evalCenterline(u: number): THREE.Vector3 {
    const x = THREE.MathUtils.lerp(this.xStart, this.xEnd, u);
    const y = this.evalY(x);
    const z = 0.45 * Math.sin(x * 0.28 - 0.3);
    return new THREE.Vector3(x, y, z);
  }

  sampleAtU(u: number, laneOffset = 0): RibbonSample {
    const eps = 1e-4;
    const u0 = Math.max(0, u - eps);
    const u1 = Math.min(1, u + eps);
    const p = this.evalCenterline(u);
    const p0 = this.evalCenterline(u0);
    const p1 = this.evalCenterline(u1);

    const tangent = p1.sub(p0).normalize();
    const worldZ = new THREE.Vector3(0, 0, 1);
    const normal = new THREE.Vector3()
      .crossVectors(worldZ, tangent)
      .normalize();
    if (normal.y < 0) normal.negate();
    const binormal = new THREE.Vector3()
      .crossVectors(tangent, normal)
      .normalize();

    const lateral = laneOffset * (this.width * 0.44);
    const point = p
      .clone()
      .addScaledVector(binormal, lateral)
      .addScaledVector(normal, this.thickness * 0.5);

    return { point, tangent, normal, binormal, u };
  }

  uAtArcFraction(sFrac: number): number {
    const target = THREE.MathUtils.clamp(sFrac, 0, 1) * this.totalLength;
    let lo = 0;
    let hi = this.samplesCount;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.arcLengths[mid] ?? 0) < target) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const i = Math.max(1, lo);
    const s0 = this.arcLengths[i - 1] ?? 0;
    const s1 = this.arcLengths[i] ?? s0;
    const alpha = s1 > s0 ? (target - s0) / (s1 - s0) : 0;
    return (i - 1 + alpha) / this.samplesCount;
  }

  arcLengthAtU(u: number): number {
    const f = THREE.MathUtils.clamp(u, 0, 1) * this.samplesCount;
    const i = Math.min(this.samplesCount - 1, Math.floor(f));
    const alpha = f - i;
    return THREE.MathUtils.lerp(
      this.arcLengths[i] ?? 0,
      this.arcLengths[i + 1] ?? 0,
      alpha,
    );
  }
}

export interface RibbonMeshResult {
  group: THREE.Group;
  uniforms: {
    uReflectionTex: { value: THREE.Texture | null };
    uResolution: { value: THREE.Vector2 };
    uReflectionStrength: { value: number };
  };
  dispose: () => void;
}

export function createRibbonMesh(path: RibbonPath): RibbonMeshResult {
  const segU = 220;
  const segV = 10;
  const halfW = path.width * 0.5;
  const halfT = path.thickness * 0.5;

  const topGeo = buildRibbonFaceGeometry(path, segU, segV, halfW, halfT, true);
  const bottomGeo = buildRibbonFaceGeometry(
    path,
    segU,
    segV,
    halfW,
    -halfT,
    false,
  );
  const sideGeo = buildRibbonSideEdgesGeometry(path, segU, halfW, halfT);

  const uniforms = {
    uReflectionTex: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uReflectionStrength: { value: 0.72 },
  };

  // Brushed mirror-chrome top surface with real-time blurred coin reflection overlay
  const topMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xd2dbd0),
    metalness: 0.98,
    roughness: 0.1,
    clearcoat: 0.45,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.55,
    side: THREE.FrontSide,
  });

  topMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uReflectionTex = uniforms.uReflectionTex;
    shader.uniforms.uResolution = uniforms.uResolution;
    shader.uniforms.uReflectionStrength = uniforms.uReflectionStrength;

    shader.fragmentShader =
      /* glsl */ `
      uniform sampler2D uReflectionTex;
      uniform vec2 uResolution;
      uniform float uReflectionStrength;
    ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      /* glsl */ `
      vec2 reflUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
      vec4 reflSample = texture2D(uReflectionTex, reflUv);
      float reflAlpha = clamp(reflSample.a * uReflectionStrength, 0.0, 0.85);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, reflSample.rgb * 0.92 + gl_FragColor.rgb * 0.16, reflAlpha);
      #include <dithering_fragment>
      `,
    );
  };

  // Satin metallic Ferry lime-chartreuse underside harmonizing with the brand backdrop
  const bottomMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0xb4d95c),
    metalness: 0.42,
    roughness: 0.32,
    clearcoat: 0.25,
    clearcoatRoughness: 0.3,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xdcf87a),
    sheenRoughness: 0.4,
    envMapIntensity: 0.95,
    side: THREE.FrontSide,
  });

  const sideMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x232b1c),
    metalness: 0.96,
    roughness: 0.14,
    envMapIntensity: 1.4,
  });

  const group = new THREE.Group();
  const topMesh = new THREE.Mesh(topGeo, topMaterial);
  const bottomMesh = new THREE.Mesh(bottomGeo, bottomMaterial);
  const sideMesh = new THREE.Mesh(sideGeo, sideMaterial);
  group.add(topMesh, bottomMesh, sideMesh);

  return {
    group,
    uniforms,
    dispose: () => {
      topGeo.dispose();
      bottomGeo.dispose();
      sideGeo.dispose();
      topMaterial.dispose();
      bottomMaterial.dispose();
      sideMaterial.dispose();
    },
  };
}

function buildRibbonFaceGeometry(
  path: RibbonPath,
  segU: number,
  segV: number,
  halfW: number,
  normalOffset: number,
  isTop: boolean,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let iu = 0; iu <= segU; iu++) {
    const u = iu / segU;
    const sample = path.sampleAtU(u, 0);
    const center = path.evalCenterline(u);
    const faceNormal = isTop ? sample.normal : sample.normal.clone().negate();

    for (let iv = 0; iv <= segV; iv++) {
      const vFrac = iv / segV;
      const vPos = (vFrac * 2 - 1) * halfW;

      positions.push(
        center.x + sample.binormal.x * vPos + sample.normal.x * normalOffset,
        center.y + sample.binormal.y * vPos + sample.normal.y * normalOffset,
        center.z + sample.binormal.z * vPos + sample.normal.z * normalOffset,
      );
      normals.push(faceNormal.x, faceNormal.y, faceNormal.z);
      uvs.push(u, vFrac);
    }
  }

  const stride = segV + 1;
  for (let iu = 0; iu < segU; iu++) {
    for (let iv = 0; iv < segV; iv++) {
      const a = iu * stride + iv;
      const b = (iu + 1) * stride + iv;
      const c = (iu + 1) * stride + (iv + 1);
      const d = iu * stride + (iv + 1);

      if (isTop) {
        indices.push(a, d, b, b, d, c);
      } else {
        indices.push(a, b, d, b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildRibbonSideEdgesGeometry(
  path: RibbonPath,
  segU: number,
  halfW: number,
  halfT: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  const addEdge = (sideSign: 1 | -1) => {
    const baseVertex = positions.length / 3;
    for (let iu = 0; iu <= segU; iu++) {
      const u = iu / segU;
      const sample = path.sampleAtU(u, 0);
      const center = path.evalCenterline(u);
      const edgeNormal = sample.binormal.clone().multiplyScalar(sideSign);

      for (const tSign of [1, -1]) {
        positions.push(
          center.x +
            sample.binormal.x * (halfW * sideSign) +
            sample.normal.x * (halfT * tSign),
          center.y +
            sample.binormal.y * (halfW * sideSign) +
            sample.normal.y * (halfT * tSign),
          center.z +
            sample.binormal.z * (halfW * sideSign) +
            sample.normal.z * (halfT * tSign),
        );
        normals.push(edgeNormal.x, edgeNormal.y, edgeNormal.z);
      }
    }

    for (let iu = 0; iu < segU; iu++) {
      const a = baseVertex + iu * 2;
      const b = baseVertex + iu * 2 + 1;
      const c = baseVertex + (iu + 1) * 2 + 1;
      const d = baseVertex + (iu + 1) * 2;
      if (sideSign === 1) {
        indices.push(a, b, d, b, c, d);
      } else {
        indices.push(a, d, b, b, d, c);
      }
    }
  };

  addEdge(1);
  addEdge(-1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}
