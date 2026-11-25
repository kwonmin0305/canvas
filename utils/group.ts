// ═══════════════════════════════════════════════════════════
// 📁 utils/group.ts
// 묶음 — 여러 요소를 한 덩어리처럼 고르고 옮기기 (Ctrl+G 묶기 / Ctrl+Shift+G 풀기)
//
//   묶음은 따로 된 요소(프레임 같은 상자)가 아니라, 요소마다 적어 둔 같은 번호(data.groupId)
//   · 묶인 요소 하나를 누르면 같은 번호 전부가 선택됨 → 함께 끌려감 (Canvas)
//   · 더블클릭하면 그 요소 하나만 (그 묶음 "안에 들어간" 상태 — canvasStore.soloGroupId)
//   프레임·화살표 끝점은 묶지 않음 (프레임은 안의 요소를 이미 품고 있음)
// ═══════════════════════════════════════════════════════════

import type { AppNode } from '@/types';

export const groupIdOf = (n: AppNode | undefined): string | undefined =>
  typeof n?.data.groupId === 'string' && n.data.groupId ? n.data.groupId : undefined;

const canGroup = (n: AppNode) => n.data.shape !== 'frame' && n.data.shape !== 'anchor' && !n.data.isDocContainer && !n.data.isDocPage;

let seq = 0;
export const newGroupId = () => `g-${Date.now().toString(36)}-${(seq++).toString(36)}`;

// 고른 요소(ids)를 한 묶음으로 — 2개 이상일 때만. 이미 다른 묶음이던 것도 새 묶음 하나로 합쳐짐
export const groupNodes = (nodes: AppNode[], ids: Set<string>): AppNode[] => {
  const targets = nodes.filter((n) => ids.has(n.id) && canGroup(n));
  if (targets.length < 2) return nodes;
  const gid = newGroupId();
  const pick = new Set(targets.map((n) => n.id));
  return nodes.map((n) => (pick.has(n.id) ? { ...n, data: { ...n.data, groupId: gid } } : n));
};

// 고른 요소가 속한 묶음을 통째로 풂
export const ungroupNodes = (nodes: AppNode[], ids: Set<string>): AppNode[] => {
  const gids = new Set(nodes.filter((n) => ids.has(n.id)).map(groupIdOf).filter(Boolean));
  if (gids.size === 0) return nodes;
  return nodes.map((n) => (gids.has(groupIdOf(n)) ? { ...n, data: { ...n.data, groupId: undefined } } : n));
};

// 복사·붙여넣기·라이브러리에서 꺼낼 때: 묶음 번호를 새로 매김 (원본과 복사본이 한 묶음이 되지 않게)
export const remapGroupIds = (nodes: AppNode[]): AppNode[] => {
  const map = new Map<string, string>();
  return nodes.map((n) => {
    const g = groupIdOf(n);
    if (!g) return n;
    if (!map.has(g)) map.set(g, newGroupId());
    return { ...n, data: { ...n.data, groupId: map.get(g) } };
  });
};
