'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/Node/Blocks.tsx
// Notion식 블록 — 캔버스의 목록·콜아웃·페이지 노드
//
//   - BlockEditor: 한 줄씩 쓰는 블록 편집기 (글머리 기호·번호·할 일·토글·일반 글)
//       Enter 같은 종류의 새 줄 · Shift+Enter 줄 안 줄바꿈 · Tab/Shift+Tab 들여쓰기
//       빈 줄에서 Backspace → 일반 글로 → 내어쓰기 → 윗줄과 합치기
//       "- " "1. " "[] " "> " 로 시작하면 해당 블록으로 바뀜, "/" 로 블록 종류 바꾸기
//   - ListShape / CalloutShape: 캔버스 노드 (더블클릭으로 편집, 높이는 내용에 맞춤)
//   - PageShape: 페이지 링크 — 더블클릭하면 모달에서 제목·본문 편집
// ═══════════════════════════════════════════════════════════

import React, {
  forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow } from '@xyflow/react';
import { Check, ChevronRight, FileText, List, ListOrdered, ListTodo, ListCollapse, Type, Smile, X } from 'lucide-react';
import type { BlockItem, BlockKind, NodeData } from '@/types';
import { defaultRadius, canvasRadius } from '@/constants/shapeRadius';
import styles from './Blocks.module.css';
import menuStyles from '@/components/SlashMenu/SlashMenu.module.css';
import { tr } from '@/lib/i18n';

// ── 블록 만들기 ──────────────────────────────────────────────
export const newBlock = (kind: BlockKind = 'text', text = '', indent = 0): BlockItem => ({
  id: `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  kind, text, indent,
  ...(kind === 'todo' ? { checked: false } : {}),
  ...(kind === 'toggle' ? { open: false } : {}),
});

const MAX_INDENT = 5;
const INDENT_PX  = 24;

// 블록 종류 — 블록 안 "/" 메뉴와 안내 글자에 사용
const BLOCK_TYPES: { kind: BlockKind; label: string; icon: React.ReactNode; keywords: string; hint: string }[] = [
  { kind: 'text',   label: tr('텍스트', 'Text'),         icon: <Type size={16} strokeWidth={1.8} />, keywords: 'text 글 ㅌ',         hint: tr("'/'를 눌러 블록 종류 바꾸기", "Press '/' to change block type") },
  { kind: 'bullet', label: tr('글머리 기호 목록', 'Bulleted list'), icon: <List size={16} strokeWidth={1.8} />, keywords: 'bullet list 글머리', hint: tr('리스트', 'List') },
  { kind: 'number', label: tr('번호 매기기 목록', 'Numbered list'), icon: <ListOrdered size={16} strokeWidth={1.8} />, keywords: 'number list 번호',   hint: tr('리스트', 'List') },
  { kind: 'todo',   label: tr('할 일 목록', 'To-do list'),      icon: <ListTodo size={16} strokeWidth={1.8} />, keywords: 'todo check 할일 체크', hint: tr('할 일', 'To-do') },
  { kind: 'toggle', label: tr('토글 목록', 'Toggle list'),       icon: <ListCollapse size={16} strokeWidth={1.8} />, keywords: 'toggle 토글 접기',   hint: tr('토글', 'Toggle') },
];
const hintOf = (kind: BlockKind) => BLOCK_TYPES.find((t) => t.kind === kind)?.hint ?? '';

// 줄 맨 앞에 쓰면 블록 종류가 바뀌는 단축 입력 (Notion과 같음)
const SHORTCUTS: [string, BlockKind][] = [
  ['- ', 'bullet'], ['* ', 'bullet'], ['1. ', 'number'], ['[] ', 'todo'], ['[ ] ', 'todo'], ['> ', 'toggle'],
];

// 번호 표시 — 단계마다 1. → a. → i.
const toAlpha = (n: number): string => (n <= 26 ? String.fromCharCode(96 + n) : toAlpha(Math.floor((n - 1) / 26)) + toAlpha(((n - 1) % 26) + 1));
const toRoman = (n: number) => {
  const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
};
const numberLabel = (n: number, indent: number) =>
  `${indent % 3 === 0 ? n : indent % 3 === 1 ? toAlpha(n) : toRoman(n)}.`;
const BULLETS = ['•', '◦', '▪'];

// 각 블록의 번호·숨김(닫힌 토글 아래)·하위 항목 여부 계산
const layoutBlocks = (items: BlockItem[]) => {
  const counters: number[] = [];
  const lastKind: (BlockKind | undefined)[] = [];
  let hideBelow = Infinity;   // 이 단계보다 깊은 블록은 닫힌 토글 안이라 숨김
  return items.map((it, i) => {
    const hidden = it.indent > hideBelow;
    if (!hidden) hideBelow = Infinity;
    // 같은 단계에서 번호 목록이 이어지는 동안만 번호가 올라감
    counters.length = it.indent + 1;
    lastKind.length = it.indent + 1;
    let num = 0;
    if (it.kind === 'number') {
      num = (lastKind[it.indent] === 'number' ? counters[it.indent] ?? 0 : 0) + 1;
      counters[it.indent] = num;
    }
    lastKind[it.indent] = it.kind;
    if (!hidden && it.kind === 'toggle' && !it.open) hideBelow = it.indent;
    const next = items[i + 1];
    return { num, hidden, hasChildren: !!next && next.indent > it.indent };
  });
};

// i번 블록과 그 하위 항목이 끝나는 다음 위치
const subtreeEnd = (items: BlockItem[], i: number) => {
  let j = i + 1;
  while (j < items.length && items[j].indent > items[i].indent) j++;
  return j;
};

// ── 블록 편집기 ──────────────────────────────────────────────
export interface BlockEditorHandle {
  focusStart: () => void;   // 첫 블록 맨 앞에 커서
  focusEnd:   () => void;   // 마지막 블록 끝에 커서 (마지막이 비어 있지 않으면 새 줄)
}

interface BlockEditorProps {
  items:        BlockItem[];
  onChange:     (items: BlockItem[]) => void;
  editable:     boolean;
  autoFocus?:   boolean;        // 편집을 시작하면 마지막 블록 끝에 커서
  emptyHint?:   string;         // 표시 모드에서 내용이 하나도 없을 때 안내
  onStartEdit?: () => void;     // 표시 모드에서 빈 토글 안내를 눌렀을 때 — 편집 시작
  onExit?:      () => void;     // Esc
}

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(function BlockEditor(
  { items: rawItems, onChange, editable, autoFocus = true, emptyHint, onStartEdit, onExit },
  ref,
) {
  const fallback = useRef<BlockItem>(newBlock());
  const items    = rawItems.length ? rawItems : [fallback.current];
  const layout   = useMemo(() => layoutBlocks(items), [items]);

  const taRefs  = useRef(new Map<string, HTMLTextAreaElement>());
  // 다음 렌더 뒤 커서 위치 — 내용이 바뀐 뒤(text가 반영된 뒤)에 옮겨야 커서가 끝으로 튀지 않음
  const pending = useRef<{ id: string; caret: number; text: string } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [slashSel,  setSlashSel]  = useState(0);
  const [slashOff,  setSlashOff]  = useState<string | null>(null);   // Esc로 닫은 "/" 메뉴

  const focusAfterRender = (id: string, caret: number, text: string) => { pending.current = { id, caret, text }; };
  const focusNow = (id: string, caret: number) => {
    const ta = taRefs.current.get(id);
    if (!ta) return;
    ta.focus();
    const c = caret < 0 ? ta.value.length : Math.min(caret, ta.value.length);
    ta.setSelectionRange(c, c);
  };

  const lastVisible = () => {
    for (let k = items.length - 1; k >= 0; k--) if (!layout[k].hidden) return k;
    return 0;
  };

  // 편집 시작 — 마지막 블록 끝에 커서
  useEffect(() => {
    if (!editable || !autoFocus || pending.current) return;
    const it = items[lastVisible()];
    focusAfterRender(it.id, -1, it.text);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable]);

  useEffect(() => {
    const p = pending.current;
    const ta = p && taRefs.current.get(p.id);
    if (!p || !ta || ta.value !== p.text) return;
    pending.current = null;
    focusNow(p.id, p.caret);
  });

  const commit = (next: BlockItem[]) => onChange(next);
  const patchAt = (i: number, patch: Partial<BlockItem>) =>
    commit(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));

  useImperativeHandle(ref, () => ({
    focusStart: () => focusNow(items[0].id, 0),
    focusEnd: () => {
      const k = lastVisible();
      const last = items[k];
      if (last.kind === 'text' && !last.text && last.indent === 0) { focusNow(last.id, 0); return; }
      const b = newBlock();
      commit([...items, b]);
      focusAfterRender(b.id, 0, '');
    },
  }));

  // 블록 종류 바꾸기 ("/" 메뉴·단축 입력)
  const setKind = (i: number, kind: BlockKind, text: string) => {
    const it = items[i];
    patchAt(i, { kind, text, checked: kind === 'todo' ? false : undefined, open: kind === 'toggle' ? false : undefined });
    focusAfterRender(it.id, 0, text);
  };

  const handleChange = (i: number, value: string, caret: number) => {
    const it = items[i];
    // 단축 입력 — 줄 맨 앞에 "- " 등을 막 쳤을 때 (커서가 단축 입력 바로 뒤)
    for (const [prefix, kind] of SHORTCUTS) {
      if (caret === prefix.length && value.startsWith(prefix) && !it.text.startsWith(prefix)) {
        setKind(i, kind, value.slice(prefix.length));
        return;
      }
    }
    if (slashOff === it.id && !value.startsWith('/')) setSlashOff(null);
    setSlashSel(0);
    patchAt(i, { text: value });
  };

  // "/" 메뉴 — 포커스된 줄이 "/검색어"(공백 없음)일 때
  const slashFor = (it: BlockItem) => {
    if (!editable || focusedId !== it.id || slashOff === it.id || !/^\/\S*$/.test(it.text)) return null;
    const q = it.text.slice(1).toLowerCase();
    const options = BLOCK_TYPES.filter((t) => `${t.label} ${t.keywords}`.toLowerCase().replace(/\s+/g, '').includes(q));
    return options.length ? options : null;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, i: number) => {
    if (e.nativeEvent.isComposing) return;   // 한글 조합 중 Enter·방향키는 조합 확정용
    const it  = items[i];
    const ta  = e.currentTarget;
    const s   = ta.selectionStart;
    const end = ta.selectionEnd;

    const slash = slashFor(it);
    if (slash) {
      const sel = Math.min(slashSel, slash.length - 1);
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashSel((sel + 1) % slash.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSlashSel((sel - 1 + slash.length) % slash.length); return; }
      if (e.key === 'Enter')     { e.preventDefault(); setKind(i, slash[sel].kind, ''); return; }
      if (e.key === 'Escape')    { e.preventDefault(); e.stopPropagation(); setSlashOff(it.id); return; }
    }

    if (e.key === 'Escape') {
      if (onExit) { e.preventDefault(); onExit(); }
      return;
    }

    // Enter — 커서 위치에서 나눠 아래에 같은 종류의 새 줄 (빈 줄이어도 같은 종류로 이어짐)
    // 목록에서 빠져나오려면 빈 줄 맨 앞에서 Backspace(일반 글로) 또는 Shift+Tab(내어쓰기)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const before = it.text.slice(0, s);
      const after  = it.text.slice(end);
      // 펼친 토글 끝에서 Enter → 토글 안 첫 줄, 닫힌 토글 → 하위 항목 뒤에 새 토글
      const intoToggle = it.kind === 'toggle' && it.open && s === it.text.length;
      const at = intoToggle ? i + 1 : it.kind === 'toggle' ? subtreeEnd(items, i) : i + 1;
      const b  = intoToggle ? newBlock('text', after, it.indent + 1) : newBlock(it.kind, after, it.indent);
      const next = items.map((x, k) => (k === i ? { ...x, text: before } : x));
      next.splice(at, 0, b);
      commit(next);
      focusAfterRender(b.id, 0, after);
      return;
    }

    // Backspace (맨 앞) — 목록 → 일반 글 → 내어쓰기 → 윗줄과 합치기
    if (e.key === 'Backspace' && s === 0 && end === 0) {
      if (it.kind !== 'text') { e.preventDefault(); setKind(i, 'text', it.text); return; }
      if (it.indent > 0)      { e.preventDefault(); shiftIndent(i, -1); return; }
      let p = i - 1;
      while (p >= 0 && layout[p].hidden) p--;
      if (p < 0) return;
      e.preventDefault();
      const prev   = items[p];
      const joined = prev.text + it.text;
      commit(items.flatMap((x, k) => (k === i ? [] : k === p ? [{ ...x, text: joined }] : [x])));
      focusAfterRender(prev.id, prev.text.length, joined);
      return;
    }

    if (e.key === 'Tab') { e.preventDefault(); shiftIndent(i, e.shiftKey ? -1 : 1); return; }

    // 맨 앞에서 ↑ / 맨 끝에서 ↓ → 윗줄·아랫줄로
    if (e.key === 'ArrowUp' && s === 0 && end === 0) {
      let p = i - 1;
      while (p >= 0 && layout[p].hidden) p--;
      if (p >= 0) { e.preventDefault(); focusNow(items[p].id, -1); }
      return;
    }
    if (e.key === 'ArrowDown' && s === it.text.length && end === s) {
      let n = i + 1;
      while (n < items.length && layout[n].hidden) n++;
      if (n < items.length) { e.preventDefault(); focusNow(items[n].id, 0); }
    }
  };

  // 들여쓰기·내어쓰기 — 하위 항목도 함께 이동. 바로 위 블록보다 두 단계 이상 깊어지지 않게
  const shiftIndent = (i: number, delta: 1 | -1) => {
    const it = items[i];
    if (delta < 0 && it.indent === 0) return;
    if (delta > 0 && (i === 0 || it.indent + 1 > items[i - 1].indent + 1 || it.indent >= MAX_INDENT)) return;
    const end = subtreeEnd(items, i);
    commit(items.map((x, k) => (k >= i && k < end ? { ...x, indent: x.indent + delta } : x)));
  };

  // 빈 토글 안내를 누르면 토글 안에 첫 줄을 만들고 편집 시작
  const addIntoToggle = (i: number) => {
    const b = newBlock('text', '', items[i].indent + 1);
    const next = [...items];
    next.splice(i + 1, 0, b);
    commit(next);
    focusAfterRender(b.id, 0, '');
    onStartEdit?.();
  };

  const allEmpty = items.length === 1 && !items[0].text && items[0].kind === 'text';

  return (
    <div className={styles.editor}>
      {items.map((it, i) => {
        const { num, hidden, hasChildren } = layout[i];
        if (hidden) return null;
        const slash   = slashFor(it);
        const focused = focusedId === it.id;
        const hint    = editable
          ? (focused ? hintOf(it.kind) : it.kind === 'text' ? '' : hintOf(it.kind))
          : (allEmpty ? emptyHint ?? '' : it.kind === 'text' ? '' : hintOf(it.kind));
        const done = it.kind === 'todo' && it.checked;
        // 표시 문자 칸 너비 — 번호는 글자 수만큼
        const markerW = it.kind === 'text' ? 0 : it.kind === 'number' ? `${Math.max(1.6, numberLabel(num, it.indent).length * 0.62 + 0.4)}em` : 26;

        return (
          <React.Fragment key={it.id}>
            <div className={styles.row} style={{ paddingLeft: it.indent * INDENT_PX }}>
              {/* 표시 문자 칸은 일반 글에도 너비 0으로 둠 — 종류가 바뀌어도 입력창이 다시 만들어지지 않게 */}
              <span className={styles.marker} style={{ width: markerW, marginRight: it.kind === 'text' ? 0 : 2 }}>
                {it.kind === 'bullet' && <span className={styles.bullet}>{BULLETS[it.indent % 3]}</span>}
                {it.kind === 'number' && <span className={styles.number}>{numberLabel(num, it.indent)}</span>}
                {it.kind === 'todo' && (
                  <button
                    className={`${styles.checkbox} ${done ? styles.checked : ''} nodrag nopan`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); patchAt(i, { checked: !it.checked }); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title={done ? tr('완료 취소', 'Mark not done') : tr('완료', 'Mark done')}
                  >
                    {done && <Check size={12} strokeWidth={3} />}
                  </button>
                )}
                {it.kind === 'toggle' && (
                  <button
                    className={`${styles.chevron} ${it.open ? styles.open : ''} nodrag nopan`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => { e.stopPropagation(); patchAt(i, { open: !it.open }); }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    title={it.open ? tr('접기', 'Collapse') : tr('펼치기', 'Expand')}
                  >
                    <ChevronRight size={15} strokeWidth={2} />
                  </button>
                )}
              </span>

              {/* 보이지 않는 복사본이 높이를 정하고 입력창은 그 위에 겹침 → 글이 길어지면 줄이 자동으로 늘어남 */}
              <div className={`${styles.cell} ${done ? styles.done : ''}`}>
                <div className={styles.text} style={{ visibility: editable ? 'hidden' : 'visible' }} aria-hidden={editable}>
                  {it.text ? `${it.text}${editable ? ' ' : ''}` : <span className={styles.hint}>{hint || '​'}</span>}
                  {!editable && it.text.endsWith('\n') && '​'}
                </div>
                {editable && (
                  <textarea
                    ref={(el) => { if (el) taRefs.current.set(it.id, el); else taRefs.current.delete(it.id); }}
                    className={`${styles.input} nodrag nopan nowheel`}
                    rows={1}
                    spellCheck={false}
                    value={it.text}
                    placeholder={hint}
                    onChange={(e) => handleChange(i, e.target.value, e.target.selectionStart)}
                    onKeyDown={(e) => handleKeyDown(e, i)}
                    onFocus={() => setFocusedId(it.id)}
                    onBlur={() => setFocusedId((f) => (f === it.id ? null : f))}
                  />
                )}
              </div>

              {slash && taRefs.current.get(it.id) && (
                // 빈 곳 "/" 메뉴(SlashMenu)와 같은 모양 — 검색어는 줄에 친 "/" 뒤 글자
                <FloatingMenu anchor={taRefs.current.get(it.id)!}>
                  <div className={menuStyles.search}>
                    <span className={menuStyles.slash}>/</span>
                    <span className={menuStyles.input}>
                      {it.text.slice(1) || <span style={{ color: 'var(--text-tertiary)' }}>{tr('검색어를 입력하세요', 'Type to search')}</span>}
                    </span>
                  </div>
                  <div className={menuStyles.list}>
                    <div className={menuStyles.section}>{tr('블록 종류', 'Block type')}</div>
                    {slash.map((t, k) => (
                      <button
                        key={t.kind}
                        className={`${menuStyles.item} ${k === Math.min(slashSel, slash.length - 1) ? menuStyles.active : ''}`}
                        onMouseEnter={() => setSlashSel(k)}
                        onClick={() => setKind(i, t.kind, '')}
                      >
                        <span className={menuStyles.icon}>{t.icon}</span>
                        <span className={menuStyles.label}>{t.label}</span>
                      </button>
                    ))}
                  </div>
                  <button className={menuStyles.footer} onClick={() => setSlashOff(it.id)}>
                    <span>{tr('메뉴 닫기', 'Close menu')}</span>
                    <span className={menuStyles.kbd}>esc</span>
                  </button>
                </FloatingMenu>
              )}
            </div>

            {/* 펼쳤는데 안이 비어 있는 토글 */}
            {it.kind === 'toggle' && it.open && !hasChildren && (
              <div
                className={`${styles.emptyToggle} nodrag nopan`}
                style={{ paddingLeft: (it.indent + 1) * INDENT_PX }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); addIntoToggle(i); }}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                {tr('빈 토글입니다. 클릭해서 내용을 추가하세요.', 'Empty toggle. Click to add content.')}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
});

// ── 블록 안 "/" 메뉴 — 화면 맨 위 층(body)에 띄움 ──────────────
// 노드 안에 그리면 위에 겹친 다른 노드에 가려지고 캔버스 확대 비율도 따라가므로,
// 입력 줄 위치만 재서 화면에 고정된 크기로 띄움. 아래 공간이 모자라면 위로 펼침
const MENU_W     = 300;   // 빈 곳 "/" 메뉴(SlashMenu)와 같은 크기
const MENU_MAX_H = 380;

function FloatingMenu({ anchor, children }: { anchor: HTMLElement; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; maxH: number } | null>(null);

  const place = useCallback(() => {
    const r = anchor.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const left  = Math.max(8, Math.min(r.left, window.innerWidth - MENU_W - 8));
    const next  = below >= Math.min(MENU_MAX_H, 200) || below >= above
      ? { left, top: r.bottom + 4, maxH: Math.min(MENU_MAX_H, below) }
      : { left, bottom: window.innerHeight - r.top + 4, maxH: Math.min(MENU_MAX_H, above) };
    setPos((p) => (p && p.left === next.left && p.top === next.top && p.bottom === next.bottom && p.maxH === next.maxH ? p : next));
  }, [anchor]);

  // 글자를 칠 때마다(다시 그릴 때마다) 위치 확인, 캔버스 확대·이동·창 크기 변경에도 따라감
  useLayoutEffect(place);
  useEffect(() => {
    const onMove = () => requestAnimationFrame(place);
    window.addEventListener('wheel', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('wheel', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [place]);

  if (!pos) return null;
  return createPortal(
    <div
      className={`${menuStyles.menu} nodrag nopan nowheel`}
      // 화면 맨 위 층에 고정 — 다른 노드·페이지 모달(2000)보다 위
      style={{ position: 'fixed', zIndex: 3000, left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH, width: MENU_W }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}   // 입력 줄 포커스 유지
      onWheel={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

// ── 이모지 고르기 ────────────────────────────────────────────
const EMOJIS = [
  '💡', '📌', '⚠️', '✅', '❗', '❓', '🔥', '⭐',
  '📝', '📄', '📚', '🎯', '🚀', '💬', '🔒', '⚙️',
  '🧪', '🐛', '📦', '🗂️', '🧭', '🗓️', '💰', '❤️',
];

function EmojiPicker({ onPick, onRemove, onClose, style }: {
  onPick: (emoji: string) => void;
  onRemove?: () => void;
  onClose: () => void;
  style?: React.CSSProperties;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 바깥을 누르면 닫힘
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [onClose]);
  return (
    <div ref={boxRef} className={`${styles.emojiPicker} nodrag nopan nowheel`} style={style} onDoubleClick={(e) => e.stopPropagation()}>
      {EMOJIS.map((em) => <button key={em} onClick={() => { onPick(em); onClose(); }}>{em}</button>)}
      {onRemove && <button className={styles.emojiRemove} onClick={() => { onRemove(); onClose(); }}>{tr('아이콘 없애기', 'Remove icon')}</button>}
    </div>
  );
}

// ── 노드 공통: 높이를 내용에 맞춤 ─────────────────────────────
function useFitHeight(ref: React.RefObject<HTMLElement>, id: string, height: number) {
  const { setNodes } = useReactFlow();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const h = Math.ceil(el.offsetHeight);   // 확대·축소와 상관없는 실제 높이
      if (!h || Math.abs(h - height) < 1) return;
      setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, height: h, data: { ...n.data, height: h } } : n)));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, id, height, setNodes]);
}

// 막 만든 노드면 한 번만 실행 (autoEdit 표시는 지움)
function useAutoEdit(data: NodeData, id: string, start: () => void) {
  const { updateNodeData } = useReactFlow();
  useEffect(() => {
    if (!data.autoEdit) return;
    updateNodeData(id, { autoEdit: undefined });
    start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

interface BlockShapeProps {
  data:   NodeData;
  id:     string;
  width:  number;
  height: number;
  ink:    string;   // 글자색
  font:   string;   // 글꼴
}

const BLOCK_FONT_PX = 15;

// 바깥 클릭(포커스가 노드 밖으로)으로 편집 끝내기
const leaveOnBlur = (setEditing: (v: boolean) => void) => (e: React.FocusEvent<HTMLDivElement>) => {
  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setEditing(false);
};

// ── 목록 노드 ────────────────────────────────────────────────
export function ListShape({ data, id, width, height, ink, font }: BlockShapeProps) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useFitHeight(boxRef, id, height);
  useAutoEdit(data, id, () => setEditing(true));

  // 윤곽선 — 파선·점선도 되도록 outline으로 그림 (안쪽으로 붙여서 크기 그대로)
  const hasStroke = !!data.strokeColor && data.strokeColor !== 'transparent';
  const sw = data.strokeWidth ?? 1;
  return (
    <div
      ref={boxRef}
      // 배경색을 따로 고르지 않았으면 투명 — 마우스를 올리면 연한 배경으로 영역 표시 (CSS)
      // 내용이 있든 없든 아주 연한 바탕으로 "여기 블록이 있다" 표시 (테두리 색을 고르면 그 테두리만)
      className={[
        !data.bgColor || data.bgColor === 'transparent' ? styles.listBox : '',
        !hasStroke ? styles.emptyBox : '',
      ].filter(Boolean).join(' ') || undefined}
      style={{
        width, padding: '4px 8px', boxSizing: 'border-box', borderRadius: canvasRadius(data.borderRadius ?? defaultRadius(data.shape)),
        ...(data.bgColor && data.bgColor !== 'transparent' ? { background: data.bgColor } : {}),
        ...(hasStroke ? { outline: `${sw}px ${data.strokeStyle ?? 'solid'} ${data.strokeColor}`, outlineOffset: -sw } : {}),
        color: ink, fontFamily: font, fontSize: BLOCK_FONT_PX, userSelect: editing ? 'text' : 'none',
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onBlur={leaveOnBlur(setEditing)}
    >
      <BlockEditor
        items={data.blocks ?? []}
        onChange={(blocks) => updateNodeData(id, { blocks })}
        editable={editing}
        onStartEdit={() => setEditing(true)}
        onExit={() => setEditing(false)}
      />
    </div>
  );
}

// ── 콜아웃 노드 ──────────────────────────────────────────────
export function CalloutShape({ data, id, width, height, ink, font }: BlockShapeProps) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useFitHeight(boxRef, id, height);
  useAutoEdit(data, id, () => setEditing(true));
  const closePicker = useCallback(() => setPicking(false), []);

  const stroke = data.strokeColor && data.strokeColor !== 'transparent' ? `0 0 0 ${data.strokeWidth ?? 1}px ${data.strokeColor}` : 'none';
  return (
    <div
      ref={boxRef}
      style={{
        position: 'relative', display: 'flex', gap: 8, width, padding: '12px 14px 12px 10px', boxSizing: 'border-box',
        borderRadius: canvasRadius(data.borderRadius ?? defaultRadius(data.shape)), boxShadow: stroke,
        background: data.bgColor ?? 'rgba(var(--ui-fg-rgb), 0.06)',
        color: ink, fontFamily: font, fontSize: BLOCK_FONT_PX, userSelect: editing ? 'text' : 'none',
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
      onBlur={leaveOnBlur(setEditing)}
    >
      <button
        className={`${styles.iconBtn} nodrag nopan`}
        style={{ width: 26, height: 26, fontSize: 18, flexShrink: 0 }}
        onClick={(e) => { e.stopPropagation(); setPicking((v) => !v); }}
        onDoubleClick={(e) => e.stopPropagation()}
        title={tr('아이콘 바꾸기', 'Change icon')}
      >
        {data.blockIcon || '💡'}
      </button>
      {picking && (
        <EmojiPicker
          style={{ top: 40, left: 6 }}
          onPick={(em) => updateNodeData(id, { blockIcon: em })}
          onClose={closePicker}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <BlockEditor
          items={data.blocks ?? []}
          onChange={(blocks) => updateNodeData(id, { blocks })}
          editable={editing}
          emptyHint={tr('내용을 입력하세요', 'Type something')}
          onStartEdit={() => setEditing(true)}
          onExit={() => setEditing(false)}
        />
      </div>
    </div>
  );
}

// ── 페이지 노드 (링크) + 모달 ─────────────────────────────────
export function PageShape({ data, id, width, height, ink, font }: BlockShapeProps) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useFitHeight(boxRef, id, height);
  useAutoEdit(data, id, () => setOpen(true));

  return (
    <>
      <div
        ref={boxRef}
        className={styles.pageLink}
        style={{ width, color: ink, fontFamily: font, fontSize: BLOCK_FONT_PX, background: data.bgColor ?? 'transparent', borderRadius: canvasRadius(data.borderRadius ?? defaultRadius(data.shape)), userSelect: 'none' }}
        onDoubleClick={(e) => { e.stopPropagation(); setOpen(true); }}
        title={tr('더블클릭해서 페이지 열기', 'Double-click to open page')}
      >
        <span style={{ display: 'flex', flexShrink: 0, fontSize: 18, lineHeight: 1, opacity: data.blockIcon ? 1 : 0.6 }}>
          {data.blockIcon || <FileText size={18} strokeWidth={1.7} />}
        </span>
        <span className={styles.pageTitle}>{data.title || tr('제목 없음', 'Untitled')}</span>
      </div>
      {open && <PageModal data={data} id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

// 모달 안 이벤트가 React 트리를 따라 캔버스 노드로 올라가지 않게 막음 (노드 선택·더블클릭·키보드 이동 방지)
const stop = (e: React.SyntheticEvent) => e.stopPropagation();

function PageModal({ data, id, onClose }: { data: NodeData; id: string; onClose: () => void }) {
  const { updateNodeData } = useReactFlow();
  const [picking, setPicking] = useState(false);
  const editorRef = useRef<BlockEditorHandle>(null);
  const closePicker = useCallback(() => setPicking(false), []);

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(e) => { stop(e); if (e.target === e.currentTarget) onClose(); }}
      onClick={stop}
      onDoubleClick={stop}
      onContextMenu={stop}
      onPointerDown={stop}
      onWheel={stop}
      onKeyDown={(e) => {
        stop(e);
        if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) onClose();
      }}
    >
      <div className={styles.modal} role="dialog" aria-modal="true" aria-label={data.title || tr('제목 없음', 'Untitled')}>
        <div className={styles.modalBar}>
          <span className={styles.crumb}>{data.blockIcon ? `${data.blockIcon} ` : ''}{data.title || tr('제목 없음', 'Untitled')}</span>
          <button className={styles.closeBtn} onClick={onClose} title={tr('닫기 (Esc)', 'Close (Esc)')}><X size={16} /></button>
        </div>
        <div className={styles.modalScroll}>
          <div className={styles.pageInner}>
            {data.blockIcon ? (
              <button className={`${styles.iconBtn} ${styles.pageIcon}`} onClick={() => setPicking((v) => !v)} title={tr('아이콘 바꾸기', 'Change icon')}>
                {data.blockIcon}
              </button>
            ) : (
              <button className={`${styles.iconBtn} ${styles.addIcon}`} onClick={() => setPicking((v) => !v)}>
                <Smile size={15} /> {tr('아이콘 추가', 'Add icon')}
              </button>
            )}
            {picking && (
              <EmojiPicker
                style={{ top: data.blockIcon ? 128 : 84, left: 48 }}
                onPick={(em) => updateNodeData(id, { blockIcon: em })}
                onRemove={data.blockIcon ? () => updateNodeData(id, { blockIcon: undefined }) : undefined}
                onClose={closePicker}
              />
            )}
            <input
              className={styles.pageTitleInput}
              autoFocus={!data.title}
              value={data.title}
              placeholder={tr('제목 없음', 'Untitled')}
              onChange={(e) => updateNodeData(id, { title: e.target.value })}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); editorRef.current?.focusStart(); }
              }}
            />
            <div className={styles.pageBody}>
              <BlockEditor
                ref={editorRef}
                items={data.blocks ?? []}
                onChange={(blocks) => updateNodeData(id, { blocks })}
                editable
                autoFocus={!!data.title}
              />
            </div>
            <div className={styles.pageTail} onClick={() => editorRef.current?.focusEnd()} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
