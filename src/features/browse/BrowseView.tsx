import { useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import type { ModelBundle, WmClaim, WmNode, WmSource } from '../../data/types';
import { inWindow, matchesFilters } from '../../lib/select';
import { EPISTEMIC_LABELS, SOURCE_TYPE_LABELS, kindStyle } from '../../lib/palette';
import { formatRange } from '../../lib/time';
import { confidenceText, formatDate, isExternalUrl, reliabilityLabel } from '../inspector/format';
import './browse.css';

type Tab = 'nodes' | 'sources' | 'claims';
type NodeSort = 'title' | 'updated' | 'sources';

const TAB_LABELS: Record<Tab, string> = { nodes: '節點', sources: '來源', claims: '主張' };
const PAGE_SIZE: Record<Tab, number> = { nodes: 60, sources: 40, claims: 40 };

function sourceCountOf(model: ModelBundle, node: WmNode): number {
  return (model.sourcesByNode.get(node.id) ?? node.sources).length;
}

function timeValue(value?: string | null): number {
  if (!value) return NaN;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? NaN : ms;
}

function activeFilterCount(filters: ReturnType<typeof useAppStore.getState>['filters']): number {
  return (
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
    (filters.hideDemo ? 1 : 0)
  );
}

interface DetailProps {
  model: ModelBundle;
  onClose: () => void;
}

export function SourcePanel({ model, source, onClose }: DetailProps & { source: WmSource }): JSX.Element {
  const focusNode = useAppStore((s) => s.focusNode);
  const reliability = reliabilityLabel(source.reliability);
  const related = source.related_ids.flatMap((id) => {
    const node = model.nodeById.get(id);
    return node ? [node] : [];
  });
  const evidence = model.evidence.filter((item) => item.source_id === source.id);

  return (
    <>
      <div className="bv-detail-head">
        <span className="badge">{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</span>
        {source.demo && <span className="badge badge-gold">demo</span>}
        <span className="spacer" />
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="關閉來源詳情" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="bv-detail-body scroll">
        <div className="bv-dtitle">{source.title}</div>
        {source.title_original && <div className="micro" style={{ marginTop: 3 }}>原始標題：{source.title_original}</div>}
        {source.summary && <p className="bv-dsummary">{source.summary}</p>}

        <div className="block-title">書目資料</div>
        <div className="bv-kv">
          <span className="k">發布者</span>
          <span className="v">{source.publisher || '未記錄'}</span>
          <span className="k">作者</span>
          <span className="v">{source.authors.length > 0 ? source.authors.join('、') : '未記錄'}</span>
          <span className="k">發布日期</span>
          <span className="v">{source.published_at ? formatDate(source.published_at) : '未記錄'}</span>
          <span className="k">取得日期</span>
          <span className="v">{source.retrieved_at ? formatDate(source.retrieved_at) : '未記錄'}</span>
          <span className="k">語言</span>
          <span className="v">{source.language || '未記錄'}</span>
          <span className="k">授權</span>
          <span className="v">{source.license || '未記錄'}</span>
          <span className="k">存檔</span>
          <span className="v">{source.archive_status || '未記錄'}</span>
          {reliability && (
            <>
              <span className="k">可靠性</span>
              <span className="v">
                <span className="badge badge-ok">{reliability}</span>
              </span>
            </>
          )}
          <span className="k">原始連結</span>
          <span className="v" style={{ wordBreak: 'break-all' }}>
            {source.url && isExternalUrl(source.url) ? (
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.url}
              </a>
            ) : (
              source.url || '未記錄'
            )}
          </span>
        </div>

        <div className="block-title">關聯節點（{related.length}）</div>
        {related.length === 0 ? (
          <div className="micro">此來源尚未連結節點。</div>
        ) : (
          related.map((node) => (
            <button type="button" key={node.id} className="bv-dnode" onClick={() => focusNode(node.id)}>
              <span
                className="bv-dot"
                style={{ background: kindStyle(node.kind).color }}
                aria-hidden="true"
              />
              <span className="truncate" style={{ flex: 1 }}>
                {node.title}
              </span>
              <span className="micro">{kindStyle(node.kind).label}</span>
            </button>
          ))
        )}

        <div className="block-title">證據（{evidence.length}）</div>
        {evidence.length === 0 ? (
          <div className="micro">此來源尚未建立證據摘錄。</div>
        ) : (
          evidence.map((item) => (
            <div key={item.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{item.title || '證據摘錄'}</div>
              {item.excerpt && <div className="micro" style={{ marginTop: 3 }}>{item.excerpt}</div>}
            </div>
          ))
        )}
      </div>
    </>
  );
}

export function ClaimPanel({ model, claim, onClose }: DetailProps & { claim: WmClaim }): JSX.Element {
  const focusNode = useAppStore((s) => s.focusNode);
  const conf = confidenceText(claim.confidence);
  const sources = claim.sources.flatMap((id) => {
    const source = model.sourceById.get(id);
    return source ? [source] : [];
  });
  const entities = claim.related_entities.flatMap((id) => {
    const node = model.nodeById.get(id);
    return node ? [node] : [];
  });
  const evidence = [...claim.supporting, ...claim.contradicting].flatMap((id) => {
    const item = model.evidenceById.get(id);
    return item ? [item] : [];
  });

  return (
    <>
      <div className="bv-detail-head">
        <span className="badge">{EPISTEMIC_LABELS[claim.epistemic_status] ?? claim.epistemic_status}</span>
        {claim.demo && <span className="badge badge-gold">demo</span>}
        <span className="spacer" />
        <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} aria-label="關閉主張詳情" onClick={onClose}>
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="bv-detail-body scroll">
        <div className="bv-dtitle">{claim.title || '未命名主張'}</div>
        {claim.statement && <p className="bv-dsummary">{claim.statement}</p>}
        <div className="bv-kv" style={{ marginTop: 10 }}>
          <span className="k">證據狀態</span>
          <span className="v">{EPISTEMIC_LABELS[claim.epistemic_status] ?? claim.epistemic_status}</span>
          <span className="k">信心</span>
          <span className="v">{conf || '未記錄'}</span>
          <span className="k">支持證據</span>
          <span className="v">{claim.supporting.length} 筆</span>
          <span className="k">反駁證據</span>
          <span className="v">{claim.contradicting.length} 筆</span>
        </div>

        <div className="block-title">證據</div>
        {evidence.length === 0 ? (
          <div className="micro">此主張尚無證據摘錄。</div>
        ) : (
          evidence.map((item) => {
            const role = claim.supporting.includes(item.id)
              ? '支持'
              : claim.contradicting.includes(item.id)
                ? '反駁'
                : '關聯';
            return (
              <div key={item.id} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11.5, color: 'var(--text)' }}>
                  {item.title || '證據摘錄'} <span className="badge">{role}</span>
                </div>
                {item.excerpt && <div className="micro" style={{ marginTop: 3 }}>{item.excerpt}</div>}
              </div>
            );
          })
        )}

        <div className="block-title">來源（{sources.length}）</div>
        {sources.length === 0 ? (
          <div className="micro">此主張尚無公開來源。</div>
        ) : (
          sources.map((source) => (
            <div key={source.id} style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 11.5, color: 'var(--text)' }}>{source.title}</div>
              <div className="micro">
                {source.publisher || '未記錄發布者'}
                {source.published_at ? ` · ${formatDate(source.published_at)}` : ''}
              </div>
            </div>
          ))
        )}

        <div className="block-title">相關實體（{entities.length}）</div>
        {entities.length === 0 ? (
          <div className="micro">此主張尚未連結實體。</div>
        ) : (
          entities.map((node) => (
            <button type="button" key={node.id} className="bv-dnode" onClick={() => focusNode(node.id)}>
              <span className="bv-dot" style={{ background: kindStyle(node.kind).color }} aria-hidden="true" />
              <span className="truncate" style={{ flex: 1 }}>
                {node.title}
              </span>
              <span className="micro">{kindStyle(node.kind).label}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}

export default function BrowseView(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const filters = useAppStore((s) => s.filters);
  const resetFilters = useAppStore((s) => s.resetFilters);
  const bounds = useAppStore((s) => s.bounds);
  const windowRange = useAppStore((s) => s.window);
  const setWindow = useAppStore((s) => s.setWindow);
  const selectedId = useAppStore((s) => s.selectedId);
  const focusNode = useAppStore((s) => s.focusNode);

  const [tab, setTab] = useState<Tab>('nodes');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<NodeSort>('sources');
  const [grouped, setGrouped] = useState(true);
  const [page, setPage] = useState(1);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);

  const filterCount = activeFilterCount(filters);
  const pageSize = PAGE_SIZE[tab];

  useEffect(() => {
    setPage(1);
  }, [tab, query, sort, grouped, filters, windowRange]);

  useEffect(() => {
    setOpenSourceId(null);
    setOpenClaimId(null);
  }, [tab]);

  const nodes = useMemo(() => {
    if (!model) return [] as WmNode[];
    const q = query.trim().toLowerCase();
    const list = model.nodes.filter((node) => {
      if (!inWindow(node, windowRange)) return false;
      if (!matchesFilters(model, node, filters)) return false;
      if (q === '') return true;
      const haystack = [node.title, node.title_original ?? '', node.aliases.join(' '), node.summary]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
    const sorted = [...list];
    if (sort === 'title') {
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
    } else if (sort === 'updated') {
      sorted.sort((a, b) => {
        const ta = timeValue(a.updated);
        const tb = timeValue(b.updated);
        const fa = Number.isFinite(ta);
        const fb = Number.isFinite(tb);
        if (fa && fb && ta !== tb) return tb - ta;
        if (fa && !fb) return -1;
        if (!fa && fb) return 1;
        return a.title.localeCompare(b.title, 'zh-Hant');
      });
    } else {
      sorted.sort(
        (a, b) => sourceCountOf(model, b) - sourceCountOf(model, a) || a.title.localeCompare(b.title, 'zh-Hant'),
      );
    }
    return sorted;
  }, [model, filters, windowRange, query, sort]);

  const sources = useMemo(() => {
    if (!model) return [] as WmSource[];
    const q = query.trim().toLowerCase();
    const list = model.sources.filter((source) => {
      if (q === '') return true;
      return [source.title, source.title_original ?? '', source.publisher ?? '', source.summary]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    return [...list].sort((a, b) => {
      const ta = timeValue(a.published_at);
      const tb = timeValue(b.published_at);
      const fa = Number.isFinite(ta);
      const fb = Number.isFinite(tb);
      if (fa && fb && ta !== tb) return tb - ta;
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return a.title.localeCompare(b.title, 'zh-Hant');
    });
  }, [model, query]);

  const claims = useMemo(() => {
    if (!model) return [] as WmClaim[];
    const q = query.trim().toLowerCase();
    const list = model.claims.filter((claim) => {
      if (q === '') return true;
      return [claim.title, claim.statement].join(' ').toLowerCase().includes(q);
    });
    return [...list].sort((a, b) => (a.title || a.statement).localeCompare(b.title || b.statement, 'zh-Hant'));
  }, [model, query]);

  const total = tab === 'nodes' ? nodes.length : tab === 'sources' ? sources.length : claims.length;
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => {
    if (page > maxPage) setPage(maxPage);
  }, [page, maxPage]);
  const safePage = Math.min(page, maxPage);

  const pagedNodes = useMemo(
    () => nodes.slice((safePage - 1) * pageSize, safePage * pageSize),
    [nodes, safePage, pageSize],
  );
  const pagedSources = useMemo(
    () => sources.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sources, safePage, pageSize],
  );
  const pagedClaims = useMemo(
    () => claims.slice((safePage - 1) * pageSize, safePage * pageSize),
    [claims, safePage, pageSize],
  );

  const nodeGroups = useMemo(() => {
    if (!grouped) return [{ key: 'all', items: pagedNodes }];
    const map = new Map<string, WmNode[]>();
    for (const node of pagedNodes) {
      const list = map.get(node.kind);
      if (list) list.push(node);
      else map.set(node.kind, [node]);
    }
    return [...map.entries()]
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => kindStyle(a.key).order - kindStyle(b.key).order);
  }, [pagedNodes, grouped]);

  const openSource = openSourceId && model ? model.sourceById.get(openSourceId) ?? null : null;
  const openClaim = openClaimId && model ? model.claimById.get(openClaimId) ?? null : null;
  const showDetail = !!(openSource || openClaim);

  const allEmpty = !!model && model.nodes.length === 0 && model.sources.length === 0 && model.claims.length === 0;

  const headerCols =
    tab === 'nodes'
      ? ['名稱', '型別', '學科', '來源', '時間']
      : tab === 'sources'
        ? ['標題', '發布者', '日期', '類型', '關聯']
        : ['主張', '證據狀態', '支持／反駁', '信心', '來源'];

  return (
    <div className="bv">
      <div className="bv-head">
        <div className="bv-toolbar">
          <span className="bv-title">
            <Icon name="browse" size={15} />
            瀏覽
          </span>
          <div className="seg" role="group" aria-label="瀏覽資料類型">
            {(['nodes', 'sources', 'claims'] as Tab[]).map((value) => (
              <button
                key={value}
                type="button"
                className={tab === value ? 'is-on' : ''}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {TAB_LABELS[value]}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <input
            className="input bv-search"
            type="search"
            placeholder={`在${TAB_LABELS[tab]}中搜尋…`}
            aria-label={`在${TAB_LABELS[tab]}中搜尋`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {tab === 'nodes' && (
            <>
              <select
                className="select bv-select"
                aria-label="排序方式"
                value={sort}
                onChange={(event) => setSort(event.target.value as NodeSort)}
              >
                <option value="sources">依來源數</option>
                <option value="title">依標題</option>
                <option value="updated">依更新時間</option>
              </select>
              <button
                type="button"
                className={`btn btn-sm${grouped ? ' is-on' : ''}`}
                aria-pressed={grouped}
                onClick={() => setGrouped((prev) => !prev)}
                title="依節點類型分區或顯示單一表格"
              >
                <Icon name="layers" size={12} />
                {grouped ? '分區' : '表格'}
              </button>
            </>
          )}
        </div>
        <div className="bv-sub">
          <span>
            {tab === 'nodes'
              ? `${nodes.length.toLocaleString('zh-TW')} 個節點`
              : tab === 'sources'
                ? `${sources.length.toLocaleString('zh-TW')} 筆來源`
                : `${claims.length.toLocaleString('zh-TW')} 項主張`}
            {query.trim() !== '' && `（搜尋「${query.trim()}」）`}
          </span>
          <span>·</span>
          <span>
            {filterCount > 0 ? `已套用 ${filterCount} 項全域篩選` : '未套用全域篩選'}；時間範圍同步
          </span>
          {filterCount > 0 && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={resetFilters}>
              清除篩選
            </button>
          )}
        </div>
      </div>

      <div className="bv-main">
        <div className="bv-list scroll">
          {!model ? (
            <div className="empty bv-empty">
              <Icon name="info" size={20} />
              <strong>資料尚未載入</strong>
              <div className="micro">瀏覽清單會在世界模型資料載入後出現。</div>
            </div>
          ) : allEmpty ? (
            <div className="empty bv-empty">
              <Icon name="browse" size={20} />
              <strong>本體尚無可公開瀏覽的資料</strong>
              <div className="micro">
                目前匯出的節點、來源與主張皆為 0 筆。畫面會維持可用，不會以虛構資料填充。
              </div>
            </div>
          ) : total === 0 ? (
            <div className="empty bv-empty">
              <Icon name="filter" size={20} />
              <strong>目前沒有符合條件的{TAB_LABELS[tab]}</strong>
              <div className="micro">
                {query.trim() !== '' ? '可清除搜尋字串，或放寬全域篩選與時間範圍。' : '目前的全域篩選或時間範圍沒有留下任何項目。'}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {query.trim() !== '' && (
                  <button type="button" className="btn btn-sm" onClick={() => setQuery('')}>
                    清除搜尋
                  </button>
                )}
                {filterCount > 0 && (
                  <button type="button" className="btn btn-sm" onClick={resetFilters}>
                    清除篩選
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setWindow(bounds[0], bounds[1])}>
                  重設時間範圍
                </button>
              </div>
            </div>
          ) : tab === 'nodes' ? (
            <>
              {!grouped && (
                <div className="bv-cols" aria-hidden="true">
                  {headerCols.map((label) => (
                    <span key={label}>{label}</span>
                  ))}
                </div>
              )}
              {nodeGroups.map((group) => {
                const style = kindStyle(group.key);
                const sourcesLabel = group.items.reduce((acc, node) => acc + sourceCountOf(model, node), 0);
                return (
                  <section key={group.key}>
                    {grouped && (
                      <div className="bv-group-head">
                        <span className="bv-dot" style={{ background: style.color }} aria-hidden="true" />
                        <span>{style.label}</span>
                        <span className="bv-group-count">{group.items.length}</span>
                        <span className="spacer" />
                        {kindStyle(group.key).group !== 'meta' && (
                          <span className="micro">共引用 {sourcesLabel} 筆來源</span>
                        )}
                      </div>
                    )}
                    {group.items.map((node) => {
                      const style = kindStyle(node.kind);
                      return (
                        <button
                          type="button"
                          key={node.id}
                          className={`bv-row${selectedId === node.id ? ' is-on' : ''}`}
                          onClick={() => focusNode(node.id)}
                          aria-label={`選取節點：${node.title}`}
                        >
                          <span className="bv-cell-title">
                            <span className="bv-dot" style={{ background: style.color }} aria-hidden="true" />
                            <span className="t">{node.title}</span>
                            {node.demo && <span className="badge badge-gold">demo</span>}
                          </span>
                          <span className="bv-col bv-col-hide">{style.label}</span>
                          <span className="bv-col bv-col-hide">{node.domains.join('、') || '—'}</span>
                          <span className="bv-col bv-col-num">{sourceCountOf(model, node)}</span>
                          <span className="bv-col bv-col-time">{formatRange(node.start, node.end, node.time_precision)}</span>
                        </button>
                      );
                    })}
                  </section>
                );
              })}
            </>
          ) : tab === 'sources' ? (
            <>
              <div className="bv-cols" aria-hidden="true">
                {headerCols.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              {pagedSources.map((source) => (
                <button
                  type="button"
                  key={source.id}
                  className={`bv-row${openSourceId === source.id ? ' is-on' : ''}`}
                  onClick={() => {
                    setOpenSourceId(source.id);
                    setOpenClaimId(null);
                  }}
                  aria-label={`開啟來源：${source.title}`}
                >
                  <span className="bv-cell-title">
                    <Icon name="source" size={12} />
                    <span className="t">{source.title}</span>
                    {source.demo && <span className="badge badge-gold">demo</span>}
                  </span>
                  <span className="bv-col bv-col-hide">{source.publisher || '—'}</span>
                  <span className="bv-col bv-col-hide">
                    {source.published_at ? formatDate(source.published_at) : '—'}
                  </span>
                  <span className="bv-col bv-col-hide">{SOURCE_TYPE_LABELS[source.source_type] ?? source.source_type}</span>
                  <span className="bv-col bv-col-num">{source.related_ids.length}</span>
                </button>
              ))}
            </>
          ) : (
            <>
              <div className="bv-cols" aria-hidden="true">
                {headerCols.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              {pagedClaims.map((claim) => (
                <button
                  type="button"
                  key={claim.id}
                  className={`bv-row${openClaimId === claim.id ? ' is-on' : ''}`}
                  onClick={() => {
                    setOpenClaimId(claim.id);
                    setOpenSourceId(null);
                  }}
                  aria-label={`開啟主張：${claim.title || claim.statement}`}
                >
                  <span className="bv-cell-title">
                    <Icon name="claim" size={12} />
                    <span className="t">{claim.title || claim.statement}</span>
                    {claim.demo && <span className="badge badge-gold">demo</span>}
                  </span>
                  <span className="bv-col bv-col-hide">
                    {EPISTEMIC_LABELS[claim.epistemic_status] ?? claim.epistemic_status}
                  </span>
                  <span className="bv-col bv-col-hide">
                    支持 {claim.supporting.length}／反駁 {claim.contradicting.length}
                  </span>
                  <span className="bv-col bv-col-num">{confidenceText(claim.confidence) || '—'}</span>
                  <span className="bv-col bv-col-num">{claim.sources.length}</span>
                </button>
              ))}
            </>
          )}
        </div>

        {showDetail && model && (
          <aside className="bv-detail" aria-label="詳情面板">
            {openSource ? (
              <SourcePanel model={model} source={openSource} onClose={() => setOpenSourceId(null)} />
            ) : openClaim ? (
              <ClaimPanel model={model} claim={openClaim} onClose={() => setOpenClaimId(null)} />
            ) : null}
          </aside>
        )}
      </div>

      <div className="bv-foot">
        <span>
          共 {total.toLocaleString('zh-TW')} 筆 · 第 {safePage} / {maxPage} 頁
          {query.trim() !== '' ? ' · 已套用搜尋' : ''}
        </span>
        <span className="spacer" />
        <div className="bv-page">
          <button
            type="button"
            className="bv-page-btn"
            disabled={safePage <= 1}
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
          >
            上一頁
          </button>
          <button
            type="button"
            className="bv-page-btn"
            disabled={safePage >= maxPage}
            onClick={() => setPage((prev) => Math.min(maxPage, prev + 1))}
          >
            下一頁
          </button>
        </div>
      </div>
    </div>
  );
}
