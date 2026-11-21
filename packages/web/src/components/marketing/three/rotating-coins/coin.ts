import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import type { EvmChainCoinSpec } from './chains';

export const COIN_RADIUS = 1.02;
export const COIN_THICKNESS = 0.27;

export interface SculptedCoin {
  spec: EvmChainCoinSpec;
  group: THREE.Group;
  dispose: () => void;
}

interface EmblemPiece {
  geometry: THREE.BufferGeometry;
  isAccent: boolean;
}

const svgLoader = new SVGLoader();

function createSculptedCoinBody(): {
  rimGeo: THREE.BufferGeometry;
  diskGeo: THREE.BufferGeometry;
} {
  const R = COIN_RADIUS;
  const h = COIN_THICKNESS * 0.5;
  const bowlDepth = 0.054;
  const innerR = R * 0.785;
  const lipInnerR = R * 0.86;

  const diskGeo = new THREE.CylinderGeometry(
    innerR + 0.015,
    innerR + 0.015,
    bowlDepth * 2,
    84,
  );
  diskGeo.rotateX(Math.PI * 0.5);

  const pts: THREE.Vector2[] = [
    new THREE.Vector2(innerR, -bowlDepth),
    new THREE.Vector2(innerR + 0.03, -bowlDepth - 0.014),
    new THREE.Vector2(lipInnerR - 0.015, -h + 0.016),
    new THREE.Vector2(lipInnerR + 0.012, -h),
    new THREE.Vector2(R - 0.032, -h),
    new THREE.Vector2(R - 0.008, -h + 0.014),
    new THREE.Vector2(R, -h + 0.034),
    new THREE.Vector2(R, h - 0.034),
    new THREE.Vector2(R - 0.008, h - 0.014),
    new THREE.Vector2(R - 0.032, h),
    new THREE.Vector2(lipInnerR + 0.012, h),
    new THREE.Vector2(lipInnerR - 0.015, h - 0.016),
    new THREE.Vector2(innerR + 0.03, bowlDepth + 0.014),
    new THREE.Vector2(innerR, bowlDepth),
  ];

  const rimGeo = new THREE.LatheGeometry(pts, 84);
  rimGeo.rotateX(Math.PI * 0.5);
  rimGeo.computeVertexNormals();

  return { rimGeo, diskGeo };
}

function createChainEmblemPieces(spec: EvmChainCoinSpec): EmblemPiece[] {
  const parsed = svgLoader.parse(spec.emblemSvg);
  const pieces: EmblemPiece[] = [];
  const halfVB = spec.viewBoxSize * 0.5;
  const targetDiameter = COIN_RADIUS * 1.36 * spec.emblemScale;
  const scale = targetDiameter / spec.viewBoxSize;
  const extrudeDepth = 0.068;

  for (const path of parsed.paths) {
    const fillHex = path.color.getHex();
    const isAccent =
      spec.emblemAccentColor !== undefined &&
      fillHex === spec.emblemAccentColor;

    const shapes = SVGLoader.createShapes(path);
    for (const shape of shapes) {
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: extrudeDepth / scale,
        bevelEnabled: true,
        bevelThickness: 0.014 / scale,
        bevelSize: 0.01 / scale,
        bevelSegments: 3,
        curveSegments: 24,
      });

      geo.translate(-halfVB, -halfVB, 0);
      geo.scale(scale, scale, scale);
      geo.rotateX(Math.PI);
      geo.translate(0, 0, extrudeDepth);
      geo.computeVertexNormals();
      pieces.push({ geometry: geo, isAccent });
    }
  }

  return pieces;
}

const GOLD_RIM_COLOR = new THREE.Color(0xfbe5a4);

export function createSculptedCoin(spec: EvmChainCoinSpec): SculptedCoin {
  const { rimGeo, diskGeo } = createSculptedCoinBody();
  const emblemPieces = createChainEmblemPieces(spec);

  const rimMat = new THREE.MeshPhysicalMaterial({
    color: GOLD_RIM_COLOR.clone(),
    metalness: 0.98,
    roughness: 0.09,
    clearcoat: 0.4,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.5,
  });

  const diskMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.diskColor),
    metalness: 0.1,
    roughness: 0.24,
    clearcoat: 0.9,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.95,
  });

  const emblemMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(spec.emblemColor),
    metalness: 0.08,
    roughness: 0.2,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
    envMapIntensity: 0.95,
  });

  const accentMat =
    spec.emblemAccentColor !== undefined
      ? new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(spec.emblemAccentColor),
          metalness: 0.12,
          roughness: 0.2,
          clearcoat: 0.85,
          clearcoatRoughness: 0.08,
          envMapIntensity: 0.95,
        })
      : emblemMat;

  const group = new THREE.Group();
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  rimMesh.castShadow = true;
  rimMesh.receiveShadow = true;

  const diskMesh = new THREE.Mesh(diskGeo, diskMat);
  diskMesh.receiveShadow = true;

  group.add(rimMesh, diskMesh);

  const diskFloorZ = 0.052;
  const frontEmblem = new THREE.Group();
  frontEmblem.position.z = diskFloorZ;

  const backEmblem = new THREE.Group();
  backEmblem.position.z = -diskFloorZ;
  backEmblem.rotation.y = Math.PI;

  for (const piece of emblemPieces) {
    const mat = piece.isAccent ? accentMat : emblemMat;

    const fMesh = new THREE.Mesh(piece.geometry, mat);
    fMesh.castShadow = true;
    fMesh.receiveShadow = true;
    frontEmblem.add(fMesh);

    const bMesh = new THREE.Mesh(piece.geometry, mat);
    bMesh.castShadow = true;
    bMesh.receiveShadow = true;
    backEmblem.add(bMesh);
  }

  group.add(frontEmblem, backEmblem);

  return {
    spec,
    group,
    dispose: () => {
      rimGeo.dispose();
      diskGeo.dispose();
      for (const p of emblemPieces) p.geometry.dispose();
      rimMat.dispose();
      diskMat.dispose();
      emblemMat.dispose();
      if (accentMat !== emblemMat) accentMat.dispose();
    },
  };
}
