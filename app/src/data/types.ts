/**
 * 世界模型網站資料契約（Web adapter 輸出格式）。
 *
 * 這是「本體的投影」，不是世界模型本體的 schema。本體在 Obsidian／FNS；
 * 匯出器（tools/export）讀取本體後產生下列檔案，網站只認這裡定義的形狀。
 * 未知型別、未知欄位都必須被容忍並以通用方式呈現。
 */

export type NodeKind =
  | 'person'
  | 'organization'
  | 'country'
  | 'place'
  | 'technology'
  | 'resource'
  | 'event'
  | 'knowledge'
  | 'claim'
  | 'evidence'
  | 'source'
  | 'hypothesis'
  | 'scenario'
  | 'analysis'
  | 'topic'
  | 'research_question'
  | 'project'
  | 'dataset'
  | 'image_asset'
  | 'timeline'
  | 'unknown';

export type RelativeMotion = 'full' | 'reduced' | 'auto';

export interface GeoRef {
  role: string;
  place_id?: string | null;
  name: string;
  lat: number;
  lon: number;
  precision: string;
  valid_from?: string | null;
  valid_to?: string | null;
  source_ids?: string[];
}

export type PropValue = string | number | boolean | string[] | null;

export interface WmNode {
  id: string;
  kind: NodeKind;
  title: string;
  title_original?: string | null;
  aliases: string[];
  summary: string;
  domains: string[];
  tags: string[];
  status: string;
  epistemic_status?: string | null;
  /** 事件發生／事實開始（ISO 字串，可能只有年月） */
  start?: string | null;
  end?: string | null;
  time_precision?: string | null;
  geo: GeoRef[];
  sources: string[];
  evidence: string[];
  claims: string[];
  confidence?: number | null;
  props: Record<string, PropValue>;
  updated?: string | null;
  demo?: boolean;
  /** 允許公開的短文（來自筆記正文開頭，已由匯出器截斷） */
  body?: string | null;
}

export interface WmEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  direction: 'directed' | 'undirected';
  valid_from?: string | null;
  valid_to?: string | null;
  epistemic_status?: string | null;
  sources: string[];
  evidence: string[];
  weight?: number | null;
  demo?: boolean;
}

export type SourceType =
  | 'news'
  | 'official_document'
  | 'law'
  | 'paper'
  | 'report'
  | 'statistics'
  | 'open_data'
  | 'image'
  | 'video'
  | 'interview'
  | 'social'
  | 'other';

export interface WmSource {
  id: string;
  title: string;
  title_original?: string | null;
  summary: string;
  publisher?: string | null;
  authors: string[];
  url?: string | null;
  published_at?: string | null;
  retrieved_at?: string | null;
  source_type: string;
  language?: string | null;
  license?: string | null;
  archive_status: string;
  reliability: string;
  bias_notes?: string | null;
  access_status?: string | null;
  domains: string[];
  tags: string[];
  related_ids: string[];
  demo?: boolean;
}

export interface WmEvidence {
  id: string;
  source_id: string;
  title: string;
  source_location: string;
  excerpt: string;
  role: string;
  related_claims: string[];
  epistemic_status?: string | null;
  demo?: boolean;
}

export interface WmClaim {
  id: string;
  title: string;
  statement: string;
  epistemic_status: string;
  confidence?: number | null;
  supporting: string[];
  contradicting: string[];
  sources: string[];
  related_entities: string[];
  demo?: boolean;
}

export interface GeoFeature {
  type: 'Feature';
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'LineString'; coordinates: [number, number][] }
    | { type: 'Polygon'; coordinates: [number, number][][] };
  properties: {
    node_id: string;
    role: string;
    name: string;
    precision: string;
    kind: string;
    title: string;
    valid_from?: string | null;
    valid_to?: string | null;
    demo?: boolean;
    source_ids?: string[];
  };
}

export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface ModelMeta {
  data_version: string;
  model_version: string;
  generated_at: string;
  counts: {
    nodes: number;
    edges: number;
    sources: number;
    evidence: number;
    claims: number;
    geo_features: number;
    demo_nodes: number;
  };
  kinds: string[];
  disciplines: string[];
  tags: string[];
  source_types: string[];
  relation_types: string[];
  time_range: [string | null, string | null];
  has_demo: boolean;
  notes: string[];
}

export interface SearchDoc {
  id: string;
  kind: string;
  title: string;
  aliases: string[];
  len: number;
  /** [term, tf] 清單 */
  tf: [string, number][];
  /** int8 量化向量（base64） */
  vec: string;
}

export interface SearchIndex {
  model: string;
  dim: number;
  n: number;
  avgdl: number;
  df: Record<string, number>;
  docs: SearchDoc[];
}

export interface ModelBundle {
  meta: ModelMeta;
  nodes: WmNode[];
  edges: WmEdge[];
  sources: WmSource[];
  evidence: WmEvidence[];
  claims: WmClaim[];
  geo: GeoCollection;
  search: SearchIndex;
  nodeById: Map<string, WmNode>;
  sourceById: Map<string, WmSource>;
  evidenceById: Map<string, WmEvidence>;
  claimById: Map<string, WmClaim>;
  /** node id -> 相關 edges */
  edgesByNode: Map<string, WmEdge[]>;
  /** node id -> 引用它的 sources */
  sourcesByNode: Map<string, string[]>;
  /** node id -> 引用它的 evidence */
  evidenceByNode: Map<string, string[]>;
  /** node id -> 相關 claims */
  claimsByNode: Map<string, string[]>;
  outLinks: Map<string, { id: string; type: string; label: string; direction: 'out' | 'in' }[]>;
}

export type ViewMode = 'universe' | 'map' | 'timeline' | 'browse';

export interface Filters {
  kinds: string[];
  domains: string[];
  tags: string[];
  sourceTypes: string[];
  epistemic: string[];
  relationTypes: string[];
  eventStatus: string[];
  geoRoles: string[];
  reliability: string[];
  minSources: number;
  hideDemo: boolean;
}

export const EMPTY_FILTERS: Filters = {
  kinds: [],
  domains: [],
  tags: [],
  sourceTypes: [],
  epistemic: [],
  relationTypes: [],
  eventStatus: [],
  geoRoles: [],
  reliability: [],
  minSources: 0,
  hideDemo: false,
};
