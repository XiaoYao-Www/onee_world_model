import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import { kindStyle } from '../../lib/palette';
import {
  SEARCH_LAYER_HINT,
  SEARCH_LAYER_LABELS,
  emptySearchResult,
  searchModel,
  type SearchHit,
  type SearchLayer,
} from '../../lib/search';
import { DERIVED_LAYERS, LAYER_ORDER, groupHitsByLayers } from './suggest';
import './search.css';
const BASE_LIMIT: Record<SearchLayer, number> = {
  name: 20,
  alias: 12,
  text: 12,
  relation: 12,
  graph: 8,
  semantic: 8,
};
const EXAMPLES = ['台積電', '出口管制', 'NVIDIA'];

export default function SearchResults(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const selectedId = useAppStore((s) => s.selectedId);
  const focusNode = useAppStore((s) => s.focusNode);

  const [collapsed, setCollapsed] = useState<Partial<Record<SearchLayer, boolean>>>({});
  const [limits, setLimits] = useState<Record<SearchLayer, number>>({ ...BASE_LIMIT });

  useEffect(() => {
    setLimits({ ...BASE_LIMIT });
  }, [search]);

  const result = useMemo(() => {
    if (!model) return emptySearchResult(search);
    try {
      // 取得本次查詢的完整命中，再由 hits 重新分層，避免依賴任何跨查詢累積的分組狀態。
      return searchModel(model, search, { limit: 5000 });
    } catch {
      return emptySearchResult(search);
    }
  }, [model, search]);

  const grouped = useMemo(() => groupHitsByLayers(result.hits), [result]);

  const maxScore = useMemo(() => {
    let max = 0;
    for (const hit of result.hits) if (hit.score > max) max = hit.score;
    return max || 1;
  }, [result]);

  const total = result.hits.length;
  const query = search.trim();
  const visibleLayers = grouped.map((group) => group.layer);
  const hitsOf = (layer: SearchLayer) => grouped.find((group) => group.layer === layer)?.hits ?? [];

  const clear = () => setSearch('');

  const row = (layer: SearchLayer, hit: SearchHit) => {
    const node = model?.nodeById.get(hit.id);
    const style = kindStyle(node?.kind);
    const isDerived = DERIVED_LAYERS.has(layer);
    const otherLayers = hit.layers.filter((l) => l !== layer);
    const pct = Math.max(4, Math.min(100, Math.round((hit.score / maxScore) * 100)));
    return (
      <button
        type="button"
        key={`${layer}:${hit.id}`}
        className={`sr-item${isDerived ? ' is-derived' : ''}${selectedId === hit.id ? ' is-on' : ''}`}
        aria-label={`${node?.title ?? hit.id}，${SEARCH_LAYER_LABELS[layer]}，${hit.reason || '無命中原因'}`}
        onClick={() => focusNode(hit.id)}
      >
        <span className="sb-dot" style={{ background: style.color, marginTop: 4 }} aria-hidden="true" />
        <span className="sr-item-main">
          <span className="sr-item-title-row">
            <span className="sr-item-title">{node?.title ?? hit.id}</span>
            <span className="sr-kind">{style.label}</span>
          </span>
          <span className="sr-item-reason">
            {hit.reason || SEARCH_LAYER_LABELS[layer]}
            {otherLayers.length > 0 && (
              <>
                {' · '}
                {otherLayers.map((l) => SEARCH_LAYER_LABELS[l]).join('、')}
              </>
            )}
          </span>
          <span className="sr-score" aria-hidden="true">
            <i style={{ width: `${pct}%`, opacity: isDerived ? 0.55 : 1 }} />
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className="sr">
      <div className="sr-head">
        <div className="sr-head-title">
          <Icon name="search" size={14} />
          <span>搜尋結果</span>
          <span className="spacer" />
          {query !== '' && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={clear}>
              <Icon name="close" size={12} />
              清除搜尋
            </button>
          )}
        </div>
        <div className="sr-query">
          {!model
            ? '等待資料載入'
            : query === ''
              ? '輸入查詢詞開始搜尋'
              : `「${query}」共 ${total} 筆命中，依命中層級分組`}
        </div>
      </div>

      <div className="sr-body scroll">
        {!model ? (
          <div className="empty sr-empty">
            <Icon name="info" size={20} />
            <div>
              <strong>尚未載入世界模型資料</strong>
            </div>
            <div className="micro">靜態資料載入完成後，搜尋結果會自動出現在這裡。</div>
          </div>
        ) : query === '' ? (
          <div className="empty sr-empty" style={{ display: 'block', textAlign: 'left', padding: '18px 14px' }}>
            <div className="micro" style={{ marginBottom: 10 }}>
              搜尋範圍包含節點名稱、原文名、別名、摘要與正文；結果會依下列層級分組，並標明每筆的命中原因。
            </div>
            <div className="col" style={{ gap: 6, marginBottom: 12 }}>
              {LAYER_ORDER.map((layer) => (
                <div key={layer} className="row" style={{ gap: 7, alignItems: 'flex-start' }}>
                  <span
                    className={`sb-tag${DERIVED_LAYERS.has(layer) ? ' is-derived' : layer === 'relation' ? ' is-fact' : ''}`}
                    style={{ marginTop: 1 }}
                  >
                    {DERIVED_LAYERS.has(layer) ? '衍生' : layer === 'relation' ? '事實' : '直接'}
                  </span>
                  <span className="micro" style={{ flex: 1 }}>
                    <strong style={{ color: 'var(--text-2)', fontWeight: 550 }}>{SEARCH_LAYER_LABELS[layer]}</strong>
                    ：{SEARCH_LAYER_HINT[layer]}
                  </span>
                </div>
              ))}
            </div>
            <div className="micro" style={{ marginBottom: 6 }}>
              可試試：
            </div>
            <div className="row wrap" style={{ gap: 6 }}>
              {EXAMPLES.map((example) => (
                <button key={example} type="button" className="sb-example" onClick={() => setSearch(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>
        ) : total === 0 ? (
          <div className="empty sr-empty">
            <Icon name="info" size={20} />
            <div>
              <strong>「{query}」沒有符合的節點</strong>
            </div>
            <div className="micro">
              可改用較短的名稱、英文原名或別名再試。搜尋只呈現本體已記錄的資料與明確關係，不自行生成事實。
            </div>
          </div>
        ) : visibleLayers.length === 0 ? (
          <div className="empty sr-empty">
            <div className="micro">查詢詞過短或無有效命中，請增加關鍵字。</div>
          </div>
        ) : (
          <>
            <div className="micro" style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)' }}>
              同一節點可能因多種命中原因出現在多層；「已記錄關係」為本體事實，圖譜鄰近與語意相似僅為衍生線索。
            </div>
            {visibleLayers.map((layer) => {
            const hits = hitsOf(layer);
            const isDerived = DERIVED_LAYERS.has(layer);
            const isCollapsed = !!collapsed[layer];
            const limit = limits[layer] ?? BASE_LIMIT[layer];
            return (
              <section key={layer} className={`sr-group${isDerived ? ' is-derived' : ''}`}>
                <button
                  type="button"
                  className="sr-group-head"
                  aria-expanded={!isCollapsed}
                  title={SEARCH_LAYER_HINT[layer]}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [layer]: !prev[layer] }))}
                >
                  <span
                    aria-hidden="true"
                    style={{ display: 'inline-flex', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s' }}
                  >
                    <Icon name="chevron" size={12} />
                  </span>
                  <span className="sr-group-name">{SEARCH_LAYER_LABELS[layer]}</span>
                  <span className="sr-group-count">{hits.length}</span>
                  <span className="spacer" />
                  <span className={`sb-tag${isDerived ? ' is-derived' : layer === 'relation' ? ' is-fact' : ''}`}>
                    {isDerived ? '衍生' : layer === 'relation' ? '事實關係' : '直接命中'}
                  </span>
                </button>
                {!isCollapsed && (
                  <>
                    {isDerived && (
                      <div className="micro" style={{ padding: '0 14px 6px 30px', color: 'var(--text-3)' }}>
                        衍生結果僅供探索，不代表節點之間存在已記錄的關係。
                      </div>
                    )}
                    {hits.slice(0, limit).map((hit) => row(layer, hit))}
                    {hits.length > limit && (
                      <button
                        type="button"
                        className="sr-more"
                        onClick={() => setLimits((prev) => ({ ...prev, [layer]: (prev[layer] ?? BASE_LIMIT[layer]) + 20 }))}
                      >
                        顯示更多（尚有 {hits.length - limit} 筆）
                      </button>
                    )}
                  </>
                )}
              </section>
            );
            })}
          </>
        )}
      </div>
    </div>
  );
}
