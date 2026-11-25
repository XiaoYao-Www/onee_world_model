import type { ModelBundle, SearchDoc, SearchIndex } from '../data/types';
import { cosine, decodeVector, fnv1a, tokenize } from './tokens';

/**
 * 檢索分層（對應產品規格的 7 層呈現）：
 * 1 名稱直接命中、2 別名／原文名、3 正文全文（BM25）、4 已記錄關係、
 * 5 圖譜多跳鄰近、6 語意相似（雜湊 n-gram 向量）、7 推論／待驗證。
 * 只有第 4 層以後的「關係」才可能來自本體明確記錄；5、6、7 一律標為衍生／推薦。
 */
export type SearchLayer = 'name' | 'alias' | 'text' | 'relation' | 'graph' | 'semantic';

export const SEARCH_LAYER_LABELS: Record<SearchLayer, string> = {
  name: '名稱直接命中',
  alias: '別名與原文名',
  text: '正文與摘要',
  relation: '已記錄關係',
  graph: '圖譜鄰近',
  semantic: '語意相似',
};

export const SEARCH_LAYER_HINT: Record<SearchLayer, string> = {
  name: '標題或繁中名稱完全／部分符合。',
  alias: '別名、原文名、縮寫或歷史名稱符合。',
  text: '摘要與正文的關鍵詞符合（BM25 全文檢索）。',
  relation: '本體明確記錄的關係；可視為事實連結。',
  graph: '經由已記錄關係多跳可達，屬檢索路徑而非事實。',
  semantic: '雜湊向量相似度，僅供探索，不代表關係。',
};

export interface SearchHit {
  id: string;
  score: number;
  layers: SearchLayer[];
  reason: string;
}

export interface SearchResult {
  query: string;
  tokens: string[];
  hits: SearchHit[];
  groups: Record<SearchLayer, SearchHit[]>;
}

function emptyGroups(): Record<SearchLayer, SearchHit[]> {
  return { name: [], alias: [], text: [], relation: [], graph: [], semantic: [] };
}

export function emptySearchResult(q = ''): SearchResult {
  return { query: q, tokens: [], hits: [], groups: emptyGroups() };
}

const idfCache = new WeakMap<SearchIndex, Map<string, number>>();

function idfMap(index: SearchIndex): Map<string, number> {
  const cached = idfCache.get(index);
  if (cached) return cached;
  const map = new Map<string, number>();
  const n = Math.max(index.n, 1);
  for (const [term, df] of Object.entries(index.df)) {
    map.set(term, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }
  idfCache.set(index, map);
  return map;
}

function idfOf(map: Map<string, number>, index: SearchIndex, term: string): number {
  const v = map.get(term);
  if (v != null) return v;
  return Math.log(1 + (index.n + 0.5) / 0.5);
}

const vectorCache = new WeakMap<SearchDoc, Float32Array>();
function docVector(doc: SearchDoc): Float32Array {
  let v = vectorCache.get(doc);
  if (!v) {
    v = decodeVector(doc.vec);
    vectorCache.set(doc, v);
  }
  return v;
}

function quantize(vec: Float32Array): string {
  const bytes = new Uint8Array(vec.length);
  for (let i = 0; i < vec.length; i += 1) {
    const q = Math.max(-127, Math.min(127, Math.round(vec[i] * 127)));
    bytes[i] = q < 0 ? q + 256 : q;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** 與匯出器相同的雜湊 n-gram 向量（提供查詢端推論，不需外部模型）。 */
export function buildQueryVector(index: SearchIndex, tokens: string[]): Float32Array {
  const dim = index.dim || 128;
  const idf = idfMap(index);
  const acc = new Float32Array(dim);
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    const h = fnv1a(token);
    const idx = h % dim;
    const sign = ((h >>> 16) & 1) === 0 ? 1 : -1;
    acc[idx] += sign * idfOf(idf, index, token);
  }
  let norm = 0;
  for (let i = 0; i < dim; i += 1) norm += acc[i] * acc[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i += 1) acc[i] /= norm;
  return acc;
}

const BM25_K1 = 1.2;
const BM25_B = 0.75;

interface Candidate {
  id: string;
  score: number;
  layers: Set<SearchLayer>;
  reasons: string[];
}

function addCandidate(map: Map<string, Candidate>, id: string, layer: SearchLayer, score: number, reason: string) {
  let c = map.get(id);
  if (!c) {
    c = { id, score: 0, layers: new Set(), reasons: [] };
    map.set(id, c);
  }
  c.score += score;
  if (!c.layers.has(layer)) {
    c.layers.add(layer);
    c.reasons.push(reason);
  } else {
    c.score += score * 0.15;
  }
}

export interface SearchOptions {
  limit?: number;
  expand?: boolean;
}

export function searchModel(model: ModelBundle, rawQuery: string, options: SearchOptions = {}): SearchResult {
  const query = rawQuery.trim();
  if (query.length === 0) return emptySearchResult(query);
  const index = model.search;
  if (!index || index.n === 0) {
    // 沒有索引時退回標題／別名比對，功能不可整站失效。
    const lower = query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const node of model.nodes) {
      const title = node.title.toLowerCase();
      if (title.includes(lower) || node.aliases.some((a) => a.toLowerCase().includes(lower))) {
        hits.push({ id: node.id, score: 50, layers: ['name'], reason: '標題或別名符合' });
      }
    }
    return {
      query,
      tokens: tokenize(query),
      hits: hits.slice(0, options.limit ?? 80),
      groups: { ...emptyGroups(), name: hits.slice(0, options.limit ?? 80) },
    };
  }

  const tokens = tokenize(query);
  const queryVector = tokens.length > 0 ? buildQueryVector(index, tokens) : null;
  const idf = idfMap(index);
  const docById = new Map(index.docs.map((d) => [d.id, d]));
  const candidates = new Map<string, Candidate>();
  const lower = query.toLowerCase();
  const idfSum = tokens.reduce((acc, t) => acc + idfOf(idf, index, t), 0) || 1;

  for (const doc of index.docs) {
    if (!model.nodeById.has(doc.id)) continue;
    const title = doc.title.toLowerCase();
    if (title === lower) addCandidate(candidates, doc.id, 'name', 120, '名稱完全符合');
    else if (title.includes(lower)) addCandidate(candidates, doc.id, 'name', 90, '名稱包含查詢字串');
    else if (tokens.length > 0 && tokens.every((t) => title.includes(t))) {
      addCandidate(candidates, doc.id, 'name', 60, '名稱涵蓋所有查詢詞');
    }

    for (const alias of doc.aliases) {
      const al = alias.toLowerCase();
      if (al.includes(lower) || (tokens.length > 0 && tokens.every((t) => al.includes(t)))) {
        addCandidate(candidates, doc.id, 'alias', 55, `別名「${alias}」符合`);
        break;
      }
    }

    let bm25 = 0;
    let matched = 0;
    for (const [term, tf] of doc.tf) {
      const qtf = tokens.filter((t) => t === term).length;
      if (qtf === 0) continue;
      matched += 1;
      const denom = tf + BM25_K1 * (1 - BM25_B + (BM25_B * doc.len) / (index.avgdl || 1));
      bm25 += idfOf(idf, index, term) * ((tf * (BM25_K1 + 1)) / denom) * qtf;
    }
    if (bm25 > 0) {
      const coverage = matched / Math.max(new Set(tokens).size, 1);
      addCandidate(
        candidates,
        doc.id,
        'text',
        Math.min(70, bm25 * 6) * (0.4 + 0.6 * coverage),
        `正文命中 ${matched} 個查詢詞`,
      );
    }

    if (queryVector) {
      const sim = cosine(queryVector, docVector(doc));
      if (sim > 0.32) {
        addCandidate(candidates, doc.id, 'semantic', sim * 26, `語意相似度 ${(sim * 100).toFixed(0)}%`);
      }
    }
    void idfSum;
  }

  if (options.expand !== false) {
    const seeds = [...candidates.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    for (const seed of seeds) {
      for (const link of model.outLinks.get(seed.id) ?? []) {
        const rel = model.nodeById.get(link.id);
        if (!rel) continue;
        addCandidate(
          candidates,
          link.id,
          'relation',
          18,
          `與「${model.nodeById.get(seed.id)?.title ?? seed.id}」有「${link.label}」關係`,
        );
      }
    }
    const firstHop = [...candidates.values()].filter((c) => c.layers.size > 0).slice(0, 40);
    for (const node of firstHop.slice(0, 8)) {
      for (const link of model.outLinks.get(node.id) ?? []) {
        if (candidates.get(link.id)?.layers.size) continue;
        addCandidate(candidates, link.id, 'graph', 6, '與命中節點相隔一跳');
      }
    }
  }

  const order: SearchLayer[] = ['name', 'alias', 'text', 'relation', 'graph', 'semantic'];
  const weight: Record<SearchLayer, number> = {
    name: 3,
    alias: 2.4,
    text: 1.6,
    relation: 1.2,
    graph: 0.7,
    semantic: 0.9,
  };
  const hits: SearchHit[] = [...candidates.values()]
    .map((c) => {
      let bonus = 0;
      for (const l of c.layers) bonus += weight[l];
      return {
        id: c.id,
        score: c.score * (1 + bonus / 6),
        layers: order.filter((l) => c.layers.has(l)),
        reason: c.reasons[0] ?? '',
      };
    })
    .sort((a, b) => b.score - a.score);

  const groups: Record<SearchLayer, SearchHit[]> = emptyGroups();
  for (const hit of hits) {
    for (const layer of hit.layers) groups[layer].push(hit);
  }

  const limit = options.limit ?? 80;
  return { query, tokens, hits: hits.slice(0, limit), groups };
}

export function similarNodes(model: ModelBundle, id: string, limit = 8): { id: string; score: number }[] {
  const index = model.search;
  const target = index.docs.find((d) => d.id === id);
  if (!target) return [];
  const tv = docVector(target);
  const out: { id: string; score: number }[] = [];
  for (const doc of index.docs) {
    if (doc.id === id) continue;
    const score = cosine(tv, docVector(doc));
    if (score > 0.25) out.push({ id: doc.id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit);
}

export function encodeVectorForTest(vec: Float32Array): string {
  return quantize(vec);
}
