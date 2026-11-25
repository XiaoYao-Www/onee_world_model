import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react';
import Icon from '../../components/Icon';
import { useAppStore } from '../../store/useAppStore';
import { searchModel, type SearchHit } from '../../lib/search';
import SearchSuggestions from './SearchSuggestions';
import { buildSuggestions, flattenSuggestions } from './suggest';
import './search.css';

const EXAMPLES = ['台積電', '出口管制', 'NVIDIA'];

export default function SearchBox(): JSX.Element {
  const model = useAppStore((s) => s.model);
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const focusNode = useAppStore((s) => s.focusNode);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const lastPushedRef = useRef(search);
  const [text, setText] = useState(search);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // 外部（清除搜尋、URL 還原、其他面板）變更查詢時同步輸入框。
  useEffect(() => {
    if (search !== lastPushedRef.current) {
      lastPushedRef.current = search;
      setText(search);
    }
  }, [search]);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // `/` 或 Ctrl/Cmd+K 聚焦；在輸入框內不攔截 `/`。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
        return;
      }
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 點擊元件外部關閉建議清單
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const result = useMemo(() => {
    if (!model || search.trim() === '') return null;
    try {
      return searchModel(model, search, { limit: 5000 });
    } catch {
      return null;
    }
  }, [model, search]);

  // 每筆只出現在最強的一層，避免同一節點重複洗版；仍保留其他層的標記。
  const suggestions = useMemo(() => buildSuggestions(result), [result]);
  const flat = useMemo(() => flattenSuggestions(suggestions), [suggestions]);

  useEffect(() => {
    setActive(-1);
  }, [search]);

  const commit = (value: string) => {
    window.clearTimeout(timerRef.current);
    lastPushedRef.current = value;
    setText(value);
    setSearch(value);
  };

  const pickHit = (hit: SearchHit) => {
    window.clearTimeout(timerRef.current);
    lastPushedRef.current = text.trim();
    setSearch(text.trim());
    focusNode(hit.id);
    setOpen(false);
    setActive(-1);
  };

  const onChange = (value: string) => {
    setText(value);
    setOpen(true);
    setActive(-1);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const q = value.trim();
      lastPushedRef.current = q;
      setSearch(q);
    }, 150);
  };

  const clear = () => {
    window.clearTimeout(timerRef.current);
    lastPushedRef.current = '';
    setText('');
    setSearch('');
    setActive(-1);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (flat.length === 0) return;
      setActive((prev) => (prev + 1 >= flat.length ? 0 : prev + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (flat.length === 0) return;
      setActive((prev) => (prev <= 0 ? flat.length - 1 : prev - 1));
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (text !== '') clear();
      else setOpen(false);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = active >= 0 ? flat[active] : null;
      if (chosen) {
        pickHit(chosen.hit);
        return;
      }
      const q = text.trim();
      if (!q || !model) return;
      let best: SearchHit | undefined;
      try {
        best = searchModel(model, q, { limit: 1 }).hits[0];
      } catch {
        best = undefined;
      }
      if (best) {
        commit(q);
        focusNode(best.id);
        setOpen(false);
      }
    }
  };

  const showPanel = open;

  return (
    <div className="search-wrap" ref={rootRef}>
      <span className="search-icon" aria-hidden="true">
        <Icon name="search" size={15} />
      </span>
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        role="combobox"
        aria-expanded={showPanel && (suggestions.length > 0 || search.trim() === '')}
        aria-controls="global-search-listbox"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `sb-opt-${active}` : undefined}
        aria-label="全域搜尋世界模型（名稱、別名、正文與關係）"
        placeholder="搜尋名稱、別名、正文、關係…（/ 或 Ctrl+K）"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {text !== '' && (
        <button
          type="button"
          className="icon-btn search-clear"
          aria-label="清除搜尋"
          title="清除搜尋（Esc）"
          style={{ width: 28, height: 28 }}
          onClick={clear}
        >
          <Icon name="close" size={14} />
        </button>
      )}

      {showPanel && (
        <div className="sb-panel" role="listbox" id="global-search-listbox" aria-label="搜尋建議">
          {!model ? (
            <div className="sb-hint">
              <div className="sb-hint-title">資料尚未載入</div>
              <div className="micro">世界模型靜態資料仍在載入或尚未匯出；搜尋會在資料就緒後自動可用。</div>
            </div>
          ) : search.trim() === '' ? (
            <div className="sb-hint">
              <div className="sb-hint-title">全域搜尋</div>
              <div className="micro">
                支援繁體中文、英文原文、別名與縮寫；結果依「名稱／別名／正文／已記錄關係／圖譜鄰近／語意相似」分層呈現。
              </div>
              <div className="row wrap" style={{ gap: 6 }}>
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="sb-example"
                    onClick={() => {
                      commit(example);
                      inputRef.current?.focus();
                    }}
                  >
                    試試「{example}」
                  </button>
                ))}
              </div>
              <div className="micro row wrap" style={{ gap: 6 }}>
                <span className="kbd">/</span> 聚焦
                <span className="kbd">Esc</span> 清除
                <span className="kbd">↑↓</span> 移動
                <span className="kbd">Enter</span> 選取最佳結果
              </div>
            </div>
          ) : suggestions.length === 0 ? (
            <div className="sb-hint">
              <div className="sb-hint-title">沒有符合「{search.trim()}」的結果</div>
              <div className="micro">
                可用較短的名稱、英文原名或別名再試一次；本體可能尚未收錄此主題，搜尋不會自行生成不存在的關係。
              </div>
            </div>
          ) : (
            <SearchSuggestions
              model={model}
              groups={suggestions}
              flat={flat}
              total={result?.hits.length ?? 0}
              active={active}
              onPick={pickHit}
              onHover={setActive}
            />
          )}
        </div>
      )}
    </div>
  );
}
