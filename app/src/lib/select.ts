import type { Filters, ModelBundle, WmEdge, WmNode } from '../data/types';

export interface TimeWindow {
  from: number | null;
  to: number | null;
}

/** 節點的時間跨度；未提供時間者回 [null, null]（不因時間篩選被隱藏）。 */
export function nodeSpan(node: WmNode): [number | null, number | null] {
  const toMs = (v?: string | null) => {
    if (!v) return null;
    const s = String(v).trim();
    if (/^-?\d{4}$/.test(s)) return Date.UTC(Number(s), 0, 1);
    if (/^-?\d{4}-\d{1,2}$/.test(s)) {
      const [y, m] = s.split('-');
      return Date.UTC(Number(y), Number(m) - 1, 1);
    }
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  };
  const start = toMs(node.start);
  const end = toMs(node.end);
  if (start == null && end == null) return [null, null];
  // 只有開始時間、沒有結束時間者代表「仍在持續」，結束端保持 null（開放區間），
  // 不可用開始時間代替結束時間，否則 1987 年成立且仍存在的組織會被誤判為已消失。
  return [start ?? end, end];
}

export function inWindow(node: WmNode, w: TimeWindow): boolean {
  const [start, end] = nodeSpan(node);
  if (start == null && end == null) return true;
  if (w.from != null && end != null && end < w.from) return false;
  if (w.to != null && start != null && start > w.to) return false;
  return true;
}

function anyOverlap(arr: string[], wanted: string[]): boolean {
  if (wanted.length === 0) return true;
  return wanted.some((v) => arr.includes(v));
}

function nodeSourceTypes(model: ModelBundle, node: WmNode): string[] {
  const ids = model.sourcesByNode.get(node.id) ?? node.sources;
  return ids.map((id) => model.sourceById.get(id)?.source_type ?? '').filter(Boolean);
}

function nodeReliability(model: ModelBundle, node: WmNode): string[] {
  const ids = model.sourcesByNode.get(node.id) ?? node.sources;
  return ids.map((id) => model.sourceById.get(id)?.reliability ?? '').filter(Boolean);
}

export function matchesFilters(model: ModelBundle, node: WmNode, f: Filters): boolean {
  if (f.hideDemo && node.demo) return false;
  if (f.kinds.length > 0 && !f.kinds.includes(node.kind)) return false;
  if (!anyOverlap(node.domains, f.domains)) return false;
  if (!anyOverlap(node.tags, f.tags)) return false;
  if (f.epistemic.length > 0 && !f.epistemic.includes(node.epistemic_status ?? 'unknown')) return false;
  if (f.eventStatus.length > 0) {
    const st = String(node.props?.event_status ?? node.status ?? '');
    if (!f.eventStatus.includes(st)) return false;
  }
  if (f.geoRoles.length > 0 && !node.geo.some((g) => f.geoRoles.includes(g.role))) return false;
  if (f.sourceTypes.length > 0 && !anyOverlap(nodeSourceTypes(model, node), f.sourceTypes)) return false;
  if (f.reliability.length > 0 && !anyOverlap(nodeReliability(model, node), f.reliability)) return false;
  const sourceCount = (model.sourcesByNode.get(node.id) ?? node.sources).length;
  if (f.minSources > 0 && sourceCount < f.minSources) return false;
  return true;
}

export function filterNodes(
  model: ModelBundle,
  nodes: WmNode[],
  filters: Filters,
  window: TimeWindow,
  allowedIds: Set<string> | null,
): WmNode[] {
  return nodes.filter((n) => {
    if (allowedIds && !allowedIds.has(n.id)) return false;
    if (!inWindow(n, window)) return false;
    return matchesFilters(model, n, filters);
  });
}

export function filterEdges(
  edges: WmEdge[],
  visibleIds: Set<string>,
  filters: Filters,
  window: TimeWindow,
  model: ModelBundle,
): WmEdge[] {
  return edges.filter((e) => {
    if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) return false;
    if (filters.relationTypes.length > 0 && !filters.relationTypes.includes(e.type)) return false;
    if (filters.hideDemo && e.demo) return false;
    const [s, t] = [e.valid_from, e.valid_to];
    if (s || t) {
      const start = s ? Date.parse(s.length === 7 ? `${s}-01` : s) : null;
      const end = t ? Date.parse(t.length === 7 ? `${t}-01` : t) : null;
      if (window.from != null && end != null && end < window.from) return false;
      if (window.to != null && start != null && start > window.to) return false;
    }
    return true;
  });
}

/** 圖譜擴展：以節點為中心取 N-hop 鄰居（只走已存在的關係邊）。 */
export function neighbourhood(model: ModelBundle, id: string, hops = 1): Set<string> {
  const seen = new Set<string>([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h += 1) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const link of model.outLinks.get(cur) ?? []) {
        if (!seen.has(link.id)) {
          seen.add(link.id);
          next.push(link.id);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return seen;
}

/** 相關來源（含直接引用與證據來源）。 */
export function relatedSourceIds(model: ModelBundle, nodeId: string): string[] {
  const set = new Set<string>(model.sourcesByNode.get(nodeId) ?? []);
  for (const evId of model.evidenceByNode.get(nodeId) ?? []) {
    const ev = model.evidenceById.get(evId);
    if (ev?.source_id) set.add(ev.source_id);
  }
  return [...set];
}

export function relatedEvidenceIds(model: ModelBundle, nodeId: string): string[] {
  const set = new Set<string>(model.evidenceByNode.get(nodeId) ?? []);
  for (const claimId of model.claimsByNode.get(nodeId) ?? []) {
    const claim = model.claimById.get(claimId);
    if (!claim) continue;
    for (const evId of claim.supporting) set.add(evId);
    for (const evId of claim.contradicting) set.add(evId);
  }
  return [...set];
}
