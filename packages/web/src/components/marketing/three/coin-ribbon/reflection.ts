import * as THREE from 'three';

export class RibbonReflectionPass {
  private rawRT: THREE.WebGLRenderTarget;
  private blurH: THREE.WebGLRenderTarget;
  private blurV: THREE.WebGLRenderTarget;

  private readonly quadScene: THREE.Scene;
  private readonly quadCamera: THREE.OrthographicCamera;
  private readonly blurUniforms: {
    tInput: { value: THREE.Texture | null };
    uDirection: { value: THREE.Vector2 };
    uTexelSize: { value: THREE.Vector2 };
  };
  private readonly blurMat: THREE.ShaderMaterial;
  private readonly quadMesh: THREE.Mesh;

  private width = 256;
  private height = 256;

  constructor(width: number, height: number) {
    this.width = Math.max(64, Math.floor(width * 0.5));
    this.height = Math.max(64, Math.floor(height * 0.5));

    const opts: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
    };

    this.rawRT = new THREE.WebGLRenderTarget(this.width, this.height, opts);
    this.blurH = new THREE.WebGLRenderTarget(this.width, this.height, {
      ...opts,
      depthBuffer: false,
    });
    this.blurV = new THREE.WebGLRenderTarget(this.width, this.height, {
      ...opts,
      depthBuffer: false,
    });

    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.blurUniforms = {
      tInput: { value: null },
      uDirection: { value: new THREE.Vector2(1, 0) },
      uTexelSize: { value: new THREE.Vector2(1 / this.width, 1 / this.height) },
    };

    this.blurMat = new THREE.ShaderMaterial({
      transparent: false,
      depthTest: false,
      depthWrite: false,
      uniforms: this.blurUniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tInput;
        uniform vec2 uDirection;
        uniform vec2 uTexelSize;
        varying vec2 vUv;

        void main() {
          vec2 stepUv = uDirection * uTexelSize * 1.45;
          vec4 acc = texture2D(tInput, vUv) * 0.227027;
          acc += texture2D(tInput, vUv + stepUv * 1.0) * 0.1945946;
          acc += texture2D(tInput, vUv - stepUv * 1.0) * 0.1945946;
          acc += texture2D(tInput, vUv + stepUv * 2.0) * 0.1216216;
          acc += texture2D(tInput, vUv - stepUv * 2.0) * 0.1216216;
          acc += texture2D(tInput, vUv + stepUv * 3.0) * 0.054054;
          acc += texture2D(tInput, vUv - stepUv * 3.0) * 0.054054;
          acc += texture2D(tInput, vUv + stepUv * 4.0) * 0.016216;
          acc += texture2D(tInput, vUv - stepUv * 4.0) * 0.016216;
          gl_FragColor = acc;
        }
      `,
    });

    this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.quadScene.add(this.quadMesh);
  }

  get texture(): THREE.Texture {
    return this.blurV.texture;
  }

  setSize(width: number, height: number): void {
    const nextW = Math.max(64, Math.floor(width * 0.5));
    const nextH = Math.max(64, Math.floor(height * 0.5));
    if (nextW === this.width && nextH === this.height) return;
    this.width = nextW;
    this.height = nextH;
    this.rawRT.setSize(this.width, this.height);
    this.blurH.setSize(this.width, this.height);
    this.blurV.setSize(this.width, this.height);
    this.blurUniforms.uTexelSize.value.set(1 / this.width, 1 / this.height);
  }

  render(
    renderer: THREE.WebGLRenderer,
    reflectionScene: THREE.Scene,
    camera: THREE.Camera,
  ): void {
    const prevTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    const prevClearColor = renderer.getClearColor(new THREE.Color());

    renderer.setClearColor(0x000000, 0);

    renderer.setRenderTarget(this.rawRT);
    renderer.clear(true, true, false);
    renderer.render(reflectionScene, camera);

    this.blurUniforms.tInput.value = this.rawRT.texture;
    this.blurUniforms.uDirection.value.set(1, 0);
    renderer.setRenderTarget(this.blurH);
    renderer.clear(true, false, false);
    renderer.render(this.quadScene, this.quadCamera);

    this.blurUniforms.tInput.value = this.blurH.texture;
    this.blurUniforms.uDirection.value.set(0, 1);
    renderer.setRenderTarget(this.blurV);
    renderer.clear(true, false, false);
    renderer.render(this.quadScene, this.quadCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  dispose(): void {
    this.rawRT.dispose();
    this.blurH.dispose();
    this.blurV.dispose();
    this.blurMat.dispose();
    this.quadMesh.geometry.dispose();
  }
}
