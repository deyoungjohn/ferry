import * as THREE from 'three';

/**
 * High-contrast studio PMREM environment tuned for Ferry's lime-infused hero:
 * luminous ivory/lime overhead softboxes, a crisp dark slate-olive horizon band
 * for liquid-chrome contrast on the sweeping ribbon, and soft chartreuse bounce.
 */
export function createStudioEnvironment(
  renderer: THREE.WebGLRenderer,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x23291c);

  const domeGeo = new THREE.SphereGeometry(32, 48, 32);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uZenith: { value: new THREE.Color(0xdcf578) },
      uUpperBright: { value: new THREE.Color(0xfefdf7) },
      uHorizonDark: { value: new THREE.Color(0x232a1b) },
      uLowerWarm: { value: new THREE.Color(0xf4f7e8) },
      uNadir: { value: new THREE.Color(0xcde29c) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith;
      uniform vec3 uUpperBright;
      uniform vec3 uHorizonDark;
      uniform vec3 uLowerWarm;
      uniform vec3 uNadir;
      varying vec3 vDir;

      void main() {
        float y = vDir.y;
        float bandCenter = 0.14 - 0.12 * vDir.x;
        float distFromBand = abs(y - bandCenter);
        float darkMask = 1.0 - smoothstep(0.08, 0.34, distFromBand);

        vec3 sky = y >= 0.0
          ? mix(uUpperBright * 1.32, uZenith * 1.12, smoothstep(0.16, 0.9, y))
          : mix(uLowerWarm * 1.08, uNadir * 0.96, smoothstep(0.0, 0.85, -y));

        vec3 col = mix(sky, uHorizonDark, darkMask * 0.86);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const disposables: Array<{ dispose: () => void }> = [domeGeo, domeMat];
  const addPanel = (
    w: number,
    h: number,
    color: number,
    intensity: number,
    pos: [number, number, number],
    rotZ = 0,
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    if (rotZ !== 0) mesh.rotateZ(rotZ);
    envScene.add(mesh);
    disposables.push(geo, mat);
  };

  addPanel(28, 8.5, 0xffffff, 3.6, [-1, 16, 2]);
  addPanel(16, 10, 0xe2fa88, 2.5, [14, 12, 8]);
  addPanel(5.5, 18, 0xfcfdf6, 3.0, [-11, 7, 13], 0.35);
  addPanel(5.0, 15, 0xffffff, 3.2, [11, 5, 13], -0.25);
  addPanel(26, 16, 0xd8ec9c, 1.35, [0, -14, 5]);

  addPanel(24, 5.8, 0x161b12, 1.0, [-15, 2.8, 1.5]);
  addPanel(14, 12, 0x151a11, 1.0, [-2, -2.5, 16]);
  addPanel(20, 5.5, 0x141810, 1.0, [0, 4.5, -15]);
  addPanel(14, 5.0, 0x192014, 1.0, [15, -2.5, -4]);

  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  for (const d of disposables) d.dispose();

  return rt.texture;
}
