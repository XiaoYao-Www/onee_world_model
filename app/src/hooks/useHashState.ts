import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Filters, ViewMode } from '../data/types';

/**
 * URL hash 狀態同步：可分享目前視圖、搜尋、選取、時間窗與篩選。
 * 只放網站必要的呈現狀態，不含任何私有資訊。
 */

const FILTER_KEYS: (keyof Filters)[] = [
  'kinds',
  'domains',
  'tags',
  'sourceTypes',
  'epistemic',
  'relationTypes',
  'eventStatus',
  'geoRoles',
  'reliability',
];

function readHash(): URLSearchParams {
  const raw = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(raw);
}

export function useHashState() {
  const applied = useRef(false);

  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const params = readHash();
    if (!params.toString()) return;
    const store = useAppStore.getState();
    const view = params.get('v') as ViewMode | null;
    if (view && ['universe', 'map', 'timeline', 'browse'].includes(view)) store.setView(view);
    const q = params.get('q');
    if (q) store.setSearch(q);
    const sel = params.get('sel');
    if (sel) store.select(sel);
    const from = Number(params.get('from'));
    const to = Number(params.get('to'));
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) store.setWindow(from, to);
    const filters: Partial<Filters> = {};
    for (const key of FILTER_KEYS) {
      const v = params.get(key);
      if (v) (filters as Record<string, string[]>)[key] = v.split(',').filter(Boolean);
    }
    if (Number(params.get('minSources')) > 0) filters.minSources = Number(params.get('minSources'));
    if (params.get('hideDemo') === '1') filters.hideDemo = true;
    if (Object.keys(filters).length > 0) store.patchFilters(filters);
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const unsub = useAppStore.subscribe((s) => s);
    const write = () => {
      const s = useAppStore.getState();
      const params = new URLSearchParams();
      params.set('v', s.view);
      if (s.search) params.set('q', s.search);
      if (s.selectedId) params.set('sel', s.selectedId);
      if (s.window.from != null && s.window.to != null) {
        params.set('from', String(Math.round(s.window.from)));
        params.set('to', String(Math.round(s.window.to)));
      }
      for (const key of FILTER_KEYS) {
        const arr = s.filters[key];
        if (Array.isArray(arr) && arr.length > 0) params.set(key, arr.join(','));
      }
      if (s.filters.minSources > 0) params.set('minSources', String(s.filters.minSources));
      if (s.filters.hideDemo) params.set('hideDemo', '1');
      const next = `#${params.toString()}`;
      if (window.location.hash !== next) window.history.replaceState(null, '', next);
    };
    const debounced = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(write, 220);
    };
    const unsub2 = useAppStore.subscribe(debounced);
    void unsub;
    return () => {
      window.clearTimeout(timer);
      unsub2();
    };
  }, []);
}
