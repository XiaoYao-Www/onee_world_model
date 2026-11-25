import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import EdgeDetail from './EdgeDetail';
import NodeDetail from './NodeDetail';
import './inspector.css';

function Guide(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const setView = useAppStore((s) => s.setView);
  const setPanelTab = useAppStore((s) => s.setPanelTab);

  if (!model) {
    return (
      <div className="insp">
        <div className="insp-guide">
          <div className="insp-guide-title">
            <Icon name="info" size={15} />
            {status === 'error' ? '資料載入失敗' : '正在載入世界模型'}
          </div>
          <div className="insp-note" style={{ marginTop: 10 }}>
            {status === 'error'
              ? `靜態資料無法載入：${error ?? '未知錯誤'}。網站其他部分仍可操作；資料修復後重新整理即可。`
              : '靜態資料載入後，點選任一節點即可在這裡看到完整詳情。'}
          </div>
        </div>
      </div>
    );
  }

  const counts = model.meta?.counts;
  const nodes = model.nodes.length;
  const sources = model.sources.length;
  const evidence = model.evidence.length;
  const claims = model.claims.length;
  const demoNodes = nodes > 0 ? model.nodes.filter((n) => n.demo).length : 0;
  const demoRatio = nodes > 0 ? Math.round((demoNodes / nodes) * 100) : 0;

  return (
    <div className="insp">
      <div className="insp-scroll">
        <div className="insp-guide">
          <div className="insp-guide-title">
            <Icon name="target" size={15} />
            節點詳情
          </div>
          <div className="insp-note" style={{ marginTop: 8 }}>
            尚未選取任何節點。可從宇宙圖、地圖、時間軸、搜尋結果或瀏覽視圖點選節點，右側會顯示完整資料、關係、來源、證據與主張。
          </div>

          <div className="block-title">操作方式</div>
          <div className="insp-guide-list">
            <div>
              <span className="kbd insp-kbd">/</span>
              <span>聚焦全域搜尋；也可用 Ctrl（⌘）+ K。</span>
            </div>
            <div>
              <span className="kbd insp-kbd">↑↓</span>
              <span>在搜尋建議中移動，Enter 選取並聚焦最佳結果。</span>
            </div>
            <div>
              <span className="kbd insp-kbd">Esc</span>
              <span>清除搜尋，或關閉目前浮層。</span>
            </div>
            <div>
              <Icon name="layers" size={13} />
              <span>底部的時間軸可調整時間範圍、播放與暫停，所有視圖會同步更新。</span>
            </div>
            <div>
              <Icon name="filter" size={13} />
              <span>左側篩選器可組合資料類型、學科、來源與證據狀態；條件跨視圖共用。</span>
            </div>
          </div>

          <div className="block-title">資料統計</div>
          <div className="insp-stat">
            <span>節點</span>
            <b>{nodes.toLocaleString('zh-TW')}</b>
          </div>
          <div className="insp-stat">
            <span>關係</span>
            <b>{(counts?.edges ?? model.edges.length).toLocaleString('zh-TW')}</b>
          </div>
          <div className="insp-stat">
            <span>來源</span>
            <b>{sources.toLocaleString('zh-TW')}</b>
          </div>
          <div className="insp-stat">
            <span>證據</span>
            <b>{evidence.toLocaleString('zh-TW')}</b>
          </div>
          <div className="insp-stat">
            <span>主張</span>
            <b>{claims.toLocaleString('zh-TW')}</b>
          </div>
          <div className="insp-demo-ratio">
            {nodes === 0
              ? '本體目前匯出的節點為 0 筆；網站會以空狀態呈現，不會產生虛構資料。'
              : demoNodes > 0
                ? `示範資料 ${demoNodes} 筆，占節點總數 ${demoRatio}%；示範資料在節點卡片與詳情中都會標記。`
                : '目前資料集不含示範資料（demo）。'}
            {model.meta?.generated_at && (
              <>
                <br />
                資料產生時間：{model.meta.generated_at}
                {model.meta.data_version ? `（資料版本 ${model.meta.data_version}）` : ''}
              </>
            )}
          </div>

          <div className="block-title">快速前往</div>
          <div className="col" style={{ gap: 2 }}>
            <button type="button" className="link-btn" onClick={() => setView('browse')}>
              <Icon name="browse" size={14} />
              瀏覽全部節點、來源與主張
            </button>
            <button type="button" className="link-btn" onClick={() => setPanelTab('filters')}>
              <Icon name="filter" size={14} />
              展開篩選條件
            </button>
            <button type="button" className="link-btn" onClick={() => setPanelTab('sources')}>
              <Icon name="source" size={14} />
              開啟來源中心
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Inspector(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const selectedId = useAppStore((s) => s.selectedId);
  const selectedEdgeId = useAppStore((s) => s.selectedEdgeId);

  if (!model) return <Guide />;

  if (selectedEdgeId) {
    const edge = model.edges.find((item) => item.id === selectedEdgeId);
    if (edge) return <EdgeDetail model={model} edge={edge} />;
    return (
      <div className="insp">
        <div className="insp-guide">
          <div className="insp-guide-title">
            <Icon name="info" size={15} />
            找不到這條關係
          </div>
          <div className="insp-note" style={{ marginTop: 10 }}>
            選取的關係已不在目前資料中（可能由較新的匯出結果取代）。請重新點選圖上的關係。
          </div>
        </div>
      </div>
    );
  }

  const node = selectedId ? model.nodeById.get(selectedId) : undefined;
  if (node) return <NodeDetail model={model} node={node} />;
  return <Guide />;
}
