import { useMemo } from 'react';
import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import type { ModelBundle, WmSource } from '../../data/types';
import { EVIDENCE_ROLE_LABELS, SOURCE_TYPE_LABELS, kindStyle } from '../../lib/palette';

import { archiveStatusLabel, formatDate, isExternalUrl, languageLabel, reliabilityLabel } from '../inspector/format';
import './sources.css';

const ACCESS_LABELS: Record<string, string> = {
  open: '公開可讀',
  partial: '部分可見',
  paywalled: '需付費',
  restricted: '受限',
  removed: '已移除',
  unknown: '未記錄',
};

interface Props {
  model: ModelBundle;
  source: WmSource;
  onBack: () => void;
}

export default function SourceDetail({ model, source, onBack }: Props): JSX.Element {
  const focusNode = useAppStore((s) => s.focusNode);

  const relatedNodes = useMemo(() => {
    const ids = new Set(source.related_ids);
    if (ids.size === 0) {
      for (const node of model.nodes) {
        if (node.sources.includes(source.id)) ids.add(node.id);
      }
    }
    return [...ids].flatMap((id) => {
      const node = model.nodeById.get(id);
      return node ? [node] : [];
    });
  }, [model, source.id, source.related_ids]);

  const evidence = useMemo(
    () => model.evidence.filter((item) => item.source_id === source.id),
    [model, source.id],
  );

  const reliability = reliabilityLabel(source.reliability);
  const language = languageLabel(source.language);
  const access = source.access_status ? ACCESS_LABELS[source.access_status] ?? source.access_status : '';
  const hasUrl = !!source.url && isExternalUrl(source.url);

  return (
    <div className="sc">
      <div className="sc-detail-head">
        <button type="button" className="sc-back" onClick={onBack}>
          <Icon name="chevron" size={11} />
          回列表
        </button>
        <span className="spacer" />
        <span className="badge">{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</span>
        {source.demo && <span className="badge badge-gold">示範資料</span>}
      </div>

      <div className="sc-body">
        <div className="sc-detail-body">
          <div className="sc-title">{source.title}</div>
          {source.title_original && <div className="sc-original">原始標題：{source.title_original}</div>}
          {source.summary && <p className="sc-summary">{source.summary}</p>}

          <div className="block-title" style={{ marginTop: 14 }}>
            書目資料
          </div>
          <div className="sc-prop">
            <span className="sc-key">發布者</span>
            <span className="sc-val">{source.publisher || '未記錄'}</span>
            <span className="sc-key">作者</span>
            <span className="sc-val">{source.authors.length > 0 ? source.authors.join('、') : '未記錄'}</span>
            <span className="sc-key">發布日期</span>
            <span className="sc-val">{source.published_at ? formatDate(source.published_at) : '未記錄'}</span>
            <span className="sc-key">取得日期</span>
            <span className="sc-val">{source.retrieved_at ? formatDate(source.retrieved_at) : '未記錄'}</span>
            <span className="sc-key">類型</span>
            <span className="sc-val">{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</span>
            <span className="sc-key">語言</span>
            <span className="sc-val">{language}</span>
            <span className="sc-key">授權</span>
            <span className="sc-val">{source.license || '未記錄授權'}</span>
            <span className="sc-key">存檔狀態</span>
            <span className="sc-val">{archiveStatusLabel(source.archive_status)}</span>
            {access && (
              <>
                <span className="sc-key">存取狀態</span>
                <span className="sc-val">{access}</span>
              </>
            )}
            {reliability && (
              <>
                <span className="sc-key">可靠性</span>
                <span className="sc-val">
                  <span className="badge badge-ok">{reliability}</span>
                </span>
              </>
            )}
            {source.url && (
              <>
                <span className="sc-key">原始連結</span>
                <span className="sc-val sc-url">
                  {hasUrl ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.url}
                    </a>
                  ) : (
                    source.url
                  )}
                </span>
              </>
            )}
            {source.domains.length > 0 && (
              <>
                <span className="sc-key">學科</span>
                <span className="sc-val">{source.domains.join('、')}</span>
              </>
            )}
            {source.tags.length > 0 && (
              <>
                <span className="sc-key">標籤</span>
                <span className="sc-val">{source.tags.join('、')}</span>
              </>
            )}
          </div>

          {(source.bias_notes || reliability) && (
            <>
              <div className="block-title">可靠性與偏誤說明</div>
              <div className="sc-note">
                {source.bias_notes ||
                  '本體未記錄偏誤說明；可靠性標記只反映來源評估，不代表內容已完全核實。'}
              </div>
            </>
          )}

          <div className="block-title">相關證據</div>
          {evidence.length === 0 ? (
            <div className="sc-note">此來源尚未建立證據摘錄。</div>
          ) : (
            evidence.map((item) => (
              <div
                className={`sc-evidence${item.role === 'contradicts' ? ' is-contra' : item.role === 'supports' ? ' is-support' : ''}`}
                key={item.id}
              >
                <div className="sc-evidence-title">{item.title || '證據摘錄'}</div>
                {item.excerpt && <div className="sc-evidence-excerpt">{item.excerpt}</div>}
                <div className="sc-evidence-title" style={{ marginTop: 4 }}>
                  <span className="badge">{EVIDENCE_ROLE_LABELS[item.role] ?? item.role}</span>
                  {item.source_location && <span className="mono dim"> {item.source_location}</span>}
                </div>
              </div>
            ))
          )}

          <div className="block-title">關聯節點</div>
          {relatedNodes.length === 0 ? (
            <div className="sc-note">此來源尚未連結到任何節點。</div>
          ) : (
            <div className="sc-related">
              {relatedNodes.map((node) => (
                <button
                  type="button"
                  key={node.id}
                  className="sc-node"
                  onClick={() => focusNode(node.id)}
                  title={`前往節點：${node.title}`}
                >
                  <span
                    className="dot"
                    style={{ background: kindStyle(node.kind).color, width: 7, height: 7, borderRadius: '50%' }}
                    aria-hidden="true"
                  />
                  <span className="truncate" style={{ flex: 1 }}>
                    {node.title}
                  </span>
                  <span className="micro">{kindStyle(node.kind).label}</span>
                </button>
              ))}
            </div>
          )}

          <div className="sc-note" style={{ marginTop: 16 }}>
            來源 ID：<span className="mono">{source.id}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
