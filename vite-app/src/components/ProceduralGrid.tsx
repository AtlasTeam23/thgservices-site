import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const COLORS = [
  { bg: '#060608', accent: '#2563EB' },
  { bg: '#0a0a0c', accent: '#1E40AF' },
  { bg: '#0c0c10', accent: '#3B82F6' },
  { bg: '#08080a', accent: '#60A5FA' },
  { bg: '#0a0a0e', accent: '#93C5FD' },
  { bg: '#060608', accent: '#F59E0B' },
  { bg: '#08080a', accent: '#2563EB' },
  { bg: '#0c0c0e', accent: '#1D4ED8' },
];

const MESH_TYPES = ['sphere', 'torus', 'cone', 'cylinder', 'box'];

function getGeometry(type: string) {
  switch (type) {
    case 'sphere': return new THREE.SphereGeometry(0.7, 64, 64);
    case 'torus': return new THREE.TorusGeometry(0.6, 0.25, 32, 64);
    case 'cone': return new THREE.ConeGeometry(0.6, 1.2, 32);
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32);
    case 'box': default: return new THREE.BoxGeometry(1, 1, 1);
  }
}

function animateCell(
  blackMesh: THREE.Mesh,
  accentMesh: THREE.Mesh,
  wireframe: THREE.Mesh,
  time: number,
  animType: number
) {
  switch (animType) {
    case 0:
      blackMesh.rotation.x = time * 0.3;
      blackMesh.rotation.y = time * 0.5;
      accentMesh.rotation.copy(blackMesh.rotation);
      wireframe.rotation.z = time * 0.1;
      break;
    case 1: {
      const s = 1 + Math.sin(time * 2) * 0.1;
      blackMesh.scale.set(s, s, s);
      accentMesh.scale.set(s * 0.98, s * 0.98, s * 0.98);
      blackMesh.rotation.y = time * 0.2;
      accentMesh.rotation.copy(blackMesh.rotation);
      wireframe.rotation.z = time * 0.3;
      break;
    }
    case 2:
      blackMesh.position.y = Math.abs(Math.sin(time * 2)) * 0.5;
      accentMesh.position.y = blackMesh.position.y;
      blackMesh.rotation.x = time * 0.5;
      blackMesh.rotation.y = time * 0.3;
      accentMesh.rotation.copy(blackMesh.rotation);
      wireframe.rotation.z = time * 0.2;
      break;
    case 3:
      blackMesh.rotation.y = time * 0.8;
      blackMesh.rotation.x = time * 0.4;
      accentMesh.rotation.copy(blackMesh.rotation);
      wireframe.rotation.z = time * 0.5;
      break;
    case 4:
      blackMesh.position.y = Math.sin(time) * 0.3;
      blackMesh.position.x = Math.cos(time) * 0.3;
      accentMesh.position.copy(blackMesh.position);
      blackMesh.rotation.x = time * 0.5;
      blackMesh.rotation.y = time * 0.3;
      accentMesh.rotation.copy(blackMesh.rotation);
      wireframe.rotation.z = time * 0.4;
      break;
  }
}

const gridVertexShader = `
varying vec2 vUv;
uniform float uTime;

void main() {
  vUv = uv;
  vec3 pos = position;
  float dist = length(position.xy);
  pos.z += sin(dist * 5.0 + uTime) * 0.03;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const gridFragmentShader = `
varying vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uShadowMap;
uniform float uTime;
uniform float uHover;

vec3 blendNormal(vec3 base, vec3 blend) {
  return blend;
}

vec3 blendNormal(vec3 base, vec3 blend, float opacity) {
  return (blendNormal(base, blend) * opacity + base * (1.0 - opacity));
}

void main() {
  vec4 texel = texture2D(uTexture, vUv);
  vec4 shadowTexel = texture2D(uShadowMap, vUv);
  vec3 shadowColor = vec3(0.0, 0.0, 0.0);
  float shadowOpacity = 0.4;
  vec3 blendedShadow = blendNormal(texel.rgb, shadowColor, shadowOpacity);
  vec3 finalColor = mix(texel.rgb, blendedShadow, shadowTexel.r);
  gl_FragColor = vec4(finalColor, texel.a);
  gl_FragColor.rgb += uHover * 0.15;
  float grain = fract(sin(dot(vUv, vec2(12.9898, 78.233) * 2.0)) * 43758.5453);
  gl_FragColor.rgb += grain * 0.05;
}
`;

interface CellData {
  mesh: THREE.Mesh;
  basePosition: THREE.Vector3;
  material: THREE.ShaderMaterial;
  proceduralScene: THREE.Scene;
  proceduralCamera: THREE.OrthographicCamera;
  renderTarget: THREE.WebGLRenderTarget;
  blackMesh: THREE.Mesh;
  accentMesh: THREE.Mesh;
  wireframe: THREE.Mesh;
  animType: number;
  colorIndex: number;
}

export default function ProceduralGrid() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    cells: CellData[];
    clock: THREE.Clock;
    raycaster: THREE.Raycaster;
    mouseNDC: THREE.Vector2;
    normalizedMouse: { x: number; y: number };
    targetMouse: { x: number; y: number };
    animId: number;
    cameraStartZ: number;
    entranceProgress: number;
    containerOpacity: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvasWidth = container.offsetWidth || window.innerWidth;
    const canvasHeight = container.offsetHeight || window.innerHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(canvasWidth, canvasHeight);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    container.appendChild(renderer.domElement);

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, canvasWidth / canvasHeight, 0.1, 100);
    camera.position.set(0, 0, 15);
    camera.lookAt(0, 0, 0);

    // Grid
    const gap = 0.04;
    const scale = 0.35;
    const cells: CellData[] = [];

    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const x = (j - 2) * (scale + gap);
        const y = (2 - i) * (scale + gap);
        const colorIndex = (i * 5 + j) % 8;
        const meshType = MESH_TYPES[(i * 5 + j) % MESH_TYPES.length];
        const animType = i % 5;

        // Procedural scene
        const procScene = new THREE.Scene();
        procScene.background = new THREE.Color(COLORS[colorIndex].bg);

        // Lights
        const dirLight = new THREE.DirectionalLight('#ffffff', 2.5);
        dirLight.position.set(2, 4, 2);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 512;
        dirLight.shadow.mapSize.height = 512;
        dirLight.shadow.camera.near = 0.1;
        dirLight.shadow.camera.far = 15;
        const sc = 3.5;
        dirLight.shadow.camera.left = -sc;
        dirLight.shadow.camera.right = sc;
        dirLight.shadow.camera.top = sc;
        dirLight.shadow.camera.bottom = -sc;
        dirLight.shadow.bias = -0.001;
        procScene.add(dirLight);

        const ambLight = new THREE.AmbientLight('#ffffff', 1.5);
        procScene.add(ambLight);

        // Ground
        const groundGeo = new THREE.PlaneGeometry(20, 20);
        groundGeo.rotateX(-Math.PI / 2);
        const groundMat = new THREE.MeshStandardMaterial({
          color: '#ffffff',
          roughness: 0.8,
          metalness: 0.1,
        });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.receiveShadow = true;
        procScene.add(ground);

        // Black mesh
        const geo = getGeometry(meshType);
        const blackMat = new THREE.MeshStandardMaterial({
          color: '#000000',
          roughness: 0.4,
          metalness: 0.5,
        });
        const blackMesh = new THREE.Mesh(geo, blackMat);
        blackMesh.castShadow = true;
        blackMesh.receiveShadow = true;
        procScene.add(blackMesh);

        // Accent mesh
        const accentMat = new THREE.MeshStandardMaterial({
          color: COLORS[colorIndex].accent,
          roughness: 0.3,
          metalness: 0.6,
        });
        const accentMesh = new THREE.Mesh(geo.clone(), accentMat);
        accentMesh.scale.set(0.98, 0.98, 0.98);
        accentMesh.castShadow = true;
        accentMesh.receiveShadow = true;
        procScene.add(accentMesh);

        // Wireframe ring
        const wireGeo = new THREE.TorusGeometry(1.2, 0.02, 16, 100);
        const wireMat = new THREE.MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0.3,
          wireframe: true,
        });
        const wireframe = new THREE.Mesh(wireGeo, wireMat);
        wireframe.castShadow = false;
        wireframe.receiveShadow = false;
        procScene.add(wireframe);

        // Shadow camera
        const frustumSize = 3.5;
        const aspect = 1;
        const shadowCamera = new THREE.OrthographicCamera(
          frustumSize * aspect / -2,
          frustumSize * aspect / 2,
          frustumSize / 2,
          frustumSize / -2,
          0.1,
          15
        );
        shadowCamera.position.set(0, 5, 0);
        shadowCamera.lookAt(0, 0, 0);

        // Render target
        const renderTarget = new THREE.WebGLRenderTarget(256, 256, {
          type: THREE.HalfFloatType,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
        });

        // Grid mesh
        const planeGeo = new THREE.PlaneGeometry(scale, scale, 50, 50);
        const gridMat = new THREE.ShaderMaterial({
          vertexShader: gridVertexShader,
          fragmentShader: gridFragmentShader,
          transparent: true,
          uniforms: {
            uTexture: { value: null },
            uShadowMap: { value: null },
            uTime: { value: 0 },
            uHover: { value: 0 },
          },
        });

        const mesh = new THREE.Mesh(planeGeo, gridMat);
        mesh.position.set(x, y, 0);
        scene.add(mesh);

        cells.push({
          mesh,
          basePosition: new THREE.Vector3(x, y, 0),
          material: gridMat,
          proceduralScene: procScene,
          proceduralCamera: shadowCamera,
          renderTarget,
          blackMesh,
          accentMesh,
          wireframe,
          animType,
          colorIndex,
        });
      }
    }

    const clock = new THREE.Clock();
    const raycaster = new THREE.Raycaster();
    const mouseNDC = new THREE.Vector2();
    const normalizedMouse = { x: 0, y: 0 };
    const targetMouse = { x: 0, y: 0 };

    const state = {
      renderer,
      scene,
      camera,
      cells,
      clock,
      raycaster,
      mouseNDC,
      normalizedMouse,
      targetMouse,
      animId: 0,
      cameraStartZ: 15,
      entranceProgress: 0,
      containerOpacity: 0,
    };
    stateRef.current = state;

    // Mouse handler
    const onMouseMove = (e: MouseEvent) => {
      targetMouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      targetMouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', onMouseMove);

    // Entrance animation
    const entranceStart = performance.now();
    const entranceDuration = 1200;

    // Animation loop
    const animate = () => {
      state.animId = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();

      // Entrance
      const elapsed = performance.now() - entranceStart;
      const t = Math.min(elapsed / entranceDuration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      camera.position.z = 15 - eased * 8;
      container.style.opacity = String(eased);

      // Mouse interpolation
      normalizedMouse.x += (targetMouse.x - normalizedMouse.x) * 0.05;
      normalizedMouse.y += (targetMouse.y - normalizedMouse.y) * 0.05;

      // Camera parallax
      const parallaxX = normalizedMouse.x * 0.5;
      const parallaxY = normalizedMouse.y * 0.5;
      camera.position.x += (parallaxX - camera.position.x) * 0.05;
      camera.position.y += (parallaxY - camera.position.y) * 0.05;
      camera.lookAt(0, 0, 0);

      // Update each cell
      for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx];

        // Animate procedural scene
        animateCell(cell.blackMesh, cell.accentMesh, cell.wireframe, time, cell.animType);

        // Render procedural scene to render target
        renderer.setRenderTarget(cell.renderTarget);
        renderer.render(cell.proceduralScene, cell.proceduralCamera);
        renderer.setRenderTarget(null);

        // Update uniforms
        cell.material.uniforms.uTexture.value = cell.renderTarget.texture;
        cell.material.uniforms.uTime.value = time;

        // Cell parallax drift
        const distFromCenter = Math.sqrt(
          cell.basePosition.x ** 2 + cell.basePosition.y ** 2
        );
        const driftAmount = 0.01 + distFromCenter * 0.01;
        const driftX = Math.sin(time * 0.5 + cell.basePosition.y) * driftAmount;
        const driftY = Math.cos(time * 0.5 + cell.basePosition.x) * driftAmount;

        cell.mesh.position.x = cell.basePosition.x + driftX + normalizedMouse.x * 0.1;
        cell.mesh.position.y = cell.basePosition.y + driftY + normalizedMouse.y * 0.1;
        cell.mesh.position.z = cell.basePosition.z;
      }

      // Raycasting for hover
      mouseNDC.set(normalizedMouse.x, normalizedMouse.y);
      raycaster.setFromCamera(mouseNDC, camera);
      const intersects = raycaster.intersectObjects(cells.map(c => c.mesh));

      for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx];
        const isHovered = intersects.length > 0 && intersects[0].object === cell.mesh;
        cell.material.uniforms.uHover.value += (isHovered ? 1 : 0 - cell.material.uniforms.uHover.value) * 0.1;
        const targetScale = isHovered ? 0.95 : 1;
        cell.mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.1);
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize
    const onResize = () => {
      const w = container.offsetWidth;
      const h = container.offsetHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(state.animId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
      cells.forEach(cell => {
        cell.mesh.geometry.dispose();
        cell.material.dispose();
        cell.renderTarget.dispose();
        cell.proceduralScene.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) {
              child.material.forEach(m => m.dispose());
            } else {
              child.material.dispose();
            }
          }
        });
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 0,
        width: '100%',
        height: '100%',
        opacity: 0,
      }}
    />
  );
}