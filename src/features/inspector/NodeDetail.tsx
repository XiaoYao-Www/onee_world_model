import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import type { ModelBundle, WmEdge, WmNode } from '../../data/types';
import {
  EPISTEMIC_LABELS,
  EVIDENCE_ROLE_LABELS,
  GEO_ROLE_LABELS,
  PRECISION_LABELS,
  SOURCE_TYPE_LABELS,
  STATUS_LABELS,
  kindStyle,
} from '../../lib/palette';
import { formatRange } from '../../lib/time';
import { relatedEvidenceIds } from '../../lib/select';
import { sourceIdsForEntity } from '../sources/relatedSources';
import { similarNodes } from '../../lib/search';
import {
  confidenceText,
  formatDate,
  isExternalUrl,
  propLabel,
  propText,
  relationText,
  reliabilityLabel,
  timePrecisionText,
} from './format';
import './inspector.css';

interface Props {
  model: ModelBundle;
  node: WmNode;
}

interface RelItem {
  edge: WmEdge;
  other: WmNode;
  outgoing: boolean;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).trimEnd()}…`;
}

export default function NodeDetail({ model, node }: Props): JSX.Element {
  const focusNode = useAppStore((s) => s.focusNode);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [allSources, setAllSources] = useState(false);
  const [allProps, setAllProps] = useState(false);

  useEffect(() => {
    setBodyOpen(false);
    setAllSources(false);
    setAllProps(false);
  }, [node.id]);

  const style = kindStyle(node.kind);

  const relGroups = useMemo(() => {
    const byType = new Map<string, RelItem[]>();
    for (const edge of model.edgesByNode.get(node.id) ?? []) {
      const outgoing = edge.source === node.id;
      const otherId = outgoing ? edge.target : edge.source;
      const other = model.nodeById.get(otherId);
      if (!other) continue;
      const list = byType.get(edge.type);
      if (list) list.push({ edge, other, outgoing });
      else byType.set(edge.type, [{ edge, other, outgoing }]);
    }
    return [...byType.entries()]
      .map(([type, items]) => ({ type, items }))
      .sort((a, b) => b.items.length - a.items.length || a.type.localeCompare(b.type));
  }, [model, node.id]);

  const relationCount = relGroups.reduce((acc, group) => acc + group.items.length, 0);

  const sources = useMemo(() => {
    const list = sourceIdsForEntity(model, node.id).flatMap((id) => {
      const source = model.sourceById.get(id);
      return source ? [source] : [];
    });
    return list.sort((a, b) => {
      const ta = a.published_at ? Date.parse(a.published_at) : NaN;
      const tb = b.published_at ? Date.parse(b.published_at) : NaN;
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      if (Number.isFinite(tb) && !Number.isFinite(ta)) return 1;
      if (!Number.isFinite(tb) && Number.isFinite(ta)) return -1;
      return a.title.localeCompare(b.title, 'zh-Hant');
    });
  }, [model, node.id]);

  const evidence = useMemo(() => {
    const ids = relatedEvidenceIds(model, node.id);
    if (model.evidenceById.has(node.id)) ids.unshift(node.id);
    return ids.flatMap((id) => {
      const item = model.evidenceById.get(id);
      return item ? [item] : [];
    });
  }, [model, node.id]);

  const claims = useMemo(() => {
    const seen = new Set<string>();
    const ids = model.claimById.has(node.id) ? [node.id, ...(model.claimsByNode.get(node.id) ?? [])] : model.claimsByNode.get(node.id) ?? [];
    return ids.flatMap((id) => {
      if (seen.has(id)) return [];
      seen.add(id);
      const claim = model.claimById.get(id);
      return claim ? [claim] : [];
    });
  }, [model, node.id]);

  const similar = useMemo(() => {
    try {
      return similarNodes(model, node.id, 6);
    } catch {
      return [];
    }
  }, [model, node.id]);

  const propEntries = useMemo(
    () =>
      Object.entries(node.props ?? {}).filter(([key, value]) => {
        if (key.startsWith('_')) return false;
        return propText(value).trim() !== '';
      }),
    [node],
  );

  const shownProps = allProps ? propEntries : propEntries.slice(0, 12);
  const epistemicLabel = EPISTEMIC_LABELS[node.epistemic_status ?? ''] ?? node.epistemic_status ?? '';
  const statusLabel = STATUS_LABELS[node.status] ?? node.status ?? '';
  const confidence = confidenceText(node.confidence);
  const bodyText = node.body ?? '';

  return (
    <div className="insp">
      <header className="insp-head">
        <div className="insp-kindline">
          <span className="insp-kind">
            <span className="dot" style={{ background: style.color, width: 8, height: 8, borderRadius: '50%' }} aria-hidden="true" />
            {style.label}
          </span>
          {statusLabel && <span className="badge">{statusLabel}</span>}
          {epistemicLabel && (
            <span
              className={`badge ${
                node.epistemic_status === 'verified_fact'
                  ? 'badge-ok'
                  : node.epistemic_status === 'disputed'
                    ? 'badge-danger'
                    : 'badge-accent'
              }`}
            >
              {epistemicLabel}
            </span>
          )}
          {node.demo && <span className="badge badge-gold">示範資料</span>}
        </div>
        <h2 className="inspector-title" style={{ margin: '6px 0 0' }}>
          {node.title}
        </h2>
        {node.title_original && <div className="insp-original">{node.title_original}</div>}
        {node.aliases.length > 0 && <div className="insp-aliases">別名：{node.aliases.join('、')}</div>}
        {node.summary && <p className="insp-summary">{node.summary}</p>}
        {node.demo && (
          <div className="insp-demo">
            此節點標記為示範資料（demo），僅用於呈現資料形狀與介面行為，不屬於正式公開的世界模型內容。
          </div>
        )}
      </header>

      <div className="insp-scroll">
        <div className="insp-body">
          <div className="block-title" style={{ marginTop: 10 }}>
            基本資料
          </div>
          <div className="prop-grid">
            <span className="prop-key">型別</span>
            <span className="prop-val">{style.label}</span>
            <span className="prop-key">學科</span>
            <span className="prop-val">{node.domains.length > 0 ? node.domains.join('、') : '—'}</span>
            <span className="prop-key">標籤</span>
            <span className="prop-val">{node.tags.length > 0 ? node.tags.join('、') : '—'}</span>
            <span className="prop-key">狀態</span>
            <span className="prop-val">{statusLabel || '未記錄'}</span>
            <span className="prop-key">證據狀態</span>
            <span className="prop-val">{epistemicLabel || '未記錄'}</span>
            {confidence && (
              <>
                <span className="prop-key">信心</span>
                <span className="prop-val">{confidence}</span>
              </>
            )}
            <span className="prop-key">來源</span>
            <span className="prop-val">{sources.length} 筆</span>
            <span className="prop-key">證據</span>
            <span className="prop-val">{evidence.length} 筆</span>
            <span className="prop-key">主張</span>
            <span className="prop-val">{claims.length} 筆</span>
            <span className="prop-key">明確關係</span>
            <span className="prop-val">{relationCount} 條</span>
            <span className="prop-key">最近更新</span>
            <span className="prop-val">{node.updated ? formatDate(node.updated) : '未記錄'}</span>
          </div>

          <div className="block-title">時間</div>
          <div className="prop-grid">
            <span className="prop-key">期間</span>
            <span className="prop-val">{formatRange(node.start, node.end, node.time_precision)}</span>
            <span className="prop-key">精度</span>
            <span className="prop-val">{timePrecisionText(node.time_precision)}</span>
          </div>
          {!node.start && !node.end && (
            <div className="insp-note">本體未記錄此節點的時間；不以推測值填補，因此在時間篩選中不會被隱藏。</div>
          )}

          <div className="block-title">地理</div>
          {node.geo.length === 0 ? (
            <div className="insp-note">未記錄地理資訊。</div>
          ) : (
            <div className="col" style={{ gap: 9 }}>
              {node.geo.map((geo, index) => (
                <div className="prop-grid" key={`${geo.role}:${geo.name}:${index}`}>
                  <span className="prop-key">角色</span>
                  <span className="prop-val">{GEO_ROLE_LABELS[geo.role] ?? geo.role}</span>
                  <span className="prop-key">地點</span>
                  <span className="prop-val">{geo.name || geo.place_id || '未命名'}</span>
                  <span className="prop-key">精度</span>
                  <span className="prop-val">
                    {geo.precision ? PRECISION_LABELS[geo.precision] ?? geo.precision : '未記錄'}
                  </span>
                  {(geo.valid_from || geo.valid_to) && (
                    <>
                      <span className="prop-key">有效期間</span>
                      <span className="prop-val">{formatRange(geo.valid_from, geo.valid_to)}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {propEntries.length > 0 && (
            <>
              <div className="block-title">主要 Properties</div>
              <div className="prop-grid">
                {shownProps.map(([key, value]) => {
                  const text = propText(value);
                  if (isExternalUrl(text)) {
                    return (
                      <span key={key} style={{ display: 'contents' }}>
                        <span className="prop-key">{propLabel(key)}</span>
                        <span className="prop-val">
                          <a href={text} target="_blank" rel="noopener noreferrer">
                            {clip(text, 60)}
                          </a>
                        </span>
                      </span>
                    );
                  }
                  return (
                    <span key={key} style={{ display: 'contents' }}>
                      <span className="prop-key">{propLabel(key)}</span>
                      <span className="prop-val" title={text.length > 80 ? text : undefined}>
                        {clip(text, 180)}
                      </span>
                    </span>
                  );
                })}
              </div>
              {propEntries.length > 12 && (
                <button type="button" className="insp-longtoggle" onClick={() => setAllProps((prev) => !prev)}>
                  {allProps ? '收合其餘 Properties' : `顯示其餘 ${propEntries.length - 12} 項 Properties`}
                </button>
              )}
            </>
          )}

          <div className="block-title">明確關係</div>
          {relGroups.length === 0 ? (
            <div className="insp-note">本體未記錄此節點的明確關係。圖譜鄰近與語意相似不算關係。</div>
          ) : (
            relGroups.map((group) => (
              <div className="rel-group" key={group.type}>
                <div className="rel-group-head">
                  <span>{relationText(group.type)}</span>
                  <span className="rel-count">{group.items.length}</span>
                  <span className="spacer" />
                  <span className="mono" style={{ fontSize: 9, opacity: 0.7 }}>
                    {group.type}
                  </span>
                </div>
                {group.items.map((item) => {
                  const arrow =
                    item.edge.direction === 'undirected' ? '↔' : item.outgoing ? '→' : '←';
                  const edgeLabel = EPISTEMIC_LABELS[item.edge.epistemic_status ?? ''] ?? '';
                  const period = item.edge.valid_from || item.edge.valid_to
                    ? formatRange(item.edge.valid_from, item.edge.valid_to)
                    : '';
                  return (
                    <button
                      type="button"
                      key={item.edge.id}
                      className="rel-row"
                      title={`${relationText(group.type)}：${item.other.title}${period ? `（${period}）` : ''}`}
                      onClick={() => focusNode(item.other.id)}
                    >
                      <span className="rel-arrow" aria-hidden="true">
                        {arrow}
                      </span>
                      <span className="rel-other">{item.other.title}</span>
                      {item.edge.demo && <span className="badge badge-gold">demo</span>}
                      {period && <span className="rel-time">{clip(period, 26)}</span>}
                      {edgeLabel && item.edge.epistemic_status !== 'verified_fact' && (
                        <span className="badge">{edgeLabel}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}

          <div className="block-title">相關來源</div>
          {sources.length === 0 ? (
            <div className="insp-note">此節點尚無公開來源。</div>
          ) : (
            <>
              {(allSources ? sources : sources.slice(0, 6)).map((source) => {
                const reliability = reliabilityLabel(source.reliability);
                return (
                  <div className="insp-src" key={source.id}>
                    <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                      <span className="insp-src-title" style={{ flex: 1 }}>
                        {source.title}
                      </span>
                      {source.url && isExternalUrl(source.url) && (
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="icon-btn"
                          style={{ width: 22, height: 22 }}
                          aria-label={`開啟原始來源：${source.title}`}
                          title="在新視窗開啟原始來源"
                        >
                          <Icon name="external" size={12} />
                        </a>
                      )}
                    </div>
                    <div className="insp-src-sub">
                      {source.publisher && <span>{source.publisher}</span>}
                      {source.published_at && <span>{formatDate(source.published_at)}</span>}
                      <span>{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</span>
                      {reliability && <span className="badge badge-ok">{reliability}</span>}
                      {source.demo && <span className="badge badge-gold">demo</span>}
                    </div>
                  </div>
                );
              })}
              {sources.length > 6 && (
                <button type="button" className="insp-longtoggle" onClick={() => setAllSources((prev) => !prev)}>
                  {allSources ? '收合來源' : `顯示全部 ${sources.length} 筆來源`}
                </button>
              )}
            </>
          )}

          <div className="block-title">證據</div>
          {evidence.length === 0 ? (
            <div className="insp-note">此節點尚無公開證據摘錄。</div>
          ) : (
            evidence.map((item) => {
              const role = EVIDENCE_ROLE_LABELS[item.role] ?? item.role;
              const source = model.sourceById.get(item.source_id);
              const tone =
                item.role === 'contradicts' ? ' is-contra' : item.role === 'supports' ? ' is-support' : '';
              return (
                <div className={`insp-entry${tone}`} key={item.id}>
                  <div className="insp-entry-title">{item.title || source?.title || '證據摘錄'}</div>
                  {item.excerpt && <div className="insp-quote">{item.excerpt}</div>}
                  <div className="insp-entry-sub">
                    <span className="badge">{role}</span>
                    {source && <span>{source.title}</span>}
                    {item.source_location && <span className="mono">{item.source_location}</span>}
                    {item.demo && <span className="badge badge-gold">demo</span>}
                  </div>
                </div>
              );
            })
          )}

          <div className="block-title">主張</div>
          {claims.length === 0 ? (
            <div className="insp-note">此節點尚未連結任何公開主張。</div>
          ) : (
            claims.map((claim) => {
              const conf = confidenceText(claim.confidence);
              return (
                <div className="insp-entry" key={claim.id}>
                  <div className="insp-entry-title">{claim.title || claim.statement}</div>
                  {claim.title && claim.statement && claim.statement !== claim.title && (
                    <div className="insp-quote">{claim.statement}</div>
                  )}
                  <div className="insp-entry-sub">
                    <span className="badge">{EPISTEMIC_LABELS[claim.epistemic_status] ?? claim.epistemic_status}</span>
                    <span className="badge badge-ok">支持 {claim.supporting.length}</span>
                    <span className="badge badge-danger">反駁 {claim.contradicting.length}</span>
                    {conf && <span className="badge">信心 {conf}</span>}
                  </div>
                </div>
              );
            })
          )}

          <div className="block-title">語意相似（衍生）</div>
          <div className="insp-note">
            以雜湊向量計算的檢索相似度，僅供探索；不代表節點之間存在關係，也不會寫入本體。
          </div>
          {similar.length === 0 ? (
            <div className="insp-note" style={{ marginTop: 8 }}>
              尚無足夠的相似節點（或檢索索引尚未建立）。
            </div>
          ) : (
            similar.map((item) => {
              const other = model.nodeById.get(item.id);
              if (!other) return null;
              return (
                <button
                  type="button"
                  key={item.id}
                  className="link-btn"
                  onClick={() => focusNode(item.id)}
                  title="開啟語意相似節點"
                >
                  <Icon name="sparkle" size={13} />
                  <span className="truncate" style={{ flex: 1 }}>
                    {other.title}
                  </span>
                  <span className="micro">{Math.round(item.score * 100)}%</span>
                </button>
              );
            })
          )}

          {bodyText.trim() !== '' && (
            <>
              <div className="block-title">公開正文</div>
              <div className="insp-body-text">{bodyOpen ? bodyText : clip(bodyText, 420)}</div>
              {bodyText.length > 420 && (
                <button type="button" className="insp-longtoggle" onClick={() => setBodyOpen((prev) => !prev)}>
                  {bodyOpen ? '收合正文' : '展開全文'}
                </button>
              )}
            </>
          )}

          <div className="insp-note" style={{ marginTop: 18 }}>
            節點 ID：<span className="mono">{node.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
