'use client'; //클라이언트 서버

import React, { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Panel,
  MiniMap,
  ConnectionMode,
  ConnectionLineType,
  MarkerType,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useInternalNode,
  useViewport,
  useOnViewportChange,
  useStore,
  addEdge,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  getBezierPath,
  Position,
  PanOnScrollMode,
  ViewportPortal,
  type Connection,
  type OnConnect,
  type ReactFlowInstance,
  type PanelPosition,
  type EdgeProps,
  type ReactFlowState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  Square, Circle, ArrowRight, Type, Table,
  Pencil, Trash2, Frame, MoreHorizontal,
  FileText, Image, BarChart2, ChevronLeft,
} from 'lucide-react';
import { CustomNode, SHAPE_DEFAULTS, measureTextBoxHeight } from '@/components/Node';
import { NodePropertiesPanel } from '@/components/NodePropertiesPanel';
import { SlashMenu, type SlashItem } from '@/components/SlashMenu';
import { useCanvasStore, withLastFont } from '@/store/canvasStore';
import type { AppNode, AppEdge, NodeShape, EdgeData } from '@/types';
import { PAPER_SIZES, paperDims, type PaperSize } from '@/utils/paperSizes';
import { slideOrder } from '@/utils/slides';
import { instantiateLibraryItem, itemBounds, LIBRARY_DRAG_TYPE } from '@/utils/library';
import { useLibraryStore } from '@/store/libraryStore';
import { getNodesBounds, placeNodeCluster } from '@/utils/nodePlacement';
import { clusterRow, rowTopLeft } from '@/utils/aiRows';
import { prepareCanvasImage } from '@/utils/canvasImage';
import { captureNodesImage } from '@/utils/captureNodes';
import { withAllNodesRendered, useRenderAll } from '@/utils/renderAll';
import { acceptsImage } from '@/utils/imageSlot';
import { playAppear } from '@/utils/appearAnimation';
import { groupIdOf, groupNodes, ungroupNodes, remapGroupIds } from '@/utils/group';
import { Presenter } from './Presenter';
import { ErdEdge } from '@/lib/erd/ErdEdge';
import { colIdOfHandle, erdEdge } from '@/lib/erd';
import styles from './Canvas.module.css';
import { tr } from '@/lib/i18n';

const NODE_TYPES = { custom: CustomNode } as const;

// ReactFlow에 inline으로 넘기면 매 렌더마다 새 객체 → 내부 비교 비용 발생. 모듈 상수로 고정.
// maxZoom 1: 글 몇 줄뿐인 캔버스(새 프로젝트 인사)가 처음 열 때 화면 가득 확대되지 않게
const _FIT_VIEW_OPTIONS = { padding: 0.5, maxZoom: 1 } as const;
const _DEFAULT_VIEWPORT = { zoom: 0.75, x: 0, y: 0 } as const;
const _PRO_OPTIONS      = { hideAttribution: true } as const;

// 프레임을 배열 맨 앞에 정렬 — React Flow는 parentId가 작동하려면 부모가 자식보다 앞에 있어야 함
// 프레임 안에 프레임(섹션)이 들 수 있으므로 바깥 프레임 → 안쪽 프레임 순
const placeFramesFirst = (nodes: AppNode[]): AppNode[] => {
  const byId  = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: AppNode) => {
    let d = 0;
    for (let p = n.parentId; p && d < 50; p = byId.get(p)?.parentId) d++;
    return d;
  };
  const frames = nodes
    .filter((n) => n.data.shape === 'frame')
    .map((n, i) => ({ n, d: depth(n), i }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ n }) => n);
  return [...frames, ...nodes.filter((n) => n.data.shape !== 'frame')];
};

// 캔버스 기준 위치 — 부모(프레임 안의 프레임 포함)를 끝까지 따라가며 더함
const absPosOf = (n: AppNode, all: AppNode[]) => {
  let { x, y } = n.position;
  let p = n.parentId ? all.find((m) => m.id === n.parentId) : undefined;
  for (let guard = 0; p && guard < 50; guard++) {
    x += p.position.x;
    y += p.position.y;
    const pid = p.parentId;
    p = pid ? all.find((m) => m.id === pid) : undefined;
  }
  return { x, y };
};

const sizeOf = (n: AppNode, fallbackW = 100, fallbackH = 100) => ({
  w: n.width  ?? (n.data.width  as number | undefined) ?? fallbackW,
  h: n.height ?? (n.data.height as number | undefined) ?? fallbackH,
});

// 문서 템플릿(컨테이너·A4 페이지)은 자기 배치 규칙이 있어 섹션 묶기에서 제외
const isDocNode = (n: AppNode) => !!n.data?.isDocPage || !!n.data?.isDocContainer;

// ── 문서 작업 템플릿 상수 ────────────────────────────────────────
const DOC_A4_W     = 794;
const DOC_A4_H     = 1123;
const DOC_PAGE_GAP = 40;
const DOC_PADDING  = 50;

// 라벨 기본색 — 테마(밝은/어두운)에 따라 globals.css 변수로 바뀜
const LABEL_DEFAULT_COLOR  = 'var(--edge-label-ink)';
const LABEL_DEFAULT_BG     = 'var(--edge-label-bg)';
const LABEL_DEFAULT_BORDER = 'var(--edge-label-border)';

// ── 엣지 라벨 박스 (공유) — 더블클릭=텍스트 편집, 클릭=연결선 선택 → 왼쪽 패널에서 꾸미기 ──
// grow: 손잡이를 1px 끌 때 박스가 커지는 정도 — 라벨이 가운데 기준이면 2(양쪽으로 커짐),
//       한쪽 기준이면 1, 아래쪽 기준(위로 자람)이면 -1 → 손잡이를 위 모서리에 둠
function EdgeLabelBox({
  id, label, selected, transform, data, grow = { x: 1, y: 1 },
}: {
  id: string;
  label: unknown;
  selected?: boolean;
  transform: string;
  data?: EdgeData;
  grow?: { x: number; y: number };
}) {
  const { setEdges, setNodes } = useReactFlow<AppNode, AppEdge>();
  const zoom = useStore((s) => s.transform[2]);
  const boxRef = useRef<HTMLSpanElement>(null);
  const setLabelFocusEdgeId = useCanvasStore((s) => s.setLabelFocusEdgeId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');
  const [editSize, setEditSize] = useState<{ w: number; h: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelText   = (label as string | undefined) ?? '';
  const fontSize    = data?.labelFontSize ?? 11;
  // 기본: 상자 없이 — 배경은 라벨 뒤 바탕색(캔버스, 또는 선이 들어 있는 프레임의 색)과 같게 해서
  //   선이 글자 자리에서만 끊겨 보이게, 테두리 없음 (왼쪽 라벨 패널의 기본값과 같아야 함)
  const surfaceBg = useStore((s) => {
    const src = s.edgeLookup.get(id)?.source;
    for (let n = src ? s.nodeLookup.get(src) : undefined, i = 0; n && i < 20; i++) {
      const p = n.parentId ? s.nodeLookup.get(n.parentId) : undefined;
      const bg = (p?.data as { bgColor?: string } | undefined)?.bgColor;
      if (bg && bg !== 'transparent') return bg;
      n = p;
    }
    return LABEL_DEFAULT_BG;
  });
  const labelColor  = data?.labelColor ?? LABEL_DEFAULT_COLOR;
  const labelBg     = data?.labelBgColor ?? surfaceBg;
  const labelBorder = data?.labelBorderColor ?? LABEL_DEFAULT_BORDER;
  const boxW = data?.labelWidth;
  const boxH = data?.labelHeight;
  const patchData = (patch: Partial<EdgeData>) =>
    setEdges((eds) => eds.map((e) => e.id === id ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e));

  // 모서리 손잡이 끌기 → 박스 너비·높이 (캔버스 확대 비율만큼 나눠서 캔버스 단위로 저장)
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX, startY = e.clientY;
    const startW = rect.width / zoom, startH = rect.height / zoom;
    const onMove = (me: PointerEvent) => {
      patchData({
        labelWidth:  Math.max(24, Math.round(startW + ((me.clientX - startX) / zoom) * grow.x)),
        labelHeight: Math.max(14, Math.round(startH + ((me.clientY - startY) / zoom) * grow.y)),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // 더블클릭 편집 — 박스 크기·모양은 그대로, 커서만 글자 끝에 둠 (전체 선택 X)
  const startEdit = () => {
    const rect = boxRef.current?.getBoundingClientRect();
    setEditSize(rect ? { w: rect.width / zoom, h: rect.height / zoom } : null);
    setDraft(labelText);
    setEditing(true);
    setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
  };
  const commitEdit = () => {
    setEdges((eds) => eds.map((e) => e.id === id ? { ...e, label: draft } : e));
    setEditing(false);
  };
  // 라벨은 선 밖(EdgeLabelRenderer)에 그려져서 클릭이 선까지 안 감 → 직접 이 연결선만 선택
  // 라벨로 고른 표시도 남겨서 왼쪽 패널이 라벨 설정을 보여주게 함
  const selectEdge = () => {
    setLabelFocusEdgeId(id);
    setNodes((nds) => nds.map((n) => n.selected ? { ...n, selected: false } : n));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: e.id === id })));
  };

  return (
    <EdgeLabelRenderer>
      <div
        className="nodrag nopan"
        data-edge-label={id}   // AI 요소 등장 연출이 선과 함께 라벨도 늦게 보이게 (utils/appearAnimation)
        onClick={(e) => {
          e.stopPropagation();
          if (!editing) selectEdge();
        }}
        onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
        style={{ position: 'absolute', transform, pointerEvents: 'all', cursor: 'text' }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') setEditing(false);
            }}
            style={{
              // 보던 라벨과 같은 크기·색·가운데 정렬 — 글자가 박스보다 길어지면 그만큼 넓어짐
              boxSizing: 'border-box', height: editSize?.h,
              width: Math.max(editSize?.w ?? 0, (draft.length + 2) * fontSize * 0.62),
              fontSize, fontWeight: 500, color: labelColor, fontFamily: 'inherit',
              background: labelBg, textAlign: 'center',
              border: `1px solid ${labelBorder}`, borderRadius: 4,
              padding: '1px 6px', outline: '1.5px solid #818cf8', outlineOffset: 2,
              whiteSpace: 'nowrap', letterSpacing: '0.02em',
            }}
          />
        ) : (
          <span
            ref={boxRef}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              boxSizing: 'border-box', width: boxW, height: boxH,
              position: 'relative', fontSize, fontWeight: 500,
              color: labelText ? labelColor : 'rgba(var(--ui-fg-rgb),0.4)',
              background: labelText ? labelBg
                : (selected ? LABEL_DEFAULT_BG : 'transparent'),
              border: selected && !labelText ? '1px dashed rgba(var(--ui-fg-rgb),0.25)'
                : (labelText ? `1px solid ${labelBorder}` : 'none'),
              outline: selected && labelText ? '1.5px solid #818cf8' : 'none',
              outlineOffset: 2,
              borderRadius: 4, padding: labelText ? '1px 6px' : (selected ? '1px 6px' : '0'),
              whiteSpace: 'nowrap', userSelect: 'none', letterSpacing: '0.02em',
              minWidth: selected && !labelText ? 50 : undefined,
              textAlign: 'center', transition: 'opacity 0.15s',
            }}
          >
            {labelText || (selected ? tr('더블클릭 편집', 'Double-click to edit') : '')}
            {/* 크기 조절 손잡이 — 끌면 크기 변경, 더블클릭하면 글자에 맞춤으로 되돌림 */}
            {selected && labelText && (
              <span
                onPointerDown={startResize}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => { e.stopPropagation(); patchData({ labelWidth: undefined, labelHeight: undefined }); }}
                title={tr('끌어서 크기 조절 · 더블클릭하면 원래 크기', 'Drag to resize · double-click to reset')}
                style={{
                  // 캔버스 확대 비율과 상관없이 화면에서 늘 10px로 보이게 zoom으로 나눔
                  position: 'absolute', right: -6 / zoom,
                  ...(grow.y < 0 ? { top: -6 / zoom } : { bottom: -6 / zoom }),
                  width: 10 / zoom, height: 10 / zoom, borderRadius: 2 / zoom,
                  background: '#ffffff', border: `${1.5 / zoom}px solid #818cf8`,
                  cursor: grow.y < 0 ? 'nesw-resize' : 'nwse-resize',
                }}
              />
            )}
          </span>
        )}
      </div>
    </EdgeLabelRenderer>
  );
}

// ── 레이블 달린 커스텀 엣지 — 선 아래 흰 텍스트, 배경 없음 ────────
function LabeledEdge({
  id, source, target, sourceHandleId, targetHandleId,
  sourceX: rawSourceX, sourceY: rawSourceY, targetX: rawTargetX, targetY: rawTargetY,
  style, markerEnd, markerStart, label, selected, data,
}: EdgeProps) {
  // 끝점을 도형 테두리에 딱 붙임 — 연결한 변(핸들)에서 나가고 들어감
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = useSnappedEnds({
    source, target, sourceHandleId, targetHandleId,
    rawSourceX, rawSourceY, rawTargetX, rawTargetY,
    style, markerEnd, markerStart, fixSides: true,
  });
  // 가로나 세로로 거의 일직선이면 직선 (꺾임 방지)
  //   단, 같은 쪽 변끼리(위→위, 아래→아래)는 일직선이어도 돌아가야 함 — 직선이면 사이의 도형을 뚫고 지나감
  const sameSide = sourcePosition === targetPosition;
  const isStraight = !sameSide && (Math.abs(targetY - sourceY) < 8 || Math.abs(targetX - sourceX) < 8);

  // 선 종류 '곡선'이면 부드러운 곡선, 아니면 직각으로 꺾는 선
  const isCurve = (data as EdgeData | undefined)?.lineShape === 'curve';
  const [edgePath, labelX, labelY] = isStraight
    ? getStraightPath({ sourceX, sourceY, targetX, targetY })
    : isCurve
      ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
      : getSmoothStepPath({
        sourceX, sourceY, sourcePosition,
        targetX, targetY, targetPosition,
        // 꺾여 나가는 거리 — AI 와이어프레임은 화살표마다 다르게 줘서 위·아래로 돌아가는 선끼리 겹치지 않게
        borderRadius: 0, offset: (data as EdgeData | undefined)?.stepOffset ?? 24,
      });

  // 라벨 박스는 선 한가운데에 얹음 — 가운데 기준이라 손잡이를 끌면 양쪽으로 커짐
  // 단, 짧은 직선은 라벨이 선과 화살표를 통째로 가리므로 선 옆(가로선은 위, 세로선은 오른쪽)으로 비켜 둠
  const edgeData = data as EdgeData | undefined;
  const labelText = (label as string | undefined) ?? '';
  const fontSize = edgeData?.labelFontSize ?? 11;
  const estW = edgeData?.labelWidth ?? labelText.length * fontSize + 14;   // 한글은 글자당 대략 글씨 크기만큼
  const estH = edgeData?.labelHeight ?? fontSize + 8;
  const lenX = Math.abs(targetX - sourceX);
  const lenY = Math.abs(targetY - sourceY);
  const besideH = isStraight && lenY < 8 && labelText && lenX < estW + 40;
  const besideV = isStraight && lenX < 8 && labelText && lenY < estH + 40;
  const labelGrow = besideH ? { x: 2, y: -1 } : besideV ? { x: 1, y: 2 } : { x: 2, y: 2 };
  const labelTransform = besideH
    ? `translate(-50%, calc(-100% - 4px)) translate(${labelX}px,${labelY}px)`
    : besideV
      ? `translate(6px, -50%) translate(${labelX}px,${labelY}px)`
      : `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`;

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} markerStart={markerStart} />
      <EdgeLabelBox
        id={id}
        label={label}
        selected={selected}
        transform={labelTransform}
        grow={labelGrow}
        data={data as EdgeData | undefined}
      />
    </>
  );
}

// ── 두번 꺾이는 엘보 엣지 (수평→수직→수평) ─────────────────────
function ElbowEdge({
  id, sourceX, sourceY, targetX, targetY,
  style, markerEnd, markerStart, label, selected, data,
}: EdgeProps) {
  // 수평→수직→수평: 중간 X에서 꺾임
  const midX = (sourceX + targetX) / 2;
  const path = `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`;

  // 라벨 위치: 수직 구간 옆 중앙
  const labelX = midX + 8;
  const labelY = (sourceY + targetY) / 2;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} markerStart={markerStart} />
      <EdgeLabelBox
        id={id}
        label={label}
        selected={selected}
        transform={`translate(0,-50%) translate(${labelX}px,${labelY}px)`}
        grow={{ x: 1, y: 2 }}
        data={data as EdgeData | undefined}
      />
    </>
  );
}

// ── 시퀀스 다이어그램 셀프루프 엣지 (오른쪽→아래→왼쪽 직각) ────
function SeqSelfLoopEdge({
  id, sourceX, sourceY,
  style, markerEnd, label,
}: EdgeProps) {
  const LOOP_W = 58;
  const LOOP_H = 38;

  // 직각 사각형 경로: →(right) ↓(down) ←(left, back)
  const path = [
    `M ${sourceX} ${sourceY}`,
    `L ${sourceX + LOOP_W} ${sourceY}`,
    `L ${sourceX + LOOP_W} ${sourceY + LOOP_H}`,
    `L ${sourceX} ${sourceY + LOOP_H}`,
  ].join(' ');

  // 라벨은 루프 오른쪽 바깥
  const labelX = sourceX + LOOP_W + 6;
  const labelY = sourceY + LOOP_H / 2;

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      {label && (
        <EdgeLabelRenderer>
          <span
            className="nodrag nopan"
            data-edge-label={id}
            style={{
              position: 'absolute',
              transform: `translate(0,-50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.85)',
              whiteSpace: 'nowrap', pointerEvents: 'none', userSelect: 'none',
              letterSpacing: '0.02em',
            }}
          >
            {label as string}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ── 자유 화살표 엣지 (앵커-앵커 직선) — 선택 시 선/중앙핸들 드래그로 이동 ──────
function FreeArrowEdge({
  id, source, target, sourceX: rawSourceX, sourceY: rawSourceY, targetX: rawTargetX, targetY: rawTargetY,
  sourceHandleId, targetHandleId, style, markerEnd, markerStart, selected, data,
}: EdgeProps) {
  const { setNodes, getNodes, getViewport } = useReactFlow<AppNode>();
  // 그릴 때 고른 연결선 종류 — 없으면(예전에 그린 화살표) 직선
  const lineType = (data as EdgeData | undefined)?.freeLineType;
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = useSnappedEnds({
    source, target, sourceHandleId, targetHandleId,
    rawSourceX, rawSourceY, rawTargetX, rawTargetY,
    style, markerEnd, markerStart,
    // 꺾은선·곡선: 연결한 변(핸들)을 고정 — PPT처럼 그 변에서 수직으로 나가고 들어감 / 직선: 늘 상대를 마주 보는 변
    fixSides: !!lineType && lineType !== 'straight',
  });
  let path: string;
  let midX = (sourceX + targetX) / 2;
  let midY = (sourceY + targetY) / 2;
  if (lineType === 'step') {
    // PPT 꺾은선 — 가로·세로로만 꺾임, 같은 변끼리면 U자로 돌아감
    [path, midX, midY] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 0, offset: 24,
    });
  } else if (lineType === 'default') {
    [path, midX, midY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  } else {
    path = `M ${sourceX},${sourceY} L ${targetX},${targetY}`;
  }

  // 앵커 양 끝점을 평행이동시키는 공통 드래그 헬퍼
  const startWholeDrag = (e: React.MouseEvent | MouseEvent) => {
    const zoom = getViewport().zoom || 1;
    const startX = (e as MouseEvent).clientX;
    const startY = (e as MouseEvent).clientY;
    const all = getNodes();
    const s = all.find((n) => n.id === source);
    const t = all.find((n) => n.id === target);
    const srcPos = s ? { ...s.position } : { x: 0, y: 0 };
    const tgtPos = t ? { ...t.position } : { x: 0, y: 0 };

    const onMove = (ev: globalThis.MouseEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      setNodes((prev) => prev.map((n) => {
        if (n.data.shape !== 'anchor') return n;  // 실제 노드는 그대로
        if (n.id === source) return { ...n, position: { x: srcPos.x + dx, y: srcPos.y + dy } };
        if (n.id === target) return { ...n, position: { x: tgtPos.x + dx, y: tgtPos.y + dy } };
        return n;
      }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 한쪽 앵커만 이동 (끝점 드래그)
  const startEndpointDrag = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const zoom = getViewport().zoom || 1;
    const startX = e.clientX;
    const startY = e.clientY;
    const initPos = getNodes().find((n) => n.id === nodeId)?.position ?? { x: 0, y: 0 };

    const onMove = (ev: globalThis.MouseEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      const dy = (ev.clientY - startY) / zoom;
      setNodes((prev) => prev.map((n) =>
        n.id === nodeId && n.data.shape === 'anchor'
          ? { ...n, position: { x: initPos.x + dx, y: initPos.y + dy } }
          : n
      ));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const onCenterMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    startWholeDrag(e);
  };

  // 선 자체를 잡고 드래그 — 이미 선택된 상태에서만 동작 (첫 클릭=선택)
  const onLineMouseDown = (e: React.MouseEvent) => {
    if (!selected) return;
    e.stopPropagation();
    e.preventDefault();
    startWholeDrag(e);
  };

  return (
    <>
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} markerStart={markerStart} interactionWidth={24} />
      {/* 선택된 자유 화살표: 선 위에 보이지 않는 넓은 드래그 영역 깔기 */}
      {selected && (
        <path
          d={path}
          stroke="transparent"
          strokeWidth={24}
          fill="none"
          className="nodrag nopan"
          onMouseDown={onLineMouseDown}
          style={{ cursor: 'move', pointerEvents: 'stroke' }}
        />
      )}
      {selected && (
        <EdgeLabelRenderer>
          {/* 가운데 핸들: 전체 이동 */}
          <div
            className="nodrag nopan"
            onMouseDown={onCenterMouseDown}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${midX}px,${midY}px)`,
              width: 12, height: 12, borderRadius: '50%',
              background: '#a78bfa', border: '2px solid #fff',
              cursor: 'grab', pointerEvents: 'all',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.4)',
            }}
            title={tr('화살표 전체 이동', 'Move whole arrow')}
          />
          {/* 시작 끝점 핸들 */}
          <div
            className="nodrag nopan nopanflow"
            onMouseDown={(e) => startEndpointDrag(e, source)}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${sourceX}px,${sourceY}px)`,
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff', border: '2px solid #a78bfa',
              cursor: 'move', pointerEvents: 'all',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
              zIndex: 1001,
            }}
          />
          {/* 끝 끝점 핸들 */}
          <div
            className="nodrag nopan nopanflow"
            onMouseDown={(e) => startEndpointDrag(e, target)}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              transform: `translate(-50%,-50%) translate(${targetX}px,${targetY}px)`,
              width: 14, height: 14, borderRadius: '50%',
              background: '#fff', border: '2px solid #a78bfa',
              cursor: 'move', pointerEvents: 'all',
              boxShadow: '0 0 0 1px rgba(0,0,0,0.3)',
              zIndex: 1001,
            }}
          />
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ── 연결선 끝점을 도형 테두리에 붙이기 (자유 화살표·라벨 연결선 공유) ──────
// 끝이 실제 노드에 붙은 경우: 핸들 위치 대신 변의 가운데에 붙임 (PPT 연결선처럼)
// — 노드를 옮겨도 그때그때 다시 계산되고, 끝점이 테두리 위에 딱 놓임
// fixSides: 연결한 변(핸들)을 고정할지 — 아니면 늘 상대를 마주 보는 변
function useSnappedEnds({
  source, target, sourceHandleId, targetHandleId,
  rawSourceX, rawSourceY, rawTargetX, rawTargetY,
  style, markerEnd, markerStart, fixSides,
}: {
  source: string; target: string;
  sourceHandleId?: string | null; targetHandleId?: string | null;
  rawSourceX: number; rawSourceY: number; rawTargetX: number; rawTargetY: number;
  style?: React.CSSProperties; markerEnd?: string; markerStart?: string;
  fixSides: boolean;
}) {
  const sNode = useInternalNode<AppNode>(source);
  const tNode = useInternalNode<AppNode>(target);
  const boxOf = (n: typeof sNode) => {
    if (!n || n.data.shape === 'anchor') return null;
    const { x, y } = n.internals.positionAbsolute;
    // 도형은 data 크기로 그려짐 — React Flow 상자(measured)가 더 클 때가 있어 data 크기를 먼저 씀
    const w = (n.data.width  as number | undefined) ?? n.measured.width  ?? n.width  ?? 0;
    const h = (n.data.height as number | undefined) ?? n.measured.height ?? n.height ?? 0;
    return w && h ? { x, y, w, h } : null;
  };
  // 표 행 핸들처럼 변이 아닌 핸들에 붙은 끝은 그 핸들 위치 그대로 둠
  const isSideHandle = (h?: string | null) => !h || ['top', 'right', 'bottom', 'left'].includes(h);
  const sBox = isSideHandle(sourceHandleId) ? boxOf(sNode) : null;
  const tBox = isSideHandle(targetHandleId) ? boxOf(tNode) : null;
  const centerOf = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  const facingSide = (b: { x: number; y: number; w: number; h: number }, toward: { x: number; y: number }) => {
    const c  = centerOf(b);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (Math.abs(dx) / b.w >= Math.abs(dy) / b.h) {
      return dx >= 0
        ? { x: b.x + b.w, y: c.y, pos: Position.Right }
        : { x: b.x,       y: c.y, pos: Position.Left };
    }
    return dy >= 0
      ? { x: c.x, y: b.y + b.h, pos: Position.Bottom }
      : { x: c.x, y: b.y,       pos: Position.Top };
  };
  const sRef = sBox ? centerOf(sBox) : { x: rawSourceX, y: rawSourceY };
  const tRef = tBox ? centerOf(tBox) : { x: rawTargetX, y: rawTargetY };
  const sideOf =(b: { x: number; y: number; w: number; h: number }, side: string) => {
    const c = centerOf(b);
    if (side === 'top')    return { x: c.x,       y: b.y,       pos: Position.Top };
    if (side === 'bottom') return { x: c.x,       y: b.y + b.h, pos: Position.Bottom };
    if (side === 'left')   return { x: b.x,       y: c.y,       pos: Position.Left };
    return                        { x: b.x + b.w, y: c.y,       pos: Position.Right };
  };
  const fixedSide = (handleId?: string | null) =>
    fixSides && handleId && ['top', 'right', 'bottom', 'left'].includes(handleId) ? handleId : null;
  const endOf = (b: typeof sBox, handleId: string | null | undefined, other: { x: number; y: number }) => {
    if (!b) return null;
    const side = fixedSide(handleId);
    return side ? sideOf(b, side) : facingSide(b, other);
  };
  // 빈 곳에 놓인 끝: 상대 쪽을 향하는 방향으로 나가고 들어감
  const dirToward = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? Position.Right : Position.Left;
    return dy >= 0 ? Position.Bottom : Position.Top;
  };
  // 도형 테두리는 상자 바깥에 strokeWidth만큼 그려짐(box-shadow) → 그만큼 밖으로 밀고,
  // 화살촉은 둥근 모서리가 끝점보다 살짝 튀어나오므로 그만큼 더 밀어 테두리 바깥에 딱 닿게 함
  const outset = (p: { x: number; y: number; pos: Position }, d: number) => {
    if (p.pos === Position.Left)  return { ...p, x: p.x - d };
    if (p.pos === Position.Right) return { ...p, x: p.x + d };
    if (p.pos === Position.Top)   return { ...p, y: p.y - d };
    return { ...p, y: p.y + d };
  };
  const borderOf = (n: typeof sNode) => (n?.data.strokeWidth as number | undefined) ?? 1;
  const edgeW = Number(style?.strokeWidth ?? 1.5);
  const tipOf = (marker?: string) => (marker ? 0.5 * (12.5 / 20) * edgeW : 0);   // ArrowClosed: 12.5 크기, viewBox 20, 선 굵기 1의 반
  const sSide = endOf(sBox, sourceHandleId, tRef);
  const tSide = endOf(tBox, targetHandleId, sRef);
  const sEnd = sSide ? outset(sSide, borderOf(sNode) + tipOf(markerStart))
    : { x: rawSourceX, y: rawSourceY, pos: dirToward({ x: rawSourceX, y: rawSourceY }, tRef) };
  const tEnd = tSide ? outset(tSide, borderOf(tNode) + tipOf(markerEnd))
    : { x: rawTargetX, y: rawTargetY, pos: dirToward({ x: rawTargetX, y: rawTargetY }, sRef) };
  return {
    sourceX: sEnd.x, sourceY: sEnd.y, sourcePosition: sEnd.pos,
    targetX: tEnd.x, targetY: tEnd.y, targetPosition: tEnd.pos,
  };
}

const EDGE_TYPES = { labeled: LabeledEdge, elbow: ElbowEdge, 'seq-self-loop': SeqSelfLoopEdge, 'free-arrow': FreeArrowEdge, erd: ErdEdge } as const;

// ── 정렬 가이드라인 타입 ─────────────────────────────────────
interface HelperLineH { y: number; x1: number; x2: number; }
interface HelperLineV { x: number; y1: number; y2: number; }
interface HelperLines { h?: HelperLineH; v?: HelperLineV; }

// ── 정렬 가이드라인 렌더러 (ReactFlow 내부에서 useViewport 호출) ──
const HelperLinesRenderer = ({ h, v }: HelperLines) => {
  const { x: vpX, y: vpY, zoom } = useViewport();
  if (!h && !v) return null;
  return (
    <svg
      style={{
        position: 'absolute',
        top: 0, left: 0,
        width: '100%', height: '100%',
        pointerEvents: 'none',
        zIndex: 6,
      }}
    >
      {/* 수평 가이드라인 — 두 노드 사이 범위만 */}
      {h && (
        <line
          x1={h.x1 * zoom + vpX}
          y1={h.y  * zoom + vpY}
          x2={h.x2 * zoom + vpX}
          y2={h.y  * zoom + vpY}
          stroke="#3b82f6"
          strokeWidth={1.5}
        />
      )}
      {/* 수직 가이드라인 — 두 노드 사이 범위만 */}
      {v && (
        <line
          x1={v.x  * zoom + vpX}
          y1={v.y1 * zoom + vpY}
          x2={v.x  * zoom + vpX}
          y2={v.y2 * zoom + vpY}
          stroke="#3b82f6"
          strokeWidth={1.5}
        />
      )}
    </svg>
  );
};

// ── 뷰포트 동기화 (ReactFlow 내부에서 useViewport 호출) ──────
// ReactFlow context 안에서만 useViewport를 쓸 수 있으므로
// 부모로부터 ref를 받아 동기화하는 헬퍼 컴포넌트
const ViewportSync = ({ viewportRef }: { viewportRef: React.MutableRefObject<{ x: number; y: number; zoom: number }> }) => {
  const vp = useViewport();
  viewportRef.current = vp; // 렌더 중 동기 갱신 — useEffect보다 한 프레임 빠름
  return null;
};

// ── 뷰 컨트롤 패널 (ReactFlow 내부에서 useReactFlow 호출) ─────
interface ViewControlsProps {
  position: PanelPosition;
  canUndo:  boolean;
  canRedo:  boolean;
  onUndo:   () => void;
  onRedo:   () => void;
}

// zoom 표시만 별도 컴포넌트로 — useViewport 구독을 격리해서 zoom 중 ViewControls 전체 re-render 방지
const ZoomDisplay = React.memo(function ZoomDisplay() {
  const { zoom } = useViewport();
  return (
    <div
      className="flex items-center justify-center text-text-tertiary select-none cursor-default"
      style={{ fontSize: 12, fontWeight: 600, height: 28, letterSpacing: '0.02em' }}
      title={tr('현재 배율', 'Current zoom')}
    >
      {Math.round(zoom * 100)}%
    </div>
  );
});

// 화면 안에 도형이 하나도 없는지 — 길을 잃었을 때 tr('전체 보기', 'Fit view') 버튼을 은은하게 깜빡여 알려 줌
// (boolean만 돌려주므로 화면을 움직여도 값이 바뀔 때만 다시 그림)
const selectContentOffscreen = (s: ReactFlowState): boolean => {
  if (s.nodeLookup.size === 0 || s.width === 0) return false;
  const [tx, ty, z] = s.transform;
  const x0 = -tx / z, y0 = -ty / z, x1 = x0 + s.width / z, y1 = y0 + s.height / z;
  for (const n of s.nodeLookup.values()) {
    const { x, y } = n.internals.positionAbsolute;
    const w = n.measured?.width ?? n.width ?? 0;
    const h = n.measured?.height ?? n.height ?? 0;
    if (x < x1 && x + w > x0 && y < y1 && y + h > y0) return false;
  }
  return true;
};

const ViewControls = React.memo(function ViewControls({ position, canUndo, canRedo, onUndo, onRedo }: ViewControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow<AppNode>();
  const contentOffscreen = useStore(selectContentOffscreen);

  const vcBtn = (
    onClick: () => void,
    title: string,
    icon: React.ReactNode,
    disabled = false,
    active = false,
    extraCls = '',
  ) => (
    <button
      className={`w-9 h-9 flex items-center justify-center bg-transparent border-none cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed
        ${active ? 'text-indigo-400' : 'text-text-secondary hover:bg-hover-bg hover:text-text-primary'} ${extraCls}`}
      onClick={onClick}
      title={title}
      disabled={disabled}
    >
      {icon}
    </button>
  );

  return (
    <Panel position={position}>
      {/* 오른쪽이면 [실행취소][줌], 왼쪽(미니맵 켜짐)이면 좌우를 뒤집어 [줌][실행취소] — 줌 묶음이 항상 화면 가장자리에 붙도록 */}
      <div className={`flex ${position.endsWith('left') ? 'flex-row-reverse' : 'flex-row'} items-end gap-2 mb-4 ml-4 max-sm:mb-[84px] max-sm:mr-[2px]`}>

        {/* 실행 취소 / 다시 실행 — 가로 배치 */}
        <div className="flex flex-row bg-bg-primary border border-border-light rounded-[10px] overflow-hidden shadow-md">
          {vcBtn(onUndo, tr('실행 취소 (Ctrl+Z)', 'Undo (Ctrl+Z)'),
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>
            </svg>, !canUndo)}
          <div className="w-px bg-border-light" />
          {vcBtn(onRedo, tr('다시 실행 (Ctrl+Y)', 'Redo (Ctrl+Y)'),
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>
            </svg>, !canRedo)}
        </div>

        {/* 줌 컨트롤 — 세로 배치 */}
        <div className="flex flex-col bg-bg-primary border border-border-light rounded-[10px] overflow-hidden shadow-md">
          {vcBtn(() => zoomIn({ duration: 200 }), tr('줌 인', 'Zoom in'),
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
            </svg>)}
          <div className="h-px bg-border-light" />
          {/* 현재 배율 — useViewport 구독 격리됨 */}
          <ZoomDisplay />
          <div className="h-px bg-border-light" />
          {vcBtn(() => zoomOut({ duration: 200 }), tr('줌 아웃', 'Zoom out'),
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>)}
          <div className="h-px bg-border-light" />
          {vcBtn(() => fitView({ padding: 0.5, duration: 300 }), contentOffscreen ? tr('전체 보기 — 내용으로 돌아가기', 'Fit view — back to content') : tr('전체 보기', 'Fit view'),
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/>
              <path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>
            </svg>, false, false, contentOffscreen ? styles.fitHint : '')}
        </div>

      </div>
    </Panel>
  );
});

// ── + 버튼 SVG 아이콘 ──────────────────────────────────────────
const PlusSVG = ({ size = 10 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <line x1="5" y1="1.5" x2="5" y2="8.5"/>
    <line x1="1.5" y1="5" x2="8.5" y2="5"/>
  </svg>
);


// ── DocOverlay 순수 헬퍼 (컴포넌트 밖 — 렌더마다 재생성 방지) ──
function _getColsFromPages(containerPages: AppNode[]): number[] {
  if (!containerPages.length) return [0];
  const maxRow = Math.max(...containerPages.map((p) => (p.data.docRow as number | undefined) ?? 0));
  const cols: number[] = Array(maxRow + 1).fill(0);
  containerPages.forEach((p) => {
    const row = (p.data.docRow as number | undefined) ?? 0;
    const col = (p.data.docCol as number | undefined) ?? 0;
    cols[row] = Math.max(cols[row], col + 1);
  });
  return cols;
}
const _DOC_PLUS_SIZE = 22;
const _DOC_ICON_SIZE = 10;
const _DOC_BTN_GAP   = 10;

// ── 문서 오버레이 — 문서 컨테이너마다 + 버튼 렌더 ─────────────
// 버튼을 flow 좌표에 배치하고 CSS transform으로 뷰포트 적용
// → 줌/팬 시 React diff 대상이 transform 문자열 1개뿐, 버튼 위치 재계산 없음
const DocOverlay = () => {
  const { setNodes } = useReactFlow<AppNode>();
  const { zoom, x: vpX, y: vpY } = useViewport();
  const [hovered, setHovered] = useState<string | null>(null);

  // zoom/pan 중 viewport만 변경될 때 containers/pages 배열을 안정적으로 유지
  const containers = useStore(
    (s) => (s.nodes as AppNode[]).filter((n) => n.data?.isDocContainer),
    (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
  );
  const pages = useStore(
    (s) => (s.nodes as AppNode[]).filter((n) => n.data?.isDocPage),
    (a, b) => a.length === b.length && a.every((n, i) => n === b[i]),
  );

  // ── 페이지 삭제/추가 시 컨테이너 크기 자동 동기화 ───────────────
  // pages가 실제로 바뀔 때만 재계산 (zoom 중 매 프레임 실행 방지)
  const pageLayoutKey = useMemo(() =>
    pages.map((p) => `${p.parentId}:${p.data.docRow ?? 0}:${p.data.docCol ?? 0}`).sort().join('|'),
    [pages],
  );

  useEffect(() => {
    if (!containers.length) return;
    setNodes((prev) => {
      let dirty = false;
      const next = (prev as AppNode[]).map((n) => {
        if (!n.data?.isDocContainer) return n;
        const containerPages = (prev as AppNode[]).filter((p) => p.parentId === n.id && p.data?.isDocPage);
        if (!containerPages.length) return n;

        const actualCols = _getColsFromPages(containerPages);
        const maxC   = Math.max(...actualCols, 1);
        // 실제 페이지 크기 사용 (portrait/landscape 모두 지원)
        const refPage = containerPages[0];
        const pgW = (refPage?.width ?? (refPage?.data?.width as number | undefined)) ?? DOC_A4_W;
        const pgH = (refPage?.height ?? (refPage?.data?.height as number | undefined)) ?? DOC_A4_H;
        const targetW = DOC_PADDING * 2 + maxC * pgW + (maxC - 1) * DOC_PAGE_GAP;
        const targetH = DOC_PADDING * 2 + actualCols.length * pgH + (actualCols.length - 1) * DOC_PAGE_GAP;

        const curW = (n.data.width  as number | undefined) ?? n.width  ?? 894;
        const curH = (n.data.height as number | undefined) ?? n.height ?? 1223;

        if (Math.abs(curW - targetW) > 1 || Math.abs(curH - targetH) > 1) {
          dirty = true;
          return {
            ...n,
            width:  targetW, height: targetH,
            zIndex: -Math.ceil(targetW * targetH / 100),
            data:   { ...n.data, width: targetW, height: targetH, docColsPerRow: actualCols },
          };
        }
        return n;
      });
      return dirty ? next : prev;
    });
  // pageLayoutKey가 바뀔 때만 실행 (페이지 추가/삭제/이동)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageLayoutKey]);

  // 버튼 레이아웃: zoom 중에는 재계산 생략 (containers/pages/hovered 변경 시만 재실행)
  const buttonElems = useMemo(() => {
    if (!containers.length) return null;

    const makeDocPage = (
      id: string, parentId: string, px: number, py: number, row: number, col: number,
      w = DOC_A4_W, h = DOC_A4_H,
    ): AppNode => ({
      id, type: 'custom', position: { x: px, y: py },
      width: w, height: h, zIndex: 0, parentId,
      data: {
        title: '', subtitle: '', icon: '',
        type: 'service', status: 'none', shape: 'frame',
        width: w, height: h,
        bgColor: '#ffffff', strokeColor: '#e5e7eb', strokeWidth: 1, borderRadius: 0,
        isDocPage: true, docRow: row, docCol: col,
        docMarginTop: 20, docMarginBottom: 20, docMarginLeft: 25, docMarginRight: 25,
      },
    });

    const btnStyleFn = (key: string): React.CSSProperties => ({
      position:     'absolute',
      width: _DOC_PLUS_SIZE, height: _DOC_PLUS_SIZE,
      borderRadius: 5,
      // 종이와 어울리게 밝게 — 평소엔 흰 바탕·연회색, 마우스를 올리면 보라색
      border:       `1.5px solid ${hovered === key ? '#6366f1' : '#e2e8f0'}`,
      background:   hovered === key ? '#eef2ff' : '#ffffff',
      color:        hovered === key ? '#6366f1' : '#94a3b8',
      boxShadow:    '0 1px 2px rgba(15,23,42,0.06)',
      cursor:       'pointer',
      display:      'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents:'auto',
      transition:   'border-color 0.14s, color 0.14s, background 0.14s',
      padding:      0,
    });

    return containers.map((c) => {
      const cId  = c.id;
      const cX   = c.position.x;
      const cY   = c.position.y;
      const cW   = (c.data.width  as number | undefined) ?? c.width  ?? 894;
      const cH   = (c.data.height as number | undefined) ?? c.height ?? 1223;

      const containerPages = pages.filter((p) => p.parentId === cId);
      const colsPerRow: number[] = containerPages.length
        ? _getColsFromPages(containerPages)
        : ((c.data.docColsPerRow as number[] | undefined) ?? [1]);
      const numRows = colsPerRow.length;

      const firstPage = containerPages[0];
      const pageW = (firstPage?.width ?? (firstPage?.data?.width as number | undefined)) ?? DOC_A4_W;
      const pageH = (firstPage?.height ?? (firstPage?.data?.height as number | undefined)) ?? DOC_A4_H;

      const addColumnToRow = (rowIdx: number) => {
        const ts        = Date.now();
        const newCols   = [...colsPerRow];
        const newColIdx = newCols[rowIdx];
        newCols[rowIdx] = newColIdx + 1;
        const maxC      = Math.max(...newCols);
        const newW      = DOC_PADDING * 2 + maxC * pageW + (maxC - 1) * DOC_PAGE_GAP;
        const px        = DOC_PADDING + newColIdx * (pageW + DOC_PAGE_GAP);
        const py        = DOC_PADDING + rowIdx    * (pageH + DOC_PAGE_GAP);
        const newPage   = makeDocPage(`doc-page-${ts}`, cId, px, py, rowIdx, newColIdx, pageW, pageH);
        setNodes((prev) => {
          const updated = (prev as AppNode[]).map((n) => n.id === cId
            ? { ...n, width: newW, zIndex: -Math.ceil(newW * cH / 100), data: { ...n.data, width: newW, docColsPerRow: newCols } }
            : n,
          );
          return placeFramesFirst([...updated, newPage]);
        });
      };

      const addPageToColumn = (col: number) => {
        const ts = Date.now();
        let lastRow = -1;
        for (let r = 0; r < numRows; r++) {
          if (colsPerRow[r] > col) lastRow = r;
        }
        const newRow  = lastRow + 1;
        const newCols = [...colsPerRow];
        while (newCols.length <= newRow) newCols.push(0);
        if (newCols[newRow] <= col) newCols[newRow] = col + 1;
        const maxC   = Math.max(...newCols);
        const newW   = DOC_PADDING * 2 + maxC * pageW + (maxC - 1) * DOC_PAGE_GAP;
        const newH   = DOC_PADDING * 2 + newCols.length * pageH + (newCols.length - 1) * DOC_PAGE_GAP;
        const px     = DOC_PADDING + col     * (pageW + DOC_PAGE_GAP);
        const py     = DOC_PADDING + newRow  * (pageH + DOC_PAGE_GAP);
        const newPage = makeDocPage(`doc-page-${ts}`, cId, px, py, newRow, col, pageW, pageH);
        setNodes((prev) => {
          const updated = (prev as AppNode[]).map((n) => n.id === cId
            ? { ...n, width: newW, height: newH, zIndex: -Math.ceil(newW * newH / 100),
                data: { ...n.data, width: newW, height: newH, docColsPerRow: newCols } }
            : n,
          );
          return placeFramesFirst([...updated, newPage]);
        });
      };

      const rightBtns = Array.from({ length: numRows }, (_, row) => {
        const rowEndX = DOC_PADDING + colsPerRow[row] * pageW + (colsPerRow[row] - 1) * DOC_PAGE_GAP;
        const rowMidY = DOC_PADDING + row * (pageH + DOC_PAGE_GAP) + pageH / 2;
        const sx  = cX + rowEndX + _DOC_BTN_GAP;
        const sy  = cY + rowMidY - _DOC_PLUS_SIZE / 2;
        const key = `${cId}-row${row}`;
        return (
          <button key={key} style={{ ...btnStyleFn(key), left: sx, top: sy }}
            onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}
            onClick={() => addColumnToRow(row)} title={tr(`${row + 1}행에 페이지 추가`, `Add a page to row ${row + 1}`)}
          >
            <PlusSVG size={_DOC_ICON_SIZE} />
          </button>
        );
      });

      const maxCols    = Math.max(...colsPerRow, 1);
      const bottomBtns = Array.from({ length: maxCols }, (_, col) => {
        let lastRow = 0;
        for (let r = 0; r < numRows; r++) {
          if (colsPerRow[r] > col) lastRow = r;
        }
        const colMidX         = DOC_PADDING + col * (pageW + DOC_PAGE_GAP) + pageW / 2;
        const lastPageBottomY = DOC_PADDING + lastRow * (pageH + DOC_PAGE_GAP) + pageH;
        const sx  = cX + colMidX - _DOC_PLUS_SIZE / 2;
        const sy  = cY + lastPageBottomY + _DOC_BTN_GAP;
        const key = `${cId}-col${col}-bot`;
        return (
          <button key={key} style={{ ...btnStyleFn(key), left: sx, top: sy }}
            onMouseEnter={() => setHovered(key)} onMouseLeave={() => setHovered(null)}
            onClick={() => addPageToColumn(col)} title={tr(`${col + 1}열 아래에 페이지 추가`, `Add a page below column ${col + 1}`)}
          >
            <PlusSVG size={_DOC_ICON_SIZE} />
          </button>
        );
      });

      return (
        <React.Fragment key={cId}>
          {rightBtns}
          {bottomBtns}
        </React.Fragment>
      );
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containers, pages, hovered, setNodes]);

  if (!containers.length) return null;

  return (
    <>
      {/* flow 좌표 기준 컨테이너 — 뷰포트 transform만 변경, 버튼 레이아웃은 useMemo로 고정 */}
      <div style={{ position: 'absolute', top: 0, left: 0, transformOrigin: '0 0', transform: `translate(${vpX}px,${vpY}px) scale(${zoom})`, pointerEvents: 'none', zIndex: 10 }}>
        {buttonElems}
      </div>
    </>
  );
};

// ── 인쇄 처리 (ReactFlowProvider 내부에서 getNodes 접근) ────
function executePrint(paperFrames: AppNode[], allNodes: AppNode[]) {
  // viewport 전체 클론 — 모든 노드·엣지가 여기에 있음
  const viewportEl = document.querySelector('.react-flow__viewport') as HTMLElement | null;
  if (!viewportEl) {
    alert(tr('캔버스를 찾을 수 없습니다. 잠시 후 다시 시도해 주세요.', 'Canvas not found. Please try again in a moment.'));
    return;
  }

  const pagesHTML = paperFrames.map((frame, i) => {
    const w  = ((frame.data.width  ?? frame.width)  as number | undefined) ?? 794;
    const h  = ((frame.data.height ?? frame.height) as number | undefined) ?? 1123;
    const fx = frame.position.x;
    const fy = frame.position.y;

    // viewport 전체 클론 (모든 노드 + 엣지 포함)
    const clone = viewportEl.cloneNode(true) as HTMLElement;

    // 기존 pan/zoom transform 덮어쓰기 → 프레임 좌상단을 (0,0)으로 정렬
    clone.style.transform       = `translate(${-fx}px, ${-fy}px)`;
    clone.style.transformOrigin = '0 0';
    clone.style.position        = 'absolute';
    clone.style.top             = '0';
    clone.style.left            = '0';
    clone.style.width           = '';
    clone.style.height          = '';

    // 인터랙티브 요소 제거
    clone.querySelectorAll('.react-flow__resize-control, .react-flow__handle').forEach(el => el.remove());
    clone.querySelectorAll('[class*="NodeProperties"], [class*="nodeProperties"]').forEach(el => el.remove());
    clone.querySelectorAll('[class*="frameLabel"]').forEach(el => el.remove());
    // 선택 링 div 제거 (class 없음 — position:absolute + pointerEvents:none + zIndex:999 으로 식별)
    clone.querySelectorAll('div[style]').forEach(el => {
      const s = (el as HTMLElement).style;
      if (s.pointerEvents === 'none' && s.zIndex === '999' && s.position === 'absolute') {
        el.remove();
      }
    });
    // 선택 클래스 제거
    clone.querySelectorAll('[class*="selected"]').forEach(el => {
      [...el.classList].forEach(c => { if (c.includes('selected')) el.classList.remove(c); });
    });

    // 엣지 SVG: overflow:visible 보장
    const edgesSvg = clone.querySelector('.react-flow__edges') as SVGElement | null;
    if (edgesSvg) edgesSvg.style.overflow = 'visible';

    const pageNum = i + 1;   // 슬라이드 순서대로 1, 2, 3…
    return `<div class="print-page" style="width:${w}px;height:${h}px;position:relative;overflow:hidden;box-sizing:border-box;page-break-after:always;">
  ${clone.outerHTML}
  ${pageNum ? `<div style="position:absolute;bottom:16px;right:20px;font-size:10px;color:rgba(0,0,0,0.25);font-family:sans-serif;font-weight:600;">${pageNum}</div>` : ''}
</div>`;
  }).join('\n');

  // 현재 페이지의 CSS 수집
  const cssTexts: string[] = [];
  Array.from(document.styleSheets).forEach(sheet => {
    try {
      Array.from(sheet.cssRules).forEach(rule => cssTexts.push(rule.cssText));
    } catch { /* cross-origin 무시 */ }
  });

  const printWin = window.open('', '_blank', 'width=900,height=700');
  if (!printWin) {
    alert(tr('팝업이 차단됐습니다. 팝업 허용 후 다시 시도해 주세요.', 'The popup was blocked. Allow popups and try again.'));
    return;
  }

  printWin.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${tr('인쇄', 'Print')}</title>
<style>
${cssTexts.join('\n')}
@page { margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
* { transition: none !important; animation: none !important; }
.print-page { display: block !important; visibility: visible !important; background: #fff; }
.print-page:last-child { page-break-after: auto; }
button, input, [class*="Toolbar"], [class*="toolbar"] { display: none !important; }
.react-flow__background { display: none !important; }
.react-flow__minimap   { display: none !important; }
.react-flow__panel     { display: none !important; }
.react-flow__marker    { display: block !important; }
.react-flow__viewport  { background: transparent !important; overflow: visible !important; }
.react-flow__node      { will-change: auto !important; }
</style>
</head><body>
${pagesHTML}
</body></html>`);

  printWin.document.close();
  printWin.focus();
  setTimeout(() => { printWin.print(); }, 600);
}

const PrintHandler = () => {
  const { getNodes } = useReactFlow<AppNode>();
  const printRequested    = useCanvasStore(s => s.printRequested);
  const clearPrintRequest = useCanvasStore(s => s.clearPrintRequest);

  useEffect(() => {
    if (!printRequested) return;
    clearPrintRequest();

    const allNodes = getNodes();
    // 인쇄는 종이 규격이 있는 슬라이드만 (자유 크기·16:9 화면 프레임은 제외)
    const paperFrames = slideOrder(allNodes).filter(n => n.data.isPaperFrame && n.data.paperSize !== '16:9');

    // 인쇄는 화면 밖 요소까지 HTML로 있어야 해서 찍는 동안만 전부 그림
    withAllNodesRendered(() => {
      if (paperFrames.length === 0) {
        window.print();
      } else {
        executePrint(paperFrames, allNodes);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printRequested]);

  return null;
};

// ── 하단 중앙 툴바 ────────────────────────────────────────
const CanvasToolbar = () => {
  const { deleteElements, getNodes, setNodes, getViewport } = useReactFlow<AppNode>();
  const currentTool    = useCanvasStore((s) => s.currentTool);
  const setCurrentTool = useCanvasStore((s) => s.setCurrentTool);
  const drawTool       = useCanvasStore((s) => s.drawTool);
  const setDrawTool    = useCanvasStore((s) => s.setDrawTool);
  const isLocked          = useCanvasStore((s) => s.isLocked);
  const toggleLocked      = useCanvasStore((s) => s.toggleLocked);
  const connectLabeled    = useCanvasStore((s) => s.connectLabeled);
  const setConnectLabeled = useCanvasStore((s) => s.setConnectLabeled);
  const edgeLineType      = useCanvasStore((s) => s.edgeLineType);
  const setEdgeLineType   = useCanvasStore((s) => s.setEdgeLineType);

  const [showMore, setShowMore] = useState(false);
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [pickerHover, setPickerHover] = useState<{ r: number; c: number } | null>(null);
  const [activeCategory, setActiveCategory] = useState<null | 'paper'>(null);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const moreRef = useRef<HTMLDivElement>(null);
  const connectRef = useRef<HTMLDivElement>(null);
  const connectMenuRef = useRef<HTMLDivElement>(null);   // body로 띄운 연결선 메뉴
  const tablePickerRef = useRef<HTMLDivElement>(null);
  // 표 그리드 픽커 팝업(portal 로 body에 렌더됨) — click-outside 판정에 함께 사용
  const tablePickerPopupRef = useRef<HTMLDivElement>(null);

  // 더 보기 팝업 — 바깥을 누르면 닫기
  //   전체 화면 투명 막(body portal)을 쓰면 팝업(캔버스 안 쌓임 순서)보다 위에 깔려 팝업 버튼까지 막혀서,
  //   막 대신 capture 단계에서 바깥 클릭을 감지 (캔버스는 빈 곳 클릭 전파를 막으므로 capture여야 받음)
  useEffect(() => {
    if (!showMore) return;
    const onDown = (e: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setShowMore(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [showMore]);

  // showMore가 닫힐 때 activeCategory 초기화
  useEffect(() => {
    if (!showMore) setActiveCategory(null);
  }, [showMore]);

  // connectMenu 외부 클릭 시 닫기 (capture phase로 ReactFlow Pane보다 먼저 잡음)
  useEffect(() => {
    if (!showConnectMenu) return;
    const handler = (e: Event) => {
      const t = e.target as Node;
      if (connectRef.current && !connectRef.current.contains(t) && !connectMenuRef.current?.contains(t)) {
        setShowConnectMenu(false);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [showConnectMenu]);

  // tablePicker 외부 클릭 시 닫기
  // 팝업은 portal로 body에 렌더되어 tablePickerRef(버튼 래퍼) 밖에 있으므로
  // 팝업 ref도 함께 검사해야 함 — 안 그러면 그리드 셀 클릭 시 capture-phase에서
  // 픽커가 먼저 닫혀버려 셀의 onClick이 발화하지 못함 → 표 생성 실패
  useEffect(() => {
    if (!showTablePicker) return;
    const handler = (e: Event) => {
      const target = e.target as Node;
      const inButton = tablePickerRef.current?.contains(target);
      const inPopup  = tablePickerPopupRef.current?.contains(target);
      if (!inButton && !inPopup) {
        setShowTablePicker(false);
        setPickerHover(null);
      }
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [showTablePicker]);

  // 화면 중앙에 종이 규격 프레임 생성
  const addPaperFrame = (paper: PaperSize) => {
    const vp = getViewport();
    const cx = (window.innerWidth  / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    const { w, h } = paperDims(paper, orientation);
    const newNode: AppNode = {
      id:       `node-${Date.now()}`,
      type:     'custom',
      position: { x: cx - w / 2, y: cy - h / 2 },
      width:    w,
      height:   h,
      zIndex:   -Math.ceil(w * h / 100),
      data: {
        title: paper.name, subtitle: '', icon: '',
        type: 'service', status: 'none', shape: 'frame',
        width: w, height: h, isPaperFrame: true, paperSize: paper.name,
        // 문서 페이지 모드 — 쪽 여백 + 텍스트 편집
        isDocPage:      true,
        docPageType:    'plain',
        docPageText:    '',
        docPageBg:      '#ffffff',
        docMarginTop:    25,
        docMarginBottom: 25,
        docMarginLeft:   30,
        docMarginRight:  30,
      },
    };
    setNodes((prev) => [newNode, ...(prev as AppNode[])]);
    setShowMore(false);
  };

  const deleteSelected = () => {
    const selected = getNodes().filter((n) => n.selected);
    if (selected.length) deleteElements({ nodes: selected });
  };

  // 그리드 픽커로 표 직접 삽입 (드래그 없이 뷰포트 중앙에 생성)
  const insertTableNode = (rows: number, cols: number) => {
    const vp = getViewport();
    const cx = (window.innerWidth  / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    const cellW = 100, cellH = 32;
    const w = cellW * cols;
    const h = cellH * rows;
    const newNode: AppNode = {
      id:       `node-${Date.now()}`,
      type:     'custom',
      position: { x: cx - w / 2, y: cy - h / 2 },
      width: w, height: h, zIndex: 0,
      data: {
        title: '', subtitle: '', icon: '',
        type: 'service', status: 'none', shape: 'table',
        width: w, height: h,
        bgColor: 'transparent', strokeColor: 'var(--canvas-ink)', fontColor: 'var(--canvas-ink)',
        tableRows: rows, tableCols: cols, tableHeaderRow: false,
        tableCells: Array.from({ length: rows }, () => Array(cols).fill('')),
      },
    };
    setNodes((prev) => [...prev, newNode]);
    setShowTablePicker(false);
    setPickerHover(null);
    setDrawTool(null);
  };

  const btn = (active: boolean, onClick: () => void, title: string, icon: React.ReactNode) => (
    <button
      className={`w-[38px] h-[38px] flex items-center justify-center border-none rounded-[8px] cursor-pointer transition-colors outline-none ${active ? 'bg-[rgba(var(--ui-fg-rgb),0.15)] text-[rgb(var(--ui-fg-rgb))]' : 'bg-transparent text-[rgba(var(--ui-fg-rgb),0.75)] hover:bg-[rgba(var(--ui-fg-rgb),0.1)] hover:text-[rgb(var(--ui-fg-rgb))]'}`}
      onClick={onClick}
      title={title}
    >
      {icon}
    </button>
  );

  const activateDraw = (shape: NodeShape | 'arrow') => {
    setDrawTool(drawTool === shape ? null : shape);
    if (currentTool === 'connect') setCurrentTool('select');
  };

  return (
    <Panel position="bottom-center">
      <div className="relative flex items-end mb-5" ref={moreRef}>

        {/* ── 더보기 팝업 (2단계 슬라이드) — z-index는 backdrop(9998)보다 높게 ── */}
        <div style={{
          position: 'absolute', bottom: '100%', right: 0, marginBottom: 8,
          transition: 'opacity 0.18s ease, transform 0.18s ease',
          opacity: showMore ? 1 : 0,
          transform: showMore ? 'translateY(0)' : 'translateY(8px)',
          pointerEvents: showMore ? 'auto' : 'none',
          zIndex: 9999,
        }}>
          <div style={{
            background: 'var(--ui-surface)',
            border: '1px solid rgba(var(--ui-fg-rgb),0.1)',
            borderRadius: 16,
            overflow: 'hidden',
            width: 288,
            boxShadow: 'var(--ui-shadow)',
            position: 'relative',
          }}>
            {/* 닫기 X 버튼 */}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowMore(false);
              }}
              title={tr('닫기', 'Close')}
              style={{
                position: 'absolute', top: 8, right: 8,
                width: 24, height: 24, borderRadius: 6,
                background: 'transparent', border: 'none',
                color: 'rgba(var(--ui-fg-rgb),0.6)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 0, fontSize: 18, lineHeight: 1, zIndex: 2,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--ui-fg-rgb),0.1)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              ×
            </button>
            {/* 슬라이드 트랙 */}
            <div style={{
              display: 'flex',
              transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
              transform: activeCategory ? 'translateX(-288px)' : 'translateX(0)',
            }}>

              {/* ── 뷰 1: 카테고리 목록 ── */}
              <div style={{ width: 288, flexShrink: 0, padding: 12 }}>
                <div style={{
                  color: 'rgba(var(--ui-fg-rgb),0.4)', fontSize: 12, fontWeight: 600,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  marginBottom: 10, paddingLeft: 4,
                }}>
                  {tr('삽입', 'Insert')}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  {/* 종이 규격 */}
                  <button
                    onClick={() => setActiveCategory('paper')}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center',
                      gap: 8, padding: '14px 8px', borderRadius: 12,
                      border: '1px solid rgba(var(--ui-fg-rgb),0.08)',
                      background: 'rgba(var(--ui-fg-rgb),0.04)',
                      cursor: 'pointer', transition: 'background 0.12s, border-color 0.12s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.1)';
                      e.currentTarget.style.borderColor = 'rgba(var(--ui-fg-rgb),0.15)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.04)';
                      e.currentTarget.style.borderColor = 'rgba(var(--ui-fg-rgb),0.08)';
                    }}
                  >
                    <FileText size={22} color="rgba(var(--ui-fg-rgb),0.75)" strokeWidth={1.6} />
                    <span style={{ color: 'rgba(var(--ui-fg-rgb),0.8)', fontSize: 12, fontWeight: 500, textAlign: 'center', lineHeight: 1.3 }}>
                      {tr('종이 규격', 'Paper size')}
                    </span>
                  </button>
                  {/* 사진 (준비 중) */}
                  <button disabled style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 8, padding: '14px 8px', borderRadius: 12,
                    border: '1px solid rgba(var(--ui-fg-rgb),0.05)',
                    background: 'rgba(var(--ui-fg-rgb),0.02)',
                    cursor: 'not-allowed', opacity: 0.4,
                  }}>
                    <Image size={22} color="rgba(var(--ui-fg-rgb),0.75)" strokeWidth={1.6} />
                    <span style={{ color: 'rgba(var(--ui-fg-rgb),0.8)', fontSize: 12, fontWeight: 500, textAlign: 'center', lineHeight: 1.3 }}>{tr('사진', 'Photo')}</span>
                  </button>
                  {/* 차트 (준비 중) */}
                  <button disabled style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    gap: 8, padding: '14px 8px', borderRadius: 12,
                    border: '1px solid rgba(var(--ui-fg-rgb),0.05)',
                    background: 'rgba(var(--ui-fg-rgb),0.02)',
                    cursor: 'not-allowed', opacity: 0.4,
                  }}>
                    <BarChart2 size={22} color="rgba(var(--ui-fg-rgb),0.75)" strokeWidth={1.6} />
                    <span style={{ color: 'rgba(var(--ui-fg-rgb),0.8)', fontSize: 12, fontWeight: 500, textAlign: 'center', lineHeight: 1.3 }}>{tr('차트', 'Chart')}</span>
                  </button>
                </div>
              </div>

              {/* ── 뷰 2: 종이 규격 목록 ── */}
              <div style={{ width: 288, flexShrink: 0 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '12px 12px 8px',
                  borderBottom: '1px solid rgba(var(--ui-fg-rgb),0.07)',
                }}>
                  <button
                    onClick={() => setActiveCategory(null)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 8,
                      border: 'none', background: 'transparent',
                      cursor: 'pointer', color: 'rgba(var(--ui-fg-rgb),0.6)',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.1)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <ChevronLeft size={16} strokeWidth={2} />
                  </button>
                  <span style={{ color: 'rgb(var(--ui-fg-rgb))', fontSize: 13, fontWeight: 600, flex: 1 }}>{tr('종이 규격', 'Paper size')}</span>
                  <div style={{ display: 'flex', gap: 2, background: 'rgba(var(--ui-fg-rgb),0.07)', borderRadius: 8, padding: 2 }}>
                    <button onClick={() => setOrientation('portrait')} title={tr('세로', 'Portrait')} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: orientation === 'portrait' ? 'rgba(var(--ui-fg-rgb),0.18)' : 'transparent',
                      transition: 'background 0.15s',
                    }}>
                      <svg width="12" height="16" viewBox="0 0 12 16" fill="none">
                        <rect x="1" y="1" width="10" height="14" rx="1.5"
                          stroke={orientation === 'portrait' ? 'rgb(var(--ui-fg-rgb))' : 'rgba(var(--ui-fg-rgb),0.45)'}
                          strokeWidth="1.5" fill={orientation === 'portrait' ? 'rgba(var(--ui-fg-rgb),0.15)' : 'none'} />
                      </svg>
                    </button>
                    <button onClick={() => setOrientation('landscape')} title={tr('가로', 'Landscape')} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 30, height: 26, borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: orientation === 'landscape' ? 'rgba(var(--ui-fg-rgb),0.18)' : 'transparent',
                      transition: 'background 0.15s',
                    }}>
                      <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                        <rect x="1" y="1" width="14" height="10" rx="1.5"
                          stroke={orientation === 'landscape' ? 'rgb(var(--ui-fg-rgb))' : 'rgba(var(--ui-fg-rgb),0.45)'}
                          strokeWidth="1.5" fill={orientation === 'landscape' ? 'rgba(var(--ui-fg-rgb),0.15)' : 'none'} />
                      </svg>
                    </button>
                  </div>
                </div>
                <div style={{ padding: '6px 8px 8px' }}>
                  {PAPER_SIZES.map((p) => {
                    const { w: dw, h: dh } = paperDims(p, orientation);   // 아이콘도 실제 비율대로 (16:9는 늘 가로)
                    const iconW = dw < dh ? 20 : 30;
                    const iconH = dw < dh ? 28 : 20;
                    return (
                      <button key={p.name} onClick={() => addPaperFrame(p)} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        width: '100%', padding: '8px', borderRadius: 10,
                        border: 'none', background: 'transparent',
                        cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ width: 34, height: 34, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{
                            width: iconW, height: iconH,
                            transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1)',
                            border: '1.5px solid rgba(var(--ui-fg-rgb),0.3)',
                            borderRadius: 2, background: 'rgba(var(--ui-fg-rgb),0.06)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 6, color: 'rgba(var(--ui-fg-rgb),0.5)', fontWeight: 600,
                          }}>{p.name}</div>
                        </div>
                        <div>
                          <div style={{ color: 'rgb(var(--ui-fg-rgb))', fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{p.name}</div>
                          <div style={{ color: 'rgba(var(--ui-fg-rgb),0.45)', fontSize: 12, lineHeight: 1.4 }}>{p.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>
          </div>
        </div>

        {/* ── 툴바 ── 폰(640px 이하)에서는 화면 폭에 맞추고 옆으로 밀어서 나머지 버튼을 봄 (스크롤바는 숨김) */}
        <div className="flex items-center gap-0.5 bg-[var(--ui-surface)] rounded-xl p-1.5 shadow-[var(--ui-shadow)] border border-[rgba(var(--ui-fg-rgb),0.08)] max-sm:max-w-[calc(100vw-24px)] max-sm:overflow-x-auto max-sm:overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
          {/* 잠금 */}
          {btn(isLocked, toggleLocked, isLocked ? tr('잠금 해제', 'Unlock') : tr('캔버스 잠금', 'Lock canvas'),
            isLocked
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                </svg>
          )}
          <div className="w-px h-5 bg-[rgba(var(--ui-fg-rgb),0.2)] mx-0.5" />
          {btn(drawTool === 'frame',     () => activateDraw('frame'),     tr('프레임 추가', 'Add frame'),      <Frame         size={18} strokeWidth={1.8} />)}
          {btn(drawTool === 'rectangle', () => activateDraw('rectangle'), tr('사각형 추가', 'Add rectangle'),      <Square        size={18} strokeWidth={1.8} />)}
          {btn(drawTool === 'circle',    () => activateDraw('circle'),    tr('원 추가', 'Add circle'),          <Circle        size={18} strokeWidth={1.8} />)}
          {/* ── 연결선 버튼 + 드롭다운 ── */}
          <div ref={connectRef} style={{ position: 'relative' }}>
            {/* 메인 버튼 영역 */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {/* 아이콘 클릭 → connect 모드 토글 */}
              <button
                title={tr('연결선', 'Connector')}
                onClick={() => {
                  setDrawTool(null);
                  if (currentTool === 'connect') {
                    setCurrentTool('select');
                  } else {
                    setCurrentTool('connect');
                    setShowConnectMenu(false);
                  }
                }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 34, height: 34, borderRadius: '8px 0 0 8px',
                  border: 'none', cursor: 'pointer',
                  background: currentTool === 'connect'
                    ? 'rgba(var(--ui-fg-rgb),0.18)'
                    : 'transparent',
                  color: currentTool === 'connect' ? 'rgb(var(--ui-fg-rgb))' : 'rgba(var(--ui-fg-rgb),0.65)',
                  transition: 'background 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (currentTool !== 'connect') {
                    e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.1)';
                    e.currentTarget.style.color = 'rgb(var(--ui-fg-rgb))';
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentTool !== 'connect') {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'rgba(var(--ui-fg-rgb),0.65)';
                  }
                }}
              >
                {connectLabeled
                  ? /* 라벨 있는 화살표 */
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="2" y1="12" x2="22" y2="12"/>
                      <polyline points="17 7 22 12 17 17"/>
                      <rect x="8" y="8" width="8" height="8" rx="2" fill="currentColor" stroke="none" opacity="0.35"/>
                      <text x="12" y="14.5" textAnchor="middle" fontSize="5" fill="currentColor" stroke="none" fontWeight="700">T</text>
                    </svg>
                  : edgeLineType === 'default'
                    ? /* 곡선 화살표 */
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 20 C 4 11, 9 6, 20 6"/>
                        <polyline points="16.5,2.5 20,6 16.5,9.5"/>
                      </svg>
                    : edgeLineType === 'step'
                      ? /* 꺾은선 화살표 */
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3,6 14,6 14,20"/>
                          <polyline points="10.5,16.5 14,20 17.5,16.5"/>
                        </svg>
                      : <ArrowRight size={18} strokeWidth={1.8} />
                }
              </button>
              {/* 드롭다운 토글 버튼 */}
              <button
                title={tr('연결선 종류 선택', 'Choose connector type')}
                onClick={() => setShowConnectMenu((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 16, height: 34, borderRadius: '0 8px 8px 0',
                  border: 'none', cursor: 'pointer',
                  background: currentTool === 'connect'
                    ? 'rgba(var(--ui-fg-rgb),0.12)'
                    : 'transparent',
                  color: 'rgba(var(--ui-fg-rgb),0.4)',
                  transition: 'background 0.15s, color 0.15s',
                  paddingRight: 2,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.1)';
                  e.currentTarget.style.color = 'rgba(var(--ui-fg-rgb),0.8)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = currentTool === 'connect' ? 'rgba(var(--ui-fg-rgb),0.12)' : 'transparent';
                  e.currentTarget.style.color = 'rgba(var(--ui-fg-rgb),0.4)';
                }}
              >
                <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor">
                  <path d="M4 6L0 0h8z"/>
                </svg>
              </button>
            </div>

            {/* 드롭다운 메뉴 — body로 띄움: 폰에서 도구 막대가 옆으로 밀리는(스크롤) 상자라 안에 두면 잘림 */}
            {showConnectMenu && typeof document !== 'undefined' && (() => {
              const r = connectRef.current?.getBoundingClientRect();
              const half = 85;   // minWidth 170 의 절반 — 화면 밖으로 나가지 않게
              const cx = r ? Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8) : 0;
              const bottom = r ? window.innerHeight - r.top + 8 : 0;
              return createPortal(
              <div ref={connectMenuRef} style={{
                position: 'fixed', bottom, left: cx,
                transform: 'translateX(-50%)',
                background: 'var(--ui-surface)',
                border: '1px solid rgba(var(--ui-fg-rgb),0.12)',
                borderRadius: 10,
                boxShadow: 'var(--ui-shadow)',
                overflow: 'hidden',
                minWidth: 170,
                zIndex: 9999,
              }}>
                {/* 닫기 X 버튼 - 헤더 */}
                <div style={{
                  display: 'flex', justifyContent: 'flex-end',
                  padding: '4px 4px 0',
                  borderBottom: '1px solid rgba(var(--ui-fg-rgb),0.05)',
                }}>
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setShowConnectMenu(false); }}
                    title={tr('닫기', 'Close')}
                    style={{
                      width: 22, height: 22, borderRadius: 5,
                      background: 'transparent', border: 'none',
                      color: 'rgba(var(--ui-fg-rgb),0.6)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, fontSize: 16, lineHeight: 1,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--ui-fg-rgb),0.1)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    ×
                  </button>
                </div>
                {/* 일반 연결선 (직선·꺾은선) */}
                {[
                  {
                    key: 'straight',
                    active: !connectLabeled && edgeLineType === 'straight',
                    icon: <ArrowRight size={16} strokeWidth={1.8} style={{ color: 'rgba(var(--ui-fg-rgb),0.7)', flexShrink: 0 }} />,
                    title: tr('직선', 'Straight'),
                    desc: tr('두 점을 곧게 잇는 선', 'A straight line between two points'),
                    onClick: () => { setConnectLabeled(false); setEdgeLineType('straight'); setDrawTool(null); setCurrentTool('connect'); setShowConnectMenu(false); },
                  },
                  {
                    key: 'plain',
                    active: !connectLabeled && edgeLineType === 'step',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--ui-fg-rgb),0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <polyline points="3,6 14,6 14,20"/>
                        <polyline points="10.5,16.5 14,20 17.5,16.5"/>
                      </svg>
                    ),
                    title: tr('꺾은선', 'Elbow'),
                    desc: tr('직각으로 한 번 이상 꺾이는 경로', 'A path with one or more right-angle turns'),
                    onClick: () => { setConnectLabeled(false); setEdgeLineType('step'); setDrawTool(null); setCurrentTool('connect'); setShowConnectMenu(false); },
                  },
                  {
                    key: 'curve',
                    active: !connectLabeled && edgeLineType === 'default',
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--ui-fg-rgb),0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M4 20 C 4 11, 9 6, 20 6"/>
                        <polyline points="16.5,2.5 20,6 16.5,9.5"/>
                      </svg>
                    ),
                    title: tr('곡선 연결선', 'Curved'),
                    desc: tr('꺾는 부분 없이 부드러운 곡선', 'A smooth curve with no corners'),
                    onClick: () => { setConnectLabeled(false); setEdgeLineType('default'); setDrawTool(null); setCurrentTool('connect'); setShowConnectMenu(false); },
                  },
                  {
                    key: 'labeled',
                    active: connectLabeled,
                    icon: (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--ui-fg-rgb),0.7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <polyline points="17 7 22 12 17 17"/>
                        <rect x="7" y="7" width="10" height="10" rx="2" fill="rgba(var(--ui-fg-rgb),0.15)" stroke="rgba(var(--ui-fg-rgb),0.5)" strokeWidth="1.2"/>
                        <line x1="10" y1="12" x2="14" y2="12" stroke="rgba(var(--ui-fg-rgb),0.7)" strokeWidth="1.4"/>
                      </svg>
                    ),
                    title: tr('라벨 있는 연결선', 'Labeled connector'),
                    desc: tr('중간에 텍스트 입력 가능', 'Add text in the middle'),
                    onClick: () => { setConnectLabeled(true); setDrawTool(null); setCurrentTool('connect'); setShowConnectMenu(false); },
                  },
                ].map(({ key, active, icon, title, desc, onClick }, idx, arr) => (
                  <button
                    key={key}
                    onClick={onClick}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      width: '100%', padding: '10px 14px',
                      border: 'none',
                      background: active ? 'rgba(var(--ui-fg-rgb),0.08)' : 'transparent',
                      color: active ? 'rgb(var(--ui-fg-rgb))' : 'rgba(var(--ui-fg-rgb),0.7)',
                      cursor: 'pointer', textAlign: 'left',
                      fontSize: 13, fontWeight: active ? 600 : 400,
                      transition: 'background 0.12s',
                      borderBottom: idx < arr.length - 1 ? '1px solid rgba(var(--ui-fg-rgb),0.06)' : 'none',
                    }}
                    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(var(--ui-fg-rgb),0.06)'; }}
                    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {icon}
                    <div>
                      <div style={{ fontWeight: active ? 600 : 400 }}>{title}</div>
                      <div style={{ fontSize: 12, color: 'rgba(var(--ui-fg-rgb),0.4)', marginTop: 1 }}>{desc}</div>
                    </div>
                    {active && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'rgba(99,179,116,0.9)' }}>✓</span>}
                  </button>
                ))}
              </div>,
              document.body);
            })()}
          </div>
          {btn(drawTool === 'text', () => activateDraw('text'), tr('텍스트 박스 추가', 'Add text box'), <Type size={18} strokeWidth={1.8} />)}
          {/* 표 추가 — Grid Picker 팝업 */}
          <div style={{ position: 'relative' }} ref={tablePickerRef}>
            {btn(
              showTablePicker || drawTool === 'table',
              () => { setShowTablePicker((v) => !v); setDrawTool(null); },
              tr('표 추가', 'Add table'),
              <Table size={18} strokeWidth={1.8} />,
            )}
            {showTablePicker && typeof document !== 'undefined' && (() => {
              const rect = tablePickerRef.current?.getBoundingClientRect();
              const anchorLeft = rect ? rect.left + rect.width / 2 : 0;
              const anchorBottom = rect ? window.innerHeight - rect.top + 10 : 0;
              return createPortal(
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setShowTablePicker(false);
                    setPickerHover(null);
                  }}
                />
              <div
                ref={tablePickerPopupRef}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  position: 'fixed', bottom: anchorBottom, left: anchorLeft,
                  transform: 'translateX(-50%)',
                  background: 'var(--ui-surface)', border: '1px solid rgba(var(--ui-fg-rgb),0.13)',
                  borderRadius: 10, boxShadow: 'var(--ui-shadow)',
                  padding: '10px 10px 8px', zIndex: 9999,
                  userSelect: 'none',
                }}
              >
                {/* 닫기 X 버튼 */}
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTablePicker(false);
                    setPickerHover(null);
                  }}
                  title={tr('닫기', 'Close')}
                  style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 20, height: 20, borderRadius: 4,
                    background: 'transparent', border: 'none',
                    color: 'rgba(var(--ui-fg-rgb),0.6)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: 0, fontSize: 14, lineHeight: 1,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--ui-fg-rgb),0.1)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                >
                  ×
                </button>
                {/* 라벨 */}
                <div style={{
                  textAlign: 'center', fontSize: 12, fontWeight: 500,
                  color: 'rgba(var(--ui-fg-rgb),0.75)',
                  marginBottom: 8, minHeight: 18, lineHeight: '18px',
                  paddingRight: 16,
                }}>
                  {pickerHover
                    ? tr(`${pickerHover.r + 1}줄 × ${pickerHover.c + 1}칸`, `${pickerHover.r + 1} rows × ${pickerHover.c + 1} cols`)
                    : tr('표 크기 선택', 'Choose table size')}
                </div>
                {/* 10 × 10 그리드 */}
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                  onMouseLeave={() => setPickerHover(null)}
                >
                  {Array.from({ length: 10 }, (_, r) => (
                    <div key={r} style={{ display: 'flex', gap: 2 }}>
                      {Array.from({ length: 10 }, (_, c) => {
                        const active = !!pickerHover && r <= pickerHover.r && c <= pickerHover.c;
                        return (
                          <div
                            key={c}
                            onMouseEnter={() => setPickerHover({ r, c })}
                            onClick={() => insertTableNode(r + 1, c + 1)}
                            style={{
                              width: 20, height: 20,
                              background: active ? 'rgba(59,130,246,0.55)' : 'rgba(var(--ui-fg-rgb),0.07)',
                              border: `1px solid ${active ? 'rgba(96,165,250,0.85)' : 'rgba(var(--ui-fg-rgb),0.14)'}`,
                              borderRadius: 3,
                              cursor: 'pointer',
                              transition: 'background 0.06s, border-color 0.06s',
                            }}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              </>,
              document.body,
              );
            })()}
          </div>
          {btn(drawTool === 'freehand', () => { setDrawTool(drawTool === 'freehand' ? null : 'freehand'); }, tr('글씨 쓰기', 'Draw'), <Pencil size={18} strokeWidth={1.8} />)}
          {btn(false, deleteSelected, tr('삭제', 'Delete'), <Trash2 size={18} strokeWidth={1.8} />)}
          <div className="w-px h-5 bg-[rgba(var(--ui-fg-rgb),0.2)] mx-0.5" />
          {btn(showMore, () => setShowMore((v) => !v), tr('더 보기', 'More'), <MoreHorizontal size={18} strokeWidth={1.8} />)}
        </div>
      </div>
    </Panel>
  );
};

// ── 사이드바 토글 시 fitView (ReactFlow 내부에서 useReactFlow 호출) ──
const SidebarFitView = ({ rightCollapsed }: { rightCollapsed: boolean }) => {
  const { fitView } = useReactFlow<AppNode>();
  const isFirst = useRef(true);

  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    setTimeout(() => fitView({ ..._FIT_VIEW_OPTIONS, duration: 300 }), 280);
  }, [rightCollapsed, fitView]);

  return null;
};

// ── 메인 캔버스 ──────────────────────────────────────────────
interface CanvasProps {
  initialNodes: AppNode[];
  initialEdges: AppEdge[];
  rightCollapsed: boolean;
  // 노드/엣지 변경 시 호출되는 콜백 (자동 저장용)
  onCanvasChange: (nodes: AppNode[], edges: AppEdge[]) => void;
}


// ── 줌 → CSS 변수(--canvas-zoom) ─────────────────────────────
// 묶음 선택 테두리 두께가 이 값으로 나눠 줌과 상관없이 화면에서 같은 두께로 보임
// 변수는 줌이 멈춘 뒤에 한 번만 바꿈 — 맨 위 요소의 변수가 바뀌면 그 변수를 안 쓰는 요소까지
// 캔버스 안 전부(요소 수백 개 × 안쪽 태그)의 스타일을 다시 계산해서, 줌하는 동안 매 프레임 바꾸면 화면이 끊김
// (요소 215개 기준 프레임당 약 33ms → 17ms)
const ZOOM_VAR_DELAY = 140;
function ZoomCssVar() {
  const zoom    = useStore((s) => s.transform[2]);
  const domNode = useStore((s) => s.domNode);
  const applied = useRef(false);
  useEffect(() => {
    if (!domNode) return;
    const apply = () => { domNode.style.setProperty('--canvas-zoom', String(zoom)); applied.current = true; };
    if (!applied.current) { apply(); return; }   // 처음 열 때는 바로
    const t = setTimeout(apply, ZOOM_VAR_DELAY);
    return () => clearTimeout(t);
  }, [zoom, domNode]);
  return null;
}

// ── 묶음 선택 테두리 ─────────────────────────────────────────
// 묶음을 통째로 고르면 요소마다 크기 조절 점을 띄우는 대신 묶음 전체를 감싸는 테두리 하나만 그림
function GroupOutline() {
  const solo = useCanvasStore((s) => s.soloGroupId);
  // 선택된 묶음마다 "x,y,w,h" — 글자로 비교해서 값이 같으면 다시 그리지 않음
  const boxes = useStore((s) => {
    const bounds = new Map<string, [number, number, number, number]>();
    for (const n of s.nodeLookup.values()) {
      const gid = n.selected ? (n.data as AppNode['data']).groupId : undefined;
      if (!gid || gid === solo) continue;
      const { x, y } = n.internals.positionAbsolute;
      const w = n.measured.width ?? n.width ?? 0, h = n.measured.height ?? n.height ?? 0;
      const b = bounds.get(gid);
      if (!b) bounds.set(gid, [x, y, x + w, y + h]);
      else { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x + w); b[3] = Math.max(b[3], y + h); }
    }
    return [...bounds.values()].map((b) => b.map(Math.round).join(',')).join(';');
  });
  if (!boxes) return null;
  return (
    <ViewportPortal>
      {boxes.split(';').map((key) => {
        const [x0, y0, x1, y1] = key.split(',').map(Number);
        const pad = 5;
        return (
          <div key={key} style={{
            position: 'absolute', left: x0 - pad, top: y0 - pad, width: x1 - x0 + pad * 2, height: y1 - y0 + pad * 2,
            border: 'calc(1.5px / var(--canvas-zoom, 1)) solid #6366f1', borderRadius: 6,
            pointerEvents: 'none', zIndex: 1000, boxSizing: 'border-box',
          }} />
        );
      })}
    </ViewportPortal>
  );
}

export const Canvas = ({ initialNodes, initialEdges, rightCollapsed, onCanvasChange }: CanvasProps) => {
  // 0이면 화면에 보이는 요소만 그림, 사진 찍는 동안엔 1 이상 → 전부 그림
  const renderAllCount = useRenderAll((s) => s.count);
  // doc 컨테이너의 자식 텍스트 노드 제거 (Phase 1 구버전 데이터 호환 — "텍스트" 글상자 잔여물)
  const docContainerIds = new Set(
    initialNodes.filter((n) => n.data?.isDocContainer).map((n) => n.id),
  );
  const cleanedNodes = docContainerIds.size > 0
    ? initialNodes
        .filter((n) => !(n.data?.shape === 'text' && n.parentId && docContainerIds.has(n.parentId)))
        // 기존 doc 컨테이너 배경/테두리 투명화 마이그레이션
        .map((n) =>
          n.data?.isDocContainer && n.data.bgColor !== 'transparent'
            ? { ...n, data: { ...n.data, bgColor: 'transparent', strokeColor: 'transparent', strokeWidth: 0 } }
            : n,
        )
    : initialNodes;

  // 프레임 & 문서 컨테이너는 zIndex를 낮춰 안에 있는 노드가 클릭될 수 있게 보정
  // 그 외 도형은 생성 순서대로 쌓임 (먼저 만든 도형이 아래) → 예전에 낮춰 저장된 zIndex는 0으로 복구
  //   부모 프레임이 자식보다 뒤에 저장된 캔버스(예전 AI 와이어프레임)도 불러올 때 순서를 바로잡음
  const normalizedNodes = placeFramesFirst(cleanedNodes).map((n) => {
    const isLowZ = n.data?.shape === 'frame' || !!n.data?.isDocContainer;
    if (!isLowZ) return (n.zIndex ?? 0) < 0 ? { ...n, zIndex: 0 } : n;
    const w = n.data.width ?? (n.width as number | undefined) ?? 120;
    const h = n.data.height ?? (n.height as number | undefined) ?? 120;
    return { ...n, zIndex: -Math.ceil(w * h / 100) };
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(normalizedNodes);
  // 예전 AI 연결선은 화살표 종류(type)가 빠진 채 저장돼 화살표 머리가 안 보였음 → 닫힌 화살표로 채움
  const withMarkerType = (m: AppEdge['markerEnd']) =>
    m && typeof m === 'object' && !m.type ? { ...m, type: MarkerType.ArrowClosed } : m;
  const normalizedEdges = initialEdges.map((e) => {
    const markerEnd = withMarkerType(e.markerEnd);
    const markerStart = withMarkerType(e.markerStart);
    return markerEnd === e.markerEnd && markerStart === e.markerStart ? e : { ...e, markerEnd, markerStart };
  });
  const [edges, setEdges, onEdgesChange] = useEdgesState<AppEdge>(normalizedEdges);

  // ── 실행취소/다시실행 히스토리 ────────────────────────────────
  type Snapshot = { nodes: AppNode[]; edges: AppEdge[] };
  const undoStack   = useRef<Snapshot[]>([]);
  const redoStack   = useRef<Snapshot[]>([]);
  const nodesRef    = useRef(nodes);  nodesRef.current  = nodes;
  const edgesRef    = useRef(edges);  edgesRef.current  = edges;

  // 마지막으로 "안정 상태"에 있던 스냅샷 (프로퍼티 변경 감지용)
  const lastCommitted   = useRef<Snapshot>({ nodes: normalizedNodes, edges: normalizedEdges });
  const sessionPreState = useRef<Snapshot | null>(null); // 현재 변경 세션 시작 전 상태
  const propTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 드래그/리사이즈 중 useEffect 억제용 플래그
  const isDraggingOrResizing = useRef(false);
  // 이벤트 기반 push 직후 lastCommitted 갱신용 플래그
  const justFlushed = useRef(false);
  // undo/redo 복원 중 useEffect 억제용 플래그
  const isRestoring = useRef(false);

  const [historyLen, setHistoryLen] = useState({ undo: 0, redo: 0 });

  // ── 클립보드 (복사/붙여넣기) ──────────────────────────────────
  const [clipboard, setClipboard] = useState<{ nodes: AppNode[]; edges: AppEdge[] } | null>(null);
  const clipboardRef = useRef(clipboard);
  clipboardRef.current = clipboard;
  // 시스템 클립보드에 넣은 사진의 크기 — 붙여넣을 때 캔버스에서 복사한 사진인지 알아보는 데 씀
  const copiedImageSize = useRef<{ w: number; h: number } | null>(null);

  // ── 슬래시 메뉴 ("/" 로 요소 추가) — 연 위치(캔버스 영역 기준 px) ──
  const [slashMenu, setSlashMenu] = useState<{ x: number; y: number } | null>(null);
  const setMockupBusy = useCanvasStore((s) => s.setMockupBusyId);
  const setImageDropTarget = useCanvasStore((s) => s.setImageDropTarget);

  // 현재 lastCommitted를 undo 스택에 push (액션 실행 전에 호출)
  const quickPush = useCallback(() => {
    if (propTimer.current) { clearTimeout(propTimer.current); propTimer.current = null; }
    sessionPreState.current = null;
    undoStack.current.push({ ...lastCommitted.current });
    if (undoStack.current.length > 60) undoStack.current.shift();
    redoStack.current = [];
    setHistoryLen({ undo: undoStack.current.length, redo: 0 });
  }, []);

  const undo = useCallback(() => {
    if (!undoStack.current.length) return;
    if (propTimer.current) { clearTimeout(propTimer.current); propTimer.current = null; }
    sessionPreState.current = null;
    const prev = undoStack.current.pop()!;
    redoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    isRestoring.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    setHistoryLen({ undo: undoStack.current.length, redo: redoStack.current.length });
    requestAnimationFrame(() => { isRestoring.current = false; });
  }, [setNodes, setEdges]);

  const redo = useCallback(() => {
    if (!redoStack.current.length) return;
    if (propTimer.current) { clearTimeout(propTimer.current); propTimer.current = null; }
    sessionPreState.current = null;
    const next = redoStack.current.pop()!;
    undoStack.current.push({ nodes: nodesRef.current, edges: edgesRef.current });
    isRestoring.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistoryLen({ undo: undoStack.current.length, redo: redoStack.current.length });
    requestAnimationFrame(() => { isRestoring.current = false; });
  }, [setNodes, setEdges]);

  // ── 새로 만든 노드는 항상 맨 위로 ──────────────────────────────
  // '맨 앞으로'로 zIndex가 올라간 노드가 있으면 zIndex 0인 새 노드가 그 아래에 깔림 → 최댓값 + 1 부여
  // 프레임·문서 컨테이너/페이지는 면적 기반 음수 zIndex 유지 (안쪽 노드를 덮지 않도록)
  const knownNodeIds = useRef(new Set(normalizedNodes.map((n) => n.id)));
  const skipHistoryOnce = useRef(false); // zIndex 보정은 별도 실행취소 단계로 남기지 않음

  // 프로퍼티 변경(색상, 폰트 등) 감지 — 500ms 디바운스로 이전 상태를 히스토리에 저장
  useEffect(() => {
    if (skipHistoryOnce.current) {
      skipHistoryOnce.current = false;
      // 진행 중인 변경 세션이 있으면 그 세션에 합쳐지고, 없으면 기준 상태만 갱신
      if (!sessionPreState.current) lastCommitted.current = { nodes, edges };
      return;
    }
    if (isRestoring.current) {
      lastCommitted.current = { nodes, edges };
      sessionPreState.current = null;
      return;
    }
    if (isDraggingOrResizing.current) return;
    if (justFlushed.current) {
      lastCommitted.current = { nodes, edges };
      justFlushed.current = false;
      sessionPreState.current = null;
      return;
    }
    // 세션 최초 변경 시 이전 상태 캡처
    if (!sessionPreState.current) {
      sessionPreState.current = { ...lastCommitted.current };
    }
    if (propTimer.current) clearTimeout(propTimer.current);
    propTimer.current = setTimeout(() => {
      if (!sessionPreState.current || isRestoring.current) return;
      undoStack.current.push(sessionPreState.current);
      if (undoStack.current.length > 60) undoStack.current.shift();
      redoStack.current = [];
      sessionPreState.current = null;
      lastCommitted.current = { nodes: nodesRef.current, edges: edgesRef.current };
      setHistoryLen({ undo: undoStack.current.length, redo: 0 });
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // 새 노드 zIndex 보정 — 히스토리 effect보다 뒤에 둬야 skipHistoryOnce가 다음 렌더에만 적용됨
  useEffect(() => {
    const known = knownNodeIds.current;
    knownNodeIds.current = new Set(nodes.map((n) => n.id));
    if (isRestoring.current) return;

    const isLowZ = (n: AppNode) => n.data?.shape === 'frame' || !!n.data?.isDocContainer || !!n.data?.isDocPage;
    const added = nodes.filter((n) => !known.has(n.id) && !isLowZ(n));
    if (added.length === 0) return;

    const maxZ = Math.max(0, ...nodes.filter((n) => known.has(n.id) && !isLowZ(n)).map((n) => n.zIndex ?? 0));
    // 아무도 올라가 있지 않으면 배열 순서(뒤에 추가 = 위)만으로 충분
    if (maxZ <= 0) return;

    // 여러 개를 한 번에 추가(붙여넣기 등)한 경우 서로 간의 순서는 유지
    const order = [...added].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
    const zMap = new Map(order.map((n, i) => [n.id, maxZ + 1 + i]));
    skipHistoryOnce.current = true;
    setNodes((prev) => prev.map((n) => (zMap.has(n.id) ? { ...n, zIndex: zMap.get(n.id)! } : n)));
  }, [nodes, setNodes]);

  // 키보드 단축키 — Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, "/" 슬래시 메뉴
  // 복사/붙여넣기는 copy·paste 이벤트로 처리 (keydown에서 막으면 캡처 이미지를 받을 수 없음)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;

      // "/" — 글씨를 쓰는 중(입력창·글상자 편집·한글 조합 중)이 아니면 마우스 위치에 슬래시 메뉴
      if (e.key === '/' && !mod && !e.altKey && !e.isComposing && !isEditable(e.target)) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        e.preventDefault();
        const p = lastPointerRef.current;
        setSlashMenu(p ? { x: p.x - rect.left, y: p.y - rect.top } : { x: rect.width / 2, y: rect.height / 2 });
        return;
      }

      if (!mod) return;

      // Ctrl+G 묶기 / Ctrl+Shift+G 풀기 — 글 쓰는 중에는 브라우저 기본 동작
      if (e.key.toLowerCase() === 'g' && !e.altKey && !isEditable(e.target)) {
        const ids = new Set(nodesRef.current.filter((n) => n.selected).map((n) => n.id));
        if (ids.size === 0) return;
        e.preventDefault();
        useCanvasStore.getState().setSoloGroupId(null);
        setNodes((prev) => (e.shiftKey ? ungroupNodes(prev, ids) : groupNodes(prev, ids)));
        return;
      }

      if (!e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); return; }
      if (e.key === 'y' || (e.shiftKey && e.key === 'z')) { e.preventDefault(); redo(); return; }
    };

    // 글자 편집 중에는 브라우저 기본 복사/붙여넣기·"/" 입력 유지
    // (슬라이더·체크박스처럼 글자를 쓰지 않는 입력은 제외 — 투명도 조절 직후 Ctrl+C가 무시되지 않게)
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || !!t.closest(
        'textarea, select, input:not([type=range]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=color])'));

    // 캔버스에서 복사했다는 표시 (밖에 붙여넣을 때는 보이지 않는 형식)
    const NODES_MIME = 'application/x-vibestructure-nodes';

    // 이미지 주소 → PNG (시스템 클립보드는 PNG만 받음)
    const toPngBlob = (src: string) => new Promise<Blob>((resolve, reject) => {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d')!.drawImage(img, 0, 0);
        copiedImageSize.current = { w: c.width, h: c.height };
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('png 변환 실패'))), 'image/png');
      };
      img.onerror = () => reject(new Error('이미지를 불러오지 못함'));
      img.src = src;
    });

    // ── 복사: 선택 노드를 내부 클립보드에 저장 + 시스템 클립보드에 글자·이미지 ──
    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const selected = nodesRef.current.filter((n) => n.selected);
      if (!selected.length) return;
      e.preventDefault();
      const selIds = new Set(selected.map((n) => n.id));
      // 선택된 프레임의 자식 노드도 포함
      const children = nodesRef.current.filter((n) => n.parentId && selIds.has(n.parentId));
      const allToCopy = [...selected, ...children.filter((n) => !selIds.has(n.id))];
      const allIds = new Set(allToCopy.map((n) => n.id));
      // 복사 집합 안에서만 연결된 엣지 포함
      const edgesToCopy = edgesRef.current.filter((e) => allIds.has(e.source) && allIds.has(e.target));
      setClipboard({ nodes: allToCopy, edges: edgesToCopy });

      // 시스템 클립보드도 덮어씀 → 다른 앱에 붙여넣으면 노드 글자, 이전에 캡처한 이미지가 대신 붙여넣어지지도 않게
      const texts = allToCopy.flatMap((n) => [n.data.title, n.data.subtitle]).filter((t) => t?.trim());
      e.clipboardData?.setData('text/plain', texts.join('\n'));
      e.clipboardData?.setData(NODES_MIME, '1');
      copiedImageSize.current = null;

      // 사진 하나만 복사 → 사진 자체를 클립보드에 (카톡·노션·문서 등에 붙여넣기)
      const only = allToCopy.length === 1 ? allToCopy[0] : null;
      if (only?.data.shape === 'image' && only.data.imageUrl && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': toPngBlob(only.data.imageUrl) })])
          .catch((err) => console.warn('이미지를 클립보드에 넣지 못했습니다', err));
      }
    };

    // ── 붙여넣기: 클립보드 이미지 → 이미지 노드, 외부 텍스트 → 텍스트 박스, 아니면 내부 클립보드 노드 ──
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      // 캔버스에서 복사한 노드 → 그대로 복제
      if (clipboardRef.current && e.clipboardData?.types.includes(NODES_MIME)) {
        e.preventDefault();
        pasteNodes();
        return;
      }
      const imageFile = Array.from(e.clipboardData?.items ?? [])
        .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
        ?.getAsFile();
      if (imageFile) {
        e.preventDefault();
        const pasteImage = () => {
          // 목업·이미지 칸 하나만 골라 둔 상태면 새 이미지 대신 거기에 끼워 넣음
          const sel = nodesRef.current.filter((n) => n.selected);
          if (sel.length === 1 && acceptsImage(sel[0].data)) void fillMockup(sel[0].id, imageFile);
          else void addImageNode(imageFile);
        };
        // 캔버스에서 복사한 사진(크기가 같음)이면 다시 올리지 않고 노드를 복제
        const copied = copiedImageSize.current;
        if (!copied || !clipboardRef.current) { pasteImage(); return; }
        createImageBitmap(imageFile)
          .then((bmp) => (bmp.width === copied.w && bmp.height === copied.h ? pasteNodes() : pasteImage()))
          .catch(pasteImage);
        return;
      }
      // 외부에서 복사한 글(Claude Code 등)은 텍스트 박스로
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text.trim()) {
        e.preventDefault();
        addTextNode(text);
        return;
      }
      if (!clipboardRef.current) return;
      e.preventDefault();
      pasteNodes();
    };

    // 내부 클립보드의 노드 붙여넣기
    const pasteNodes = () => {
      if (!clipboardRef.current) return;
      // 캔버스에서 복사한 사진 한 장 + 아이폰 목업 하나 선택 → 사진을 복제하지 않고 목업 화면에 넣음
      const copied = clipboardRef.current.nodes;
      const picked = nodesRef.current.filter((n) => n.selected);
      if (copied.length === 1 && copied[0].data.shape === 'image' && copied[0].data.imageUrl
        && picked.length === 1 && acceptsImage(picked[0].data)) {
        const imageUrl = copied[0].data.imageUrl;
        quickPush();
        justFlushed.current = true;
        setNodes((prev) => prev.map((n) => (n.id === picked[0].id
          ? { ...n, data: { ...n.data, imageUrl, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined } }
          : n)));
        return;
      }
      quickPush();
      justFlushed.current = true;
      const ts = Date.now();
      const idMap = new Map<string, string>();
      clipboardRef.current.nodes.forEach((n, i) => idMap.set(n.id, `node-${ts}-${i}`));
      const OFFSET = 24;
      const newNodes: AppNode[] = clipboardRef.current.nodes.map((n) => ({
        ...n,
        id: idMap.get(n.id)!,
        selected: true,
        // 프레임(최상위)은 오프셋 적용, 자식은 상대좌표 유지
        position: n.parentId
          ? n.position
          : { x: n.position.x + OFFSET, y: n.position.y + OFFSET },
        parentId: n.parentId ? idMap.get(n.parentId) : undefined,
        data: { ...n.data },
      }));
      const newEdges: AppEdge[] = clipboardRef.current.edges.map((e, i) => ({
        ...e,
        id: `edge-${ts}-${i}`,
        source: idMap.get(e.source) ?? e.source,
        target: idMap.get(e.target) ?? e.target,
      }));
      setNodes((prev) => [
        ...prev.map((n) => ({ ...n, selected: false })),
        ...placeFramesFirst(remapGroupIds(newNodes)),   // 복사본은 새 묶음 번호 — 원본과 한 묶음이 되지 않게
      ]);
      if (newEdges.length) setEdges((prev) => [...prev, ...newEdges]);
    };

    // 목업 화면에 이미지 넣기 (이미 있으면 교체)
    const fillMockup = async (nodeId: string, file: File) => {
      let img: Awaited<ReturnType<typeof prepareCanvasImage>>;
      try {
        img = await prepareCanvasImage(file);
      } catch (err) {
        console.error(err);
        alert(tr('이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Could not upload the image. Please try again in a moment.'));
        return;
      }
      quickPush();
      justFlushed.current = true;
      setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, imageUrl: img.src, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined } } : n)));
    };

    // 이미지 노드 추가 — 화면 기준 크기(가로 40%·세로 50% 이내)로, 마우스 위치(캔버스 밖이면 화면 중앙)에 배치
    const addImageNode = async (file: File) => {
      let img: Awaited<ReturnType<typeof prepareCanvasImage>>;
      try {
        img = await prepareCanvasImage(file);
      } catch (err) {
        console.error(err);
        alert(tr('이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Could not upload the image. Please try again in a moment.'));
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // 화면에 보이는 크기(px) 계산 → 확대/축소와 무관하게 눈에 잘 띄는 크기 (작은 이미지는 원본 크기)
      const screenScale = Math.min(1, (rect.width * 0.4) / img.width, (rect.height * 0.5) / img.height);
      const placed = placeOnScreen(rect, img.width * screenScale, img.height * screenScale);
      const { w, h } = placed;

      quickPush();
      justFlushed.current = true;
      const newNode: AppNode = {
        id:       `node-${Date.now()}`,
        type:     'custom',
        position: placed.position,
        width:    w,
        height:   h,
        zIndex:   0,
        selected: true,
        data: {
          title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'image',
          width: w, height: h, imageUrl: img.src,
        },
      };
      setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), newNode]);
    };

    // 화면 크기(sw×sh px)의 노드를 마우스 위치(캔버스 밖이면 화면 중앙)에 놓을 때의 캔버스 좌표·크기
    // 화면 밖이나 하단 툴바·우측 줌 버튼에 가리지 않게 중심 위치를 제한
    const placeOnScreen = (rect: DOMRect, sw: number, sh: number) => {
      const { x: vx, y: vy, zoom } = viewportRef.current;
      const pointer = lastPointerRef.current;
      const pad = { top: 16, left: 16, right: 64, bottom: 96 };
      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));
      const cx = clamp(pointer ? pointer.x - rect.left : rect.width / 2,  sw / 2 + pad.left, rect.width  - sw / 2 - pad.right);
      const cy = clamp(pointer ? pointer.y - rect.top  : rect.height / 2, sh / 2 + pad.top,  rect.height - sh / 2 - pad.bottom);
      const w = Math.round(sw / zoom);
      const h = Math.round(sh / zoom);
      return { w, h, position: { x: (cx - vx) / zoom - w / 2, y: (cy - vy) / zoom - h / 2 } };
    };

    // 텍스트 박스 추가 — 줄바꿈·들여쓰기를 살려 왼쪽·위 정렬로 그대로 표시
    const addTextNode = (raw: string) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      // 줄 끝 공백 제거, 앞뒤 빈 줄 제거, 모든 줄에 공통인 앞 들여쓰기 제거(터미널 복사 시 붙는 여백)
      const lines = raw.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
      while (lines.length && !lines[0]) lines.shift();
      while (lines.length && !lines[lines.length - 1]) lines.pop();
      const indent = Math.min(...lines.filter(Boolean).map((l) => l.match(/^ */)![0].length));
      const text = lines.map((l) => l.slice(indent)).join('\n');

      // 화면에서 14px 글씨로 보이게, 가로는 가장 긴 줄 기준(화면 50% 이내) — 넘치는 줄은 자동 줄바꿈
      const FONT = 14;
      const zoom = viewportRef.current.zoom;
      const longest = Math.max(...lines.map((l) => l.length - indent));
      const sw = Math.min(Math.max(longest * FONT * 0.6 + 16, 160), rect.width * 0.5);
      const { w, position } = placeOnScreen(rect, sw, Math.min(lines.length * FONT * 1.4 + 16, rect.height * 0.6));

      // 줄바꿈 후 실제 높이를 미리 재서 처음부터 맞는 크기로 생성
      // (작게 만들고 TextShape가 늘리면 그 확장이 별도 히스토리가 되어 Ctrl+Z로 지워지지 않음)
      const fontPx = Math.max(8, Math.round(FONT / zoom));
      const fontFamily = withLastFont({ data: { shape: 'text' } } as AppNode).data.fontFamily;   // 마지막으로 고른 글꼴
      const height = Math.ceil(measureTextBoxHeight({ title: text, textAlignTop: true, fontFamily }, w, fontPx));

      quickPush();
      justFlushed.current = true;
      const newNode: AppNode = {
        id:       `node-${Date.now()}`,
        type:     'custom',
        position,
        width:    w,
        height,
        zIndex:   0,
        selected: true,
        data: {
          title: text, subtitle: '', icon: '', type: 'service', status: 'none', shape: 'text',
          width: w, height,
          bgColor: 'transparent', strokeColor: 'transparent', fontWeight: 'normal' as const,
          fontScale: fontPx / height,
          ...(fontFamily ? { fontFamily } : {}),
          textAlignTop: true,
        },
      };
      setNodes((prev) => [...prev.map((n) => ({ ...n, selected: false })), newNode]);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('copy', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [undo, redo, quickPush, setNodes, setEdges]);

  // ── 드래그-투-크리에이트 상태 ────────────────────────────────
  const [drawing, setDrawing] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [freehandPoints, setFreehandPoints] = useState<[number, number][]>([]);
  const isFreehandActive = useRef(false);
  // 캔버스 밖에서 마우스를 떼어도 즉시 중단
  useEffect(() => {
    const onGlobalUp = () => { isFreehandActive.current = false; };
    window.addEventListener('mouseup', onGlobalUp);
    return () => window.removeEventListener('mouseup', onGlobalUp);
  }, []);
  const viewportRef    = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const containerRef   = useRef<HTMLDivElement>(null);
  // 캔버스 위 마지막 마우스 위치 (이미지 붙여넣기 위치용, 캔버스 밖이면 null)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const rfInstanceRef  = useRef<ReactFlowInstance<AppNode> | null>(null);

  // 스크린 좌표 → Flow 좌표 변환
  const toFlow = useCallback((cx: number, cy: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    const { x, y, zoom } = viewportRef.current;
    return { x: (cx - rect.left - x) / zoom, y: (cy - rect.top - y) / zoom };
  }, []);

  // ── 정렬 가이드라인 상태 ──────────────────────────────────
  const [helperLines, setHelperLines] = useState<HelperLines>({});

  const showMiniMap    = useCanvasStore((s) => s.showMiniMap);
  const edgeLineType   = useCanvasStore((s) => s.edgeLineType);
  const edgeStyle      = useCanvasStore((s) => s.edgeStyle);
  const currentTool    = useCanvasStore((s) => s.currentTool);
  const setCurrentTool = useCanvasStore((s) => s.setCurrentTool);
  const snapGuides     = useCanvasStore((s) => s.snapGuides);
  const wheelPan       = useCanvasStore((s) => s.wheelPan);
  const connectLabeled = useCanvasStore((s) => s.connectLabeled);
  const pendingNodes   = useCanvasStore((s) => s.pendingNodes);
  const pendingEdges   = useCanvasStore((s) => s.pendingEdges);
  const clearPending   = useCanvasStore((s) => s.clearPending);
  const drawTool       = useCanvasStore((s) => s.drawTool);
  const setDrawTool    = useCanvasStore((s) => s.setDrawTool);
  const isLocked       = useCanvasStore((s) => s.isLocked);
  const clearSelectedDocElement  = useCanvasStore((s) => s.clearSelectedDocElement);

  // AI가 추가 요청한 노드/엣지를 캔버스에 반영 — 빈 자리를 찾아 놓고, 차례로 떠오르게 연출
  useEffect(() => {
    if (pendingNodes.length === 0) return;

    const ordered = placeFramesFirst([...pendingNodes]);
    const edgesToAdd = [...pendingEdges];
    clearPending();
    const existingNodes = nodes;
    const existingBounds = getNodesBounds(existingNodes);
    const clusterBounds = getNodesBounds(ordered);
    const viewport = viewportRef.current;
    const container = containerRef.current?.getBoundingClientRect();
    const center = container
      ? {
          x: (container.width / 2 - viewport.x) / viewport.zoom,
          y: (container.height / 2 - viewport.y) / viewport.zoom,
        }
      : { x: 0, y: 0 };
    // AI 결과물(PRD·화면·ERD 등)은 종류별 줄로 — 그 밖은 기존 묶음 오른쪽 (utils/aiRows)
    const row = clusterRow(ordered);
    const rowSpot = row ? rowTopLeft(existingNodes, row) : null;
    const preferredTopLeft = rowSpot ?? (existingBounds
      ? {
          x: existingBounds.x + existingBounds.w + 96,
          y: center.y - (clusterBounds?.h ?? 0) / 2,
        }
      : {
          x: center.x - (clusterBounds?.w ?? 0) / 2,
          y: center.y - (clusterBounds?.h ?? 0) / 2,
        });
    const placedNodes = placeNodeCluster(ordered, existingNodes, preferredTopLeft, {
      padding: 40,
      step: 80,
      maxRings: 18,
    });

    // 한 번에 넣고(실행취소 한 번), 보이는 순서만 늦춤 — 바깥 묶음 → 화면·카드 하나씩 → 안 요소 → 연결선
    //   (utils/appearAnimation: 노드 데이터는 건드리지 않고 연출 동안만 스타일을 붙임)
    setNodes(prev => [...prev, ...placedNodes]);
    setEdges(prev => [...prev, ...edgesToAdd]);
    playAppear(placedNodes, edgesToAdd);

    // 카메라 먼저 — 요소가 나타나는 걸 볼 수 있게
    //   요약 다이어그램·와이어프레임·ERD 프레임은 늘 그 프레임이 다 보이게,
    //   그 밖의 요소는 지금 화면 밖에 생길 때만 그쪽으로 (이미 보이면 화면을 움직이지 않음)
    const focusFrames = placedNodes.filter(n =>
      n.id.startsWith('summary-frame-') || (/^(wireframe|erd|prd|api|stack|flow|arch)-/.test(n.id) && n.data.shape === 'frame'));
    const tops = placedNodes.filter(n => !n.parentId);
    const placedBounds = getNodesBounds(tops);
    const visible = !!placedBounds && !!container
      && placedBounds.x >= -viewport.x / viewport.zoom
      && placedBounds.y >= -viewport.y / viewport.zoom
      && placedBounds.x + placedBounds.w <= (container.width - viewport.x) / viewport.zoom
      && placedBounds.y + placedBounds.h <= (container.height - viewport.y) / viewport.zoom;
    // fitView({nodes})는 방금 넣은 노드의 크기를 React Flow가 아직 재지 못해 아무 일도 안 할 때가 있음
    //   → 이미 아는 자리·크기(placedBounds)로 카메라를 직접 옮김
    if (placedBounds && container && (focusFrames.length || !visible)) {
      const pad = 0.15;
      const zoom = Math.max(0.1, Math.min(1,
        container.width / (placedBounds.w * (1 + pad * 2)),
        container.height / (placedBounds.h * (1 + pad * 2))));
      const x = container.width / 2 - (placedBounds.x + placedBounds.w / 2) * zoom;
      const y = container.height / 2 - (placedBounds.y + placedBounds.h / 2) * zoom;
      setTimeout(() => { rfInstanceRef.current?.setViewport({ x, y, zoom }, { duration: 500 }); }, 30);
    }

  // placeFramesFirst는 render-scope 함수라 deps에서 제외
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNodes, pendingEdges, clearPending, nodes, setNodes, setEdges]);

  const isConnectMode = currentTool === 'connect';

  const hasNodes = initialNodes.length > 0;

  // 초기 렌더 후 fitView (노드가 있을 때만)
  const onInit = useCallback((instance: ReactFlowInstance<AppNode>) => {
    rfInstanceRef.current = instance;
    if (initialNodes.length === 0) return;
    setTimeout(() => instance.fitView({ padding: 2.5, maxZoom: _FIT_VIEW_OPTIONS.maxZoom }), 80);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 드래그-투-크리에이트: 노드 생성 ──────────────────────────
  const addDraggedNode = useCallback((fx0: number, fy0: number, fx1: number, fy1: number) => {
    if (!drawTool || drawTool === 'freehand') return;  // freehand는 별도 경로에서 처리
    quickPush();      // 생성 전 스냅샷 저장
    justFlushed.current = true; // 이후 useEffect에서 lastCommitted 갱신

    // ── 자유 화살표: 양 끝에 anchor 노드를 두고 그 사이를 엣지로 연결 ──
    if (drawTool === 'arrow') {
      const DEFAULT_EDGE_COLOR = '#111827';
      // 끝점이 기존 노드 위에 있으면 그 노드를 source/target으로 스냅
      // 프레임·문서 컨테이너는 안에 그리는 영역이라 제외, 겹치면 가장 작은(안쪽) 노드
      const sizeOf = (n: AppNode) => ({
        w: (n.data.width  as number | undefined) ?? n.width  ?? 100,
        h: (n.data.height as number | undefined) ?? n.height ?? 100,
      });
      const nodeAt = (px: number, py: number) => nodes
        .filter((n) => {
          if (n.data.shape === 'anchor' || n.data.shape === 'frame' || n.data.isDocContainer) return false;
          // 프레임에 자식이면 절대좌표가 아님 — 화살표 스냅에서는 제외 (간단화)
          if (n.parentId) return false;
          const { w, h } = sizeOf(n);
          return px >= n.position.x && px <= n.position.x + w
              && py >= n.position.y && py <= n.position.y + h;
        })
        .sort((a, b) => sizeOf(a).w * sizeOf(a).h - sizeOf(b).w * sizeOf(b).h)[0];
      // 끝점과 가장 가까운 변의 핸들 — 지정 안 하면 React Flow가 첫 핸들(위쪽)에 붙임
      const nearestSide = (n: AppNode, px: number, py: number) => {
        const { w, h } = sizeOf(n);
        const d = {
          top:    py - n.position.y,
          bottom: n.position.y + h - py,
          left:   px - n.position.x,
          right:  n.position.x + w - px,
        };
        return (Object.keys(d) as (keyof typeof d)[]).reduce((a, b) => (d[b] < d[a] ? b : a));
      };
      const ts = Date.now();
      const srcSnap = nodeAt(fx0, fy0);
      const tgtSnap = nodeAt(fx1, fy1);
      const newNodes: AppNode[] = [];
      let sourceId: string;
      let targetId: string;
      if (srcSnap) {
        sourceId = srcSnap.id;
      } else {
        sourceId = `anchor-${ts}-s`;
        newNodes.push({
          id: sourceId, type: 'custom',
          position: { x: fx0 - 4, y: fy0 - 4 },
          width: 8, height: 8, zIndex: 100,
          data: { title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'anchor', width: 8, height: 8 },
        });
      }
      if (tgtSnap) {
        targetId = tgtSnap.id;
      } else {
        targetId = `anchor-${ts}-t`;
        newNodes.push({
          id: targetId, type: 'custom',
          position: { x: fx1 - 4, y: fy1 - 4 },
          width: 8, height: 8, zIndex: 100,
          data: { title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'anchor', width: 8, height: 8 },
        });
      }
      // 자유 화살표는 스냅 여부와 무관하게 Excalidraw 스타일(중앙 핸들) — 모양은 메뉴에서 고른 꺾은선/곡선
      const edgeType = 'free-arrow';
      const newEdge: AppEdge = {
        id: `edge-${ts}`,
        source: sourceId,
        target: targetId,
        sourceHandle: srcSnap ? nearestSide(srcSnap, fx0, fy0) : 'c',
        targetHandle: tgtSnap ? nearestSide(tgtSnap, fx1, fy1) : 'ct',
        type: edgeType,
        label: undefined,
        style: {
          strokeWidth: 1.5,
          strokeDasharray: edgeStyle === 'dashed' ? '5 4' : undefined,
          stroke: DEFAULT_EDGE_COLOR,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: DEFAULT_EDGE_COLOR },
        data: { arrowType: 'end', strokeColor: DEFAULT_EDGE_COLOR, freeLineType: edgeLineType === 'default' ? 'default' : edgeLineType === 'straight' ? 'straight' : 'step' },
      };
      if (newNodes.length > 0) setNodes((prev) => [...prev, ...newNodes]);
      setEdges((prev) => [...prev, newEdge]);
      setDrawTool(null);
      setCurrentTool('select');   // connect 모드 해제 → 선 클릭으로 엣지 선택 가능
      return;
    }

    const sz = SHAPE_DEFAULTS[drawTool] ?? SHAPE_DEFAULTS.rectangle;
    const x = Math.min(fx0, fx1);
    const y = Math.min(fy0, fy1);
    const w = Math.max(Math.abs(fx1 - fx0), sz.minW);
    const h = Math.max(Math.abs(fy1 - fy0), sz.minH);
    const isTransparent = drawTool === 'rectangle' || drawTool === 'circle';
    const isFrame       = drawTool === 'frame';
    const isText        = drawTool === 'text';
    const isTable       = drawTool === 'table';
    const newNode: AppNode = {
      id:       `node-${Date.now()}`,
      type:     'custom',
      position: { x, y },
      width:    w,
      height:   h,
      zIndex:   isFrame ? -Math.ceil(w * h / 100) : 0,   // 프레임 외에는 생성 순서대로 위에 쌓임
      data: {
        title:    isText ? tr('텍스트', 'Text') : isFrame ? 'Frame' : isTransparent || isTable ? '' : tr('새 노드', 'New node'),
        subtitle: '', icon: '', type: 'service', status: 'none', shape: drawTool,
        width: w, height: h,
        ...(isTransparent ? { bgColor: 'transparent', strokeColor: 'var(--canvas-ink)' } : {}),   // 윤곽선 기본 = 캔버스 잉크색 (라이트 검정·다크 흰색)
        ...(isText        ? { bgColor: 'transparent', strokeColor: 'transparent', fontScale: 0.27, fontWeight: 'normal' as const } : {}),
        ...(isTable       ? {
          bgColor: 'transparent', strokeColor: 'var(--canvas-ink)', fontColor: 'var(--canvas-ink)',
          tableRows: 3, tableCols: 3, tableHeaderRow: false,
          tableCells: Array.from({ length: 3 }, () => Array(3).fill('')),
        } : {}),
      },
    };
    setNodes((prev) => {
      if (!isFrame) return [...prev, withLastFont(newNode)];   // 마지막으로 고른 글꼴 적용

      // 프레임 생성 시: 범위 안에 있는 기존 노드들의 parentId를 새 프레임으로 설정
      // position을 절대좌표 → 프레임 기준 상대좌표로 변환
      // 다른 프레임은 통째로 들어와야 품음 → 바깥 프레임이 '섹션'이 됨
      const updated = prev.map((n) => {
        if (n.parentId || isDocNode(n)) return n; // 이미 자식인 노드·문서 템플릿 제외
        const { w: nW, h: nH } = sizeOf(n);
        const cx = n.position.x + nW / 2;
        const cy = n.position.y + nH / 2;
        const fits = n.data.shape === 'frame'
          ? n.position.x >= x && n.position.y >= y && n.position.x + nW <= x + w && n.position.y + nH <= y + h
          : cx > x && cx < x + w && cy > y && cy < y + h;
        if (fits) {
          return {
            ...n,
            parentId: newNode.id,
            position: { x: n.position.x - x, y: n.position.y - y },
          };
        }
        return n;
      });
      return placeFramesFirst([...updated, newNode]);
    });
    setDrawTool(null);
  // placeFramesFirst는 render-scope 함수라 deps에서 제외
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawTool, setNodes, setDrawTool, setEdges, nodes, connectLabeled, edgeLineType, edgeStyle, setCurrentTool]);

  // ── 스냅 계산 헬퍼 ────────────────────────────────────────────
  // dragged 노드의 position 기준으로 allNodes와 정렬 비교
  // → 스냅 위치(snapX/snapY)와 가이드라인 범위(hLine/vLine) 반환
  const computeSnap = (dragged: AppNode, allNodes: AppNode[]) => {
    const THRESHOLD = 8;
    const dW = dragged.width  ?? (dragged.data.width  as number | undefined) ?? 120;
    const dH = dragged.height ?? (dragged.data.height as number | undefined) ?? 60;
    const dLeft   = dragged.position.x;
    const dRight  = dLeft  + dW;
    const dCX     = dLeft  + dW / 2;
    const dTop    = dragged.position.y;
    const dBottom = dTop   + dH;
    const dCY     = dTop   + dH / 2;

    let snapX: number | undefined;
    let snapY: number | undefined;
    let hLine: HelperLineH | undefined;
    let vLine: HelperLineV | undefined;

    for (const other of allNodes) {
      if (other.id === dragged.id || other.data.shape === 'frame') continue;
      const oW = other.width  ?? (other.data.width  as number | undefined) ?? 120;
      const oH = other.height ?? (other.data.height as number | undefined) ?? 60;
      const oLeft   = other.position.x;
      const oRight  = oLeft + oW;
      const oCX     = oLeft + oW / 2;
      const oTop    = other.position.y;
      const oBottom = oTop  + oH;
      const oCY     = oTop  + oH / 2;

      // 수직 가이드선 (x 정렬)
      if (!vLine) {
        let toX: number | undefined;
        let gX:  number | undefined;
        if      (Math.abs(dLeft  - oLeft)  < THRESHOLD) { toX = oLeft;       gX = oLeft;  }
        else if (Math.abs(dRight - oRight) < THRESHOLD) { toX = oRight - dW; gX = oRight; }
        else if (Math.abs(dCX   - oCX)    < THRESHOLD) { toX = oCX - dW/2;  gX = oCX;   }
        else if (Math.abs(dLeft  - oRight) < THRESHOLD) { toX = oRight;      gX = oRight; }
        else if (Math.abs(dRight - oLeft)  < THRESHOLD) { toX = oLeft - dW;  gX = oLeft;  }
        if (toX !== undefined && gX !== undefined) {
          snapX = toX;
          vLine = { x: gX, y1: Math.min(dTop, oTop) - 12, y2: Math.max(dBottom, oBottom) + 12 };
        }
      }

      // 수평 가이드선 (y 정렬)
      if (!hLine) {
        let toY: number | undefined;
        let gY:  number | undefined;
        if      (Math.abs(dTop    - oTop)    < THRESHOLD) { toY = oTop;        gY = oTop;    }
        else if (Math.abs(dBottom - oBottom) < THRESHOLD) { toY = oBottom - dH; gY = oBottom; }
        else if (Math.abs(dCY    - oCY)     < THRESHOLD) { toY = oCY - dH/2;  gY = oCY;    }
        else if (Math.abs(dTop    - oBottom) < THRESHOLD) { toY = oBottom;      gY = oBottom; }
        else if (Math.abs(dBottom - oTop)    < THRESHOLD) { toY = oTop - dH;    gY = oTop;    }
        if (toY !== undefined && gY !== undefined) {
          snapY = toY;
          hLine = { y: gY, x1: Math.min(dLeft, oLeft) - 12, x2: Math.max(dRight, oRight) + 12 };
        }
      }

      if (vLine && hLine) break;
    }

    return { snapX, snapY, hLine, vLine };
  };

  // 노드 드래그 시작 — 이동 전 상태를 히스토리에 저장
  // 끌기 시작한 자리 — 화면 프레임을 목업에 넣은 뒤 제자리로 돌려놓을 때 씀
  const dragStartPos = useRef<{ id: string; x: number; y: number } | null>(null);
  const onNodeDragStart = useCallback((_: MouseEvent | TouchEvent, node: AppNode) => {
    dragStartPos.current = { id: node.id, x: node.position.x, y: node.position.y };
    if (!isDraggingOrResizing.current) {
      quickPush();
      isDraggingOrResizing.current = true;
    }
  }, [quickPush]);

  // ── 드래그 중: 가이드라인만 표시 (setNodes 호출 없음 — RF 내부 드래그와 충돌 방지) ──
  // 사진·화면 프레임을 끌어 놓을 때 들어갈 목업·이미지 칸 찾기 (끄는 중 강조 · 놓을 때 넣기에 같이 씀)
  //   마우스가 칸 안이면 그 칸 / 목업은 많이(40% 이상) 걸쳐도 / 화면 프레임은 목업에만 — 하나만 끌 때만
  const findImageDropTarget = useCallback((draggedNode: AppNode, clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const isPhoto = draggedNode.data.shape === 'image' && !!draggedNode.data.imageUrl;
    const isScreen = draggedNode.data.shape === 'frame' && !isDocNode(draggedNode);
    if (!(isPhoto || isScreen) || !rect || nodesRef.current.filter((n) => n.selected).length > 1) return null;
    const { x: vx, y: vy, zoom } = viewportRef.current;
    const px = (clientX - rect.left - vx) / zoom;
    const py = (clientY - rect.top  - vy) / zoom;
    const all = nodesRef.current;
    const ip = absPosOf(draggedNode, all);
    const { w: iw, h: ih } = sizeOf(draggedNode);
    const target = all.filter((n) => {
      if (n.id === draggedNode.id) return false;
      if (isScreen ? n.data.shape !== 'mockup' : !acceptsImage(n.data)) return false;
      const pos = absPosOf(n, all);
      const { w, h } = sizeOf(n, 260, 539);
      if (px >= pos.x && px <= pos.x + w && py >= pos.y && py <= pos.y + h) return true;
      // 많이 걸쳐도 넣는 건 목업만 — 작은 이미지 칸은 마우스를 칸 안에 놓았을 때만 (사진이 실수로 빨려 들어가지 않게)
      if (n.data.shape !== 'mockup') return false;
      const ox = Math.min(ip.x + iw, pos.x + w) - Math.max(ip.x, pos.x);
      const oy = Math.min(ip.y + ih, pos.y + h) - Math.max(ip.y, pos.y);
      return ox > 0 && oy > 0 && ox * oy >= Math.min(iw * ih, w * h) * 0.4;
    }).sort((a, b) => (b.zIndex ?? 0) - (a.zIndex ?? 0))[0];
    return target ? { target, isPhoto, isScreen } : null;
  }, []);

  // ── AI가 그린 아이폰 목업 채우기 — data.mockupFrom 화면이 그려지고 사진이 뜬 뒤 찍어서 넣음 (끌어 놓기와 같은 방법) ──
  const mockupFilling = useRef(new Set<string>());
  useEffect(() => {
    const pending = nodes.filter((n) => n.data.shape === 'mockup' && n.data.mockupFrom && !mockupFilling.current.has(n.id));
    pending.forEach((mock) => {
      mockupFilling.current.add(mock.id);
      setMockupBusy(mock.id);
      const fromId = mock.data.mockupFrom as string;
      setTimeout(async () => {
        try {
          const all = nodesRef.current;
          const frame = all.find((n) => n.id === fromId);
          if (!frame) throw new Error('screen not found');
          const ids = new Set<string>([frame.id]);
          for (let grew = true; grew;) {
            grew = false;
            all.forEach((n) => { if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; } });
          }
          const fp = absPosOf(frame, all);
          const { w: fw, h: fh } = sizeOf(frame, 390, 844);
          const blob = await captureNodesImage({ x: fp.x, y: fp.y, width: fw, height: fh }, ids);
          if (!blob) throw new Error('capture failed');
          const img = await prepareCanvasImage(blob);
          setNodes((prev) => (prev as AppNode[]).map((n) => (n.id === mock.id
            ? { ...n, data: { ...n.data, imageUrl: img.src, mockupFrom: undefined } }
            : n)));
        } catch (err) {
          console.error(err);
          setNodes((prev) => (prev as AppNode[]).map((n) => (n.id === mock.id ? { ...n, data: { ...n.data, mockupFrom: undefined } } : n)));
        } finally {
          setMockupBusy(null);
          mockupFilling.current.delete(mock.id);
        }
      }, 2500);   // 화면 요소·사진이 다 그려질 때까지 잠깐 기다림
    });
  }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const onNodeDrag = useCallback((ev: MouseEvent, draggedNode: AppNode) => {
    // 놓으면 들어갈 목업·이미지 칸을 강조
    const hit = findImageDropTarget(draggedNode, ev.clientX, ev.clientY);
    if (hit) {
      // 끄는 요소와 (프레임이면) 그 안의 요소를 흐리게 — 처음 잡혔을 때만 계산
      const dim = new Set<string>([draggedNode.id]);
      if (hit.isScreen) {
        for (let grew = true; grew;) {
          grew = false;
          nodesRef.current.forEach((n) => { if (n.parentId && dim.has(n.parentId) && !dim.has(n.id)) { dim.add(n.id); grew = true; } });
        }
      }
      setImageDropTarget(hit.target.id, dim);
    } else setImageDropTarget(null);
    if (!snapGuides) {
      setHelperLines({});
      return;
    }
    // nodesRef.current 사용 → nodes가 바뀔 때마다 콜백이 재생성되는 것을 방지
    const { hLine, vLine } = computeSnap(draggedNode, nodesRef.current);
    setHelperLines({ h: hLine, v: vLine });
  }, [snapGuides]); // eslint-disable-line react-hooks/exhaustive-deps

  // 드래그 완료 시 ① 스냅 확정 ② 프레임 ↔ 자식 parentId 연결/해제
  const onNodeDragStop = useCallback((ev: MouseEvent | TouchEvent, draggedNode: AppNode) => {
    isDraggingOrResizing.current = false;
    justFlushed.current = true; // useEffect에서 lastCommitted를 최종 위치로 갱신
    setHelperLines({});
    setImageDropTarget(null);   // 끄는 동안 보이던 목업·이미지 칸 강조 끄기

    // ── A4 페이지 자석 스냅백 ─────────────────────────────────
    // 원래 자리(docRow/docCol 기반) 근처에 놓으면 자동으로 제자리로 귀환
    if (draggedNode.data?.isDocPage && draggedNode.parentId) {
      const docRow = (draggedNode.data.docRow as number | undefined) ?? 0;
      const docCol = (draggedNode.data.docCol as number | undefined) ?? 0;
      const orientation = (draggedNode.data.docOrientation as string | undefined) ?? 'portrait';
      const pageW = orientation === 'landscape' ? DOC_A4_H : DOC_A4_W;
      const pageH = orientation === 'landscape' ? DOC_A4_W : DOC_A4_H;
      const originalX = DOC_PADDING + docCol * (pageW + DOC_PAGE_GAP);
      const originalY = DOC_PADDING + docRow * (pageH + DOC_PAGE_GAP);
      const dx = Math.abs(draggedNode.position.x - originalX);
      const dy = Math.abs(draggedNode.position.y - originalY);
      const SNAP_THRESHOLD = 150; // 150px 이내면 제자리로 복귀
      if (dx < SNAP_THRESHOLD && dy < SNAP_THRESHOLD) {
        setNodes((prev) => (prev as AppNode[]).map((n) =>
          n.id === draggedNode.id
            ? { ...n, position: { x: originalX, y: originalY } }
            : n,
        ));
        return;
      }
    }

    // ── 사진·화면 프레임을 기기 목업 위에 놓으면 그 화면에 끼워 넣음 ──
    //   사진: 사진 노드는 사라짐 / 화면 프레임: 프레임을 사진으로 찍어 넣고, 프레임은 제자리로 (계속 고칠 수 있게)
    // 마우스를 놓은 지점이 목업 안이거나 많이 걸쳤을 때 — 하나만 끌었을 때
    const pt = 'changedTouches' in ev ? ev.changedTouches[0] : ev;   // 터치면 손을 뗀 지점
    const drop = findImageDropTarget(draggedNode, pt.clientX, pt.clientY);
    if (drop) {
      const { target, isScreen } = drop;
      const all = nodesRef.current;
      if (isScreen) {
        // 프레임과 그 안의 요소만 찍음 — 프레임은 먼저 제자리로 돌려놓고, 화면에 그려진 다음 찍기
        const ids = new Set<string>([draggedNode.id]);
        for (let grew = true; grew;) {
          grew = false;
          all.forEach((n) => { if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) { ids.add(n.id); grew = true; } });
        }
        const start = dragStartPos.current?.id === draggedNode.id ? dragStartPos.current : null;
        if (start) {
          setNodes((prev) => (prev as AppNode[]).map((n) => (n.id === draggedNode.id ? { ...n, position: { x: start.x, y: start.y } } : n)));
        }
        const { w: fw, h: fh } = sizeOf(draggedNode, 400, 300);
        setMockupBusy(target.id);
        requestAnimationFrame(() => requestAnimationFrame(async () => {
          try {
            const fp = absPosOf(nodesRef.current.find((n) => n.id === draggedNode.id) ?? draggedNode, nodesRef.current);
            const blob = await captureNodesImage({ x: fp.x, y: fp.y, width: fw, height: fh }, ids);
            if (!blob) throw new Error('capture failed');
            const img = await prepareCanvasImage(blob);
            setNodes((prev) => (prev as AppNode[]).map((n) => (n.id === target.id
              ? { ...n, data: { ...n.data, imageUrl: img.src, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined } }
              : n)));
          } catch (err) {
            console.error(err);
            alert(tr('화면을 목업에 넣지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Could not put the screen into the mockup. Please try again in a moment.'));
          } finally {
            setMockupBusy(null);
          }
        }));
        return;
      }
      if (target) {
        const imageUrl = draggedNode.data.imageUrl;
        setNodes((prev) => (prev as AppNode[])
          .filter((n) => n.id !== draggedNode.id)
          .map((n) => n.id === target.id
            ? { ...n, selected: true, data: { ...n.data, imageUrl, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined } }
            : n));
        setEdges((prev) => prev.filter((e) => e.source !== draggedNode.id && e.target !== draggedNode.id));
        return;
      }
    }

    if (draggedNode.data.shape === 'frame') {
      setNodes((prev) => {
        const all = prev as AppNode[];
        const me  = all.find((n) => n.id === draggedNode.id) ?? draggedNode;
        const { w: frameW, h: frameH } = sizeOf(me, 400, 300);
        const { x: fx, y: fy } = absPosOf(me, all);   // 캔버스 기준 위치 (섹션 안이면 섹션 위치까지 더함)
        const area = frameW * frameH;

        // 이 프레임의 자손 — 자기 안에 든 프레임 속으로 들어갈 수는 없음
        const descendants = new Set<string>([me.id]);
        for (let grew = true; grew;) {
          grew = false;
          all.forEach((n) => {
            if (n.parentId && descendants.has(n.parentId) && !descendants.has(n.id)) { descendants.add(n.id); grew = true; }
          });
        }

        // ① 다른 프레임 안에 통째로 들어갔으면 그 프레임(섹션)의 자식으로, 벗어났으면 꺼냄
        //    여러 겹이면 가장 안쪽(가장 작은) 프레임
        let parentId = me.parentId;
        const parentIsFrame = !me.parentId || all.some((n) => n.id === me.parentId && n.data.shape === 'frame');
        if (!isDocNode(me) && parentIsFrame) {
          const target = all
            .filter((f) => f.data.shape === 'frame' && !descendants.has(f.id) && !isDocNode(f))
            .map((f) => ({ f, pos: absPosOf(f, all), size: sizeOf(f, 400, 300) }))
            .filter(({ pos, size }) =>
              size.w * size.h > area &&
              fx >= pos.x && fy >= pos.y && fx + frameW <= pos.x + size.w && fy + frameH <= pos.y + size.h)
            .sort((a, b) => a.size.w * a.size.h - b.size.w * b.size.h)[0];
          parentId = target?.f.id;
        }

        // ② 범위 안의 노드를 이 프레임의 자식으로 — 같은 층(맨 바깥 또는 같은 섹션)에 있던 것만
        //    다른 프레임은 통째로 들어와야 품음
        const layer = new Set([undefined, me.parentId, parentId]);
        let dirty = parentId !== me.parentId;
        const result = all.map((n) => {
          if (n.id === me.id) {
            if (parentId === me.parentId) return n;
            const base = parentId ? absPosOf(all.find((m) => m.id === parentId)!, all) : { x: 0, y: 0 };
            return { ...n, parentId, position: { x: fx - base.x, y: fy - base.y } };
          }
          if (!layer.has(n.parentId) || descendants.has(n.id) || isDocNode(n) || n.id === parentId) return n;
          if (n.parentId && !all.some((m) => m.id === n.parentId && m.data.shape === 'frame')) return n;
          const { w: nW, h: nH } = sizeOf(n);
          const pos = absPosOf(n, all);
          const fits = n.data.shape === 'frame'
            ? nW * nH < area && pos.x >= fx && pos.y >= fy && pos.x + nW <= fx + frameW && pos.y + nH <= fy + frameH
            : pos.x + nW / 2 > fx && pos.x + nW / 2 < fx + frameW && pos.y + nH / 2 > fy && pos.y + nH / 2 < fy + frameH;
          if (fits) {
            dirty = true;
            return { ...n, parentId: me.id, position: { x: pos.x - fx, y: pos.y - fy } };
          }
          return n;
        });
        if (!dirty) return prev;
        return placeFramesFirst(result as AppNode[]);
      });
      return;
    }

    // 일반 노드: ① 스냅 확정 ② 프레임 parentId 업데이트 — 한 번의 setNodes로 처리
    setNodes((prev) => {
      const all = prev as AppNode[];

      // ① 스냅 최종 적용 (드래그 중엔 가이드라인만 보여줬으므로 여기서 위치 확정)
      let finalX = draggedNode.position.x;
      let finalY = draggedNode.position.y;
      if (snapGuides) {
        const snappedNode = { ...draggedNode, position: { x: finalX, y: finalY } };
        const { snapX, snapY } = computeSnap(snappedNode, all);
        if (snapX !== undefined) finalX = snapX;
        if (snapY !== undefined) finalY = snapY;
      }

      // ② 프레임 편입/해제 — 스냅된 위치(finalX/Y) 기준으로 절대좌표 계산
      let absX = finalX;
      let absY = finalY;
      if (draggedNode.parentId) {
        const par = all.find((n) => n.id === draggedNode.parentId);
        if (par) { const p = absPosOf(par, all); absX = p.x + absX; absY = p.y + absY; }
      }

      const { w: nW, h: nH } = sizeOf(draggedNode);
      const cx = absX + nW / 2;
      const cy = absY + nH / 2;

      // 가운데가 들어간 프레임 중 가장 안쪽(가장 작은) 것 — 섹션 안의 슬라이드에 놓으면 슬라이드로
      const target = all
        .filter((n) => n.data.shape === 'frame')
        .map((f) => ({ f, pos: absPosOf(f, all), size: sizeOf(f, 400, 300) }))
        .filter(({ pos, size }) => cx > pos.x && cx < pos.x + size.w && cy > pos.y && cy < pos.y + size.h)
        .sort((a, b) => a.size.w * a.size.h - b.size.w * b.size.h)[0];
      const targetFrame = target?.f;

      if (target && targetFrame && draggedNode.parentId !== targetFrame.id) {
        const updated = all.map((n) => n.id === draggedNode.id ? {
          ...n,
          parentId: targetFrame.id,
          position: { x: absX - target.pos.x, y: absY - target.pos.y },
        } : n);
        return placeFramesFirst(updated as AppNode[]);
      }

      if (!targetFrame && draggedNode.parentId) {
        const wasInFrame = all.some((n) => n.id === draggedNode.parentId && n.data.shape === 'frame');
        if (wasInFrame) {
          return all.map((n) => n.id === draggedNode.id
            ? { ...n, parentId: undefined, position: { x: absX, y: absY } }
            : n);
        }
      }

      // 스냅만 적용 (프레임 이동 없음)
      if (finalX !== draggedNode.position.x || finalY !== draggedNode.position.y) {
        return all.map((n) => n.id === draggedNode.id
          ? { ...n, position: { x: finalX, y: finalY } }
          : n);
      }

      return prev;
    });
  }, [setNodes, snapGuides]);

  const DEFAULT_EDGE_COLOR = '#111827';

  // onCanvasChange를 ref로 안정화 — 부모 콜백 변경/노드·엣지 변경마다 콜백 재생성 방지
  const onCanvasChangeRef = useRef(onCanvasChange);
  onCanvasChangeRef.current = onCanvasChange;

  // 자동 저장 예약 — 변경 이벤트에서는 표시만 하고, 실제 저장은 React가 새 노드·엣지를 그린 뒤에 함
  // (변경 직후 바로 읽으면 아직 갱신 전 목록이라 마지막 변경 — 삭제·이동·크기 조절 — 이 빠진 채 저장됐음)
  const pendingSave = useRef(false);
  useEffect(() => {
    if (!pendingSave.current) return;
    pendingSave.current = false;
    onCanvasChangeRef.current(nodes, edges);
  }, [nodes, edges]);

  // 자유 화살표를 지우면 양 끝 앵커가 보이지 않게 남음 — 연결선 도구에서 연결 대상이 되어
  // 새 화살표가 엉뚱한 곳에 붙으므로, 이어진 엣지가 없는 앵커는 지움
  useEffect(() => {
    const used = new Set(edges.flatMap((e) => [e.source, e.target]));
    const orphan = nodes.some((n) => n.data.shape === 'anchor' && !used.has(n.id));
    if (!orphan) return;
    pendingSave.current = true;
    setNodes((prev) => prev.filter((n) => n.data.shape !== 'anchor' || used.has(n.id)));
  }, [nodes, edges, setNodes]);

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      quickPush();
      justFlushed.current = true;
      // DB 테이블 컬럼끼리 → 관계선. 방향은 "참조하는 컬럼 → 참조되는 컬럼"
      //   한쪽만 대표 번호(PK)면 그쪽이 참조되는 쪽 (어느 쪽에서 끌었든). 참조하는 컬럼의 타입은 가리키는 컬럼에 맞춤
      const sCol = colIdOfHandle(connection.sourceHandle), tCol = colIdOfHandle(connection.targetHandle);
      if (sCol && tCol) {
        const colOf = (nodeId: string, colId: string) => nodesRef.current.find((n) => n.id === nodeId)?.data.columns?.find((c) => c.id === colId);
        let from = { node: connection.source, col: sCol }, to = { node: connection.target, col: tCol };
        if (colOf(from.node, from.col)?.pk && !colOf(to.node, to.col)?.pk) [from, to] = [to, from];
        const refType = colOf(to.node, to.col)?.type;
        if (from.node === to.node && from.col === to.col) return;
        if (refType) {
          setNodes((nds) => nds.map((n) => (n.id === from.node
            ? { ...n, data: { ...n.data, columns: n.data.columns?.map((c) => (c.id === from.col ? { ...c, type: refType } : c)) } }
            : n)));
        }
        setEdges((eds) => {
          // 한 컬럼은 한 곳만 가리킴 — 같은 컬럼에서 나가던 선은 바꿔 끼움
          const kept = (eds as AppEdge[]).filter((e) => !(e.type === 'erd' && e.source === from.node && colIdOfHandle(e.sourceHandle) === from.col));
          const next = [...kept, erdEdge(`e-${Date.now()}`, from.node, from.col, to.node, to.col)];
          onCanvasChangeRef.current(nodesRef.current, next);
          return next;
        });
        setCurrentTool('select');
        return;
      }
      // 도형 변(상하좌우) 핸들끼리면 자유 화살표로 — 연결한 변에서 나가고 테두리에 딱 붙음 (PPT 연결선처럼)
      // 표 행 핸들 등 다른 핸들은 원래 연결선 그대로
      const isSide = (h?: string | null) => !h || ['top', 'right', 'bottom', 'left'].includes(h);
      const asFree = !connectLabeled && isSide(connection.sourceHandle) && isSide(connection.targetHandle);
      setEdges((eds) => {
        const edgeParams: AppEdge = {
          ...connection,
          id: `e-${Date.now()}`,
          type: connectLabeled ? 'labeled' : asFree ? 'free-arrow' : edgeLineType,
          label: connectLabeled ? '' : undefined,
          animated: false,
          style: {
            strokeDasharray: edgeStyle === 'dashed' ? '5 4' : undefined,
            strokeWidth: 1.5,
            stroke: DEFAULT_EDGE_COLOR,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: DEFAULT_EDGE_COLOR },
          data: { arrowType: 'end', strokeColor: DEFAULT_EDGE_COLOR, ...(asFree && { freeLineType: edgeLineType === 'default' ? 'default' as const : edgeLineType === 'straight' ? 'straight' as const : 'step' as const }) },
        };
        const newEdges = addEdge(edgeParams, eds as AppEdge[]) as AppEdge[];
        onCanvasChangeRef.current(nodesRef.current, newEdges);
        return newEdges;
      });
      setCurrentTool('select');
    },
    [setEdges, setNodes, connectLabeled, edgeLineType, edgeStyle, setCurrentTool],
  );

  // 자동저장을 트리거할 "실질적인" 변경인지 판별
  // — 드래그 중 position(dragging:true), 리사이즈 중 dimensions(resizing:true),
  //   select 전용 change는 매 프레임 발생하므로 자동 저장에서 제외
  const isPersistableNodeChanges = (changes: Parameters<typeof onNodesChange>[0]) =>
    changes.some((c) => {
      if (c.type === 'position') return !(c as { dragging?: boolean }).dragging;
      if (c.type === 'dimensions') return !(c as { resizing?: boolean }).resizing;
      if (c.type === 'select') return false;
      return true; // add / remove / replace 등
    });

  const isPersistableEdgeChanges = (changes: Parameters<typeof onEdgesChange>[0]) =>
    changes.some((c) => c.type !== 'select');

  // 노드 변경 핸들러 — 삭제/리사이즈 시 히스토리 저장 + 자동 저장
  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      if (!isRestoring.current) {
        const hasRemove      = changes.some((c) => c.type === 'remove');
        const hasResizeStart = changes.some((c) => c.type === 'dimensions' && (c as { resizing?: boolean }).resizing);
        const hasResizeEnd   = changes.some((c) => c.type === 'dimensions' && !(c as { resizing?: boolean }).resizing);

        if (hasRemove) {
          quickPush();
          justFlushed.current = true;
        } else if (hasResizeStart && !isDraggingOrResizing.current) {
          quickPush();
          isDraggingOrResizing.current = true;
        } else if (hasResizeEnd && isDraggingOrResizing.current) {
          isDraggingOrResizing.current = false;
          justFlushed.current = true;
        }
      }
      // 영역을 끌어 고를 때 묶음의 일부만 걸려도 묶음 전체를 선택 (들어가 있는 묶음은 하나씩)
      const solo = useCanvasStore.getState().soloGroupId;
      const picked = new Set<string>();
      for (const c of changes) {
        if (c.type !== 'select' || !c.selected) continue;
        const gid = groupIdOf(nodesRef.current.find((n) => n.id === c.id));
        if (gid && gid !== solo) picked.add(gid);
      }
      if (picked.size > 0) {
        const members = nodesRef.current.filter((n) => picked.has(groupIdOf(n) ?? ''));
        const memberIds = new Set(members.map((n) => n.id));
        changes = [
          ...changes.filter((c) => !(c.type === 'select' && memberIds.has(c.id))),
          ...members.map((n) => ({ type: 'select' as const, id: n.id, selected: true })),
        ];
      }
      onNodesChange(changes);
      // 드래그/리사이즈 중간 프레임, 단순 select 변경은 자동저장 트리거하지 않음
      // → 매 프레임 부모 setSaveStatus 호출로 FlowArea 전체가 리렌더되던 렉의 핵심 원인
      if (isPersistableNodeChanges(changes)) pendingSave.current = true;
    },
    [onNodesChange, quickPush],
  );

  // 엣지 변경 핸들러 — 삭제 시 히스토리 저장 + 자동 저장
  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      if (!isRestoring.current) {
        const hasRemove = changes.some((c) => c.type === 'remove');
        if (hasRemove) { quickPush(); justFlushed.current = true; }
      }
      onEdgesChange(changes);
      if (isPersistableEdgeChanges(changes)) pendingSave.current = true;
    },
    [onEdgesChange, quickPush],
  );

  const controlPosition: PanelPosition = showMiniMap ? 'bottom-left' : 'bottom-right';

  // ReactFlow에 넘기는 객체/콜백 안정화 — zoom/렌더마다 재생성 방지
  const defaultEdgeOptions = useMemo(() => ({
    type: edgeLineType,
    style: { strokeWidth: 1.5, stroke: DEFAULT_EDGE_COLOR },
    markerEnd: { type: MarkerType.ArrowClosed, color: DEFAULT_EDGE_COLOR },
    data: { arrowType: 'end' as const, strokeColor: DEFAULT_EDGE_COLOR },
  }), [edgeLineType]);

  const setLabelFocusEdgeId = useCanvasStore((s) => s.setLabelFocusEdgeId);
  const onPaneClick = useCallback(() => {
    if (isConnectMode) setCurrentTool('select');
    clearSelectedDocElement();
    setLabelFocusEdgeId(null);
  }, [isConnectMode, setCurrentTool, clearSelectedDocElement, setLabelFocusEdgeId]);
  // 선 자체를 누르면 선 설정 — 라벨로 골랐던 표시는 지움
  const onEdgeClick = useCallback(() => setLabelFocusEdgeId(null), [setLabelFocusEdgeId]);

  // ── 라이브러리 항목 끌어다 놓기 (오른쪽 사이드바 라이브러리 탭 → 캔버스) ──
  const onLibraryDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(LIBRARY_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const onLibraryDrop = useCallback((e: React.DragEvent) => {
    const itemId = e.dataTransfer.getData(LIBRARY_DRAG_TYPE);
    const item = itemId && useLibraryStore.getState().items.find((it) => it.id === itemId);
    const inst = rfInstanceRef.current;
    if (!item || !inst || isLocked) return;
    e.preventDefault();
    // 놓은 자리가 묶음의 가운데가 되게
    const p = inst.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const { w, h } = itemBounds(item);
    const { nodes: added, edges: addedEdges } = instantiateLibraryItem(item, { x: p.x - w / 2, y: p.y - h / 2 });
    setNodes((prev) => placeFramesFirst([...(prev as AppNode[]).map((n) => (n.selected ? { ...n, selected: false } : n)), ...added]));
    setEdges((prev) => [...prev, ...addedEdges]);
  }, [isLocked, setNodes, setEdges]);

  // ── 드래그 마우스 핸들러 ─────────────────────────────────────
  // ── 묶음 (utils/group.ts) ────────────────────────────────────
  // 묶인 요소를 누르면 React Flow가 끌기를 시작하기 전에(캡처 단계) 묶음 전체를 먼저 선택 → 한 덩어리로 끌려감
  // 더블클릭으로 들어가 있는 묶음(soloGroupId)의 요소는 하나씩 고르게 그대로 둠
  const selectGroupAt = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.shiftKey) return;
    const store = useCanvasStore.getState();
    if (store.isLocked) return;
    const t = e.target as HTMLElement;
    if (t.closest('.react-flow__resize-control, .react-flow__handle')) return;
    const el = t.closest<HTMLElement>('.react-flow__node');
    if (!el) {
      // 빈 캔버스를 누르면 묶음에서 나옴 (패널·툴바를 누른 건 그대로)
      if (store.soloGroupId && t.closest('.react-flow__pane')) store.setSoloGroupId(null);
      return;
    }
    const gid = groupIdOf(nodesRef.current.find((n) => n.id === el.dataset.id));
    if (gid && gid === store.soloGroupId) return;
    if (store.soloGroupId) store.setSoloGroupId(null);
    if (!gid) return;
    const members = nodesRef.current.filter((n) => groupIdOf(n) === gid);
    if (members.every((n) => n.selected)) return;   // 이미 통째로 선택됨 (다른 것과 함께 골라 끌 때도 유지)
    setNodes((prev) => prev.map((n) => {
      const sel = groupIdOf(n) === gid;
      return !!n.selected === sel ? n : { ...n, selected: sel };
    }));
  };

  // 묶인 요소를 더블클릭 → 그 요소 하나만 선택 (묶음 안으로 들어감). 글 편집 등 요소 자체의 더블클릭 동작은 그대로 이어짐
  const enterGroupAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const store = useCanvasStore.getState();
    if (drawTool || store.isLocked) return;
    const id = (e.target as HTMLElement).closest<HTMLElement>('.react-flow__node')?.dataset.id;
    const gid = groupIdOf(nodesRef.current.find((n) => n.id === id));
    if (!gid) return;
    store.setSoloGroupId(gid);
    setNodes((prev) => prev.map((n) => {
      const sel = n.id === id;
      return !!n.selected === sel ? n : { ...n, selected: sel };
    }));
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // 포털로 띄운 창(페이지 모달 등) 안 클릭은 React 트리를 따라 여기까지 올라오므로 무시
    if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
    // 연결선 모드: 빈 캔버스나 도형 위에서 드래그 시작 → 자유 화살표로 그리기
    // (도형 안에서 시작·끝나면 그 도형에 붙음 — PPT처럼 도형에서 도형으로 끌어 잇기)
    if (!drawTool && currentTool === 'connect') {
      const t = e.target as HTMLElement;
      // 핸들/엣지를 누른 경우는 React Flow의 기본 동작에 맡김
      if (t.closest('.react-flow__handle')) return;
      if (t.closest('.react-flow__edge'))   return;
      e.preventDefault();
      e.stopPropagation();
      setDrawTool('arrow');           // 이후 addDraggedNode가 arrow 분기 실행
      const fp = toFlow(e.clientX, e.clientY);
      setDrawing({ x0: fp.x, y0: fp.y, x1: fp.x, y1: fp.y });
      return;
    }
    if (!drawTool) { selectGroupAt(e); return; }
    e.preventDefault();
    e.stopPropagation();
    const fp = toFlow(e.clientX, e.clientY);
    if (drawTool === 'freehand') {
      isFreehandActive.current = true;
      setFreehandPoints([[fp.x, fp.y]]);
      return;
    }
    setDrawing({ x0: fp.x, y0: fp.y, x1: fp.x, y1: fp.y });
  }, [drawTool, toFlow, currentTool, setDrawTool]);

  // ── 글상자 아래 작은 요소 먼저 잡기 ──────────────────────────
  // 글상자는 배경이 투명해서, 그 안에 겹친 아이콘·도형이 눈에는 위에 있는 것처럼 보임
  // → 마우스가 글상자 안의 더 작은 요소 위에 있으면 글상자를 잠시 '통과'시켜 그 요소가 눌리게 함
  //   (글상자를 선택·편집 중일 때는 그대로)
  const passThroughRef = useRef<{ el: HTMLElement; prev: string } | null>(null);
  const updateTextPassThrough = (x: number, y: number) => {
    if (passThroughRef.current) { passThroughRef.current.el.style.pointerEvents = passThroughRef.current.prev; passThroughRef.current = null; }
    const els = document.elementsFromPoint(x, y);
    const under: HTMLElement[] = [];
    for (const el of els) {
      const n = el.closest<HTMLElement>('.react-flow__node');
      if (n && !under.includes(n)) under.push(n);
    }
    const [top, ...rest] = under;
    if (!top || rest.length === 0) return;
    const byId = new Map(nodesRef.current.map((n) => [n.id, n]));
    const topNode = byId.get(top.dataset.id ?? '');
    if (!topNode || topNode.data.shape !== 'text' || topNode.selected) return;
    if (useCanvasStore.getState().editingTextNodeId === topNode.id) return;
    const topRect = top.getBoundingClientRect();
    const smaller = rest.find((el) => {
      const n = byId.get(el.dataset.id ?? '');
      if (!n || n.data.shape === 'frame') return false;
      const r = el.getBoundingClientRect();
      return r.width * r.height < topRect.width * topRect.height;
    });
    if (smaller) { passThroughRef.current = { el: top, prev: top.style.pointerEvents }; top.style.pointerEvents = 'none'; }
  };

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastPointerRef.current = { x: e.clientX, y: e.clientY };
    if (e.buttons === 0) updateTextPassThrough(e.clientX, e.clientY);   // 끄는 중에는 바꾸지 않음
    if (drawTool === 'freehand' && isFreehandActive.current) {
      const fp = toFlow(e.clientX, e.clientY);
      setFreehandPoints((prev) => [...prev, [fp.x, fp.y]]);
      return;
    }
    if (!drawing) return;
    const fp = toFlow(e.clientX, e.clientY);
    setDrawing((prev) => prev ? { ...prev, x1: fp.x, y1: fp.y } : null);
  }, [drawing, drawTool, toFlow]);

  const handleMouseUp = useCallback((_e: React.MouseEvent<HTMLDivElement>) => {
    // 자유 손글씨 완료
    if (drawTool === 'freehand' && isFreehandActive.current) {
      isFreehandActive.current = false;
      const pts = freehandPoints;
      setFreehandPoints([]);
      if (pts.length < 2) return;
      quickPush();
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const pad = 4;
      const minX = Math.min(...xs) - pad;
      const minY = Math.min(...ys) - pad;
      const w    = Math.max(...xs) - minX + pad;
      const h    = Math.max(...ys) - minY + pad;
      const relPts = pts.map(([x, y]) => [x - minX, y - minY]);
      const newNode: AppNode = {
        id:       `node-${Date.now()}`,
        type:     'custom',
        position: { x: minX, y: minY },
        width:    w,
        height:   h,
        zIndex:   0,
        data: {
          title: '', subtitle: '', icon: '',
          type: 'service', status: 'none', shape: 'drawing',
          width: w, height: h,
          drawingPoints: relPts,
          drawingColor: '#e2e8f0',
          drawingWidth: 2,
        },
      };
      setNodes((prev) => [...prev, newNode]);
      setDrawTool(null);
      return;
    }
    if (!drawing) return;
    const { x0, y0, x1, y1 } = drawing;
    setDrawing(null);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const passed = drawTool === 'arrow' ? (dx > 3 || dy > 3) : (dx > 5 && dy > 5);
    if (passed) {
      addDraggedNode(x0, y0, x1, y1);
    }
  }, [drawing, freehandPoints, drawTool, addDraggedNode, quickPush, setNodes, setDrawTool]);

  // ── 드래그 프리뷰 오버레이 좌표 ──────────────────────────────
  const previewStyle = (() => {
    if (!drawing) return null;
    const { x, y, zoom } = viewportRef.current;
    const { x0, y0, x1, y1 } = drawing;
    return {
      left:   Math.min(x0, x1) * zoom + x,
      top:    Math.min(y0, y1) * zoom + y,
      width:  Math.abs(x1 - x0) * zoom,
      height: Math.abs(y1 - y0) * zoom,
    };
  })();

  // 슬래시 메뉴에서 고른 요소를 메뉴를 연 위치에 추가
  const handleSlashSelect = (item: SlashItem) => {
    if (!slashMenu) return;
    // 요소 여러 개를 한꺼번에 놓는 항목(DB 설계 템플릿) — AI가 그린 것과 같은 길로 놓음 (빈 자리 찾기 · 화면 이동)
    if (item.cluster) {
      const { nodes: cn, edges: ce } = item.cluster();
      setSlashMenu(null);
      quickPush();
      justFlushed.current = true;
      useCanvasStore.getState().addPending(cn, ce);
      return;
    }
    const { x: vx, y: vy, zoom } = viewportRef.current;
    const newNode = withLastFont({ ...item.build({ x: (slashMenu.x - vx) / zoom, y: (slashMenu.y - vy) / zoom }), selected: true });
    setSlashMenu(null);
    quickPush();
    justFlushed.current = true;
    setNodes((prev) => placeFramesFirst([...prev.map((n) => ({ ...n, selected: false })), newNode]));
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.canvasWrap} flex-1 relative overflow-hidden bg-bg-secondary transition-colors duration-300 ${isConnectMode ? styles.connectMode : ''} ${drawTool && drawTool !== 'freehand' ? styles.drawMode : ''} ${drawTool === 'freehand' ? styles.freehandMode : ''}`}
      style={{}}
      onMouseDownCapture={handleMouseDown}
      onDoubleClickCapture={enterGroupAt}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { lastPointerRef.current = null; }}
    >
      {slashMenu && (
        <SlashMenu
          x={slashMenu.x}
          y={slashMenu.y}
          boundsW={containerRef.current?.clientWidth ?? 0}
          boundsH={containerRef.current?.clientHeight ?? 0}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
        />
      )}
      {/* 자유 손글씨 드로잉 실시간 오버레이 */}
      {freehandPoints.length > 1 && (() => {
        const { x, y, zoom } = viewportRef.current;
        const pts = freehandPoints.map(([px, py]) => [px * zoom + x, py * zoom + y] as [number, number]);
        let d = `M ${pts[0][0]} ${pts[0][1]}`;
        for (let i = 1; i < pts.length - 1; i++) {
          const mx = (pts[i][0] + pts[i + 1][0]) / 2;
          const my = (pts[i][1] + pts[i + 1][1]) / 2;
          d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
        }
        const last = pts[pts.length - 1];
        d += ` L ${last[0]} ${last[1]}`;
        return (
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 999 }}>
            <path d={d} stroke="var(--canvas-ink)" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      })()}

      {/* 드래그 프리뷰 오버레이 — 도구별 분기 */}
      {drawing && (() => {
        // 자유 화살표: 시작점→커서까지 실시간 미리보기 — 고른 연결선 모양(직선·꺾은선·곡선) 그대로
        if (drawTool === 'arrow') {
          const { x, y, zoom } = viewportRef.current;
          const sx = drawing.x0 * zoom + x;
          const sy = drawing.y0 * zoom + y;
          const ex = drawing.x1 * zoom + x;
          const ey = drawing.y1 * zoom + y;
          const horiz = Math.abs(ex - sx) >= Math.abs(ey - sy);
          const sPos = horiz ? (ex >= sx ? Position.Right : Position.Left) : (ey >= sy ? Position.Bottom : Position.Top);
          const tPos = horiz ? (ex >= sx ? Position.Left : Position.Right) : (ey >= sy ? Position.Top : Position.Bottom);
          const ends = { sourceX: sx, sourceY: sy, sourcePosition: sPos, targetX: ex, targetY: ey, targetPosition: tPos };
          const previewPath = connectLabeled || edgeLineType === 'straight'
            ? `M ${sx},${sy} L ${ex},${ey}`
            : edgeLineType === 'default'
              ? getBezierPath(ends)[0]
              : getSmoothStepPath({ ...ends, borderRadius: 0, offset: 24 })[0];
          return (
            <svg
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                pointerEvents: 'none', zIndex: 999,
                overflow: 'visible',
              }}
            >
              <defs>
                <marker
                  id="arrow-preview-head"
                  viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="8" markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="#111827" />
                </marker>
              </defs>
              <path
                d={previewPath} fill="none"
                stroke="#111827" strokeWidth="1.5"
                strokeDasharray="4 3"
                markerEnd="url(#arrow-preview-head)"
              />
            </svg>
          );
        }
        // 그 외 도구(사각형/원/프레임/텍스트/표): 점선 사각형 (원은 타원)
        if (!previewStyle) return null;
        return (
          <div
            style={{
              position: 'absolute',
              pointerEvents: 'none',
              zIndex: 999,
              left:   previewStyle.left,
              top:    previewStyle.top,
              width:  previewStyle.width,
              height: previewStyle.height,
              border: '2px dashed #7c5cfc',
              background: 'rgba(124,92,252,0.06)',
              borderRadius: drawTool === 'circle' ? '50%' : 4,
            }}
          />
        );
      })()}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onInit={onInit}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={defaultEdgeOptions}
        onNodeDrag={onNodeDrag}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        nodesDraggable={!isLocked && !isConnectMode}   // 연결선 모드에서는 도형 위 드래그 = 화살표 그리기
        nodesConnectable={!isLocked}
        elementsSelectable={!isLocked}
        elevateNodesOnSelect={false}   // 선택해도 생성 순서(쌓임 순서) 유지
        deleteKeyCode={isLocked ? null : 'Delete'}
        panOnDrag={!isConnectMode && !drawTool}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onDragOver={onLibraryDragOver}
        onDrop={onLibraryDrop}
        connectionMode={ConnectionMode.Loose}
        // 핸들을 끌 때 미리보기 선 — 고른 연결선 모양 그대로 (기본값은 곡선이라 꺾은선·직선에서도 곡선으로 보였음)
        connectionLineType={
          !connectLabeled && edgeLineType === 'straight' ? ConnectionLineType.Straight
            : !connectLabeled && edgeLineType === 'default' ? ConnectionLineType.Bezier
              : ConnectionLineType.Step
        }
        connectionRadius={50}
        fitView={hasNodes}
        fitViewOptions={_FIT_VIEW_OPTIONS}
        defaultViewport={_DEFAULT_VIEWPORT}
        minZoom={0.08}
        maxZoom={4}
        // 더블클릭 2배 확대 끔 — 프레임 더블클릭의 '프레임에 맞추기'와 겹쳐 엉뚱하게 확대됨
        zoomOnDoubleClick={false}
        // 설정 '휠로 위아래 이동' — 휠은 위아래로만 이동, Ctrl+휠·트랙패드 집기는 확대·축소
        panOnScroll={wheelPan}
        panOnScrollMode={PanOnScrollMode.Vertical}
        multiSelectionKeyCode="Shift"
        proOptions={_PRO_OPTIONS}
        // 화면에 보이는 요소만 그림 — 요소가 수백 개일 때 줌·이동이 끊기지 않게
        //   (썸네일·인쇄처럼 전부 있어야 하는 순간엔 withAllNodesRendered가 잠깐 끔)
        onlyRenderVisibleElements={renderAllCount === 0}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--border-color)"
        />

        {/* 정렬 가이드라인 */}
        <HelperLinesRenderer h={helperLines.h} v={helperLines.v} />

        {/* 뷰포트 동기화 */}
        <ViewportSync viewportRef={viewportRef} />

        {/* 현재 줌을 CSS 변수로 — 묶음 선택 테두리를 화면 기준 두께로 그릴 때 씀 */}
        <ZoomCssVar />

        {/* 묶음을 통째로 골랐을 때 감싸는 테두리 */}
        <GroupOutline />

        {/* 사이드바 토글 fitView 처리 */}
        <SidebarFitView rightCollapsed={rightCollapsed} />

        {/* 노드 속성 패널 */}
        <NodePropertiesPanel />

        {/* 문서 오버레이 — 문서 컨테이너 + 버튼 */}
        <DocOverlay />

        {/* 인쇄 처리 핸들러 */}
        <PrintHandler />

        {/* 발표 모드 — F5 / Shift+F5, 상단 ▶ 버튼 */}
        <Presenter nodeTypes={NODE_TYPES} edgeTypes={EDGE_TYPES} />

        {/* 하단 중앙 툴바 */}
        <CanvasToolbar />

        {/* 뷰 컨트롤 — 미니맵 켜지면 왼쪽, 꺼지면 오른쪽 하단 */}
        <ViewControls
          position={controlPosition}
          canUndo={historyLen.undo > 0}
          canRedo={historyLen.redo > 0}
          onUndo={undo}
          onRedo={redo}
        />

        {/* 미니맵 — 오른쪽 하단 고정 */}
        {showMiniMap && (
          <MiniMap
            position="bottom-right"
            nodeStrokeWidth={3}
            zoomable
            pannable
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-light)',
              borderRadius: 8,
            }}
          />
        )}
      </ReactFlow>
    </div>
  );
};
