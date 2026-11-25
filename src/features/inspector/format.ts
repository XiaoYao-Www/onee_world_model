import type { PropValue } from '../../data/types';
import { formatTime } from '../../lib/time';
import { relationLabel } from '../../lib/palette';

export const RELIABILITY_LABELS: Record<string, string> = {
  high: '高可靠性',
  medium: '中可靠性',
  low: '低可靠性',
  very_high: '極高可靠性',
  mixed: '混合',
  primary: '一手來源',
  secondary: '二手來源',
  unknown: '未評估',
};

/** 只有來源真的被評估過才顯示可靠性，避免製造不存在的判斷。 */
export function reliabilityLabel(value?: string | null): string {
  if (!value) return '';
  if (value === 'unknown' || value === 'none') return '';
  return RELIABILITY_LABELS[value] ?? value;
}

export const ARCHIVE_STATUS_LABELS: Record<string, string> = {
  live: '連結可用',
  archived: '已存檔',
  snapshot: '已保存快照',
  partial: '部分存檔',
  restricted: '存檔受限',
  dead: '連結失效',
  paywalled: '需付費',
  none: '未存檔',
  unknown: '未記錄存檔狀態',
};

export function archiveStatusLabel(value?: string | null): string {
  if (!value) return '未記錄存檔狀態';
  return ARCHIVE_STATUS_LABELS[value] ?? value;
}

export const ACCESS_STATUS_LABELS: Record<string, string> = {
  open: '公開可讀',
  partial: '部分可見',
  paywalled: '需付費',
  restricted: '受限',
  removed: '已移除',
  unknown: '未記錄',
};

const PROP_LABELS: Record<string, string> = {
  event_status: '事件狀態',
  role: '角色',
  position: '職位',
  office: '職務',
  party: '政黨',
  headquarters: '總部',
  hq: '總部',
  employees: '員工數',
  revenue: '營收',
  founded: '成立',
  dissolved: '解散／終止',
  website: '網站',
  sector: '產業',
  industry: '產業',
  country: '國家',
  region: '地區',
  population: '人口',
  gdp: 'GDP',
  currency: '貨幣',
  capital: '首都',
  leader: '領導人',
  model: '模型',
  version: '版本',
  license: '授權',
  doi: 'DOI',
  isbn: 'ISBN',
  journal: '期刊',
  authors: '作者',
  methodology: '方法',
  sample_size: '樣本數',
  unit: '單位',
  value: '數值',
  period: '期間',
  strength: '強度',
  confidence: '信心',
  rationale: '理由',
  assumptions: '假設前提',
  entity_type: '實體類型',
  name: '名稱',
  official_names: '官方名稱',
  polity_status: '政治地位',
  territorial_claims: '領土主張',
  parent_organizations: '上級組織',
  birth_place: '出生地',
  nationalities: '國籍',
  place_type: '地點類型',
  admin_level: '行政層級',
  parent_place: '上級地點',
  technology_kind: '技術類別',
  maturity: '成熟度',
  demo_kind: '示範類別',
  event_type: '事件類型',
  indicators: '指標',
  scenario: '情境',
  horizon: '時間跨度',
  ticker: '股票代碼',
  tech_node: '製程節點',
  capacity: '產能',
  market_share: '市佔',
  outcome: '結果',
  cause: '原因',
  impact: '影響',
};

export function propLabel(key: string): string {
  return PROP_LABELS[key] ?? key.replace(/_/g, ' ');
}

export function propText(value: PropValue): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return value.toLocaleString('zh-TW');
  if (Array.isArray(value)) return value.filter((v) => v !== '' && v != null).join('、');
  return String(value);
}

/** 依精度顯示日期（年、年月或完整日期），避免把 2024-04 顯示成解析失敗的原字串。 */
export function formatDate(value?: string | null): string {
  if (!value) return '';
  return formatTime(value);
}

/** 關係類型中文；palette 未收錄的型別才使用本表補充，不改變既有語義。 */
const RELATION_EXTRA: Record<string, string> = {
  about: '關於',
  mentions: '提及',
  authored: '撰寫',
  published: '發表',
  evidence_for: '證據支持',
};

export function relationText(type: string): string {
  const label = relationLabel(type);
  if (label !== type) return label;
  return RELATION_EXTRA[type] ?? type;
}

/** 時間精度用語（與地理精度不同，不可混用）。 */
export const TIME_PRECISION_LABELS: Record<string, string> = {
  exact_day: '日',
  day: '日',
  month: '月',
  year: '年',
  range: '區間',
  circa: '約略',
  period: '期間',
  unknown: '未知',
};

export function timePrecisionText(value?: string | null): string {
  if (!value) return '未記錄';
  return TIME_PRECISION_LABELS[value] ?? value;
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  'zh-TW': '繁體中文',
  'zh-Hant': '繁體中文',
  'zh-CN': '簡體中文',
  'zh-Hans': '簡體中文',
  en: '英文',
  'en-US': '英文',
  'en-GB': '英文',
  ja: '日文',
  ko: '韓文',
  fr: '法文',
  de: '德文',
  ru: '俄文',
  ar: '阿拉伯文',
  es: '西班牙文',
  unknown: '未記錄',
};

export function languageLabel(value?: string | null): string {
  if (!value) return '未記錄';
  return LANGUAGE_LABELS[value] ?? value;
}

export function isExternalUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function confidenceText(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return '';
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}
