import type { AppNode } from '@/types';
import { doRectsIntersect } from '@/utils/helpers';

export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export interface PlacementOptions {
  padding?: number;
  step?: number;
  maxRings?: number;
}

const DEFAULT_SIZES: Record<string, { w: number; h: number }> = {
  card: { w: 170, h: 160 },
  rectangle: { w: 120, h: 120 },
  circle: { w: 112, h: 112 },
  diamond: { w: 120, h: 120 },
  cylinder: { w: 168, h: 120 },
  hexagon: { w: 120, h: 104 },
  document: { w: 172, h: 110 },
  note: { w: 172, h: 90 },
  frame: { w: 400, h: 300 },
  text: { w: 200, h: 60 },
};

const getSize = (node: AppNode) => {
  const shape = node.data?.shape ?? 'card';
  const fallback = DEFAULT_SIZES[shape] ?? DEFAULT_SIZES.card;
  const width = Number(node.width ?? node.data?.width ?? fallback.w);
  const height = Number(node.height ?? node.data?.height ?? fallback.h);
  return {
    w: Number.isFinite(width) && width > 0 ? width : fallback.w,
    h: Number.isFinite(height) && height > 0 ? height : fallback.h,
  };
};

export const getNodeRect = (node: AppNode, position: Point = node.position, padding = 0): Rect => {
  const { w, h } = getSize(node);
  return {
    x: position.x - padding,
    y: position.y - padding,
    w: w + padding * 2,
    h: h + padding * 2,
  };
};

export const getNodesBounds = (nodes: AppNode[]): Rect | null => {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    const rect = getNodeRect(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }

  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const rectIntersectsAny = (rect: Rect, occupied: Rect[]) =>
  occupied.some((other) => doRectsIntersect(rect.x, rect.y, rect.w, rect.h, other.x, other.y, other.w, other.h));

const buildOffsets = (step: number, maxRings: number): Point[] => {
  const offsets: Point[] = [{ x: 0, y: 0 }];

  for (let ring = 1; ring <= maxRings; ring += 1) {
    const delta = ring * step;

    for (let x = -delta; x <= delta; x += step) {
      offsets.push({ x, y: -delta });
      offsets.push({ x, y: delta });
    }

    for (let y = -delta + step; y <= delta - step; y += step) {
      offsets.push({ x: -delta, y });
      offsets.push({ x: delta, y });
    }
  }

  return offsets;
};

export const placeNodeCluster = (
  nodes: AppNode[],
  existingNodes: AppNode[],
  preferredTopLeft: Point,
  options: PlacementOptions = {},
): AppNode[] => {
  if (nodes.length === 0) return [];

  // frame 자식 노드(parentId 있음)는 상대좌표 → 이동 제외
  const topLevel = nodes.filter((n) => !(n as Record<string, unknown>).parentId);
  const children = nodes.filter((n) => !!(n as Record<string, unknown>).parentId);

  if (topLevel.length === 0) return nodes;

  const padding = options.padding ?? 80;
  const step = options.step ?? 72;
  const maxRings = options.maxRings ?? 18;

  const clusterBounds = getNodesBounds(topLevel);
  if (!clusterBounds) return nodes;

  // 기존 노드 중 top-level 만 충돌 체크 대상
  const occupied = existingNodes
    .filter((n) => !(n as Record<string, unknown>).parentId)
    .map((node) => getNodeRect(node, node.position, padding));

  const baseDx = preferredTopLeft.x - clusterBounds.x;
  const baseDy = preferredTopLeft.y - clusterBounds.y;

  const offsets = buildOffsets(step, maxRings);
  for (const offset of offsets) {
    const dx = baseDx + offset.x;
    const dy = baseDy + offset.y;
    const translated = topLevel.map((node) => ({
      ...node,
      position: {
        x: node.position.x + dx,
        y: node.position.y + dy,
      },
    }));

    const translatedRects = translated.map((node) => getNodeRect(node, node.position, padding));
    if (translatedRects.every((rect) => !rectIntersectsAny(rect, occupied))) {
      return [...translated, ...children];
    }
  }

  return [
    ...topLevel.map((node) => ({
      ...node,
      position: {
        x: node.position.x + baseDx,
        y: node.position.y + baseDy,
      },
    })),
    ...children,
  ];
};

export const placeSingleNode = (
  node: AppNode,
  existingNodes: AppNode[],
  preferredTopLeft: Point,
  options: PlacementOptions = {},
): AppNode => {
  const placed = placeNodeCluster([node], existingNodes, preferredTopLeft, options);
  return placed[0] ?? node;
};
