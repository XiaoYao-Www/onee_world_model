import { create } from 'zustand';
import { loadModel } from '../data/loadModel';
import { EMPTY_FILTERS, type Filters, type ModelBundle, type ViewMode } from '../data/types';
import { parseTime } from '../lib/time';
import { neighbourhood } from '../lib/select';

export type SourceMode = 'news' | 'all' | 'related';
export type PanelTab = 'filters' | 'sources';

interface AppState {
  model: ModelBundle | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;

  view: ViewMode;
  search: string;
  filters: Filters;
  selectedId: string | null;
  hoveredId: string | null;
  selectedEdgeId: string | null;
  focusSignal: number;
  focusTarget: string | null;
  expandHops: number;

  bounds: [number, number];
  window: { from: number | null; to: number | null };
  playing: boolean;
  playSpeed: number;

  showDerived: boolean;
  showLabels: boolean;
  showEdges: boolean;
  reducedMotion: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  panelTab: PanelTab;
  sourceMode: SourceMode;
  legendOpen: boolean;
  helpOpen: boolean;

  init: () => Promise<void>;
  setView: (v: ViewMode) => void;
  setSearch: (q: string) => void;
  patchFilters: (patch: Partial<Filters>) => void;
  toggleFilterValue: (key: keyof Filters, value: string) => void;
  resetFilters: () => void;
  select: (id: string | null) => void;
  focusNode: (id: string) => void;
  hover: (id: string | null) => void;
  selectEdge: (id: string | null) => void;
  setWindow: (from: number | null, to: number | null) => void;
  setPlaying: (playing: boolean) => void;
  tick: (dtMs: number) => void;
  setPlaySpeed: (s: number) => void;
  set: <K extends keyof AppState>(key: K, value: AppState[K]) => void;
  toggleLeft: () => void;
  toggleRight: () => void;
  setPanelTab: (t: PanelTab) => void;
  setSourceMode: (m: SourceMode) => void;
  expandFromSelected: () => void;
}

const DAY = 86_400_000;

export const useAppStore = create<AppState>((set, get) => ({
  model: null,
  status: 'loading',
  error: null,

  view: 'universe',
  search: '',
  filters: { ...EMPTY_FILTERS },
  selectedId: null,
  hoveredId: null,
  selectedEdgeId: null,
  focusSignal: 0,
  focusTarget: null,
  expandHops: 1,

  bounds: [Date.UTC(2015, 0, 1), Date.UTC(2027, 0, 1)],
  window: { from: Date.UTC(2015, 0, 1), to: Date.UTC(2027, 0, 1) },
  playing: false,
  playSpeed: 1,

  showDerived: false,
  showLabels: true,
  showEdges: true,
  reducedMotion:
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? true
      : false,
  leftOpen: true,
  rightOpen: true,
  panelTab: 'filters',
  sourceMode: 'all',
  legendOpen: false,
  helpOpen: false,

  async init() {
    set({ status: 'loading', error: null });
    try {
      const model = await loadModel();
      const starts: number[] = [];
      const ends: number[] = [];
      for (const n of model.nodes) {
        const s = parseTime(n.start);
        const e = parseTime(n.end) ?? s;
        if (s != null) starts.push(s);
        if (e != null) ends.push(e);
      }
      const metaFrom = parseTime(model.meta.time_range?.[0]);
      const metaTo = parseTime(model.meta.time_range?.[1]);
      const fullFrom = Math.min(metaFrom ?? Date.UTC(2010, 0, 1), ...(starts.length ? starts : [Date.UTC(2010, 0, 1)]));
      const fullTo = Math.max(metaTo ?? Date.UTC(2027, 0, 1), ...(ends.length ? ends : [Date.UTC(2027, 0, 1)])) + 365 * DAY;

      // 預設時間窗不要被極端歷史年份（例如 1776 年成立的國家）拉開整條時間軸：
      // 以資料分位數決定「主要活動期間」，完整範圍仍保留在 bounds，可隨時展開。
      const quantile = (arr: number[], q: number) => {
        if (arr.length === 0) return null;
        const sorted = [...arr].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
        return sorted[idx];
      };
      const denseFrom = quantile(starts, 0.05);
      const denseTo = quantile(ends.length ? ends : starts, 0.95);
      const spanYears = (fullTo - fullFrom) / (365.25 * DAY);
      let winFrom = fullFrom;
      let winTo = fullTo;
      if (spanYears > 40 && denseFrom != null && denseTo != null) {
        winFrom = Math.max(fullFrom, denseFrom - 365 * DAY);
        winTo = Math.min(fullTo, denseTo + 365 * DAY);
        if (winTo - winFrom < 3 * 365 * DAY) {
          winFrom = fullFrom;
          winTo = fullTo;
        }
      }
      set({
        model,
        status: 'ready',
        bounds: [fullFrom - 30 * DAY, fullTo],
        window: { from: winFrom, to: winTo },
      });
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  setView: (view) => set({ view }),
  setSearch: (search) => set({ search, selectedEdgeId: null }),
  patchFilters: (patch) => set({ filters: { ...get().filters, ...patch } }),
  toggleFilterValue: (key, value) => {
    const filters = { ...get().filters };
    const current = filters[key];
    if (Array.isArray(current)) {
      const arr = current as string[];
      (filters[key] as unknown as string[]) = arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
    }
    set({ filters });
  },
  resetFilters: () => set({ filters: { ...EMPTY_FILTERS } }),
  select: (id) => set({ selectedId: id, selectedEdgeId: null, focusTarget: id }),
  focusNode: (id) => set({ selectedId: id, focusSignal: get().focusSignal + 1, focusTarget: id }),
  hover: (id) => set({ hoveredId: id }),
  selectEdge: (id) => set({ selectedEdgeId: id }),
  setWindow: (from, to) => set({ window: { from, to } }),
  setPlaying: (playing) => set({ playing }),
  setPlaySpeed: (playSpeed) => set({ playSpeed }),
  tick: (dtMs) => {
    const { window: w, bounds, playSpeed, playing } = get();
    if (!playing) return;
    const span = Math.max((w.to ?? bounds[1]) - (w.from ?? bounds[0]), DAY);
    const step = span * 0.12 * playSpeed;
    const from = (w.from ?? bounds[0]) + step;
    if (from >= bounds[1]) {
      set({ window: { from: bounds[0], to: bounds[0] + span }, playing: false });
      return;
    }
    set({ window: { from, to: from + span } });
    void dtMs;
  },
  set: (key, value) => set({ [key]: value } as unknown as Partial<AppState>),
  toggleLeft: () => set({ leftOpen: !get().leftOpen }),
  toggleRight: () => set({ rightOpen: !get().rightOpen }),
  setPanelTab: (panelTab) => set({ panelTab }),
  setSourceMode: (sourceMode) => set({ sourceMode }),
  expandFromSelected: () => {
    const { selectedId, model, expandHops } = get();
    if (!selectedId || !model) return;
    const ids = neighbourhood(model, selectedId, Math.min(expandHops + 1, 3));
    set({ expandHops: Math.min(expandHops + 1, 3) });
    void ids;
  },
}));
