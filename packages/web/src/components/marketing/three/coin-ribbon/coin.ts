import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import type { CoinAssetSpec } from './assets';

export const COIN_RADIUS = 0.74;
export const COIN_THICKNESS = 0.2;

export interface CoinRig {
  spec: CoinAssetSpec;
  root: THREE.Group;
  wheel: THREE.Group;
  reflectionRoot: THREE.Group;
  reflectionWheel: THREE.Group;
  shadowMesh: THREE.Mesh;
  dispose: () => void;
}

const svgLoader = new SVGLoader();

function createCoinBodyGeometry(): {
  fieldGeo: THREE.BufferGeometry;
  rimGeo: THREE.BufferGeometry;
} {
  const R = COIN_RADIUS;
  const h = COIN_THICKNESS * 0.5;
  const innerR = R * 0.84;
  const recess = h * 0.62;

  const fieldGeo = new THREE.CylinderGeometry(
    innerR + 0.01,
    innerR + 0.01,
    recess * 2,
    64,
  );
  fieldGeo.rotateX(Math.PI * 0.5);

  const pts: THREE.Vector2[] = [
    new THREE.Vector2(innerR, -recess),
    new THREE.Vector2(innerR + 0.018, -h),
    new THREE.Vector2(R - 0.038, -h),
    new THREE.Vector2(R - 0.01, -h + 0.02),
    new THREE.Vector2(R, -h + 0.048),
    new THREE.Vector2(R, h - 0.048),
    new THREE.Vector2(R - 0.01, h - 0.02),
    new THREE.Vector2(R - 0.038, h),
    new THREE.Vector2(innerR + 0.018, h),
    new THREE.Vector2(innerR, recess),
  ];

  const rimGeo = new THREE.LatheGeometry(pts, 72);
  rimGeo.rotateX(Math.PI * 0.5);
  rimGeo.computeVertexNormals();

  return { fieldGeo, rimGeo };
}

function createEmblemGeometry(spec: CoinAssetSpec): THREE.BufferGeometry[] {
  const parsed = svgLoader.parse(spec.emblemSvg);
  const geometries: THREE.BufferGeometry[] = [];
  const halfVB = spec.viewBoxSize * 0.5;
  const targetDiameter = COIN_RADIUS * 1.42 * spec.emblemScale;
  const scale = targetDiameter / spec.viewBoxSize;
  const extrudeDepth = 0.044;

  for (const path of parsed.paths) {
    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      const extrude = new THREE.ExtrudeGeometry(shape, {
        depth: extrudeDepth / scale,
        bevelEnabled: true,
        bevelThickness: 0.012 / scale,
        bevelSize: 0.009 / scale,
        bevelSegments: 3,
        curveSegments: 20,
      });

      extrude.translate(-halfVB, -halfVB, 0);
      extrude.scale(scale, scale, scale);
      extrude.rotateX(Math.PI);
      extrude.translate(0, 0, extrudeDepth);
      extrude.computeVertexNormals();
      geometries.push(extrude);
    }
  }

  return geometries;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.04,
      size / 2,
      size / 2,
      size * 0.48,
    );
    grad.addColorStop(0, 'rgba(18, 22, 14, 0.52)');
    grad.addColorStop(0.42, 'rgba(20, 26, 16, 0.22)');
    grad.addColorStop(1, 'rgba(20, 26, 16, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

let sharedShadowTex: THREE.CanvasTexture | null = null;

export function createCoinRig(spec: CoinAssetSpec): CoinRig {
  const { fieldGeo, rimGeo } = createCoinBodyGeometry();
  const emblemGeos = createEmblemGeometry(spec);

  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.bodyColor),
    metalness: spec.metalness,
    roughness: spec.bodyRoughness,
    clearcoat: 0.5,
    clearcoatRoughness: 0.14,
    envMapIntensity: 1.45,
  });

  const accentMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.accentColor),
    metalness: Math.min(0.98, spec.metalness + 0.04),
    roughness: spec.accentRoughness,
    clearcoat: 0.72,
    clearcoatRoughness: 0.09,
    envMapIntensity: 1.65,
  });

  const reflBodyMat = bodyMat.clone();
  reflBodyMat.side = THREE.DoubleSide;
  const reflAccentMat = accentMat.clone();
  reflAccentMat.side = THREE.DoubleSide;

  const buildWheel = (
    bMat: THREE.Material,
    aMat: THREE.Material,
  ): THREE.Group => {
    const wheel = new THREE.Group();
    wheel.add(new THREE.Mesh(fieldGeo, bMat));
    wheel.add(new THREE.Mesh(rimGeo, aMat));

    const recessZ = COIN_THICKNESS * 0.5 * 0.62;
    const frontGroup = new THREE.Group();
    frontGroup.position.z = recessZ - 0.002;
    const backGroup = new THREE.Group();
    backGroup.position.z = -(recessZ - 0.002);
    backGroup.rotation.y = Math.PI;

    for (const geo of emblemGeos) {
      frontGroup.add(new THREE.Mesh(geo, aMat));
      backGroup.add(new THREE.Mesh(geo, aMat));
    }

    wheel.add(frontGroup, backGroup);
    return wheel;
  };

  const root = new THREE.Group();
  const wheel = buildWheel(bodyMat, accentMat);
  root.add(wheel);

  const reflectionRoot = new THREE.Group();
  const reflectionWheel = buildWheel(reflBodyMat, reflAccentMat);
  reflectionRoot.add(reflectionWheel);

  if (!sharedShadowTex) {
    sharedShadowTex = createContactShadowTexture();
  }
  const shadowGeo = new THREE.PlaneGeometry(
    COIN_RADIUS * 0.72,
    COIN_THICKNESS * 2.1,
  );
  const shadowMat = new THREE.MeshBasicMaterial({
    map: sharedShadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.7,
    side: THREE.FrontSide,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);

  return {
    spec,
    root,
    wheel,
    reflectionRoot,
    reflectionWheel,
    shadowMesh,
    dispose: () => {
      fieldGeo.dispose();
      rimGeo.dispose();
      for (const g of emblemGeos) g.dispose();
      bodyMat.dispose();
      accentMat.dispose();
      reflBodyMat.dispose();
      reflAccentMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
    },
  };
}
