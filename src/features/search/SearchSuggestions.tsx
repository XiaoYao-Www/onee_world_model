import type { JSX } from 'react';
import { kindStyle } from '../../lib/palette';
import { SEARCH_LAYER_HINT, SEARCH_LAYER_LABELS, type SearchHit, type SearchLayer } from '../../lib/search';
import type { ModelBundle } from '../../data/types';
import { DERIVED_LAYERS, type Suggestion } from './suggest';
import './search.css';

interface Props {
  model: ModelBundle;
  groups: { layer: SearchLayer; items: Suggestion[] }[];
  flat: Suggestion[];
  total: number;
  active: number;
  onPick: (hit: SearchHit) => void;
  onHover: (index: number) => void;
}

/**
 * 搜尋下拉建議清單：分層標示，事實關係與衍生／檢索推薦使用不同標記，
 * 讓使用者不必猜測哪一筆是已記錄的關係。
 */
export default function SearchSuggestions({ model, groups, flat, total, active, onPick, onHover }: Props): JSX.Element {


  return (
    <>
      {groups.map((group) => (
        <div key={group.layer}>
          <div className="sb-group-head" title={SEARCH_LAYER_HINT[group.layer]}>
            <span>{SEARCH_LAYER_LABELS[group.layer]}</span>
            <span style={{ letterSpacing: 0 }}>{group.items.length}</span>
            <span className="spacer" />
            <span className={`sb-tag${DERIVED_LAYERS.has(group.layer) ? ' is-derived' : ' is-fact'}`}>
              {group.layer === 'relation' ? '事實關係' : DERIVED_LAYERS.has(group.layer) ? '衍生' : '直接命中'}
            </span>
          </div>
          {group.items.map(({ hit, layer }) => {
            const flatIndex = flat.findIndex((s) => s.hit.id === hit.id && s.layer === layer);
            const node = model.nodeById.get(hit.id);
            const style = kindStyle(node?.kind);
            const isDerived = DERIVED_LAYERS.has(layer);
            const otherLayers = hit.layers.filter((l) => l !== layer);
            return (
              <button
                type="button"
                key={`${layer}:${hit.id}`}
                id={`sb-opt-${flatIndex}`}
                role="option"
                aria-selected={active === flatIndex}
                className={`sb-row${isDerived ? ' is-derived' : ''}${active === flatIndex ? ' is-active' : ''}`}
                onMouseEnter={() => onHover(flatIndex)}
                onClick={() => onPick(hit)}
              >
                <span className="sb-dot" style={{ background: style.color }} aria-hidden="true" />
                <span className="sb-row-main">
                  <span className="sb-row-title truncate">{node?.title ?? hit.id}</span>
                  <span className="sb-row-sub truncate">
                    <span className="sb-kind">{style.label}</span>
                    {hit.reason || SEARCH_LAYER_LABELS[layer]}
                  </span>
                </span>
                {otherLayers.map((l) => (
                  <span
                    key={l}
                    className={`sb-tag${DERIVED_LAYERS.has(l) ? ' is-derived' : ''}`}
                    title={SEARCH_LAYER_HINT[l]}
                  >
                    {SEARCH_LAYER_LABELS[l]}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
      ))}
      <div className="sb-foot">
        <span>共 {total} 筆命中</span>
        <span className="spacer" />
        <span>左側面板可看完整分層</span>
      </div>
    </>
  );
}
