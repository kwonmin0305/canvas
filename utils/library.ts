// ═══════════════════════════════════════════════════════════
// 📁 utils/library.ts
// 라이브러리 — 자주 쓰는 요소 묶음을 저장해 두고 다시 꺼내 쓰기
//
// 저장 형식은 처음부터 '남에게 줄 수 있는 모양'
//   - 항목 하나 = 이름 · 만든 사람 · 만든 때 · 요소(노드)와 연결선 묶음
//   - 파일 = { type: 'course-library', version, items } → 그대로 내보내기·가져오기
//   - 나중에 링크 공유·공개 갤러리도 같은 형식을 그대로 씀
//   - 미리보기 = 실제 모습을 작게 찍은 webp (항목당 5~15KB). 없으면 요소 모양으로 대신 그림
// ═══════════════════════════════════════════════════════════

import { remapGroupIds } from '@/utils/group';
import type { AppNode, AppEdge } from '@/types';
import { withAllNodesRendered } from './renderAll';
import { tr } from '@/lib/i18n';

export const LIBRARY_FILE_TYPE = 'course-library';
export const LIBRARY_VERSION   = 1;
export const LIBRARY_DRAG_TYPE = 'application/x-course-library';   // 사이드바 → 캔버스 끌어놓기 데이터 종류

export type LibraryItem = {
  id:        string;
  name:      string;
  author?:   string;      // 만든 사람 (로그인 이름) — 남이 만든 걸 가져와도 원작자가 남음
  createdAt: number;
  nodes:     AppNode[];   // 묶음 왼쪽 위가 (0, 0)인 좌표. 부모(프레임)가 자식보다 앞
  edges:     AppEdge[];   // 묶음 안의 요소끼리 잇는 연결선만
  thumbnail?: string;     // 미리보기 이미지 — 로그인: Storage 주소 / 비로그인·파일: data URL. 없으면 요소 모양으로 그림
};

export type LibraryFile = {
  type:    typeof LIBRARY_FILE_TYPE;
  version: number;
  items:   LibraryItem[];
};

// DB(uuid 열)에 그대로 넣을 수 있게 uuid로
const uid = () => crypto.randomUUID();

export const sizeOfNode = (n: AppNode) => ({
  w: n.width  ?? n.measured?.width  ?? (n.data.width  as number | undefined) ?? 100,
  h: n.height ?? n.measured?.height ?? (n.data.height as number | undefined) ?? 100,
});

// 캔버스 기준 위치 — 부모를 끝까지 따라가며 더함
const absPos = (n: AppNode, byId: Map<string, AppNode>) => {
  let { x, y } = n.position;
  let p = n.parentId ? byId.get(n.parentId) : undefined;
  for (let guard = 0; p && guard < 50; guard++) {
    x += p.position.x;
    y += p.position.y;
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return { x, y };
};

// 저장에 필요 없는 화면 상태(선택·드래그·측정값)를 빼고 깨끗한 노드만
const cleanNode = (n: AppNode): AppNode => {
  const { selected: _s, dragging: _d, measured: _m, ...rest } = n;
  return rest as AppNode;
};

// 선택한 요소로 라이브러리 항목 만들기
//   - 프레임을 고르면 안에 든 것도 함께
//   - 부모가 묶음에 없으면 부모에서 떼어 캔버스 기준 위치로
export const makeLibraryItem = (
  selected: AppNode[], allNodes: AppNode[], allEdges: AppEdge[], name: string, author?: string,
): LibraryItem | null => {
  if (selected.length === 0) return null;
  const byId = new Map(allNodes.map((n) => [n.id, n]));

  // 선택 + 그 자손
  const ids = new Set(selected.map((n) => n.id));
  for (let grew = true; grew;) {
    grew = false;
    allNodes.forEach((n) => {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; }
    });
  }
  // 원래 순서 유지 → 부모가 자식보다 앞 (React Flow 규칙)
  const picked = allNodes.filter((n) => ids.has(n.id));

  // 바깥 요소(부모가 묶음 밖)는 캔버스 기준 위치로, 묶음 전체의 왼쪽 위를 (0, 0)으로
  const roots = picked.filter((n) => !n.parentId || !ids.has(n.parentId));
  const rootPos = new Map(roots.map((n) => [n.id, absPos(n, byId)]));
  const minX = Math.min(...[...rootPos.values()].map((p) => p.x));
  const minY = Math.min(...[...rootPos.values()].map((p) => p.y));

  const nodes = picked.map((n) => {
    const root = rootPos.get(n.id);
    const clean = cleanNode(n);
    return root
      ? { ...clean, parentId: undefined, extent: undefined, position: { x: root.x - minX, y: root.y - minY } }
      : clean;
  });
  const edges = allEdges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map(({ selected: _s, ...e }) => e as AppEdge);

  return { id: uid(), name, author, createdAt: Date.now(), nodes, edges };
};

// 항목을 캔버스에 놓을 노드·연결선으로 — 새 id를 붙여 몇 번이든 넣을 수 있게
//   at = 묶음 왼쪽 위가 놓일 캔버스 좌표
export const instantiateLibraryItem = (item: LibraryItem, at: { x: number; y: number }) => {
  const stamp = uid();
  const idMap = new Map(item.nodes.map((n) => [n.id, `${n.id}-${stamp}`]));
  const nodes: AppNode[] = item.nodes.map((n) => {
    const parentId = n.parentId ? idMap.get(n.parentId) : undefined;
    return {
      ...n,
      id: idMap.get(n.id)!,
      parentId,
      position: parentId ? n.position : { x: n.position.x + at.x, y: n.position.y + at.y },
      selected: !parentId,   // 넣자마자 바로 옮길 수 있게 바깥 요소를 선택해 둠
    };
  });
  const edges: AppEdge[] = item.edges.map((e) => ({
    ...e,
    id: `${e.id}-${stamp}`,
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));
  // 꺼낼 때마다 새 묶음 번호 — 같은 항목을 두 번 꺼내도 서로 한 묶음이 되지 않게
  return { nodes: remapGroupIds(nodes), edges };
};

// 묶음 전체 크기 (바깥 요소 기준)
export const itemBounds = (item: LibraryItem) => {
  let w = 0, h = 0;
  item.nodes.filter((n) => !n.parentId).forEach((n) => {
    const s = sizeOfNode(n);
    w = Math.max(w, n.position.x + s.w);
    h = Math.max(h, n.position.y + s.h);
  });
  return { w: Math.max(w, 1), h: Math.max(h, 1) };
};

// ── 파일로 주고받기 ──────────────────────────────────────────
export const toLibraryFile = (items: LibraryItem[]): LibraryFile => ({
  type: LIBRARY_FILE_TYPE, version: LIBRARY_VERSION, items,
});

// 남이 준 파일 읽기 — 형식이 맞는 항목만 받고, id는 새로 붙여 내 항목과 겹치지 않게
export const parseLibraryFile = (text: string): LibraryItem[] => {
  const data = JSON.parse(text) as Partial<LibraryFile>;
  if (data?.type !== LIBRARY_FILE_TYPE || !Array.isArray(data.items)) {
    throw new Error(tr('라이브러리 파일이 아니에요', 'Not a library file'));
  }
  return data.items
    .filter((it) => it && Array.isArray(it.nodes) && it.nodes.length > 0)
    .map((it) => ({
      id:        uid(),
      name:      String(it.name ?? tr('가져온 항목', 'Imported item')).slice(0, 40),
      author:    it.author ? String(it.author).slice(0, 60) : undefined,
      createdAt: Number(it.createdAt) || Date.now(),
      nodes:     it.nodes,
      edges:     Array.isArray(it.edges) ? it.edges : [],
      // 미리보기는 이미지(data URL)나 https 주소만 받음
      thumbnail: typeof it.thumbnail === 'string' && /^(data:image\/|https:\/\/)/.test(it.thumbnail) ? it.thumbnail : undefined,
    }));
};

// ── 미리보기 이미지 찍기 ─────────────────────────────────────
// 캔버스에서 고른 요소만 보이게 해서 작게 찍고 webp로 압축 (2배 해상도, 항목당 10~25KB)
//   bounds = 고른 요소 전체의 캔버스 범위 / ids = 묶음에 든 노드 id / edgeIds = 묶음 안 연결선 id
const THUMB_W = 240;
const THUMB_H = 160;

export const captureLibraryThumbnail = (
  bounds: { x: number; y: number; width: number; height: number },
  ids: Set<string>, edgeIds: Set<string>,
): Promise<Blob | null> => withAllNodesRendered(() => captureLibraryThumbnailNow(bounds, ids, edgeIds));

const captureLibraryThumbnailNow = async (
  bounds: { x: number; y: number; width: number; height: number },
  ids: Set<string>, edgeIds: Set<string>,
): Promise<Blob | null> => {
  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewportEl) return null;
  const { getViewportForBounds } = await import('@xyflow/react');
  const { x, y, zoom } = getViewportForBounds(bounds, THUMB_W, THUMB_H, 0.02, 4, 0.06);

  // 선택 테두리가 찍히지 않게 잠깐 선택 표시를 뗌 (찍은 뒤 되돌림)
  const selectedEls = [...viewportEl.querySelectorAll<HTMLElement>('.react-flow__node.selected, .react-flow__edge.selected')];
  selectedEls.forEach((el) => el.classList.remove('selected'));
  try {
    const { toCanvas } = await import('html-to-image');
    const canvas = await toCanvas(viewportEl, {
      // 2배로 찍어 작은 글자도 또렷하게 (그래도 항목당 10~25KB)
      width: THUMB_W, height: THUMB_H, pixelRatio: 2, skipFonts: true,
      style: { width: `${THUMB_W}px`, height: `${THUMB_H}px`, transform: `translate(${x}px, ${y}px) scale(${zoom})` },
      filter: (el) => {
        if (!(el instanceof Element)) return true;
        const cl = el.classList;
        // 편집용 표시(크기 조절 손잡이·여러 개 선택 상자)와 연결선 글자 칸은 빼기
        if (cl.contains('react-flow__resize-control') || cl.contains('react-flow__nodesselection')) return false;
        if (cl.contains('react-flow__edgelabel-renderer')) return false;
        // 묶음에 없는 노드·연결선은 빼기
        if (cl.contains('react-flow__node'))  return ids.has(el.getAttribute('data-id') ?? '');
        if (cl.contains('react-flow__edge'))  return edgeIds.has(el.getAttribute('data-id') ?? '');
        return true;
      },
    });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
  } catch {
    return null;   // 못 찍어도 저장은 됨 — 요소 모양으로 미리보기
  } finally {
    selectedEls.forEach((el) => el.classList.add('selected'));
  }
};

export const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
