import type { SearchHit, SearchLayer, SearchResult } from '../../lib/search';

/** 搜尋分層順序：事實層在前，衍生／檢索推薦在後。 */
export const LAYER_ORDER: SearchLayer[] = ['name', 'alias', 'text', 'relation', 'graph', 'semantic'];

/** 只有這幾層是「衍生／檢索推薦」，不可與已記錄的事實關係混淆。 */
export const DERIVED_LAYERS: ReadonlySet<SearchLayer> = new Set<SearchLayer>(['graph', 'semantic']);

export const GROUP_SLICE: Record<SearchLayer, number> = {
  name: 3,
  alias: 2,
  text: 2,
  relation: 2,
  graph: 1,
  semantic: 1,
};

export interface Suggestion {
  hit: SearchHit;
  layer: SearchLayer;
}

/** 該筆命中最強（最前面）的層級；search.ts 已依名稱→別名→正文→關係→圖譜→語意排序。 */
export function strongestLayer(hit: SearchHit): SearchLayer {
  return hit.layers[0] ?? 'text';
}

/**
 * 依「最強命中層」分組。直接由本次查詢的 hits 重新分組，
 * 不依賴 SearchResult.groups，避免任何跨查詢累積或重複。
 */
export function groupHitsByStrongest(hits: SearchHit[]): { layer: SearchLayer; hits: SearchHit[] }[] {
  const buckets = new Map<SearchLayer, SearchHit[]>();
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    const layer = strongestLayer(hit);
    const list = buckets.get(layer);
    if (list) list.push(hit);
    else buckets.set(layer, [hit]);
  }
  return LAYER_ORDER.filter((layer) => (buckets.get(layer)?.length ?? 0) > 0).map((layer) => ({
    layer,
    hits: buckets.get(layer) as SearchHit[],
  }));
}

/**
 * 依「命中的每一層」分組（左側完整結果用）：同一節點可能因多種原因出現在多層，
 * 但同一層內不重複。資料一律取自本次查詢的 hits，不依賴任何累積狀態。
 */
export function groupHitsByLayers(hits: SearchHit[]): { layer: SearchLayer; hits: SearchHit[] }[] {
  const unique: SearchHit[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.id)) continue;
    seen.add(hit.id);
    unique.push(hit);
  }
  return LAYER_ORDER.map((layer) => ({ layer, hits: unique.filter((hit) => hit.layers.includes(layer)) })).filter(
    (group) => group.hits.length > 0,
  );
}

/**
 * 組出下拉建議：每筆節點只出現在它最強的一層，避免同一節點在多層重複洗版；
 * 該筆的其他命中層仍會以標記呈現。
 */
export function buildSuggestions(result: SearchResult | null): { layer: SearchLayer; items: Suggestion[] }[] {
  if (!result) return [];
  const grouped = groupHitsByStrongest(result.hits);
  return grouped.map(({ layer, hits }) => ({
    layer,
    items: hits.slice(0, GROUP_SLICE[layer]).map((hit) => ({ hit, layer })),
  }));
}

export function flattenSuggestions(groups: { layer: SearchLayer; items: Suggestion[] }[]): Suggestion[] {
  return groups.flatMap((group) => group.items);
}
