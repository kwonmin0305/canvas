'use client';

// ═══════════════════════════════════════════════════════════
// 📁 lib/erd/ErdEdge.tsx
// DB 테이블 관계선 — 참조하는 컬럼(FK) → 참조되는 컬럼
//
//   선의 양 끝은 컬럼 줄 높이에 맞추고, 테이블 위치에 따라 왼쪽·오른쪽 중 가까운 쪽으로 붙음
//     (테이블을 옮기면 붙는 쪽도 따라 바뀜 — 핸들 id에서는 컬럼만 읽음)
//   끝 모양(까마귀발 표기): 참조되는 쪽은 "하나"(막대), 참조하는 쪽은 "여럿"(세 갈래)
//     참조하는 컬럼이 중복 불가·대표 번호면 1:1이라 양쪽 다 막대
// ═══════════════════════════════════════════════════════════

import { BaseEdge, Position, getSmoothStepPath, useInternalNode, type EdgeProps } from '@xyflow/react';
import type { AppNode } from '@/types';
import { ENTITY, colIdOfHandle } from '@/lib/erd';

const GAP = 28;     // 두 테이블이 이만큼은 떨어져야 마주 보는 변끼리 이음
const MARK = 11;    // 끝 모양 길이

export function ErdEdge({ id, source, target, sourceHandleId, targetHandleId, selected, style }: EdgeProps) {
  const s = useInternalNode<AppNode>(source);
  const t = useInternalNode<AppNode>(target);
  if (!s || !t) return null;

  const box = (n: NonNullable<typeof s>, handle?: string | null) => {
    const cols = n.data.columns ?? [];
    const idx = cols.findIndex((c) => c.id === colIdOfHandle(handle));
    const x = n.internals.positionAbsolute.x;
    const w = n.measured?.width ?? (n.data.width as number | undefined) ?? ENTITY.W;
    return {
      l: x, r: x + w, col: idx >= 0 ? cols[idx] : undefined,
      y: n.internals.positionAbsolute.y + (idx >= 0 ? ENTITY.HEADER_H + idx * ENTITY.ROW_H + ENTITY.ROW_H / 2 : ENTITY.HEADER_H / 2),
    };
  };
  const a = box(s, sourceHandleId);
  const b = box(t, targetHandleId);

  // 붙는 쪽 — 옆으로 떨어져 있으면 마주 보는 변, 위아래로 겹쳐 있으면 같은 쪽(가까운 쪽)으로 돌아감
  let sp: Position, tp: Position;
  if (a.r + GAP <= b.l) { sp = Position.Right; tp = Position.Left; }
  else if (b.r + GAP <= a.l) { sp = Position.Left; tp = Position.Right; }
  else if (Math.abs(a.r - b.r) <= Math.abs(a.l - b.l)) { sp = Position.Right; tp = Position.Right; }
  else { sp = Position.Left; tp = Position.Left; }
  const sx = sp === Position.Right ? a.r : a.l;
  const tx = tp === Position.Right ? b.r : b.l;

  const [path] = getSmoothStepPath({
    sourceX: sx, sourceY: a.y, sourcePosition: sp,
    targetX: tx, targetY: b.y, targetPosition: tp,
    borderRadius: 10, offset: 24,
  });

  // 끝 모양 — 테이블 변에서 바깥쪽으로
  const one = (x: number, y: number, dir: number) => `M${x + dir * MARK * 0.7} ${y - 5}V${y + 5}`;
  const many = (x: number, y: number, dir: number) => `M${x} ${y - 5}L${x + dir * MARK} ${y}L${x} ${y + 5}`;
  const sd = sp === Position.Right ? 1 : -1;
  const td = tp === Position.Right ? 1 : -1;
  const oneToOne = !!a.col && (!!a.col.unique || !!a.col.pk);
  const marks = `${oneToOne ? one(sx, a.y, sd) : many(sx, a.y, sd)}${one(tx, b.y, td)}`;

  const stroke = selected ? '#6366f1' : 'var(--text-tertiary)';
  const lineStyle = { ...style, stroke, strokeWidth: selected ? 1.8 : 1.3, fill: 'none' };
  return (
    <>
      <BaseEdge id={id} path={path} style={lineStyle} interactionWidth={16} />
      <path d={marks} style={lineStyle} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />
    </>
  );
}
