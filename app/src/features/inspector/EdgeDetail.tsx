import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import type { ModelBundle, WmEdge } from '../../data/types';
import { EPISTEMIC_LABELS, EVIDENCE_ROLE_LABELS, SOURCE_TYPE_LABELS, kindStyle } from '../../lib/palette';
import { formatRange } from '../../lib/time';
import { formatDate, relationText, reliabilityLabel } from './format';
import './inspector.css';

interface Props {
  model: ModelBundle;
  edge: WmEdge;
}

export default function EdgeDetail({ model, edge }: Props): JSX.Element {
  const focusNode = useAppStore((s) => s.focusNode);
  const source = model.nodeById.get(edge.source);
  const target = model.nodeById.get(edge.target);
  const epistemic = EPISTEMIC_LABELS[edge.epistemic_status ?? ''] ?? edge.epistemic_status ?? '未記錄';
  const period = formatRange(edge.valid_from, edge.valid_to);
  const sources = edge.sources.flatMap((id) => {
    const item = model.sourceById.get(id);
    return item ? [item] : [];
  });
  const evidence = edge.evidence.flatMap((id) => {
    const item = model.evidenceById.get(id);
    return item ? [item] : [];
  });

  const nodeChip = (id: string, label: string) => {
    const node = model.nodeById.get(id);
    const style = kindStyle(node?.kind);
    return (
      <button
        type="button"
        className="link-btn"
        style={{ padding: '4px 6px' }}
        onClick={() => focusNode(id)}
        title={`前往節點：${node?.title ?? id}`}
      >
        <span className="dot" style={{ background: style.color, width: 8, height: 8, borderRadius: '50%' }} aria-hidden="true" />
        <span className="truncate" style={{ flex: 1 }}>
          {node?.title ?? id}
        </span>
        <span className="micro">{label}</span>
      </button>
    );
  };

  return (
    <div className="insp">
      <header className="insp-head">
        <div className="insp-kindline">
          <span className="insp-kind">
            <Icon name="link" size={13} />
            關係
          </span>
          <span className="badge badge-accent">{relationText(edge.type)}</span>
          <span className="badge">{edge.direction === 'undirected' ? '無向' : '有向'}</span>
          {edge.demo && <span className="badge badge-gold">示範資料</span>}
        </div>
        <h2 className="inspector-title" style={{ margin: '6px 0 0' }}>
          {source?.title ?? edge.source} → {target?.title ?? edge.target}
        </h2>
        <div className="insp-original">
          {relationText(edge.label || edge.type)} · <span className="mono">{edge.type}</span>
        </div>
      </header>

      <div className="insp-scroll">
        <div className="insp-body">
          <div className="block-title" style={{ marginTop: 10 }}>
            關係定義
          </div>
          <div className="prop-grid">
            <span className="prop-key">類型</span>
            <span className="prop-val">{relationText(edge.type)}</span>
            <span className="prop-key">方向</span>
            <span className="prop-val">{edge.direction === 'undirected' ? '無向（雙向）' : '有向'}</span>
            <span className="prop-key">有效期間</span>
            <span className="prop-val">{period}</span>
            <span className="prop-key">證據狀態</span>
            <span className="prop-val">{epistemic}</span>
            {edge.weight != null && (
              <>
                <span className="prop-key">權重</span>
                <span className="prop-val">{edge.weight}</span>
              </>
            )}
            <span className="prop-key">來源</span>
            <span className="prop-val">{sources.length} 筆</span>
            <span className="prop-key">證據</span>
            <span className="prop-val">{evidence.length} 筆</span>
          </div>

          <div className="block-title">兩端節點</div>
          <div className="col" style={{ gap: 2 }}>
            {nodeChip(edge.source, '起點')}
            {nodeChip(edge.target, '終點')}
          </div>

          <div className="block-title">支持來源</div>
          {sources.length === 0 ? (
            <div className="insp-note">此關係尚無公開來源。</div>
          ) : (
            sources.map((item) => {
              const reliability = reliabilityLabel(item.reliability);
              return (
                <div className="insp-src" key={item.id}>
                  <div className="row" style={{ gap: 6, alignItems: 'flex-start' }}>
                    <span className="insp-src-title" style={{ flex: 1 }}>
                      {item.title}
                    </span>
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="icon-btn"
                        style={{ width: 22, height: 22 }}
                        aria-label={`開啟原始來源：${item.title}`}
                      >
                        <Icon name="external" size={12} />
                      </a>
                    )}
                  </div>
                  <div className="insp-src-sub">
                    {item.publisher && <span>{item.publisher}</span>}
                    {item.published_at && <span>{formatDate(item.published_at)}</span>}
                    <span>{SOURCE_TYPE_LABELS[item.source_type] ?? item.source_type}</span>
                    {reliability && <span className="badge badge-ok">{reliability}</span>}
                  </div>
                </div>
              );
            })
          )}

          {evidence.length > 0 && (
            <>
              <div className="block-title">證據</div>
              {evidence.map((item) => (
                <div
                  className={`insp-entry${item.role === 'contradicts' ? ' is-contra' : item.role === 'supports' ? ' is-support' : ''}`}
                  key={item.id}
                >
                  <div className="insp-entry-title">{item.title || '證據摘錄'}</div>
                  {item.excerpt && <div className="insp-quote">{item.excerpt}</div>}
                  <div className="insp-entry-sub">
                    <span className="badge">{EVIDENCE_ROLE_LABELS[item.role] ?? item.role}</span>
                    {item.source_location && <span className="mono">{item.source_location}</span>}
                  </div>
                </div>
              ))}
            </>
          )}

          <div className="insp-note" style={{ marginTop: 18 }}>
            關係 ID：<span className="mono">{edge.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
