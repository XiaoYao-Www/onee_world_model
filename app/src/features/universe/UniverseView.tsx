import { useEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { WmNode } from '../../data/types';
import { filterEdges, filterNodes } from '../../lib/select';
import { similarNodes } from '../../lib/search';
import { EPISTEMIC_LABELS, KIND_STYLES, kindStyle, labelize, relationLabel } from '../../lib/palette';
import { formatRange } from '../../lib/time';
import Icon, { KindGlyph } from '../../components/Icon';
import { UniverseScene } from './scene';
import { EDGE_CLASS_DEFS, KIND_LEGEND } from './legend';
import './universe.css';

interface HoverCard {
  id: string;
  x: number;
  y: number;
}

const KIND_COUNTS_LIMIT = 8;

function isLowPerfDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  return cores <= 4 || mobile;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export default function UniverseView(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const filters = useAppStore((s) => s.filters);
  const timeWindow = useAppStore((s) => s.window);
  const showDerived = useAppStore((s) => s.showDerived);
  const showLabels = useAppStore((s) => s.showLabels);
  const showEdges = useAppStore((s) => s.showEdges);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const selectedId = useAppStore((s) => s.selectedId);
  const hoveredId = useAppStore((s) => s.hoveredId);
  const focusSignal = useAppStore((s) => s.focusSignal);
  const focusTarget = useAppStore((s) => s.focusTarget);
  const legendOpen = useAppStore((s) => s.legendOpen);
  const set = useAppStore((s) => s.set);
  const select = useAppStore((s) => s.select);
  const hover = useAppStore((s) => s.hover);
  const focusNode = useAppStore((s) => s.focusNode);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const setWindow = useAppStore((s) => s.setWindow);
  const bounds = useAppStore((s) => s.bounds);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<UniverseScene | null>(null);
  const lastHoverRef = useRef<string | null>(null);
  const layoutSeedRef = useRef(0);
  const lastFocusRef = useRef(0);

  const [sceneReady, setSceneReady] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const [layout, setLayout] = useState<{ done: number; total: number; busy: boolean }>({
    done: 0,
    total: 0,
    busy: false,
  });
  const [autoRotate, setAutoRotate] = useState(false);
  const [card, setCard] = useState<HoverCard | null>(null);
  const [showLegendHint, setShowLegendHint] = useState(true);

  const lowPerf = useMemo(isLowPerfDevice, []);

  const visibleNodes = useMemo<WmNode[]>(
    () => (model ? filterNodes(model, model.nodes, filters, timeWindow, null) : []),
    [model, filters, timeWindow],
  );

  // 關係線即使被隱藏也要計算：節點大小依 degree，HUD 也要顯示正確的關係數。
  const visibleEdges = useMemo(
    () =>
      model
        ? filterEdges(model.edges, new Set(visibleNodes.map((n) => n.id)), filters, timeWindow, model)
        : [],
    [model, visibleNodes, filters, timeWindow],
  );

  const neighbourIds = useMemo(() => {
    const set2 = new Set<string>();
    if (!model || !selectedId) return set2;
    set2.add(selectedId);
    for (const e of model.edgesByNode.get(selectedId) ?? []) {
      set2.add(e.source === selectedId ? e.target : e.source);
    }
    return set2;
  }, [model, selectedId]);

  const derivedItems = useMemo(() => {
    if (!model || !selectedId || !showDerived) return [];
    try {
      return similarNodes(model, selectedId, 8);
    } catch {
      return [];
    }
  }, [model, selectedId, showDerived]);

  const selectedNode = selectedId ? model?.nodeById.get(selectedId) ?? null : null;
  const hoverNode = card ? model?.nodeById.get(card.id) ?? null : null;

  const kindCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const node of visibleNodes) map.set(node.kind, (map.get(node.kind) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, KIND_COUNTS_LIMIT);
  }, [visibleNodes]);

  // ── 建立場景（只做一次） ──────────────────────────────────────
  useEffect(() => {
    const wrap = wrapRef.current;
    const labelHost = labelRef.current;
    if (!wrap || !labelHost) return;
    let scene: UniverseScene | null = null;
    try {
      scene = new UniverseScene(
        wrap,
        labelHost,
        {
          onHover: (id, x, y) => {
            if (id !== lastHoverRef.current) {
              lastHoverRef.current = id;
              hover(id);
            }
            if (!id) {
              setCard(null);
              return;
            }
            const rect = wrap.getBoundingClientRect();
            setCard({ id, x: x - rect.left, y: y - rect.top });
          },
          onSelect: (id) => {
            select(id);
          },
          onFocus: (id) => {
            focusNode(id);
          },
          onLayoutProgress: (done, total) => {
            setLayout({ done, total, busy: done < total });
          },
          onLayoutEnd: () => {
            setLayout((prev) => ({ ...prev, busy: false }));
          },
          onFatal: (message) => setFallback(message),
        },
        { reducedMotion, lowPerf, showLabels },
      );
      sceneRef.current = scene;
      setFallback(null);
      setSceneReady(true);
    } catch (err) {
      setFallback(err instanceof Error ? err.message : String(err));
    }
    return () => {
      scene?.dispose();
      sceneRef.current = null;
      setSceneReady(false);
    };
    // 場景只建立一次；後續狀態透過下面各個 effect 更新
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 資料（篩選／時間窗變更時重建；節點集合不變則沿用佈局） ─────
  // 拖曳時間滑桿時 store 每幀都會更新，這裡延後 130ms 才重建幾何，
  // 讓拖曳保持在 60fps，同時仍然在停手後立刻反映新時間窗。
  const builtOnceRef = useRef(false);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !sceneReady) return;
    const delay = builtOnceRef.current ? 130 : 0;
    const handle = window.setTimeout(() => {
      const forceLayout = layoutSeed !== layoutSeedRef.current;
      layoutSeedRef.current = layoutSeed;
      if (forceLayout) setLayout((prev) => ({ ...prev, busy: true }));
      scene.setData(visibleNodes, visibleEdges, { showEdges, forceLayout });
      scene.setSelection(selectedId, neighbourIds);
      scene.setShowLabels(showLabels);
      scene.setDerived(derivedItems);
      scene.setReducedMotion(reducedMotion);
      builtOnceRef.current = true;
    }, delay);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneReady, visibleNodes, visibleEdges, showEdges, layoutSeed]);

  // ── 選取／hover／衍生（只更新視覺，不重建幾何） ───────────────
  useEffect(() => {
    sceneRef.current?.setSelection(selectedId, neighbourIds);
  }, [sceneReady, selectedId, neighbourIds]);

  useEffect(() => {
    if (hoveredId === lastHoverRef.current) return;
    lastHoverRef.current = hoveredId;
    sceneRef.current?.setHover(hoveredId);
  }, [sceneReady, hoveredId]);

  useEffect(() => {
    sceneRef.current?.setDerived(derivedItems);
  }, [sceneReady, derivedItems]);

  useEffect(() => {
    sceneRef.current?.setShowLabels(showLabels);
  }, [sceneReady, showLabels]);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
    if (reducedMotion && autoRotate) setAutoRotate(false);
  }, [sceneReady, reducedMotion, autoRotate]);

  useEffect(() => {
    sceneRef.current?.setAutoRotate(autoRotate);
  }, [sceneReady, autoRotate]);

  // ── 聚焦（雙擊、搜尋結果、Inspector「定位」） ─────────────────
  useEffect(() => {
    if (!sceneReady) return;
    if (focusSignal === lastFocusRef.current) return;
    lastFocusRef.current = focusSignal;
    const target = focusTarget ?? selectedId;
    if (target) sceneRef.current?.focus(target);
  }, [sceneReady, focusSignal, focusTarget, selectedId]);

  // ── 圖例第一次提示 ────────────────────────────────────────────
  useEffect(() => {
    if (legendOpen) {
      setShowLegendHint(false);
      return;
    }
    const id = window.setTimeout(() => setShowLegendHint(false), 7000);
    return () => window.clearTimeout(id);
  }, [legendOpen]);

  const clearHover = () => {
    if (lastHoverRef.current !== null) {
      lastHoverRef.current = null;
      hover(null);
    }
    sceneRef.current?.setHover(null);
    setCard(null);
  };

  const resetView = () => {
    sceneRef.current?.resetView();
    setAutoRotate(false);
  };

  const requestRelayout = () => {
    setLayout({ done: 0, total: 36, busy: true });
    setLayoutSeed((s) => s + 1);
  };

  const clearSelection = () => select(null);

  const totalNodes = model?.nodes.length ?? 0;
  const totalEdges = model?.edges.length ?? 0;
  const filtersActive =
    filters.kinds.length +
      filters.domains.length +
      filters.tags.length +
      filters.epistemic.length +
      filters.geoRoles.length +
      filters.minSources +
      (filters.hideDemo ? 1 : 0) >
    0;

  return (
    <div className="univ-root" ref={wrapRef}>
      <div className="univ-labels" ref={labelRef} aria-hidden="true" />

      {!fallback && (
        <>
          <div className="stage-hud univ-hud" onPointerEnter={clearHover}>
            <div className="panel univ-hud-card">
              <div className="univ-hud-title">
                <Icon name="universe" size={14} />
                <span>知識宇宙</span>
                {model?.meta?.has_demo && <span className="badge badge-warn">含示範資料</span>}
              </div>
              <div className="univ-hud-stats">
                <div>
                  <span className="univ-k">節點</span>
                  <b>{totalNodes.toLocaleString('zh-TW')}</b>
                </div>
                <div>
                  <span className="univ-k">關係</span>
                  <b>{totalEdges.toLocaleString('zh-TW')}</b>
                </div>
                <div className="univ-stat-hl">
                  <span className="univ-k">目前可見</span>
                  <b>
                    {visibleNodes.length.toLocaleString('zh-TW')}
                    <em>節點</em>
                    {visibleEdges.length.toLocaleString('zh-TW')}
                    <em>關係</em>
                  </b>
                </div>
              </div>
              {kindCounts.length > 0 && (
                <div className="univ-kind-counts">
                  {kindCounts.map(([kind, count]) => {
                    const st = kindStyle(kind);
                    return (
                      <span className="univ-kind-count" key={kind} title={`${st.label} ${count}`}>
                        <i style={{ background: st.color }} />
                        {st.label}
                        <em>{count}</em>
                      </span>
                    );
                  })}
                </div>
              )}
              <div className="univ-hud-actions">
                <button
                  className="btn btn-sm"
                  onClick={requestRelayout}
                  title="依目前可見節點重新計算群集佈局"
                  aria-label="重新佈局"
                >
                  <Icon name="sparkle" size={13} /> 重新佈局
                </button>
                <button
                  className={`btn btn-sm ${showDerived ? 'is-on' : ''}`}
                  onClick={() => set('showDerived', !showDerived)}
                  title="顯示目前選取節點的語意相似對象（衍生，不是事實關係）"
                  aria-pressed={showDerived}
                >
                  <Icon name="link" size={13} /> 衍生關係
                </button>
                <button
                  className={`btn btn-sm ${showEdges ? 'is-on' : ''}`}
                  onClick={() => set('showEdges', !showEdges)}
                  title="顯示或隱藏關係線"
                  aria-pressed={showEdges}
                >
                  <Icon name="share" size={13} /> 關係線
                </button>
                <button
                  className={`btn btn-sm ${showLabels ? 'is-on' : ''}`}
                  onClick={() => set('showLabels', !showLabels)}
                  title="顯示選取、滑鼠所指與高度數節點的名稱（上限 40 個）"
                  aria-pressed={showLabels}
                >
                  <Icon name="eye" size={13} /> 標籤
                </button>
                <button
                  className={`btn btn-sm ${autoRotate ? 'is-on' : ''}`}
                  onClick={() => setAutoRotate((v) => !v)}
                  disabled={reducedMotion}
                  title={reducedMotion ? '已開啟減少動態，自動環繞停用' : '鏡頭緩慢環繞宇宙'}
                  aria-pressed={autoRotate}
                >
                  <Icon name="compass" size={13} /> 環繞
                </button>
                <button className="btn btn-sm" onClick={resetView} title="重設鏡頭（R）" aria-label="重設鏡頭">
                  <Icon name="reset" size={13} /> 重設
                </button>
              </div>
              {showDerived && !selectedId && (
                <div className="univ-derived-hint">
                  <Icon name="link" size={11} /> 衍生關係只針對選取節點；先點選一個節點。
                </div>
              )}
              {layout.busy && (
                <div className="univ-busy" role="status">
                  <span className="pulse">計算群集佈局</span>
                  <span className="mono">
                    {Math.min(layout.done, 36)} / 36
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="univ-tip">
            拖曳旋轉 · 滾輪縮放 · 點擊選取 · 雙擊聚焦 · <span className="kbd">R</span> 重設鏡頭
          </div>
        </>
      )}

      {/* 圖例 */}
      <div
        className={`legend-card univ-legend panel ${legendOpen ? 'is-open' : ''}`}
        onPointerEnter={clearHover}
      >
        <button
          className="univ-legend-head"
          onClick={() => set('legendOpen', !legendOpen)}
          aria-expanded={legendOpen}
          aria-controls="univ-legend-body"
        >
          <Icon name="layers" size={14} />
          <span>圖例與視覺語義</span>
          <span className="spacer" />
          <Icon name="chevron" size={14} style={{ transform: legendOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        {legendOpen && (
          <div className="univ-legend-body scroll" id="univ-legend-body">
            <div className="univ-legend-sec">關係類型</div>
            {EDGE_CLASS_DEFS.map((def) => (
              <div className="univ-legend-edge" key={def.key}>
                <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
                  <line
                    x1="1"
                    y1="5"
                    x2="33"
                    y2="5"
                    stroke={def.color}
                    strokeWidth={def.key === 'evidence' ? 1.8 : 1.2}
                    strokeDasharray={def.dash ? def.dash.join(' ') : undefined}
                    opacity={def.derived ? 0.8 : 0.95}
                  />
                  {def.key === 'fact' && (
                    <path d="M27 2l4 3-4 3" fill="none" stroke={def.color} strokeWidth="1.2" />
                  )}
                </svg>
                <span className="univ-legend-label">
                  {def.label}
                  {def.derived && <span className="badge badge-accent univ-derived-badge">衍生</span>}
                </span>
                <span className="univ-legend-hint">{def.hint}</span>
              </div>
            ))}
            <div className="univ-legend-sec">節點型別（形狀 × 顏色 × 大小）</div>
            <div className="univ-legend-kinds">
              {KIND_LEGEND.slice(0, 10).map((item) => (
                <span className="univ-legend-kind" key={item.kind} title={`${item.label}：${item.shapeLabel}`}>
                  <KindGlyph kind={item.kind} color={item.color} size={13} />
                  {item.label}
                </span>
              ))}
            </div>
            <div className="univ-legend-note">
              節點大小依連結數（degree）；外框光暈代表選取，較亮的是 hover。關係線的箭頭指向被影響的對象；
              虛線、點線與亮度分別代表證據、來源引用與推論。顏色不是可信度，只是型別輔助。
            </div>
          </div>
        )}
        {!legendOpen && showLegendHint && model != null && (
          <div className="univ-legend-peek">
            <i style={{ background: KIND_STYLES.person.color }} />
            <i style={{ background: KIND_STYLES.organization.color }} />
            <i style={{ background: KIND_STYLES.event.color }} />
            <i style={{ background: KIND_STYLES.claim.color }} />
            點開圖例，看形狀與線型意義
          </div>
        )}
      </div>

      {/* hover 卡片 */}
      {hoverNode && card && hoverNode.id !== selectedId && (
        <HoverNodeCard node={hoverNode} card={card} wrapRef={wrapRef} />
      )}

      {/* 選取焦點卡 */}
      {selectedNode && (!hoverNode || hoverNode.id === selectedId) && (
        <div className="univ-focus-card panel">
          <div className="univ-focus-head">
            <KindGlyph kind={selectedNode.kind} color={kindStyle(selectedNode.kind).color} size={14} />
            <span className="univ-focus-kind">{kindStyle(selectedNode.kind).label}</span>
            {selectedNode.demo && <span className="badge badge-warn">示範</span>}
            <span className="spacer" />
            <button className="icon-btn univ-focus-close" onClick={clearSelection} title="取消選取（Esc）" aria-label="取消選取">
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="univ-focus-title">{selectedNode.title}</div>
          {selectedNode.summary && <div className="univ-focus-sum">{selectedNode.summary}</div>}
          <div className="univ-focus-meta">
            {model && model.edgesByNode.get(selectedNode.id)?.length ? (
              <span>
                一跳關係 <b>{model.edgesByNode.get(selectedNode.id)?.length}</b>
              </span>
            ) : (
              <span>尚無關係</span>
            )}
            <span>
              來源 <b>{model?.sourcesByNode.get(selectedNode.id)?.length ?? selectedNode.sources.length}</b>
            </span>
            {selectedNode.epistemic_status && (
              <span>{labelize(EPISTEMIC_LABELS, selectedNode.epistemic_status)}</span>
            )}
          </div>
          <div className="univ-focus-actions">
            <button className="btn btn-sm" onClick={() => focusNode(selectedNode.id)}>
              <Icon name="target" size={12} /> 聚焦
            </button>
            <button className="btn btn-sm" onClick={() => set('showDerived', !showDerived)} aria-pressed={showDerived}>
              <Icon name="link" size={12} /> {showDerived ? '隱藏衍生' : '衍生關聯'}
            </button>
          </div>
        </div>
      )}

      {/* 狀態覆蓋層 */}
      {fallback && (
        <div className="univ-overlay">
          <div className="panel univ-empty fade-up">
            <Icon name="info" size={24} />
            <strong>無法啟動 3D 宇宙</strong>
            <p className="micro">
              這個瀏覽器或裝置未能建立 WebGL 場景（{fallback}）。世界模型資料仍然可用，以下列出節點清單，
              你也可以切換到「瀏覽」或「時間軸」檢視。
            </p>
            <div className="univ-fallback-list scroll">
              {(model?.nodes ?? []).slice(0, 30).map((node) => (
                <button
                  key={node.id}
                  className="link-btn"
                  onClick={() => select(node.id)}
                  title={`檢視 ${node.title}`}
                >
                  <KindGlyph kind={node.kind} color={kindStyle(node.kind).color} size={12} />
                  <span className="truncate">{node.title}</span>
                  <span className="spacer" />
                  <span className="micro">{kindStyle(node.kind).label}</span>
                </button>
              ))}
              {!model || model.nodes.length === 0 ? (
                <div className="micro">目前沒有節點資料。</div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {!fallback && model && visibleNodes.length === 0 && (
        <div className="univ-overlay">
          <div className="panel univ-empty fade-up">
            <Icon name="universe" size={26} />
            <strong>{model.nodes.length === 0 ? '世界模型目前沒有節點' : '目前篩選條件下沒有節點'}</strong>
            <p className="micro">
              {model.nodes.length === 0
                ? '資料檔已載入但內容為空。匯出器產生節點後，宇宙會自動出現。'
                : '時間窗或篩選條件排除了所有節點。放寬條件即可恢復宇宙。'}
            </p>
            {model.nodes.length > 0 && (
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={resetFilters}>
                  清除篩選
                </button>
                <button className="btn btn-sm" onClick={() => setWindow(bounds[0], bounds[1])}>
                  顯示全時段
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {!fallback && !sceneReady && !model && (
        <div className="univ-overlay">
          <div className="panel univ-empty">
            <span className="spin">
              <Icon name="universe" size={22} />
            </span>
            <strong>正在建立宇宙場景</strong>
          </div>
        </div>
      )}

      {filtersActive && visibleNodes.length > 0 && (
        <button className="univ-filter-note" onClick={resetFilters} title="清除所有篩選條件">
          <Icon name="filter" size={12} /> 已套用篩選 · 點此清除
        </button>
      )}
    </div>
  );
}

function HoverNodeCard({
  node,
  card,
  wrapRef,
}: {
  node: WmNode;
  card: HoverCard;
  wrapRef: RefObject<HTMLDivElement | null>;
}) {
  const st = kindStyle(node.kind);
  const rect = wrapRef.current?.getBoundingClientRect();
  const width = 268;
  const heightGuess = 168;
  const left = clamp(card.x + 16, 8, Math.max(8, (rect?.width ?? 800) - width - 8));
  const top = clamp(card.y + 14, 8, Math.max(8, (rect?.height ?? 600) - heightGuess - 8));
  const time = formatRange(node.start, node.end, node.time_precision);
  return (
    <div className="hover-card univ-hover-card" style={{ left, top, maxWidth: width }} role="tooltip">
      <div className="univ-hover-head">
        <KindGlyph kind={node.kind} color={st.color} size={13} />
        <span className="univ-hover-kind">{st.label}</span>
        {node.demo && <span className="badge badge-warn">示範</span>}
      </div>
      <div className="univ-hover-title">{node.title}</div>
      {node.summary && <div className="univ-hover-sum">{node.summary}</div>}
      <div className="univ-hover-meta">
        <span>{time}</span>
        {node.domains.slice(0, 2).map((d) => (
          <span key={d} className="univ-hover-domain">
            {d}
          </span>
        ))}
      </div>
      {node.geo.length > 0 && (
        <div className="univ-hover-geo">
          <Icon name="map" size={11} />
          {node.geo[0].name}
          {node.geo.length > 1 ? ` 等 ${node.geo.length} 處` : ''}
        </div>
      )}
      <div className="univ-hover-foot">點擊選取 · 雙擊聚焦</div>
    </div>
  );
}

/** 給圖例／其他視圖使用的關係說明（避免重複實作）。 */
export function edgeTypeLabel(type: string): string {
  return relationLabel(type);
}
