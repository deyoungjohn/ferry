import * as THREE from 'three';
import { COIN_ASSETS } from './assets';
import { COIN_RADIUS, createCoinRig, type CoinRig } from './coin';
import { createStudioEnvironment } from './environment';
import { RibbonReflectionPass } from './reflection';
import { createRibbonMesh, RibbonPath } from './ribbon';

export interface CoinRibbonController {
  dispose: () => void;
}

const DEFAULT_CAM_POS = new THREE.Vector3(-6.3, 0.25, 10.6);
const DEFAULT_CAM_TARGET = new THREE.Vector3(-0.1, -0.05, 0.0);
const LOOP_DURATION_SECONDS = 4.6;

export function createCoinRibbonScene(
  container: HTMLElement,
): CoinRibbonController {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const reflectionScene = new THREE.Scene();

  const studioEnv = createStudioEnvironment(renderer);
  scene.environment = studioEnv;
  reflectionScene.environment = studioEnv;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.copy(DEFAULT_CAM_POS);
  camera.lookAt(DEFAULT_CAM_TARGET);

  const addLights = (targetScene: THREE.Scene) => {
    const hemi = new THREE.HemisphereLight(0xeef8cc, 0xd9e8a8, 0.36);
    targetScene.add(hemi);

    const key = new THREE.DirectionalLight(0xffffff, 2.35);
    key.position.set(6, 12, 9);
    targetScene.add(key);

    const rim = new THREE.DirectionalLight(0xd8f48c, 1.45);
    rim.position.set(-9, 6, -5);
    targetScene.add(rim);

    const bounce = new THREE.DirectionalLight(0xe6f2b8, 0.72);
    bounce.position.set(2, -8, 6);
    targetScene.add(bounce);
  };
  addLights(scene);
  addLights(reflectionScene);

  const ribbonPath = new RibbonPath();
  const ribbon = createRibbonMesh(ribbonPath);
  scene.add(ribbon.group);

  const coinRigs: CoinRig[] = COIN_ASSETS.map((spec) => {
    const rig = createCoinRig(spec);
    scene.add(rig.root);
    scene.add(rig.shadowMesh);
    reflectionScene.add(rig.reflectionRoot);
    return rig;
  });

  const reflectionPass = new RibbonReflectionPass(
    container.clientWidth || 800,
    container.clientHeight || 800,
  );
  ribbon.uniforms.uReflectionTex.value = reflectionPass.texture;

  const basisMat = new THREE.Matrix4();
  const reflBasisMat = new THREE.Matrix4();
  const shadowBasisMat = new THREE.Matrix4();
  const contactPos = new THREE.Vector3();

  const gravityWarpedArcFraction = (phase: number): number => {
    const p = ((phase % 1) + 1) % 1;
    return p + 0.018 * Math.sin(p * Math.PI * 2 - 0.6);
  };

  const updateCoinsAtTime = (tSeconds: number) => {
    const loopPhase = (((tSeconds / LOOP_DURATION_SECONDS) % 1) + 1) % 1;

    for (const rig of coinRigs) {
      const rawPhase = (loopPhase + rig.spec.phaseOffset) % 1;
      const sFrac = gravityWarpedArcFraction(rawPhase);
      const u = ribbonPath.uAtArcFraction(sFrac);
      const sample = ribbonPath.sampleAtU(u, rig.spec.laneOffset);
      const arcLen = ribbonPath.arcLengthAtU(u);
      const rollAngle = -(arcLen / COIN_RADIUS) + rig.spec.initialSpin;

      contactPos.copy(sample.point);
      rig.root.position
        .copy(contactPos)
        .addScaledVector(sample.normal, COIN_RADIUS);
      basisMat.makeBasis(sample.tangent, sample.normal, sample.binormal);
      rig.root.quaternion.setFromRotationMatrix(basisMat);
      rig.wheel.rotation.z = rollAngle;

      rig.reflectionRoot.position
        .copy(contactPos)
        .addScaledVector(sample.normal, -COIN_RADIUS * 0.94);
      reflBasisMat.makeBasis(sample.tangent, sample.normal, sample.binormal);
      rig.reflectionRoot.quaternion.setFromRotationMatrix(reflBasisMat);
      rig.reflectionRoot.scale.set(1, -1, 1);
      rig.reflectionWheel.rotation.z = rollAngle;

      rig.shadowMesh.position
        .copy(contactPos)
        .addScaledVector(sample.normal, 0.012);
      shadowBasisMat.makeBasis(sample.tangent, sample.binormal, sample.normal);
      rig.shadowMesh.quaternion.setFromRotationMatrix(shadowBasisMat);
    }
  };

  const handleResize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const dpr = renderer.getPixelRatio();
    camera.aspect = w / h;
    camera.fov = w < h ? 35 : 30;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    ribbon.uniforms.uResolution.value.set(w * dpr, h * dpr);
    reflectionPass.setSize(w * dpr, h * dpr);
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);
  handleResize();

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let simTime = 1.65;
  let lastPerf = performance.now();
  let rafId = 0;
  let visible = true;
  let disposed = false;

  const renderFrame = () => {
    updateCoinsAtTime(simTime);
    reflectionPass.render(renderer, reflectionScene, camera);
    renderer.render(scene, camera);
  };

  const tick = (now: number) => {
    if (disposed) return;
    if (visible && !prefersReducedMotion) {
      const dt = Math.min(0.05, (now - lastPerf) * 0.001);
      simTime += dt;
      renderFrame();
    }
    lastPerf = now;
    if (!prefersReducedMotion) {
      rafId = requestAnimationFrame(tick);
    }
  };

  const intersectionObserver =
    typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver(
          (entries) => {
            visible = entries.some((e) => e.isIntersecting);
            lastPerf = performance.now();
          },
          { threshold: 0.01 },
        )
      : null;
  intersectionObserver?.observe(container);

  renderFrame();
  if (!prefersReducedMotion) {
    rafId = requestAnimationFrame(tick);
  }

  return {
    dispose() {
      disposed = true;
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      ribbon.dispose();
      reflectionPass.dispose();
      for (const rig of coinRigs) rig.dispose();
      studioEnv.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
