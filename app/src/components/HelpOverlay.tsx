import { useAppStore } from '../store/useAppStore';
import Icon from './Icon';

const SHORTCUTS: [string, string][] = [
  ['/ 或 Ctrl+K', '聚焦搜尋'],
  ['1 / 2 / 3 / 4', '切換宇宙、地圖、時間軸、瀏覽'],
  ['空白鍵', '播放／暫停時間軸'],
  ['[ / ]', '開合左側、右側面板'],
  ['Esc', '清除選取或關閉對話框'],
  ['?', '開啟本說明'],
];

export default function HelpOverlay() {
  const open = useAppStore((s) => s.helpOpen);
  const set = useAppStore((s) => s.set);
  const meta = useAppStore((s) => s.model?.meta ?? null);
  if (!open) return null;

  return (
    <div
      className="boot-screen"
      style={{ background: 'rgba(3,5,11,0.72)', backdropFilter: 'blur(6px)', zIndex: 80 }}
      onClick={() => set('helpOpen', false)}
      role="dialog"
      aria-modal="true"
      aria-label="說明"
    >
      <div
        className="panel fade-up"
        style={{ padding: 22, width: 'min(620px, 92vw)', maxHeight: '82vh', overflow: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ marginBottom: 14 }}>
          <Icon name="sparkle" size={18} />
          <div style={{ fontSize: 17, fontWeight: 620 }}>世界模型｜知識宇宙</div>
          <div className="spacer" />
          <button className="icon-btn" onClick={() => set('helpOpen', false)} aria-label="關閉">
            <Icon name="close" />
          </button>
        </div>

        <p className="micro" style={{ lineHeight: 1.8 }}>
          這是世界模型的公開探索介面。世界模型本體是一個獨立的 Obsidian Vault（由 Fast Note Sync 保存），包含人物、組織、國家、
          地點、技術、資源、事件、關係、來源、證據、主張、假設與分析，以及模型自身的類型、欄位、標籤、時間與地理規範。
          網站只是下游呈現層：本網站的所有資料均由 DSH 在本機讀取世界模型後匯出、打包並提交，瀏覽器不會連線到筆記伺服器。
        </p>

        <div className="block-title">快捷鍵</div>
        <div className="prop-grid" style={{ gridTemplateColumns: '150px 1fr' }}>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k} style={{ display: 'contents' }}>
              <div className="prop-key mono" style={{ fontSize: 11.5 }}>{k}</div>
              <div className="prop-val">{v}</div>
            </div>
          ))}
        </div>

        <div className="block-title">資料狀態</div>
        <div className="micro">
          {meta ? (
            <>
              資料版本 {meta.data_version}｜模型版本 {meta.model_version}｜產生時間{' '}
              {new Date(meta.generated_at).toLocaleString('zh-TW')}
              <br />
              節點 {meta.counts.nodes}｜關係 {meta.counts.edges}｜來源 {meta.counts.sources}｜證據 {meta.counts.evidence}｜主張{' '}
              {meta.counts.claims}｜地理要素 {meta.counts.geo_features}
              {meta.counts.demo_nodes > 0 && (
                <>
                  <br />
                  <span style={{ color: 'var(--warn)' }}>
                    其中 {meta.counts.demo_nodes} 個節點為示範資料（標記 demo），僅用於展示互動功能，不代表世界模型的事實主張。
                  </span>
                </>
              )}
            </>
          ) : (
            '尚未載入資料。'
          )}
        </div>

        <div className="block-title">語義提示</div>
        <ul className="micro" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
          <li>實線關係是本體明確記錄的關係；虛線或標記「衍生」的連結只是檢索路徑，不是事實。</li>
          <li>顏色與形狀一起表示節點型別；顏色不代表可信度或立場。</li>
          <li>時間精度會保留：只知道年份的資料不會被顯示成精確日期。</li>
          <li>來源、證據與主張分開呈現；有衝突的來源會並列，不會被抹平。</li>
        </ul>
      </div>
    </div>
  );
}
