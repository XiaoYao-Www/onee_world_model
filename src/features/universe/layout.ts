import type { WmEdge, WmNode } from '../../data/types';
import { kindStyle } from '../../lib/palette';
import { fnv1a } from '../../lib/tokens';

/**
 * 確定性 3D 佈局：「學科／型別群集球面 + 關係吸引」。
 *
 * 1. 依 palette 的 group（實體／事件／知識／證據／後設）把群集中心放到球面上。
 * 2. 群集內每個型別再取一個子中心，型別內節點以球面費氏螺旋（phyllotaxis）均勻排開，
 *    只用節點 id 的雜湊做微小抖動，因此同一份資料永遠得到同一個佈局。
 * 3. 之後跑固定次數的「關係彈簧 + 群集拉力 + 鄰近斥力」迭代；迭代由呼叫端分批執行，
 *    節點多時也不會凍結主執行緒，而且完全不會每幀重算。
 */

export type Vec3 = [number, number, number];

export interface LayoutState {
  ids: string[];
  index: Map<string, number>;
  /** 3 個 float 一個節點 */
  pos: Float32Array;
  /** 群集中心（拉力目標），3 個 float 一個節點 */
  home: Float32Array;
  /** 兩兩配對的節點索引（關係邊） */
  pairs: Int32Array;
  radius: number;
  iterations: number;
}

const GROUP_ORDER = ['entity', 'event', 'knowledge', 'evidence', 'meta'] as const;

const GROUP_DIRS: Record<string, Vec3> = {
  entity: [-0.66, 0.16, 0.34],
  event: [0.68, 0.3, -0.22],
  knowledge: [0.06, -0.48, 0.78],
  evidence: [-0.28, -0.56, -0.66],
  meta: [0.02, 0.86, 0.12],
};

const GOLDEN_ANGLE = 2.399963229728653;

function hash01(key: string, salt = ''): number {
  return (fnv1a(`${salt}|${key}`) % 10000) / 10000;
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** 由字串雜湊得到球面上一個確定性方向。 */
function dirFromHash(key: string, salt: string): Vec3 {
  const a = hash01(key, `${salt}a`) * Math.PI * 2;
  const z = hash01(key, `${salt}z`) * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [Math.cos(a) * r, z, Math.sin(a) * r];
}

function spiralPoint(i: number, n: number, jitter: number): Vec3 {
  const y = 1 - (2 * (i + 0.5)) / Math.max(n, 1);
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * GOLDEN_ANGLE + jitter;
  return [Math.cos(theta) * r, y, Math.sin(theta) * r];
}

function groupOf(kind: string): string {
  const g = kindStyle(kind).group;
  return (GROUP_ORDER as readonly string[]).includes(g) ? g : 'meta';
}

export function clusterRadiusForCount(count: number): number {
  return 3.2 + 7.4 * Math.cbrt(Math.max(1, count));
}

export function buildLayout(nodes: WmNode[], edges: WmEdge[]): LayoutState {
  const ordered = [...nodes].sort((a, b) => {
    const ka = kindStyle(a.kind);
    const kb = kindStyle(b.kind);
    if (ka.order !== kb.order) return ka.order - kb.order;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const n = ordered.length;
  const ids = ordered.map((x) => x.id);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));

  const radius = Math.min(940, Math.max(210, 158 + Math.sqrt(Math.max(n, 1)) * 20));

  const pos = new Float32Array(n * 3);
  const home = new Float32Array(n * 3);

  // 群集中心
  const groupMembers = new Map<string, WmNode[]>();
  for (const node of ordered) {
    const g = groupOf(node.kind);
    const arr = groupMembers.get(g);
    if (arr) arr.push(node);
    else groupMembers.set(g, [node]);
  }
  const groupCenter = new Map<string, Vec3>();
  for (const g of GROUP_ORDER) {
    if (!groupMembers.has(g)) continue;
    const base = GROUP_DIRS[g] ?? [0, 1, 0];
    const dir = normalize(base);
    const scale = radius * (0.6 + hash01(g, 'gc') * 0.12);
    groupCenter.set(g, [dir[0] * scale, dir[1] * scale, dir[2] * scale]);
  }

  // 型別子中心
  const kindMembers = new Map<string, WmNode[]>();
  for (const node of ordered) {
    const arr = kindMembers.get(node.kind);
    if (arr) arr.push(node);
    else kindMembers.set(node.kind, [node]);
  }
  const kindCenter = new Map<string, Vec3>();
  for (const [kind, members] of kindMembers) {
    const gc = groupCenter.get(groupOf(kind)) ?? [0, 0, 0];
    const dir = dirFromHash(kind, 'kind');
    const spread = radius * (0.2 + hash01(kind, 'ks') * 0.16);
    kindCenter.set(kind, [gc[0] + dir[0] * spread, gc[1] + dir[1] * spread, gc[2] + dir[2] * spread]);
  }

  // 節點位置：型別內球面螺旋，大小依節點數
  for (const [kind, members] of kindMembers) {
    const center = kindCenter.get(kind) ?? [0, 0, 0];
    const cr = clusterRadiusForCount(members.length);
    members.forEach((node, i) => {
      const p = spiralPoint(i, members.length, hash01(node.id, 'ph') * Math.PI * 2);
      const jitter = 0.55 * hash01(node.id, 'jit');
      const p2 = spiralPoint(i, members.length, hash01(node.id, 'ph2') * Math.PI * 2);
      const k = index.get(node.id) as number;
      const x = center[0] + p[0] * cr + p2[0] * jitter;
      const y = center[1] + p[1] * cr * 0.86 + p2[1] * jitter;
      const z = center[2] + p[2] * cr + p2[2] * jitter;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      // 拉力目標是「理想群集位置」而不是群集中心：群集中心只是一個點，
      // 若把它當拉力目標，所有同類節點最後會擠成一團。
      home[k * 3] = x;
      home[k * 3 + 1] = y;
      home[k * 3 + 2] = z;
    });
  }

  // 關係配對
  const pairList: number[] = [];
  for (const edge of edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a == null || b == null || a === b) continue;
    pairList.push(a, b);
  }

  return {
    ids,
    index,
    pos,
    home,
    pairs: Int32Array.from(pairList),
    radius,
    iterations: 0,
  };
}

function cellKey(ix: number, iy: number, iz: number): number {
  return (((ix + 512) * 73856093) ^ ((iy + 512) * 19349663) ^ ((iz + 512) * 83492791)) >>> 0;
}

/** 一個批次的力學迭代（就地修改 pos）。呼叫端每次跑少量迭代以保持介面流暢。 */
export function refineChunk(state: LayoutState, iterations: number, cellSize = 13): void {
  const { pos, home, pairs, ids } = state;
  const n = ids.length;
  if (n === 0) return;
  const springTarget = Math.max(16, Math.min(42, 320 / Math.sqrt(Math.max(n, 1))));
  const repulseRadius = cellSize * 0.78;

  for (let iter = 0; iter < iterations; iter += 1) {
    state.iterations += 1;

    // 1) 關係吸引：讓有關係的節點靠近，但不折斷群集結構
    for (let k = 0; k < pairs.length; k += 2) {
      const a = pairs[k] * 3;
      const b = pairs[k + 1] * 3;
      const dx = pos[b] - pos[a];
      const dy = pos[b + 1] - pos[a + 1];
      const dz = pos[b + 2] - pos[a + 2];
      const d = Math.hypot(dx, dy, dz) || 0.001;
      if (d <= springTarget) continue;
      const f = Math.min(2.4, 0.03 * (d - springTarget));
      const ux = dx / d;
      const uy = dy / d;
      const uz = dz / d;
      pos[a] += ux * f;
      pos[a + 1] += uy * f;
      pos[a + 2] += uz * f;
      pos[b] -= ux * f;
      pos[b + 1] -= uy * f;
      pos[b + 2] -= uz * f;
    }

    // 2) 群集拉力：避免關係把節點拉到整個宇宙的中心
    for (let i = 0; i < n; i += 1) {
      const o = i * 3;
      pos[o] += (home[o] - pos[o]) * 0.052;
      pos[o + 1] += (home[o + 1] - pos[o + 1]) * 0.052;
      pos[o + 2] += (home[o + 2] - pos[o + 2]) * 0.052;
    }

    // 3) 鄰近斥力（空間雜湊，只檢查相鄰格）
    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i += 1) {
      const o = i * 3;
      const ix = Math.floor(pos[o] / cellSize);
      const iy = Math.floor(pos[o + 1] / cellSize);
      const iz = Math.floor(pos[o + 2] / cellSize);
      const key = cellKey(ix, iy, iz);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }
    for (let i = 0; i < n; i += 1) {
      const o = i * 3;
      const ix = Math.floor(pos[o] / cellSize);
      const iy = Math.floor(pos[o + 1] / cellSize);
      const iz = Math.floor(pos[o + 2] / cellSize);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const bucket = grid.get(cellKey(ix + dx, iy + dy, iz + dz));
            if (!bucket) continue;
            for (let bi = 0; bi < bucket.length; bi += 1) {
              const j = bucket[bi];
              if (j <= i) continue;
              const o2 = j * 3;
              const vx = pos[o2] - pos[o];
              const vy = pos[o2 + 1] - pos[o + 1];
              const vz = pos[o2 + 2] - pos[o + 2];
              const d = Math.hypot(vx, vy, vz) || 0.001;
              if (d >= repulseRadius) continue;
              const push = (repulseRadius - d) * 0.16;
              const ux = vx / d;
              const uy = vy / d;
              const uz = vz / d;
              pos[o] -= ux * push;
              pos[o + 1] -= uy * push;
              pos[o + 2] -= uz * push;
              pos[o2] += ux * push;
              pos[o2 + 1] += uy * push;
              pos[o2 + 2] += uz * push;
            }
          }
        }
      }
    }
  }
}

export const TOTAL_LAYOUT_ITERATIONS = 36;
