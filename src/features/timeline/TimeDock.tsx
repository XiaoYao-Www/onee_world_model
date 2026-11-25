import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useAppStore } from '../../store/useAppStore';
import { inWindow } from '../../lib/select';
import { parseTime } from '../../lib/time';
import Icon from '../../components/Icon';
import './timeline.css';

const DAY = 86_400_000;
const BIN_COUNT = 88;
const SPEEDS = [0.5, 1, 2, 4];

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function formatYearMonth(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const days = ms / DAY;
  if (days >= 730) return `${(days / 365.25).toFixed(1)} 年`;
  if (days >= 60) return `${Math.round(days / 30.44)} 個月`;
  if (days >= 2) return `${Math.round(days)} 天`;
  return '1 天內';
}

type DragMode = 'from' | 'to' | 'move';

interface DragState {
  mode: DragMode;
  startX: number;
  from: number;
  to: number;
  width: number;
  moved: boolean;
}

/**
 * 全域時間 dock：雙頭範圍滑桿、播放控制、事件密度直方圖。
 *
 * 所有時間狀態都放在 store（window / playing / playSpeed），因此宇宙、地圖、
 * 時間軸與 Inspector 永遠同步。拖曳時以 requestAnimationFrame 節流寫入 store，
 * 避免每個 pointermove 都觸發一次大型視圖重建。
 */
export function TimeDock(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const bounds = useAppStore((s) => s.bounds);
  const timeWindow = useAppStore((s) => s.window);
  const playing = useAppStore((s) => s.playing);
  const playSpeed = useAppStore((s) => s.playSpeed);
  const setWindow = useAppStore((s) => s.setWindow);
  const setPlaying = useAppStore((s) => s.setPlaying);
  const setPlaySpeed = useAppStore((s) => s.setPlaySpeed);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ from: number; to: number } | null>(null);

  const [dragging, setDragging] = useState(false);

  const span = Math.max(1, bounds[1] - bounds[0]);
  const minGap = Math.max(DAY, span / 400);

  const from = clamp(timeWindow.from ?? bounds[0], bounds[0], bounds[1]);
  const to = clamp(timeWindow.to ?? bounds[1], bounds[0], bounds[1]);
  const fromFrac = (from - bounds[0]) / span;
  const toFrac = (to - bounds[0]) / span;

  const starts = useMemo(() => {
    const arr: number[] = [];
    if (!model) return arr;
    for (const node of model.nodes) {
      const t = parseTime(node.start);
      if (t != null) arr.push(t);
    }
    return arr;
  }, [model]);

  const bins = useMemo(() => {
    const out = new Array<number>(BIN_COUNT).fill(0);
    for (const t of starts) {
      if (t < bounds[0] || t > bounds[1]) continue;
      const idx = clamp(Math.floor(((t - bounds[0]) / span) * BIN_COUNT), 0, BIN_COUNT - 1);
      out[idx] += 1;
    }
    return out;
  }, [starts, bounds, span]);

  const maxBin = useMemo(() => Math.max(1, ...bins), [bins]);
  const windowCount = useMemo(
    () => (model ? model.nodes.reduce((acc, node) => acc + (inWindow(node, { from, to }) ? 1 : 0), 0) : 0),
    [model, from, to],
  );

  const pushWindow = useCallback(
    (nextFrom: number, nextTo: number) => {
      pendingRef.current = { from: nextFrom, to: nextTo };
      if (rafRef.current != null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        if (pending) setWindow(pending.from, pending.to);
      });
    },
    [setWindow],
  );

  const flushWindow = useCallback(() => {
    if (rafRef.current != null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) setWindow(pending.from, pending.to);
  }, [setWindow]);

  useEffect(
    () => () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const valueAt = (clientX: number): number | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    const p = clamp((clientX - rect.left) / rect.width, 0, 1);
    return bounds[0] + p * span;
  };

  const applyDrag = (clientX: number) => {
    const drag = dragRef.current;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!drag || !rect || rect.width === 0) return;
    const delta = ((clientX - drag.startX) / rect.width) * span;
    if (Math.abs(clientX - drag.startX) > 2) drag.moved = true;
    if (drag.mode === 'from') {
      const nextFrom = clamp(drag.from + delta, bounds[0], drag.to - minGap);
      pushWindow(nextFrom, drag.to);
    } else if (drag.mode === 'to') {
      const nextTo = clamp(drag.to + delta, drag.from + minGap, bounds[1]);
      pushWindow(drag.from, nextTo);
    } else {
      const width = drag.to - drag.from;
      const nextFrom = clamp(drag.from + delta, bounds[0], bounds[1] - width);
      pushWindow(nextFrom, nextFrom + width);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const t = valueAt(e.clientX);
    const rect = trackRef.current?.getBoundingClientRect();
    if (t == null || !rect) return;
    const pxFrom = rect.left + fromFrac * rect.width;
    const pxTo = rect.left + toFrac * rect.width;
    const d1 = Math.abs(e.clientX - pxFrom);
    const d2 = Math.abs(e.clientX - pxTo);
    const edge = Math.max(10, rect.width * 0.018);
    let mode: DragMode;
    if (d1 <= edge && d2 <= edge) mode = d1 <= d2 ? 'from' : 'to';
    else if (d1 <= edge) mode = 'from';
    else if (d2 <= edge) mode = 'to';
    else if (e.clientX > pxFrom && e.clientX < pxTo) mode = 'move';
    else mode = d1 < d2 ? 'from' : 'to';

    dragRef.current = { mode, startX: e.clientX, from, to, width: rect.width, moved: false };
    setDragging(true);
    if (playing) setPlaying(false);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);

    // 點在時間窗外的空白處：把最近的邊界直接移到點擊位置，再繼續拖曳
    if (mode !== 'move' && d1 > edge && d2 > edge) {
      if (mode === 'from') {
        const nextFrom = clamp(t, bounds[0], to - minGap);
        dragRef.current.from = nextFrom;
        pushWindow(nextFrom, to);
      } else {
        const nextTo = clamp(t, from + minGap, bounds[1]);
        dragRef.current.to = nextTo;
        pushWindow(from, nextTo);
      }
    }
    e.preventDefault();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    applyDrag(e.clientX);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    flushWindow();
  };

  const nudge = (which: 'from' | 'to', dir: number, big: boolean) => {
    const step = span * (big ? 0.05 : 0.01) * dir;
    if (which === 'from') {
      const next = clamp(from + step, bounds[0], to - minGap);
      setWindow(next, to);
    } else {
      const next = clamp(to + step, from + minGap, bounds[1]);
      setWindow(from, next);
    }
  };

  const onKeyDown = (which: 'from' | 'to') => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(which, -1, e.shiftKey);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      nudge(which, 1, e.shiftKey);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (which === 'from') setWindow(bounds[0], to);
      else setWindow(from, clamp(bounds[0] + minGap, bounds[0], bounds[1]));
    } else if (e.key === 'End') {
      e.preventDefault();
      if (which === 'to') setWindow(from, bounds[1]);
      else setWindow(clamp(bounds[1] - minGap, bounds[0], bounds[1]), to);
    } else if (e.key === 'PageUp') {
      e.preventDefault();
      nudge(which, 1, true);
    } else if (e.key === 'PageDown') {
      e.preventDefault();
      nudge(which, -1, true);
    }
  };

  const resetRange = () => {
    setPlaying(false);
    setWindow(bounds[0], bounds[1]);
  };

  const hasData = starts.length > 0;

  return (
    <div className={`time-dock tdock ${dragging ? 'is-dragging' : ''}`}>
      <div className="time-head tdock-head">
        <span className="tdock-title">
          <Icon name="clock" size={13} />
          <span>時間窗</span>
        </span>
        <span className="time-readout" aria-live="off">
          {formatYearMonth(from)} → {formatYearMonth(to)}
          <span className="tdock-duration">（{formatDuration(to - from || DAY)}）</span>
        </span>
        <span className="badge tdock-count" title="時間窗內符合目前篩選的節點數">
          {windowCount.toLocaleString('zh-TW')} 個節點
        </span>
        <span className="spacer" />
        <button
          className={`icon-btn tdock-play ${playing ? 'is-on' : ''}`}
          onClick={() => setPlaying(!playing)}
          title={playing ? '暫停時間播放（空白鍵）' : '播放時間（空白鍵）'}
          aria-label={playing ? '暫停時間播放' : '播放時間'}
          aria-pressed={playing}
        >
          <Icon name={playing ? 'pause' : 'play'} size={15} />
        </button>
        <div className="seg tdock-speed" role="group" aria-label="播放速度">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              className={playSpeed === speed ? 'is-on' : ''}
              onClick={() => setPlaySpeed(speed)}
              aria-pressed={playSpeed === speed}
              title={`${speed} 倍速`}
            >
              {speed}x
            </button>
          ))}
        </div>
        <button className="btn btn-sm tdock-reset" onClick={resetRange} title="回到全時段">
          <Icon name="reset" size={12} /> 全時段
        </button>
      </div>

      <div
        className="tdock-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        role="group"
        aria-label="時間範圍滑桿，可拖曳兩端或整段移動；拖曳後放開即套用到所有視圖"
        style={{ touchAction: 'none' }}
      >
        <div className="tdock-hist" aria-hidden="true">
          {bins.map((count, i) => {
            const binStart = bounds[0] + (i / BIN_COUNT) * span;
            const binEnd = bounds[0] + ((i + 1) / BIN_COUNT) * span;
            const inside = binEnd >= from && binStart <= to;
            const h = count === 0 ? 2 : 10 + (count / maxBin) * 90;
            return (
              <i
                key={i}
                className={`tdock-bar ${inside ? 'is-in' : ''} ${count > 0 ? 'has-data' : ''}`}
                style={{ height: `${h}%` }}
                title={count > 0 ? `${formatYearMonth(binStart)} 起：${count} 個節點` : undefined}
              />
            );
          })}
        </div>

        <div
          className="tdock-selection"
          style={{ left: `${fromFrac * 100}%`, width: `${Math.max(0.4, (toFrac - fromFrac) * 100)}%` }}
        >
          <div
            className="tdock-handle is-from"
            role="slider"
            tabIndex={0}
            aria-label="時間窗起點"
            aria-valuemin={bounds[0]}
            aria-valuemax={to}
            aria-valuenow={from}
            aria-valuetext={formatYearMonth(from)}
            onKeyDown={onKeyDown('from')}
          >
            <span />
          </div>
          <div
            className="tdock-handle is-to"
            role="slider"
            tabIndex={0}
            aria-label="時間窗終點"
            aria-valuemin={from}
            aria-valuemax={bounds[1]}
            aria-valuenow={to}
            aria-valuetext={formatYearMonth(to)}
            onKeyDown={onKeyDown('to')}
          >
            <span />
          </div>
        </div>

        <div className="tdock-baseline" />
        {!hasData && <div className="tdock-hint">目前沒有可依時間定位的節點；仍可調整時間窗。</div>}
      </div>
    </div>
  );
}
