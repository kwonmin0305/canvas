'use client';

// ═══════════════════════════════════════════════════════════
// 📁 lib/erd/EntitySection.tsx
// 속성 패널의 DB 테이블(ERD) 부분
//   타입 표시(쉬운 이름 / 실제 타입) · 고른 컬럼 설정(타입·대표 번호·필수·중복 불가·설명·기본값·순서·삭제)
//   · 같은 묶음 테이블 자동 정렬 · SQL 복사 / 코드 블록으로 놓기
// ═══════════════════════════════════════════════════════════

import { useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ArrowUp, ArrowDown, Trash2, Plus } from 'lucide-react';
import type { AppNode, AppEdge, EntityColumn } from '@/types';
import { useCanvasStore } from '@/store/canvasStore';
import { codeBoxHeight } from '@/components/Node';
import {
  ENTITY, ERD_TYPES, typeLabel, entityHeight, colIdOfHandle,
  canvasToSchema, schemaToSql, erdScope, relayoutErd, buildBlankEntity,
} from '@/lib/erd';
import { tr } from '@/lib/i18n';

const TITLE = 'text-[11px] text-[rgba(var(--ui-fg-rgb),0.55)] select-none';
const BTN = 'flex items-center justify-center gap-1 h-7 text-[11px] border rounded-lg cursor-pointer transition-all duration-150';
const IDLE = 'bg-[rgba(var(--ui-fg-rgb),0.04)] border-transparent text-[rgba(var(--ui-fg-rgb),0.65)] hover:bg-[rgba(var(--ui-fg-rgb),0.08)] hover:text-[rgb(var(--ui-fg-rgb))]';
const ON = 'bg-indigo-400/20 border-indigo-300/40 text-[var(--ui-accent-text)]';
const FIELD = 'w-full h-7 px-2 text-[11px] rounded-lg border border-[rgba(var(--ui-fg-rgb),0.1)] bg-transparent text-[rgb(var(--ui-fg-rgb))] outline-none focus:border-indigo-300/60';
const DIV = <div className="h-px bg-[rgba(var(--ui-fg-rgb),0.06)] my-3 shrink-0" />;

export function EntitySection({ node }: { node: AppNode }) {
  const { setNodes, setEdges, getNodes, getEdges } = useReactFlow<AppNode, AppEdge>();
  const id = node.id;
  const columns = node.data.columns ?? [];
  const realTypes = useCanvasStore((s) => s.erdRealTypes);
  const setRealTypes = useCanvasStore((s) => s.setErdRealTypes);
  const pickedId = useCanvasStore((s) => (s.entityCol?.nodeId === id ? s.entityCol.colId : null));
  const setEntityCol = useCanvasStore((s) => s.setEntityCol);
  const col = columns.find((c) => c.id === pickedId);
  const idx = col ? columns.indexOf(col) : -1;
  const [copied, setCopied] = useState(false);

  const setColumns = (next: EntityColumn[]) => {
    const h = entityHeight(next.length);
    setNodes((nds) => nds.map((n) => (n.id === id
      ? { ...n, height: h, measured: n.measured ? { ...n.measured, height: h } : n.measured, data: { ...n.data, columns: next, height: h } }
      : n)));
  };
  const patch = (p: Partial<EntityColumn>) => col && setColumns(columns.map((c) => (c.id === col.id ? { ...c, ...p } : c)));
  const move = (d: -1 | 1) => {
    const j = idx + d;
    if (idx < 0 || j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[idx], next[j]] = [next[j], next[idx]];
    setColumns(next);
  };
  const remove = () => {
    if (!col || columns.length <= 1) return;
    setColumns(columns.filter((c) => c.id !== col.id));
    setEdges((eds) => eds.filter((e) => e.type !== 'erd'
      || !((e.source === id && colIdOfHandle(e.sourceHandle) === col.id) || (e.target === id && colIdOfHandle(e.targetHandle) === col.id))));
    setEntityCol(null);
  };

  // 같은 묶음(같은 프레임, 없으면 프레임 밖 전부)의 테이블로 SQL을 만듦
  const sql = () => {
    const nodes = getNodes(), edges = getEdges();
    return schemaToSql(canvasToSchema(nodes, edges, erdScope(nodes, id).ids));
  };
  const copySql = async () => {
    try {
      await navigator.clipboard.writeText(sql());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { alert(tr('복사하지 못했습니다. "코드 블록으로"를 눌러 캔버스에 놓은 뒤 복사해 주세요.', 'Could not copy. Press "As code block" to place it on the canvas, then copy it there.')); }
  };
  // SQL을 코드 블록으로 — 묶음(프레임) 오른쪽에 놓음
  const dropSql = () => {
    const code = sql();
    setNodes((nds) => {
      const { frame, ids } = erdScope(nds, id);
      const members = nds.filter((n) => ids.has(n.id));
      const right = (n: AppNode) => n.position.x + ((n.data.width as number | undefined) ?? n.width ?? ENTITY.W);
      const position = frame
        ? { x: right(frame) + 60, y: frame.position.y }
        : { x: Math.max(...members.map(right)) + 60, y: Math.min(...members.map((n) => n.position.y)) };
      const w = 460, h = codeBoxHeight({ code });
      const codeNode: AppNode = {
        id: `node-${Date.now()}`, type: 'custom', position, width: w, height: h, zIndex: 0, selected: true,
        ...(frame?.parentId ? { parentId: frame.parentId } : !frame && node.parentId ? { parentId: node.parentId } : {}),
        data: {
          title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'code', width: w, height: h,
          code, codeLanguage: 'SQL', codeTitle: 'schema.sql',
        },
      };
      return [...nds.map((n) => (n.selected ? { ...n, selected: false } : n)), codeNode];
    });
  };

  // 테이블 추가 — 같은 묶음(프레임) 안, 지금 고른 테이블과 같은 줄의 맨 아래 빈자리에. 놓자마자 이름 편집
  const addTable = () => {
    setNodes((nds) => {
      const me = nds.find((n) => n.id === id);
      if (!me) return nds;
      const { frame, ids } = erdScope(nds, id);
      const wOf = (n: AppNode) => (n.data.width as number | undefined) ?? n.width ?? ENTITY.W;
      const hOf = (n: AppNode) => (n.data.height as number | undefined) ?? n.height ?? entityHeight(n.data.columns?.length ?? 1);
      const x = me.position.x;
      // 새 테이블이 놓일 세로 줄과 가로로 겹치는 테이블들 아래로
      const below = nds.filter((n) => ids.has(n.id) && n.position.x < x + ENTITY.W && n.position.x + wOf(n) > x);
      const y = Math.max(...below.map((n) => n.position.y + hOf(n))) + 36;
      const blank = buildBlankEntity({ x, y });
      const table: AppNode = { ...blank, selected: true, ...(me.parentId && { parentId: me.parentId }) };
      const fw = frame ? Math.max(wOf(frame), x + ENTITY.W + 48) : 0;
      const fh = frame ? Math.max(hOf(frame), y + entityHeight(1) + 48) : 0;
      return [
        ...nds.map((n) => (frame && n.id === frame.id
          ? { ...n, width: fw, height: fh, measured: undefined, zIndex: -Math.ceil(fw * fh / 100), data: { ...n.data, width: fw, height: fh } }
          : n.selected ? { ...n, selected: false } : n)),
        table,
      ];
    });
    setEntityCol(null);
  };

  const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();
  const toggle = (label: string, title: string, on: boolean, onClick: () => void, disabled = false) => (
    <button title={title} disabled={disabled} onClick={onClick}
      className={`flex-1 ${BTN} ${on ? ON : IDLE} ${disabled ? 'opacity-40 cursor-default' : ''}`}>{label}</button>
  );

  return (
    <div className="flex flex-col gap-2">
      <span className={TITLE}>{tr('타입 표시', 'Type display')}</span>
      <div className="flex gap-1.5">
        {toggle(tr('쉬운 이름', 'Simple names'), tr('글자 · 숫자 · 날짜·시간처럼 쉬운 말로', 'Plain words like Text · Number · Date & time'), !realTypes, () => setRealTypes(false))}
        {toggle(tr('실제 타입', 'Real types'), tr('text · int · timestamptz처럼 DB에서 쓰는 이름으로', 'Names the DB uses, like text · int · timestamptz'), realTypes, () => setRealTypes(true))}
      </div>

      {DIV}
      {col ? (
        <>
          <span className={TITLE}>{tr('컬럼', 'Column')} · <b className="text-[rgb(var(--ui-fg-rgb))] font-semibold">{col.name || tr('이름 없음', 'Unnamed')}</b></span>
          <select className={`${FIELD} cursor-pointer`} value={col.type} onChange={(e) => patch({ type: e.target.value })} onKeyDown={stopKeys}>
            {ERD_TYPES.map((t) => (
              <option key={t.type} value={t.type} className="text-black">{typeLabel(t.type, false)} ({t.type})</option>
            ))}
            {!ERD_TYPES.some((t) => t.type === col.type) && <option value={col.type} className="text-black">{col.type}</option>}
          </select>
          <div className="flex gap-1.5">
            {toggle(tr('대표 번호', 'Primary key'), tr('이 테이블에서 줄 하나하나를 구분하는 값 (Primary key)', 'The value that identifies each row in this table (Primary key)'), !!col.pk, () => patch(col.pk ? { pk: undefined } : { pk: true, nullable: undefined }))}
            {toggle(tr('필수', 'Required'), tr('꼭 채워야 하는 값 (Not null)', 'Must have a value (Not null)'), !col.nullable, () => patch({ nullable: col.nullable ? undefined : true }), !!col.pk)}
            {toggle(tr('중복 불가', 'Unique'), tr('같은 값이 두 번 들어갈 수 없음 (Unique)', 'The same value cannot appear twice (Unique)'), !!col.unique || !!col.pk, () => patch({ unique: col.unique ? undefined : true }), !!col.pk)}
          </div>
          <input className={FIELD} placeholder={tr('설명 (예: 주문한 회원)', 'Description (e.g. ordering member)')} value={col.note ?? ''} maxLength={80}
            onChange={(e) => patch({ note: e.target.value || undefined })} onKeyDown={stopKeys} />
          <input className={FIELD} placeholder={tr('기본값 (예: now(), 0, \'pending\')', 'Default (e.g. now(), 0, \'pending\')')} value={col.default ?? ''} maxLength={80}
            onChange={(e) => patch({ default: e.target.value || undefined })} onKeyDown={stopKeys} />
          <div className="flex gap-1.5">
            <button className={`flex-1 ${BTN} ${IDLE}`} title={tr('위로', 'Move up')} disabled={idx <= 0} onClick={() => move(-1)}><ArrowUp size={12} strokeWidth={1.8} />{tr('위로', 'Up')}</button>
            <button className={`flex-1 ${BTN} ${IDLE}`} title={tr('아래로', 'Move down')} disabled={idx >= columns.length - 1} onClick={() => move(1)}><ArrowDown size={12} strokeWidth={1.8} />{tr('아래로', 'Down')}</button>
            <button className={`flex-1 ${BTN} ${IDLE} hover:!text-red-400`} title={tr('이 컬럼 지우기', 'Delete this column')} disabled={columns.length <= 1} onClick={remove}><Trash2 size={12} strokeWidth={1.8} />{tr('삭제', 'Delete')}</button>
          </div>
        </>
      ) : (
        <span className="text-[10px] leading-relaxed text-[rgba(var(--ui-fg-rgb),0.45)]">
          {tr('컬럼을 누르면 여기서 설정할 수 있습니다. 더블클릭하면 이름을 고치고, 컬럼 옆 점을 다른 테이블 컬럼으로 끌면 연결됩니다.', 'Click a column to set it up here. Double-click to rename it; drag the dot next to a column onto another table column to link them.')}
        </span>
      )}

      {DIV}
      <span className={TITLE}>{tr('DB 설계', 'DB design')}</span>
      <button className={`${BTN} ${IDLE}`} title={tr('같은 프레임 안, 이 테이블 아래 빈자리에 새 테이블 추가', 'Add a new table in the empty space below this one, in the same frame')} onClick={addTable}>
        <Plus size={12} strokeWidth={1.8} />{tr('테이블 추가', 'Add table')}
      </button>
      <button className={`${BTN} ${IDLE}`} title={tr('같은 프레임의 테이블을 관계에 맞춰 다시 배치', 'Re-arrange the tables in this frame by their relations')}
        onClick={() => setNodes((nds) => relayoutErd(nds, getEdges(), id))}>{tr('자동 정렬', 'Auto layout')}</button>
      <div className="flex gap-1.5">
        <button className={`flex-1 ${BTN} ${IDLE}`} title={tr('같은 프레임의 테이블을 만드는 SQL을 복사', 'Copy the SQL that creates the tables in this frame')} onClick={copySql}>{copied ? tr('복사됨', 'Copied') : tr('SQL 복사', 'Copy SQL')}</button>
        <button className={`flex-1 ${BTN} ${IDLE}`} title={tr('SQL을 캔버스에 코드 블록으로 놓기', 'Place the SQL on the canvas as a code block')} onClick={dropSql}>{tr('코드 블록으로', 'As code block')}</button>
      </div>
    </div>
  );
}
