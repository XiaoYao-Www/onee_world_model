import type { NodeKind } from '../data/types';

/** 節點型別的視覺與文字語義。顏色只是輔助，形狀與標籤同樣表達型別。 */

export interface KindStyle {
  key: NodeKind | string;
  label: string;
  plural: string;
  color: string;
  shape: 'sphere' | 'cube' | 'icosa' | 'octa' | 'torus' | 'tetra' | 'dodeca' | 'diamond' | 'disc' | 'panel' | 'ring' | 'wire';
  group: 'entity' | 'event' | 'knowledge' | 'evidence' | 'meta';
  order: number;
}

export const KIND_STYLES: Record<string, KindStyle> = {
  person: { key: 'person', label: '人物', plural: '人物', color: '#7dd3fc', shape: 'sphere', group: 'entity', order: 10 },
  organization: { key: 'organization', label: '組織', plural: '組織', color: '#a78bfa', shape: 'cube', group: 'entity', order: 20 },
  country: { key: 'country', label: '國家／政體', plural: '國家／政體', color: '#f472b6', shape: 'icosa', group: 'entity', order: 30 },
  place: { key: 'place', label: '地點', plural: '地點', color: '#34d399', shape: 'octa', group: 'entity', order: 40 },
  technology: { key: 'technology', label: '技術', plural: '技術', color: '#38bdf8', shape: 'tetra', group: 'entity', order: 50 },
  resource: { key: 'resource', label: '資源', plural: '資源', color: '#fb923c', shape: 'dodeca', group: 'entity', order: 60 },
  event: { key: 'event', label: '事件', plural: '事件', color: '#fbbf24', shape: 'torus', group: 'event', order: 70 },
  knowledge: { key: 'knowledge', label: '知識', plural: '知識', color: '#60a5fa', shape: 'ring', group: 'knowledge', order: 80 },
  hypothesis: { key: 'hypothesis', label: '假設', plural: '假設', color: '#f87171', shape: 'wire', group: 'knowledge', order: 90 },
  scenario: { key: 'scenario', label: '情境', plural: '情境', color: '#2dd4bf', shape: 'wire', group: 'knowledge', order: 95 },
  analysis: { key: 'analysis', label: '分析', plural: '分析', color: '#c084fc', shape: 'panel', group: 'knowledge', order: 100 },
  claim: { key: 'claim', label: '主張', plural: '主張', color: '#e879f9', shape: 'diamond', group: 'evidence', order: 110 },
  evidence: { key: 'evidence', label: '證據', plural: '證據', color: '#94a3b8', shape: 'disc', group: 'evidence', order: 120 },
  source: { key: 'source', label: '來源', plural: '來源', color: '#f6c177', shape: 'panel', group: 'evidence', order: 130 },
  topic: { key: 'topic', label: '主題', plural: '主題', color: '#94a3b8', shape: 'disc', group: 'meta', order: 140 },
  research_question: { key: 'research_question', label: '研究問題', plural: '研究問題', color: '#94a3b8', shape: 'disc', group: 'meta', order: 150 },
  project: { key: 'project', label: '專案', plural: '專案', color: '#94a3b8', shape: 'cube', group: 'meta', order: 160 },
  dataset: { key: 'dataset', label: '資料集', plural: '資料集', color: '#94a3b8', shape: 'cube', group: 'meta', order: 170 },
  image_asset: { key: 'image_asset', label: '圖像', plural: '圖像', color: '#94a3b8', shape: 'panel', group: 'meta', order: 180 },
  timeline: { key: 'timeline', label: '時間軸', plural: '時間軸', color: '#94a3b8', shape: 'ring', group: 'meta', order: 190 },
  unknown: { key: 'unknown', label: '未分類', plural: '未分類', color: '#64748b', shape: 'sphere', group: 'meta', order: 999 },
};

export function kindStyle(kind: string | undefined | null): KindStyle {
  if (!kind) return KIND_STYLES.unknown;
  return KIND_STYLES[kind] ?? { ...KIND_STYLES.unknown, key: kind, label: kind, plural: kind };
}

export const RELATION_LABELS: Record<string, string> = {
  supplies: '供應',
  member_of: '成員',
  employs: '任職',
  leads: '領導',
  founded: '創立',
  located_in: '位於',
  participates_in: '參與',
  competes_with: '競爭',
  cooperates_with: '合作',
  opposes: '對立',
  controls: '管制',
  depends_on: '依賴',
  influences: '影響',
  causes: '造成',
  cites: '引用',
  supports: '支持',
  contradicts: '反駁',
  related_to: '相關',
  owns: '擁有',
  produces: '生產',
  invests_in: '投資',
  sanctions: '制裁',
  exports_to: '出口至',
  imports_from: '進口自',
  regulates: '監管',
  subsidiary_of: '子公司',
  acquired: '併購',
  announced: '宣布',
  about: '關於',
  provides: '提供',
  funds: '資助',
  produces_for: '代工',
  affects: '衝擊',
};

export function relationLabel(type: string): string {
  return RELATION_LABELS[type] ?? type;
}

export const EPISTEMIC_LABELS: Record<string, string> = {
  verified_fact: '已核實事實',
  source_claim: '來源聲稱',
  inference: '推論',
  hypothesis: '假設',
  forecast: '預測',
  disputed: '有爭議',
  unknown: '未知',
};

export const EVIDENCE_ROLE_LABELS: Record<string, string> = {
  supports: '支持',
  contradicts: '反駁',
  context: '背景',
  unassessed: '未評估',
};

export const GEO_ROLE_LABELS: Record<string, string> = {
  birth_place: '出生地',
  death_place: '逝世地',
  residence: '居住地',
  nationality: '國籍',
  activity_area: '活動範圍',
  hq: '總部',
  facility: '設施／廠區',
  event_location: '事件地點',
  territory_claim: '主權主張',
  controlled_area: '實際控制',
  supply_route: '供應路徑',
};

export const SOURCE_TYPE_LABELS: Record<string, string> = {
  news: '新聞',
  official_document: '官方文件',
  law: '法律文件',
  paper: '論文',
  report: '研究報告',
  statistics: '統計',
  open_data: '開放資料',
  image: '圖像',
  video: '影片',
  interview: '訪談',
  social: '社群內容',
  other: '其他',
};

export const PRECISION_LABELS: Record<string, string> = {
  exact: '精確',
  city: '城市級',
  region: '區域級',
  country: '國家級',
  coarse: '粗略',
};

export const ARCHIVE_STATUS_LABELS: Record<string, string> = {
  archived: '已完整存檔',
  partial: '部分存檔',
  restricted: '授權受限',
  metadata_only: '僅書目資料',
  failed: '存檔失敗',
  unknown: '未評估',
};

export const TIME_PRECISION_LABELS: Record<string, string> = {
  exact_day: '精確到日',
  month: '精確到月',
  year: '精確到年',
  range: '區間',
  circa: '約略',
  period: '歷史時期',
  unknown: '未知',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  active: '使用中',
  reviewed: '已審閱',
  deprecated: '已停用',
  archived: '已封存',
  ongoing: '進行中',
  concluded: '已結束',
  reported: '報導中',
  scheduled: '預定',
};

export function labelize(map: Record<string, string>, key: string | null | undefined, fallback = '未知'): string {
  if (!key) return fallback;
  return map[key] ?? key;
}
