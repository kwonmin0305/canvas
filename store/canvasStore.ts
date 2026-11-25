'use client';

import { create } from 'zustand';
import type { EdgeStyle, EdgeLineType, ToolType, AppNode, AppEdge, NodeShape, NodeData } from '@/types';

// ── UI 전용 Store ────────────────────────────────────────────
// 노드/엣지 상태는 Canvas 내부 useNodesState/useEdgesState로 관리
// 여기서는 도구·엣지 스타일 등 전역 UI 상태만 관리

interface CanvasStore {
  currentTool:     ToolType;           // t선택,손, 연결선 3가지 만 됨.
  setCurrentTool:  (tool: ToolType) => void;

  edgeStyle:       EdgeStyle;
  setEdgeStyle:    (style: EdgeStyle) => void;

  edgeLineType:    EdgeLineType;
  setEdgeLineType: (type: EdgeLineType) => void;

  showMiniMap:      boolean;
  toggleMiniMap:    () => void;

  snapGuides:       boolean;
  toggleSnapGuides: () => void;

  // 마우스 휠: false → 확대·축소(기본), true → 화면 위아래 이동 (Ctrl+휠은 확대·축소). 브라우저에 기억
  wheelPan:       boolean;
  toggleWheelPan: () => void;

  // 심플 모드: 켜면 오른쪽 위 버튼 중 설정만 남김 (저장·테마·왼쪽 위 이름 숨김). 브라우저에 기억
  simpleMode:       boolean;
  toggleSimpleMode: () => void;

  // 캔버스에 한꺼번에 넣을 노드/엣지 (요소 패널 ERD 템플릿 등 → Canvas가 빈 자리를 찾아 넣음)
  pendingNodes: AppNode[];
  pendingEdges: AppEdge[];
  addPending:   (nodes: AppNode[], edges: AppEdge[]) => void;
  clearPending: () => void;

  // 드래그-투-크리에이트 도구
  drawTool:    NodeShape | 'arrow' | 'freehand' | null;
  setDrawTool: (tool: NodeShape | 'arrow' | 'freehand' | null) => void;

  // 캔버스 잠금 — 잠금 시 요소 클릭/드래그/연결 불가
  isLocked:     boolean;
  toggleLocked: () => void;

  // 마지막으로 고른 글꼴 — 새로 만드는 글상자·도형에 자동 적용 (브라우저에 저장)
  lastFontFamily:    NodeData['fontFamily'];
  setLastFontFamily: (font: NodeData['fontFamily']) => void;

  // 글상자·도형 안 글씨를 편집 중인 노드 — 편집하는 동안 도형 선택 표시(크기 조절 점)를 숨기고 패널은 텍스트 도구로
  editingTextNodeId:    string | null;
  setEditingTextNodeId: (id: string | null) => void;

  // 카드 아이콘을 눌러 고른 노드 — 도형 선택 표시를 숨기고 패널은 아이콘 도구(색·크기)로. 글씨 선택과 동시에 켜지지 않음
  // 더블클릭해서 "안에 들어간" 묶음 — 이 묶음의 요소는 하나씩 고름 (utils/group.ts)
  soloGroupId:    string | null;
  setSoloGroupId: (id: string | null) => void;
  editingIconNodeId:    string | null;
  // 화면 프레임을 찍어 넣는 중인 목업 id (목업에 "올리는 중…" 표시)
  mockupBusyId:         string | null;
  // 사진·화면을 끄는 중 — 놓으면 들어갈 목업·이미지 칸 id (그 칸을 강조해 보여 줌)
  imageDropTargetId:    string | null;
  imageDropDimIds:      Set<string> | null;   // 그때 흐리게 할 끄는 요소(프레임이면 안의 요소까지)
  setImageDropTarget:   (id: string | null, dim?: Set<string> | null) => void;
  setMockupBusyId:      (id: string | null) => void;
  setEditingIconNodeId: (id: string | null) => void;

  // DB 테이블(ERD) — 고른 컬럼 (속성 패널에 컬럼 설정을 보여 줌) · 타입을 실제 이름으로 볼지 (브라우저에 기억)
  entityCol:       { nodeId: string; colId: string } | null;
  setEntityCol:    (sel: { nodeId: string; colId: string } | null) => void;
  erdRealTypes:    boolean;
  setErdRealTypes: (v: boolean) => void;

  // 인쇄 요청 (page.tsx → Canvas 내부 PrintHandler로 전달)
  printRequested:    boolean;
  requestPrint:      () => void;
  clearPrintRequest: () => void;

  // 발표(슬라이드 쇼) 요청 — 'start' 처음부터 / 'current' 지금 보는 슬라이드부터 (Canvas 내부 Presenter가 받음)
  presentRequest:      'start' | 'current' | null;
  requestPresent:      (from: 'start' | 'current') => void;
  clearPresentRequest: () => void;

  // 저장 말풍선 (page.tsx 저장 버튼 → FlowArea의 파일 저장·불러오기 말풍선)
  // anchor: 버튼 아래 끝 위치 — 말풍선을 버튼에 붙여 띄우는 데 사용
  saveDialogOpen:    boolean;
  saveDialogAnchor:  { top: number; right: number } | null;
  setSaveDialogOpen: (open: boolean, anchor?: { top: number; right: number }) => void;

  // 템플릿 2 내부 요소 선택
  selectedDocElement: { nodeId: string; elementId: string } | null;
  setSelectedDocElement: (nodeId: string, elementId: string) => void;
  clearSelectedDocElement: () => void;

  // 연결선 라벨 여부 (툴바 드롭다운에서 선택)
  connectLabeled:    boolean;
  setConnectLabeled: (v: boolean) => void;

  // 현재 더블클릭으로 포커스된 doc template 종류 (시퀀스 다이어그램 등)
  focusedDocTemplate:    string | null;
  setFocusedDocTemplate: (template: string | null) => void;

  // 연결선 라벨을 눌러 선택했을 때 그 연결선 id — 왼쪽 패널이 라벨 설정을 보여줌 (선을 누르면 null)
  labelFocusEdgeId:    string | null;
  setLabelFocusEdgeId: (id: string | null) => void;
}

// ── 마지막 글꼴 ──────────────────────────────────────────────
const LAST_FONT_KEY = 'web-canvas-last-font';
const FONT_VALUES: NonNullable<NodeData['fontFamily']>[] = ['normal', 'handwriting', 'mono', 'serif'];
function readLastFont(): NodeData['fontFamily'] {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(LAST_FONT_KEY) : null;
    return FONT_VALUES.includes(v as NonNullable<NodeData['fontFamily']>) ? (v as NodeData['fontFamily']) : 'normal';
  } catch { return 'normal'; }
}

// 글씨를 쓸 수 있는 노드
const FONT_SHAPES = new Set<NodeShape>(['text', 'rectangle', 'circle', 'diamond', 'hexagon']);

// 새 노드에 마지막 글꼴 적용 — 글꼴을 따로 정하지 않은 글상자·도형만
export function withLastFont(node: AppNode): AppNode {
  const font = useCanvasStore.getState().lastFontFamily;
  if (!font || font === 'normal' || node.data.fontFamily || !FONT_SHAPES.has(node.data.shape)) return node;
  return { ...node, data: { ...node.data, fontFamily: font } };
}

export const useCanvasStore = create<CanvasStore>((set) => ({
  currentTool:     'select',
  setCurrentTool:  (tool)  => set({ currentTool: tool }),

  edgeStyle:       'solid',
  setEdgeStyle:    (style) => set({ edgeStyle: style }),

  edgeLineType:    'step',
  setEdgeLineType: (type)  => set({ edgeLineType: type }),

  showMiniMap:     false,
  toggleMiniMap:   ()      => set((s) => ({ showMiniMap: !s.showMiniMap })),

  snapGuides:      true,
  toggleSnapGuides: ()     => set((s) => ({ snapGuides: !s.snapGuides })),

  wheelPan: (() => { try { return typeof window !== 'undefined' && localStorage.getItem('wheelPan') === '1'; } catch { return false; } })(),
  toggleWheelPan: () => set((s) => {
    const next = !s.wheelPan;
    try { localStorage.setItem('wheelPan', next ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에서는 적용 */ }
    return { wheelPan: next };
  }),

  simpleMode: (() => { try { return typeof window !== 'undefined' && localStorage.getItem('simpleMode') === '1'; } catch { return false; } })(),
  toggleSimpleMode: () => set((s) => {
    const next = !s.simpleMode;
    try { localStorage.setItem('simpleMode', next ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에서는 적용 */ }
    return { simpleMode: next };
  }),

  pendingNodes: [],
  pendingEdges: [],
  addPending:   (nodes, edges) => set({ pendingNodes: nodes, pendingEdges: edges }),
  clearPending: ()             => set({ pendingNodes: [], pendingEdges: [] }),

  drawTool:    null,
  setDrawTool: (tool) => set({ drawTool: tool }),

  isLocked:     false,
  toggleLocked: () => set((s) => ({ isLocked: !s.isLocked })),

  lastFontFamily:    readLastFont(),
  setLastFontFamily: (font) => {
    try { localStorage.setItem(LAST_FONT_KEY, font ?? 'normal'); } catch { /* 저장 불가(사생활 보호 모드 등) — 이번 세션만 기억 */ }
    set({ lastFontFamily: font });
  },

  editingTextNodeId:    null,
  setEditingTextNodeId: (id) => set(id ? { editingTextNodeId: id, editingIconNodeId: null } : { editingTextNodeId: null }),

  soloGroupId:    null,
  setSoloGroupId: (id) => set({ soloGroupId: id }),
  editingIconNodeId:    null,
  mockupBusyId:         null,
  imageDropTargetId:    null,
  imageDropDimIds:      null,
  setImageDropTarget:   (id, dim = null) => set((s) => (s.imageDropTargetId === id ? s : { imageDropTargetId: id, imageDropDimIds: id ? dim : null })),
  setMockupBusyId:      (id) => set({ mockupBusyId: id }),
  setEditingIconNodeId: (id) => set(id ? { editingIconNodeId: id, editingTextNodeId: null } : { editingIconNodeId: null }),

  entityCol:       null,
  setEntityCol:    (sel) => set((s) => (s.entityCol?.nodeId === sel?.nodeId && s.entityCol?.colId === sel?.colId ? s : { entityCol: sel })),
  erdRealTypes:    (() => { try { return typeof window !== 'undefined' && localStorage.getItem('erdRealTypes') === '1'; } catch { return false; } })(),
  setErdRealTypes: (v) => {
    try { localStorage.setItem('erdRealTypes', v ? '1' : '0'); } catch { /* 저장 못 해도 이번 화면에서는 적용 */ }
    set({ erdRealTypes: v });
  },

  printRequested:    false,
  requestPrint:      () => set({ printRequested: true }),
  clearPrintRequest: () => set({ printRequested: false }),

  presentRequest:      null,
  requestPresent:      (from) => set({ presentRequest: from }),
  clearPresentRequest: () => set({ presentRequest: null }),

  saveDialogOpen:    false,
  saveDialogAnchor:  null,
  setSaveDialogOpen: (open, anchor) => set((s) => ({ saveDialogOpen: open, saveDialogAnchor: anchor ?? s.saveDialogAnchor })),

  selectedDocElement: null,
  setSelectedDocElement: (nodeId, elementId) => set({ selectedDocElement: { nodeId, elementId } }),
  clearSelectedDocElement: () => set({ selectedDocElement: null }),

  connectLabeled:    false,
  setConnectLabeled: (v) => set({ connectLabeled: v }),

  focusedDocTemplate:    null,
  setFocusedDocTemplate: (template) => set({ focusedDocTemplate: template }),

  labelFocusEdgeId:    null,
  setLabelFocusEdgeId: (id) => set({ labelFocusEdgeId: id }),
}));
    