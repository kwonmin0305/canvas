// ═══════════════════════════════════════════════════════════
// 📁 utils/aiRows.ts
// AI 결과물을 종류별 줄로 놓기 — "전체 세트"가 가로로만 끝없이 길어지지 않게
//
//   1줄: PRD · 유저 플로우
//   2줄: 와이어프레임 (화면)
//   3줄: 아키텍처 + 기술 스택 → ERD → API
//
//   · 같은 줄에 이미 있으면 → 그 줄 오른쪽 끝 + 간격, 줄 위쪽 끝에 맞춤
//   · 그 줄이 비어 있으면 → 지금 캔버스 전체 아래 + 간격, 왼쪽 끝에 맞춤 (새 줄)
//   · 종류를 모르는 묶음(요약 다이어그램·사용자가 그린 것 등)은 null → 원래 방식
//   종류는 도구가 만드는 요소 id 접두어로 알아봄 (lib/ai/pipeline/interview.ts outputsOnCanvas와 같은 기준)
// ═══════════════════════════════════════════════════════════

import type { AppNode } from '@/types';
import { getNodesBounds, type Point } from '@/utils/nodePlacement';

export type AiRow = 1 | 2 | 3;

export const ROW_GAP = 160;   // 줄 사이 세로 간격
export const ITEM_GAP = 120;  // 같은 줄 안 결과물 사이 가로 간격

/** 노드 id로 어느 줄인지 — 모르면 null */
export function aiRowOf(id: string): AiRow | null {
  if (/^(prd|flow)-/.test(id)) return 1;
  if (/^wireframe-/.test(id)) return 2;
  if (/^(erd|api|stack|arch)-/.test(id) || /^ai-\d+-\d+$/.test(id)) return 3;
  return null;
}

/** 새로 놓을 묶음의 줄 — 바깥(top-level) 노드 중 처음 알아본 것 기준 */
export function clusterRow(nodes: AppNode[]): AiRow | null {
  for (const n of nodes) {
    if (n.parentId) continue;
    const r = aiRowOf(n.id);
    if (r) return r;
  }
  return null;
}

/**
 * 묶음을 놓을 왼쪽 위 자리 — 줄을 모르거나 캔버스가 비어 있으면 null (부르는 쪽이 원래 방식으로)
 * @param existing 캔버스에 이미 있는 노드
 * @param row      새 묶음의 줄
 */
export function rowTopLeft(existing: AppNode[], row: AiRow): Point | null {
  const tops = existing.filter((n) => !n.parentId);
  const all = getNodesBounds(tops);
  if (!all) return null;

  const sameRow = getNodesBounds(tops.filter((n) => aiRowOf(n.id) === row));
  if (sameRow) return { x: sameRow.x + sameRow.w + ITEM_GAP, y: sameRow.y };

  // 새 줄 — 다른 AI 줄이 있으면 그 왼쪽 끝에, 없으면 캔버스 전체 왼쪽 끝에 맞춤
  const aiRows = getNodesBounds(tops.filter((n) => aiRowOf(n.id) !== null));
  return { x: (aiRows ?? all).x, y: all.y + all.h + ROW_GAP };
}
