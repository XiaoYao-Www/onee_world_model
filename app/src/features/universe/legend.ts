import type { WmEdge } from '../../data/types';
import { KIND_STYLES, kindStyle, relationLabel, type KindStyle } from '../../lib/palette';

/**
 * 宇宙視圖的視覺語義表（顏色只是輔助，形狀、大小、虛線、箭頭同樣承載語義）。
 *
 * 這裡集中定義「邊的分類」與「型別形狀說明」，讓 3D 場景、HUD、圖例共用同一份
 * 語義，避免同一條關係在不同地方看起來不一樣。衍生關係（語意相似）永遠不屬於
 * 事實關係，必鬚以獨立樣式呈現並在圖例標明。
 */

export type KindShape = KindStyle['shape'];
export type EdgeClass = 'fact' | 'evidence' | 'citation' | 'inferred' | 'derived';

export const SHAPE_LABELS: Record<KindShape, string> = {
  sphere: '球體',
  cube: '立方體',
  icosa: '二十面體',
  octa: '八面體',
  torus: '環體',
  tetra: '四面體',
  dodeca: '十二面體',
  diamond: '菱形',
  disc: '圓盤',
  panel: '平板',
  ring: '細環',
  wire: '線框',
};

export interface KindLegendItem {
  kind: string;
  label: string;
  color: string;
  shape: KindShape;
  shapeLabel: string;
  group: KindStyle['group'];
  order: number;
}

/** 圖例用型別清單（依 palette 的語義排序，最多列 12 個常見型別）。 */
export const KIND_LEGEND: KindLegendItem[] = Object.values(KIND_STYLES)
  .filter((s) => s.key !== 'unknown')
  .sort((a, b) => a.order - b.order)
  .map((s) => ({
    kind: s.key,
    label: s.label,
    color: s.color,
    shape: s.shape,
    shapeLabel: SHAPE_LABELS[s.shape],
    group: s.group,
    order: s.order,
  }));

export interface EdgeClassDef {
  key: EdgeClass;
  label: string;
  hint: string;
  color: string;
  dash: [number, number] | null;
  width: number;
  /** 衍生關係不是本體記錄的關係，只是檢索／向量鄰近。 */
  derived?: boolean;
}

export const EDGE_CLASS_DEFS: EdgeClassDef[] = [
  {
    key: 'fact',
    label: '事實關係',
    hint: '本體明確記錄的關係，有方向性（箭頭）。',
    color: '#8aa4c8',
    dash: null,
    width: 1,
  },
  {
    key: 'evidence',
    label: '證據支持／反駁',
    hint: 'supports／contradicts：較亮、長虛線，帶箭頭指向被支持或反駁的對象。',
    color: '#4ade80',
    dash: [7, 4],
    width: 1.35,
  },
  {
    key: 'citation',
    label: '來源引用',
    hint: '來源與證據被引用：細虛線、金黃色，只表示出處，不表示立場。',
    color: '#f6c177',
    dash: [2.5, 3],
    width: 0.85,
  },
  {
    key: 'inferred',
    label: '推論／待驗證',
    hint: 'epistemic_status 為推論、假設、預測或有爭議：點虛線，亮度較低。',
    color: '#c084fc',
    dash: [1.5, 3.5],
    width: 0.9,
  },
  {
    key: 'derived',
    label: '衍生：語意相似',
    hint: '由向量鄰近即時產生，不是關係、不是事實；僅供探索，開啟「衍生關係」才顯示。',
    color: '#9aa4c0',
    dash: [3, 6],
    width: 0.9,
    derived: true,
  },
];

export const EDGE_CLASS_BY_KEY: Record<EdgeClass, EdgeClassDef> = EDGE_CLASS_DEFS.reduce(
  (acc, def) => {
    acc[def.key] = def;
    return acc;
  },
  {} as Record<EdgeClass, EdgeClassDef>,
);

const RELATION_PALETTE = ['#7dd3fc', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#fb923c', '#2dd4bf'];

/** 已知關係型別的固定顏色；未知型別以固定色環輪替，維持跨視圖一致。 */
export const RELATION_COLORS: Record<string, string> = {
  supplies: '#fb923c',
  member_of: '#a78bfa',
  employs: '#7dd3fc',
  leads: '#c084fc',
  founded: '#c084fc',
  located_in: '#34d399',
  participates_in: '#fbbf24',
  competes_with: '#fb7185',
  cooperates_with: '#38bdf8',
  opposes: '#f87171',
  controls: '#f472b6',
  depends_on: '#94a3b8',
  influences: '#60a5fa',
  causes: '#fb923c',
  cites: '#f6c177',
  supports: '#4ade80',
  contradicts: '#f87171',
  related_to: '#64748b',
  owns: '#f6c177',
  produces: '#fb923c',
  invests_in: '#f6c177',
  sanctions: '#f87171',
  exports_to: '#34d399',
  imports_from: '#2dd4bf',
  regulates: '#94a3b8',
  subsidiary_of: '#a78bfa',
  acquired: '#c084fc',
  announced: '#fbbf24',
  affects: '#fb923c',
};

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function relationColor(type: string): string {
  const known = RELATION_COLORS[type];
  if (known) return known;
  return RELATION_PALETTE[hashString(type) % RELATION_PALETTE.length];
}

/** 邊的分類：事實、證據、來源引用、推論。衍生關係由呼叫端另外標記。 */
export function classifyEdge(edge: WmEdge): EdgeClass {
  if (edge.type === 'supports' || edge.type === 'contradicts') return 'evidence';
  if (edge.type === 'cites') return 'citation';
  const ep = (edge.epistemic_status ?? '').toLowerCase();
  if (ep === 'inference' || ep === 'hypothesis' || ep === 'forecast' || ep === 'disputed') return 'inferred';
  if (edge.demo) return 'inferred';
  return 'fact';
}

/** 邊的有效期間是否落在時間窗內（沒有期間者一律視為可見）。 */
export function edgeInWindow(edge: WmEdge, from: number | null, to: number | null): boolean {
  const parse = (v?: string | null): number | null => {
    if (!v) return null;
    const t = Date.parse(/^\d{4}-\d{2}$/.test(v) ? `${v}-01` : v);
    return Number.isNaN(t) ? null : t;
  };
  const start = parse(edge.valid_from);
  const end = parse(edge.valid_to);
  if (from != null && end != null && end < from) return false;
  if (to != null && start != null && start > to) return false;
  return true;
}

/** 給圖例／Inspector 用的一句話說明。 */
export function describeEdge(edge: WmEdge): string {
  const label = edge.label || relationLabel(edge.type);
  return `${relationLabel(edge.type)}${label && label !== edge.type ? `（${label}）` : ''}`;
}

/** 節點視覺大小（依連結數）：提供給圖例說明與場景共用。 */
export function nodeSizeForDegree(degree: number): number {
  // 世界單位；在預設鏡頭（約 2.3 倍宇宙半徑）下，一般節點約 5–9 像素，
  // 高度數節點明顯較大，才不會在總覽時變成看不見的小點。
  const base = 3.1 + Math.log2(1 + Math.max(0, degree)) * 0.95;
  return Math.min(9, Math.max(3.1, base));
}

export { kindStyle, relationLabel };
