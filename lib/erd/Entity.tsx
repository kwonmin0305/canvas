'use client';

// ═══════════════════════════════════════════════════════════
// 📁 lib/erd/Entity.tsx
// DB 테이블(ERD) 도형 — 머리줄(테이블 이름) + 컬럼 한 줄씩 (표시 · 이름 · 설명 · 타입)
//
//   편집은 모두 카드 안에서 (모달 없음)
//     이름·컬럼 더블클릭 → 그 칸만 입력 / 설명 더블클릭(없으면 "+ 설명") → 설명 입력
//     타입 더블클릭 → 그 자리에서 목록 / 컬럼 이름에서 Tab → 같은 줄 설명 / 마지막 컬럼에서 Enter → 다음 컬럼
//     빈 이름으로 끝내면 그 컬럼은 지워짐 / 고른 동안 카드 아래 "+ 컬럼"
//   컬럼을 한 번 누르면 그 컬럼이 골라짐 → 속성 패널에 대표 번호·필수·중복 불가·설명
//   컬럼 옆 점을 다른 테이블 컬럼으로 끌면 관계선 (Canvas onConnect → 'erd' 엣지)
//   높이는 컬럼 수로 정해짐 (lib/erd entityHeight) — 가로만 늘릴 수 있음
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { Handle, Position, useReactFlow, useStore } from '@xyflow/react';
import { Table2, KeyRound, Link2, Plus } from 'lucide-react';
import type { AppNode, AppEdge, EntityColumn, NodeData } from '@/types';
import { useCanvasStore } from '@/store/canvasStore';
import { ENTITY, ERD_TYPES, entityHeight, colHandle, colIdOfHandle, newColumn, typeLabel } from '@/lib/erd';
import styles from './Entity.module.css';
import { tr } from '@/lib/i18n';

// 필수(채운 마름모) / 비워 둘 수 있음(빈 마름모)
const Diamond = ({ filled }: { filled: boolean }) => (
  <svg width="8" height="8" viewBox="0 0 8 8" style={{ flex: 'none' }}>
    <path d="M4 0.6 7.4 4 4 7.4 0.6 4Z" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1" />
  </svg>
);

// 설명 편집 표시 — 'note:컬럼 id'
const noteKey = (colId: string) => `note:${colId}`;
const noteColId = (edit: string | null) => (edit?.startsWith('note:') ? edit.slice(5) : null);
const typeKey = (colId: string) => `type:${colId}`;

// 입력칸 너비 = 글자 수만큼 (한글 등은 2칸) — 이름 칸만 넓어지고 설명·타입은 제자리
const fitCh = (s: string, min: number) =>
  `${Math.max(min, [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0)) + 2}ch`;

export function EntityShape({ data, id, width, height, selected }: {
  data: NodeData; id: string; width: number; height: number; selected?: boolean;
}) {
  const { setNodes, setEdges, updateNodeData } = useReactFlow<AppNode, AppEdge>();
  const columns = data.columns ?? [];
  const realTypes = useCanvasStore((s) => s.erdRealTypes);
  const locked = useCanvasStore((s) => s.isLocked);
  const pickedCol = useCanvasStore((s) => (s.entityCol?.nodeId === id ? s.entityCol.colId : null));
  const setEntityCol = useCanvasStore((s) => s.setEntityCol);

  // 다른 테이블을 가리키는 컬럼 (관계선이 나가는 컬럼) — 연결 표시용
  const fkIds = useStore((s) => (s.edges as AppEdge[])
    .filter((e) => e.type === 'erd' && e.source === id)
    .map((e) => colIdOfHandle(e.sourceHandle)).join('|'));
  const fk = new Set(fkIds.split('|'));

  // 지금 고치는 곳 — 'title' · 컬럼 id(이름) · 'note:컬럼 id'(설명)
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const fresh = useRef(false);   // 막 만든 테이블 — 이름을 적고 Enter면 바로 첫 컬럼 입력으로
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!data.autoEdit) return;
    updateNodeData(id, { autoEdit: undefined });
    fresh.current = true;
    setDraft(data.title ?? '');
    setEdit('title');
  // 막 만든 노드에서 한 번만
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 새 컬럼은 입력 칸이 한 박자 늦게 생김 (컬럼 목록이 캔버스를 거쳐 돌아옴) — 칸이 생긴 때에 맞춰 커서를 둠
  const editReady = edit === 'title' || columns.some((c) => c.id === edit || noteKey(c.id) === edit);
  useEffect(() => {
    const el = inputRef.current;
    if (!edit || !editReady || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [edit, editReady]);

  // 타입 목록은 열자마자 펼침 (더블클릭 직후라 브라우저가 허용)
  const selectRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const el = selectRef.current;
    if (!edit?.startsWith('type:') || !el) return;
    el.focus();
    try { el.showPicker?.(); } catch { /* 막히면 포커스만 — 클릭·키보드로 고름 */ }
  }, [edit]);

  // 선택이 풀리면 고른 컬럼도 풀림
  useEffect(() => {
    if (!selected && pickedCol) setEntityCol(null);
  }, [selected, pickedCol, setEntityCol]);

  // 컬럼 목록 바꾸기 — 높이를 컬럼 수에 맞춤. 지워진 컬럼의 관계선도 같이 지움
  const setColumns = (next: EntityColumn[]) => {
    const h = entityHeight(next.length);
    setNodes((nds) => nds.map((n) => (n.id === id
      ? { ...n, height: h, measured: n.measured ? { ...n.measured, height: h } : n.measured, data: { ...n.data, columns: next, height: h } }
      : n)));
    const alive = new Set(next.map((c) => c.id));
    setEdges((eds) => eds.filter((e) => e.type !== 'erd'
      || ((e.source !== id || alive.has(colIdOfHandle(e.sourceHandle) ?? '')) && (e.target !== id || alive.has(colIdOfHandle(e.targetHandle) ?? '')))));
  };

  const startEdit = (target: string) => {
    const noteOf = noteColId(target);
    setDraft(
      target === 'title' ? (data.title ?? '')
        : noteOf ? (columns.find((c) => c.id === noteOf)?.note ?? '')
          : (columns.find((c) => c.id === target)?.name ?? ''),
    );
    setEdit(target);
  };
  // 컬럼의 한 칸 고치기 시작 — 그 컬럼을 고른 상태로
  const editCell = (colId: string, target: string) => {
    setEntityCol({ nodeId: id, colId });
    startEdit(target);
  };
  const addColumn = (base: EntityColumn[] = columns) => {
    const col = newColumn();
    setColumns([...base, col]);
    setDraft('');
    setEdit(col.id);
    setEntityCol({ nodeId: id, colId: col.id });
  };

  // 지금 고치던 것 반영 — 컬럼 이름이 비면 그 컬럼을 지움. 반영된 컬럼 목록을 돌려줌
  const commit = (): EntityColumn[] => {
    const name = draft.trim();
    if (edit === 'title') {
      if (name !== (data.title ?? '')) updateNodeData(id, { title: name });
      return columns;
    }
    // 설명 — 비우면 설명 없음
    const noteOf = noteColId(edit);
    if (noteOf) {
      const note = name || undefined;
      if (note === columns.find((c) => c.id === noteOf)?.note) return columns;
      const next = columns.map((c) => (c.id === noteOf ? { ...c, note } : c));
      setColumns(next);
      return next;
    }
    const col = columns.find((c) => c.id === edit);
    if (!col) return columns;
    if (!name) {
      const next = columns.filter((c) => c.id !== edit);
      if (next.length) { setColumns(next); return next; }
      return columns;   // 마지막 하나는 남김
    }
    if (name === col.name) return columns;
    const next = columns.map((c) => (c.id === edit ? { ...c, name } : c));
    setColumns(next);
    return next;
  };
  const finish = () => { commit(); setEdit(null); fresh.current = false; };

  const onKey = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.nativeEvent.isComposing) return;   // 한글 조합 중 Enter는 조합 확정용
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = commit();
      const isLast = edit !== 'title' && next[next.length - 1]?.id === edit;
      // 이름을 비운 채 Enter면 거기서 끝 / 마지막 컬럼(또는 막 만든 테이블 이름)이면 다음 컬럼
      if (draft.trim() && (isLast || (edit === 'title' && fresh.current))) addColumn(next);
      else setEdit(null);
      fresh.current = false;
    } else if (e.key === 'Tab' && edit && edit !== 'title' && !noteColId(edit)) {
      // 컬럼 이름 → 같은 줄 설명으로
      e.preventDefault();
      const col = edit;
      const next = commit();
      if (next.some((c) => c.id === col)) startEdit(noteKey(col));
      else setEdit(null);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // 이름 없는 새 컬럼이면 지움, 아니면 고치기 전 그대로
      const col = columns.find((c) => c.id === edit);
      if (col && !col.name && columns.length > 1) setColumns(columns.filter((c) => c.id !== edit));
      setEdit(null);
      fresh.current = false;
    }
  };
  // 줄 안에서(이름 ↔ 타입) 옮겨 가는 건 편집 계속
  const onBlur = (e: React.FocusEvent) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.closest('[data-edit-row]')?.contains(e.relatedTarget)) return;
    finish();
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className={styles.card} style={{ width, height, opacity: (data.opacity ?? 100) / 100 }}>
      <div
        className={styles.header}
        style={{ height: ENTITY.HEADER_H }}
        data-edit-row
        onDoubleClick={(e) => { e.stopPropagation(); if (!locked) startEdit('title'); }}
      >
        <Table2 size={14} strokeWidth={1.8} className={styles.headerIcon} />
        {edit === 'title' ? (
          <input
            ref={inputRef} className={`${styles.input} nodrag nopan`} value={draft} placeholder={tr('테이블 이름 (예: users)', 'Table name (e.g. users)')}
            onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={onBlur}
            onMouseDown={stop} onPointerDown={stop} onClick={stop} onDoubleClick={stop}
          />
        ) : (
          <span className={`${styles.headerName} ${data.title ? '' : styles.placeholder}`}>{data.title || tr('테이블 이름', 'Table name')}</span>
        )}
      </div>

      {columns.map((c) => {
        const editing = edit === c.id;
        const editingNote = edit === noteKey(c.id);
        return (
          <div
            key={c.id}
            data-edit-row
            className={`${styles.row} ${pickedCol === c.id ? styles.rowOn : ''}`}
            style={{ height: ENTITY.ROW_H }}
            onClick={() => setEntityCol({ nodeId: id, colId: c.id })}
            // 더블클릭한 칸만 고침 — 이름·설명·타입이 각자 받음. 빈 곳(설명 없는 자리)은 설명 입력
            onDoubleClick={(e) => { e.stopPropagation(); if (!locked) editCell(c.id, noteKey(c.id)); }}
          >
            <Handle type="source" position={Position.Left} id={colHandle(c.id, 'l')} className={styles.dot} style={{ left: -5 }} />
            <span className={styles.marks} onDoubleClick={stop}>
              {c.pk
                ? <span title={tr('대표 번호 (Primary key) — 이 테이블에서 줄 하나하나를 구분하는 값', 'Primary key — the value that identifies each row in this table')} style={{ color: '#d97706', display: 'flex' }}><KeyRound size={12} strokeWidth={2} /></span>
                : fk.has(c.id)
                  ? <span title={tr('다른 테이블과 연결된 값 (Foreign key)', 'Value linked to another table (Foreign key)')} style={{ color: '#3b82f6', display: 'flex' }}><Link2 size={12} strokeWidth={2} /></span>
                  : <span style={{ width: 12 }} />}
              <span title={c.nullable ? tr('비워 둘 수 있음', 'Can be empty') : tr('꼭 채워야 함', 'Required')} style={{ color: 'var(--text-tertiary)', display: 'flex' }}>
                <Diamond filled={!c.nullable} />
              </span>
            </span>
            {/* 이름 — 고치는 동안 이 칸만 입력칸 (설명·타입은 제자리) */}
            {editing ? (
              <input
                ref={inputRef} className={`${styles.input} ${styles.nameInput} nodrag nopan`} value={draft} placeholder={tr('컬럼 이름', 'Column name')}
                style={{ width: fitCh(draft, 6) }}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={onBlur}
                onMouseDown={stop} onPointerDown={stop} onClick={stop} onDoubleClick={stop}
              />
            ) : (
              <span
                className={styles.name}
                onDoubleClick={(e) => { e.stopPropagation(); if (!locked) editCell(c.id, c.id); }}
              >{c.name || <span className={styles.placeholder}>{tr('이름 없음', 'Unnamed')}</span>}</span>
            )}
            {/* 설명 — 더블클릭해서 바로 입력, 없으면 줄에 마우스를 올렸을 때 "+ 설명" */}
            {editingNote ? (
              <input
                ref={inputRef} className={`${styles.input} ${styles.noteInput} nodrag nopan`} value={draft} placeholder={tr('설명 (예: 주문한 회원)', 'Description (e.g. ordering member)')}
                maxLength={80}
                onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={onBlur}
                onMouseDown={stop} onPointerDown={stop} onClick={stop} onDoubleClick={stop}
              />
            ) : c.note ? (
              <span
                className={styles.note} title={c.note}
                onDoubleClick={(e) => { e.stopPropagation(); if (!locked) editCell(c.id, noteKey(c.id)); }}
              >{c.note}</span>
            ) : (
              <span className={styles.spacer}>
                {!locked && !editing && (
                  <span
                    className={`${styles.addNote} nodrag nopan`}
                    onMouseDown={stop} onPointerDown={stop} onDoubleClick={stop}
                    onClick={(e) => { e.stopPropagation(); editCell(c.id, noteKey(c.id)); }}
                  >{tr('+ 설명', '+ Description')}</span>
                )}
              </span>
            )}
            {/* 타입 — 더블클릭하면 그 자리에서 목록 */}
            {edit === typeKey(c.id) ? (
              <select
                ref={selectRef} className={`${styles.select} nodrag nopan`} value={c.type}
                onChange={(e) => { setColumns(columns.map((x) => (x.id === c.id ? { ...x, type: e.target.value } : x))); setEdit(null); }}
                onKeyDown={onKey} onBlur={() => setEdit(null)}
                onMouseDown={stop} onPointerDown={stop} onClick={stop} onDoubleClick={stop}
              >
                {ERD_TYPES.map((t) => <option key={t.type} value={t.type}>{typeLabel(t.type, realTypes)}</option>)}
                {!ERD_TYPES.some((t) => t.type === c.type) && <option value={c.type}>{c.type}</option>}
              </select>
            ) : (
              <span
                className={`${styles.type} ${realTypes ? styles.typeReal : ''}`} title={realTypes ? typeLabel(c.type, false) : c.type}
                onDoubleClick={(e) => { e.stopPropagation(); if (!locked) editCell(c.id, typeKey(c.id)); }}
              >
                {typeLabel(c.type, realTypes)}
              </span>
            )}
            <Handle type="source" position={Position.Right} id={colHandle(c.id, 'r')} className={styles.dot} style={{ right: -5 }} />
          </div>
        );
      })}

      {selected && !locked && !edit && (
        <button
          className={`${styles.add} nodrag nopan`} style={{ top: height + 8 }}
          onMouseDown={stop} onPointerDown={stop}
          onClick={(e) => { e.stopPropagation(); addColumn(); }}
        >
          <Plus size={12} strokeWidth={2} /> {tr('컬럼', 'Column')}
        </button>
      )}
    </div>
  );
}
