import type { ModelBundle } from '../../data/types';
import { relatedSourceIds } from '../../lib/select';

/**
 * 某個節點可公開顯示的來源：
 * 節點直接引用、證據來源，再加上 Claim 自身列出的來源與 Evidence 指向的來源。
 * 只做查詢彙整，不改變本體記錄的語義。
 */
export function sourceIdsForEntity(model: ModelBundle, id: string): string[] {
  const set = new Set<string>(relatedSourceIds(model, id));
  const claim = model.claimById.get(id);
  if (claim) {
    for (const sourceId of claim.sources) if (model.sourceById.has(sourceId)) set.add(sourceId);
  }
  const evidence = model.evidenceById.get(id);
  if (evidence?.source_id && model.sourceById.has(evidence.source_id)) set.add(evidence.source_id);
  return [...set];
}
