'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/Canvas/Presenter.tsx
// 발표 모드 (슬라이드 쇼)
//
//   - 단축키: F5 처음부터 · Shift+F5 지금 보는 슬라이드부터 (맥 보조: Cmd/Ctrl+Enter, +Shift)
//     F5는 브라우저 새로고침 키라 캔버스에서는 막고 발표를 엶 (글 쓰는 중에도 — 실수로 새로고침되지 않게)
//   - 슬라이드 순서 = 오른쪽 사이드바 페이지 탭 순서 (utils/slides.ts)
//   - 화면: 캔버스를 읽기 전용으로 한 벌 더 그려 전체 화면에 띄우고, 슬라이드(프레임)를 화면에 맞춘 뒤 바깥은 검게 가림
//   - 넘기기: → ↓ Space Enter PageDown 클릭 / 뒤로: ← ↑ PageUp Backspace / Home·End / Esc 나가기
// ═══════════════════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow, ReactFlowProvider, useReactFlow, useStore, useNodesInitialized, ConnectionMode,
  type NodeTypes, type EdgeTypes,
} from '@xyflow/react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { AppNode, AppEdge } from '@/types';
import { useCanvasStore } from '@/store/canvasStore';
import { slideOrder } from '@/utils/slides';
import styles from './Presenter.module.css';
import { tr } from '@/lib/i18n';

type Rect = { x: number; y: number; width: number; height: number };
type Show = { nodes: AppNode[]; edges: AppEdge[]; slides: string[]; start: number };

const PRO_OPTIONS = { hideAttribution: true } as const;

const isEditable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

// ── 캔버스(ReactFlow) 안에 두는 부분: 단축키를 받고, 발표 화면을 띄움 ──
export function Presenter({ nodeTypes, edgeTypes }: { nodeTypes: NodeTypes; edgeTypes: EdgeTypes }) {
  const { getNodes, getEdges, getInternalNode, getViewport } = useReactFlow<AppNode, AppEdge>();
  const domNode             = useStore((s) => s.domNode);
  const request             = useCanvasStore((s) => s.presentRequest);
  const requestPresent      = useCanvasStore((s) => s.requestPresent);
  const clearPresentRequest = useCanvasStore((s) => s.clearPresentRequest);
  const [show, setShow]     = useState<Show | null>(null);

  // 단축키 — 발표 중에는 발표 화면이 키를 받음
  useEffect(() => {
    if (show) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F5' && !mod && !e.altKey) {
        e.preventDefault();
        requestPresent(e.shiftKey ? 'current' : 'start');
      } else if (e.key === 'Enter' && mod && !e.altKey && !e.isComposing && !isEditable(e.target)) {
        e.preventDefault();
        requestPresent(e.shiftKey ? 'current' : 'start');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [show, requestPresent]);

  // 캔버스 기준 사각형 (프레임 안에 든 프레임도 절대 위치로)
  const rectOf = useCallback((id: string): Rect | null => {
    const n = getInternalNode(id);
    if (!n) return null;
    return {
      x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y,
      width: n.measured.width ?? n.width ?? 0, height: n.measured.height ?? n.height ?? 0,
    };
  }, [getInternalNode]);

  // 발표 요청 → 어느 슬라이드부터 시작할지 정하고 캔버스를 한 벌 복사해 띄움
  useEffect(() => {
    if (!request) return;
    clearPresentRequest();

    const nodes  = getNodes();
    const slides = slideOrder(nodes).map((n) => n.id);
    let start = 0;

    if (request === 'current' && slides.length > 0) {
      const slideSet = new Set(slides);
      const byId     = new Map(nodes.map((n) => [n.id, n]));
      let hit: string | undefined;

      // 1) 선택한 요소가 든 슬라이드
      for (let cur = nodes.find((n) => n.selected); cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
        if (slideSet.has(cur.id)) { hit = cur.id; break; }
      }
      // 2) 없으면 화면 가운데에 가장 가까운 슬라이드
      if (!hit && domNode) {
        const { x, y, zoom } = getViewport();
        const box = domNode.getBoundingClientRect();
        const cx = (box.width / 2 - x) / zoom;
        const cy = (box.height / 2 - y) / zoom;
        let best = Infinity;
        for (const id of slides) {
          const r = rectOf(id);
          if (!r) continue;
          const d = Math.hypot(Math.max(r.x - cx, 0, cx - (r.x + r.width)), Math.max(r.y - cy, 0, cy - (r.y + r.height)));
          if (d < best) { best = d; hit = id; }
        }
      }
      start = Math.max(0, slides.indexOf(hit ?? ''));
    }

    setShow({
      nodes: nodes.map((n) => ({ ...n, selected: false, draggable: false, selectable: false, connectable: false })),
      edges: getEdges().map((e) => ({ ...e, selected: false })),
      slides,
      start,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!show) return null;
  return createPortal(
    <ReactFlowProvider>
      <Stage {...show} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onClose={() => setShow(null)} />
    </ReactFlowProvider>,
    document.body,
  );
}

// ── 발표 화면 ──
function Stage({ nodes, edges, slides, start, nodeTypes, edgeTypes, onClose }: Show & {
  nodeTypes: NodeTypes; edgeTypes: EdgeTypes; onClose: () => void;
}) {
  const rootRef   = useRef<HTMLDivElement>(null);
  const [idx, setIdx]   = useState(start);
  const [hole, setHole] = useState<Rect | null>(null);   // 슬라이드의 캔버스 기준 사각형
  const [hud, setHud]   = useState(true);                // 아래 조작 버튼 (마우스를 움직이면 잠깐 보임)
  const { fitBounds, getInternalNode } = useReactFlow();
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const nodesReady     = useNodesInitialized();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const last = slides.length - 1;
  const go   = useCallback((i: number) => setIdx(Math.min(Math.max(i, 0), Math.max(last, 0))), [last]);

  // 전체 화면 — 브라우저가 Esc로 전체 화면을 끄면 발표도 끝
  useEffect(() => {
    rootRef.current?.requestFullscreen?.().catch(() => { /* 막히면 창 안에서 그대로 발표 */ });
    const onChange = () => { if (!document.fullscreenElement) closeRef.current(); };
    document.addEventListener('fullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // 슬라이드를 화면에 맞춤 — 규격 슬라이드는 꽉 차게, 자유 크기는 여백을 조금
  const fit = useCallback(() => {
    const id = slides[idx];
    const n  = id ? getInternalNode(id) : undefined;
    if (!n) return;
    const r = {
      x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y,
      width: n.measured.width ?? n.width ?? 0, height: n.measured.height ?? n.height ?? 0,
    };
    setHole(r);
    fitBounds(r, { padding: n.data?.isPaperFrame ? 0 : 0.05, duration: 0 });
  }, [slides, idx, getInternalNode, fitBounds]);

  useEffect(() => { if (nodesReady) fit(); }, [nodesReady, fit]);

  // 창 크기가 바뀌면(전체 화면 들어가기 등) 다시 맞춤
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // 키보드 — 발표 중에는 캔버스 단축키(삭제·되돌리기 등)가 동작하지 않게 먼저 가로챔
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      const k = e.key;
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); setIdx((i) => Math.min(i + 1, Math.max(last, 0))); }
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
      else if (k === 'Home') { e.preventDefault(); go(0); }
      else if (k === 'End')  { e.preventDefault(); go(last); }
      else if (k === 'Escape') { e.preventDefault(); closeRef.current(); }
      else if (k === 'F5') e.preventDefault();   // 발표 중 새로고침 막기
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [go, last]);

  // 마우스를 움직이면 조작 버튼을 보이고, 가만히 두면 2초 뒤 숨김 (커서도 같이)
  useEffect(() => {
    if (!hud) return;
    const t = setTimeout(() => setHud(false), 2000);
    return () => clearTimeout(t);
  }, [hud, idx]);

  const holeStyle = hole && {
    left: hole.x * zoom + tx, top: hole.y * zoom + ty,
    width: hole.width * zoom, height: hole.height * zoom,
  };

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${hud ? '' : styles.idle}`}
      onMouseMove={() => setHud(true)}
    >
      {slides.length === 0 ? (
        <div className={styles.empty}>
          {tr('아직 슬라이드가 없어요.', 'No slides yet.')}<br />
          {tr('프레임을 만들면 슬라이드가 돼요.', 'Frames you make become slides.')} <span className={styles.hint}>{tr('Esc로 나가기', 'Esc to exit')}</span>
        </div>
      ) : (
        <>
          <div className={styles.flow}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              connectionMode={ConnectionMode.Loose}   // 캔버스와 같게 — 연결점이 source 하나뿐인 선(DB 테이블 관계선 등)도 그려짐
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              panOnDrag={false}
              panOnScroll={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling
              minZoom={0.01}
              maxZoom={50}
              proOptions={PRO_OPTIONS}
            />
          </div>

          {/* 슬라이드 바깥은 검게 가림 + 클릭하면 다음 장 (노드를 누르지 못하게 맨 위에서 받음) */}
          <div className={styles.cover} onClick={() => go(idx + 1)} onContextMenu={(e) => { e.preventDefault(); go(idx - 1); }}>
            {holeStyle && <div className={styles.hole} style={holeStyle} />}
          </div>
        </>
      )}

      {/* 조작 버튼 — 이전 · 번호 · 다음 · 나가기 */}
      <div className={styles.hud}>
        {slides.length > 0 && (
          <>
            <button onClick={() => go(idx - 1)} disabled={idx === 0} aria-label={tr('이전 슬라이드', 'Previous slide')}><ChevronLeft size={18} /></button>
            <span className={styles.count}>{idx + 1} / {slides.length}</span>
            <button onClick={() => go(idx + 1)} disabled={idx === last} aria-label={tr('다음 슬라이드', 'Next slide')}><ChevronRight size={18} /></button>
          </>
        )}
        <button onClick={() => closeRef.current()} aria-label={tr('발표 끝내기', 'End presentation')} title={tr('발표 끝내기 (Esc)', 'End presentation (Esc)')}><X size={18} /></button>
      </div>
    </div>
  );
}
