import * as THREE from 'three';
import { FERRY_EVM_CHAINS } from './chains';
import { createSculptedCoin, type SculptedCoin } from './coin';
import { createGoldStudioEnvironment } from './environment';

export interface RotatingCoinsController {
  dispose: () => void;
}

const RING_RADIUS = 1.54;
const LOOP_DURATION_SECONDS = 7.0;

export function createRotatingCoinsScene(
  container: HTMLElement,
): RotatingCoinsController {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const studioEnv = createGoldStudioEnvironment(renderer);
  scene.environment = studioEnv;

  const camera = new THREE.PerspectiveCamera(26, 2, 0.1, 100);
  camera.position.set(0, 0.04, 11.4);
  camera.lookAt(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xf6f8f4, 0x182014, 0.52);
  scene.add(hemi);

  const topKey = new THREE.DirectionalLight(0xfffaf0, 2.25);
  topKey.position.set(-4.5, 8.5, 8.0);
  topKey.castShadow = true;
  topKey.shadow.mapSize.set(1024, 1024);
  topKey.shadow.camera.near = 2;
  topKey.shadow.camera.far = 24;
  topKey.shadow.camera.left = -4.5;
  topKey.shadow.camera.right = 4.5;
  topKey.shadow.camera.top = 3.5;
  topKey.shadow.camera.bottom = -3.5;
  topKey.shadow.bias = -0.0005;
  topKey.shadow.radius = 4;
  scene.add(topKey);

  const rightRim = new THREE.DirectionalLight(0xb8f29e, 1.15);
  rightRim.position.set(8.5, 4.5, 5.5);
  scene.add(rightRim);

  const lowerFill = new THREE.DirectionalLight(0xfff0d4, 1.1);
  lowerFill.position.set(0.5, -8.5, 6.5);
  scene.add(lowerFill);

  const ringGroup = new THREE.Group();
  scene.add(ringGroup);

  const coins: SculptedCoin[] = FERRY_EVM_CHAINS.map((spec, index) => {
    const coin = createSculptedCoin(spec);
    const angle = (index / FERRY_EVM_CHAINS.length) * Math.PI * 2;
    coin.group.position.set(
      Math.sin(angle) * RING_RADIUS,
      0,
      Math.cos(angle) * RING_RADIUS,
    );
    coin.group.rotation.y = angle + Math.PI * 0.5;
    ringGroup.add(coin.group);
    return coin;
  });

  const handleResize = () => {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    const aspect = w / h;
    camera.aspect = aspect;
    // Frame the full 6-coin horizontal ring comfortably inside wide bento cards and narrow mobile cards
    camera.fov = aspect < 1.55 ? 25 / Math.max(0.58, aspect / 1.55) : 25;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  };

  const resizeObserver = new ResizeObserver(handleResize);
  resizeObserver.observe(container);
  handleResize();

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let simTime = 0.58;
  let lastPerf = performance.now();
  let rafId = 0;
  let visible = true;
  let disposed = false;

  const renderFrame = () => {
    ringGroup.rotation.y = -(simTime / LOOP_DURATION_SECONDS) * Math.PI * 2;
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
      for (const coin of coins) coin.dispose();
      studioEnv.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
