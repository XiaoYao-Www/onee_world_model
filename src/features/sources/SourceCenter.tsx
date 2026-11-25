import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore, type SourceMode } from '../../store/useAppStore';
import type { ModelBundle, WmSource } from '../../data/types';
import { SOURCE_TYPE_LABELS } from '../../lib/palette';
import { formatDate, languageLabel, reliabilityLabel } from '../inspector/format';
import SourceDetail from './SourceDetail';
import { sourceIdsForEntity } from './relatedSources';
import './sources.css';

const MODE_LABELS: Record<SourceMode, string> = {
  news: '近期新聞',
  all: '全部參考資料',
  related: '目前節點相關',
};

function byPublishedDesc(a: WmSource, b: WmSource): number {
  const ta = a.published_at ? Date.parse(a.published_at) : NaN;
  const tb = b.published_at ? Date.parse(b.published_at) : NaN;
  const fa = Number.isFinite(ta);
  const fb = Number.isFinite(tb);
  if (fa && fb && ta !== tb) return tb - ta;
  if (fa && !fb) return -1;
  if (!fa && fb) return 1;
  return a.title.localeCompare(b.title, 'zh-Hant');
}

export default function SourceCenter(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const mode = useAppStore((s) => s.sourceMode);
  const setSourceMode = useAppStore((s) => s.setSourceMode);
  const selectedId = useAppStore((s) => s.selectedId);
  const selectedNode = model && selectedId ? model.nodeById.get(selectedId) : undefined;

  const [typeFilter, setTypeFilter] = useState('');
  const [reliabilityFilter, setReliabilityFilter] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [limit, setLimit] = useState(80);

  useEffect(() => {
    setOpenId(null);
    setLimit(80);
  }, [mode, selectedId]);

  useEffect(() => {
    setLimit(80);
  }, [typeFilter, reliabilityFilter]);

  const modeSources = useMemo(() => {
    if (!model) return [] as WmSource[];
    if (mode === 'related') {
      if (!selectedId) return [] as WmSource[];
      return sourceIdsForEntity(model, selectedId).flatMap((id) => {
        const source = model.sourceById.get(id);
        return source ? [source] : [];
      });
    }
    if (mode === 'news') {
      return model.sources.filter((source) => source.source_type === 'news');
    }
    return model.sources;
  }, [model, mode, selectedId]);

  const sorted = useMemo(() => [...modeSources].sort(byPublishedDesc), [modeSources]);

  const typeOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sorted) counts.set(source.source_type, (counts.get(source.source_type) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: SOURCE_TYPE_LABELS[value] ?? value }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hant'));
  }, [sorted]);

  const reliabilityOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const source of sorted) {
      const label = reliabilityLabel(source.reliability);
      if (!label) continue;
      counts.set(source.reliability, (counts.get(source.reliability) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count, label: reliabilityLabel(value) }))
      .sort((a, b) => b.count - a.count);
  }, [sorted]);

  const filtered = useMemo(
    () =>
      sorted.filter((source) => {
        if (typeFilter && source.source_type !== typeFilter) return false;
        if (reliabilityFilter && source.reliability !== reliabilityFilter) return false;
        return true;
      }),
    [sorted, typeFilter, reliabilityFilter],
  );

  const linkCount = useMemo(() => {
    const map = new Map<string, number>();
    if (!model) return map;
    for (const ids of model.sourcesByNode.values()) {
      for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [model]);

  const openSource = openId ? model?.sourceById.get(openId) ?? null : null;
  const hasFilters = typeFilter !== '' || reliabilityFilter !== '';

  const modeCounts = useMemo(() => {
    if (!model) return { news: 0, all: 0, related: 0 };
    const news = model.sources.filter((source) => source.source_type === 'news').length;
    const related = mode === 'related' && selectedId ? countRelatedSources(model, selectedId) : 0;
    return { news, all: model.sources.length, related };
  }, [model, mode, selectedId]);

  if (openSource && model) {
    return <SourceDetail model={model} source={openSource} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="sc">
      <div className="sc-head">
        <div className="row">
          <Icon name="source" size={14} />
          <span style={{ fontSize: 13, fontWeight: 560 }}>來源中心</span>
          <span className="spacer" />
          <span className="badge">{filtered.length}</span>
        </div>

        <div className="sc-modes" role="group" aria-label="來源顯示模式">
          {(['news', 'all', 'related'] as SourceMode[]).map((value) => (
            <button
              key={value}
              type="button"
              className={`sc-mode${mode === value ? ' is-on' : ''}`}
              aria-pressed={mode === value}
              title={`${MODE_LABELS[value]}（${modeCounts[value]} 筆）`}
              onClick={() => setSourceMode(value)}
            >
              {MODE_LABELS[value]}
            </button>
          ))}
        </div>

        <div className="sc-filters">
          <select
            className="select"
            aria-label="依來源類型過濾"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="">全部類型</option>
            {typeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{option.count}）
              </option>
            ))}
          </select>
          <select
            className="select"
            aria-label="依來源可靠性過濾"
            value={reliabilityFilter}
            onChange={(event) => setReliabilityFilter(event.target.value)}
          >
            <option value="">全部可靠性</option>
            {reliabilityOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}（{option.count}）
              </option>
            ))}
          </select>
        </div>

        <div className="sc-summary">
          <span>
            {mode === 'related'
              ? selectedNode
                ? `與「${selectedNode.title}」相關`
                : '尚未選取節點'
              : MODE_LABELS[mode]}
            {mode !== 'news' || modeSources.length > 0 ? `　共 ${filtered.length} 筆` : ''}
          </span>
          <span className="spacer" />
          {hasFilters && (
            <button
              type="button"
              className="sc-clear"
              onClick={() => {
                setTypeFilter('');
                setReliabilityFilter('');
              }}
            >
              清除篩選
            </button>
          )}
        </div>
      </div>

      <div className="sc-body">
        {!model ? (
          <div className="empty" style={{ padding: '30px 18px' }}>
            <Icon name="info" size={20} />
            <strong>資料尚未載入</strong>
            <div className="micro">來源清單會在靜態資料載入後出現。</div>
          </div>
        ) : mode === 'related' && !selectedId ? (
          <div className="empty" style={{ padding: '30px 18px' }}>
            <Icon name="target" size={20} />
            <strong>尚未選取節點</strong>
            <div className="micro">
              選取節點、事件、主張或證據後，這裡會列出它們引用或被引用的公開來源。
            </div>
          </div>
        ) : modeSources.length === 0 ? (
          <div className="empty" style={{ padding: '30px 18px' }}>
            <Icon name="source" size={20} />
            <strong>{mode === 'news' ? '本體尚無近期新聞來源' : '本體尚無公開來源'}</strong>
            <div className="micro">
              {mode === 'news'
                ? '目前匯出的來源中沒有標記為新聞類型的項目；可切換到「全部參考資料」。'
                : mode === 'related'
                  ? '此節點尚未連結任何公開來源。'
                  : '世界模型尚未匯出可公開的來源資料。'}
            </div>
            {mode === 'news' && (
              <button type="button" className="btn btn-sm" onClick={() => setSourceMode('all')}>
                切換到全部參考資料
              </button>
            )}
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: '30px 18px' }}>
            <Icon name="filter" size={20} />
            <strong>沒有符合篩選條件的來源</strong>
            <div className="micro">目前列表已依類型或可靠性過濾；清除篩選即可看到全部來源。</div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setTypeFilter('');
                setReliabilityFilter('');
              }}
            >
              清除篩選
            </button>
          </div>
        ) : (
          <>
            {filtered.slice(0, limit).map((source) => {
              const reliability = reliabilityLabel(source.reliability);
              const related = linkCount.get(source.id) ?? 0;
              return (
                <button
                  key={source.id}
                  type="button"
                  className={`sc-item${selectedNode && source.related_ids.includes(selectedNode.id) ? ' is-on' : ''}`}
                  onClick={() => setOpenId(source.id)}
                  aria-label={`開啟來源：${source.title}`}
                >
                  <span className="sc-item-title">{source.title}</span>
                  <span className="sc-item-sub">
                    {source.publisher && <span>{source.publisher}</span>}
                    {source.published_at && <span>{formatDate(source.published_at)}</span>}
                    {source.demo && <span className="badge badge-gold">demo</span>}
                  </span>
                  <span className="sc-item-chips">
                    <span className="sc-mini">{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</span>
                    {source.language && <span className="sc-mini">{languageLabel(source.language)}</span>}
                    {reliability && <span className="sc-mini is-rel">{reliability}</span>}
                    {related > 0 && <span className="sc-mini">{related} 個關聯節點</span>}
                  </span>
                </button>
              );
            })}
            {filtered.length > limit && (
              <button type="button" className="sc-more" onClick={() => setLimit((prev) => prev + 100)}>
                顯示更多（尚有 {filtered.length - limit} 筆）
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** 目前節點相關來源數（供模式按鈕 tooltip 使用）。 */
function countRelatedSources(model: ModelBundle, nodeId: string): number {
  return sourceIdsForEntity(model, nodeId).length;
}
