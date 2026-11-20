import * as THREE from 'three';

export function createGoldStudioEnvironment(
  renderer: THREE.WebGLRenderer,
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0c0e0b);

  const domeGeo = new THREE.SphereGeometry(32, 48, 32);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uTopBright: { value: new THREE.Color(0xfff7e2) },
      uNeutralMid: { value: new THREE.Color(0xd8d2c2) },
      uDarkBand: { value: new THREE.Color(0x111310) },
      uBottomWarm: { value: new THREE.Color(0xf2e2bc) },
      uFerryLime: { value: new THREE.Color(0x7ed957) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTopBright;
      uniform vec3 uNeutralMid;
      uniform vec3 uDarkBand;
      uniform vec3 uBottomWarm;
      uniform vec3 uFerryLime;
      varying vec3 vDir;

      void main() {
        float y = vDir.y;
        float darkBand = 1.0 - smoothstep(0.04, 0.21, abs(y));
        vec3 base = y >= 0.0
          ? mix(uNeutralMid, uTopBright * 1.25, smoothstep(0.14, 0.85, y))
          : mix(uNeutralMid * 0.9, uBottomWarm * 1.15, smoothstep(0.14, 0.85, -y));
        float rightMask = smoothstep(0.2, 0.95, vDir.x);
        base = mix(base, uFerryLime * 0.85, rightMask * 0.14);
        vec3 col = mix(base, uDarkBand, darkBand * 0.88);
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
  ) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(...pos);
    mesh.lookAt(0, 0, 0);
    envScene.add(mesh);
    disposables.push(geo, mat);
  };

  addPanel(24, 7.5, 0xfff8e6, 3.5, [0, 16, 4]);
  addPanel(22, 7.0, 0xfff1cf, 2.9, [0, -15, 6]);
  addPanel(3.6, 16, 0xfff9ec, 2.3, [-16, 6, 7]);
  addPanel(3.6, 16, 0xe8ffd8, 2.0, [16, 6, 7]);
  addPanel(9, 9, 0x7ed957, 1.4, [15, 8, -11]);

  addPanel(28, 3.6, 0x090b08, 1.0, [0, 0.0, 16]);
  addPanel(28, 4.0, 0x090b08, 1.0, [0, 0.0, -16]);
  addPanel(16, 3.8, 0x0b0d0a, 1.0, [-16, 0.0, 0]);
  addPanel(16, 3.8, 0x0b0d0a, 1.0, [16, 0.0, 0]);

  const rt = pmrem.fromScene(envScene, 0.02);
  pmrem.dispose();
  for (const d of disposables) d.dispose();

  return rt.texture;
}
