// ═══════════════════════════════════════════════════════════
// 📁 utils/slides.ts
// 슬라이드 순서
//
// 슬라이드 = 프레임. 단, 안에 다른 프레임을 품은 바깥 프레임은 '섹션'이라 슬라이드가 아님
// 규격(A4·16:9 등)이 없는 자유 프레임도 슬라이드 — 발표할 땐 화면에 맞춰 여백을 두고 보여줌
//
// 순서 = 같은 부모(섹션) 안에서 pageNumber 오름차순. 번호가 없거나 겹치면 위→아래, 왼쪽→오른쪽 위치로 정함
// 섹션은 자기 자리에서 안의 슬라이드를 차례로 펼침 → 1장(1,2) 2장(3,4,5)
// 화면에 보이는 번호는 저장값이 아니라 이 순서의 1, 2, 3… → 빠지거나 겹치지 않음
// ═══════════════════════════════════════════════════════════

import type { AppNode } from '@/types';
import { PAPER_SIZES } from '@/utils/paperSizes';

type SlideLike = Pick<AppNode, 'id' | 'position' | 'data' | 'parentId'>;

// 캔버스 기준 위치 — 프레임 안에 든 노드의 position은 부모 기준이라 부모 위치를 더함
const absolutePosition = (n: SlideLike, byId: Map<string, SlideLike>) => {
  let { x, y } = n.position;
  let parent = n.parentId ? byId.get(n.parentId) : undefined;
  while (parent) {
    x += parent.position.x;
    y += parent.position.y;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return { x, y };
};

export type SlideEntry<T> = {
  node:     T;
  kind:     'section' | 'slide';
  depth:    number;          // 섹션 안에 든 깊이 (0 = 맨 바깥)
  parent?:  string;          // 감싸는 프레임(섹션) id — 순서 바꾸기는 같은 부모끼리만
};

// 섹션·슬라이드를 목록 순서대로 — 섹션 다음에 그 안의 것들이 이어짐
//   같은 부모 안에서는 pageNumber, 없으면 위치 순 / 섹션 안 슬라이드는 섹션 자리에서 이어서 번호
export const slideTree = <T extends SlideLike>(nodes: T[]): SlideEntry<T>[] => {
  const byId   = new Map<string, SlideLike>(nodes.map((n) => [n.id, n]));
  const frames = nodes.filter((n) => n.data.shape === 'frame');
  const frameIds = new Set(frames.map((n) => n.id));

  // 가장 가까운 바깥 프레임 (부모가 프레임이 아니면 그 위로 계속)
  const frameParent = (n: SlideLike) => {
    let p = n.parentId;
    while (p && !frameIds.has(p)) p = byId.get(p)?.parentId;
    return p;
  };

  const children = new Map<string | undefined, T[]>();
  frames.forEach((n) => {
    const p = frameParent(n);
    children.set(p, [...(children.get(p) ?? []), n]);
  });

  const sorted = (list: T[]) =>
    list
      .map((n) => ({ n, pos: absolutePosition(n, byId) }))
      .sort((a, b) =>
        ((a.n.data.pageNumber as number | undefined) ?? Infinity) - ((b.n.data.pageNumber as number | undefined) ?? Infinity)
        || a.pos.y - b.pos.y
        || a.pos.x - b.pos.x,
      )
      .map(({ n }) => n);

  const out: SlideEntry<T>[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    sorted(children.get(parent) ?? []).forEach((n) => {
      // 안에 다른 프레임을 품었으면 섹션, 아니면 슬라이드
      const isSection = (children.get(n.id) ?? []).length > 0;
      out.push({ node: n, kind: isSection ? 'section' : 'slide', depth, parent });
      if (isSection) walk(n.id, depth + 1);
    });
  };
  walk(undefined, 0);
  return out;
};

export const slideOrder = <T extends SlideLike>(nodes: T[]): T[] =>
  slideTree(nodes).filter((e) => e.kind === 'slide').map((e) => e.node);

// 종이 규격 이름 — 저장된 값, 없으면(예전 프레임) 이름이나 크기(가로·세로 둘 다)로 찾음. 못 찾으면 자유 크기
export const paperSizeOf = (n: Pick<AppNode, 'width' | 'height' | 'data'>): string | undefined => {
  const saved = n.data.paperSize as string | undefined;
  if (saved) return saved;
  const byName = PAPER_SIZES.find((p) => p.name === n.data.title);
  if (byName) return byName.name;
  const w = Math.round(n.width  ?? (n.data.width  as number | undefined) ?? 0);
  const h = Math.round(n.height ?? (n.data.height as number | undefined) ?? 0);
  return PAPER_SIZES.find((p) => (p.w === w && p.h === h) || (p.w === h && p.h === w))?.name;
};

// 슬라이드 이름 — 기본 이름(Frame)이나, 예전 프레임처럼 이름 자리에 규격(A4 등)이 들어 있으면 이름 없음으로
export const slideTitleOf = (title: string | undefined): string =>
  !title || title === 'Frame' || PAPER_SIZES.some((p) => p.name === title) ? '' : title;

