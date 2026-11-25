import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { WmNode } from '../../data/types';
import { filterNodes, inWindow } from '../../lib/select';
import { formatRange, parseTime, parseTimeEnd } from '../../lib/time';
import { EPISTEMIC_LABELS, kindStyle, labelize } from '../../lib/palette';
import Icon, { KindGlyph } from '../../components/Icon';
import './timeline.css';

const DAY = 86_400_000;
const ROW_H = 27;
const AXIS_H = 28;
const MAX_LANES = 20;
const MAX_BARS_PER_LANE = 240;
const MIN_SPAN_DAYS = 14;

const LANE_ORDER = [
  'event',
  'person',
  'organization',
  'country',
  'technology',
  'resource',
  'knowledge',
  'claim',
  'evidence',
  'source',
  'hypothesis',
  'scenario',
  'analysis',
];

const TIME_PRECISION_LABELS: Record<string, string> = {
  exact_day: '精確日期',
  exact: '精確日期',
  month: '年月',
  year: '年份',
  circa: '約略時間',
  range: '區間',
  period: '期間',
  unknown: '未知精度',
};

interface TimedNode {
  node: WmNode;
  start: number;
  end: number;
  precise: boolean;
  precisionText: string;
}

interface Lane {
  key: string;
  label: string;
  color: string;
  kind: string;
  nodes: TimedNode[];
  density: boolean;
}

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  node?: TimedNode;
  count?: number;
}

interface HoverState {
  x: number;
  y: number;
  hit: Hit;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return `rgba(148, 163, 184, ${alpha})`;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function formatTick(ms: number, withMonth: boolean): string {
  const d = new Date(ms);
  return withMonth
    ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    : `${d.getUTCFullYear()}`;
}

/** 依視野跨度選刻度：年、季、月。 */
function makeTicks(t0: number, t1: number): { ticks: number[]; withMonth: boolean; stepMs: number } {
  const spanDays = (t1 - t0) / DAY;
  const ticks: number[] = [];
  if (spanDays > 900) {
    const years = spanDays / 365.25;
    const candidates = [1, 2, 5, 10, 20, 25, 50, 100, 200];
    const step = candidates.find((c) => years / c <= 10) ?? 500;
    const startYear = Math.ceil(new Date(t0).getUTCFullYear() / step) * step;
    for (let y = startYear; ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > t1) break;
      ticks.push(t);
      if (ticks.length > 60) break;
    }
    return { ticks, withMonth: false, stepMs: step * 365.25 * DAY };
  }
  if (spanDays > 40) {
    const months = Math.max(1, Math.ceil((spanDays / 30.44) / 10));
    const d = new Date(t0);
    let y = d.getUTCFullYear();
    let m = Math.floor(d.getUTCMonth() / months) * months;
    for (let i = 0; i < 80; i += 1) {
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      if (t >= t0) ticks.push(t);
      m += months;
      while (m >= 12) {
        m -= 12;
        y += 1;
      }
    }
    return { ticks, withMonth: true, stepMs: months * 30.44 * DAY };
  }
  const days = Math.max(1, Math.ceil(spanDays / 12));
  const start = new Date(t0);
  const base = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  for (let i = 0; i < 80; i += 1) {
    const t = base + i * days * DAY;
    if (t > t1) break;
    if (t >= t0) ticks.push(t);
  }
  return { ticks, withMonth: true, stepMs: days * DAY };
}

export default function TimelineView(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const filters = useAppStore((s) => s.filters);
  const timeWindow = useAppStore((s) => s.window);
  const bounds = useAppStore((s) => s.bounds);
  const selectedId = useAppStore((s) => s.selectedId);
  const select = useAppStore((s) => s.select);
  const focusNode = useAppStore((s) => s.focusNode);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const plotRef = useRef<HTMLCanvasElement | null>(null);
  const axisRef = useRef<HTMLCanvasElement | null>(null);
  const labelInnerRef = useRef<HTMLDivElement | null>(null);
  const hitsRef = useRef<Hit[]>([]);
  const panRef = useRef<{ active: boolean; startX: number; t0: number; t1: number; moved: boolean; pointerId: number } | null>(
    null,
  );
  const userZoomedRef = useRef(false);
  const viewportRef = useRef<{ t0: number; t1: number }>({ t0: bounds[0], t1: bounds[1] });
  const panRafRef = useRef<number | null>(null);
  const pendingViewRef = useRef<{ t0: number; t1: number } | null>(null);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [viewport, setViewport] = useState<{ t0: number; t1: number }>({ t0: bounds[0], t1: bounds[1] });
  const [onlyWindow, setOnlyWindow] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [panning, setPanning] = useState(false);
  const hoverNodeId = hover?.hit.node?.node.id ?? null;

  viewportRef.current = viewport;

  const allNodes = useMemo(
    () => (model ? filterNodes(model, model.nodes, filters, { from: null, to: null }, null) : []),
    [model, filters],
  );

  const timed = useMemo<TimedNode[]>(() => {
    const out: TimedNode[] = [];
    for (const node of allNodes) {
      const start = parseTime(node.start);
      if (start == null) continue;
      const end = parseTimeEnd(node.end) ?? start;
      const precision = (node.time_precision ?? '').toLowerCase();
      const isoDay = /^\d{4}-\d{2}-\d{2}/.test(node.start ?? '');
      const precise = precision === 'exact_day' || precision === 'exact' || (!precision && isoDay);
      out.push({
        node,
        start,
        end: Math.max(start, end),
        precise,
        precisionText: precise
          ? TIME_PRECISION_LABELS.exact_day
          : labelize(TIME_PRECISION_LABELS, precision || 'unknown', precision || '未知精度'),
      });
    }
    out.sort((a, b) => a.start - b.start || a.node.id.localeCompare(b.node.id));
    return out;
  }, [allNodes]);

  const lanes = useMemo<Lane[]>(() => {
    const byKind = new Map<string, TimedNode[]>();
    for (const item of timed) {
      const arr = byKind.get(item.node.kind);
      if (arr) arr.push(item);
      else byKind.set(item.node.kind, [item]);
    }
    const present = [...byKind.keys()];
    const ordered = [
      ...LANE_ORDER.filter((k) => byKind.has(k)),
      ...present
        .filter((k) => !LANE_ORDER.includes(k))
        .sort((a, b) => (byKind.get(b)?.length ?? 0) - (byKind.get(a)?.length ?? 0)),
    ];

    const result: Lane[] = [];
    const overflow: TimedNode[] = [];
    for (const kind of ordered) {
      const nodes = byKind.get(kind) ?? [];
      if (ordered.length <= MAX_LANES || result.length < MAX_LANES - 1) {
        const st = kindStyle(kind);
        result.push({
          key: kind,
          label: st.label,
          color: st.color,
          kind,
          nodes,
          density: nodes.length > MAX_BARS_PER_LANE,
        });
      } else {
        overflow.push(...nodes);
      }
    }
    if (overflow.length > 0) {
      overflow.sort((a, b) => a.start - b.start);
      result.push({
        key: '__other',
        label: '其他類型',
        color: '#94a3b8',
        kind: 'unknown',
        nodes: overflow,
        density: true,
      });
    }
    return result;
  }, [timed]);

  const contentH = Math.max(lanes.length * ROW_H + 8, size.h);

  const fullSpan = Math.max(DAY, bounds[1] - bounds[0]);
  const minSpan = Math.max(DAY * MIN_SPAN_DAYS, fullSpan / 900);

  const clampViewport = useCallback(
    (t0: number, t1: number): { t0: number; t1: number } => {
      const b0 = bounds[0];
      const b1 = bounds[1];
      const full = b1 - b0;
      const span = clamp(t1 - t0, minSpan, full);
      if (span >= full) return { t0: b0, t1: b1 };
      const start = clamp(t0, b0, b1 - span);
      return { t0: start, t1: start + span };
    },
    [bounds, minSpan],
  );

  const queueViewport = useCallback((next: { t0: number; t1: number }) => {
    pendingViewRef.current = next;
    if (panRafRef.current != null) return;
    panRafRef.current = window.requestAnimationFrame(() => {
      panRafRef.current = null;
      const pending = pendingViewRef.current;
      if (pending) {
        viewportRef.current = pending;
        setViewport(pending);
      }
    });
  }, []);

  useEffect(
    () => () => {
      if (panRafRef.current != null) window.cancelAnimationFrame(panRafRef.current);
    },
    [],
  );

  // 資料或整體範圍改變時重置視野（使用者手動縮放過就保留）
  useEffect(() => {
    userZoomedRef.current = false;
    const next = { t0: bounds[0], t1: bounds[1] };
    viewportRef.current = next;
    setViewport(next);
  }, [bounds, model]);

  // 量測可用寬高
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 繪製
  const draw = useCallback(() => {
    const plot = plotRef.current;
    const axis = axisRef.current;
    if (!plot || !axis || size.w === 0) return;
    const W = size.w;
    const H = contentH;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    plot.style.height = `${H}px`;
    if (plot.width !== Math.round(W * dpr) || plot.height !== Math.round(H * dpr)) {
      plot.width = Math.round(W * dpr);
      plot.height = Math.round(H * dpr);
    }
    const ctx = plot.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const { t0, t1 } = viewport;
    const span = Math.max(1, t1 - t0);
    const xOf = (t: number) => ((t - t0) / span) * W;
    const windowFrom = timeWindow.from ?? bounds[0];
    const windowTo = timeWindow.to ?? bounds[1];
    const ticks = makeTicks(t0, t1);

    // 時間窗外遮暗（讓共用時間窗在時間軸上也看得見）
    const wf = xOf(windowFrom);
    const wt = xOf(windowTo);
    ctx.fillStyle = 'rgba(4, 6, 13, 0.42)';
    if (wf > 0) ctx.fillRect(0, 0, Math.min(wf, W), H);
    if (wt < W) ctx.fillRect(Math.max(wt, 0), 0, W - Math.max(wt, 0), H);
    ctx.fillStyle = 'rgba(125, 211, 252, 0.035)';
    ctx.fillRect(Math.max(wf, 0), 0, Math.min(wt, W) - Math.max(wf, 0), H);

    // 格線
    ctx.lineWidth = 1;
    for (const tick of ticks.ticks) {
      const x = Math.round(xOf(tick)) + 0.5;
      if (x < 0 || x > W) continue;
      ctx.strokeStyle = 'rgba(126, 160, 214, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    // 時間窗邊界
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.5)';
    ctx.setLineDash([4, 3]);
    for (const x of [wf, wt]) {
      const px = Math.round(clamp(x, 0, W)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const hits: Hit[] = [];

    lanes.forEach((lane, li) => {
      const laneTop = li * ROW_H;
      if (laneTop > H) return;
      ctx.strokeStyle = 'rgba(126, 160, 214, 0.06)';
      ctx.beginPath();
      ctx.moveTo(0, Math.round(laneTop + ROW_H) + 0.5);
      ctx.lineTo(W, Math.round(laneTop + ROW_H) + 0.5);
      ctx.stroke();

      const barH = 11;
      const top = laneTop + (ROW_H - barH) / 2;

      if (lane.density) {
        // 密度聚合：每個 5px 欄位代表一個區間，避免上千根 bar 拖垮繪製
        const binW = 5;
        const binCount = Math.max(1, Math.ceil(W / binW));
        const counts = new Float32Array(binCount);
        for (const item of lane.nodes) {
          if (onlyWindow && !inWindow(item.node, { from: windowFrom, to: windowTo })) continue;
          const xi = clamp(Math.floor(xOf(item.start) / binW), 0, binCount - 1);
          counts[xi] += 1;
        }
        let max = 1;
        for (let i = 0; i < binCount; i += 1) max = Math.max(max, counts[i]);
        for (let i = 0; i < binCount; i += 1) {
          const count = counts[i];
          if (count <= 0) continue;
          const h = 3 + (count / max) * barH;
          const x = i * binW;
          ctx.fillStyle = hexToRgba(lane.color, 0.3 + 0.6 * (count / max));
          ctx.fillRect(x, top + barH - h, binW - 1, h);
          hits.push({ x, y: top + barH - h, w: binW - 1, h, count });
        }
        return;
      }

      for (const item of lane.nodes) {
        const outside = !inWindow(item.node, { from: windowFrom, to: windowTo });
        if (onlyWindow && outside) continue;
        const x1 = xOf(item.start);
        const x2 = Math.max(xOf(item.end), x1 + 2.6);
        if (x2 < -6 || x1 > W + 6) continue;
        const left = clamp(x1, -4, W + 4);
        const right = clamp(x2, -4, W + 4);
        const width = Math.max(2.6, right - left);
        const alpha = outside ? 0.24 : 0.95;
        const isSelected = item.node.id === selectedId;
        const isHovered = item.node.id === hoverNodeId;

        if (item.precise) {
          ctx.fillStyle = hexToRgba(lane.color, alpha);
        } else {
          const grad = ctx.createLinearGradient(left, 0, left + width, 0);
          grad.addColorStop(0, hexToRgba(lane.color, 0));
          grad.addColorStop(Math.min(0.22, 2.5 / width), hexToRgba(lane.color, alpha));
          grad.addColorStop(Math.max(0.78, 1 - 2.5 / width), hexToRgba(lane.color, alpha));
          grad.addColorStop(1, hexToRgba(lane.color, 0));
          ctx.fillStyle = grad;
        }
        roundRect(ctx, left, top, width, barH, 3);
        ctx.fill();

        if (!item.precise) {
          ctx.strokeStyle = hexToRgba(lane.color, alpha * 0.75);
          ctx.setLineDash([2, 2]);
          ctx.lineWidth = 1;
          roundRect(ctx, left + 0.5, top + 0.5, Math.max(1, width - 1), barH - 1, 3);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        if (isSelected) {
          ctx.strokeStyle = '#eaf7ff';
          ctx.lineWidth = 1.6;
          roundRect(ctx, left - 1, top - 1.5, width + 2, barH + 3, 4);
          ctx.stroke();
          ctx.fillStyle = 'rgba(125, 211, 252, 0.14)';
          roundRect(ctx, left - 3, top - 3.5, width + 6, barH + 7, 5);
          ctx.fill();
        } else if (isHovered) {
          ctx.strokeStyle = 'rgba(234, 247, 255, 0.75)';
          ctx.lineWidth = 1.2;
          roundRect(ctx, left - 0.5, top - 1, width + 1, barH + 2, 4);
          ctx.stroke();
        }
        hits.push({ x: left, y: top, w: width, h: barH, node: item });
      }
    });

    hitsRef.current = hits;
  }, [
    size.w,
    contentH,
    viewport,
    timeWindow,
    bounds,
    lanes,
    selectedId,
    hoverNodeId,
    onlyWindow,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 時間軸刻度（sticky 頂部）
  useEffect(() => {
    const axis = axisRef.current;
    if (!axis || size.w === 0) return;
    const W = size.w;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    axis.style.height = `${AXIS_H}px`;
    if (axis.width !== Math.round(W * dpr) || axis.height !== Math.round(AXIS_H * dpr)) {
      axis.width = Math.round(W * dpr);
      axis.height = Math.round(AXIS_H * dpr);
    }
    const ctx = axis.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, AXIS_H);
    ctx.fillStyle = 'rgba(5, 9, 17, 0.94)';
    ctx.fillRect(0, 0, W, AXIS_H);
    ctx.fillStyle = 'rgba(126, 160, 214, 0.16)';
    ctx.fillRect(0, AXIS_H - 1, W, 1);

    const { t0, t1 } = viewport;
    const span = Math.max(1, t1 - t0);
    const xOf = (t: number) => ((t - t0) / span) * W;
    const ticks = makeTicks(t0, t1);
    const minLabelGap = 56;
    let lastLabelX = -Infinity;

    ctx.font = '10px "Noto Sans TC", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const tick of ticks.ticks) {
      const x = xOf(tick);
      if (x < -20 || x > W + 20) continue;
      ctx.strokeStyle = 'rgba(126, 160, 214, 0.22)';
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + 0.5, AXIS_H - 7);
      ctx.lineTo(Math.round(x) + 0.5, AXIS_H);
      ctx.stroke();
      if (x - lastLabelX >= minLabelGap) {
        lastLabelX = x;
        ctx.fillStyle = 'rgba(148, 168, 196, 0.9)';
        ctx.fillText(formatTick(tick, ticks.withMonth), Math.max(3, x + 4), AXIS_H / 2 - 2);
      }
    }

    // 時間窗範圍標記
    const wf = clamp(xOf(timeWindow.from ?? bounds[0]), 0, W);
    const wt = clamp(xOf(timeWindow.to ?? bounds[1]), 0, W);
    if (wt > wf) {
      ctx.fillStyle = 'rgba(125, 211, 252, 0.16)';
      ctx.fillRect(wf, AXIS_H - 4, Math.max(2, wt - wf), 3);
    }
  }, [size.w, viewport, timeWindow, bounds]);

  // 滾輪縮放（原生事件才能 preventDefault）
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const px = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      const v = viewportRef.current;
      const anchor = v.t0 + px * (v.t1 - v.t0);
      const factor = Math.exp(e.deltaY * 0.0016);
      const newSpan = clamp((v.t1 - v.t0) * factor, minSpan, fullSpan);
      const next = clampViewport(anchor - px * newSpan, anchor - px * newSpan + newSpan);
      userZoomedRef.current = true;
      queueViewport(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [clampViewport, fullSpan, minSpan, queueViewport]);

  const localPoint = (e: { clientX: number; clientY: number }) => {
    const root = rootRef.current;
    const plot = plotRef.current;
    if (!root || !plot) return null;
    const plotRect = plot.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return {
      plotX: e.clientX - plotRect.left,
      plotY: e.clientY - plotRect.top,
      rootX: e.clientX - rootRect.left,
      rootY: e.clientY - rootRect.top,
    };
  };

  const hitTest = (px: number, py: number): Hit | null => {
    const hits = hitsRef.current;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const h = hits[i];
      if (px >= h.x - 2 && px <= h.x + h.w + 2 && py >= h.y - 5 && py <= h.y + h.h + 5) return h;
    }
    return null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const point = localPoint(e);
    if (!point) return;
    panRef.current = {
      active: true,
      startX: e.clientX,
      t0: viewportRef.current.t0,
      t1: viewportRef.current.t1,
      moved: false,
      pointerId: e.pointerId,
    };
    setPanning(true);
    (e.currentTarget as HTMLCanvasElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(e);
    if (!point) return;
    const pan = panRef.current;
    if (pan?.active) {
      const dx = e.clientX - pan.startX;
      if (Math.abs(dx) > 3) pan.moved = true;
      if (!pan.moved) return;
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      const delta = (-dx / rect.width) * (pan.t1 - pan.t0);
      const next = clampViewport(pan.t0 + delta, pan.t1 + delta);
      userZoomedRef.current = true;
      queueViewport(next);
      return;
    }
    const hit = hitTest(point.plotX, point.plotY);
    if (!hit) {
      if (hover) setHover(null);
      return;
    }
    const rootRect = rootRef.current?.getBoundingClientRect();
    if (!rootRect) return;
    let x = e.clientX - rootRect.left + 14;
    let y = e.clientY - rootRect.top + 14;
    x = clamp(x, 8, Math.max(8, rootRect.width - 310));
    y = clamp(y, 8, Math.max(8, rootRect.height - 150));
    setHover({ x, y, hit });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const pan = panRef.current;
    panRef.current = null;
    setPanning(false);
    if (pan && pan.pointerId === e.pointerId) {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
    }
    if (!pan || pan.moved) return;
    const point = localPoint(e);
    if (!point) return;
    const hit = hitTest(point.plotX, point.plotY);
    if (hit?.node) select(hit.node.node.id);
    else if (hit?.count != null) select(null);
    else select(null);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const point = localPoint(e);
    if (!point) return;
    const hit = hitTest(point.plotX, point.plotY);
    if (hit?.node) focusNode(hit.node.node.id);
  };

  const zoomAt = (fraction: number, delta: number) => {
    const v = viewportRef.current;
    const anchor = v.t0 + clamp(fraction, 0, 1) * (v.t1 - v.t0);
    const factor = delta > 0 ? 1.3 : 1 / 1.3;
    const newSpan = clamp((v.t1 - v.t0) * factor, minSpan, fullSpan);
    const next = clampViewport(anchor - fraction * newSpan, anchor - fraction * newSpan + newSpan);
    userZoomedRef.current = true;
    queueViewport(next);
  };

  const fitAll = () => {
    userZoomedRef.current = false;
    queueViewport({ t0: bounds[0], t1: bounds[1] });
  };

  const fitWindow = () => {
    const f = timeWindow.from ?? bounds[0];
    const t = timeWindow.to ?? bounds[1];
    if (t - f < DAY) return;
    userZoomedRef.current = true;
    queueViewport(clampViewport(f, t));
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el && labelInnerRef.current) {
      labelInnerRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    }
  };

  const windowNodeCount = useMemo(
    () => timed.reduce((acc, item) => acc + (inWindow(item.node, timeWindow) ? 1 : 0), 0),
    [timed, timeWindow],
  );
  const densityLanes = lanes.filter((l) => l.density).length;
  const noTimeCount = allNodes.length - timed.length;

  const hoverNode = hover?.hit.node;

  return (
    <div className="tl-root" ref={rootRef}>
      <div className="tl-head">
        <span className="tl-head-title">
          <Icon name="timeline" size={15} />
          <span>時間軸</span>
        </span>
        <span className="tl-stats">
          <span>
            節點 <b>{timed.length.toLocaleString('zh-TW')}</b>
          </span>
          <span className="tl-hide-sm">
            軌道 <b>{lanes.length}</b>
          </span>
          <span className="tl-hide-sm">
            時間窗內 <b>{windowNodeCount.toLocaleString('zh-TW')}</b>
          </span>
          {densityLanes > 0 && (
            <span className="tl-hide-sm">
              聚合軌道 <b>{densityLanes}</b>
            </span>
          )}
          {noTimeCount > 0 && (
            <span className="tl-hide-sm">
              無時間 <b>{noTimeCount}</b>
            </span>
          )}
        </span>
        <span className="tl-legend" aria-hidden="true">
          <span>
            <i className="precise" /> 精確時間
          </span>
          <span>
            <i className="vague" /> 模糊／期間
          </span>
        </span>
        <div className="tl-actions">
          <button
            className={`btn btn-sm ${onlyWindow ? 'is-on' : ''}`}
            onClick={() => setOnlyWindow((v) => !v)}
            aria-pressed={onlyWindow}
            title="只顯示落在時間窗內的節點；關閉時時間窗外的節點會淡化"
          >
            <Icon name="timeline" size={12} /> 僅時間窗
          </button>
          <button className="btn btn-sm" onClick={fitWindow} title="把視野縮放到目前的時間窗">
            <Icon name="target" size={12} /> 對齊時間窗
          </button>
          <button className="btn btn-sm" onClick={fitAll} title="顯示全部時段">
            <Icon name="expand" size={12} /> 全時段
          </button>
          <button className="btn btn-sm" onClick={() => zoomAt(0.5, -1)} aria-label="放大時間軸">
            <Icon name="zoomIn" size={13} />
          </button>
          <button className="btn btn-sm" onClick={() => zoomAt(0.5, 1)} aria-label="縮小時間軸">
            <Icon name="zoomOut" size={13} />
          </button>
        </div>
      </div>

      <div className="tl-body">
        <div className="tl-label-col">
          <div className="tl-label-axis">類型</div>
          <div className="tl-label-scroll">
            <div className="tl-label-inner" ref={labelInnerRef}>
              {lanes.map((lane) => (
                <div
                  key={lane.key}
                  className={`tl-lane-label ${lane.kind === 'unknown' ? 'is-other' : ''}`}
                  title={`${lane.label}：${lane.nodes.length} 個節點${
                    lane.density ? '（密度聚合顯示）' : ''
                  }`}
                >
                  <KindGlyph kind={lane.kind} color={lane.color} size={12} />
                  <span className="tl-lane-name">{lane.label}</span>
                  <span className="tl-lane-count">{lane.nodes.length}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="tl-scroll scroll" ref={scrollRef} onScroll={onScroll}>
          <canvas className="tl-axis" ref={axisRef} aria-hidden="true" />
          <canvas
            className={`tl-plot ${panning ? 'is-panning' : ''}`}
            ref={plotRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onDoubleClick={onDoubleClick}
            role="img"
            aria-label="水平時間軸：依節點類型分軌，滾輪縮放、拖曳平移、點擊選取"
          />
        </div>
      </div>

      {hover && hoverNode && (
        <div className="tl-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="tl-tip-head">
            <KindGlyph kind={hoverNode.node.kind} color={kindStyle(hoverNode.node.kind).color} size={12} />
            <span>{kindStyle(hoverNode.node.kind).label}</span>
            {hoverNode.node.demo && <span className="badge badge-warn">示範</span>}
          </div>
          <div className="tl-tip-title">{hoverNode.node.title}</div>
          <div className="tl-tip-row">{formatRange(hoverNode.node.start, hoverNode.node.end, hoverNode.node.time_precision)}</div>
          <div className={`tl-tip-row ${hoverNode.precise ? '' : 'is-vague'}`}>
            {hoverNode.precise ? '時間精度：精確日期' : `時間精度：${hoverNode.precisionText}（區間為近似範圍）`}
          </div>
          {hoverNode.node.epistemic_status && (
            <div className="tl-tip-row">知識狀態：{labelize(EPISTEMIC_LABELS, hoverNode.node.epistemic_status)}</div>
          )}
          <div className="tl-tip-hint">點擊選取 · 雙擊在宇宙中聚焦</div>
        </div>
      )}

      {hover && !hoverNode && hover.hit.count != null && (
        <div className="tl-tip" style={{ left: hover.x, top: hover.y }}>
          <div className="tl-tip-title">密度聚合</div>
          <div className="tl-tip-row">此區間共 {hover.hit.count} 個節點</div>
          <div className="tl-tip-hint">軌道節點過多，已聚合為密度欄；縮小時間範圍可看到個別節點。</div>
        </div>
      )}

      {allNodes.length === 0 && (
        <div className="tl-overlay">
          <div className="panel tl-empty fade-up">
            <Icon name="timeline" size={24} />
            <strong>目前篩選條件下沒有節點</strong>
            <p>時間軸與宇宙、地圖共用同一組篩選條件。放寬條件後，節點會依類型分軌出現在時間軸上。</p>
          </div>
        </div>
      )}

      {allNodes.length > 0 && timed.length === 0 && (
        <div className="tl-overlay">
          <div className="panel tl-empty fade-up">
            <Icon name="clock" size={24} />
            <strong>這些節點沒有時間資訊</strong>
            <p>時間軸只畫出有 start（或 end）時間的節點；沒有時間的節點仍可在宇宙與清單中檢視。</p>
          </div>
        </div>
      )}
    </div>
  );
}
