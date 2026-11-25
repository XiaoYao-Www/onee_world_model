import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { WmEdge, WmNode } from '../../data/types';
import { kindStyle } from '../../lib/palette';
import { fnv1a } from '../../lib/tokens';
import {
  classifyEdge,
  EDGE_CLASS_BY_KEY,
  nodeSizeForDegree,
  relationColor,
  type EdgeClass,
  type KindShape,
} from './legend';
import { buildLayout, refineChunk, TOTAL_LAYOUT_ITERATIONS, type LayoutState } from './layout';

/**
 * 3D 知識宇宙場景（原生 three.js，不使用 react-three-fiber）。
 *
 * 設計重點：
 * - 節點依 kind 分組成 InstancedMesh，節點數 1000+ 也只有少量 draw call。
 * - 邊依語義分類（事實／證據／來源引用／推論／衍生）各自批次成 LineSegments；
 *   方向以箭頭表示，證據與引用用虛線，衍生關係用完全不同的淡紫灰長虛線。
 * - 佈局一次性計算（分批迭代），不會每幀重算；只有互動或相機移動時才重繪。
 * - 選取時用自訂 instanced attribute 只淡化非鄰居節點的不透明度，不是刪除。
 */

export interface SceneCallbacks {
  onHover: (id: string | null, clientX: number, clientY: number) => void;
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  onLayoutProgress: (done: number, total: number) => void;
  onLayoutEnd: () => void;
  onFatal: (message: string) => void;
}

export interface SceneOptions {
  reducedMotion: boolean;
  lowPerf: boolean;
  showLabels: boolean;
}

export interface SceneDataOptions {
  showEdges: boolean;
  forceLayout?: boolean;
}

interface NodeLayer {
  kind: string;
  mesh: THREE.InstancedMesh;
  ids: string[];
  indexOf: Map<string, number>;
  alphas: Float32Array;
  alphaAttr: THREE.InstancedBufferAttribute;
  color: string;
}

interface NodeMeta {
  id: string;
  kind: string;
  title: string;
  color: string;
  degree: number;
  size: number;
  rx: number;
  ry: number;
  rz: number;
}

interface EdgeBatch {
  key: string;
  object: THREE.LineSegments;
  edges: WmEdge[];
  pairs: Int32Array;
  base: Float32Array;
  positions: Float32Array;
  colors: Float32Array;
  vertsPerEdge: number;
  dashed: boolean;
  derived: boolean;
}

const TAU = Math.PI * 2;

/** 世界單位 → 像素的換算（供 Points 的 gl_PointSize 使用）。 */
function viewportPixelScale(pixelHeight: number, fovDeg: number): number {
  return pixelHeight / (2 * Math.tan((fovDeg * Math.PI) / 360));
}

function hash01(key: string, salt = ''): number {
  return (fnv1a(`${salt}|${key}`) % 100000) / 100000;
}

function shapeScale(shape: KindShape): [number, number, number] {
  switch (shape) {
    case 'diamond':
      return [0.8, 1.3, 0.8];
    case 'disc':
      return [1, 0.42, 1];
    case 'panel':
      return [1, 1, 1];
    default:
      return [1, 1, 1];
  }
}

function shapeGeometry(shape: KindShape, lowPerf: boolean): THREE.BufferGeometry {
  const seg = lowPerf ? 9 : 18;
  switch (shape) {
    case 'cube':
      return new THREE.BoxGeometry(1.4, 1.4, 1.4);
    case 'icosa':
      return new THREE.IcosahedronGeometry(1.22, lowPerf ? 0 : 1);
    case 'octa':
      return new THREE.OctahedronGeometry(1.32, 0);
    case 'torus':
      return new THREE.TorusGeometry(0.92, 0.34, lowPerf ? 7 : 13, lowPerf ? 16 : 34);
    case 'tetra':
      return new THREE.TetrahedronGeometry(1.5, 0);
    case 'dodeca':
      return new THREE.DodecahedronGeometry(1.22, 0);
    case 'diamond':
      return new THREE.OctahedronGeometry(1.18, 0);
    case 'disc':
      return new THREE.CylinderGeometry(1.12, 1.12, 0.24, lowPerf ? 12 : 26);
    case 'panel':
      return new THREE.BoxGeometry(1.3, 1.3, 0.16);
    case 'ring':
      return new THREE.TorusGeometry(1.0, 0.15, lowPerf ? 6 : 10, lowPerf ? 22 : 44);
    case 'wire':
      return new THREE.IcosahedronGeometry(1.24, 0);
    case 'sphere':
    default:
      return new THREE.SphereGeometry(1, seg, lowPerf ? 8 : 14);
  }
}

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function nodeMaterial(color: string, wireframe: boolean): THREE.MeshStandardMaterial {
  const base = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({
    color: base,
    roughness: 0.58,
    metalness: 0.2,
    emissive: base.clone().multiplyScalar(0.55),
    emissiveIntensity: 0.95,
    wireframe,
    transparent: true,
    opacity: 0.97,
    depthWrite: !wireframe,
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = `attribute float aAlpha;\nvarying float vAAlpha;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vAAlpha = aAlpha;',
    );
    shader.fragmentShader = `varying float vAAlpha;\n${shader.fragmentShader}`.replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\n  gl_FragColor.a *= vAAlpha;',
    );
  };
  return mat;
}

function makeStarField(count: number, radius: number, glow: THREE.Texture): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let seed = 0x9e3779b9;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < count; i += 1) {
    const u = rand() * 2 - 1;
    const theta = rand() * TAU;
    const r = radius * (0.55 + rand() * 0.9);
    const s = Math.sqrt(Math.max(0, 1 - u * u));
    positions[i * 3] = Math.cos(theta) * s * r;
    positions[i * 3 + 1] = u * r * 0.8;
    positions[i * 3 + 2] = Math.sin(theta) * s * r;
    const warm = rand();
    const c = new THREE.Color().setHSL(0.58 + warm * 0.1, 0.35, 0.55 + rand() * 0.3);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.2,
    map: glow,
    vertexColors: true,
    transparent: true,
    opacity: 0.72,
    sizeAttenuation: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  return points;
}

export class UniverseScene {
  private container: HTMLDivElement;
  private labelHost: HTMLDivElement;
  private callbacks: SceneCallbacks;
  private options: SceneOptions;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private root = new THREE.Group();
  private nodeRoot = new THREE.Group();
  private edgeRoot = new THREE.Group();
  private derivedRoot = new THREE.Group();
  private starField: THREE.Points | null = null;
  private nebula: THREE.Sprite | null = null;
  private glow: THREE.Texture;

  private nodeLayers = new Map<string, NodeLayer>();
  private nodeInfos = new Map<string, NodeMeta>();
  private glowPoints: THREE.Points | null = null;
  private glowAlpha: Float32Array | null = null;
  private glowAlphaAttr: THREE.BufferAttribute | null = null;
  private glowMat: THREE.ShaderMaterial | null = null;
  private nodeOrder: string[] = [];
  private batches: EdgeBatch[] = [];
  private derivedBatch: EdgeBatch | null = null;

  private selectedHalo: THREE.Sprite;
  private hoverHalo: THREE.Sprite;

  private layout: LayoutState | null = null;
  private layoutKey = '';
  private layoutTimer: number | undefined;
  private layoutGeneration = 0;

  private selectedId: string | null = null;
  private neighbours: Set<string> = new Set();
  private hoverId: string | null = null;

  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(-10, -10);
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pickables: THREE.InstancedMesh[] = [];

  private needsRender = true;
  private raf = 0;
  private disposed = false;
  private lastPickAt = 0;
  private lastLabelAt = 0;
  private hoverDirty = false;
  private pointerInside = false;
  private pointerDown: { x: number; y: number; at: number } | null = null;
  private dragging = false;
  private userNavigated = false;
  private autoRotate = false;
  private cameraTween: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private labelEls = new Map<string, HTMLDivElement>();
  private labelIds: string[] = [];
  private starRadius = 800;
  private initialCamera = new THREE.Vector3(0, 0, 1);
  private lowPerf: boolean;

  constructor(
    container: HTMLDivElement,
    labelHost: HTMLDivElement,
    callbacks: SceneCallbacks,
    options: SceneOptions,
  ) {
    this.container = container;
    this.labelHost = labelHost;
    this.callbacks = callbacks;
    this.options = { ...options };
    this.lowPerf = options.lowPerf;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !options.lowPerf, alpha: false, powerPreference: 'high-performance' });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'WebGL 初始化失敗');
    }
    this.renderer = renderer;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.lowPerf ? 1.5 : 2));
    this.renderer.setClearColor(0x04060d, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    const el = this.renderer.domElement;
    el.className = 'univ-canvas';
    el.setAttribute('aria-label', '3D 知識宇宙；可拖曳旋轉、滾輪縮放、點擊節點選取');
    el.style.display = 'block';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.touchAction = 'none';
    container.appendChild(el);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x04060d, 0.00085);
    this.scene.add(this.root);
    this.root.add(this.nodeRoot);
    this.root.add(this.edgeRoot);
    this.root.add(this.derivedRoot);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.8, 20000);
    this.camera.position.set(0, 180, 620);
    this.controls = new OrbitControls(this.camera, el);
    this.controls.enableDamping = !options.reducedMotion;
    this.controls.dampingFactor = 0.075;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.9;
    this.controls.panSpeed = 0.7;
    this.controls.minDistance = 18;
    this.controls.maxDistance = 4200;
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.32;
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });
    this.controls.addEventListener('start', () => {
      this.userNavigated = true;
    });

    this.glow = makeGlowTexture();

    // 環境光與主光：柔和、有深度，不走廉價霓虹路線
    this.scene.add(new THREE.AmbientLight(0x9fb2cf, 1.05));
    const key = new THREE.DirectionalLight(0xe6f0ff, 1.5);
    key.position.set(1, 1.5, 0.9);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x7c95ff, 0.55);
    fill.position.set(-1.2, -0.5, -0.8);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xa78bfa, 0.45, 0);
    rim.position.set(-1, 1, -2);
    this.scene.add(rim);

    this.selectedHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.selectedHalo.scale.setScalar(46);
    this.selectedHalo.visible = false;
    this.selectedHalo.renderOrder = 3;
    this.hoverHalo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glow,
        color: 0xffffff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.hoverHalo.scale.setScalar(30);
    this.hoverHalo.visible = false;
    this.hoverHalo.renderOrder = 3;
    this.root.add(this.selectedHalo, this.hoverHalo);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('pointercancel', this.onPointerLeave);
    el.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('keydown', this.onKeyDown);

    this.animate();
  }

  // ── 相機與尺寸 ────────────────────────────────────────────────

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.glowMat) {
      const u = this.glowMat.uniforms.uPixelScale as { value: number } | undefined;
      if (u) u.value = viewportPixelScale(h, this.camera.fov);
    }
    this.needsRender = true;
  }

  private frameRadius(): number {
    return Math.max(this.layout?.radius ?? 300, 220);
  }

  private applyDefaultView(instant = false) {
    const r = this.frameRadius();
    // 距離約 2.3 倍宇宙半徑：整個群集球都在視野內，節點仍保有好辨識的像素大小
    this.initialCamera.set(r * 0.3, r * 0.52, r * 2.16);
    this.controls.minDistance = Math.max(18, r * 0.06);
    this.controls.maxDistance = r * 6;
    if (instant) {
      this.camera.position.copy(this.initialCamera);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.cameraTween = null;
      this.needsRender = true;
    } else {
      this.cameraTween = { pos: this.initialCamera.clone(), target: new THREE.Vector3(0, 0, 0) };
      this.needsRender = true;
    }
  }

  resetView() {
    this.userNavigated = false;
    this.applyDefaultView();
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on && !this.options.reducedMotion;
    this.controls.autoRotate = this.autoRotate;
    this.needsRender = true;
  }

  setReducedMotion(value: boolean) {
    this.options.reducedMotion = value;
    this.controls.enableDamping = !value;
    if (value && this.autoRotate) {
      this.autoRotate = false;
      this.controls.autoRotate = false;
    }
    // Reduced Motion：關閉粒子星霧與自動環繞，但保留靜態星霧底層（霓虹感由材質控制）
    if (this.starField) this.starField.visible = !value;
    this.needsRender = true;
  }

  setShowLabels(value: boolean) {
    this.options.showLabels = value;
    this.refreshLabels();
    this.needsRender = true;
  }

  // ── 資料 ─────────────────────────────────────────────────────

  setData(nodes: WmNode[], edges: WmEdge[], opts: SceneDataOptions) {
    if (this.disposed) return;
    this.cancelLayout();

    for (const layer of this.nodeLayers.values()) {
      this.nodeRoot.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
    }
    this.nodeLayers.clear();
    this.nodeInfos.clear();
    this.nodeOrder = [];
    this.pickables = [];
    this.disposeGlow();

    for (const batch of this.batches) this.disposeBatch(batch);
    this.batches = [];
    this.disposeDerived();

    // 連結度（用可見的關係計算大小）
    const degree = new Map<string, number>();
    for (const edge of edges) {
      if (!edge?.source || !edge?.target) continue;
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }

    // 排序：固定順序 → 同一份資料永遠產生同樣的視覺
    const ordered = [...nodes].sort((a, b) => {
      const ka = kindStyle(a.kind);
      const kb = kindStyle(b.kind);
      if (ka.order !== kb.order) return ka.order - kb.order;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    this.nodeOrder = ordered.map((n) => n.id);

    const byKind = new Map<string, WmNode[]>();
    for (const node of ordered) {
      const arr = byKind.get(node.kind);
      if (arr) arr.push(node);
      else byKind.set(node.kind, [node]);
    }

    // 佈局：若節點集合不變就沿用既有座標（選取／篩選不跳動）
    const nextKey = this.nodeOrder.join('|');
    const reuse = !opts.forceLayout && nextKey === this.layoutKey && this.layout != null;
    if (!reuse) {
      this.layout = buildLayout(nodes, edges);
      this.layoutKey = nextKey;
    }
    const layout = this.layout;
    if (!layout) return;

    const positions = layout.pos;
    this.nodeOrder.forEach((id, i) => {
      const node = ordered[i];
      const st = kindStyle(node.kind);
      const deg = degree.get(id) ?? 0;
      this.nodeInfos.set(id, {
        id,
        kind: node.kind,
        title: node.title || id,
        color: st.color,
        degree: deg,
        size: nodeSizeForDegree(deg),
        rx: (hash01(id, 'rx') - 0.5) * 0.55,
        ry: hash01(id, 'ry') * TAU,
        rz: (hash01(id, 'rz') - 0.5) * 0.55,
      });
    });

    // 每個型別一個 InstancedMesh
    for (const [kind, members] of byKind) {
      const st = kindStyle(kind);
      const shape = st.shape;
      const geom = shapeGeometry(shape, this.lowPerf);
      const wire = shape === 'wire';
      const mat = nodeMaterial(st.color, wire);
      const count = members.length;
      const mesh = new THREE.InstancedMesh(geom, mat, count);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      const alphas = new Float32Array(count).fill(wire ? 0.9 : 1);
      const alphaAttr = new THREE.InstancedBufferAttribute(alphas, 1);
      alphaAttr.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('aAlpha', alphaAttr);
      const layer: NodeLayer = {
        kind,
        mesh,
        ids: members.map((m) => m.id),
        indexOf: new Map(),
        alphas,
        alphaAttr,
        color: st.color,
      };
      layer.ids.forEach((id, i) => layer.indexOf.set(id, i));
      mesh.userData.layer = layer;
      this.nodeLayers.set(kind, layer);
      this.nodeRoot.add(mesh);
      this.pickables.push(mesh);
    }

    this.buildGlow();

    if (opts.showEdges) this.buildEdgeBatches(edges);

    this.syncNodeMatrices();
    this.syncEdgePositions();

    if (this.autoRotate) this.controls.autoRotate = true;

    // 初次載入時把相機放回能看到全體的距離；使用者自己導覽過就不搶鏡頭。
    if (!this.userNavigated) this.applyDefaultView();

    this.ensureAtmosphere();
    this.applySelectionVisuals();
    this.refreshLabels();
    this.needsRender = true;

    if (!reuse || opts.forceLayout) {
      this.startLayoutRefine();
    } else {
      this.callbacks.onLayoutEnd();
    }
  }

  private startLayoutRefine() {
    const generation = ++this.layoutGeneration;
    const state = this.layout;
    if (!state) return;
    // 佈局很小時直接算完，避免多餘排程
    if (state.ids.length <= 120) {
      refineChunk(state, TOTAL_LAYOUT_ITERATIONS);
      this.syncNodeMatrices();
      this.syncEdgePositions();
      this.callbacks.onLayoutProgress(TOTAL_LAYOUT_ITERATIONS, TOTAL_LAYOUT_ITERATIONS);
      this.callbacks.onLayoutEnd();
      this.needsRender = true;
      return;
    }
    const step = () => {
      if (this.disposed || generation !== this.layoutGeneration) return;
      const st = this.layout;
      if (!st) return;
      refineChunk(st, 4);
      this.syncNodeMatrices();
      this.syncEdgePositions();
      this.callbacks.onLayoutProgress(st.iterations, TOTAL_LAYOUT_ITERATIONS);
      this.needsRender = true;
      if (st.iterations < TOTAL_LAYOUT_ITERATIONS) {
        this.layoutTimer = window.setTimeout(step, 16);
      } else {
        this.layoutTimer = undefined;
        this.callbacks.onLayoutEnd();
      }
    };
    this.layoutTimer = window.setTimeout(step, 16);
  }

  private cancelLayout() {
    this.layoutGeneration += 1;
    if (this.layoutTimer != null) {
      window.clearTimeout(this.layoutTimer);
      this.layoutTimer = undefined;
    }
  }

  // ── 邊 ───────────────────────────────────────────────────────

  private buildEdgeBatches(edges: WmEdge[]) {
    const groups: Record<string, WmEdge[]> = { fact: [], evidence: [], citation: [], inferred: [] };
    for (const edge of edges) {
      if (!edge?.source || !edge?.target) continue;
      const cls = classifyEdge(edge);
      (groups[cls] ?? groups.fact).push(edge);
    }
    const arrowBudget = this.lowPerf ? 1200 : 5000;
    for (const key of Object.keys(groups) as EdgeClass[]) {
      const list = groups[key];
      if (!list || list.length === 0) continue;
      const def = EDGE_CLASS_BY_KEY[key];
      const withArrows = key !== 'citation' && list.length <= arrowBudget;
      this.batches.push(this.createBatch(key, list, def.color, def.dash, withArrows, false));
    }
    this.edgeRoot.add(...this.batches.map((b) => b.object));
  }

  private createBatch(
    key: string,
    edges: WmEdge[],
    fallbackColor: string,
    dash: [number, number] | null,
    withArrows: boolean,
    derived: boolean,
  ): EdgeBatch {
    const vertsPerEdge = withArrows ? 6 : 2;
    const pairs = new Int32Array(edges.length * 2);
    const base = new Float32Array(edges.length * vertsPerEdge * 4);
    const positions = new Float32Array(edges.length * vertsPerEdge * 3);
    const colors = new Float32Array(edges.length * vertsPerEdge * 4);
    const color = new THREE.Color();
    edges.forEach((edge, e) => {
      pairs[e * 2] = -1;
      pairs[e * 2 + 1] = -1;
      const hex = derived ? fallbackColor : key === 'citation' ? EDGE_CLASS_BY_KEY.citation.color : relationColor(edge.type);
      color.set(hex);
      const alpha = derived ? 0.5 : key === 'fact' ? 0.55 : key === 'evidence' ? 0.8 : key === 'citation' ? 0.5 : 0.45;
      for (let v = 0; v < vertsPerEdge; v += 1) {
        const o = (e * vertsPerEdge + v) * 4;
        // 箭頭（v >= 2）用同色但更亮的版本，讓方向在暗色背景上讀得出來
        const boost = v >= 2 ? 1.35 : 1;
        const r0 = Math.min(1, color.r * boost + (v >= 2 ? 0.03 : 0));
        const g0 = Math.min(1, color.g * boost + (v >= 2 ? 0.03 : 0));
        const b0 = Math.min(1, color.b * boost + (v >= 2 ? 0.03 : 0));
        base[o] = r0;
        base[o + 1] = g0;
        base[o + 2] = b0;
        base[o + 3] = alpha;
        colors[o] = r0;
        colors[o + 1] = g0;
        colors[o + 2] = b0;
        colors[o + 3] = alpha;
      }
    });

    const geom = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    const colAttr = new THREE.BufferAttribute(colors, 4);
    colAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', posAttr);
    geom.setAttribute('color', colAttr);
    geom.setDrawRange(0, edges.length * vertsPerEdge);
    const material = dash
      ? new THREE.LineDashedMaterial({
          vertexColors: true,
          dashSize: dash[0],
          gapSize: dash[1],
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      : new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
    const object = new THREE.LineSegments(geom, material);
    object.frustumCulled = false;
    object.renderOrder = derived ? 2 : 0;
    return { key, object, edges, pairs, base, positions, colors, vertsPerEdge, dashed: Boolean(dash), derived };
  }

  private disposeBatch(batch: EdgeBatch) {
    batch.object.parent?.remove(batch.object);
    batch.object.geometry.dispose();
    (batch.object.material as THREE.Material).dispose();
  }

  setDerived(items: { id: string; score: number }[]) {
    if (this.disposed) return;
    this.disposeDerived();
    const selected = this.selectedId;
    if (!selected || items.length === 0) {
      this.needsRender = true;
      return;
    }
    const edges: WmEdge[] = items
      .filter((item) => this.nodeInfos.has(item.id) && item.id !== selected)
      .map((item) => ({
        id: `derived:${selected}:${item.id}`,
        source: selected,
        target: item.id,
        type: 'similar',
        label: `語意相似 ${(item.score * 100).toFixed(0)}%`,
        direction: 'undirected',
        epistemic_status: 'inference',
        sources: [],
        evidence: [],
        weight: item.score,
      }));
    if (edges.length === 0) {
      this.needsRender = true;
      return;
    }
    const def = EDGE_CLASS_BY_KEY.derived;
    const batch = this.createBatch('derived', edges, def.color, def.dash, false, true);
    this.derivedBatch = batch;
    this.derivedRoot.add(batch.object);
    this.resolvePairs(batch);
    this.syncBatchPositions(batch);
    this.applyEdgeMultipliers();
    this.needsRender = true;
  }

  private disposeDerived() {
    if (this.derivedBatch) {
      this.disposeBatch(this.derivedBatch);
      this.derivedBatch = null;
    }
  }

  private resolvePairs(batch: EdgeBatch) {
    const layout = this.layout;
    if (!layout) return false;
    let ok = true;
    batch.edges.forEach((edge, e) => {
      const a = layout.index.get(edge.source);
      const b = layout.index.get(edge.target);
      if (a == null || b == null) {
        batch.pairs[e * 2] = -1;
        batch.pairs[e * 2 + 1] = -1;
        ok = false;
        return;
      }
      batch.pairs[e * 2] = a;
      batch.pairs[e * 2 + 1] = b;
    });
    return ok;
  }

  private syncBatchPositions(batch: EdgeBatch) {
    const layout = this.layout;
    if (!layout) return;
    const pos = layout.pos;
    const { pairs, positions, vertsPerEdge } = batch;
    for (let e = 0; e < batch.edges.length; e += 1) {
      const ai = pairs[e * 2];
      const bi = pairs[e * 2 + 1];
      const o = e * vertsPerEdge * 3;
      if (ai < 0 || bi < 0) {
        positions.fill(0, o, o + vertsPerEdge * 3);
        continue;
      }
      const ax = pos[ai * 3];
      const ay = pos[ai * 3 + 1];
      const az = pos[ai * 3 + 2];
      const bx = pos[bi * 3];
      const by = pos[bi * 3 + 1];
      const bz = pos[bi * 3 + 2];
      positions[o] = ax;
      positions[o + 1] = ay;
      positions[o + 2] = az;
      positions[o + 3] = bx;
      positions[o + 4] = by;
      positions[o + 5] = bz;
      if (vertsPerEdge === 6) {
        // 箭頭：由目標端往內退一點的 V 形折線（兩個線段）
        const dx = bx - ax;
        const dy = by - ay;
        const dz = bz - az;
        const len = Math.hypot(dx, dy, dz) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const uz = dz / len;
        // 取一個與方向不平行的向量做垂直方向
        let px = uy;
        let py = -ux;
        let pz = 0;
        const pl = Math.hypot(px, py, pz) || 1;
        if (pl < 0.2) {
          px = uz;
          py = 0;
          pz = -ux;
        }
        const pl2 = Math.hypot(px, py, pz) || 1;
        px /= pl2;
        py /= pl2;
        pz /= pl2;
        const tipX = bx - ux * 0.6;
        const tipY = by - uy * 0.6;
        const tipZ = bz - uz * 0.6;
        const size = Math.min(6, Math.max(1.1, len * 0.055));
        const backX = tipX - ux * size;
        const backY = tipY - uy * size;
        const backZ = tipZ - uz * size;
        positions[o + 6] = tipX;
        positions[o + 7] = tipY;
        positions[o + 8] = tipZ;
        positions[o + 9] = backX + px * size * 0.62;
        positions[o + 10] = backY + py * size * 0.62;
        positions[o + 11] = backZ + pz * size * 0.62;
        positions[o + 12] = tipX;
        positions[o + 13] = tipY;
        positions[o + 14] = tipZ;
        positions[o + 15] = backX - px * size * 0.62;
        positions[o + 16] = backY - py * size * 0.62;
        positions[o + 17] = backZ - pz * size * 0.62;
      }
    }
    const geom = batch.object.geometry;
    (geom.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geom.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    if (batch.dashed) {
      batch.object.computeLineDistances();
    }
  }

  private syncEdgePositions() {
    for (const batch of this.batches) {
      this.resolvePairs(batch);
      this.syncBatchPositions(batch);
    }
    if (this.derivedBatch) {
      this.resolvePairs(this.derivedBatch);
      this.syncBatchPositions(this.derivedBatch);
    }
    this.applyEdgeMultipliers();
    this.needsRender = true;
  }

  private edgeMultiplier(edge: WmEdge): number {
    if (!this.selectedId) return 1;
    if (edge.source === this.selectedId || edge.target === this.selectedId) return 1;
    if (this.neighbours.has(edge.source) && this.neighbours.has(edge.target)) return 0.55;
    return 0.16;
  }

  private applyEdgeMultipliers() {
    const write = (batch: EdgeBatch) => {
      const { base, colors, vertsPerEdge, edges } = batch;
      for (let e = 0; e < edges.length; e += 1) {
        const m = this.edgeMultiplier(edges[e]);
        for (let v = 0; v < vertsPerEdge; v += 1) {
          const o = (e * vertsPerEdge + v) * 4;
          colors[o] = base[o] * m;
          colors[o + 1] = base[o + 1] * m;
          colors[o + 2] = base[o + 2] * m;
          colors[o + 3] = base[o + 3] * (this.selectedId ? (m < 0.3 ? 0.45 : 1) : 1);
        }
      }
      (batch.object.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    };
    for (const batch of this.batches) write(batch);
    if (this.derivedBatch) write(this.derivedBatch);
  }

  // ── 節點矩陣與選取 ─────────────────────────────────────────────

  private syncNodeMatrices() {
    const layout = this.layout;
    if (!layout) return;
    const dummy = new THREE.Object3D();
    for (const layer of this.nodeLayers.values()) {
      const st = kindStyle(layer.kind);
      const [sx, sy, sz] = shapeScale(st.shape);
      layer.ids.forEach((id, i) => {
        const meta = this.nodeInfos.get(id);
        const ni = layout.index.get(id);
        if (!meta || ni == null) return;
        dummy.position.set(layout.pos[ni * 3], layout.pos[ni * 3 + 1], layout.pos[ni * 3 + 2]);
        dummy.rotation.set(meta.rx, meta.ry, meta.rz);
        const boost = id === this.hoverId ? 1.25 : id === this.selectedId ? 1.16 : 1;
        dummy.scale.set(meta.size * sx * boost, meta.size * sy * boost, meta.size * sz * boost);
        dummy.updateMatrix();
        layer.mesh.setMatrixAt(i, dummy.matrix);
      });
      layer.mesh.instanceMatrix.needsUpdate = true;
    }
    this.syncGlowPositions();
    this.updateHalos();
  }

  setSelection(id: string | null, neighbourIds: Set<string>) {
    this.selectedId = id;
    this.neighbours = id ? neighbourIds : new Set();
    this.syncNodeMatrices();
    this.applySelectionVisuals();
    this.refreshLabels();
    this.needsRender = true;
  }

  setHover(id: string | null) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.applySelectionVisuals();
    this.syncNodeMatrices();
    this.refreshLabels();
    this.needsRender = true;
  }

  private applySelectionVisuals() {
    const selected = this.selectedId;
    for (const layer of this.nodeLayers.values()) {
      layer.ids.forEach((id, i) => {
        let alpha = 1;
        if (selected) {
          if (id === selected) alpha = 1;
          else if (this.neighbours.has(id)) alpha = 0.94;
          else alpha = 0.22;
        }
        if (id === this.hoverId && alpha < 0.9) alpha = Math.max(alpha, 0.86);
        layer.alphas[i] = alpha;
      });
      layer.alphaAttr.needsUpdate = true;
    }
    this.syncGlowAlphas();
    this.applyEdgeMultipliers();
    this.updateHalos();
  }

  private updateHalos() {
    const layout = this.layout;
    if (!layout) return;
    const place = (sprite: THREE.Sprite, id: string | null, base: number) => {
      if (!id) {
        sprite.visible = false;
        return;
      }
      const meta = this.nodeInfos.get(id);
      const ni = layout.index.get(id);
      if (!meta || ni == null) {
        sprite.visible = false;
        return;
      }
      sprite.visible = true;
      sprite.position.set(layout.pos[ni * 3], layout.pos[ni * 3 + 1], layout.pos[ni * 3 + 2]);
      const s = Math.max(base, meta.size * 13);
      sprite.scale.setScalar(s);
      (sprite.material as THREE.SpriteMaterial).color.set(meta.color);
    };
    place(this.selectedHalo, this.selectedId, 34);
    place(this.hoverHalo, this.hoverId, 22);
    if (this.hoverHalo.visible && (this.hoverHalo.material as THREE.SpriteMaterial).color) {
      (this.hoverHalo.material as THREE.SpriteMaterial).color.set(0xffffff);
    }
  }

  /** 平滑把相機移到節點，並把 OrbitControls 的注視點放在節點上。 */
  focus(id: string) {
    const layout = this.layout;
    if (!layout) return;
    const ni = layout.index.get(id);
    if (ni == null) return;
    const target = new THREE.Vector3(layout.pos[ni * 3], layout.pos[ni * 3 + 1], layout.pos[ni * 3 + 2]);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.4, 1);
    dir.normalize();
    const dist = Math.max(46, Math.min(this.frameRadius() * 0.9, target.distanceTo(this.controls.target) * 1.4 + 40));
    const pos = target.clone().add(dir.multiplyScalar(dist));
    this.cameraTween = { pos, target };
    this.userNavigated = true;
    this.needsRender = true;
  }

  private stepCameraTween(): boolean {
    if (!this.cameraTween) return false;
    const { pos, target } = this.cameraTween;
    const k = this.options.reducedMotion ? 1 : 0.13;
    this.camera.position.lerp(pos, k);
    this.controls.target.lerp(target, k);
    const done = this.camera.position.distanceTo(pos) < 1.2 && this.controls.target.distanceTo(target) < 1.2;
    if (done) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.cameraTween = null;
    }
    this.controls.update();
    return true;
  }

  // ── 標籤 ─────────────────────────────────────────────────────

  private refreshLabels() {
    if (!this.labelHost) return;
    const wanted: string[] = [];
    if (this.options.showLabels) {
      if (this.selectedId) wanted.push(this.selectedId);
      if (this.hoverId && this.hoverId !== this.selectedId) wanted.push(this.hoverId);
    }
    const limit = this.lowPerf ? 26 : 40;
    if (this.options.showLabels && wanted.length < limit && this.layout) {
      const ranked = [...this.nodeInfos.values()]
        .filter((m) => !wanted.includes(m.id))
        .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
      for (const meta of ranked) {
        if (wanted.length >= limit) break;
        if (meta.degree <= 0 && wanted.length > 8) break;
        wanted.push(meta.id);
      }
    }
    this.labelIds = wanted;
    const keep = new Set(wanted);
    for (const [id, el] of this.labelEls) {
      if (!keep.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
    for (const id of wanted) {
      let el = this.labelEls.get(id);
      if (!el) {
        const meta = this.nodeInfos.get(id);
        if (!meta) continue;
        el = document.createElement('div');
        el.className = 'univ-label';
        const inner = document.createElement('span');
        inner.className = 'univ-label-inner';
        const dot = document.createElement('i');
        dot.style.background = meta.color;
        const text = document.createElement('b');
        text.textContent = meta.title.length > 22 ? `${meta.title.slice(0, 21)}…` : meta.title;
        inner.append(dot, text);
        el.append(inner);
        this.labelHost.append(el);
        this.labelEls.set(id, el);
      }
      el.classList.toggle('is-selected', id === this.selectedId);
      el.classList.toggle('is-hover', id === this.hoverId);
    }
    this.updateLabelPositions();
  }

  private updateLabelPositions() {
    if (this.labelEls.size === 0 || !this.layout) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    const v = new THREE.Vector3();
    for (const id of this.labelIds) {
      const el = this.labelEls.get(id);
      const ni = this.layout.index.get(id);
      if (!el || ni == null) continue;
      v.set(this.layout.pos[ni * 3], this.layout.pos[ni * 3 + 1], this.layout.pos[ni * 3 + 2]).project(this.camera);
      if (v.z < -1 || v.z > 1) {
        el.style.opacity = '0';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      if (x < -60 || x > w + 60 || y < -30 || y > h + 40) {
        el.style.opacity = '0';
        continue;
      }
      el.style.opacity = '1';
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  }

  // ── 節點柔光層 ────────────────────────────────────────────────
  // 節點本體在總覽距離可能只有幾像素；再加一層永遠面向相機的柔光點，
  // 讓 1000+ 節點在縮小檢視時仍可辨識，並保留「柔和不刺眼」的宇宙感。

  private buildGlow() {
    const layout = this.layout;
    if (!layout || layout.ids.length === 0) return;
    const n = layout.ids.length;
    const positions = new Float32Array(layout.pos);
    const colors = new Float32Array(n * 3);
    const sizes = new Float32Array(n);
    const alphas = new Float32Array(n).fill(1);
    const color = new THREE.Color();
    this.nodeOrder.forEach((id, i) => {
      const meta = this.nodeInfos.get(id);
      if (!meta) return;
      color.set(meta.color).convertLinearToSRGB();
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      sizes[i] = Math.max(3.4, meta.size * 5.2);
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    const alphaAttr = new THREE.BufferAttribute(alphas, 1);
    alphaAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('aAlpha', alphaAttr);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uPixelScale: { value: viewportPixelScale(this.container.clientHeight, this.camera.fov) },
      },
      vertexShader: `
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uPixelScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float dist = max(0.001, -mv.z);
          gl_PointSize = clamp(aSize * uPixelScale / dist, 1.5, 90.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d) * 2.0;
          if (r > 1.0) discard;
          float a = pow(1.0 - r, 1.55) * 0.78 * vAlpha;
          gl_FragColor = vec4(vColor, a);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geom, mat);
    points.frustumCulled = false;
    points.renderOrder = 0;
    this.glowPoints = points;
    this.glowAlpha = alphas;
    this.glowAlphaAttr = alphaAttr;
    this.glowMat = mat;
    this.nodeRoot.add(points);
  }

  private syncGlowPositions() {
    const layout = this.layout;
    const points = this.glowPoints;
    if (!layout || !points) return;
    const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attr.array as Float32Array).set(layout.pos);
    attr.needsUpdate = true;
  }

  private syncGlowAlphas() {
    const points = this.glowPoints;
    const alphas = this.glowAlpha;
    if (!points || !alphas || !this.glowAlphaAttr) return;
    const selected = this.selectedId;
    this.nodeOrder.forEach((id, i) => {
      let a = 0.82;
      if (selected) {
        if (id === selected) a = 1;
        else if (this.neighbours.has(id)) a = 0.82;
        else a = 0.2;
      } else if (id === this.hoverId) {
        a = 1;
      }
      alphas[i] = a;
    });
    this.glowAlphaAttr.needsUpdate = true;
  }

  private disposeGlow() {
    if (this.glowPoints) {
      this.nodeRoot.remove(this.glowPoints);
      this.glowPoints.geometry.dispose();
      (this.glowPoints.material as THREE.Material).dispose();
      this.glowPoints = null;
    }
    this.glowAlpha = null;
    this.glowAlphaAttr = null;
    this.glowMat = null;
  }

  // ── 互動 ─────────────────────────────────────────────────────

  private onPointerMove = (e: PointerEvent) => {
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerInside = true;
    this.hoverDirty = true;
    if (this.pointerDown && Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y) > 6) {
      this.dragging = true;
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, at: performance.now() };
    this.dragging = false;
  };

  private onPointerUp = (e: PointerEvent) => {
    const wasDragging = this.dragging;
    this.dragging = false;
    if (!this.pointerDown) return;
    const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (moved > 6 || wasDragging) return;
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const hit = this.pick();
    this.callbacks.onSelect(hit);
    this.needsRender = true;
  };

  private onDoubleClick = (e: MouseEvent) => {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const hit = this.pick();
    if (hit) this.callbacks.onFocus(hit);
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.pointerDown = null;
    this.dragging = false;
    this.setHover(null);
    this.callbacks.onHover(null, 0, 0);
    this.needsRender = true;
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.key === 'r' || e.key === 'R') {
      this.resetView();
      e.preventDefault();
    }
  };

  private pick(): string | null {
    if (this.pickables.length === 0) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const hit of hits) {
      const layer = (hit.object.userData as { layer?: NodeLayer }).layer;
      if (!layer || hit.instanceId == null) continue;
      const id = layer.ids[hit.instanceId];
      if (id) return id;
    }
    return null;
  }

  private updateHoverAt(x: number, y: number) {
    const rect = this.container.getBoundingClientRect();
    this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const id = this.pointerInside ? this.pick() : null;
    if (id !== this.hoverId) this.setHover(id);
    this.callbacks.onHover(id, x, y);
  }

  // ── 主迴圈 ───────────────────────────────────────────────────

  private animate = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.animate);
    const now = performance.now();

    const tweening = this.stepCameraTween();
    const controlsChanged = this.controls.update();
    if (controlsChanged) this.needsRender = true;
    if (this.autoRotate) this.needsRender = true;

    if (this.hoverDirty && !this.dragging && now - this.lastPickAt > 65) {
      this.hoverDirty = false;
      this.lastPickAt = now;
      this.updateHoverAt(this.lastPointerX, this.lastPointerY);
    }

    if (tweening || this.needsRender) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
    if (this.labelEls.size > 0 && now - this.lastLabelAt > 70) {
      this.lastLabelAt = now;
      this.updateLabelPositions();
    }
  };

  // ── 清理 ─────────────────────────────────────────────────────

  private disposeObject(root: THREE.Object3D) {
    root.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = (obj as THREE.Mesh).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) (mat as THREE.Material).dispose();
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelLayout();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('pointercancel', this.onPointerLeave);
    el.removeEventListener('dblclick', this.onDoubleClick);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.controls.dispose();
    for (const batch of this.batches) this.disposeBatch(batch);
    this.batches = [];
    this.disposeDerived();
    this.disposeGlow();
    for (const layer of this.nodeLayers.values()) {
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
    }
    this.nodeLayers.clear();
    this.disposeObject(this.starField ?? new THREE.Group());
    this.disposeObject(this.nebula ?? new THREE.Group());
    (this.selectedHalo.material as THREE.SpriteMaterial).dispose();
    (this.hoverHalo.material as THREE.SpriteMaterial).dispose();
    this.glow.dispose();
    this.renderer.dispose();
    if (el.parentElement) el.parentElement.removeChild(el);
    for (const el2 of this.labelEls.values()) el2.remove();
    this.labelEls.clear();
    this.labelHost.replaceChildren();
  }

  /** 低效能裝置：降低星霧粒子數。由建構子設定，重建場景時可再呼叫。 */
  setStarDensity(radius: number) {
    this.starRadius = radius;
    if (this.starField) {
      this.root.remove(this.starField);
      this.disposeObject(this.starField);
      this.starField = null;
    }
    const count = this.lowPerf ? 900 : 2600;
    this.starField = makeStarField(count, this.starRadius, this.glow);
    this.starField.visible = !this.options.reducedMotion;
    this.root.add(this.starField);
    this.needsRender = true;
  }

  /** 初始化星空與星霧（只做一次；在 setData 之後以實際半徑調整）。 */
  ensureAtmosphere() {
    if (!this.starField) this.setStarDensity(this.frameRadius() * 1.7);
    if (!this.nebula) {
      const mat = new THREE.SpriteMaterial({
        map: this.glow,
        color: 0x2f4a80,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.nebula = new THREE.Sprite(mat);
      this.nebula.scale.setScalar(this.frameRadius() * 4.4);
      this.nebula.position.set(0, -this.frameRadius() * 0.15, -this.frameRadius() * 1.4);
      this.root.add(this.nebula);
      this.needsRender = true;
    }
  }
}
