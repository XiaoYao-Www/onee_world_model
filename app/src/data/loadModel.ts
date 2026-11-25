import type {
  GeoCollection,
  ModelBundle,
  ModelMeta,
  SearchIndex,
  WmClaim,
  WmEdge,
  WmEvidence,
  WmNode,
  WmSource,
} from './types';

const BASE = import.meta.env.BASE_URL ?? '/';

async function getJson<T>(file: string): Promise<T> {
  const url = `${BASE}model-data/${file}`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`無法載入 ${file}（HTTP ${res.status}）`);
  return (await res.json()) as T;
}

async function getJsonOptional<T>(file: string, fallback: T): Promise<T> {
  try {
    return await getJson<T>(file);
  } catch {
    return fallback;
  }
}

function indexBundle(
  meta: ModelMeta,
  nodes: WmNode[],
  edges: WmEdge[],
  sources: WmSource[],
  evidence: WmEvidence[],
  claims: WmClaim[],
  geo: GeoCollection,
  search: SearchIndex,
): ModelBundle {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const edgesByNode = new Map<string, WmEdge[]>();
  const sourcesByNode = new Map<string, string[]>();
  const evidenceByNode = new Map<string, string[]>();
  const claimsByNode = new Map<string, string[]>();
  const outLinks = new Map<string, { id: string; type: string; label: string; direction: 'out' | 'in' }[]>();

  const push = <V>(map: Map<string, V[]>, key: string, value: V) => {
    const arr = map.get(key);
    if (arr) {
      if (!arr.includes(value)) arr.push(value);
    } else map.set(key, [value]);
  };

  for (const e of edges) {
    if (!nodeById.has(e.source) || !nodeById.has(e.target)) continue;
    push(edgesByNode, e.source, e);
    push(edgesByNode, e.target, e);
    push(outLinks, e.source, { id: e.target, type: e.type, label: e.label, direction: 'out' });
    push(outLinks, e.target, { id: e.source, type: e.type, label: e.label, direction: 'in' });
  }
  for (const n of nodes) {
    for (const sid of n.sources) if (sourceById.has(sid)) push(sourcesByNode, n.id, sid);
    for (const eid of n.evidence) if (evidenceById.has(eid)) push(evidenceByNode, n.id, eid);
    for (const cid of n.claims) {
      if (claimById.has(cid)) push(claimsByNode, n.id, cid);
    }
  }
  for (const c of claims) {
    for (const id of c.related_entities) if (nodeById.has(id)) push(claimsByNode, id, c.id);
  }
  for (const s of sources) {
    for (const id of s.related_ids) if (nodeById.has(id)) push(sourcesByNode, id, s.id);
  }

  return {
    meta,
    nodes,
    edges,
    sources,
    evidence,
    claims,
    geo,
    search,
    nodeById,
    sourceById,
    evidenceById,
    claimById,
    edgesByNode,
    sourcesByNode,
    evidenceByNode,
    claimsByNode,
    outLinks,
  };
}

export async function loadModel(): Promise<ModelBundle> {
  const meta = await getJson<ModelMeta>('meta.json');
  const [nodes, edges, sources, evidence, claims, geo, search] = await Promise.all([
    getJson<WmNode[]>('nodes.json'),
    getJson<WmEdge[]>('edges.json'),
    getJson<WmSource[]>('sources.json'),
    getJsonOptional<WmEvidence[]>('evidence.json', []),
    getJsonOptional<WmClaim[]>('claims.json', []),
    getJsonOptional<GeoCollection>('geo.json', { type: 'FeatureCollection', features: [] }),
    getJsonOptional<SearchIndex>('search-index.json', {
      model: 'none',
      dim: 128,
      n: 0,
      avgdl: 1,
      df: {},
      docs: [],
    }),
  ]);
  return indexBundle(meta, nodes, edges, sources, evidence, claims, geo, search);
}
