import { useAppStore } from '../store/useAppStore';
import { VIEWS } from '../lib/views';
import Icon from './Icon';
import SearchBox from '../features/search/SearchBox';

export default function TopBar() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const meta = useAppStore((s) => s.model?.meta ?? null);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const set = useAppStore((s) => s.set);

  const demoCount = meta?.counts?.demo_nodes ?? 0;

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true" />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span className="brand-name">世界模型</span>
          <span className="brand-sub">WORLD MODEL · 知識宇宙</span>
        </div>
      </div>

      <nav className="view-tabs" aria-label="主要視圖">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            className={`view-tab ${view === v.key ? 'is-on' : ''}`}
            onClick={() => setView(v.key)}
            title={`${v.hint}（${v.keybind}）`}
            aria-pressed={view === v.key}
          >
            <Icon name={v.icon} size={15} />
            <span className="label">{v.label}</span>
          </button>
        ))}
      </nav>

      <SearchBox />

      <div className="topbar-spacer" />

      {demoCount > 0 && (
        <span className="badge badge-warn hide-sm" title="示範資料僅供展示功能，不代表世界模型事實">
          <Icon name="demo" size={11} /> 示範資料 {demoCount}
        </span>
      )}
      {meta && (
        <span className="badge hide-sm" title={`產生時間 ${new Date(meta.generated_at).toLocaleString('zh-TW')}`}>
          資料版本 {meta.data_version}
        </span>
      )}

      <button
        className={`icon-btn ${leftOpen ? 'is-on' : ''}`}
        onClick={() => set('leftOpen', !leftOpen)}
        title="切換左側面板（[）"
        aria-label="切換左側面板"
      >
        <Icon name="panelLeft" />
      </button>
      <button
        className={`icon-btn ${rightOpen ? 'is-on' : ''}`}
        onClick={() => set('rightOpen', !rightOpen)}
        title="切換詳情面板（]）"
        aria-label="切換詳情面板"
      >
        <Icon name="panelRight" />
      </button>
      <button className="icon-btn" onClick={() => set('helpOpen', true)} title="說明與快捷鍵（?）" aria-label="說明">
        <Icon name="help" />
      </button>
    </header>
  );
}
