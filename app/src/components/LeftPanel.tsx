import { useAppStore } from '../store/useAppStore';
import FilterPanel from '../features/filters/FilterPanel';
import SourceCenter from '../features/sources/SourceCenter';
import SearchResults from '../features/search/SearchResults';
import Icon from './Icon';

export default function LeftPanel() {
  const panelTab = useAppStore((s) => s.panelTab);
  const setPanelTab = useAppStore((s) => s.setPanelTab);
  const search = useAppStore((s) => s.search);
  const model = useAppStore((s) => s.model);

  const searching = search.trim().length > 0;

  return (
    <aside className="dock dock-left" aria-label="搜尋、篩選與來源">
      <div className="dock-head">
        <span className="dock-title">探索</span>
        <div className="spacer" />
        <div className="seg" role="tablist" aria-label="左側面板分頁">
          <button
            role="tab"
            aria-selected={panelTab === 'filters'}
            className={panelTab === 'filters' ? 'is-on' : ''}
            onClick={() => setPanelTab('filters')}
          >
            <span className="row" style={{ gap: 5 }}>
              <Icon name="filter" size={13} /> 篩選
            </span>
          </button>
          <button
            role="tab"
            aria-selected={panelTab === 'sources'}
            className={panelTab === 'sources' ? 'is-on' : ''}
            onClick={() => setPanelTab('sources')}
          >
            <span className="row" style={{ gap: 5 }}>
              <Icon name="source" size={13} /> 來源
              {model && <span className="dim">{model.sources.length}</span>}
            </span>
          </button>
        </div>
      </div>

      <div className="dock-body scroll">
        {searching && (
          <div className="fade-up" style={{ borderBottom: '1px solid var(--line)' }}>
            <SearchResults />
          </div>
        )}
        {panelTab === 'filters' ? <FilterPanel /> : <SourceCenter />}
      </div>
    </aside>
  );
}
