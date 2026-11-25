import { useAppStore } from '../store/useAppStore';
import Inspector from '../features/inspector/Inspector';
import Icon from './Icon';

export default function RightDock() {
  const rightOpen = useAppStore((s) => s.rightOpen);
  const set = useAppStore((s) => s.set);
  const selectedId = useAppStore((s) => s.selectedId);

  return (
    <aside className="dock dock-right" aria-label="節點詳情" aria-hidden={!rightOpen}>
      <div className="dock-head">
        <span className="dock-title">詳情</span>
        <div className="spacer" />
        {selectedId && (
          <button
            className="icon-btn"
            title="清除選取（Esc）"
            aria-label="清除選取"
            onClick={() => useAppStore.getState().select(null)}
          >
            <Icon name="close" size={14} />
          </button>
        )}
        <button className="icon-btn" title="收合面板（]）" aria-label="收合面板" onClick={() => set('rightOpen', false)}>
          <Icon name="chevronRight" size={15} />
        </button>
      </div>
      <div className="dock-body scroll">
        <Inspector />
      </div>
    </aside>
  );
}
