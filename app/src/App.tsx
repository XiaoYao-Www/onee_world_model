import { useEffect } from 'react';
import { useAppStore } from './store/useAppStore';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useHashState } from './hooks/useHashState';
import TopBar from './components/TopBar';
import LeftPanel from './components/LeftPanel';
import RightDock from './components/RightDock';
import HelpOverlay from './components/HelpOverlay';
import UniverseView from './features/universe/UniverseView';
import MapView from './features/map/MapView';
import TimelineView from './features/timeline/TimelineView';
import BrowseView from './features/browse/BrowseView';
import { TimeDock } from './features/timeline/TimeDock';

export default function App() {
  const init = useAppStore((s) => s.init);
  const status = useAppStore((s) => s.status);
  const error = useAppStore((s) => s.error);
  const view = useAppStore((s) => s.view);
  const leftOpen = useAppStore((s) => s.leftOpen);
  const rightOpen = useAppStore((s) => s.rightOpen);
  const set = useAppStore((s) => s.set);
  const playing = useAppStore((s) => s.playing);
  const narrow = useMediaQuery('(max-width: 1080px)');

  useHashState();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (narrow) set('leftOpen', false);
    if (narrow) set('rightOpen', false);
  }, [narrow, set]);

  // 時間播放
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => useAppStore.getState().tick(80), 80);
    return () => window.clearInterval(id);
  }, [playing]);

  // 全域快捷鍵
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const store = useAppStore.getState();
      if (e.key === 'Escape') {
        if (store.helpOpen) store.set('helpOpen', false);
        else if (typing) (target as HTMLInputElement).blur();
        else store.select(null);
        return;
      }
      if (typing) return;
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        store.set('helpOpen', !store.helpOpen);
        return;
      }
      if (e.key === '1') store.setView('universe');
      if (e.key === '2') store.setView('map');
      if (e.key === '3') store.setView('timeline');
      if (e.key === '4') store.setView('browse');
      if (e.key === '[') store.set('leftOpen', !store.leftOpen);
      if (e.key === ']') store.set('rightOpen', !store.rightOpen);
      if (e.key === ' ') {
        e.preventDefault();
        store.setPlaying(!store.playing);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (status === 'loading') {
    return (
      <div className="boot-screen">
        <div className="boot-inner">
          <div className="brand-mark" style={{ width: 40, height: 40 }} />
          <div className="boot-title">載入世界模型</div>
          <div className="boot-bar"><i /></div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="boot-screen">
        <div className="panel fade-up" style={{ padding: 26, maxWidth: 460, display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>無法載入世界模型資料</div>
          <div className="micro">
            網站只讀取已內嵌的靜態資料（由 DSH 從 Obsidian 世界模型匯出）。若資料檔尚未產生，請先執行匯出器。
          </div>
          <div className="mono" style={{ fontSize: 11.5, color: 'var(--danger)', wordBreak: 'break-all' }}>{error}</div>
          <button className="btn btn-primary" onClick={() => void useAppStore.getState().init()}>重新載入</button>
        </div>
      </div>
    );
  }

  const mainClass = [
    'app-main',
    !narrow && !leftOpen ? 'left-closed' : '',
    !narrow && !rightOpen ? 'right-closed' : '',
    narrow && leftOpen ? 'left-open' : '',
    narrow && rightOpen ? 'right-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app">
      <TopBar />
      <div className={mainClass}>
        <LeftPanel />
        <main className="stage" aria-label="世界模型主要視圖">
          {view === 'universe' && <UniverseView />}
          {view === 'map' && <MapView />}
          {view === 'timeline' && <TimelineView />}
          {view === 'browse' && <BrowseView />}
        </main>
        <RightDock />
      </div>
      <TimeDock />
      {narrow && (leftOpen || rightOpen) && (
        <div
          className="drawer-scrim"
          onClick={() => {
            set('leftOpen', false);
            set('rightOpen', false);
          }}
        />
      )}
      <HelpOverlay />
    </div>
  );
}
