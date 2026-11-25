import { useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import { EMPTY_FILTERS, type Filters, type ModelBundle, type WmNode } from '../../data/types';
import { matchesFilters } from '../../lib/select';
import { relationText } from '../inspector/format';
import {
  EPISTEMIC_LABELS,
  GEO_ROLE_LABELS,
  SOURCE_TYPE_LABELS,
  STATUS_LABELS,
  kindStyle,
} from '../../lib/palette';
import './filters.css';

type NodeFacetKey =
  | 'kinds'
  | 'domains'
  | 'tags'
  | 'sourceTypes'
  | 'reliability'
  | 'epistemic'
  | 'eventStatus'
  | 'geoRoles';
type FacetKey = NodeFacetKey | 'relationTypes';

interface FacetOption {
  value: string;
  label: string;
  count: number;
  color?: string;
}

const RELIABILITY_LABELS: Record<string, string> = {
  high: '高可靠性',
  medium: '中可靠性',
  low: '低可靠性',
  very_high: '極高可靠性',
  mixed: '混合',
  primary: '一手來源',
  secondary: '二手來源',
  unknown: '未評估',
};

const PRESETS: { key: string; label: string; hint: string; patch: Partial<Filters> }[] = [
  {
    key: 'verified',
    label: '只看已核實事實',
    hint: '證據狀態為「已核實事實」的節點',
    patch: { epistemic: ['verified_fact'] },
  },
  { key: 'events', label: '只看事件', hint: '只顯示事件類型的節點', patch: { kinds: ['event'] } },
  { key: 'sourced2', label: '至少 2 個來源', hint: '引用來源數 ≥ 2 的節點', patch: { minSources: 2 } },
  { key: 'noDemo', label: '隱藏示範資料', hint: '排除標記為 demo 的節點', patch: { hideDemo: true } },
];

const MIN_SOURCE_OPTIONS = [0, 1, 2, 3, 5];

function nodeSourceIds(model: ModelBundle, node: WmNode): string[] {
  return model.sourcesByNode.get(node.id) ?? node.sources;
}

function facetValues(model: ModelBundle, node: WmNode, key: NodeFacetKey): string[] {
  switch (key) {
    case 'kinds':
      return [node.kind];
    case 'domains':
      return node.domains;
    case 'tags':
      return node.tags;
    case 'sourceTypes':
      return nodeSourceIds(model, node).map((id) => model.sourceById.get(id)?.source_type ?? '');
    case 'reliability':
      return nodeSourceIds(model, node).map((id) => model.sourceById.get(id)?.reliability ?? '');
    case 'epistemic':
      return [node.epistemic_status && node.epistemic_status.trim() !== '' ? node.epistemic_status : 'unknown'];
    case 'eventStatus':
      return [String(node.props?.event_status ?? node.status ?? '')];
    case 'geoRoles':
      return node.geo.map((geo) => geo.role);
    default:
      return [];
  }
}

function sortByKnownOrder(values: string[], order: string[]): string[] {
  const index = new Map(order.map((v, i) => [v, i]));
  return [...values].sort((a, b) => {
    const ia = index.get(a) ?? 999;
    const ib = index.get(b) ?? 999;
    if (ia !== ib) return ia - ib;
    return a.localeCompare(b, 'zh-Hant');
  });
}

interface ChipsProps {
  options: FacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
  showAll: boolean;
  onShowAll: () => void;
  limit: number;
}

function Chips({ options, selected, onToggle, showAll, onShowAll, limit }: ChipsProps): JSX.Element {
  const visible = showAll ? options : options.slice(0, limit);
  const rest = options.length - visible.length;
  return (
    <>
      {visible.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            className={`chip fp-chip${on ? ' is-on' : ''}`}
            aria-pressed={on}
            title={`${option.label}（${option.count}）`}
            onClick={() => onToggle(option.value)}
          >
            {option.color && <span className="dot" style={{ background: option.color }} aria-hidden="true" />}
            <span className="fp-chip-label">{option.label}</span>
            <span className="fp-chip-count">{option.count}</span>
          </button>
        );
      })}
      {rest > 0 && (
        <button type="button" className="fp-more" onClick={onShowAll}>
          顯示更多（+{rest}）
        </button>
      )}
      {showAll && options.length > limit && (
        <button type="button" className="fp-more" onClick={onShowAll}>
          收合
        </button>
      )}
      {options.length === 0 && <span className="micro">目前沒有可用的值</span>}
    </>
  );
}

interface GroupProps {
  title: string;
  selected: number;
  total: number;
  defaultOpen?: boolean;
  onClear?: () => void;
  hint?: string;
  children: ReactNode;
}

function Group({ title, selected, total, defaultOpen = false, onClear, hint, children }: GroupProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="fp-group">
      <div className="fp-group-head">
        <button
          type="button"
          className="fp-group-toggle"
          aria-expanded={open}
          title={hint}
          onClick={() => setOpen((prev) => !prev)}
        >
          <span className={`fp-caret${open ? ' is-open' : ''}`} aria-hidden="true">
            <Icon name="chevron" size={11} />
          </span>
          <span className="fp-group-name">{title}</span>
          {selected > 0 && <span className="fp-group-sel">{selected}</span>}
          <span className="spacer" />
          <span className="fp-group-count">{total}</span>
        </button>
        {selected > 0 && onClear && (
          <button type="button" className="fp-group-clear" onClick={onClear}>
            清除
          </button>
        )}
      </div>
      {open && <div className="fp-group-body">{children}</div>}
    </section>
  );
}

export default function FilterPanel(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const filters = useAppStore((s) => s.filters);
  const patchFilters = useAppStore((s) => s.patchFilters);
  const toggleFilterValue = useAppStore((s) => s.toggleFilterValue);
  const resetFilters = useAppStore((s) => s.resetFilters);

  const [expanded, setExpanded] = useState<Partial<Record<FacetKey, boolean>>>({});

  const facet = useMemo<Record<FacetKey, Map<string, number>>>(() => {
    const empty: Record<FacetKey, Map<string, number>> = {
      kinds: new Map(),
      domains: new Map(),
      tags: new Map(),
      sourceTypes: new Map(),
      reliability: new Map(),
      epistemic: new Map(),
      eventStatus: new Map(),
      geoRoles: new Map(),
      relationTypes: new Map(),
    };
    if (!model) return empty;
    const nodeKeys: NodeFacetKey[] = [
      'kinds',
      'domains',
      'tags',
      'sourceTypes',
      'reliability',
      'epistemic',
      'eventStatus',
      'geoRoles',
    ];
    for (const key of nodeKeys) {
      const base = { ...filters, [key]: [] } as Filters;
      const map = new Map<string, number>();
      for (const node of model.nodes) {
        if (!matchesFilters(model, node, base)) continue;
        const values = new Set(facetValues(model, node, key).filter(Boolean));
        for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
      }
      empty[key] = map;
    }
    const relBase: Filters = { ...filters, relationTypes: [] };
    const relMap = new Map<string, number>();
    for (const edge of model.edges) {
      if (relBase.hideDemo && edge.demo) continue;
      relMap.set(edge.type, (relMap.get(edge.type) ?? 0) + 1);
    }
    empty.relationTypes = relMap;
    return empty;
  }, [model, filters]);

  const options: Record<FacetKey, FacetOption[]> = useMemo(() => {
    const kindMap = facet.kinds;
    const kindOrder = [
      ...new Set([...(model?.meta.kinds ?? []), ...kindMap.keys()]),
    ].filter((kind) => (kindMap.get(kind) ?? 0) > 0);
    const kinds = kindOrder
      .map((kind) => {
        const style = kindStyle(kind);
        return { value: kind, label: style.label, count: kindMap.get(kind) ?? 0, color: style.color };
      })
      .sort((a, b) => kindStyle(a.value).order - kindStyle(b.value).order);

    const domains = [...facet.domains.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
      .map(([value, count]) => ({ value, label: value, count }));

    const tags = [...facet.tags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
      .map(([value, count]) => ({ value, label: value, count }));

    const sourceTypes = sortByKnownOrder(
      [...facet.sourceTypes.keys()],
      Object.keys(SOURCE_TYPE_LABELS),
    ).map((value) => ({
      value,
      label: SOURCE_TYPE_LABELS[value] ?? value,
      count: facet.sourceTypes.get(value) ?? 0,
    }));

    const reliability = sortByKnownOrder(
      [...facet.reliability.keys()],
      Object.keys(RELIABILITY_LABELS),
    ).map((value) => ({
      value,
      label: RELIABILITY_LABELS[value] ?? value,
      count: facet.reliability.get(value) ?? 0,
    }));

    const epistemic = sortByKnownOrder(
      [...facet.epistemic.keys()],
      Object.keys(EPISTEMIC_LABELS),
    ).map((value) => ({
      value,
      label: EPISTEMIC_LABELS[value] ?? value,
      count: facet.epistemic.get(value) ?? 0,
    }));

    const eventStatus = sortByKnownOrder(
      [...facet.eventStatus.keys()],
      Object.keys(STATUS_LABELS),
    ).map((value) => ({
      value,
      label: STATUS_LABELS[value] ?? value,
      count: facet.eventStatus.get(value) ?? 0,
    }));

    const geoRoles = sortByKnownOrder(
      [...facet.geoRoles.keys()],
      Object.keys(GEO_ROLE_LABELS),
    ).map((value) => ({
      value,
      label: GEO_ROLE_LABELS[value] ?? value,
      count: facet.geoRoles.get(value) ?? 0,
    }));

    const relationTypes = [...facet.relationTypes.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
      .map(([value, count]) => ({ value, label: relationText(value), count }));

    return { kinds, domains, tags, sourceTypes, reliability, epistemic, eventStatus, geoRoles, relationTypes };
  }, [facet, model]);

  const activeCount =
    filters.kinds.length +
    filters.domains.length +
    filters.tags.length +
    filters.sourceTypes.length +
    filters.epistemic.length +
    filters.relationTypes.length +
    filters.eventStatus.length +
    filters.geoRoles.length +
    filters.reliability.length +
    (filters.minSources > 0 ? 1 : 0) +
    (filters.hideDemo ? 1 : 0);

  const toggleShowAll = (key: FacetKey) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const isPresetActive = (patch: Partial<Filters>) =>
    Object.entries(patch).every(([key, value]) => {
      const current = filters[key as keyof Filters];
      if (Array.isArray(value) && Array.isArray(current)) {
        return value.length === current.length && value.every((v) => (current as string[]).includes(v));
      }
      return current === value;
    });

  const applyPreset = (patch: Partial<Filters>) => {
    if (isPresetActive(patch)) {
      resetFilters();
      return;
    }
    patchFilters({ ...EMPTY_FILTERS, ...patch });
  };

  const hasData = !!model && model.nodes.length > 0;

  return (
    <div className="fp">
      <div className="fp-head">
        <div className="fp-head-row">
          <Icon name="filter" size={14} />
          <span className="fp-head-title">篩選條件</span>
          {activeCount > 0 && <span className="badge badge-accent">{activeCount} 項</span>}
          <span className="spacer" />
          <button type="button" className="btn btn-sm" disabled={activeCount === 0} onClick={resetFilters}>
            <Icon name="reset" size={12} />
            清除全部
          </button>
        </div>
        <div className="fp-head-note">
          篩選與搜尋、宇宙圖、地圖、時間軸及清單視圖共用；數量依其他已套用條件計算。
        </div>
      </div>

      <div className="fp-body">
        {!model ? (
          <div className="empty" style={{ padding: '30px 18px' }}>
            <Icon name="info" size={20} />
            <strong>資料尚未載入</strong>
            <div className="micro">篩選項目會在世界模型資料載入後出現。</div>
          </div>
        ) : !hasData ? (
          <div className="empty" style={{ padding: '30px 18px' }}>
            <Icon name="info" size={20} />
            <strong>尚無可篩選的資料</strong>
            <div className="micro">
              本體目前匯出的節點為 0 筆。篩選條件仍可設定，但不會有可顯示的節點；請先在 DSH 匯出世界模型資料。
            </div>
          </div>
        ) : (
          <>
            <div className="fp-presets">
              <div className="section-title" style={{ marginBottom: 0 }}>
                常用組合
              </div>
              <div className="fp-preset-row">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    title={preset.hint}
                    className={`fp-preset${isPresetActive(preset.patch) ? ' is-on' : ''}`}
                    aria-pressed={isPresetActive(preset.patch)}
                    onClick={() => applyPreset(preset.patch)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <Group
              title="資料類型"
              selected={filters.kinds.length}
              total={options.kinds.length}
              defaultOpen
              hint="世界模型的節點類型"
              onClear={() => patchFilters({ kinds: [] })}
            >
              <Chips
                options={options.kinds}
                selected={filters.kinds}
                onToggle={(value) => toggleFilterValue('kinds', value)}
                showAll={!!expanded.kinds}
                onShowAll={() => toggleShowAll('kinds')}
                limit={16}
              />
            </Group>

            <Group
              title="學科領域"
              selected={filters.domains.length}
              total={options.domains.length}
              defaultOpen
              onClear={() => patchFilters({ domains: [] })}
              hint="依節點標記的學科／領域"
            >
              <Chips
                options={options.domains}
                selected={filters.domains}
                onToggle={(value) => toggleFilterValue('domains', value)}
                showAll={!!expanded.domains}
                onShowAll={() => toggleShowAll('domains')}
                limit={10}
              />
            </Group>

            <Group
              title="標籤"
              selected={filters.tags.length}
              total={options.tags.length}
              onClear={() => patchFilters({ tags: [] })}
              hint="本體標籤；數量多時僅先顯示最常用者"
            >
              <Chips
                options={options.tags}
                selected={filters.tags}
                onToggle={(value) => toggleFilterValue('tags', value)}
                showAll={!!expanded.tags}
                onShowAll={() => toggleShowAll('tags')}
                limit={18}
              />
            </Group>

            <Group
              title="來源類型"
              selected={filters.sourceTypes.length}
              total={options.sourceTypes.length}
              onClear={() => patchFilters({ sourceTypes: [] })}
              hint="依節點所引用來源的類型"
            >
              <Chips
                options={options.sourceTypes}
                selected={filters.sourceTypes}
                onToggle={(value) => toggleFilterValue('sourceTypes', value)}
                showAll={!!expanded.sourceTypes}
                onShowAll={() => toggleShowAll('sourceTypes')}
                limit={12}
              />
            </Group>

            <Group
              title="來源可靠性"
              selected={filters.reliability.length}
              total={options.reliability.length}
              onClear={() => patchFilters({ reliability: [] })}
              hint="僅在來源有可靠性評估時才計入"
            >
              <Chips
                options={options.reliability}
                selected={filters.reliability}
                onToggle={(value) => toggleFilterValue('reliability', value)}
                showAll={!!expanded.reliability}
                onShowAll={() => toggleShowAll('reliability')}
                limit={12}
              />
            </Group>

            <Group
              title="證據狀態"
              selected={filters.epistemic.length}
              total={options.epistemic.length}
              defaultOpen
              onClear={() => patchFilters({ epistemic: [] })}
              hint="事實、來源聲稱、推論、假設、預測或有爭議"
            >
              <Chips
                options={options.epistemic}
                selected={filters.epistemic}
                onToggle={(value) => toggleFilterValue('epistemic', value)}
                showAll={!!expanded.epistemic}
                onShowAll={() => toggleShowAll('epistemic')}
                limit={10}
              />
            </Group>

            <Group
              title="事件狀態"
              selected={filters.eventStatus.length}
              total={options.eventStatus.length}
              onClear={() => patchFilters({ eventStatus: [] })}
              hint="事件進行狀態（進行中、已結束、預定…）"
            >
              <Chips
                options={options.eventStatus}
                selected={filters.eventStatus}
                onToggle={(value) => toggleFilterValue('eventStatus', value)}
                showAll={!!expanded.eventStatus}
                onShowAll={() => toggleShowAll('eventStatus')}
                limit={10}
              />
            </Group>

            <Group
              title="地理角色"
              selected={filters.geoRoles.length}
              total={options.geoRoles.length}
              onClear={() => patchFilters({ geoRoles: [] })}
              hint="節點與地點的關係（總部、事件地點、主權主張…）"
            >
              <Chips
                options={options.geoRoles}
                selected={filters.geoRoles}
                onToggle={(value) => toggleFilterValue('geoRoles', value)}
                showAll={!!expanded.geoRoles}
                onShowAll={() => toggleShowAll('geoRoles')}
                limit={12}
              />
            </Group>

            <Group
              title="關係類型"
              selected={filters.relationTypes.length}
              total={options.relationTypes.length}
              onClear={() => patchFilters({ relationTypes: [] })}
              hint="只顯示指定類型的明確關係（作用於關係邊）"
            >
              <Chips
                options={options.relationTypes}
                selected={filters.relationTypes}
                onToggle={(value) => toggleFilterValue('relationTypes', value)}
                showAll={!!expanded.relationTypes}
                onShowAll={() => toggleShowAll('relationTypes')}
                limit={14}
              />
            </Group>

            <Group
              title="最少來源數"
              selected={filters.minSources > 0 ? 1 : 0}
              total={MIN_SOURCE_OPTIONS.length}
              defaultOpen
              onClear={() => patchFilters({ minSources: 0 })}
              hint="引用來源數低於門檻的節點會被隱藏"
            >
              <div className="row wrap" style={{ gap: 5 }}>
                {MIN_SOURCE_OPTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`chip fp-chip${filters.minSources === value ? ' is-on' : ''}`}
                    aria-pressed={filters.minSources === value}
                    onClick={() => patchFilters({ minSources: value })}
                  >
                    {value === 0 ? '不限' : `≥ ${value} 個來源`}
                  </button>
                ))}
              </div>
            </Group>

            <Group title="資料狀態" selected={filters.hideDemo ? 1 : 0} total={1} defaultOpen>
              <button
                type="button"
                className="fp-toggle-row"
                aria-pressed={filters.hideDemo}
                onClick={() => patchFilters({ hideDemo: !filters.hideDemo })}
              >
                <span className={`fp-switch${filters.hideDemo ? ' is-on' : ''}`} aria-hidden="true" />
                <span>隱藏示範資料（demo）</span>
              </button>
            </Group>

            <div className="fp-foot">
              節點總數 {model?.nodes.length ?? 0} 筆
              {model && model.meta.counts.demo_nodes > 0 ? `，其中示範資料 ${model.meta.counts.demo_nodes} 筆` : ''}
              。未知欄位不會因篩選而丟失，只會依可用值呈現。
            </div>
          </>
        )}
      </div>
    </div>
  );
}
