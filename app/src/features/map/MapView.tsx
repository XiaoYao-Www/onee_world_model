import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import maplibregl, {
  type FilterSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
} from 'maplibre-gl';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '../../store/useAppStore';
import type { GeoFeature, NodeKind, WmNode } from '../../data/types';
import { filterNodes } from '../../lib/select';
import {
  EPISTEMIC_LABELS,
  GEO_ROLE_LABELS,
  KIND_STYLES,
  PRECISION_LABELS,
  kindStyle,
  labelize,
} from '../../lib/palette';
import { formatRange, formatTimestamp, parseTime, parseTimeEnd } from '../../lib/time';
import Icon, { KindGlyph } from '../../components/Icon';
import './map.css';

/** CARTO 深色底圖（免 API key，需標註 CARTO 與 OpenStreetMap）。 */
const BASEMAP_TILES = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const BASEMAP_ATTR = '© CARTO · © OpenStreetMap 貢獻者';

const GROUPS = [
  { key: 'event', label: '事件', color: '#fbbf24' },
  { key: 'person', label: '人物', color: '#7dd3fc' },
  { key: 'org', label: '組織', color: '#a78bfa' },
  { key: 'place', label: '地點', color: '#34d399' },
  { key: 'country', label: '國家', color: '#f472b6' },
] as const;

type GroupKey = (typeof GROUPS)[number]['key'];
type GroupToggle = Record<GroupKey, boolean>;

const ALL_GROUP_KEYS = GROUPS.map((g) => g.key) as GroupKey[];

/** 點顏色依節點型別（與宇宙、圖例一致）；群組色只用於聚合環與不確定性光暈。 */
const KIND_COLOR_ARGS: unknown[] = Object.values(KIND_STYLES).flatMap((st) => [st.key, st.color]);

interface WmGeoProps {
  node_id: string;
  role: string;
  name: string;
  precision: string;
  kind: string;
  title: string;
  valid_from?: string | null;
  valid_to?: string | null;
  demo?: boolean;
  source_ids?: string[];
  group: GroupKey;
}

type WmFeature = Feature<Geometry, WmGeoProps>;

/** 地理角色 → 圖層群組。少見角色用 kind 回推，避免資料被默默丟掉。 */
function groupOfFeature(f: GeoFeature): GroupKey {
  const role = (f.properties.role ?? '').toLowerCase();
  const kind = (f.properties.kind ?? '') as NodeKind;
  if (role === 'territory_claim' || role === 'controlled_area' || role === 'nationality') return 'country';
  if (role === 'hq' || role === 'facility' || role === 'branch' || role === 'facility_site') return 'org';
  if (role === 'birth_place' || role === 'death_place' || role === 'residence' || role === 'activity_area') {
    if (kind === 'organization') return 'org';
    if (kind === 'country') return 'country';
    return 'person';
  }
  if (role === 'event_location') return 'event';
  switch (kind) {
    case 'event':
      return 'event';
    case 'person':
      return 'person';
    case 'organization':
      return 'org';
    case 'country':
      return 'country';
    default:
      return 'place';
  }
}

function featureInWindow(f: GeoFeature, from: number | null, to: number | null): boolean {
  const start = parseTime(f.properties.valid_from);
  const end = parseTimeEnd(f.properties.valid_to) ?? start;
  if (start == null && end == null) return true;
  if (from != null && end != null && end < from) return false;
  if (to != null && start != null && start > to) return false;
  return true;
}

function precisionCopy(precision: string, group: GroupKey): { label: string; note: string } {
  const p = (precision ?? '').toLowerCase();
  const label = labelize(PRECISION_LABELS, p, '未標示');
  if (p === 'exact') return { label, note: '位置為精確座標。' };
  if (p === '') return { label: '未標示', note: '資料未提供精度，位置僅供參考。' };
  const groupNote =
    group === 'person'
      ? '人物位置以居住／活動範圍表示，非即時位置。'
      : group === 'org'
        ? '組織位置可能是總部或設施所在城市，非精確門牌。'
        : '位置落在該尺度範圍內，不代表精確點位。';
  return { label, note: groupNote };
}

function emptyCollection(): FeatureCollection<Geometry, WmGeoProps> {
  return { type: 'FeatureCollection', features: [] };
}

function toFeature(f: GeoFeature): WmFeature {
  return {
    type: 'Feature',
    geometry: f.geometry as unknown as Geometry,
    properties: { ...f.properties, group: groupOfFeature(f) },
  };
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    name: '世界模型 2.5D 深色地圖',
    sources: {
      'wm-basemap': {
        type: 'raster',
        tiles: [BASEMAP_TILES],
        tileSize: 256,
        maxzoom: 19,
        attribution: BASEMAP_ATTR,
      },
    },
    layers: [
      { id: 'wm-bg', type: 'background', paint: { 'background-color': '#04060d' } },
      {
        id: 'wm-basemap-layer',
        type: 'raster',
        source: 'wm-basemap',
        paint: {
          'raster-opacity': 0.9,
          'raster-saturation': -0.3,
          'raster-contrast': 0.12,
          'raster-brightness-min': 0.02,
          'raster-brightness-max': 0.9,
        },
      },
    ],
  };
}

type AddLayerArg = Parameters<MapLibreMap['addLayer']>[0];

function addLayer(map: MapLibreMap, layer: Record<string, unknown>) {
  map.addLayer(layer as unknown as AddLayerArg);
}

function setLayerFilter(map: MapLibreMap, id: string, filter: unknown) {
  if (!map.getLayer(id)) return;
  map.setFilter(id, filter as FilterSpecification);
}

function setVisibility(map: MapLibreMap, id: string, visible: boolean) {
  if (!map.getLayer(id)) return;
  map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
}

const SRC_POINTS = (g: GroupKey) => `wm-pts-${g}`;
const LYR_HALO = (g: GroupKey) => `wm-halo-${g}`;
const LYR_CLUSTER = (g: GroupKey) => `wm-cluster-${g}`;
const LYR_CLUSTER_RING = (g: GroupKey) => `wm-cluster-ring-${g}`;
const LYR_POINT = (g: GroupKey) => `wm-point-${g}`;
const LYR_SELECTED = (g: GroupKey) => `wm-selected-${g}`;

const LYR_LINE_GLOW = 'wm-line-glow';
const LYR_LINE = 'wm-line';
const LYR_POLY_FILL = 'wm-poly-fill';
const LYR_POLY_OUTLINE = 'wm-poly-outline';
const LYR_POLY_CLAIM = 'wm-poly-claim';

function interactiveLayerIds(): string[] {
  const ids: string[] = [];
  for (const g of ALL_GROUP_KEYS) {
    ids.push(LYR_CLUSTER(g), LYR_POINT(g), LYR_HALO(g));
  }
  return ids;
}

function buildLayers(map: MapLibreMap) {
  for (const g of GROUPS) {
    map.addSource(SRC_POINTS(g.key), {
      type: 'geojson',
      data: emptyCollection(),
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 8,
    });
  }
  map.addSource('wm-lines', { type: 'geojson', data: emptyCollection() });
  map.addSource('wm-polys', { type: 'geojson', data: emptyCollection() });

  // 多邊形（國家控制區／主權主張）先畫，讓點與線在上層
  addLayer(map, {
    id: LYR_POLY_FILL,
    type: 'fill',
    source: 'wm-polys',
    paint: {
      'fill-color': ['match', ['get', 'group'], ...GROUP_MATCH_ARGS(), '#94a3b8'],
      'fill-opacity': 0.16,
    },
  });
  addLayer(map, {
    id: LYR_POLY_OUTLINE,
    type: 'line',
    source: 'wm-polys',
    filter: ['!=', ['get', 'role'], 'territory_claim'],
    paint: {
      'line-color': ['match', ['get', 'group'], ...GROUP_MATCH_ARGS(), '#94a3b8'],
      'line-width': 1.2,
      'line-opacity': 0.65,
    },
  });
  // 主權主張：虛線＋較低不透明度，明確表示「不是已定案邊界」
  addLayer(map, {
    id: LYR_POLY_CLAIM,
    type: 'line',
    source: 'wm-polys',
    filter: ['==', ['get', 'role'], 'territory_claim'],
    paint: {
      'line-color': ['match', ['get', 'group'], ...GROUP_MATCH_ARGS(), '#94a3b8'],
      'line-width': 1.3,
      'line-opacity': 0.7,
      'line-dasharray': [4, 2.5],
    },
  });

  addLayer(map, {
    id: LYR_LINE_GLOW,
    type: 'line',
    source: 'wm-lines',
    paint: {
      'line-color': ['match', ['get', 'group'], ...GROUP_MATCH_ARGS(), '#94a3b8'],
      'line-width': 5,
      'line-opacity': 0.14,
      'line-blur': 3,
    },
  });
  addLayer(map, {
    id: LYR_LINE,
    type: 'line',
    source: 'wm-lines',
    paint: {
      'line-color': ['match', ['get', 'group'], ...GROUP_MATCH_ARGS(), '#94a3b8'],
      'line-width': 1.8,
      'line-opacity': 0.9,
    },
  });

  for (const g of GROUPS) {
    // 不確定性光暈：非 exact 精度才畫，半徑依精度放大
    addLayer(map, {
      id: LYR_HALO(g.key),
      type: 'circle',
      source: SRC_POINTS(g.key),
      filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'precision'], 'exact']],
      paint: {
        'circle-color': g.color,
        'circle-opacity': 0.1,
        'circle-radius': [
          'match',
          ['get', 'precision'],
          'city',
          11,
          'region',
          18,
          'country',
          28,
          'coarse',
          36,
          17,
        ],
        'circle-blur': 1,
      },
    });
    addLayer(map, {
      id: LYR_CLUSTER_RING(g.key),
      type: 'circle',
      source: SRC_POINTS(g.key),
      filter: ['has', 'point_count'],
      paint: {
        'circle-radius': ['step', ['get', 'point_count'], 27, 8, 34, 30, 44, 100, 56],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-color': g.color,
        'circle-stroke-opacity': 0.22,
        'circle-stroke-width': 1,
      },
    });
    addLayer(map, {
      id: LYR_CLUSTER(g.key),
      type: 'circle',
      source: SRC_POINTS(g.key),
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': g.color,
        'circle-opacity': 0.22,
        'circle-radius': ['step', ['get', 'point_count'], 16, 8, 21, 30, 28, 100, 36],
        'circle-stroke-color': g.color,
        'circle-stroke-opacity': 0.8,
        'circle-stroke-width': 1.2,
      },
    });
    addLayer(map, {
      id: LYR_POINT(g.key),
      type: 'circle',
      source: SRC_POINTS(g.key),
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['match', ['get', 'kind'], ...KIND_COLOR_ARGS, '#94a3b8'],
        'circle-radius': [
          'match',
          ['get', 'precision'],
          'exact',
          4.6,
          'city',
          5.4,
          'region',
          7.2,
          'country',
          9,
          'coarse',
          10.5,
          6,
        ],
        'circle-opacity': 0.92,
        'circle-stroke-color': '#04060d',
        'circle-stroke-width': 1,
      },
    });
    addLayer(map, {
      id: LYR_SELECTED(g.key),
      type: 'circle',
      source: SRC_POINTS(g.key),
      filter: ['==', ['get', 'node_id'], '__none__'],
      paint: {
        'circle-color': 'rgba(125,211,252,0.16)',
        'circle-radius': 15,
        'circle-stroke-color': '#e6f7ff',
        'circle-stroke-width': 1.6,
      },
    });
  }
}

/** 產生 match 表達式的中間參數（key/color 成對），最後再給預設色。 */
function GROUP_MATCH_ARGS(): unknown[] {
  const out: unknown[] = [];
  for (const g of GROUPS) out.push(g.key, g.color);
  return out;
}

function extendBounds(bounds: maplibregl.LngLatBounds, coords: unknown) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    const lon = coords[0];
    const lat = coords[1];
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat) <= 90) bounds.extend([lon, lat]);
    return;
  }
  for (const c of coords) extendBounds(bounds, c);
}

function popupDom(feature: WmFeature, node: WmNode | undefined): HTMLDivElement {
  const p = feature.properties;
  const group = GROUPS.find((g) => g.key === p.group) ?? GROUPS[3];
  const kind = kindStyle(p.kind);
  const precision = precisionCopy(p.precision, p.group);
  const root = document.createElement('div');
  root.className = 'map-pop';

  const head = document.createElement('div');
  head.className = 'map-pop-head';
  const dot = document.createElement('i');
  dot.style.background = group.color;
  const kindLabel = document.createElement('span');
  kindLabel.textContent = kind.label;
  head.append(dot, kindLabel);
  if (p.demo) {
    const demo = document.createElement('span');
    demo.className = 'badge badge-warn';
    demo.textContent = '示範';
    head.append(demo);
  }
  root.append(head);

  const title = document.createElement('div');
  title.className = 'map-pop-title';
  title.textContent = node?.title || p.title || p.name || '未命名地點';
  root.append(title);

  const rows: [string, string][] = [];
  rows.push([
    '地理角色',
    `${labelize(GEO_ROLE_LABELS, p.role, p.role || '未標示')}${p.name && p.name !== title.textContent ? ` · ${p.name}` : ''}`,
  ]);
  rows.push(['精度', `${precision.label}｜${precision.note}`]);
  if (p.valid_from || p.valid_to) rows.push(['有效期間', formatRange(p.valid_from, p.valid_to)]);
  if (node?.epistemic_status) rows.push(['知識狀態', labelize(EPISTEMIC_LABELS, node.epistemic_status)]);
  if (p.source_ids && p.source_ids.length > 0) rows.push(['來源', `${p.source_ids.length} 筆`]);

  for (const [k, v] of rows) {
    const row = document.createElement('div');
    row.className = 'map-pop-row';
    const key = document.createElement('span');
    key.className = 'map-pop-key';
    key.textContent = k;
    const val = document.createElement('span');
    val.textContent = v;
    row.append(key, val);
    root.append(row);
  }

  const hint = document.createElement('div');
  hint.className = 'map-pop-hint';
  hint.textContent = '點擊以選取節點並開啟詳情';
  root.append(hint);
  return root;
}

function clusterDom(count: number): HTMLDivElement {
  const root = document.createElement('div');
  root.className = 'map-pop';
  const title = document.createElement('div');
  title.className = 'map-pop-title';
  title.textContent = `${count} 個地理特徵`;
  root.append(title);
  const hint = document.createElement('div');
  hint.className = 'map-pop-hint';
  hint.textContent = '聚合顯示中；點擊可放大並拆開群集。';
  root.append(hint);
  return root;
}

export default function MapView(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const filters = useAppStore((s) => s.filters);
  const timeWindow = useAppStore((s) => s.window);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const focusNode = useAppStore((s) => s.focusNode);
  const setWindow = useAppStore((s) => s.setWindow);
  const bounds = useAppStore((s) => s.bounds);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const fittedRef = useRef(false);
  const hoveredRef = useRef<string | null>(null);

  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [basemapError, setBasemapError] = useState(false);
  const [basemap, setBasemap] = useState<'dark' | 'plain'>('dark');
  const [groupOn, setGroupOn] = useState<GroupToggle>({
    event: true,
    person: true,
    org: true,
    place: true,
    country: true,
  });

  const allFeatures = useMemo<GeoFeature[]>(() => model?.geo?.features ?? [], [model]);

  const filterVisibleNodeIds = useMemo(() => {
    if (!model) return new Set<string>();
    const nodes = filterNodes(model, model.nodes, filters, { from: null, to: null }, null);
    return new Set(nodes.map((n) => n.id));
  }, [model, filters]);

  const features = useMemo<WmFeature[]>(() => {
    const from = timeWindow.from;
    const to = timeWindow.to;
    const out: WmFeature[] = [];
    for (const f of allFeatures) {
      if (!f?.geometry || !f.properties) continue;
      if (f.properties.demo && filters.hideDemo) continue;
      const nodeId = f.properties.node_id;
      if (nodeId && model?.nodeById.has(nodeId) && !filterVisibleNodeIds.has(nodeId)) continue;
      const roles = filters.geoRoles;
      if (roles.length > 0 && !roles.includes(f.properties.role)) continue;
      if (!featureInWindow(f, from, to)) continue;
      const geom = f.geometry.type;
      if (geom !== 'Point' && geom !== 'LineString' && geom !== 'Polygon') continue;
      out.push(toFeature(f));
    }
    return out;
  }, [allFeatures, timeWindow, filters.hideDemo, filters.geoRoles, filterVisibleNodeIds, model]);

  const grouped = useMemo(() => {
    const points: Record<GroupKey, WmFeature[]> = {
      event: [],
      person: [],
      org: [],
      place: [],
      country: [],
    };
    const lines: WmFeature[] = [];
    const polys: WmFeature[] = [];
    for (const f of features) {
      if (f.geometry.type === 'Point') points[f.properties.group].push(f);
      else if (f.geometry.type === 'LineString') lines.push(f);
      else if (f.geometry.type === 'Polygon') polys.push(f);
    }
    return { points, lines, polys };
  }, [features]);

  const counts = useMemo(() => {
    const c: Record<GroupKey, number> = { event: 0, person: 0, org: 0, place: 0, country: 0 };
    for (const f of features) c[f.properties.group] += 1;
    return c;
  }, [features]);

  // ── 建立地圖 ─────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: el,
        style: baseStyle(),
        center: [12, 22],
        zoom: 1.35,
        minZoom: 0.5,
        maxZoom: 12,
        attributionControl: false,
        fadeDuration: 120,
        renderWorldCopies: true,
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
      return;
    }
    mapRef.current = map;
    map.dragRotate.disable();
    map.touchZoomRotate.disableRotation();
    map.keyboard.disable(); // 避免與站內快捷鍵衝突

    const onLoad = () => {
      try {
        buildLayers(map);
      } catch (err) {
        setMapError(err instanceof Error ? err.message : String(err));
        return;
      }
      setReady(true);
    };
    map.on('load', onLoad);
    map.on('error', (e) => {
      const msg = `${e?.error?.message ?? ''}`.toLowerCase();
      if (msg.includes('cartocdn') || msg.includes('basemap') || msg.includes('tile')) {
        setBasemapError(true);
      }
    });
    return () => {
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ── 保持最新資料、篩選、時間窗 ────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const g of ALL_GROUP_KEYS) {
      const src = map.getSource(SRC_POINTS(g)) as GeoJSONSource | undefined;
      src?.setData({
        type: 'FeatureCollection',
        features: grouped.points[g],
      } as unknown as Parameters<GeoJSONSource['setData']>[0]);
    }
    (map.getSource('wm-lines') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: grouped.lines,
    } as unknown as Parameters<GeoJSONSource['setData']>[0]);
    (map.getSource('wm-polys') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: grouped.polys,
    } as unknown as Parameters<GeoJSONSource['setData']>[0]);
  }, [ready, grouped]);

  // ── 圖層開關 ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const active = ALL_GROUP_KEYS.filter((k) => groupOn[k]);
    for (const g of ALL_GROUP_KEYS) {
      const on = groupOn[g];
      for (const id of [LYR_HALO(g), LYR_CLUSTER(g), LYR_CLUSTER_RING(g), LYR_POINT(g), LYR_SELECTED(g)]) {
        setVisibility(map, id, on);
      }
    }
    const lineFilter = ['in', ['get', 'group'], ['literal', active]];
    setLayerFilter(map, LYR_LINE, active.length ? lineFilter : ['==', ['get', 'group'], '__none__']);
    setLayerFilter(map, LYR_LINE_GLOW, active.length ? lineFilter : ['==', ['get', 'group'], '__none__']);
    setLayerFilter(map, LYR_POLY_FILL, active.length ? lineFilter : ['==', ['get', 'group'], '__none__']);
    setLayerFilter(
      map,
      LYR_POLY_OUTLINE,
      active.length
        ? ['all', ['!=', ['get', 'role'], 'territory_claim'], lineFilter]
        : ['==', ['get', 'group'], '__none__'],
    );
    setLayerFilter(
      map,
      LYR_POLY_CLAIM,
      active.length
        ? ['all', ['==', ['get', 'role'], 'territory_claim'], lineFilter]
        : ['==', ['get', 'group'], '__none__'],
    );
  }, [ready, groupOn]);

  // ── 底圖切換 ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setVisibility(map, 'wm-basemap-layer', basemap === 'dark');
  }, [ready, basemap]);

  // ── 選取高亮 ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const g of ALL_GROUP_KEYS) {
      setLayerFilter(map, LYR_SELECTED(g), ['==', ['get', 'node_id'], selectedId ?? '__none__']);
    }
  }, [ready, selectedId]);

  // ── 全圖範圍 ─────────────────────────────────────────────────
  const fitToData = useCallback(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const box = new maplibregl.LngLatBounds();
    for (const f of features) {
      if (f.geometry.type === 'Point') {
        const [lon, lat] = f.geometry.coordinates;
        if (Number.isFinite(lon) && Number.isFinite(lat)) box.extend([lon, lat]);
      } else if (f.geometry.type === 'LineString') {
        for (const c of f.geometry.coordinates) box.extend(c as [number, number]);
      } else if (f.geometry.type === 'Polygon') {
        for (const ring of f.geometry.coordinates) for (const c of ring) box.extend(c as [number, number]);
      }
    }
    if (!box.isEmpty()) {
      map.fitBounds(box, {
        padding: { top: 90, bottom: 80, left: 70, right: 70 },
        maxZoom: 4.6,
        duration: reducedMotion ? 0 : 700,
      });
    } else {
      map.easeTo({ center: [12, 22], zoom: 1.35, duration: 0 });
    }
  }, [ready, features, reducedMotion]);

  useEffect(() => {
    fittedRef.current = false;
  }, [model]);

  useEffect(() => {
    if (!ready || fittedRef.current || features.length === 0) return;
    fittedRef.current = true;
    fitToData();
  }, [ready, features.length, fitToData]);

  // ── Popup / hover / click ────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const ensurePopup = () => {
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 14,
          maxWidth: '300px',
          className: 'wm-popup',
        });
      }
      return popupRef.current;
    };

    const layerIds = interactiveLayerIds();

    const showTip = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0] as unknown as WmFeature | undefined;
      if (!feature) return;
      const p = feature.properties;
      const node = p?.node_id ? useAppStore.getState().model?.nodeById.get(p.node_id) : undefined;
      map.getCanvas().style.cursor = 'pointer';
      if (p?.node_id && hoveredRef.current !== p.node_id) hoveredRef.current = p.node_id;
      const popup = ensurePopup();
      const clusterCount = (p as unknown as { point_count?: number } | undefined)?.point_count;
      popup
        .setLngLat(e.lngLat)
        .setDOMContent(clusterCount != null ? clusterDom(clusterCount) : popupDom(feature, node))
        .addTo(map);
    };

    const hideTip = () => {
      map.getCanvas().style.cursor = '';
      popupRef.current?.remove();
    };

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const feature = e.features?.[0] as unknown as WmFeature | undefined;
      if (!feature) return;
      const p = feature.properties;
      if (p && (p as unknown as { point_count?: number }).point_count != null) {
        // 聚合點：放大一級，讓使用者逐步拆開
        map.easeTo({
          center: e.lngLat,
          zoom: Math.min(map.getZoom() + 1.9, 9),
          duration: reducedMotion ? 0 : 420,
        });
        return;
      }
      if (p?.node_id) {
        select(p.node_id);
      }
    };

    for (const id of layerIds) {
      map.on('mousemove', id, showTip);
      map.on('mouseleave', id, hideTip);
      map.on('click', id, onClick);
    }

    const onEmptyClick = (e: maplibregl.MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: layerIds });
      if (hits.length === 0) select(null);
    };
    map.on('click', onEmptyClick);

    return () => {
      for (const id of layerIds) {
        map.off('mousemove', id, showTip);
        map.off('mouseleave', id, hideTip);
        map.off('click', id, onClick);
      }
      map.off('click', onEmptyClick);
      hideTip();
    };
  }, [ready, select, reducedMotion]);

  const zoomBy = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ zoom: map.getZoom() + delta, duration: reducedMotion ? 0 : 240 });
  };

  const toggleGroup = (key: GroupKey) => {
    setGroupOn((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hasGeo = allFeatures.length > 0;

  return (
    <div className="mapv-root">
      <div className="mapv-canvas" ref={containerRef} aria-label="2.5D 世界地圖" />

      {/* 圖層控制 */}
      <div className="mapv-layers panel">
        <div className="mapv-layers-head">
          <Icon name="layers" size={14} />
          <span>圖層</span>
          <span className="spacer" />
          <span className="micro">{features.length} 個地理特徵</span>
        </div>
        <div className="mapv-layer-list">
          {GROUPS.map((g) => {
            const on = groupOn[g.key];
            return (
              <button
                key={g.key}
                className={`mapv-layer-row ${on ? 'is-on' : ''}`}
                onClick={() => toggleGroup(g.key)}
                aria-pressed={on}
                title={`${on ? '隱藏' : '顯示'}${g.label}圖層`}
              >
                <span className="mapv-check">{on ? <Icon name="check" size={10} /> : null}</span>
                <i style={{ background: g.color }} />
                <span className="mapv-layer-name">{g.label}</span>
                <span className="mapv-layer-count">{counts[g.key]}</span>
              </button>
            );
          })}
        </div>
        <div className="mapv-basemap">
          <span className="micro">底圖</span>
          <div className="seg">
            <button className={basemap === 'dark' ? 'is-on' : ''} onClick={() => setBasemap('dark')}>
              暗色
            </button>
            <button className={basemap === 'plain' ? 'is-on' : ''} onClick={() => setBasemap('plain')}>
              無底圖
            </button>
          </div>
        </div>
        <div className="mapv-actions">
          <button className="btn btn-sm" onClick={fitToData} disabled={!hasGeo} title="把視野還原到所有資料範圍">
            <Icon name="expand" size={12} /> 回到全圖
          </button>
          <button className="btn btn-sm" onClick={() => zoomBy(1)} aria-label="放大">
            <Icon name="zoomIn" size={13} />
          </button>
          <button className="btn btn-sm" onClick={() => zoomBy(-1)} aria-label="縮小">
            <Icon name="zoomOut" size={13} />
          </button>
        </div>
        {basemapError && (
          <div className="mapv-warn" role="status">
            <Icon name="info" size={12} /> 底圖暫時無法載入，仍以深色背景顯示所有資料圖層。
          </div>
        )}
      </div>

      <div className="mapv-legend">
        <span>
          <i className="mapv-circle" /> 圓點＝地點（顏色依型別、大小依精度）
        </span>
        <span>
          <i className="mapv-halo" /> 光暈＝位置不確定範圍（圖層群組色）
        </span>
        <span>
          <i className="mapv-dash" /> 虛線＝主權主張／爭議邊界
        </span>
      </div>

      <div className="mapv-attribution">
        <span>
          底圖 ©{' '}
          <a href="https://carto.com/attributions" target="_blank" rel="noreferrer noopener">
            CARTO
          </a>{' '}
          ·{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
            OpenStreetMap 貢獻者
          </a>
          （ODbL）
        </span>
        <span className="mapv-attribution-sep">·</span>
        <span>
          資料：世界模型匯出
          {model?.meta?.generated_at ? `（${formatTimestamp(model.meta.generated_at)}）` : ''}
        </span>
      </div>

      {mapError && (
        <div className="mapv-overlay">
          <div className="panel mapv-empty fade-up">
            <Icon name="map" size={24} />
            <strong>無法啟動地圖</strong>
            <p className="micro">無法建立 MapLibre 地圖（{mapError}）。以下仍列出具有座標的節點。</p>
            <div className="mapv-fallback scroll">
              {features
                .filter((f) => f.properties.node_id)
                .slice(0, 24)
                .map((f) => (
                  <button
                    key={`${f.properties.node_id}-${f.properties.role}-${f.properties.name}`}
                    className="link-btn"
                    onClick={() => select(f.properties.node_id)}
                  >
                    <KindGlyph kind={f.properties.kind} color={kindStyle(f.properties.kind).color} size={12} />
                    <span className="truncate">{f.properties.title || f.properties.name}</span>
                    <span className="spacer" />
                    <span className="micro">{labelize(GEO_ROLE_LABELS, f.properties.role, f.properties.role)}</span>
                  </button>
                ))}
              {features.length === 0 && <div className="micro">目前沒有具座標的節點。</div>}
            </div>
          </div>
        </div>
      )}

      {!mapError && !ready && (
        <div className="mapv-overlay mapv-overlay-soft">
          <div className="panel mapv-empty">
            <span className="spin">
              <Icon name="compass" size={22} />
            </span>
            <strong>正在建立地圖</strong>
          </div>
        </div>
      )}

      {!mapError && ready && hasGeo && features.length === 0 && (
        <div className="mapv-overlay">
          <div className="panel mapv-empty fade-up">
            <Icon name="clock" size={24} />
            <strong>目前時間窗內沒有地理資料</strong>
            <p className="micro">地圖只顯示與時間窗重疊的地點與範圍；放寬時間或清除篩選即可看到更多位置。</p>
            <div className="row">
              <button className="btn btn-sm" onClick={() => setWindow(bounds[0], bounds[1])}>
                顯示全時段
              </button>
              <button className="btn btn-sm" onClick={() => fitToData()}>
                回到全圖
              </button>
            </div>
          </div>
        </div>
      )}

      {!mapError && ready && !hasGeo && (
        <div className="mapv-overlay">
          <div className="panel mapv-empty fade-up">
            <Icon name="map" size={24} />
            <strong>世界模型目前沒有地理資料</strong>
            <p className="micro">
              只有具備座標的節點會出現在地圖。匯出器寫入 geo 特徵後，地圖會自動顯示；其他視圖仍可正常使用。
            </p>
          </div>
        </div>
      )}

      {selectedId && model?.nodeById.get(selectedId)?.geo.length ? (
        <div className="mapv-selected-tip">
          <KindGlyph
            kind={model.nodeById.get(selectedId)?.kind ?? 'unknown'}
            color={kindStyle(model.nodeById.get(selectedId)?.kind).color}
            size={12}
          />
          <span className="truncate">{model.nodeById.get(selectedId)?.title}</span>
          <button
            className="btn btn-sm"
            onClick={() => selectedId && focusNode(selectedId)}
            title="在宇宙中聚焦此節點"
          >
            <Icon name="universe" size={11} /> 宇宙聚焦
          </button>
        </div>
      ) : null}
    </div>
  );
}
