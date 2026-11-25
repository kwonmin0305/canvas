'use client';

import React, { memo, useState, useEffect, useLayoutEffect, useRef, useCallback, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeResizer, useStore, type NodeProps, useReactFlow } from '@xyflow/react';
import {
  Globe, Smartphone, Settings, Cloud, Server, Scale,
  Code2, Package, Database, Zap, HardDrive,
  CreditCard, Mail, ExternalLink,
  Braces, Box, LayoutGrid, Copy, Check, ChevronDown, ChevronUp, Sparkles,
} from 'lucide-react';
import { registerDocEditor, sanitizeDocHtml, docHtmlToText, docElementToText, setDocSelectionFormat, styleDocSizeSpan, styleDocFontSpan, docFontCss, DEFAULT_DOC_FONT, type DocFontKey } from '@/utils/docPageEditor';
import { DEFAULT_RADIUS, canvasRadius } from '@/constants/shapeRadius';
import type { AppNode, AppEdge, NodeData, NodeShape, DocTemplateContent, DocTemplateElementStyle } from '@/types';
import { getNodeColor, getStatusColor } from '@/utils/nodeData';
import { PAPER_SIZES, paperDims, type PaperSize } from '@/utils/paperSizes';
import { slideOrder, paperSizeOf, slideTitleOf } from '@/utils/slides';
import { useCanvasStore } from '@/store/canvasStore';
import { useHighlightedCode, HighlightedCode } from '@/utils/codeHighlight';
import { ListShape, CalloutShape, PageShape } from './Blocks';
import { MockupShape } from './Mockup';
import { EntityShape } from '@/lib/erd/Entity';
import { ENTITY, entityHeight } from '@/lib/erd';
import { ImageSlotLayer } from './ImageSlot';
import { isImageSlot } from '@/utils/imageSlot';
import styles from './Node.module.css';
import { tr, isTextPlaceholder } from '@/lib/i18n';

// ── 아키텍처 타입별 Lucide 아이콘 (크기 동적) ───────────────
function getArchIcon(type: NodeData['type'], size: number): React.ReactNode {
  const props = { size, strokeWidth: 1.4 } as const;
  switch (type) {
    case 'client':       return <Globe        {...props} />;
    case 'mobile':       return <Smartphone   {...props} />;
    case 'worker':       return <Smartphone   {...props} />;
    case 'auth':         return <Settings     {...props} />;
    case 'cdn':          return <Cloud        {...props} />;
    case 'gateway':      return <Server       {...props} />;
    case 'load_balancer':return <Scale        {...props} />;
    case 'server':       return <Code2        {...props} />;
    case 'service':      return <Package      {...props} />;
    case 'database':     return <Database     {...props} />;
    case 'cache':        return <Zap          {...props} />;
    case 'storage':      return <HardDrive    {...props} />;
    case 'queue':        return <CreditCard   {...props} />;
    case 'message_bus':  return <Mail         {...props} />;
    case 'api':          return <ExternalLink {...props} />;
    case 'function':     return <Braces       {...props} />;
    case 'container':    return <Box          {...props} />;
    default:             return <Package      {...props} />;
  }
}

// ── 모양별 기본 크기 및 최소 크기 ────────────────────────────
export const SHAPE_DEFAULTS: Record<string, { w: number; h: number; minW: number; minH: number }> = {
  card:      { w: 100, h: 90,  minW: 60,  minH: 50  },
  rectangle: { w: 100, h: 100, minW: 40,  minH: 40  },
  circle:    { w: 90,  h: 90,  minW: 20,  minH: 20  },
  diamond:   { w: 100, h: 100, minW: 70,  minH: 70  },
  cylinder:  { w: 120, h: 90,  minW: 70,  minH: 60  },
  hexagon:   { w: 100, h: 88,  minW: 70,  minH: 60  },
  document:  { w: 140, h: 90,  minW: 100, minH: 60  },
  note:      { w: 140, h: 80,  minW: 100, minH: 50  },
  frame:     { w: 400, h: 300, minW: 200, minH: 120 },
  text:      { w: 200, h: 60,  minW: 60,  minH: 30  },
  table:     { w: 360, h: 120, minW: 120, minH: 60  },
  anchor:    { w: 12,  h: 12,  minW: 12,  minH: 12  },
  drawing:   { w: 100, h: 100, minW: 10,  minH: 10  },
  image:     { w: 300, h: 200, minW: 20,  minH: 20  },
  mockup:    { w: 260, h: 539, minW: 60,  minH: 124 },   // 기기 목업 — 기기별 비율 유지 (크기는 Mockup.tsx의 mockupDefaultSize)
  code:      { w: 420, h: 100, minW: 200, minH: 32  },   // 높이는 줄 수로 정해짐 — 접으면 제목 줄(32)만
  // Notion식 블록 — 높이는 내용에 맞춰 자동으로 정해짐
  list:      { w: 360, h: 34,  minW: 120, minH: 24  },
  callout:   { w: 420, h: 50,  minW: 160, minH: 40  },
  page:      { w: 260, h: 36,  minW: 120, minH: 30  },
  // DB 테이블 — 높이는 컬럼 수로 정해짐 (lib/erd)
  entity:    { w: ENTITY.W, h: entityHeight(1), minW: ENTITY.MIN_W, minH: entityHeight(1) },
};

// ── 공통 핸들 — 4방향 source 단독 + connectionMode=loose ─────
function Handles({ visible }: { visible: boolean }) {
  const cls = (base: string) => `${base} ${visible ? '' : styles.handleHidden}`;
  return (
    <>
      <Handle type="source" position={Position.Top}    id="top"    className={cls(styles.handle)} />
      <Handle type="source" position={Position.Right}  id="right"  className={cls(styles.handle)} />
      <Handle type="source" position={Position.Bottom} id="bottom" className={cls(styles.handle)} />
      <Handle type="source" position={Position.Left}   id="left"   className={cls(styles.handle)} />
    </>
  );
}

// 카드 이름 기본 글자 크기(px) — 카드 크기에 비례 (7~14). 텍스트 패널도 이 값을 기본으로 보여줌
export const cardLabelFontPx = (width: number, height: number) =>
  Math.round(Math.max(7, Math.min(Math.min(width, height) * 0.11, 14)));
// 카드 아이콘 기본 크기(px) — 카드 크기에 비례 (16 이상). 아이콘 패널도 이 값을 기본으로 보여줌
export const cardIconPx = (width: number, height: number) =>
  Math.round(Math.max(16, Math.min(width, height) * 0.26));

// ── 어두운 아키텍처 카드 (인라인 라벨 편집 포함) ──────────────
function CardShape({ data, id, width, height }: { data: NodeData; id: string; width: number; height: number }) {
  const { updateNodeData } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(data.title);
  }, [data.title, editing]);

  // 편집 시작 — 전체 선택 대신 글자 끝에 커서
  useEffect(() => {
    const el = inputRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const commitEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== data.title) {
      updateNodeData(id, { title: trimmed });
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditing(false); setDraft(data.title); }
  };

  // 기본은 배경·테두리 없이 아이콘과 이름만 — 색을 고르면 그 색 카드로
  const plain = !data.bgColor || data.bgColor === 'transparent';
  const cardStyle = {
    background:    data.bgColor     ?? 'transparent',
    borderColor:   data.strokeColor ?? 'transparent',
    borderWidth:   data.strokeWidth ?? 1,
    boxShadow:     plain ? 'none' : undefined,
    color:         plain ? 'var(--text-primary)' : '#ffffff',   // 배경이 없으면 화면 글자색(라이트·다크 자동)
    borderStyle:   (data.strokeStyle ?? 'solid') as React.CSSProperties['borderStyle'],
    borderRadius:  canvasRadius(data.borderRadius ?? DEFAULT_RADIUS.card),
    opacity:       (data.opacity ?? 100) / 100,
    width,
    height,
    overflow: 'hidden' as const,
  };

  // 크기에 비례한 동적 스케일 값
  const minSide  = Math.min(width, height);
  const iconSize = data.iconSize ?? cardIconPx(width, height);   // 아이콘 패널에서 고른 크기, 없으면 카드 크기 비례
  const padV     = Math.round(Math.max(5,  height * 0.07));
  const padH     = Math.round(Math.max(5,  width  * 0.07));
  const gap      = Math.round(Math.max(2,  minSide * 0.04));

  // 이름 글씨 — 텍스트 패널에서 고른 값(크기·색·글꼴·굵게·기울임), 안 골랐으면 카드 크기에 맞춘 기본값
  const labelStyle: React.CSSProperties = {
    fontSize:   (data.fontSize as number | undefined) ?? cardLabelFontPx(width, height),
    color:      data.fontColor ?? cardStyle.color,
    fontFamily: data.fontFamily ? textFontFamily(data.fontFamily) : 'inherit',
    ...(data.fontWeight ? { fontWeight: cssWeight(data.fontWeight) } : {}),
    fontStyle:  (data.fontStyle as string | undefined) === 'italic' ? 'italic' : 'normal',
  };

  // 이름을 누르면 "글씨 선택" → 텍스트 패널, 아이콘을 누르면 "아이콘 선택" → 아이콘 패널(색·크기).
  // 카드 바탕을 누르면 다시 도형 패널
  const setEditingTextNodeId = useCanvasStore((s) => s.setEditingTextNodeId);
  const setEditingIconNodeId = useCanvasStore((s) => s.setEditingIconNodeId);
  const textPicked = useCanvasStore((s) => s.editingTextNodeId === id);
  const iconPicked = useCanvasStore((s) => s.editingIconNodeId === id);
  const backToShapePanel = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-card-label],[data-card-icon]')) return;
    if (textPicked) setEditingTextNodeId(null);
    if (iconPicked) setEditingIconNodeId(null);
  };
  // 고른 부분 표시 — 크기 조절 점이 숨는 대신 그 부분에 얇은 선
  const pickedOutline: React.CSSProperties = { outline: '1.5px solid #818cf8', outlineOffset: 2, borderRadius: 3 };

  return (
    <div className={styles.card} style={{ ...cardStyle, padding: `${padV}px ${padH}px`, gap }} onClick={backToShapePanel}>
      <div
        data-card-icon
        className={styles.cardIconWrap}
        style={{ width: iconSize, height: iconSize, color: data.iconColor ?? cardStyle.color, cursor: 'pointer', ...(iconPicked ? pickedOutline : {}) }}
        onClick={() => setEditingIconNodeId(id)}
      >
        {getArchIcon(data.type, iconSize)}
      </div>

      {editing ? (
        <input
          ref={inputRef}
          data-card-label
          className={`${styles.cardLabelInput} nopan`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          maxLength={40}
          style={{ ...labelStyle, width: Math.max(60, width - padH * 2) }}
        />
      ) : (
        <div
          data-card-label
          className={styles.cardLabel}
          style={{ ...labelStyle, maxWidth: Math.max(60, width - padH * 2), ...(textPicked ? pickedOutline : {}) }}
          onClick={() => setEditingTextNodeId(id)}
          onDoubleClick={() => { setDraft(data.title); setEditing(true); }}
        >
          {data.title}
        </div>
      )}
    </div>
  );
}

// ── 스케일링 아키텍처 페이지 (2행1열과 동일 패턴 — 흑백 + 꺽은선) ─
const ScalingArchitecturePage = React.memo(function ScalingArchitecturePage({
  width, height, onPageDoubleClick,
}: { width: number; height: number; onPageDoubleClick?: () => void }) {
  // 넓은 기준 크기 → 균형 잡힌 간격
  const BASE_W  = 1300;
  const BASE_H  = 900;
  const TITLE_H = 38;                                              // 상단 타이틀 배지 예약 높이
  const scale   = Math.min(width / BASE_W, (height - TITLE_H) / BASE_H);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // NW×NH 카드 — 모두 흑백 (#242424)
  const NW = 100, NH = 75;
  const sCard = (id: string, nodeType: NodeData['type'], label: string, x: number, y: number) => {
    const isSel = selectedId === id;
    return (
      <div
        key={id}
        className={`nodrag nopan ${styles.archInteractive} ${isSel ? styles.archInteractiveSelected : ''}`}
        onClick={(e) => { e.stopPropagation(); setSelectedId(isSel ? null : id); }}
        style={{ position: 'absolute', left: x, top: y, zIndex: 2 }}
      >
        <div style={{
          width: NW, height: NH,
          background: '#242424',
          border: '1px solid #3a3a3a',
          borderRadius: 12, overflow: 'hidden', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 4, padding: '6px', boxShadow: '0 2px 8px rgba(0,0,0,0.40)', cursor: 'pointer',
        }}>
          <div style={{ color: '#fff', flexShrink: 0 }}>{getArchIcon(nodeType, 19)}</div>
          <div style={{
            fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.88)',
            textAlign: 'center', lineHeight: 1.3, maxWidth: NW - 10,
            overflow: 'hidden', wordBreak: 'break-word' as const,
          }}>{label}</div>
        </div>
        {isSel && (
          <>
            <div className={`${styles.archHandle} ${styles.archHandleTop}`}/>
            <div className={`${styles.archHandle} ${styles.archHandleBottom}`}/>
            <div className={`${styles.archHandle} ${styles.archHandleLeft}`}/>
            <div className={`${styles.archHandle} ${styles.archHandleRight}`}/>
          </>
        )}
      </div>
    );
  };

  const G = (x: number, y: number, w: number, h: number, dash = false): React.CSSProperties => ({
    position: 'absolute', left: x, top: y, width: w, height: h,
    background: 'rgba(255,255,255,0.025)',
    border: `1px ${dash ? 'dashed' : 'solid'} rgba(255,255,255,0.22)`,
    borderRadius: 12, boxSizing: 'border-box',
  });
  const GL = (text: string) => (
    <span style={{
      position: 'absolute', top: -11, left: 12,
      color: 'rgba(255,255,255,0.50)', fontSize: 9, fontWeight: 600,
      letterSpacing: '0.06em', textTransform: 'uppercase' as const,
      background: '#111111', padding: '0 4px', pointerEvents: 'none',
    }}>{text}</span>
  );

  // 꺽은선 헬퍼 — 연결 유형별 색·선 구분
  const mkPath    = (d: string, dash = false) => (               // 기본 트래픽 (흰색)
    <path d={d} stroke="rgba(255,255,255,0.38)" strokeWidth="1.1" fill="none"
      strokeDasharray={dash ? '5 3' : undefined} markerEnd="url(#sc-arr)"/>
  );
  const mkRead    = (d: string) => (                             // DB Read  → 하늘색
    <path d={d} stroke="rgba(103,232,249,0.75)" strokeWidth="1.3" fill="none" markerEnd="url(#sc-arr-read)"/>
  );
  const mkWrite   = (d: string) => (                             // DB Write → 황색
    <path d={d} stroke="rgba(251,191,36,0.80)"  strokeWidth="1.5" fill="none" markerEnd="url(#sc-arr-write)"/>
  );
  const mkRepl    = (d: string) => (                             // Replication → 흰 점선
    <path d={d} stroke="rgba(255,255,255,0.28)" strokeWidth="1.0" fill="none"
      strokeDasharray="5 3" markerEnd="url(#sc-arr)"/>
  );
  const mkBlob    = (d: string) => (                             // Blob/Signed URL → 보라 점선
    <path d={d} stroke="rgba(192,132,252,0.70)" strokeWidth="1.2" fill="none"
      strokeDasharray="3 2" markerEnd="url(#sc-arr-blob)"/>
  );
  const mkLabel = (x: number, y: number, text: string) => (
    <text x={x} y={y} fill="rgba(255,255,255,0.55)" fontSize="8" fontFamily="'Segoe UI',sans-serif">{text}</text>
  );

  /*
   * Layout — BASE_W=1300, BASE_H=900, NW=100, NH=75
   * Columns (left edge):  Mobile=30  CDN=175  LB=335  API=495  DBLeft=655  DBRight=820/950  DBMid=885
   * CDN y:  30/175/320/465  (center: 67/212/357/502)
   * LB  y:  175/430         (center: 212/467)
   * API y:  30/150/270/390/510/630  (center: 67/187/307/427/547/667)
   * DB Leader: x=655 y=175   Followers: F1=820,30  F2=950,30  F3=885,175
   * Shards: S1=655,355  S2=790,355
   * Blob:   EU=655,505  NA=790,505  APAC=655,615  SA=790,615
   */

  return (
    <div
      style={{
        width, height, background: '#111111', overflow: 'hidden', position: 'relative',
        border: '1px solid rgba(80,80,80,0.6)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={onPageDoubleClick}
      onClick={() => setSelectedId(null)}
    >
      <div style={{
        position: 'absolute', top: TITLE_H, left: 0,
        width: BASE_W, height: BASE_H,
        transformOrigin: 'top left',
        transform: `scale(${scale})`,
        fontFamily: "'Segoe UI',sans-serif",
      }}>

        {/* ── SVG 꺽은선 ── */}
        <svg style={{ position:'absolute', inset:0, width:BASE_W, height:BASE_H, pointerEvents:'none', zIndex:1 }}>
          <defs>
            <marker id="sc-arr"       viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.45)"/>
            </marker>
            <marker id="sc-arr-read"  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(103,232,249,0.80)"/>
            </marker>
            <marker id="sc-arr-write" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(251,191,36,0.85)"/>
            </marker>
            <marker id="sc-arr-blob"  viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(192,132,252,0.80)"/>
            </marker>
          </defs>

          {/* Mobile → CDNs (bend x=152) */}
          {mkPath('M 130,374 L 152,374 L 152,67  L 175,67')}
          {mkPath('M 130,374 L 152,374 L 152,212 L 175,212')}
          {mkPath('M 130,374 L 152,374 L 152,357 L 175,357')}
          {mkPath('M 130,374 L 152,374 L 152,502 L 175,502')}

          {/* CDN → LB (bend x=308) */}
          {mkPath('M 275,67  L 308,67  L 308,212 L 335,212')}
          {mkPath('M 275,212 L 335,212')}
          {mkPath('M 275,357 L 308,357 L 308,467 L 335,467')}
          {mkPath('M 275,502 L 308,502 L 308,467 L 335,467')}

          {mkLabel(310, 148, 'LRU')}

          {/* LB → API (bend x=468) */}
          {mkPath('M 435,212 L 468,212 L 468,67  L 495,67')}
          {mkPath('M 435,212 L 468,212 L 468,187 L 495,187')}
          {mkPath('M 435,212 L 468,212 L 468,307 L 495,307')}
          {mkPath('M 435,467 L 468,467 L 468,427 L 495,427')}
          {mkPath('M 435,467 L 468,467 L 468,547 L 495,547')}
          {mkPath('M 435,467 L 468,467 L 468,667 L 495,667')}

          {/* API 1-3 → DB Followers (Reads — 하늘색) */}
          {mkRead('M 595,67  L 1065,67')}
          {mkRead('M 595,187 L 612,187 L 612,67  L 1195,67')}
          {mkRead('M 595,307 L 608,307 L 608,212 L 1130,212')}

          {/* API4 → DB Leader (Writes — 황색) */}
          {mkWrite('M 595,427 L 632,427 L 632,212 L 900,212')}

          {/* DB Leader → Followers replication (흰 점선) */}
          {mkRepl('M 1000,212 L 1033,212 L 1033,67  L 1065,67')}
          {mkRepl('M 1000,212 L 1033,212 L 1033,67  L 1195,67')}
          {mkRepl('M 1000,212 L 1130,212')}

          {mkLabel(1037, 148, 'Replication')}

          {/* Read / Write labels */}
          {mkLabel(598, 62,  'Reads')}
          {mkLabel(626, 182, 'Reads')}
          {mkLabel(626, 302, 'Reads')}
          {mkLabel(626, 422, 'Writes')}

          {/* API 5,6 → Shards (Reads — 하늘색) */}
          {mkRead('M 595,547 L 620,547 L 620,392 L 900,392')}
          {mkRead('M 595,667 L 616,667 L 616,392 L 1035,392')}

          {/* API → Blob Storage (Signed URL — 보라 점선) */}
          {mkBlob('M 595,427 L 640,427 L 640,542 L 900,542')}
          {mkBlob('M 595,547 L 648,547 L 648,542 L 1035,542')}
          {mkBlob('M 595,547 L 656,547 L 656,652 L 900,652')}
          {mkBlob('M 595,667 L 664,667 L 664,652 L 1035,652')}

          {mkLabel(634, 537, 'Signed URL')}
          {mkLabel(646, 647, 'Signed URL')}
        </svg>

        {/* ── 그룹 프레임 ── */}
        <div style={G(162, 15, 118, 540, true)}>{GL('☁ CDN Edges')}</div>
        <div style={G(322, 160, 118, 358)}>{GL('⊜ Load Balancers')}</div>
        <div style={G(482, 15, 118, 700)}>{GL('⊞ API Servers')}</div>
        {/* DB TIER — 오른쪽 끝 거의 붙게 (F2 right≈1295) */}
        <div style={G(885, 15, 405, 428)}>
          {GL('⊞ Database Tier')}
          {/* Followers 내부 그룹 (상대: F1=180, F2=310, F3=245) */}
          <div style={{ ...G(170, 5, 235, 248), position:'absolute' }}>
            {GL('⊟ Followers')}
          </div>
          {/* Shards 내부 그룹 (상대: S1=15, S2=150) */}
          <div style={{ ...G(5, 330, 238, 95), position:'absolute' }}>
            {GL('⊟ Shards')}
          </div>
        </div>
        {/* BLOB STORAGE */}
        <div style={G(885, 490, 405, 212)}>{GL('☁ Blob Storage Replicas')}</div>

        {/* ── 노드 ── */}
        {sCard('sc-mobile',    'mobile',        'Mobile Apps',       30,  337)}
        {sCard('sc-cdn-na',    'client',        'CDN Edge NA',      175,   30)}
        {sCard('sc-cdn-eu',    'client',        'CDN Edge EU',      175,  175)}
        {sCard('sc-cdn-apac',  'client',        'CDN Edge APAC',    175,  320)}
        {sCard('sc-cdn-sa',    'client',        'CDN Edge SA',      175,  465)}
        {sCard('sc-lb-b',      'load_balancer', 'Load Balancer B',  335,  175)}
        {sCard('sc-lb-a',      'load_balancer', 'Load Balancer A',  335,  430)}
        {sCard('sc-api-1',     'server',        'API Server 1',     495,   30)}
        {sCard('sc-api-2',     'server',        'API Server 2',     495,  150)}
        {sCard('sc-api-3',     'server',        'API Server 3',     495,  270)}
        {sCard('sc-api-4',     'server',        'API Server 4',     495,  390)}
        {sCard('sc-api-5',     'server',        'API Server 5',     495,  510)}
        {sCard('sc-api-6',     'server',        'API Server 6',     495,  630)}
        {sCard('sc-leader',    'database',      'DB Leader\nWrites', 900, 175)}
        {sCard('sc-f1',        'database',      'DB Follower\nReads',1065, 30)}
        {sCard('sc-f2',        'database',      'DB Follower\nReads',1195, 30)}
        {sCard('sc-f3',        'database',      'DB Follower\nReads',1130,175)}
        {sCard('sc-s1',        'database',      'Shard 1',           900, 355)}
        {sCard('sc-s2',        'database',      'Shard 2',           1035,355)}
        {sCard('sc-blob-eu',   'storage',       'Blob EU',           900, 505)}
        {sCard('sc-blob-na',   'storage',       'Blob NA',           1035,505)}
        {sCard('sc-blob-apac', 'storage',       'Blob APAC',         900, 615)}
        {sCard('sc-blob-sa',   'storage',       'Blob SA',           1035,615)}

      </div>

        {/* 제목 — 스케일 밖, 외부 컨테이너 기준 왼쪽 위 */}
        <div style={{
          position: 'absolute', top: 6, left: 8, zIndex: 10,
          background: '#1e1e1e', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 7, padding: '5px 12px',
          fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.80)',
          display: 'flex', alignItems: 'center', gap: 6, pointerEvents: 'none',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="7 17 17 7"/><polyline points="7 7 17 7 17 17"/>
          </svg>
          Scaling to 50M Users
        </div>
    </div>
  );
});

// ── High Level Architecture 다이어그램 페이지 (인터랙티브) ─────
interface ArchitectureDiagramPageProps {
  width: number;
  height: number;
  nodeId: string;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const ArchitectureDiagramPage = React.memo(function ArchitectureDiagramPage({
  width, height, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: ArchitectureDiagramPageProps) {
  const BASE_W = 1123;
  const BASE_H = 794;
  const scale  = width / BASE_W;

  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const ovr = useCallback((id: string): DocTemplateElementStyle => templateContent?.[id] ?? {}, [templateContent]);

  const handleDoubleClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation(); setEditingElementId(id);
  }, []);

  const commitEdit = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) return;
    onContentChange?.(id, el.innerText ?? '');
    setEditingElementId(null);
  }, [onContentChange]);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  // 인터랙티브 래퍼 — showHandles=true 일 때 캔버스 핸들과 동일한 연결 핸들 표시
  const interactive = useCallback((id: string, children: React.ReactNode, editBg = '#242424', showHandles = false) => {
    const isSelected = selectedElementId === id;
    const isEditing  = editingElementId === id;
    const elemOvr    = templateContent?.[id];
    const transform  = (elemOvr?.dx || elemOvr?.dy) ? `translate(${elemOvr.dx ?? 0}px,${elemOvr.dy ?? 0}px)` : undefined;
    const editSize   = elemOvr?.fontSize   ?? 10.5;
    const editWeight = elemOvr?.fontWeight ?? 'normal';
    const editColor  = elemOvr?.color      ?? '#ffffff';
    return (
      <div
        key={id}
        className={`nodrag nopan ${styles.archInteractive} ${isSelected ? styles.archInteractiveSelected : ''}`}
        onClick={(e) => { if (!isEditing) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => handleDoubleClick(e, id)}
        onMouseDown={(e) => { if (isSelected && !isEditing) handleDragStart(e, id); }}
        style={{
          transform,
          ...(showHandles ? { width: 'fit-content', height: 'fit-content' } : {}),
          cursor: isEditing ? 'text' : isSelected ? 'grab' : 'pointer',
          ...(isEditing ? { outline: '2px solid #22c55e', outlineOffset: '2px' } : {}),
        }}
      >
        {children}
        {/* 연결 핸들 (캔버스 CardShape와 동일 스타일) */}
        {showHandles && (
          <>
            <div className={`${styles.archHandle} ${styles.archHandleTop}`}/>
            <div className={`${styles.archHandle} ${styles.archHandleBottom}`}/>
            <div className={`${styles.archHandle} ${styles.archHandleLeft}`}/>
            <div className={`${styles.archHandle} ${styles.archHandleRight}`}/>
          </>
        )}
        {isEditing && (
          <div contentEditable suppressContentEditableWarning
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onBlur={(e) => { e.stopPropagation(); commitEdit(id, e.currentTarget as HTMLDivElement); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') commitEdit(id, e.currentTarget as HTMLDivElement); }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 1, background: elemOvr?.background ?? editBg,
              borderRadius: 5, padding: '4px 6px', outline: 'none', cursor: 'text',
              fontSize: editSize, fontWeight: editWeight, color: editColor,
              fontFamily: 'inherit', lineHeight: 1.4, zIndex: 20,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: (templateContent?.[id]?.content ?? DEFAULT_CONTENT[id] ?? '').replace(/\n/g, '<br/>') }}
          />
        )}
      </div>
    );
  }, [selectedElementId, editingElementId, templateContent, onElementClick, handleDoubleClick, handleDragStart, commitEdit]);

  // CardShape 스타일 노드 (캔버스 CardShape 100×90과 동일)
  const archCard = (id: string, nodeType: NodeData['type'], fallback: string, bg = '#242424') => {
    const o = ovr(id);
    return interactive(id,
      <div style={{
        width: 100, height: 90,
        background: o.background ?? bg,
        border: `1px solid ${o.borderColor ?? (bg === '#242424' ? '#3a3a3a' : 'rgba(255,255,255,0.22)')}`,
        borderRadius: 12, overflow: 'hidden', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: '8px 8px', boxShadow: '0 2px 8px rgba(0,0,0,0.40)',
      }}>
        <div style={{ color: '#fff', flexShrink: 0 }}>{getArchIcon(nodeType, 23)}</div>
        <div style={{
          fontSize: o.fontSize ?? 10.5, fontWeight: o.fontWeight ?? '600',
          color: o.color ?? '#fff', textAlign: 'center', lineHeight: 1.3,
          maxWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{o.content ?? DEFAULT_CONTENT[id] ?? fallback}</div>
      </div>
    , o.background ?? bg, true);
  };

  return (
    <div
      style={{
        width, height, background: '#111111', overflow: 'hidden', position: 'relative',
        border: '1px solid rgba(80,80,80,0.6)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={onPageDoubleClick}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: BASE_W, height: BASE_H,
        transformOrigin: 'top left', transform: `scale(${scale})`,
        fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif",
      }}>
        {/* SVG 연결선 */}
        <svg style={{ position:'absolute', inset:0, width:BASE_W, height:BASE_H, pointerEvents:'none', zIndex:1 }}>
          <defs>
            <marker id="arch-arr" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.55)"/>
            </marker>
          </defs>
          <line x1="165" y1="360" x2="228" y2="360" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" markerEnd="url(#arch-arr)"/>
          <line x1="338" y1="360" x2="418" y2="360" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" markerEnd="url(#arch-arr)"/>
          <line x1="738" y1="280" x2="840" y2="280" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" markerEnd="url(#arch-arr)"/>
          <line x1="738" y1="480" x2="840" y2="480" stroke="rgba(255,255,255,0.45)" strokeWidth="1.5" markerEnd="url(#arch-arr)"/>
        </svg>

        {/* 화살표 클릭 히트박스 (SVG 위에 투명 div로 올림) */}
        <div style={{ position:'absolute', left:165, top:353, zIndex:3 }}>
          {interactive('arch-edge-mobile', <div style={{ width:63, height:14, background:'transparent' }}/>, '#111')}
        </div>
        <div style={{ position:'absolute', left:338, top:353, zIndex:3 }}>
          {interactive('arch-edge-lb', <div style={{ width:80, height:14, background:'transparent' }}/>, '#111')}
        </div>
        <div style={{ position:'absolute', left:738, top:273, zIndex:3 }}>
          {interactive('arch-edge-db', <div style={{ width:102, height:14, background:'transparent' }}/>, '#111')}
        </div>
        <div style={{ position:'absolute', left:738, top:473, zIndex:3 }}>
          {interactive('arch-edge-storage', <div style={{ width:102, height:14, background:'transparent' }}/>, '#111')}
        </div>

        {/* 제목 */}
        <div style={{ position:'absolute', top:28, left:28, zIndex:2 }}>
          {interactive('arch-title',
            <div style={{
              background: ovr('arch-title').background ?? '#1e1e1e',
              border:'1px solid rgba(255,255,255,0.12)', borderRadius:7, padding:'6px 14px',
              fontSize: ovr('arch-title').fontSize ?? 12, fontWeight: ovr('arch-title').fontWeight ?? '600',
              color: ovr('arch-title').color ?? 'rgba(255,255,255,0.82)',
              display:'flex', alignItems:'center', gap:6,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="7 17 17 7"/><polyline points="7 7 17 7 17 17"/>
              </svg>
              {ovr('arch-title').content ?? DEFAULT_CONTENT['arch-title']}
            </div>
          , '#1e1e1e')}
        </div>

        {/* Mobile App */}
        <div style={{ position:'absolute', left:55, top:316, zIndex:2 }}>
          {archCard('arch-mobile', 'mobile', 'Mobile App')}
        </div>

        {/* HTTP Requests 레이블 */}
        <div style={{ position:'absolute', left:145, top:335, zIndex:2 }}>
          {interactive('arch-label-http',
            <div style={{ fontSize: ovr('arch-label-http').fontSize ?? 10, color: ovr('arch-label-http').color ?? 'rgba(255,255,255,0.50)', whiteSpace:'nowrap', padding:'2px 4px' }}>
              {ovr('arch-label-http').content ?? DEFAULT_CONTENT['arch-label-http']}
            </div>
          , '#111')}
        </div>

        {/* Load Balancer */}
        <div style={{ position:'absolute', left:228, top:316, zIndex:2 }}>
          {archCard('arch-lb', 'load_balancer', 'Load Balancer', '#7c3aed')}
        </div>

        {/* WEB/API LAYER 컨테이너 — interactive 프레임 */}
        <div style={{ position:'absolute', left:418, top:130, zIndex:2 }}>
          {interactive('arch-layer-frame',
            <div style={{
              width:320, height:500,
              background:'rgba(30,20,5,0.95)', border:'1.5px solid #c9a227',
              borderRadius:14, display:'flex', flexDirection:'column',
            }}>
              <div style={{ padding:'14px 18px 12px', display:'flex', alignItems:'center', gap:9 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c9a227" strokeWidth="1.8">
                  <rect x="2" y="3" width="20" height="14" rx="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                {interactive('arch-layer-title',
                  <span style={{ fontSize: ovr('arch-layer-title').fontSize ?? 10.5, fontWeight: ovr('arch-layer-title').fontWeight ?? '700', letterSpacing:'0.10em', color: ovr('arch-layer-title').color ?? '#c9a227' }}>
                    {ovr('arch-layer-title').content ?? DEFAULT_CONTENT['arch-layer-title']}
                  </span>
                , '#1a1208')}
              </div>
              <div style={{ padding:'0 18px', display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {archCard('arch-api1', 'api_server', 'API Server 1')}
                {archCard('arch-api2', 'api_server', 'API Server 2')}
              </div>
              <div style={{ padding:'14px 18px 0', display:'flex', justifyContent:'center' }}>
                {archCard('arch-api3', 'api_server', 'API Server 3')}
              </div>
            </div>
          , '#1a1208')}
        </div>

        {/* Metadata Queries 레이블 */}
        <div style={{ position:'absolute', left:742, top:260, zIndex:2 }}>
          {interactive('arch-label-meta',
            <div style={{ fontSize: ovr('arch-label-meta').fontSize ?? 10, color: ovr('arch-label-meta').color ?? 'rgba(255,255,255,0.50)', whiteSpace:'nowrap', padding:'2px 4px' }}>
              {ovr('arch-label-meta').content ?? DEFAULT_CONTENT['arch-label-meta']}
            </div>
          , '#111')}
        </div>

        {/* Generate Signed URLs 레이블 */}
        <div style={{ position:'absolute', left:742, top:460, zIndex:2 }}>
          {interactive('arch-label-url',
            <div style={{ fontSize: ovr('arch-label-url').fontSize ?? 10, color: ovr('arch-label-url').color ?? 'rgba(255,255,255,0.50)', whiteSpace:'nowrap', padding:'2px 4px' }}>
              {ovr('arch-label-url').content ?? DEFAULT_CONTENT['arch-label-url']}
            </div>
          , '#111')}
        </div>

        {/* SQL Database */}
        <div style={{ position:'absolute', left:840, top:236, zIndex:2 }}>
          {archCard('arch-db', 'database', 'SQL Database')}
        </div>

        {/* Blob Storage */}
        <div style={{ position:'absolute', left:840, top:436, zIndex:2 }}>
          {archCard('arch-storage', 'storage', 'Blob Storage')}
        </div>

      </div>
    </div>
  );
});

// ── 시퀀스 다이어그램 자동 포커스 래퍼 (마운트 시 focus 설정) ──
function SequenceDiagramFocusWrapper({ id, children }: { id: string; children: React.ReactNode }) {
  React.useEffect(() => {
    useCanvasStore.getState().setFocusedDocTemplate('sequence-diagram');
    return () => {
      // 언마운트 시 현재 포커스가 이 페이지면 해제
      if (useCanvasStore.getState().focusedDocTemplate === 'sequence-diagram') {
        useCanvasStore.getState().setFocusedDocTemplate(null);
      }
    };
  }, [id]);
  return <>{children}</>;
}

// ── 시퀀스 다이어그램 페이지 ─────────────────────────────────
interface SequenceDiagramPageProps {
  width: number;
  height: number;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const SequenceDiagramPage = React.memo(function SequenceDiagramPage({
  width, height, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: SequenceDiagramPageProps) {
  const BASE_W = 1123, BASE_H = 794;
  const scale = width / BASE_W;
  const AW = 130, AH = 46, ACTOR_TOP = 22, LIFELINE_BOT = 690;

  const [editingId, setEditingId] = useState<string | null>(null);
  const ovr = useCallback((id: string): DocTemplateElementStyle => templateContent?.[id] ?? {}, [templateContent]);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  const interactive = useCallback((id: string, children: React.ReactNode, defaultContent?: string) => {
    const isSel = selectedElementId === id;
    const isEd  = editingId === id;
    const o     = templateContent?.[id];
    const transform = (o?.dx || o?.dy) ? `translate(${o.dx ?? 0}px, ${o.dy ?? 0}px)` : undefined;
    return (
      <div
        key={id}
        className="nodrag nopan"
        onClick={(e) => { if (!isEd) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(id); }}
        onMouseDown={(e) => { if (isSel && !isEd) handleDragStart(e, id); }}
        style={{
          position: 'relative', display: 'inline-block',
          cursor: isEd ? 'text' : isSel ? 'grab' : 'pointer',
          outline: isSel ? (isEd ? '2px solid #22c55e' : '2px solid #3b82f6') : 'none',
          outlineOffset: 2, borderRadius: 3, transform,
        }}
        onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.outline = '1.2px solid rgba(96,165,250,0.45)'; }}
        onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.outline = 'none'; }}
      >
        {children}
        {isEd && (
          <div
            contentEditable suppressContentEditableWarning
            ref={(el) => { if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
            onBlur={(e) => { e.stopPropagation(); onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(20,20,20,0.97)',
              borderRadius: 3, padding: '2px 6px', outline: 'none', cursor: 'text',
              fontSize: 'inherit', color: '#e5e7eb', fontFamily: 'inherit',
              lineHeight: 'inherit', zIndex: 30, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: (o?.content ?? '').replace(/\n/g, '<br/>') }}
          />
        )}
      </div>
    );
  }, [selectedElementId, editingId, templateContent, onElementClick, handleDragStart, onContentChange]);

  const actors = [
    { id: 'user', label: 'User',          cx: 80   },
    { id: 'mob',  label: 'Mobile App',    cx: 273  },
    { id: 'lb',   label: 'Load Balancer', cx: 466  },
    { id: 'api',  label: 'API Server',    cx: 659  },
    { id: 'db',   label: 'SQL Database',  cx: 852  },
    { id: 'blob', label: 'Blob Storage',  cx: 1045 },
  ];

  type SStep = { num: string; fi: number; ti: number; y: number; label: string; self?: boolean };
  const steps: SStep[] = [
    { num: '1',     fi: 0, ti: 1, y: 108, label: 'Hits play button' },
    { num: '2',     fi: 1, ti: 2, y: 152, label: 'GET /songs/{id}' },
    { num: '3',     fi: 2, ti: 3, y: 196, label: 'Route request' },
    { num: '4',     fi: 3, ti: 3, y: 240, label: 'Validate JWT token', self: true },
    { num: '5.1',   fi: 3, ti: 4, y: 308, label: 'Query song metadata' },
    { num: '5.2',   fi: 4, ti: 3, y: 352, label: 'Return song details' },
    { num: '5.3',   fi: 3, ti: 3, y: 396, label: 'Generate signed URL', self: true },
    { num: '5.4',   fi: 3, ti: 1, y: 440, label: 'Return metadata + signed URL' },
    { num: '5.5.1', fi: 1, ti: 5, y: 486, label: 'Range requests for audio chunks' },
    { num: '5.5.2', fi: 5, ti: 1, y: 528, label: 'Stream audio data' },
    { num: '5.6',   fi: 1, ti: 3, y: 572, label: 'POST /songs/{id}/play (analytics)' },
    { num: '6.1',   fi: 3, ti: 1, y: 634, label: 'Return authentication error' },
  ];

  const actorBox = (a: typeof actors[0], topY: number, key: string) => {
    const pos = topY === ACTOR_TOP ? 'top' : 'bot';
    const eid = `sd-actor-${a.id}-${pos}`;
    return (
      <div key={key} style={{ position: 'absolute', left: a.cx - AW / 2, top: topY, zIndex: 5 }}>
        {interactive(eid,
          <div style={{
            width: AW, height: AH,
            background: ovr(eid).background ?? '#1e1e1e',
            border: `1px solid ${ovr(eid).borderColor ?? 'rgba(255,255,255,0.28)'}`,
            borderRadius: ovr(eid).borderRadius ?? 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: ovr(eid).fontSize ?? 10,
            fontWeight: ovr(eid).fontWeight ?? '600',
            color: ovr(eid).color ?? '#fff',
            textAlign: 'center', lineHeight: 1.3, boxSizing: 'border-box', padding: '0 4px',
            opacity: ovr(eid).opacity != null ? ovr(eid).opacity! / 100 : 1,
          }}>
            {ovr(eid).content ?? a.label}
          </div>
        , a.label)}
      </div>
    );
  };

  const renderStep = (s: SStep) => {
    const from = actors[s.fi];
    const to   = actors[s.ti];
    const id   = `sd-step-${s.num}`;

    if (s.self) {
      return (
        <div key={id} style={{ position: 'absolute', left: 0, top: 0, width: BASE_W, height: BASE_H, pointerEvents: 'none' }}>
          <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible' }}>
            <path d={`M${from.cx},${s.y} h34 v22 h-34`}
              fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2"
              markerEnd="url(#sd-arr)"/>
            <circle cx={from.cx} cy={s.y} r="10"
              fill="#111" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
            <text x={from.cx} y={s.y + 3.5}
              fontSize="7" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontFamily="inherit">{s.num}</text>
          </svg>
          <div style={{ position: 'absolute', left: from.cx + 42, top: s.y - 4, pointerEvents: 'auto' }}>
            {interactive(id,
              <div style={{
                fontSize: ovr(id).fontSize ?? 8.5,
                color: ovr(id).color ?? 'rgba(255,255,255,0.7)',
                background: ovr(id).background,
                fontFamily: 'inherit', whiteSpace: 'pre-line', lineHeight: 1.35,
                fontWeight: ovr(id).fontWeight,
                padding: '1px 3px',
              }}>
                {ovr(id).content ?? s.label}
              </div>
            , s.label)}
          </div>
        </div>
      );
    }

    const fwd  = to.cx > from.cx;
    const x1   = from.cx + (fwd ? 12 : -12);
    const x2   = to.cx   + (fwd ? -8  :  8);
    const midX = (from.cx + to.cx) / 2;
    return (
      <div key={id} style={{ position: 'absolute', left: 0, top: 0, width: BASE_W, height: BASE_H, pointerEvents: 'none' }}>
        <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible' }}>
          <line x1={x1} y1={s.y} x2={x2} y2={s.y}
            stroke="rgba(255,255,255,0.6)" strokeWidth="1.2"
            markerEnd="url(#sd-arr)"/>
          <circle cx={from.cx} cy={s.y} r="10"
            fill="#111" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
          <text x={from.cx} y={s.y + 3.5}
            fontSize="7" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontFamily="inherit">{s.num}</text>
        </svg>
        <div style={{
          position: 'absolute', left: midX, top: s.y - 4,
          transform: 'translate(-50%, -100%)',
          pointerEvents: 'auto',
        }}>
          {interactive(id,
            <div style={{
              fontSize: ovr(id).fontSize ?? 8.5,
              color: ovr(id).color ?? 'rgba(255,255,255,0.7)',
              background: ovr(id).background,
              fontFamily: 'inherit', whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.3,
              fontWeight: ovr(id).fontWeight,
              padding: '1px 4px',
            }}>
              {ovr(id).content ?? s.label}
            </div>
          , s.label)}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        width, height, background: '#111', overflow: 'hidden', position: 'relative',
        border: '1px solid rgba(80,80,80,0.6)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={onPageDoubleClick}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: BASE_W, height: BASE_H,
        transformOrigin: 'top left', transform: `scale(${scale})`,
        fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif",
      }}>
        {/* Title badge (인터랙티브) */}
        <div style={{ position: 'absolute', top: 5, left: 15, zIndex: 10 }}>
          {interactive('sd-title',
            <div style={{
              fontSize: ovr('sd-title').fontSize ?? 9.5,
              color: ovr('sd-title').color ?? 'rgba(255,255,255,0.65)',
              background: ovr('sd-title').background,
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 4, padding: '2px 8px',
              display: 'flex', alignItems: 'center', gap: 5,
              fontWeight: ovr('sd-title').fontWeight,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="7 17 17 7"/><polyline points="7 7 17 7 17 17"/>
              </svg>
              {ovr('sd-title').content ?? 'Song Playback (Read Flow)'}
            </div>
          , 'Song Playback (Read Flow)')}
        </div>

        {/* Actor boxes — top */}
        {actors.map(a => actorBox(a, ACTOR_TOP, `at-${a.id}`))}

        {/* SVG layer: lifelines + frame geometry only (no text) */}
        <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible', zIndex: 1 }}>
          <defs>
            <marker id="sd-arr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.65)"/>
            </marker>
          </defs>

          {/* Lifelines */}
          {actors.map(a => (
            <line key={`ll-${a.id}`}
              x1={a.cx} y1={ACTOR_TOP + AH} x2={a.cx} y2={LIFELINE_BOT}
              stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="5,4"
            />
          ))}

          {/* ALT frame geometry */}
          <rect x={15} y={278} width={1093} height={380}
            fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1"/>
          <polygon points="15,278 68,278 80,291 68,304 15,304"
            fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" strokeWidth="1"/>

          {/* PAR frame geometry */}
          <rect x={40} y={458} width={1043} height={108}
            fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="4,2"/>
          <polygon points="40,458 96,458 107,470 96,482 40,482"
            fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" strokeWidth="1"/>

          {/* ALT 구분선 geometry */}
          <line x1={15} y1={608} x2={1108} y2={608}
            stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="6,3"/>
          <polygon points="15,608 68,608 80,621 68,634 15,634"
            fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" strokeWidth="1"/>
        </svg>

        {/* ALT frame labels (인터랙티브) */}
        <div style={{ position: 'absolute', left: 25, top: 284, zIndex: 4 }}>
          {interactive('sd-alt-label',
            <div style={{
              fontSize: ovr('sd-alt-label').fontSize ?? 10,
              color: ovr('sd-alt-label').color ?? 'rgba(255,255,255,0.85)',
              background: ovr('sd-alt-label').background,
              fontWeight: ovr('sd-alt-label').fontWeight ?? '700',
              fontFamily: 'inherit',
            }}>
              {ovr('sd-alt-label').content ?? 'alt'}
            </div>
          , 'alt')}
        </div>
        <div style={{ position: 'absolute', left: 88, top: 284, zIndex: 4 }}>
          {interactive('sd-alt-valid-cond',
            <div style={{
              fontSize: ovr('sd-alt-valid-cond').fontSize ?? 9,
              color: ovr('sd-alt-valid-cond').color ?? 'rgba(255,255,255,0.55)',
              background: ovr('sd-alt-valid-cond').background,
              fontFamily: 'inherit', fontWeight: ovr('sd-alt-valid-cond').fontWeight,
            }}>
              {ovr('sd-alt-valid-cond').content ?? '[JWT valid]'}
            </div>
          , '[JWT valid]')}
        </div>

        {/* PAR frame labels (인터랙티브) */}
        <div style={{ position: 'absolute', left: 50, top: 463, zIndex: 4 }}>
          {interactive('sd-par-label',
            <div style={{
              fontSize: ovr('sd-par-label').fontSize ?? 10,
              color: ovr('sd-par-label').color ?? 'rgba(255,255,255,0.75)',
              background: ovr('sd-par-label').background,
              fontWeight: ovr('sd-par-label').fontWeight ?? '700',
              fontFamily: 'inherit',
            }}>
              {ovr('sd-par-label').content ?? 'par'}
            </div>
          , 'par')}
        </div>
        <div style={{ position: 'absolute', left: 115, top: 463, zIndex: 4 }}>
          {interactive('sd-par-cond',
            <div style={{
              fontSize: ovr('sd-par-cond').fontSize ?? 9,
              color: ovr('sd-par-cond').color ?? 'rgba(255,255,255,0.5)',
              background: ovr('sd-par-cond').background,
              fontFamily: 'inherit', fontWeight: ovr('sd-par-cond').fontWeight,
            }}>
              {ovr('sd-par-cond').content ?? '♪  [Audio streaming]'}
            </div>
          , '♪  [Audio streaming]')}
        </div>

        {/* ALT invalid separator labels (인터랙티브) */}
        <div style={{ position: 'absolute', left: 25, top: 614, zIndex: 4 }}>
          {interactive('sd-alt-invalid-x',
            <div style={{
              fontSize: ovr('sd-alt-invalid-x').fontSize ?? 10,
              color: ovr('sd-alt-invalid-x').color ?? 'rgba(255,255,255,0.75)',
              background: ovr('sd-alt-invalid-x').background,
              fontWeight: ovr('sd-alt-invalid-x').fontWeight ?? '700',
              fontFamily: 'inherit',
            }}>
              {ovr('sd-alt-invalid-x').content ?? '×'}
            </div>
          , '×')}
        </div>
        <div style={{ position: 'absolute', left: 88, top: 614, zIndex: 4 }}>
          {interactive('sd-alt-invalid-cond',
            <div style={{
              fontSize: ovr('sd-alt-invalid-cond').fontSize ?? 9,
              color: ovr('sd-alt-invalid-cond').color ?? 'rgba(255,255,255,0.55)',
              background: ovr('sd-alt-invalid-cond').background,
              fontFamily: 'inherit', fontWeight: ovr('sd-alt-invalid-cond').fontWeight,
            }}>
              {ovr('sd-alt-invalid-cond').content ?? '[JWT invalid]'}
            </div>
          , '[JWT invalid]')}
        </div>

        {/* Steps (인터랙티브) */}
        {steps.map(s => renderStep(s))}

        {/* Actor boxes — bottom */}
        {actors.map(a => actorBox(a, LIFELINE_BOT, `ab-${a.id}`))}
      </div>
    </div>
  );
});

// ── Audio Upload Flow 시퀀스 다이어그램 페이지 (인터랙티브) ──
interface AudioUploadSequencePageProps {
  width: number;
  height: number;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const AudioUploadSequencePage = React.memo(function AudioUploadSequencePage({
  width, height, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: AudioUploadSequencePageProps) {
  const BASE_W = 1123, BASE_H = 794;
  const scale = width / BASE_W;
  const AW = 130, AH = 46, ACTOR_TOP = 22, LIFELINE_BOT = 690;

  const [editingId, setEditingId] = useState<string | null>(null);
  const ovr = useCallback((id: string): DocTemplateElementStyle => templateContent?.[id] ?? {}, [templateContent]);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  const interactive = useCallback((id: string, children: React.ReactNode, defaultContent?: string) => {
    const isSel = selectedElementId === id;
    const isEd  = editingId === id;
    const o     = templateContent?.[id];
    const transform = (o?.dx || o?.dy) ? `translate(${o.dx ?? 0}px, ${o.dy ?? 0}px)` : undefined;
    return (
      <div
        key={id}
        className="nodrag nopan"
        onClick={(e) => { if (!isEd) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(id); }}
        onMouseDown={(e) => { if (isSel && !isEd) handleDragStart(e, id); }}
        style={{
          position: 'relative', display: 'inline-block',
          cursor: isEd ? 'text' : isSel ? 'grab' : 'pointer',
          outline: isSel ? (isEd ? '2px solid #22c55e' : '2px solid #3b82f6') : 'none',
          outlineOffset: 2, borderRadius: 3, transform,
        }}
        onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.outline = '1.2px solid rgba(96,165,250,0.45)'; }}
        onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.outline = 'none'; }}
      >
        {children}
        {isEd && (
          <div
            contentEditable suppressContentEditableWarning
            ref={(el) => { if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
            onBlur={(e) => { e.stopPropagation(); onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(20,20,20,0.97)',
              borderRadius: 3, padding: '2px 6px', outline: 'none', cursor: 'text',
              fontSize: 'inherit', color: '#e5e7eb', fontFamily: 'inherit',
              lineHeight: 'inherit', zIndex: 30, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: (o?.content ?? '').replace(/\n/g, '<br/>') }}
          />
        )}
      </div>
    );
  }, [selectedElementId, editingId, templateContent, onElementClick, handleDragStart, onContentChange]);

  const actors = [
    { id: 'artist', label: 'Artist',        cx: 95   },
    { id: 'mob',    label: 'Mobile App',    cx: 285  },
    { id: 'lb',     label: 'Load Balancer', cx: 475  },
    { id: 'api',    label: 'API Server',    cx: 665  },
    { id: 'blob',   label: 'Blob Storage',  cx: 855  },
    { id: 'db',     label: 'SQL Database',  cx: 1045 },
  ];

  type Step = { num: string; fi: number; ti: number; y: number; label: string; self?: boolean; dashed?: boolean };
  const steps: Step[] = [
    { num: '1',     fi: 0, ti: 1, y: 110, label: 'Start audio upload' },
    { num: '2',     fi: 1, ti: 2, y: 154, label: 'POST /songs/upload\n(multipart)\n(audio file, metadata)' },
    { num: '3',     fi: 2, ti: 3, y: 220, label: 'Forward upload request' },
    { num: '4',     fi: 3, ti: 3, y: 268, label: 'Validate file\nformat and size', self: true },
    // alt frame: y=302 to ~720
    { num: '5.1',   fi: 3, ti: 1, y: 360, label: 'Reject upload\n(unsupported format or size)', dashed: true },
    // separator at y=400
    { num: '6.1',   fi: 3, ti: 4, y: 432, label: 'Store file in\n/pending/upload_id/' },
    { num: '6.2',   fi: 3, ti: 3, y: 488, label: 'Extract audio\nmetadata\n(duration,\nbitrate)', self: true },
    { num: '6.3',   fi: 3, ti: 5, y: 564, label: 'Insert song, artist, and\nmapping records' },
    { num: '6.4',   fi: 3, ti: 4, y: 614, label: 'Move file to\n/artist/{artist_id}/album/{album_id}/' },
    // par frame: y=662 to ~720
    { num: '6.5.1', fi: 3, ti: 3, y: 692, label: 'Invalidate CDN\ncache for\nartist/album', self: true },
  ];

  // 6.6은 alt frame 밖 (메인 흐름 결과)
  const finalStep: Step = { num: '6.6', fi: 3, ti: 1, y: 800, label: 'Upload successful\n(song available)', dashed: true };

  // --- 액터 박스 (인터랙티브) ---
  const actorBox = (a: typeof actors[0], topY: number, key: string) => (
    <div key={key} style={{ position: 'absolute', left: a.cx - AW / 2, top: topY, zIndex: 5 }}>
      {interactive(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`,
        <div style={{
          width: AW, height: AH,
          background: ovr(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`).background ?? '#1e1e1e',
          border: `1px solid ${ovr(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`).borderColor ?? 'rgba(255,255,255,0.28)'}`,
          borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: ovr(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`).fontSize ?? 10,
          fontWeight: ovr(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`).fontWeight ?? '600',
          color: ovr(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`).color ?? '#fff',
          textAlign: 'center', lineHeight: 1.3, boxSizing: 'border-box', padding: '0 4px',
        }}>
          {ovr(`aus-actor-${a.id}-${topY === ACTOR_TOP ? 'top' : 'bot'}`).content ?? a.label}
        </div>
      , a.label)}
    </div>
  );

  // --- 메시지 화살표 + 라벨 (HTML 기반 인터랙티브) ---
  const renderStep = (s: Step) => {
    const from = actors[s.fi];
    const to   = actors[s.ti];
    const id   = `aus-step-${s.num}`;

    if (s.self) {
      // 자기 호출: ㄷ자 path
      return (
        <div key={id} style={{ position: 'absolute', left: 0, top: 0, width: BASE_W, height: BASE_H, pointerEvents: 'none' }}>
          <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible' }}>
            <path d={`M${from.cx},${s.y} h34 v22 h-34`}
              fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="1.2"
              markerEnd="url(#aus-arr)" strokeDasharray={s.dashed ? '5,3' : undefined}/>
            <circle cx={from.cx} cy={s.y} r="11"
              fill="#111" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
            <text x={from.cx} y={s.y + 3.5}
              fontSize="7.5" fill="rgba(255,255,255,0.8)" textAnchor="middle"
              fontFamily="inherit">{s.num}</text>
          </svg>
          <div style={{ position: 'absolute', left: from.cx + 42, top: s.y - 4, pointerEvents: 'auto' }}>
            {interactive(id,
              <div style={{
                fontSize: ovr(id).fontSize ?? 8.5,
                color: ovr(id).color ?? 'rgba(255,255,255,0.7)',
                background: ovr(id).background,
                fontFamily: 'inherit', whiteSpace: 'pre-line', lineHeight: 1.35,
                fontWeight: ovr(id).fontWeight,
                padding: '1px 3px',
              }}>
                {ovr(id).content ?? s.label}
              </div>
            , s.label)}
          </div>
        </div>
      );
    }

    // 일반 화살표
    const fwd  = to.cx > from.cx;
    const x1   = from.cx + (fwd ? 12 : -12);
    const x2   = to.cx   + (fwd ? -8  :  8);
    const midX = (from.cx + to.cx) / 2;
    return (
      <div key={id} style={{ position: 'absolute', left: 0, top: 0, width: BASE_W, height: BASE_H, pointerEvents: 'none' }}>
        <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible' }}>
          <line x1={x1} y1={s.y} x2={x2} y2={s.y}
            stroke="rgba(255,255,255,0.6)" strokeWidth="1.2"
            markerEnd="url(#aus-arr)" strokeDasharray={s.dashed ? '5,3' : undefined}/>
          <circle cx={from.cx} cy={s.y} r="11"
            fill="#111" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
          <text x={from.cx} y={s.y + 3.5}
            fontSize="7.5" fill="rgba(255,255,255,0.8)" textAnchor="middle"
            fontFamily="inherit">{s.num}</text>
        </svg>
        <div style={{
          position: 'absolute',
          left: midX,
          top: s.y - 4,
          transform: 'translate(-50%, -100%)',
          pointerEvents: 'auto',
        }}>
          {interactive(id,
            <div style={{
              fontSize: ovr(id).fontSize ?? 8.5,
              color: ovr(id).color ?? 'rgba(255,255,255,0.7)',
              background: ovr(id).background,
              fontFamily: 'inherit', whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.3,
              fontWeight: ovr(id).fontWeight,
              padding: '1px 4px',
            }}>
              {ovr(id).content ?? s.label}
            </div>
          , s.label)}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        width, height, background: '#111', overflow: 'hidden', position: 'relative',
        border: '1px solid rgba(80,80,80,0.6)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={onPageDoubleClick}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: BASE_W, height: BASE_H,
        transformOrigin: 'top left', transform: `scale(${scale})`,
        fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif",
      }}>
        {/* Title badge (인터랙티브) */}
        <div style={{ position: 'absolute', top: 5, left: 15, zIndex: 10 }}>
          {interactive('aus-title',
            <div style={{
              fontSize: ovr('aus-title').fontSize ?? 9.5,
              color: ovr('aus-title').color ?? 'rgba(255,255,255,0.65)',
              border: '1px solid rgba(255,255,255,0.18)',
              borderRadius: 4, padding: '2px 8px',
              display: 'flex', alignItems: 'center', gap: 5,
              fontWeight: ovr('aus-title').fontWeight,
            }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="7 17 17 7"/><polyline points="7 7 17 7 17 17"/>
              </svg>
              {ovr('aus-title').content ?? 'Audio Upload Flow'}
            </div>
          , 'Audio Upload Flow')}
        </div>

        {/* SVG: 라이프라인 + 화살표 마커 정의 */}
        <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible', zIndex: 1 }}>
          <defs>
            <marker id="aus-arr" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.65)"/>
            </marker>
          </defs>
          {/* Lifelines */}
          {actors.map(a => (
            <line key={`ll-${a.id}`}
              x1={a.cx} y1={ACTOR_TOP + AH} x2={a.cx} y2={LIFELINE_BOT}
              stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" strokeDasharray="5,4"
            />
          ))}
          {/* alt 프레임 외곽 (y=302~722) */}
          <rect x={15} y={302} width={1093} height={420}
            fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1"/>
          {/* alt 프레임 [invalid file] 라벨 영역 (사다리꼴) */}
          <polygon points="15,302 68,302 80,315 68,328 15,328"
            fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.22)" strokeWidth="1"/>
          {/* alt invalid/valid 분리선 (y=400) */}
          <line x1={15} y1={400} x2={1108} y2={400}
            stroke="rgba(255,255,255,0.22)" strokeWidth="1" strokeDasharray="6,3"/>
          {/* par 프레임 (y=662~722, valid 안쪽) */}
          <rect x={40} y={662} width={1043} height={60}
            fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1" strokeDasharray="4,2"/>
          <polygon points="40,662 96,662 107,674 96,686 40,686"
            fill="rgba(255,255,255,0.07)" stroke="rgba(255,255,255,0.18)" strokeWidth="1"/>
        </svg>

        {/* alt 프레임 라벨 (인터랙티브) */}
        <div style={{ position: 'absolute', left: 25, top: 309, zIndex: 4 }}>
          {interactive('aus-frame-alt',
            <div style={{
              fontSize: ovr('aus-frame-alt').fontSize ?? 10,
              color: ovr('aus-frame-alt').color ?? 'rgba(255,255,255,0.85)',
              fontFamily: 'inherit', fontWeight: ovr('aus-frame-alt').fontWeight ?? '700',
            }}>
              {ovr('aus-frame-alt').content ?? 'alt'}
            </div>
          , 'alt')}
        </div>
        <div style={{ position: 'absolute', left: 90, top: 309, zIndex: 4 }}>
          {interactive('aus-frame-alt-invalid',
            <div style={{
              fontSize: ovr('aus-frame-alt-invalid').fontSize ?? 9,
              color: ovr('aus-frame-alt-invalid').color ?? 'rgba(255,255,255,0.55)',
              fontFamily: 'inherit', fontWeight: ovr('aus-frame-alt-invalid').fontWeight,
            }}>
              {ovr('aus-frame-alt-invalid').content ?? '[ invalid file ]'}
            </div>
          , '[ invalid file ]')}
        </div>
        <div style={{ position: 'absolute', left: 90, top: 395, zIndex: 4 }}>
          {interactive('aus-frame-alt-valid',
            <div style={{
              fontSize: ovr('aus-frame-alt-valid').fontSize ?? 9,
              color: ovr('aus-frame-alt-valid').color ?? 'rgba(255,255,255,0.55)',
              fontFamily: 'inherit', fontWeight: ovr('aus-frame-alt-valid').fontWeight,
            }}>
              {ovr('aus-frame-alt-valid').content ?? '[ valid file ]'}
            </div>
          , '[ valid file ]')}
        </div>

        {/* par 프레임 라벨 (인터랙티브) */}
        <div style={{ position: 'absolute', left: 50, top: 668, zIndex: 4 }}>
          {interactive('aus-frame-par',
            <div style={{
              fontSize: ovr('aus-frame-par').fontSize ?? 10,
              color: ovr('aus-frame-par').color ?? 'rgba(255,255,255,0.75)',
              fontFamily: 'inherit', fontWeight: ovr('aus-frame-par').fontWeight ?? '700',
            }}>
              {ovr('aus-frame-par').content ?? 'par'}
            </div>
          , 'par')}
        </div>
        <div style={{ position: 'absolute', left: 115, top: 668, zIndex: 4 }}>
          {interactive('aus-frame-par-label',
            <div style={{
              fontSize: ovr('aus-frame-par-label').fontSize ?? 9,
              color: ovr('aus-frame-par-label').color ?? 'rgba(255,255,255,0.5)',
              fontFamily: 'inherit', fontWeight: ovr('aus-frame-par-label').fontWeight,
            }}>
              {ovr('aus-frame-par-label').content ?? 'Cache invalidation'}
            </div>
          , 'Cache invalidation')}
        </div>

        {/* Top actor boxes */}
        {actors.map(a => actorBox(a, ACTOR_TOP, `at-${a.id}`))}

        {/* Steps */}
        {steps.map(s => renderStep(s))}

        {/* 6.6: alt 프레임 밖 (최종 결과) — actor 박스(y=738) 위에 표시 */}
        <div key="step-66-wrap" style={{ position: 'absolute', left: 0, top: 0, width: BASE_W, height: BASE_H, pointerEvents: 'none', zIndex: 8 }}>
          <svg style={{ position: 'absolute', inset: 0, width: BASE_W, height: BASE_H, overflow: 'visible' }}>
            <line x1={665 - 12} y1={720} x2={285 + 8} y2={720}
              stroke="rgba(255,255,255,0.6)" strokeWidth="1.2"
              markerEnd="url(#aus-arr)" strokeDasharray="5,3"/>
            <circle cx={665} cy={720} r="11" fill="#111" stroke="rgba(255,255,255,0.35)" strokeWidth="1"/>
            <text x={665} y={720} dominantBaseline="central" fontSize="7" fill="rgba(255,255,255,0.8)" textAnchor="middle" fontFamily="inherit">6.6</text>
          </svg>
          <div style={{
            position: 'absolute',
            left: (665 + 285) / 2,
            top: 716,
            transform: 'translate(-50%, -100%)',
            pointerEvents: 'auto',
          }}>
            {interactive('aus-step-6.6',
              <div style={{
                fontSize: ovr('aus-step-6.6').fontSize ?? 8.5,
                color: ovr('aus-step-6.6').color ?? 'rgba(255,255,255,0.7)',
                fontFamily: 'inherit', whiteSpace: 'pre-line', textAlign: 'center', lineHeight: 1.3,
                fontWeight: ovr('aus-step-6.6').fontWeight,
                padding: '1px 4px',
              }}>
                {ovr('aus-step-6.6').content ?? finalStep.label}
              </div>
            , finalStep.label)}
          </div>
        </div>

        {/* Bottom actor boxes — 페이지 하단으로 내림 (y=738) */}
        {actors.map(a => (
          <div key={`ab-wrap-${a.id}`} style={{ position: 'absolute', left: a.cx - AW / 2, top: 738, zIndex: 5 }}>
            {interactive(`aus-actor-${a.id}-bot`,
              <div style={{
                width: AW, height: AH,
                background: ovr(`aus-actor-${a.id}-bot`).background ?? '#1e1e1e',
                border: `1px solid ${ovr(`aus-actor-${a.id}-bot`).borderColor ?? 'rgba(255,255,255,0.28)'}`,
                borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: ovr(`aus-actor-${a.id}-bot`).fontSize ?? 10,
                fontWeight: ovr(`aus-actor-${a.id}-bot`).fontWeight ?? '600',
                color: ovr(`aus-actor-${a.id}-bot`).color ?? '#fff',
                textAlign: 'center', lineHeight: 1.3, boxSizing: 'border-box', padding: '0 4px',
              }}>
                {ovr(`aus-actor-${a.id}-bot`).content ?? a.label}
              </div>
            , a.label)}
          </div>
        ))}
      </div>
    </div>
  );
});

// ── User Management 문서 페이지 ─────────────────────────────
interface UserManagementPageProps {
  width: number;
  height: number;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const UserManagementPage = React.memo(function UserManagementPage({
  width, height, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: UserManagementPageProps) {
  const BASE_W = 1123, BASE_H = 794;
  const scale = width / BASE_W;

  const [editingId, setEditingId] = useState<string | null>(null);
  const ovr = useCallback((id: string): DocTemplateElementStyle => templateContent?.[id] ?? {}, [templateContent]);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  const interactive = useCallback((id: string, children: React.ReactNode) => {
    const isSel = selectedElementId === id;
    const isEd  = editingId === id;
    const o     = templateContent?.[id];
    const transform = (o?.dx || o?.dy) ? `translate(${o.dx ?? 0}px, ${o.dy ?? 0}px)` : undefined;
    return (
      <div
        key={id}
        className="nodrag nopan"
        onClick={(e) => { if (!isEd) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(id); }}
        onMouseDown={(e) => { if (isSel && !isEd) handleDragStart(e, id); }}
        style={{
          position: 'relative', cursor: isEd ? 'text' : isSel ? 'grab' : 'pointer',
          outline: isSel ? (isEd ? '2px solid #22c55e' : '2px solid #3b82f6') : 'none',
          outlineOffset: 3, borderRadius: 4, transform,
        }}
        onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.outline = '1.5px solid rgba(96,165,250,0.45)'; }}
        onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLDivElement).style.outline = 'none'; }}
      >
        {children}
        {isEd && (
          <div
            contentEditable suppressContentEditableWarning
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onBlur={(e) => { e.stopPropagation(); onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 1, background: 'rgba(30,30,30,0.97)',
              borderRadius: 3, padding: '4px 8px', outline: 'none', cursor: 'text',
              fontSize: o?.fontSize ?? 13, color: o?.color ?? '#e5e7eb',
              fontFamily: 'inherit', lineHeight: 1.6, zIndex: 20,
              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: (o?.content ?? '').replace(/\n/g, '<br/>') }}
          />
        )}
      </div>
    );
  }, [selectedElementId, editingId, templateContent, onElementClick, handleDragStart, onContentChange]);

  // 엔드포인트 데이터
  const endpoints = [
    { descId: 'um-desc-0', codeId: 'um-code-0', method: 'GET',  methodColor: '#34d399',
      desc: 'Get the current user\'s playlists', path: '/users/me/playlists' },
    { descId: 'um-desc-1', codeId: 'um-code-1', method: 'GET',  methodColor: '#34d399',
      desc: 'Get songs liked by the user', path: '/users/me/liked-songs?limit=50&offset=0' },
    { descId: 'um-desc-2', codeId: 'um-code-2', method: 'POST', methodColor: '#60a5fa',
      desc: 'Follow an artist', path: '/users/me/follow/{artist_id}' },
  ];

  return (
    <div
      style={{
        width, height, background: '#111111', overflow: 'hidden', position: 'relative',
        border: '1px solid rgba(80,80,80,0.6)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={onPageDoubleClick}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: BASE_W, height: BASE_H,
        transformOrigin: 'top left', transform: `scale(${scale})`,
        fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif",
        padding: '48px 56px',
        boxSizing: 'border-box',
      }}>
        {/* 섹션 라벨 */}
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', marginBottom: 14 }}>
          API Reference
        </div>

        {/* 제목 */}
        {interactive('um-title',
          <div style={{
            fontSize: ovr('um-title').fontSize ?? 26, fontWeight: ovr('um-title').fontWeight ?? 'bold',
            color: ovr('um-title').color ?? '#f9fafb', marginBottom: 36,
            letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            {ovr('um-title').content ?? 'User Management'}
          </div>
        )}

        {/* 엔드포인트 목록 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {endpoints.map(({ descId, codeId, method, methodColor, desc, path }) => (
            <div key={descId}>
              {/* 설명 */}
              {interactive(descId,
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                  <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 15, lineHeight: 1.6, flexShrink: 0 }}>•</span>
                  <span style={{
                    fontSize: ovr(descId).fontSize ?? 16, color: ovr(descId).color ?? '#e5e7eb',
                    lineHeight: 1.6, fontWeight: ovr(descId).fontWeight ?? 'normal',
                  }}>
                    {ovr(descId).content ?? desc}
                  </span>
                </div>
              )}
              {/* 코드 블록 */}
              {interactive(codeId,
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10, marginLeft: 24,
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, lineHeight: 1.6, flexShrink: 0 }}>•</span>
                  <div style={{
                    background: ovr(codeId).background ?? '#1c1c1c',
                    border: `1px solid ${ovr(codeId).borderColor ?? 'rgba(255,255,255,0.12)'}`,
                    borderRadius: ovr(codeId).borderRadius ?? 7,
                    padding: '9px 16px',
                    fontFamily: "'JetBrains Mono','Fira Code','Consolas','Courier New',monospace",
                    fontSize: ovr(codeId).fontSize ?? 14,
                    color: ovr(codeId).color ?? '#d1d5db',
                    lineHeight: 1.55,
                    display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap',
                  }}>
                    <span style={{ color: methodColor, fontWeight: 700, flexShrink: 0 }}>
                      {method}
                    </span>
                    <span>{ovr(codeId).content ?? path}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

// ── 이미지 패널 페이지 ──────────────────────────────────────
interface ImagePanelPageProps {
  width: number;
  height: number;
  nodeId: string;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onImageChange?: (elemId: string, imageUrl: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const ImagePanelPage = React.memo(function ImagePanelPage({
  width, height, templateContent,
  selectedElementId, onElementClick, onImageChange, onPositionChange, onPageDoubleClick,
}: ImagePanelPageProps) {
  const BASE_W = 1123, BASE_H = 794;
  const scale = width / BASE_W;

  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ovr = useCallback((id: string): DocTemplateElementStyle => templateContent?.[id] ?? {}, [templateContent]);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { onImageChange?.('image-slot-main', reader.result as string); };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, [onImageChange]);

  const titleOvr = ovr('image-panel-title');
  const titleTransform = (titleOvr.dx || titleOvr.dy)
    ? `translate(${titleOvr.dx ?? 0}px, ${titleOvr.dy ?? 0}px)` : undefined;

  const slotOvr = ovr('image-slot-main');
  const slotTransform = (slotOvr.dx || slotOvr.dy)
    ? `translate(${slotOvr.dx ?? 0}px, ${slotOvr.dy ?? 0}px)` : undefined;
  const isSlotSelected = selectedElementId === 'image-slot-main';
  const isTitleSelected = selectedElementId === 'image-panel-title';
  const isTitleEditing = editingTitleId === 'image-panel-title';

  return (
    <div
      style={{
        width, height, background: '#111111', overflow: 'hidden', position: 'relative',
        border: '1px solid rgba(80,80,80,0.6)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
      }}
      onDoubleClick={onPageDoubleClick}
    >
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: BASE_W, height: BASE_H,
        transformOrigin: 'top left', transform: `scale(${scale})`,
        fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif",
      }}>
        {/* 숨김 파일 인풋 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* 타이틀 뱃지 */}
        <div style={{ position: 'absolute', top: 5, left: 15, zIndex: 2 }}>
          <div
            className="nodrag nopan"
            onClick={(e) => { if (!isTitleEditing) { e.stopPropagation(); onElementClick?.('image-panel-title'); } }}
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitleId('image-panel-title'); }}
            onMouseDown={(e) => { if (isTitleSelected && !isTitleEditing) handleDragStart(e, 'image-panel-title'); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 9.5, color: 'rgba(255,255,255,0.65)',
              border: `1px solid ${isTitleSelected ? '#3b82f6' : 'rgba(255,255,255,0.18)'}`,
              borderRadius: 4, padding: '2px 8px',
              cursor: isTitleEditing ? 'text' : isTitleSelected ? 'grab' : 'pointer',
              transform: titleTransform,
              position: 'relative',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            {isTitleEditing ? (
              <div
                contentEditable suppressContentEditableWarning
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                onBlur={(e) => {
                  onImageChange?.('image-panel-title', e.currentTarget.innerText);
                  setEditingTitleId(null);
                }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape' || e.key === 'Enter') {
                    onImageChange?.('image-panel-title', e.currentTarget.innerText);
                    setEditingTitleId(null);
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{ outline: 'none', minWidth: 80, color: 'rgba(255,255,255,0.65)' }}
                dangerouslySetInnerHTML={{ __html: titleOvr.content ?? 'Audio Upload Flow' }}
              />
            ) : (
              <span>{titleOvr.content ?? 'Audio Upload Flow'}</span>
            )}
          </div>
        </div>

        {/* 이미지 슬롯 */}
        <div
          className="nodrag nopan"
          onClick={(e) => { e.stopPropagation(); onElementClick?.('image-slot-main'); }}
          onDoubleClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          onMouseDown={(e) => { if (isSlotSelected) handleDragStart(e, 'image-slot-main'); }}
          style={{
            position: 'absolute',
            left: 20, top: 40, width: BASE_W - 40, height: BASE_H - 60,
            border: isSlotSelected
              ? '2px solid #3b82f6'
              : (slotOvr.imageUrl ? '1px solid rgba(255,255,255,0.1)' : '1.5px dashed rgba(255,255,255,0.22)'),
            borderRadius: 8,
            overflow: 'hidden',
            cursor: isSlotSelected ? 'grab' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: slotOvr.imageUrl ? 'transparent' : 'rgba(255,255,255,0.03)',
            transform: slotTransform,
            boxSizing: 'border-box',
          }}
        >
          {slotOvr.imageUrl ? (
            <img
              src={slotOvr.imageUrl}
              alt="uploaded"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', userSelect: 'none', pointerEvents: 'none' }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', userSelect: 'none' }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ marginBottom: 12, display: 'block', margin: '0 auto 12px' }}>
                <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{tr('이미지를 업로드하세요', 'Upload an image')}</div>
              <div style={{ fontSize: 10.5 }}>{tr('더블클릭하여 파일 선택', 'Double-click to choose a file')}</div>
            </div>
          )}

          {/* 선택 시 변경 버튼 */}
          {isSlotSelected && (
            <button
              className="nodrag nopan"
              onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
              style={{
                position: 'absolute', top: 10, right: 10,
                background: 'rgba(99,102,241,0.9)', color: '#fff',
                border: 'none', borderRadius: 6,
                padding: '5px 12px', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              {tr('이미지 변경', 'Change image')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

// ── 편집 오버레이용 요소별 배경색 ──────────────────────────
// 박스 배경과 동일해야 원본 텍스트를 가리면서 박스 테두리는 노출됨
const ELEMENT_EDIT_BG: Record<string, string> = {
  'header-title':    '#ffffff',
  'header-subtitle': '#ffffff',
  'section1-title':  '#ffffff',
  'section2-title':  '#ffffff',
  'capacity-note':   '#FAEEDA',
};

// ── 편집 오버레이용 요소별 기본 글씨 스타일 ────────────────
const ELEMENT_DEFAULT_FONT: Record<string, { fontSize: number; fontWeight?: string; color: string }> = {
  'header-title':    { fontSize: 20,   fontWeight: '700', color: '#111' },
  'header-subtitle': { fontSize: 12.5,                   color: '#999' },
  'section1-title':  { fontSize: 14.5, fontWeight: '700', color: '#222' },
  'section2-title':  { fontSize: 14.5, fontWeight: '700', color: '#222' },
  'req-scale-note':  { fontSize: 12.5,                   color: '#555' },
  'capacity-note':   { fontSize: 12,                     color: '#7a5a10' },
};

// ── 템플릿 요소별 기본 텍스트 내용 ─────────────────────────
const DEFAULT_CONTENT: Record<string, string> = {
  'header-title':    'Music Streaming Platform',
  'header-subtitle': '요구사항 분석 · 용량 계획 · 아키텍처 설계 기반 문서',
  'section1-title':  'Requirements & Assumptions',
  'req-card-0':      '🎵 아티스트가 곡을 직접 업로드할 수 있다',
  'req-card-1':      '🔍 사용자가 곡을 검색하고 재생할 수 있다',
  'req-card-2':      '📋 플레이리스트를 생성하고 관리할 수 있다',
  'req-card-3':      '👤 사용자 프로필을 유지할 수 있다',
  'req-audio-note':  '📊 기본 모니터링 및 관찰 가능성 — 헬스 체크, 에러 추적, 성능 지표',
  'req-scale-note':  '규모 가정 — 약 50만 명 사용자 · 약 3천만 곡 · 곡당 3 MB',
  'section2-title':  'Capacity Planning',
  'stat-card-0':     '🎵 Song Storage\n90 TB\n3MB × 3천만 곡. 복제 미포함.',
  'stat-card-1':     '👤 User Metadata\n~0.5 GB\n1KB × 50만 사용자.',
  'stat-card-2':     '🎧 Song Metadata\n~3 GB\n100B × 3천만 곡.',
  'stat-card-3':     '📡 Daily Bandwidth\n3–4 MB\n스트림당 소비량.',
  'capacity-estimate': '⚠️ 실제 스토리지 추정\n원시: ~90 TB / 복제: ×2-3배 / 실질: 180-270 TB',
  'capacity-note':   '메타데이터 합산(~3.5 GB)은 무시 가능. 실제 비용 드라이버는 스토리지 + egress.',
  // ── Architecture Diagram ──
  'arch-title':       'High Level Architecture',
  'arch-mobile':      'Mobile App',
  'arch-lb':          'Load Balancer',
  'arch-layer-title': 'WEB/API LAYER',
  'arch-api1':        'API Server 1',
  'arch-api2':        'API Server 2',
  'arch-api3':        'API Server 3',
  'arch-db':          'SQL Database',
  'arch-storage':     'Blob Storage',
  'arch-label-http':  'HTTP Requests',
  'arch-label-meta':  'Metadata Queries',
  'arch-label-url':   'Generate Signed URLs',
  'arch-layer-frame': 'WEB/API LAYER',
  'arch-edge-mobile': '',
  'arch-edge-lb':     '',
  'arch-edge-db':     '',
  'arch-edge-storage':'',
};

// ── Music Streaming 스타일 문서 페이지 (인터랙티브) ─────────
interface MusicStreamingDocPageProps {
  orientation: string;
  width: number;
  height: number;
  nodeId: string;
  darkMode?: boolean;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const MusicStreamingDocPage = React.memo(function MusicStreamingDocPage({
  orientation, width, height, nodeId, darkMode = false, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: MusicStreamingDocPageProps) {
  const isLandscape = orientation === 'landscape';
  const BASE_W = isLandscape ? 960 : 680;
  const scale  = width / BASE_W;

  const c = darkMode ? {
    bg: '#111111', bg2: '#1e1e1e', border: '#333333', divider: '#2a2a2a',
    tagBg: '#1a2338', tagTxt: '#60a5fa', muted: '#888', muted2: '#777',
    head: '#f0f0f0', body: '#cccccc', note: '#1c1507', noteBorder: '#c9a227', noteTxt: '#c9a227',
  } : {
    bg: '#fff', bg2: '#F7F6F2', border: '#E2E0D8', divider: '#E5E3DD',
    tagBg: '#E6F1FB', tagTxt: '#185FA5', muted: '#AAA', muted2: '#999',
    head: '#111', body: '#333', note: '#FAEEDA', noteBorder: '#EEC96A', noteTxt: '#7a5a10',
  };

  // 인라인 편집 중인 요소 ID
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const editRef = useRef<HTMLDivElement>(null);

  // 요소 스타일 오버라이드 헬퍼
  const ovr = useCallback((id: string): DocTemplateElementStyle => templateContent?.[id] ?? {}, [templateContent]);

  // 더블클릭 → 인라인 편집 진입
  const handleDoubleClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setEditingElementId(id);
  }, []);

  // 인라인 편집 저장 (blur / Escape)
  const commitEdit = useCallback((id: string, el: HTMLDivElement | null) => {
    if (!el) return;
    onContentChange?.(id, el.innerText ?? '');
    setEditingElementId(null);
  }, [onContentChange]);

  // 드래그로 요소 이동 — 선택된 요소 한정
  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;  // 선택된 요소만 드래그
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const curDx = templateContent?.[id]?.dx ?? 0;
    const curDy = templateContent?.[id]?.dy ?? 0;

    const handleMove = (me: MouseEvent) => {
      const dx = (me.clientX - startX) / scale + curDx;
      const dy = (me.clientY - startY) / scale + curDy;
      onPositionChange?.(id, dx, dy);
    };
    const handleUp = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  // 클릭 가능한 래퍼 — hover/선택 아웃라인 + 더블클릭 편집 + 드래그 이동
  const interactive = useCallback((id: string, children: React.ReactNode, extraStyle?: React.CSSProperties) => {
    const isSelected = selectedElementId === id;
    const isEditing  = editingElementId === id;
    const elemOvr    = templateContent?.[id];
    const transform  = (elemOvr?.dx || elemOvr?.dy)
      ? `translate(${elemOvr.dx ?? 0}px, ${elemOvr.dy ?? 0}px)` : undefined;

    // 편집 오버레이용 스타일 — 요소 원본 배경·글씨를 그대로 사용
    const defFont    = ELEMENT_DEFAULT_FONT[id];
    const editBg     = elemOvr?.background ?? (darkMode ? c.bg2 : (ELEMENT_EDIT_BG[id] ?? '#F7F6F2'));
    const editSize   = elemOvr?.fontSize   ?? defFont?.fontSize   ?? 12.5;
    const editWeight = elemOvr?.fontWeight ?? defFont?.fontWeight ?? 'normal';
    const editColor  = elemOvr?.color      ?? (darkMode ? c.body : (defFont?.color ?? '#333'));

    return (
      <div
        key={id}
        className="nodrag nopan"
        onClick={(e) => { if (!isEditing) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => handleDoubleClick(e, id)}
        onMouseDown={(e) => { if (isSelected && !isEditing) handleDragStart(e, id); }}
        style={{
          position: 'relative',
          cursor: isEditing ? 'text' : isSelected ? 'grab' : 'pointer',
          borderRadius: 8,
          outline: isSelected ? (isEditing ? '2px solid #22c55e' : '2px solid #3b82f6') : 'none',
          outlineOffset: 2,
          transition: 'outline 0.1s',
          transform,
          ...extraStyle,
        }}
        onMouseEnter={(e) => {
          if (!isSelected) (e.currentTarget as HTMLDivElement).style.outline = '1.5px solid rgba(96,165,250,0.5)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) (e.currentTarget as HTMLDivElement).style.outline = 'none';
        }}
      >
        {/* 박스는 항상 렌더링 — 편집 중에도 테두리·배경 유지 */}
        {children}
        {/* 편집 오버레이 — inset:1px 로 박스 테두리 노출, 배경·글씨 원본과 동일 */}
        {isEditing && (
          <div
            contentEditable
            suppressContentEditableWarning
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onBlur={(e) => { e.stopPropagation(); commitEdit(id, e.currentTarget as HTMLDivElement); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') commitEdit(id, e.currentTarget as HTMLDivElement);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 1,
              background: editBg,
              borderRadius: 5,
              padding: '6px 8px',
              outline: 'none',
              cursor: 'text',
              fontSize: editSize,
              fontFamily: 'inherit',
              fontWeight: editWeight,
              fontStyle: elemOvr?.fontStyle,
              color: editColor,
              lineHeight: 1.5,
              zIndex: 20,
              minHeight: '1.4em',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{
              __html: (templateContent?.[id]?.content ?? DEFAULT_CONTENT[id] ?? '').replace(/\n/g, '<br/>'),
            }}
          />
        )}
      </div>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElementId, editingElementId, templateContent, onElementClick,
      handleDoubleClick, handleDragStart, commitEdit, darkMode, c.bg2, c.body]);

  const tag = (
    <span style={{ display:'inline-block', fontSize:10, fontWeight:700, letterSpacing:'0.12em',
      textTransform:'uppercase', background:c.tagBg, color:c.tagTxt,
      padding:'4px 12px', borderRadius:6, marginBottom:12 }}>
      System Design Document
    </span>
  );

  const header = (isLand: boolean) => (
    <div style={{ paddingBottom: isLand ? '1.1rem' : '1.4rem', borderBottom:`1.5px solid ${c.divider}`, marginBottom: isLand ? '1.5rem' : '2rem' }}>
      {isLand ? (
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
          <div>
            {tag}
            {interactive('header-title',
              <div style={{ fontSize: ovr('header-title').fontSize ?? 20, fontWeight: ovr('header-title').fontWeight ?? 700, color: ovr('header-title').color ?? c.head, marginBottom:5, letterSpacing:'-0.02em', fontStyle: ovr('header-title').fontStyle }}>
                {ovr('header-title').content ?? 'Music Streaming Platform'}
              </div>
            )}
            {interactive('header-subtitle',
              <div style={{ fontSize: ovr('header-subtitle').fontSize ?? 12.5, color: ovr('header-subtitle').color ?? c.muted2, fontStyle: ovr('header-subtitle').fontStyle }}>
                {ovr('header-subtitle').content ?? '요구사항 분석 · 용량 계획 · 아키텍처 설계 기반 문서'}
              </div>
            )}
          </div>
          <div style={{ fontSize:11, color: c.muted, paddingTop:6 }}>Web Canvas · v1.0</div>
        </div>
      ) : (
        <>
          {tag}
          {interactive('header-title',
            <div style={{ fontSize: ovr('header-title').fontSize ?? 24, fontWeight: ovr('header-title').fontWeight ?? 700, color: ovr('header-title').color ?? c.head, marginBottom:5, letterSpacing:'-0.02em', fontStyle: ovr('header-title').fontStyle }}>
              {ovr('header-title').content ?? 'Music Streaming Platform'}
            </div>
          )}
          {interactive('header-subtitle',
            <div style={{ fontSize: ovr('header-subtitle').fontSize ?? 12.5, color: ovr('header-subtitle').color ?? c.muted2, fontStyle: ovr('header-subtitle').fontStyle }}>
              {ovr('header-subtitle').content ?? '요구사항 분석 · 용량 계획 · 아키텍처 설계 기반 문서'}
            </div>
          )}
        </>
      )}
    </div>
  );

  const reqCards = [
    { id: 'req-card-0', txt: '🎵 아티스트가 곡을 직접 업로드할 수 있다' },
    { id: 'req-card-1', txt: '🔍 사용자가 곡을 검색하고 재생할 수 있다' },
    { id: 'req-card-2', txt: '📋 플레이리스트를 생성하고 관리할 수 있다' },
    { id: 'req-card-3', txt: '👤 사용자 프로필을 유지할 수 있다' },
  ];

  const section1 = (oneCol: boolean) => (
    <div style={{ marginBottom:'2rem' }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color: c.muted, marginBottom:5 }}>Section 01</div>
      {interactive('section1-title',
        <div style={{ fontSize: ovr('section1-title').fontSize ?? (oneCol ? 13.5 : 14.5), fontWeight: ovr('section1-title').fontWeight ?? 700, color: ovr('section1-title').color ?? c.head, paddingBottom:9, borderBottom:`0.5px solid ${c.divider}`, marginBottom:'1.1rem', fontStyle: ovr('section1-title').fontStyle }}>
          {ovr('section1-title').content ?? 'Requirements & Assumptions'}
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns: oneCol ? '1fr' : '1fr 1fr', gap:7, marginBottom:7 }}>
        {reqCards.map(({ id, txt }) =>
          interactive(id,
            <div style={{ background: ovr(id).background ?? c.bg2, border:`0.5px solid ${ovr(id).borderColor ?? c.border}`, borderRadius: ovr(id).borderRadius ?? 8, padding:'9px 12px', fontSize: ovr(id).fontSize ?? 12.5, color: ovr(id).color ?? c.body, lineHeight:1.5, fontWeight: ovr(id).fontWeight, fontStyle: ovr(id).fontStyle }}>
              {ovr(id).content ?? txt}
            </div>
          )
        )}
      </div>
      {interactive('req-audio-note',
        <div style={{ background: ovr('req-audio-note').background ?? c.bg2, border:`0.5px solid ${ovr('req-audio-note').borderColor ?? c.border}`, borderRadius: ovr('req-audio-note').borderRadius ?? 8, padding:'9px 12px', fontSize: ovr('req-audio-note').fontSize ?? 12.5, color: ovr('req-audio-note').color ?? c.body, lineHeight:1.5 }}>
          {ovr('req-audio-note').content ?? '📊 기본 모니터링 및 관찰 가능성 — 헬스 체크, 에러 추적, 성능 지표'}
        </div>
      )}
      <div style={{ marginTop:'1.1rem' }}>
        <div style={{ fontSize:10, fontWeight:700, color:c.muted, marginBottom:7, textTransform:'uppercase', letterSpacing:'0.08em' }}>오디오 포맷 (Ogg / AAC) — 적응형 스트리밍</div>
        <div style={{ display:'flex', gap:8 }}>
          {(['64 kbps','128 kbps','320 kbps'] as const).map((v, i) => (
            <div key={v} style={{ flex:1, background:c.bg2, border:`0.5px solid ${c.border}`, borderRadius:8, padding:'9px 0', textAlign:'center' }}>
              <span style={{ display:'block', fontSize:14, fontWeight:700, color: c.head }}>{v}</span>
              <span style={{ display:'block', fontSize:10.5, color:c.muted, marginTop:2 }}>{['모바일 절약','표준 음질','프리미엄'][i]}</span>
            </div>
          ))}
        </div>
      </div>
      {interactive('req-scale-note',
        <div style={{ marginTop:10, background: ovr('req-scale-note').background ?? c.bg2, border:`0.5px solid ${ovr('req-scale-note').borderColor ?? c.border}`, borderRadius: ovr('req-scale-note').borderRadius ?? 8, padding:'10px 14px', fontSize: ovr('req-scale-note').fontSize ?? 12.5, color: ovr('req-scale-note').color ?? '#555', lineHeight:1.65, fontWeight: ovr('req-scale-note').fontWeight }}>
          {ovr('req-scale-note').content ?? '규모 가정 — 약 50만 명 사용자 · 약 3천만 곡 · 곡당 3 MB'}
        </div>
      )}
    </div>
  );

  const statCards = [
    { id: 'stat-card-0', name: '🎵 Song Storage',    num: '90 TB',   desc: '3MB × 3천만 곡. 복제 미포함.' },
    { id: 'stat-card-1', name: '👤 User Metadata',   num: '~0.5 GB', desc: '1KB × 50만 사용자.' },
    { id: 'stat-card-2', name: '🎧 Song Metadata',   num: '~3 GB',   desc: '100B × 3천만 곡.' },
    { id: 'stat-card-3', name: '📡 Daily Bandwidth', num: '3–4 MB',  desc: '스트림당 소비량.' },
  ];

  const section2 = (oneCol: boolean) => (
    <div style={{ marginBottom:'2rem' }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase', color: c.muted, marginBottom:5 }}>Section 02</div>
      {interactive('section2-title',
        <div style={{ fontSize: ovr('section2-title').fontSize ?? (oneCol ? 13.5 : 14.5), fontWeight: ovr('section2-title').fontWeight ?? 700, color: ovr('section2-title').color ?? c.head, paddingBottom:9, borderBottom:`0.5px solid ${c.divider}`, marginBottom:'1.1rem', fontStyle: ovr('section2-title').fontStyle }}>
          {ovr('section2-title').content ?? 'Capacity Planning'}
        </div>
      )}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
        {statCards.map(({ id, name, num, desc }) =>
          interactive(id,
            <div style={{ background: ovr(id).background ?? c.bg2, border:`0.5px solid ${ovr(id).borderColor ?? c.border}`, borderRadius: ovr(id).borderRadius ?? 10, padding:'11px 13px' }}>
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color: ovr(id).color ?? c.muted, marginBottom:5 }}>{name}</div>
              <div style={{ fontSize: oneCol ? 16 : 18, fontWeight:700, color: c.head, marginBottom:4 }}>{num}</div>
              <div style={{ fontSize:11.5, color:c.muted2, lineHeight:1.5 }}>{desc}</div>
            </div>
          )
        )}
      </div>
      {interactive('capacity-estimate',
        <div style={{ marginTop:7, background: ovr('capacity-estimate').background ?? c.bg2, border:`0.5px solid ${ovr('capacity-estimate').borderColor ?? c.border}`, borderRadius: ovr('capacity-estimate').borderRadius ?? 10, padding:'11px 13px' }}>
          <div style={{ fontSize:10, fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase', color:c.muted, marginBottom:7 }}>⚠️ 실제 스토리지 추정</div>
          <div style={{ display:'flex', gap:'2rem', fontSize: ovr('capacity-estimate').fontSize ?? 12, color: ovr('capacity-estimate').color ?? c.body }}>
            <div>
              <div style={{ marginBottom:4 }}><span style={{ color:c.muted, minWidth:90, display:'inline-block' }}>원시 오디오</span><span style={{ fontWeight:700 }}>~90 TB</span></div>
              <div style={{ marginBottom:4 }}><span style={{ color:c.muted, minWidth:90, display:'inline-block' }}>복제 + 버전</span><span style={{ fontWeight:700 }}>× 2–3배</span></div>
              <div><span style={{ color:c.muted, minWidth:90, display:'inline-block' }}>실질 용량</span><span style={{ fontWeight:700 }}>180–270 TB</span></div>
            </div>
            <div>
              <div style={{ marginBottom:4 }}><span style={{ color:c.muted, minWidth:90, display:'inline-block' }}>평균 청취</span><span style={{ fontWeight:700 }}>3.5 분 / 곡</span></div>
              <div style={{ marginBottom:4 }}><span style={{ color:c.muted, minWidth:90, display:'inline-block' }}>비트레이트</span><span style={{ fontWeight:700 }}>128–160 kbps</span></div>
              <div><span style={{ color:c.muted, minWidth:90, display:'inline-block' }}>Egress</span><span style={{ fontWeight:700 }}>상당 수준 예상</span></div>
            </div>
          </div>
        </div>
      )}
      {interactive('capacity-note',
        <div style={{ background: ovr('capacity-note').background ?? c.note, border:`0.5px solid ${ovr('capacity-note').borderColor ?? c.noteBorder}`, borderRadius: ovr('capacity-note').borderRadius ?? 8, padding:'10px 14px', fontSize: ovr('capacity-note').fontSize ?? 12, color: ovr('capacity-note').color ?? c.noteTxt, lineHeight:1.6, marginTop:10, fontStyle: ovr('capacity-note').fontStyle }}>
          {ovr('capacity-note').content ?? '메타데이터 합산(~3.5 GB)은 무시 가능. 실제 비용 드라이버는 스토리지 + egress.'}
        </div>
      )}
    </div>
  );

  const footer = (
    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color: c.muted, paddingTop:'1.25rem', borderTop:`0.5px solid ${c.divider}` }}>
      <span>Web Canvas · System Design</span>
      <span>Music Streaming Platform — v1.0</span>
    </div>
  );

  return (
    <div
      style={{
        width, height, background: c.bg, overflow:'hidden', position:'relative',
        border: darkMode ? '1px solid rgba(80,80,80,0.6)' : '1px solid rgba(180,180,180,0.55)',
        boxShadow: darkMode ? '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)' : '0 2px 12px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.10)',
      }}
      onDoubleClick={onPageDoubleClick}
    >
      <div style={{
        position: 'absolute', top:0, left:0,
        width: BASE_W,
        transformOrigin: 'top left',
        transform: `scale(${scale})`,
        fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif",
        padding: isLandscape ? '36px 40px 40px' : '44px 40px 48px',
        color: c.head,
      }}>
        {header(isLandscape)}
        {isLandscape ? (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:0 }}>
            <div style={{ paddingRight:'2rem' }}>{section1(true)}</div>
            <div style={{ paddingLeft:'2rem', borderLeft:`0.5px solid ${c.divider}` }}>{section2(true)}</div>
          </div>
        ) : (
          <>
            {section1(false)}
            <hr style={{ border:'none', borderTop:`0.5px solid ${c.divider}`, margin:'1.75rem 0' }} />
            {section2(false)}
            {footer}
          </>
        )}
      </div>
    </div>
  );
});

// ── API Reference 문서 페이지 ────────────────────────────────
interface ApiReferencePageProps {
  width: number;
  height: number;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const ApiReferencePage = React.memo(function ApiReferencePage({
  width, height, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: ApiReferencePageProps) {
  const scale = width / 1123;

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  const interactive = useCallback((id: string, children: React.ReactNode, defaultContent?: string) => {
    const isSel = selectedElementId === id;
    const isEd  = editingId === id;
    const o     = templateContent?.[id];
    const transform = (o?.dx || o?.dy) ? `translate(${o.dx ?? 0}px, ${o.dy ?? 0}px)` : undefined;
    return (
      <div
        key={id}
        className="nodrag nopan"
        onClick={(e) => { if (!isEd) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(id); }}
        onMouseDown={(e) => { if (isSel && !isEd) handleDragStart(e, id); }}
        style={{
          position: 'relative',
          cursor: isEd ? 'text' : isSel ? 'grab' : 'default',
          outline: 'none',
          borderRadius: 3, transform,
        }}
      >
        {children}
        {isEd && (
          <div
            contentEditable suppressContentEditableWarning
            ref={(el) => { if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
            onBlur={(e) => { e.stopPropagation(); onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(20,20,20,0.97)',
              borderRadius: 3, padding: '2px 6px', outline: 'none', cursor: 'text',
              fontSize: 'inherit', color: '#e5e7eb', fontFamily: 'inherit',
              lineHeight: 'inherit', zIndex: 30, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: (o?.content ?? '').replace(/\n/g, '<br/>') }}
          />
        )}
      </div>
    );
  }, [selectedElementId, editingId, templateContent, onElementClick, handleDragStart, onContentChange]);

  const METHOD_BG: Record<string, string> = {
    GET:    'rgba(59,130,246,0.22)',
    POST:   'rgba(34,197,94,0.22)',
    PUT:    'rgba(234,179,8,0.22)',
    DELETE: 'rgba(239,68,68,0.22)',
  };
  const METHOD_COLOR: Record<string, string> = {
    GET:    '#93c5fd',
    POST:   '#86efac',
    PUT:    '#fde047',
    DELETE: '#fca5a5',
  };

  type ApiItem = { key: string; method: string; path: string };

  const renderSectionHeader = (id: string, korean: string, english: string) =>
    interactive(id, (
      <div style={{
        fontSize: 13 * scale, fontWeight: 'bold', color: '#f8fafc',
        borderBottom: '1px solid rgba(255,255,255,0.12)',
        paddingBottom: 5 * scale, marginBottom: 10 * scale, marginTop: 14 * scale,
      }}>
        {korean}
        <span style={{ fontSize: 10 * scale, color: 'rgba(255,255,255,0.38)', marginLeft: 7 * scale }}>
          {english}
        </span>
      </div>
    ), korean);

  const renderApiItem = ({ key, method, path }: ApiItem) =>
    interactive(`ar-item-${key}`, (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8 * scale,
        padding: `${5 * scale}px ${9 * scale}px`,
        background: 'rgba(255,255,255,0.04)',
        borderRadius: 5 * scale, marginBottom: 4 * scale,
      }}>
        <span style={{
          fontSize: 9.5 * scale, fontWeight: 'bold',
          padding: `${2 * scale}px ${6 * scale}px`,
          borderRadius: 3 * scale,
          background: METHOD_BG[method] ?? 'rgba(100,100,100,0.2)',
          color: METHOD_COLOR[method] ?? '#ccc',
          minWidth: 44 * scale, textAlign: 'center' as const, display: 'inline-block',
        }}>{method}</span>
        <code style={{
          fontSize: 11 * scale, color: '#cbd5e1',
          fontFamily: "'Fira Mono', 'Consolas', monospace",
        }}>{path}</code>
      </div>
    ), `${method} ${path}`);

  const PAD = 28 * scale;
  const GAP = 22 * scale;
  const colW = (width - PAD * 2 - GAP) / 2;

  const leftItems: ApiItem[] = [
    { key: 'search',          method: 'GET',  path: '/search' },
    { key: 'trending',        method: 'GET',  path: '/songs/trending' },
    { key: 'artist-songs',    method: 'GET',  path: '/artists/{id}/songs' },
    { key: 'song-detail',     method: 'GET',  path: '/songs/{id}' },
    { key: 'song-stream',     method: 'GET',  path: '/songs/{id}/stream' },
    { key: 'playlist-detail', method: 'GET',  path: '/playlists/{id}?include_songs=true' },
  ];
  const rightItems: ApiItem[] = [
    { key: 'create-playlist', method: 'POST',   path: '/playlists' },
    { key: 'add-song',        method: 'PUT',    path: '/playlists/{id}/songs' },
    { key: 'remove-song',     method: 'DELETE', path: '/playlists/{id}/songs/{song_id}' },
    { key: 'like-song',       method: 'POST',   path: '/songs/{id}/like' },
    { key: 'my-playlists',    method: 'GET',    path: '/users/me/playlists' },
    { key: 'liked-songs',     method: 'GET',    path: '/users/me/liked-songs' },
    { key: 'follow-artist',   method: 'POST',   path: '/users/me/follow/{artist_id}' },
  ];

  return (
    <div
      style={{ width, height, background: '#111111', position: 'relative', overflow: 'hidden',
               border: '1px solid #2a2a2a', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
               fontFamily: "'Inter', 'Segoe UI', sans-serif" }}
      onDoubleClick={onPageDoubleClick}
    >
      {/* 타이틀 뱃지 */}
      <div style={{ position: 'absolute', top: 12 * scale, left: PAD }}>
        {interactive('ar-title', (
          <div style={{
            fontSize: 11 * scale, fontWeight: 600, color: 'rgba(255,255,255,0.55)',
            letterSpacing: '0.08em', textTransform: 'uppercase' as const,
            whiteSpace: 'nowrap',
          }}>
            API Reference
            <span style={{ marginLeft: 8 * scale, fontSize: 9.5 * scale,
                           color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>
              Music Streaming Service
            </span>
          </div>
        ), 'API Reference')}
      </div>

      {/* 구분선 */}
      <div style={{
        position: 'absolute', top: 32 * scale, left: PAD, right: PAD,
        height: 1, background: 'rgba(255,255,255,0.08)',
      }} />

      {/* 2열 레이아웃 */}
      <div style={{
        position: 'absolute', top: 44 * scale, left: PAD, right: PAD,
        bottom: PAD, display: 'flex', gap: GAP,
      }}>
        {/* 왼쪽 열 */}
        <div style={{ width: colW, flexShrink: 0 }}>
          {renderSectionHeader('ar-sec-search', '검색 및 탐색', 'Search & Discovery')}
          {leftItems.slice(0, 3).map(renderApiItem)}
          {renderSectionHeader('ar-sec-content', '콘텐츠 이용', 'Content Access')}
          {leftItems.slice(3).map(renderApiItem)}
        </div>

        {/* 구분선 */}
        <div style={{ width: 1, background: 'rgba(255,255,255,0.07)', flexShrink: 0 }} />

        {/* 오른쪽 열 */}
        <div style={{ flex: 1 }}>
          {renderSectionHeader('ar-sec-actions', '사용자 행동', 'User Actions')}
          {rightItems.slice(0, 4).map(renderApiItem)}
          {renderSectionHeader('ar-sec-user', '사용자 관리', 'User Management')}
          {rightItems.slice(4).map(renderApiItem)}
        </div>
      </div>
    </div>
  );
});

// ── ER 다이어그램 (Relational Database) 문서 페이지 ──────────
interface ERDiagramPageProps {
  width: number;
  height: number;
  templateContent?: DocTemplateContent;
  selectedElementId?: string | null;
  onElementClick?: (id: string) => void;
  onContentChange?: (elemId: string, content: string) => void;
  onPositionChange?: (elemId: string, dx: number, dy: number) => void;
  onPageDoubleClick?: () => void;
}

const ERDiagramPage = React.memo(function ERDiagramPage({
  width, height, templateContent,
  selectedElementId, onElementClick, onContentChange, onPositionChange, onPageDoubleClick,
}: ERDiagramPageProps) {
  const BASE_W = 1123, BASE_H = 794;
  const scale = width / BASE_W;

  const [editingId, setEditingId] = useState<string | null>(null);

  const handleDragStart = useCallback((e: React.MouseEvent, id: string) => {
    if (selectedElementId !== id) return;
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const cdx = templateContent?.[id]?.dx ?? 0, cdy = templateContent?.[id]?.dy ?? 0;
    const mv = (me: MouseEvent) => onPositionChange?.(id, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  }, [selectedElementId, templateContent, scale, onPositionChange]);

  const interactive = useCallback((id: string, children: React.ReactNode, defaultContent?: string, asBlock?: boolean) => {
    const isSel = selectedElementId === id;
    const isEd  = editingId === id;
    const o     = templateContent?.[id];
    const transform = (o?.dx || o?.dy) ? `translate(${o.dx ?? 0}px, ${o.dy ?? 0}px)` : undefined;
    return (
      <div
        key={id}
        className="nodrag nopan"
        onClick={(e) => { if (!isEd) { e.stopPropagation(); onElementClick?.(id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditingId(id); }}
        onMouseDown={(e) => { if (isSel && !isEd) handleDragStart(e, id); }}
        style={{
          position: 'relative',
          display: asBlock ? 'block' : 'inline-block',
          cursor: isEd ? 'text' : isSel ? 'grab' : 'default',
          outline: 'none', borderRadius: 4, transform,
        }}
      >
        {children}
        {isEd && (
          <div
            contentEditable suppressContentEditableWarning
            ref={(el) => { if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
            onBlur={(e) => { e.stopPropagation(); onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { onContentChange?.(id, e.currentTarget.innerText); setEditingId(null); } }}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(20,20,20,0.97)',
              borderRadius: 3, padding: '2px 6px', outline: 'none', cursor: 'text',
              fontSize: 'inherit', color: '#e5e7eb', fontFamily: 'inherit',
              lineHeight: 'inherit', zIndex: 30, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: (o?.content ?? '').replace(/\n/g, '<br/>') }}
          />
        )}
      </div>
    );
  }, [selectedElementId, editingId, templateContent, onElementClick, handleDragStart, onContentChange]);

  // ── 엔티티 정의 (위치는 BASE 좌표, 화면 우상단 기준) ──────────
  type Col = { name: string; type: string; tag?: 'pk' | 'fk' | 'unique' };
  type Entity = {
    id: string;       // 엔티티 키
    label: string;    // 테이블 이름
    icon: string;     // 우상단 아이콘 (텍스트)
    color: string;    // 강조 색
    x: number; y: number; w: number;
    columns: Col[];
  };
  const entities: Entity[] = [
    {
      id: 'playlistitems', label: 'playlistitems', icon: '▶', color: '#c084fc',
      x: 30, y: 130, w: 230,
      columns: [
        { name: 'PlaylistID', type: 'bigint pk', tag: 'pk' },
        { name: 'Position',   type: 'int' },
        { name: 'AddedAt',    type: 'timestamptz' },
        { name: 'SongID',     type: 'bigint pk', tag: 'pk' },
      ],
    },
    {
      id: 'playlists', label: 'playlists', icon: '☰', color: '#fb923c',
      x: 380, y: 50, w: 290,
      columns: [
        { name: 'PlaylistID', type: 'bigint pk', tag: 'pk' },
        { name: 'OwnerID',    type: 'bigint' },
        { name: 'Name',       type: 'text' },
        { name: 'CreatedAt',  type: 'timestamptz' },
      ],
    },
    {
      id: 'users', label: 'users', icon: '👥', color: '#facc15',
      x: 770, y: 90, w: 320,
      columns: [
        { name: 'UserID',           type: 'bigint pk',     tag: 'pk' },
        { name: 'Email',            type: 'citext unique', tag: 'unique' },
        { name: 'PasswordHash',     type: 'text' },
        { name: 'CreatedAt',        type: 'timestamptz' },
        { name: 'LastLogin',        type: 'timestamptz' },
        { name: 'SubscriptionType', type: 'text' },
        { name: 'Country',          type: 'text' },
      ],
    },
    {
      id: 'artistssongs', label: 'artistssongs', icon: '⌥', color: '#22d3ee',
      x: 30, y: 460, w: 220,
      columns: [
        { name: 'SongID',   type: 'bigint pk', tag: 'pk' },
        { name: 'ArtistID', type: 'bigint pk', tag: 'pk' },
      ],
    },
    {
      id: 'songs', label: 'songs', icon: '♪', color: '#34d399',
      x: 380, y: 330, w: 290,
      columns: [
        { name: 'SongID',      type: 'bigint pk', tag: 'pk' },
        { name: 'Title',       type: 'text' },
        { name: 'Duration',    type: 'int' },
        { name: 'ReleaseDate', type: 'date' },
        { name: 'FileURL',     type: 'text' },
        { name: 'CreatedAt',   type: 'timestamptz' },
        { name: 'ArtistID',    type: 'bigint' },
      ],
    },
    {
      id: 'artists', label: 'artists', icon: '♪', color: '#a78bfa',
      x: 800, y: 590, w: 290,
      columns: [
        { name: 'ArtistID', type: 'bigint pk', tag: 'pk' },
        { name: 'Name',     type: 'text' },
        { name: 'Country',  type: 'text' },
      ],
    },
  ];

  // ── 관계선 (entity id → 컬럼 인덱스) ────────────────────────
  const HEADER_H = 32;
  const ROW_H    = 27;
  const colCenterY = (e: Entity, colIdx: number) => e.y + HEADER_H + ROW_H * colIdx + ROW_H / 2;
  const ent = (id: string) => entities.find(e => e.id === id)!;

  type Rel = { from: { eid: string; col: number; side: 'left' | 'right' }; to: { eid: string; col: number; side: 'left' | 'right' }; label?: string };
  const relations: Rel[] = [
    // playlists.PlaylistID → playlistitems.PlaylistID
    { from: { eid: 'playlists', col: 0, side: 'left' }, to: { eid: 'playlistitems', col: 0, side: 'right' }, label: '1' },
    // users.UserID → playlists.OwnerID
    { from: { eid: 'users', col: 0, side: 'left' }, to: { eid: 'playlists', col: 1, side: 'right' }, label: '1' },
    // songs.SongID → playlistitems.SongID
    { from: { eid: 'songs', col: 0, side: 'left' }, to: { eid: 'playlistitems', col: 3, side: 'right' }, label: '1' },
    // songs.SongID → artistssongs.SongID
    { from: { eid: 'songs', col: 0, side: 'left' }, to: { eid: 'artistssongs', col: 0, side: 'right' }, label: '1' },
    // artists.ArtistID → songs.ArtistID
    { from: { eid: 'artists', col: 0, side: 'left' }, to: { eid: 'songs', col: 6, side: 'right' }, label: '1' },
  ];

  const tagColor = (tag?: Col['tag']) =>
    tag === 'pk' ? '#a78bfa' : tag === 'unique' ? '#fbbf24' : 'rgba(255,255,255,0.55)';

  // 엔티티 박스 렌더러 (헤더는 클릭+드래그+편집, 컬럼은 각각 편집 가능)
  const renderEntity = (e: Entity) => {
    const ovr = templateContent?.[`er-${e.id}`];
    const dx = ovr?.dx ?? 0, dy = ovr?.dy ?? 0;
    const isSelBox = selectedElementId === `er-${e.id}`;
    const isEdName = editingId === `er-${e.id}-name`;
    const savedName = templateContent?.[`er-${e.id}-name`]?.content ?? e.label;

    return (
      <div
        key={e.id}
        style={{ position: 'absolute', left: e.x * scale, top: e.y * scale,
                 width: e.w * scale, transform: `translate(${dx * scale}px, ${dy * scale}px)` }}
      >
        <div
          className="nodrag nopan"
          onClick={(ev) => { ev.stopPropagation(); onElementClick?.(`er-${e.id}`); }}
          onMouseDown={(ev) => {
            if (!isSelBox) return;
            ev.stopPropagation(); ev.preventDefault();
            const sx = ev.clientX, sy = ev.clientY;
            const cdx = ovr?.dx ?? 0, cdy = ovr?.dy ?? 0;
            const mv = (me: MouseEvent) => onPositionChange?.(`er-${e.id}`, (me.clientX - sx) / scale + cdx, (me.clientY - sy) / scale + cdy);
            const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
          }}
          style={{
            position: 'relative',
            background: '#161616',
            border: `1.5px solid ${e.color}`,
            borderRadius: 6 * scale,
            boxShadow: `0 0 0 1px rgba(0,0,0,0.4), 0 6px 24px rgba(0,0,0,0.45)`,
            cursor: isSelBox ? 'grab' : 'default',
          }}
        >
          {/* 헤더 (테이블 이름 — 더블클릭으로 편집) */}
          <div
            onDoubleClick={(ev) => { ev.stopPropagation(); setEditingId(`er-${e.id}-name`); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              height: HEADER_H * scale,
              padding: `0 ${10 * scale}px`,
              borderBottom: `1px solid ${e.color}55`,
              position: 'relative',
            }}
          >
            {isEdName ? (
              <input
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                defaultValue={savedName}
                onBlur={(ev) => { onContentChange?.(`er-${e.id}-name`, ev.currentTarget.value); setEditingId(null); }}
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  if (ev.key === 'Enter')  { onContentChange?.(`er-${e.id}-name`, ev.currentTarget.value); setEditingId(null); }
                  if (ev.key === 'Escape') setEditingId(null);
                }}
                onClick={(ev) => ev.stopPropagation()}
                style={{
                  flex: 1, background: 'rgba(20,20,20,0.95)', border: 'none', outline: 'none',
                  color: '#e5e7eb', fontSize: 13 * scale, fontWeight: 600, fontFamily: 'inherit',
                }}
              />
            ) : (
              <span style={{ fontSize: 13 * scale, fontWeight: 600, color: '#e5e7eb' }}>{savedName}</span>
            )}
            <span style={{ fontSize: 13 * scale, color: e.color, marginLeft: 8 * scale }}>{e.icon}</span>
          </div>

          {/* 컬럼 행 (각각 더블클릭 편집) */}
          {e.columns.map((col, idx) => {
            const cId = `er-${e.id}-c${idx}`;
            const isEd = editingId === cId;
            const saved = templateContent?.[cId]?.content;
            const [n, t] = saved ? (saved.includes('|') ? saved.split('|') : [saved, col.type]) : [col.name, col.type];
            return (
              <div
                key={idx}
                onClick={(ev) => { ev.stopPropagation(); onElementClick?.(cId); }}
                onDoubleClick={(ev) => { ev.stopPropagation(); setEditingId(cId); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  height: ROW_H * scale,
                  padding: `0 ${10 * scale}px`,
                  fontSize: 11.5 * scale,
                  position: 'relative',
                  cursor: 'default',
                }}
              >
                {isEd ? (
                  <input
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    defaultValue={`${n}|${t}`}
                    onBlur={(ev) => { onContentChange?.(cId, ev.currentTarget.value); setEditingId(null); }}
                    onKeyDown={(ev) => {
                      ev.stopPropagation();
                      if (ev.key === 'Enter')  { onContentChange?.(cId, ev.currentTarget.value); setEditingId(null); }
                      if (ev.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(ev) => ev.stopPropagation()}
                    style={{
                      width: '100%', background: 'rgba(20,20,20,0.95)', border: 'none', outline: 'none',
                      color: '#e5e7eb', fontSize: 11.5 * scale, fontFamily: 'inherit', padding: '2px 0',
                    }}
                    placeholder={tr('이름|타입', 'name|type')}
                  />
                ) : (
                  <>
                    <span style={{ color: '#e5e7eb' }}>{n}</span>
                    <span style={{ color: tagColor(col.tag), fontFamily: "'Fira Mono',monospace", fontSize: 10.5 * scale }}>{t}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // 관계선 SVG (스케일 좌표)
  const renderRelations = () => {
    return (
      <svg
        style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }}
      >
        {relations.map((r, i) => {
          const ef = ent(r.from.eid);
          const et = ent(r.to.eid);
          const ofx = templateContent?.[`er-${ef.id}`]?.dx ?? 0;
          const ofy = templateContent?.[`er-${ef.id}`]?.dy ?? 0;
          const otx = templateContent?.[`er-${et.id}`]?.dx ?? 0;
          const oty = templateContent?.[`er-${et.id}`]?.dy ?? 0;

          const fx = (r.from.side === 'left' ? ef.x + ofx : ef.x + ofx + ef.w) * scale;
          const fy = (colCenterY(ef, r.from.col) + ofy) * scale;
          const tx = (r.to.side   === 'left' ? et.x + otx : et.x + otx + et.w) * scale;
          const ty = (colCenterY(et, r.to.col) + oty) * scale;

          // ㄷ자 형태 path
          const midX = (fx + tx) / 2;
          const path = `M ${fx} ${fy} L ${midX} ${fy} L ${midX} ${ty} L ${tx} ${ty}`;
          return (
            <g key={i}>
              <path d={path} stroke="rgba(160,160,180,0.55)" strokeWidth={1.2} fill="none" />
              <circle cx={fx} cy={fy} r={2.5} fill="rgba(160,160,180,0.55)" />
              <circle cx={tx} cy={ty} r={2.5} fill="rgba(160,160,180,0.55)" />
              {r.label && (
                <text
                  x={r.from.side === 'right' ? fx + 8 : fx - 8}
                  y={fy - 4}
                  fill="rgba(255,255,255,0.55)"
                  fontSize={10 * scale}
                  textAnchor={r.from.side === 'right' ? 'start' : 'end'}
                >{r.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <div
      style={{ width, height, background: '#0f0f0f', position: 'relative', overflow: 'hidden',
               border: '1px solid #2a2a2a', boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
               fontFamily: "'Inter','Segoe UI',sans-serif" }}
      onDoubleClick={onPageDoubleClick}
    >
      {/* 좌상단 타이틀 뱃지 */}
      <div style={{ position: 'absolute', top: 12 * scale, left: 16 * scale }}>
        {interactive('er-title', (
          <div style={{
            fontSize: 11 * scale, fontWeight: 600, color: 'rgba(255,255,255,0.7)',
            border: '1px solid rgba(255,255,255,0.18)', borderRadius: 4 * scale,
            padding: `${3 * scale}px ${10 * scale}px`,
            background: 'rgba(255,255,255,0.03)',
            whiteSpace: 'nowrap',
          }}>
            ⌐ Relational Database
          </div>
        ), 'Relational Database')}
      </div>

      {/* 외곽 카드 영역 (얇은 테두리) */}
      <div style={{
        position: 'absolute', top: 38 * scale, left: 16 * scale,
        right: 16 * scale, bottom: 16 * scale,
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 6 * scale,
      }} />

      {renderRelations()}
      {entities.map(renderEntity)}
    </div>
  );
});

// ── A4 문서 페이지 (isDocPage=true 인 프레임 전용 렌더러) ─────
// mm→px: A4 기준 794px=210mm → 1mm≈3.781px
const MM_TO_A4_PX = 794 / 210;

function DocPageShape({ data, id, width, height }: { data: NodeData; id: string; width: number; height: number }) {
  // 스타일 템플릿 분기 — hooks 보다 먼저 처리할 수 없으므로 아래에서 조건부 렌더
  const isTemplate = !!(data.docTemplate as string | undefined);

  const { updateNodeData, fitView } = useReactFlow();
  const setSelectedDocElement = useCanvasStore(s => s.setSelectedDocElement);
  const selectedDocElem = useCanvasStore(s => s.selectedDocElement);
  const editorRef = useRef<HTMLDivElement>(null);
  // 편집 모드: 더블클릭으로 진입, blur/Escape로 해제
  const [editMode, setEditMode] = useState(false);

  const topMm    = (data.docMarginTop    as number | undefined) ?? 5;
  const bottomMm = (data.docMarginBottom as number | undefined) ?? 5;
  const leftMm   = (data.docMarginLeft   as number | undefined) ?? 10;
  const rightMm  = (data.docMarginRight  as number | undefined) ?? 10;

  const scale    = width / 794;
  const topPx    = topMm    * MM_TO_A4_PX * scale;
  const bottomPx = bottomMm * MM_TO_A4_PX * scale;
  const leftPx   = leftMm   * MM_TO_A4_PX * scale;
  const rightPx  = rightMm  * MM_TO_A4_PX * scale;

  // 빈 페이지면 글 시작 자리에 ↵ 표시 (워드처럼)
  const [isEmpty, setIsEmpty] = useState(!((data.docPageText as string | undefined) ?? ''));

  // 저장된 글 → 편집 영역. 서식 있는 HTML(docPageHtml)이 글(docPageText)과 맞을 때만 쓰고,
  // AI 등이 글만 바꿨으면 글로 다시 채움. 내가 방금 저장한 내용이면 건드리지 않음 (커서 유지)
  const lastSavedHtml = useRef<string | null>(null);
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const text = (data.docPageText as string | undefined) ?? '';
    const html = (data.docPageHtml as string | undefined) ?? '';
    if (lastSavedHtml.current !== null && html === lastSavedHtml.current && docElementToText(el) === text) return;
    if (html && docHtmlToText(html) === text) el.innerHTML = sanitizeDocHtml(html);
    else el.textContent = text;
    lastSavedHtml.current = el.innerHTML;
    setIsEmpty(text === '');
  }, [data.docPageText, data.docPageHtml]);

  const saveEditor = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    const html = el.innerHTML;
    const text = docElementToText(el);
    lastSavedHtml.current = html;
    updateNodeData(id, { docPageHtml: html, docPageText: text });
  }, [id, updateNodeData]);

  // 마지막으로 고른 글자 범위 — 색 입력칸(HEX)처럼 포커스를 가져가는 곳에서도 그 글자에 칠할 수 있게
  const savedRange = useRef<Range | null>(null);
  useEffect(() => {
    if (!editMode) return;
    const onSel = () => {
      const el = editorRef.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0) return;
      const r = sel.getRangeAt(0);
      if (!el.contains(r.commonAncestorContainer)) return;
      savedRange.current = r.cloneRange();
      reportSelectionPt();
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editMode]);

  // 커서 자리 글자 크기를 속성 패널 "크기" 칸에 알림 (따로 정한 크기 없으면 페이지 기본 크기)
  const basePtRef = useRef(11);
  basePtRef.current = (data.docFontSize as number | undefined) ?? 11;
  const reportSelectionPt = () => {
    const el = editorRef.current;
    const r = savedRange.current;
    if (!el || !r) return;
    // 범위가 요소 경계에서 시작하면(크기 적용 직후 등) 그 경계 바로 뒤 글자를 기준으로
    let node: Node = r.startContainer;
    if (node.nodeType === Node.ELEMENT_NODE && node.childNodes[r.startOffset]) node = node.childNodes[r.startOffset];
    while (node.nodeType === Node.ELEMENT_NODE && node.firstChild && !(node as Element).hasAttribute('data-pt')) node = node.firstChild;
    const start = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const sized = start?.closest('[data-pt]');
    const pt = sized && el.contains(sized) ? Number((sized as HTMLElement).dataset.pt) : basePtRef.current;
    const fonted = start?.closest('[data-font]');
    const font = (fonted && el.contains(fonted) ? (fonted as HTMLElement).dataset.font : baseFontRef.current) as DocFontKey;
    setDocSelectionFormat({ nodeId: id, pt, font });
  };
  const baseFontRef = useRef<DocFontKey>(DEFAULT_DOC_FONT);
  baseFontRef.current = ((data.docFontFamily as DocFontKey | undefined) ?? DEFAULT_DOC_FONT);

  // 고른 글자를 서식 span 으로 감싸기 (크기·글꼴 공통)
  //  · 커서만 있으면 빈 span 을 끼우고 그 안에 커서 → 이어서 쓰는 글자에 적용
  //  · 글자를 골랐으면 브라우저 명령으로 표시(mark)해 둔 뒤 우리 span 으로 바꿈
  type SpanFormat = {
    attr: 'pt' | 'font';
    apply: (span: HTMLElement) => void;
    clear: (span: HTMLElement) => void;
    has: (span: HTMLElement) => boolean;
    mark: () => void;
    isMarked: (e: HTMLElement) => boolean;
  };
  const wrapSelection = (sel: Selection, f: SpanFormat) => {
    const el = editorRef.current!;
    const range = sel.getRangeAt(0);
    if (range.collapsed) {
      // 방금 끼운 빈 span 안이면(연달아 바꿈) 새로 만들지 않고 그 span 만 바꿈
      const cur = range.startContainer;
      const pending = (cur.nodeType === Node.ELEMENT_NODE ? cur as Element : cur.parentElement)?.closest<HTMLElement>('span');
      if (pending && el.contains(pending) && (pending.textContent ?? '').replace(/​/g, '') === '') {
        f.apply(pending);
        return;
      }
      const span = document.createElement('span');
      f.apply(span);
      const txt = document.createTextNode('​');
      span.appendChild(txt);
      range.insertNode(span);
      const r = document.createRange();
      r.setStart(txt, 1);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    document.execCommand('styleWithCSS', false, 'false');
    f.mark();
    const marked = [
      ...Array.from(el.querySelectorAll<HTMLElement>('font')),
      ...Array.from(el.querySelectorAll<HTMLElement>('span')),
    ].filter(f.isMarked);
    const made: HTMLElement[] = [];
    marked.forEach(m => {
      let span = m;
      if (m.tagName === 'FONT') {
        span = document.createElement('span');
        while (m.firstChild) span.appendChild(m.firstChild);
        m.replaceWith(span);
      }
      f.apply(span);
      // 안쪽에 예전 값이 남아 있으면 지움 (새 값이 이기도록)
      span.querySelectorAll<HTMLElement>(`[data-${f.attr}]`).forEach(inner => {
        f.clear(inner);
        if (!inner.getAttribute('style')) inner.removeAttribute('style');
      });
      made.push(span);
    });
    // 정리: 브라우저가 스타일을 지운 바깥 span 에 남은 표시 제거, 속성 없는 껍데기 span 은 벗김
    el.querySelectorAll<HTMLElement>(`span[data-${f.attr}]`).forEach(s => { if (!f.has(s)) f.clear(s); });
    el.querySelectorAll<HTMLElement>('span').forEach(s => {
      if (!s.getAttribute('style')) s.removeAttribute('style');
      if (s.attributes.length === 0 && !made.includes(s)) s.replaceWith(...Array.from(s.childNodes));
    });
    if (made.length) {
      const r = document.createRange();
      r.setStartBefore(made[0]);
      r.setEndAfter(made[made.length - 1]);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  };

  const FONT_MARK = '__docfont__';
  const sizeFormat = (pt: number): SpanFormat => ({
    attr: 'pt',
    apply: (s) => styleDocSizeSpan(s, pt),
    clear: (s) => { delete s.dataset.pt; s.style.fontSize = ''; },
    has: (s) => s.style.fontSize.includes('--doc-pt'),
    mark: () => document.execCommand('fontSize', false, '7'),
    isMarked: (e) => (e.tagName === 'FONT' && e.getAttribute('size') === '7') || e.style.fontSize === 'xxx-large',
  });
  const fontFormat = (key: DocFontKey): SpanFormat => ({
    attr: 'font',
    apply: (s) => styleDocFontSpan(s, key),
    clear: (s) => { delete s.dataset.font; s.style.fontFamily = ''; },
    has: (s) => !!s.style.fontFamily && !s.style.fontFamily.includes(FONT_MARK),
    mark: () => document.execCommand('fontName', false, FONT_MARK),
    isMarked: (e) => (e.tagName === 'FONT' && e.getAttribute('face') === FONT_MARK) || e.style.fontFamily.includes(FONT_MARK),
  });

  // 서식 적용 공통 — 글 쓰는 중이면 지금 선택에, 포커스가 패널 입력칸에 가 있으면 기억한 선택을 되살려서
  const withEditorSelection = (fn: (sel: Selection) => void, opts: { allowCollapsed: boolean; returnFocus: boolean }): boolean => {
    const el = editorRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return false;
    if (document.activeElement === el) {
      if (sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return false;
      fn(sel);
    } else {
      const r = savedRange.current;
      if (!r || (r.collapsed && !opts.allowCollapsed) || !el.contains(r.commonAncestorContainer)) return false;
      const prev = document.activeElement as HTMLElement | null;
      el.focus({ preventScroll: true });
      sel.removeAllRanges();
      sel.addRange(r);
      fn(sel);
      if (opts.returnFocus && prev && prev !== document.body) prev.focus({ preventScroll: true });
    }
    saveEditor();
    if (sel.rangeCount > 0) savedRange.current = sel.getRangeAt(0).cloneRange();
    reportSelectionPt();
    return true;
  };

  // 속성 패널 색·크기 → 고른 글자(또는 지금 커서 뒤로 쓸 글자)에만
  useEffect(() => registerDocEditor(id, {
    applyColor: (color) => withEditorSelection(() => {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, color);
    }, { allowCollapsed: false, returnFocus: true }),   // HEX 칸은 글자마다 바뀌므로 포커스 돌려줌

    // 크기·글꼴 칸은 Enter/고를 때 한 번만 → 포커스는 페이지로 돌아와 이어 쓰기
    applySize: (pt) => withEditorSelection((sel) => wrapSelection(sel, sizeFormat(pt)), { allowCollapsed: true, returnFocus: false }),
    applyFont: (key) => withEditorSelection((sel) => wrapSelection(sel, fontFormat(key)), { allowCollapsed: true, returnFocus: false }),
  }));

  // L자형 코너 표시 — 워드처럼 글 쓰는 영역 모서리에서 바깥쪽(여백 쪽)으로 꺾임
  const bSize  = Math.max(4, Math.min(Math.round(16 * scale), topPx, bottomPx, leftPx, rightPx));
  const bColor = 'rgba(148,163,184,0.75)';
  const bW     = 1;

  const bracketBase: CSSProperties = {
    position: 'absolute', width: bSize, height: bSize,
    pointerEvents: 'none', zIndex: 2, boxSizing: 'border-box',
  };
  const tlStyle: CSSProperties = { ...bracketBase, left: leftPx - bSize, top: topPx - bSize,
    borderBottom: `${bW}px solid ${bColor}`, borderRight: `${bW}px solid ${bColor}` };
  const trStyle: CSSProperties = { ...bracketBase, left: width - rightPx, top: topPx - bSize,
    borderBottom: `${bW}px solid ${bColor}`, borderLeft: `${bW}px solid ${bColor}` };
  const blStyle: CSSProperties = { ...bracketBase, left: leftPx - bSize, top: height - bottomPx,
    borderTop: `${bW}px solid ${bColor}`, borderRight: `${bW}px solid ${bColor}` };
  const brStyle: CSSProperties = { ...bracketBase, left: width - rightPx, top: height - bottomPx,
    borderTop: `${bW}px solid ${bColor}`, borderLeft: `${bW}px solid ${bColor}` };

  // 아키텍처 다이어그램 템플릿
  if (isTemplate && data.docTemplate === 'architecture-diagram') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content } } });
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <ArchitectureDiagramPage
        width={width} height={height} nodeId={id}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onContentChange={handleContentChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // 스케일링 아키텍처 페이지 (인터랙티브 JSX 노드)
  if (isTemplate && data.docTemplate === 'scaling-architecture') {
    return (
      <ScalingArchitecturePage
        width={width} height={height}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // 시퀀스 다이어그램 템플릿 (인터랙티브)
  if (isTemplate && data.docTemplate === 'sequence-diagram') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content } } });
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <SequenceDiagramFocusWrapper id={id}>
        <SequenceDiagramPage
          width={width} height={height}
          templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
          selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
          onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
          onContentChange={handleContentChange}
          onPositionChange={handlePositionChange}
          onPageDoubleClick={() => {
            useCanvasStore.getState().setFocusedDocTemplate('sequence-diagram');
            fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 });
          }}
        />
      </SequenceDiagramFocusWrapper>
    );
  }

  // 빈 배경 페이지 — RF 자식 노드가 위에 그려지는 다크 컨테이너
  if (isTemplate && data.docTemplate === 'plain') {
    const bg = (data.bgColor as string | undefined) ?? '#111111';
    return (
      <div
        style={{
          width, height, background: bg, position: 'relative', overflow: 'visible',
          border: '1px solid rgba(80,80,80,0.55)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.20)',
        }}
        onDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // Audio Upload Flow 시퀀스 다이어그램 템플릿
  if (isTemplate && data.docTemplate === 'audio-upload-sequence') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content } } });
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <AudioUploadSequencePage
        width={width} height={height}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onContentChange={handleContentChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // User Management 문서 템플릿
  if (isTemplate && data.docTemplate === 'user-management') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content } } });
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <UserManagementPage
        width={width} height={height}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onContentChange={handleContentChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // ER 다이어그램 (Relational Database) 템플릿
  if (isTemplate && data.docTemplate === 'er-diagram') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content } } });
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <ERDiagramPage
        width={width} height={height}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onContentChange={handleContentChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // API Reference 템플릿
  if (isTemplate && data.docTemplate === 'api-reference') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content } } });
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <ApiReferencePage
        width={width} height={height}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onContentChange={handleContentChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // 이미지 패널 템플릿
  if (isTemplate && data.docTemplate === 'image-panel') {
    const handleImageChange = (elemId: string, value: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      if (elemId === 'image-panel-title') {
        updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), content: value } } });
      } else {
        updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), imageUrl: value } } });
      }
    };
    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, { docTemplateContent: { ...existing, [elemId]: { ...(existing[elemId] ?? {}), dx, dy } } });
    };
    return (
      <ImagePanelPage
        width={width} height={height} nodeId={id}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onImageChange={handleImageChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  // 스타일 템플릿이면 전용 렌더러로 위임
  if (isTemplate && data.docTemplate === 'music-streaming') {
    const handleContentChange = (elemId: string, content: string) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, {
        docTemplateContent: {
          ...existing,
          [elemId]: { ...(existing[elemId] ?? {}), content },
        },
      });
    };

    const handlePositionChange = (elemId: string, dx: number, dy: number) => {
      const existing = ((data.docTemplateContent ?? {}) as DocTemplateContent);
      updateNodeData(id, {
        docTemplateContent: {
          ...existing,
          [elemId]: { ...(existing[elemId] ?? {}), dx, dy },
        },
      });
    };

    return (
      <MusicStreamingDocPage
        orientation={(data.docOrientation as string | undefined) ?? 'portrait'}
        width={width}
        height={height}
        nodeId={id}
        darkMode={(data.bgColor as string | undefined) === '#111111'}
        templateContent={(data.docTemplateContent as DocTemplateContent | undefined)}
        selectedElementId={selectedDocElem?.nodeId === id ? selectedDocElem.elementId : null}
        onElementClick={(elemId) => setSelectedDocElement(id, elemId)}
        onContentChange={handleContentChange}
        onPositionChange={handlePositionChange}
        onPageDoubleClick={() => fitView({ nodes: [{ id }], minZoom: 1.08, maxZoom: 1.08, duration: 500 })}
      />
    );
  }

  const pageBg   = (data.docPageBg  as string | undefined) ?? '#ffffff';
  const fontSizePt = (data.docFontSize as number | undefined) ?? 11;

  return (
    <div
      style={{
        width, height, background: pageBg, position: 'relative', overflow: 'hidden', boxSizing: 'border-box',
        border: '1px solid rgba(180,180,180,0.55)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.10)',
        cursor: editMode ? 'text' : 'default',
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editMode) return;   // 편집 중 더블클릭은 글자(단어) 선택
        // 더블클릭 → 글쓰기 시작 (페이지를 화면에 맞춰 글자가 보이게)
        setEditMode(true);
        // 커서를 글 끝에
        const el = editorRef.current;
        if (el) {
          el.focus({ preventScroll: true });
          const r = document.createRange();
          r.selectNodeContents(el);
          r.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(r);
        }
        // 페이지를 화면에 맞추되, 왼쪽 속성 패널 자리는 비워 둠 → 패널이 글 쓰는 곳을 가리지 않게
        const flowRect  = (e.currentTarget.closest('.react-flow') as HTMLElement | null)?.getBoundingClientRect();
        const panelRect = document.querySelector('[data-node-props-panel]')?.getBoundingClientRect();
        let leftPad = 260, rightPad = 40;   // 패널이 아직 안 떠 있으면 왼쪽에 대략 패널 폭만큼
        if (flowRect && panelRect) {
          const onRight = panelRect.left + panelRect.width / 2 > flowRect.left + flowRect.width / 2;
          if (onRight) { leftPad = 40; rightPad = Math.round(flowRect.right - panelRect.left + 24); }
          else         { leftPad = Math.round(panelRect.right - flowRect.left + 24); }
        }
        fitView({
          nodes: [{ id }], maxZoom: 1.2, duration: 450,
          padding: { left: `${leftPad}px`, right: `${rightPad}px`, top: '40px', bottom: '40px' },
        });
      }}
    >
      {/* 서식 있는 글쓰기 영역 — 편집 모드일 때만 인터랙티브, 그 외엔 pointer-events:none으로 React Flow 선택/삭제 정상 작동 */}
      <div
        ref={editorRef}
        className="nodrag nopan"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onFocus={() => setEditMode(true)}
        onInput={(e) => setIsEmpty(docElementToText(e.currentTarget) === '')}
        onPaste={(e) => {
          // 붙여넣기는 글자만 (다른 곳 서식·스크립트가 섞이지 않게)
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        onBlur={(e) => {
          // 속성 패널(색 입력칸 등)로 포커스가 간 경우만 고른 범위 기억 — 그 외엔 잊음
          const to = e.relatedTarget as HTMLElement | null;
          if (!to?.closest('[data-node-props-panel]')) { savedRange.current = null; setDocSelectionFormat(null); }
          saveEditor();
          setEditMode(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.currentTarget.blur(); return; }
          e.stopPropagation();
        }}
        style={{
          position:    'absolute',
          top:         0,
          left:        0,
          width:       '100%',
          height:      '100%',
          paddingTop:    topPx,
          paddingBottom: bottomPx,
          paddingLeft:   leftPx,
          paddingRight:  rightPx,
          boxSizing:   'border-box',
          background:  'transparent',
          border:      'none',
          outline:     editMode ? '2px solid rgba(96,165,250,0.4)' : 'none',
          outlineOffset: '-2px',
          ['--doc-pt' as string]: `${1.333 * scale}px`,   // 글자별 크기(pt) span 이 이 값으로 px 계산
          color:       (data.docTextColor as string | undefined) ?? '#1a1a1a',
          textAlign:   (data.docTextAlign as CSSProperties['textAlign'] | undefined) ?? 'left',
          // 상업적 사용 가능한 무료 글꼴만 (기본 프리텐다드) — 시스템 글꼴(맑은 고딕)은 기기마다 달라 안 씀
          fontFamily:  docFontCss(data.docFontFamily as string | undefined),
          fontSize:    Math.round(fontSizePt * 1.333 * scale),
          lineHeight:  1.8,
          zIndex:      2,
          overflow:    'auto',
          wordBreak:   'break-word',
          whiteSpace:  'pre-wrap',
          cursor:      'text',
          // 편집 모드 아닐 때는 클릭 이벤트 통과 → React Flow가 선택·삭제 처리
          pointerEvents: editMode ? 'auto' : 'none',
        }}
      />
      {/* 빈 페이지: 첫 줄 시작 자리에 문단 표시 ↵ */}
      {isEmpty && (
        <div style={{
          position: 'absolute', left: leftPx, top: topPx, zIndex: 1, pointerEvents: 'none',
          fontSize: Math.round(fontSizePt * 1.333 * scale), lineHeight: 1.8,
          color: 'rgba(148,163,184,0.9)', fontFamily: 'sans-serif',
        }}>↵</div>
      )}
      {/* L자형 코너 표시 */}
      <div style={tlStyle} />
      <div style={trStyle} />
      <div style={blStyle} />
      <div style={brStyle} />
    </div>
  );
}

// ── 프레임 컨테이너 (Excalidraw 스타일) ──────────────────────
function FrameShape({ data, id, width, height }: { data: NodeData; id: string; width: number; height: number }) {
  const { updateNodeData, setNodes, fitView, getNodes, getEdges } = useReactFlow();

  // isDocPage → 별도 렌더러 (모든 hooks 호출 후 분기)
  // React 규칙: hooks는 항상 동일 순서로 호출되어야 하므로 아래서 분기
  const isDocPage = !!data.isDocPage;
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(data.title || 'Frame');
  const [showSizeMenu, setShowSizeMenu] = useState(false);
  const [menuOrientation, setMenuOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const inputRef    = useRef<HTMLInputElement>(null);
  const frameLabelRef = useRef<HTMLDivElement>(null); // 라벨 전체(버튼+팝업) 감싸는 ref

  useEffect(() => {
    if (!editing) setDraft(data.title || 'Frame');
  }, [data.title, editing]);

  // 편집 시작 — 전체 선택 대신 글자 끝에 커서
  useEffect(() => {
    const el = inputRef.current;
    if (!editing || !el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  // 슬라이드 번호 — 프레임마다 순서대로 자동 (1, 2, 3…). 다른 프레임을 품은 섹션은 0(번호 없음)
  const slideNo = useStore((s) => slideOrder(s.nodes as AppNode[]).findIndex((n) => n.id === id) + 1);
  // 종이 규격은 이름과 따로 표시 (없으면 자유 크기)
  const paperSize  = paperSizeOf({ width, height, data });
  // DB 테이블이 든 프레임은 규격 자리에 "ERD"로 표시 (규격을 고르면 그 규격)
  const isErd = useStore((s) => (s.nodes as AppNode[]).some((n) => n.parentId === id && n.data.shape === 'entity'));
  const slideTitle = slideNo > 0 ? slideTitleOf(data.title) : (data.title || 'Frame');


  const commitEdit = () => {
    const trimmed = draft.trim();
    // 슬라이드는 규격을 따로 저장 — 이름에서 규격을 읽던 예전 프레임도 칩 유지
    if (trimmed && trimmed !== data.title) updateNodeData(id, data.isPaperFrame ? { title: trimmed, paperSize: paperSize } : { title: trimmed });
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { setEditing(false); setDraft(data.title || 'Frame'); }
  };

  // 종이 규격으로 노드 크기 변경
  const applyPaperSize = (paper: PaperSize) => {
    const { w, h } = paperDims(paper, menuOrientation);
    setNodes((nds) => nds.map((n) => n.id === id ? {
      ...n, width: w, height: h,
      zIndex: -Math.ceil(w * h / 100),
      data: {
        ...n.data, width: w, height: h, isPaperFrame: true, paperSize: paper.name,
      },
    } : n));
    setShowSizeMenu(false);
  };

  // frame: solid일 때 box-shadow로 sub-pixel 깨짐 방지
  const fStrokeColor = data.strokeColor ?? '#818cf8';   // 기본 윤곽선 — 라벨(#6366f1)보다 한 단계 연하게
  const fStrokeW     = data.strokeWidth ?? 1.5;
  const fStrokeStyle = data.strokeStyle ?? 'solid';
  const frameStyle: React.CSSProperties = fStrokeStyle === 'solid' ? {
    width,
    height,
    border:       'none',
    boxShadow:    `0 0 0 ${fStrokeW}px ${fStrokeColor}`,
    borderRadius: canvasRadius(data.borderRadius ?? DEFAULT_RADIUS.frame),
    opacity:      (data.opacity ?? 100) / 100,
    background:   data.bgColor ?? 'transparent',
    boxSizing:    'border-box',
  } : {
    width,
    height,
    borderColor:  fStrokeColor,
    borderWidth:  fStrokeW,
    borderStyle:  fStrokeStyle as React.CSSProperties['borderStyle'],
    borderRadius: canvasRadius(data.borderRadius ?? DEFAULT_RADIUS.frame),
    opacity:      (data.opacity ?? 100) / 100,
    background:   data.bgColor ?? 'transparent',
  };

  // 프레임 위 라벨 — 슬라이드면 [번호] 이름 [규격], 아니면 [규격 버튼] 이름
  const label = (
      <div className={styles.frameLabel} ref={frameLabelRef} onDoubleClick={(e) => e.stopPropagation()}>
          <>
            {/* 슬라이드 번호 배지 — 순서대로 자동, 순서는 오른쪽 사이드바 페이지 탭에서 끌어서 바꿈 */}
            {slideNo > 0 && (
              <span
                title={tr(`${slideNo}번째 슬라이드`, `Slide ${slideNo}`)}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  minWidth: 18, height: 18, padding: '0 5px', marginRight: 6,
                  borderRadius: 9, background: '#6366f1', color: '#fff',
                  fontSize: 11, fontWeight: 700, userSelect: 'none',
                }}
              >{slideNo}</span>
            )}
            {/* 종이 규격 변경 버튼 — 섹션만 (슬라이드는 이름 뒤 규격 칩을 누름) */}
            {slideNo === 0 && <button
              className="nodrag nopan"
              onClick={(e) => { e.stopPropagation(); setShowSizeMenu((v) => !v); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 20, height: 20, borderRadius: 4,
                border: 'none', background: 'transparent',
                cursor: 'pointer', color: '#6366f1', opacity: 0.7,
                transition: 'opacity 0.12s, background 0.12s',
                marginRight: 1,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'rgba(99,102,241,0.12)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.background = 'transparent'; }}
              title={tr('종이 규격 변경', 'Change paper size')}
            >
              <LayoutGrid size={14} strokeWidth={2} />
            </button>}
            {/* 이름 — 더블클릭하면 그 자리에서 바로 입력 (번호·규격 칩은 그대로). 이름이 없으면 흐린 안내 글자 */}
            {editing ? (
              <input
                ref={inputRef}
                className={`${styles.frameLabelInput} nopan nodrag`}
                value={draft}
                placeholder={tr('제목 없음', 'Untitled')}
                // 글자 수만큼만 넓게 — 한글 기준 1em, 비었으면 안내 글자만큼
                style={{ width: `calc(${Math.max(draft.length, 4) + 1}em + 8px)` }}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={handleKeyDown}
                maxLength={40}
              />
            ) : (
              <span
                className={styles.frameLabelText}
                style={slideTitle ? undefined : { opacity: 0.45, fontWeight: 500 }}
                onDoubleClick={(e) => { e.stopPropagation(); setDraft(slideTitle); setEditing(true); }}
              >
                {slideTitle || tr('제목 없음', 'Untitled')}
              </span>
            )}
            {/* 종이 규격 칩 — 누르면 규격 메뉴. 규격이 없으면 자유 크기 */}
            {slideNo > 0 && (
              <button
                className="nodrag nopan"
                onClick={(e) => { e.stopPropagation(); setShowSizeMenu((v) => !v); }}
                title={tr('종이 규격 변경', 'Change paper size')}
                style={{
                  marginLeft: 6, height: 18, padding: '0 6px', borderRadius: 4,
                  border: '1px solid rgba(99,102,241,0.25)', background: 'transparent',
                  fontSize: 10.5, fontWeight: 600, color: 'rgba(99,102,241,0.8)', cursor: 'pointer',
                }}
              >{paperSize ?? (isErd ? 'ERD' : tr('자유', 'Free'))}</button>
            )}
          </>

        {/* 종이 규격 팝업 — backdrop+팝업 모두 Portal로 document.body에 렌더링해 stacking context 문제 회피 */}
        {showSizeMenu && (() => {
          const rect = frameLabelRef.current?.getBoundingClientRect();
          return createPortal(
            <>
              {/* 외부 클릭 닫기 backdrop */}
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
                onPointerDown={() => setShowSizeMenu(false)}
              />
              {/* 팝업 본체 */}
              <div style={{
                position: 'fixed',
                top: rect ? rect.bottom + 4 : 0,
                left: rect ? rect.left : 0,
                zIndex: 9999,
                background: '#1c1c1e',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 14,
                overflow: 'hidden',
                width: 260,
                boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
              }}>
                {/* 팝업 헤더: 가로/세로 토글 */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 10px 8px',
                  borderBottom: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {tr('종이 규격', 'Paper size')}
                  </span>
                  <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 7, padding: 2 }}>
                    <button onClick={() => setMenuOrientation('portrait')} title={tr('세로', 'Portrait')} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 24, borderRadius: 5, border: 'none', cursor: 'pointer',
                      background: menuOrientation === 'portrait' ? 'rgba(255,255,255,0.18)' : 'transparent',
                      transition: 'background 0.15s',
                    }}>
                      <svg width="10" height="14" viewBox="0 0 10 14" fill="none">
                        <rect x="0.75" y="0.75" width="8.5" height="12.5" rx="1.2"
                          stroke={menuOrientation === 'portrait' ? '#fff' : 'rgba(255,255,255,0.4)'}
                          strokeWidth="1.5" fill={menuOrientation === 'portrait' ? 'rgba(255,255,255,0.15)' : 'none'} />
                      </svg>
                    </button>
                    <button onClick={() => setMenuOrientation('landscape')} title={tr('가로', 'Landscape')} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 24, borderRadius: 5, border: 'none', cursor: 'pointer',
                      background: menuOrientation === 'landscape' ? 'rgba(255,255,255,0.18)' : 'transparent',
                      transition: 'background 0.15s',
                    }}>
                      <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
                        <rect x="0.75" y="0.75" width="12.5" height="8.5" rx="1.2"
                          stroke={menuOrientation === 'landscape' ? '#fff' : 'rgba(255,255,255,0.4)'}
                          strokeWidth="1.5" fill={menuOrientation === 'landscape' ? 'rgba(255,255,255,0.15)' : 'none'} />
                      </svg>
                    </button>
                  </div>
                </div>
                {/* 규격 목록 */}
                <div style={{ padding: '4px 6px 6px' }}>
                  {PAPER_SIZES.map((p) => {
                    const { w: dw, h: dh } = paperDims(p, menuOrientation);   // 아이콘도 실제 비율대로 (16:9는 늘 가로)
                    const iconW = dw < dh ? 18 : 26;
                    const iconH = dw < dh ? 26 : 18;
                    return (
                      <button key={p.name} onClick={() => applyPaperSize(p)} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        width: '100%', padding: '7px 6px', borderRadius: 9,
                        border: 'none', background: 'transparent',
                        cursor: 'pointer', textAlign: 'left', transition: 'background 0.12s',
                      }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                      >
                        <div style={{ width: 30, height: 30, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{
                            width: iconW, height: iconH,
                            transition: 'width 0.22s cubic-bezier(0.4,0,0.2,1), height 0.22s cubic-bezier(0.4,0,0.2,1)',
                            border: '1.5px solid rgba(255,255,255,0.28)',
                            borderRadius: 2, background: 'rgba(255,255,255,0.05)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 5.5, color: 'rgba(255,255,255,0.45)', fontWeight: 700,
                          }}>{p.name}</div>
                        </div>
                        <div>
                          <div style={{ color: '#fff', fontSize: 12, fontWeight: 500 }}>{p.name}</div>
                          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, lineHeight: 1.4, marginTop: 1 }}>{p.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>,
            document.body
          );
        })()}
      </div>
  );

  // 문서 페이지는 별도 렌더러 — 라벨(번호 배지)은 같이 붙임
  if (isDocPage) {
    return (
      <div style={{ position: 'relative', width, height }}>
        <DocPageShape data={data} id={id} width={width} height={height} />
        {label}
      </div>
    );
  }

  return (
    <div
      className={styles.shapeFrame}
      style={frameStyle}
      onDoubleClick={() => fitView({ nodes: [{ id }], padding: 0.35, maxZoom: 1.2, duration: 450 })}
    >
      {label}
    </div>
  );
}

// ── 도형 그림자 (속성 패널 "세부") ────────────────────────────
// 0 없음 · 1 약하게 · 2 보통 · 3 강하게. 윤곽선도 box-shadow로 그리므로 둘을 쉼표로 이어 붙임
const DROP_SHADOWS = [
  '',
  '0 1px 2px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.10)',
  '0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)',
  '0 12px 32px rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.10)',
];
const withDropShadow = (stroke: string | undefined, level: unknown): string | undefined => {
  const drop = DROP_SHADOWS[typeof level === 'number' ? level : 0] ?? '';
  return [stroke, drop].filter(Boolean).join(', ') || undefined;
};

// ── 캔버스 기본 글자·펜 색 ───────────────────────────────────
// 색을 따로 고르지 않았으면(없음 또는 예전 기본값 #e2e8f0) 화면 모드에 맞는 색(--canvas-ink)을 씀
// → 밝은 모드에서 흰 글씨가 안 보이던 문제 방지
const LEGACY_DEFAULT_INK = '#e2e8f0';
const inkColor = (c: string | undefined) =>
  !c || c.toLowerCase() === LEGACY_DEFAULT_INK ? 'var(--canvas-ink)' : c;

// 도형 안 글자색 — 글자색을 따로 안 골랐으면 도형 배경에 맞춰 잘 보이는 색
//  · 배경색을 직접 정했으면(hex) 그 밝기로 진한 글씨/흰 글씨 선택
//  · 배경이 투명하면 캔버스 글자색, 아니면 도형 기본 글자색(defaultInk)
const shapeInk = (fontColor: string | undefined, bg: string | undefined, defaultInk: string) => {
  if (fontColor && fontColor.toLowerCase() !== LEGACY_DEFAULT_INK) return fontColor;
  if (bg === 'transparent') return 'var(--canvas-ink)';
  const m = bg && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
  if (m) {
    const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#1f2937' : '#f8fafc';
  }
  return defaultInk;
};

// 앱 화면 모드(html.dark-mode) 구독 — 코드 블록 "자동" 테마용
function useAppDarkMode() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains('dark-mode'));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── 텍스트 박스 공통 계산 ─────────────────────────────────────
// 굵기 이름 → 숫자 (예전 노드는 normal/bold만 있음)
const WEIGHT_NUM = { normal: 400, medium: 500, semibold: 600, bold: 700 } as const;
const cssWeight = (w: NodeData['fontWeight']) => WEIGHT_NUM[w ?? 'normal'] ?? 400;

const textFontFamily = (f: NodeData['fontFamily']) => {
  switch (f) {
    // 손글씨: 영문 Excalifont + 한글 Xiaolai (app/fonts.css)
    case 'handwriting': return "'Excalifont','Xiaolai KR','Segoe Script','Comic Sans MS',cursive";
    case 'mono':        return "'JetBrains Mono','Fira Code','Consolas','Courier New',monospace";
    case 'serif':       return "'Georgia','Times New Roman',serif";
    default:            return "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif";
  }
};

// 글자 크기(px) = 높이 × fontScale
const textFontPx = (fontScale: number | undefined, height: number) =>
  Math.max(8, Math.round(height * (fontScale ?? 0.27)));

// 상하 여백 — 상단 정렬은 위 8 + 아래 8, 중앙 정렬은 위아래 4씩
const textBoxPadY = (alignTop: boolean | undefined) => (alignTop ? 16 : 8);

// 보조 줄(subtitle) — 본문 아래 작고 연한 안내 글씨. 본문 글자 크기를 따라 커지고 작아짐 (em)
const textSubtitleStyle: React.CSSProperties = {
  display: 'block', fontSize: '0.34em', fontWeight: 400, fontStyle: 'normal', color: '#94a3b8', marginTop: '0.4em',
};

// 주어진 너비·글자 크기에서 글을 모두 담는 데 필요한 상자 높이 (줄바꿈 반영해 실제로 재어 봄)
export const measureTextBoxHeight = (
  data: Pick<NodeData, 'title' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'textAlignTop'> & { subtitle?: string },
  width: number,
  fontPx: number,
) => {
  const probe = document.createElement('div');
  Object.assign(probe.style, {
    position: 'absolute', visibility: 'hidden', left: '-99999px', top: '0',
    width: `${width}px`, boxSizing: 'border-box', padding: '0 8px',
    fontSize: `${fontPx}px`, lineHeight: '1.4',
    fontWeight: String(cssWeight(data.fontWeight)),
    fontStyle: data.fontStyle === 'italic' ? 'italic' : 'normal',
    fontFamily: textFontFamily(data.fontFamily),
    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  });
  probe.textContent = data.title || tr('텍스트', 'Text');
  if (data.subtitle) {
    const sub = document.createElement('span');
    Object.assign(sub.style, textSubtitleStyle);
    sub.textContent = data.subtitle;
    probe.appendChild(sub);
  }
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h + textBoxPadY(data.textAlignTop);
};

// ── 텍스트 박스 (투명 배경, 중앙 정렬, 비례 폰트, 자동 높이 확장) ──
// 글씨 편집 칸에서 포커스가 속성 패널(글씨 도구)로 옮겨 갔는지 — 그럴 땐 글씨 편집 모드 유지
const blurredToPanel = (e: React.FocusEvent) => {
  const panelSel = '[data-node-props-panel]';
  return !!(e.relatedTarget as Element | null)?.closest(panelSel) || !!document.querySelector(`${panelSel}:hover`);
};

function TextShape({ data, id, width, height }: { data: NodeData; id: string; width: number; height: number }) {
  const { updateNodeData, setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const setEditingTextNodeId = useCanvasStore((s) => s.setEditingTextNodeId);

  // 글씨를 쓰는 동안엔 글상자 전체가 아니라 글씨만 선택된 것처럼 — 크기 조절 점 숨김
  useEffect(() => {
    if (editing) setEditingTextNodeId(id);
  }, [editing, id, setEditingTextNodeId]);
  const editRef    = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);

  // ── 높이 자동 확장 (내용이 박스를 초과하면 아래로 늘어남) ──────
  // fontScale 역산으로 폰트 크기(px)를 고정한 채 박스만 확장 → 무한루프 방지
  // 높이·비율은 늘 "지금 값"을 ref로 읽음 — 웹폰트 로딩 뒤 늦게 도는 확인이 옛 높이·글자 크기를 쓰면
  // 상자를 키운 직후 글씨가 예전 크기로 되돌아감
  const latest = useRef({ height, fontScale: data.fontScale, alignTop: data.textAlignTop });
  latest.current = { height, fontScale: data.fontScale, alignTop: data.textAlignTop };
  const expandIfNeeded = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const { height: curH, fontScale, alignTop } = latest.current;
    const contentH = el.offsetHeight;
    const minH     = contentH + textBoxPadY(alignTop);
    if (minH <= curH) return;                // 이미 충분하면 종료
    const curFontSize  = textFontPx(fontScale, curH);
    const newFontScale = curFontSize / minH; // 폰트 px 고정, 비율 재계산
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, height: minH, data: { ...n.data, height: minH, fontScale: newFontScale } }
          : n,
      ),
    );
  }, [id, setNodes]);

  // 디스플레이 모드: 글·크기 변경 후 오버플로 체크 (웹폰트가 늦게 내려받아지면 글 폭이 바뀌므로 다 받은 뒤 한 번 더)
  useEffect(() => {
    let cancelled = false;   // 그사이 다시 렌더되면 늦게 오는 확인은 버림
    expandIfNeeded(displayRef.current);
    void document.fonts?.ready.then(() => { if (!cancelled) expandIfNeeded(displayRef.current); });
    return () => { cancelled = true; };
  }, [data.title, data.subtitle, height, data.fontScale, expandIfNeeded]);

  // 편집 모드 진입 시 글자 끝으로 커서 이동
  useEffect(() => {
    if (!editing || !editRef.current) return;
    editRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editRef.current);
    range.collapse(false);   // 전체 선택 대신 글자 끝에 커서
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }, [editing]);

  // 편집 중 키 입력마다 오버플로 체크
  const handleInput = useCallback(() => {
    expandIfNeeded(editRef.current?.parentElement ?? null);   // 보조 줄까지 담은 바깥 칸 높이
  }, [expandIfNeeded]);

  const commitEdit = (keepTextMode = false) => {
    const text = (editRef.current?.innerText ?? '').trim();
    updateNodeData(id, { title: text || tr('텍스트', 'Text') });
    setEditing(false);
    if (!keepTextMode && useCanvasStore.getState().editingTextNodeId === id) setEditingTextNodeId(null);
  };

  // Enter는 줄바꿈(상자가 아래로 늘어남), Esc 또는 바깥 클릭으로 편집 완료
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); commitEdit(); }
  };

  const computedFontSize = textFontPx(data.fontScale, height);

  // 윤곽선 스타일 — box-shadow 사용으로 sub-pixel 깨짐 방지
  // border는 캔버스 축소 시 0.Xpx로 렌더되어 불규칙하게 사라짐
  // box-shadow(0 0 0 Npx)는 동일한 시각 효과이면서 sub-pixel에서 안정적
  const strokeColor  = data.strokeColor;
  const hasBorder    = strokeColor && strokeColor !== 'transparent';
  const strokeW      = data.strokeWidth ?? 1;
  const shadowBorder = hasBorder ? `0 0 0 ${strokeW}px ${strokeColor}` : 'none';

  // 텍스트/편집 공통 스타일 — textAlignTop이면 상단 정렬(문서용), 아니면 수직 중앙
  const innerStyle: React.CSSProperties = {
    position:   'absolute',
    top:        data.textAlignTop ? 8 : '50%',
    left:       0,
    right:      0,
    transform:  data.textAlignTop ? 'none' : 'translateY(-50%)',
    padding:    '0 8px',
    fontSize:   computedFontSize,
    fontWeight: cssWeight(data.fontWeight),
    fontStyle:  (data.fontStyle as string | undefined) === 'italic' ? 'italic' : 'normal',
    fontFamily: textFontFamily(data.fontFamily),
    color:      inkColor(data.fontColor),
    textAlign:  data.textAlignTop ? 'left' : 'center',
    wordBreak:  'break-word',
    whiteSpace: 'pre-wrap',   // 줄바꿈 유지
    lineHeight: 1.4,
  };

  return (
    <div
      style={{
        position:     'relative',
        width,
        height,
        background:   'transparent',
        border:       'none',
        opacity:      (data.opacity ?? 100) / 100,   // 투명도는 글씨까지 함께 — 배경 없는 글상자도 흐려지게
        overflow:     'visible',   // 확장 연산 중 순간적 overflow 허용
        boxSizing:    'border-box',
      }}
      onDoubleClick={() => setEditing(true)}
    >
      {/* 배경/테두리 전용 레이어 */}
      <div
        aria-hidden
        style={{
          position:     'absolute',
          inset:        0,
          background:   data.bgColor ?? 'transparent',
          borderRadius: canvasRadius(data.borderRadius ?? DEFAULT_RADIUS.text),
          boxShadow:    shadowBorder,
          pointerEvents:'none',
          boxSizing:    'border-box',
        }}
      />
      {editing ? (
        <div style={innerStyle}>
          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            className="nopan nodrag"
            onBlur={(e) => commitEdit(blurredToPanel(e))}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            style={{
              outline:    'none',
              cursor:     'text',
              whiteSpace: 'pre-wrap',
              userSelect: 'text',
            }}
          >
            {/* 기본 글자(텍스트)면 빈 상자로 시작 */}
            {isTextPlaceholder(data.title) ? '' : (data.title ?? '')}
          </div>
          {data.subtitle && <span style={textSubtitleStyle}>{data.subtitle}</span>}
        </div>
      ) : (
        <div ref={displayRef} style={{ ...innerStyle, userSelect: 'none' }}>
          {/* 아직 아무것도 안 쓴 글상자는 '텍스트'를 안내 글자처럼 연하게 */}
          {data.title && !isTextPlaceholder(data.title)
            ? data.title
            : <span style={{ opacity: 0.3 }}>{tr('텍스트', 'Text')}</span>}
          {data.subtitle && <span style={textSubtitleStyle}>{data.subtitle}</span>}
        </div>
      )}
    </div>
  );
}

// 도형 글 맞춤: 이보다 작게는 줄이지 않음 (읽을 수 있는 최소) · 그래도 넘칠 때 쓰는 좁은 여백
const FIT_MIN_FONT      = 9;
const FIT_TIGHT_PADDING = '2px 6px';

// ── 도형 내부 인라인 텍스트 편집기 (텍스트 상자 전용) ──────────
function InlineTextEditor({
  data, id,
  padding = '8px',
  style: extraStyle = {},
  placeholder = true,
  defaultInk,
  defaultFontSize = 12,
}: {
  data: NodeData;
  id: string;
  padding?: string;
  style?: React.CSSProperties;
  placeholder?: boolean;   // false: 일반 도형 — 비어 있으면 안내 글자 없이 빈 도형, 더블클릭하면 글쓰기
  defaultInk?: string;     // 도형 안일 때 기본 글자색 — 도형 배경에 맞춰 대비 (shapeInk)
  defaultFontSize?: number;
}) {
  const { updateNodeData, setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const setEditingTextNodeId = useCanvasStore((s) => s.setEditingTextNodeId);
  const boxRef     = useRef<HTMLDivElement>(null);    // 편집 중 바깥 상자 (가운데 정렬·넘침 측정)
  const editRef    = useRef<HTMLDivElement>(null);    // 실제 입력칸 (글자 크기만큼)
  const displayRef = useRef<HTMLDivElement>(null);

  // 일반 도형(placeholder=false)은 크기를 바꾸지 않고 글을 도형에 맞춤 — 도형이 커지면 단면도·배치가 틀어지므로
  // 넘치면 ① 원래 여백에서 글씨를 줄여 보고 ② 그래도 안 되면 여백까지 좁혀서 다시 줄임 (화면 표시만, 저장값은 그대로)
  const [fit, setFit] = useState<{ fontSize: number; padding?: string } | null>(null);
  const baseFontSize = (data.fontSize as number | undefined) ?? defaultFontSize;
  const basePadding  = typeof data.textPadding === 'number' ? `${data.textPadding}px` : padding;
  useLayoutEffect(() => {
    if (placeholder || editing) { setFit(null); return; }
    const el = displayRef.current;
    if (!el) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const prev = { fs: el.style.fontSize, pad: el.style.padding };
      // 글이 차지한 실제 크기 vs 여백 뺀 안쪽 크기 (flex 상자는 scrollHeight에 아래 여백이 빠져서 직접 잼)
      // 화면 배율(캔버스 확대)만큼 나눠서 도형 좌표로 맞춤
      const over = () => {
        const box   = el.getBoundingClientRect();
        const scale = el.offsetHeight ? box.height / el.offsetHeight : 1;
        if (!scale) return false;
        const range = document.createRange();
        range.selectNodeContents(el);
        const txt = range.getBoundingClientRect();
        const cs  = getComputedStyle(el);
        const availH = el.clientHeight - parseFloat(cs.paddingTop)  - parseFloat(cs.paddingBottom);
        const availW = el.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return txt.height / scale > availH + 1 || txt.width / scale > availW + 1;
      };
      const tryFit = (pad: string) => {
        el.style.padding = pad;
        for (let fs = baseFontSize; fs >= FIT_MIN_FONT; fs--) {
          el.style.fontSize = `${fs}px`;
          if (!over()) return fs;
        }
        return null;
      };
      let next: { fontSize: number; padding?: string } | null = null;
      el.style.padding = basePadding;
      el.style.fontSize = `${baseFontSize}px`;
      if (over()) {
        const fsA = tryFit(basePadding);
        if (fsA !== null) next = { fontSize: fsA };
        else next = { fontSize: tryFit(FIT_TIGHT_PADDING) ?? FIT_MIN_FONT, padding: FIT_TIGHT_PADDING };
      }
      el.style.fontSize = prev.fs;
      el.style.padding  = prev.pad;
      setFit((p) => (p?.fontSize === next?.fontSize && p?.padding === next?.padding ? p : next));
    };
    measure();
    void document.fonts?.ready.then(measure);       // 웹폰트가 늦게 오면 글 폭이 바뀜
    const ro = new ResizeObserver(measure);          // 도형 크기를 바꾸면 다시 맞춤
    ro.observe(el);
    return () => { cancelled = true; ro.disconnect(); };
  }, [placeholder, editing, data.title, baseFontSize, basePadding, data.lineHeight, data.letterSpacing, data.fontFamily, data.fontWeight]);

  // 편집을 시작하면 "글씨 편집 중"으로 알림 → 패널이 텍스트 도구로 바뀜
  useEffect(() => {
    if (editing) setEditingTextNodeId(id);
  }, [editing, id, setEditingTextNodeId]);

  // 내용이 상자보다 길어지면 노드 높이를 아래로 늘림
  const expandIfNeeded = (el: HTMLElement | null) => {
    if (!el || el.scrollHeight <= el.clientHeight) return;
    const newH = el.scrollHeight;
    setNodes((nds) => nds.map((n) =>
      n.id === id ? { ...n, height: newH, data: { ...n.data, height: newH } } : n,
    ));
  };

  useEffect(() => {
    if (!editing || !editRef.current) return;
    editRef.current.focus();
    const range = document.createRange();
    range.selectNodeContents(editRef.current);
    range.collapse(false);   // 전체 선택 대신 글자 끝에 커서
    const sel = window.getSelection();
    if (sel) { sel.removeAllRanges(); sel.addRange(range); }
  }, [editing]);

  // keepTextMode: 패널의 글씨 도구를 누르느라 빠져나간 경우 — 패널은 텍스트 도구 그대로 유지
  const commitEdit = (keepTextMode = false) => {
    const text = (editRef.current?.innerText ?? '').trim();
    updateNodeData(id, { title: text || (placeholder ? tr('텍스트', 'Text') : '') });
    setEditing(false);
    if (!keepTextMode && useCanvasStore.getState().editingTextNodeId === id) setEditingTextNodeId(null);
  };

  // 도형 패널에서 고른 정렬 — 가로(왼쪽·가운데·오른쪽) / 세로(위·가운데·아래)
  const alignH = data.textAlignH ?? 'center';
  const alignV = data.textAlignV ?? 'middle';
  const flexH  = alignH === 'left' ? 'flex-start' : alignH === 'right' ? 'flex-end' : 'center';

  const textStyle: React.CSSProperties = {
    position:   'absolute',
    inset:      0,
    display:    'flex',
    flexDirection:  'column',        // Enter로 생긴 줄(div)이 세로로 쌓이게
    // 세로 정렬, 넘치면 아래로 넘침 (높이 측정용)
    justifyContent: alignV === 'top' ? 'safe flex-start' : alignV === 'bottom' ? 'safe flex-end' : 'safe center',
    // 안쪽 여백 · 줄 높이 · 자간 — 속성 패널 "세부"에서 고른 값, 없으면 도형별 기본값
    padding:    typeof data.textPadding === 'number' ? `${data.textPadding}px` : padding,
    letterSpacing: typeof data.letterSpacing === 'number' && data.letterSpacing !== 0 ? `${data.letterSpacing}px` : undefined,
    fontSize:   (data.fontSize as number | undefined) ?? defaultFontSize,
    fontWeight: data.fontWeight ? cssWeight(data.fontWeight) : 500,
    fontStyle:  (data.fontStyle as string | undefined) === 'italic' ? 'italic' : 'normal',
    fontFamily: textFontFamily(data.fontFamily),   // 도형 글씨도 고른 글꼴로
    color:      defaultInk ? shapeInk(data.fontColor, data.bgColor as string | undefined, defaultInk) : inkColor(data.fontColor),
    textAlign:  alignH,
    wordBreak:  'break-word',
    whiteSpace: 'pre-wrap',   // 줄바꿈 유지
    lineHeight: typeof data.lineHeight === 'number' ? data.lineHeight : 1.4,
    ...extraStyle,
  };

  return (
    <div
      style={{ position: 'absolute', inset: 0, cursor: placeholder || editing ? 'text' : 'inherit' }}
      onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); }}
    >
      {editing ? (
        // 바깥 상자는 정렬만, 입력칸은 글자 크기만큼 → 비어 있어도 커서가 고른 정렬 자리에
        <div ref={boxRef} style={{ ...textStyle, alignItems: flexH }}>
          <div
            ref={editRef}
            contentEditable
            suppressContentEditableWarning
            className="nopan nodrag"
            onBlur={(e) => commitEdit(blurredToPanel(e))}
            onInput={() => expandIfNeeded(boxRef.current)}
            onKeyDown={(e) => {
              // Enter는 줄바꿈, Esc로 편집 완료
              if (e.key === 'Escape') { e.preventDefault(); commitEdit(); }
            }}
            style={{ minWidth: 2, maxWidth: '100%', outline: 'none', userSelect: 'text', textAlign: alignH }}
          >
            {/* 기본 글자(텍스트)면 빈 상자로 시작 */}
            {isTextPlaceholder(data.title) ? '' : (data.title ?? '')}
          </div>
        </div>
      ) : (
        <div ref={displayRef} style={{ ...textStyle, ...(fit && { fontSize: fit.fontSize, ...(fit.padding && { padding: fit.padding }) }), userSelect: 'none' }}>
          {/* 기본 글자 '텍스트'는 안내 글자처럼 연하게 — 직접 쓴 글만 진하게 */}
          {data.title && !isTextPlaceholder(data.title)
            ? data.title
            : (placeholder || isTextPlaceholder(data.title)) && <span style={{ opacity: 0.3, fontStyle: 'italic' }}>{tr('텍스트', 'Text')}</span>
          }
        </div>
      )}
    </div>
  );
}

// ── 코드 블록 (고정폭 글꼴, 줄바꿈 없음, 높이 = 줄 수) ─────────
const CODE_LANGUAGES = [
  'Plain Text', 'JavaScript', 'TypeScript', 'TSX', 'Python', 'Java', 'C', 'C++', 'C#', 'Go', 'Rust',
  'HTML', 'CSS', 'JSON', 'SQL', 'Bash', 'YAML', 'Markdown',
];
export const CODE_FONT_SIZES = [12, 13, 15];   // 작게 / 보통 / 크게
const codeLineHeight  = (fontSize: number) => fontSize + 7;   // 13px → 20px
const CODE_HEADER    = 32;   // 언어·복사 막대
const CODE_PAD_Y     = 12;
const CODE_SCROLLBAR = 8;    // 긴 줄용 가로 스크롤바 자리

// 언어 검색용 별칭 (js, py 등으로도 찾을 수 있게)
const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  'Plain Text': 'text txt plain 텍스트', JavaScript: 'js node 자바스크립트', TypeScript: 'ts 타입스크립트',
  TSX: 'react jsx', Python: 'py 파이썬', Java: '자바', C: 'c언어', 'C++': 'cpp', 'C#': 'cs csharp dotnet',
  Go: 'golang', Rust: 'rs 러스트', HTML: 'markup xml', CSS: 'style', JSON: 'json', SQL: 'db database query',
  Bash: 'sh shell zsh terminal 터미널', YAML: 'yml', Markdown: 'md 마크다운',
};

// ── 코드 블록 언어 선택 드롭다운 (둥근 상자 + 검색) ────────────
// 코드 블록은 overflow: hidden이라 목록은 body에 띄움 → 캔버스 확대와 상관없이 같은 크기
function LanguagePicker({ value, onChange, color = 'rgba(255,255,255,0.55)' }: {
  value: string; onChange: (lang: string) => void; color?: string;
}) {
  const [open,   setOpen]   = useState(false);
  const [query,  setQuery]  = useState('');
  const [active, setActive] = useState(0);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 검색 순위: 이름·별칭과 정확히 같음 → 이름이 검색어로 시작 → 별칭이 검색어로 시작 → 어딘가에 포함
  // (예: js → JavaScript가 JSON보다, java → Java가 JavaScript보다, sh → Bash가 C#(csharp)보다 먼저)
  const q = query.trim().toLowerCase();
  const rank = (lang: string) => {
    if (!q) return 0;
    const words = [lang, ...(CODE_LANGUAGE_ALIASES[lang] ?? '').split(' ')].map((w) => w.toLowerCase());
    if (words.includes(q)) return 0;
    if (words[0].startsWith(q)) return 1;
    if (words.some((w) => w.startsWith(q))) return 2;
    return words.some((w) => w.includes(q)) ? 3 : -1;
  };
  const filtered = CODE_LANGUAGES
    .map((lang) => ({ lang, r: rank(lang) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)   // 같은 순위는 원래 순서 유지
    .map((x) => x.lang);

  const openMenu = () => {
    setQuery('');
    setActive(Math.max(0, CODE_LANGUAGES.indexOf(value)));
    setOpen(true);
  };
  const choose = (lang: string) => { onChange(lang); setOpen(false); };

  useEffect(() => { if (open) setActive(0); }, [query]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) choose(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
  };

  // 버튼 아래(공간이 모자라면 위)에 펼침
  const MENU_W = 200, MENU_H = 300;
  const rect = open ? btnRef.current?.getBoundingClientRect() : undefined;
  const below = rect ? window.innerHeight - rect.bottom > MENU_H + 8 : true;
  const menuPos: React.CSSProperties = rect
    ? {
        left: Math.min(rect.left, window.innerWidth - MENU_W - 8),
        ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }),
      }
    : {};

  return (
    <>
      <button
        ref={btnRef}
        className="nodrag nopan"
        onClick={() => (open ? setOpen(false) : openMenu())}
        onDoubleClick={(e) => e.stopPropagation()}
        title={tr('언어', 'Language')}
        style={{
          display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 5,
          background: open ? 'rgba(128,128,128,0.15)' : 'transparent', border: 'none', cursor: 'pointer',
          color, fontSize: 11.5, flexShrink: 0,
        }}
      >
        {value}
        <ChevronDown size={12} strokeWidth={2} />
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div onDoubleClick={(e) => e.stopPropagation()}>
          {/* 바깥 클릭 시 닫힘 */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onMouseDown={(e) => { e.stopPropagation(); setOpen(false); }}
          />
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', ...menuPos, zIndex: 9999, width: MENU_W, maxHeight: MENU_H,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              background: '#1c1c1e', border: '1px solid rgba(255,255,255,0.13)', borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ padding: 6, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={tr('언어 검색', 'Search languages')}
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '6px 9px', borderRadius: 6,
                  background: 'rgba(255,255,255,0.06)', border: '1px solid #3b82f6',
                  boxShadow: '0 0 0 2px rgba(59,130,246,0.25)',   // 검색창 파란 테두리
                  outline: 'none', color: '#e2e8f0', fontSize: 12,
                }}
              />
            </div>
            <div
              ref={listRef}
              style={{
                flex: 1, overflowY: 'auto', padding: 4,
                scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.28) transparent',   // 얇은 회색 스크롤바
              }}
            >
              {filtered.length === 0 && (
                <div style={{ padding: '12px 8px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                  {tr('검색 결과가 없습니다', 'No results')}
                </div>
              )}
              {filtered.map((lang, i) => (
                <button
                  key={lang}
                  data-index={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(lang)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                    padding: '6px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', textAlign: 'left',
                    background: i === active ? 'rgba(255,255,255,0.08)' : 'transparent',
                    color: lang === value ? '#fff' : 'rgba(255,255,255,0.75)', fontSize: 12.5,
                  }}
                >
                  {lang}
                  {lang === value && <Check size={13} strokeWidth={2} color="#60a5fa" />}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

// 코드 줄 수 × 줄 높이로 상자 높이 계산 — 줄바꿈이 없어서 너비와 상관없음. 접혀 있으면 머리줄 높이만
export const codeBoxHeight = (d: Pick<NodeData, 'code' | 'codeCollapsed' | 'codeFontSize'>) =>
  d.codeCollapsed
    ? CODE_HEADER
    : CODE_HEADER + CODE_PAD_Y * 2
      + Math.max(1, (d.code ?? '').split('\n').length) * codeLineHeight(d.codeFontSize ?? 13)
      + CODE_SCROLLBAR;

// 테마별 색 — 배경을 마음대로 바꾸면 문법 색이 안 보일 수 있어서 테마로만 고름
const CODE_THEMES = {
  dark: {
    bg: '#1e1f22', border: 'rgba(255,255,255,0.1)', divider: 'rgba(255,255,255,0.07)',
    text: '#d4d4d4', title: 'rgba(255,255,255,0.85)', muted: 'rgba(255,255,255,0.55)',
    faint: 'rgba(255,255,255,0.3)', inputBg: 'rgba(255,255,255,0.06)', scrollbar: 'rgba(255,255,255,0.25) transparent',
  },
  light: {
    bg: '#f7f6f3', border: 'rgba(0,0,0,0.1)', divider: 'rgba(0,0,0,0.07)',
    text: '#24292e', title: 'rgba(0,0,0,0.8)', muted: 'rgba(0,0,0,0.5)',
    faint: 'rgba(0,0,0,0.3)', inputBg: 'rgba(0,0,0,0.05)', scrollbar: 'rgba(0,0,0,0.25) transparent',
  },
};
type CodeThemeColors = (typeof CODE_THEMES)['dark'];

// 머리줄 아이콘 버튼 공통 스타일
const codeHeaderBtn = (t: CodeThemeColors): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px', borderRadius: 5,
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: t.muted, fontSize: 11.5, flexShrink: 0,
});

// ── 코드 블록 제목 — 클릭해서 바로 수정, Enter·Esc·바깥 클릭으로 완료 ──
function CodeTitle({ value, onChange, theme: t }: { value: string; onChange: (title: string) => void; theme: CodeThemeColors }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  const commit = () => { onChange(draft.trim()); setEditing(false); };

  const textStyle: React.CSSProperties = {
    flex: 1, minWidth: 0, padding: '3px 6px', borderRadius: 5,
    fontSize: 12, fontWeight: 600, color: t.title,
  };

  if (editing) {
    return (
      <input
        autoFocus
        className="nodrag nopan"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); setDraft(value); setEditing(false); }
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        placeholder={tr('제목', 'Title')}
        style={{ ...textStyle, background: t.inputBg, border: 'none', outline: 'none' }}
      />
    );
  }
  return (
    <div
      className="nodrag nopan"
      onClick={() => { setDraft(value); setEditing(true); }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={tr('클릭해서 제목 입력', 'Click to enter a title')}
      style={{ ...textStyle, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
    >
      {value || <span style={{ fontWeight: 400, color: t.faint }}>{tr('제목 없음', 'Untitled')}</span>}
    </div>
  );
}

function CodeShape({ data, id, width, height }: { data: NodeData; id: string; width: number; height: number }) {
  const { updateNodeData, setNodes } = useReactFlow();
  const [editing, setEditing] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const taRef  = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const code = data.code ?? '';
  const collapsed = !!data.codeCollapsed;
  const appDark  = useAppDarkMode();
  // 테마: 어둡게·밝게를 골랐으면 그대로, 아니면(자동) 화면 모드를 따라감
  const themeKey = data.codeTheme === 'dark' || data.codeTheme === 'light' ? data.codeTheme : (appDark ? 'dark' : 'light');
  const t        = CODE_THEMES[themeKey];
  const fontSize = data.codeFontSize ?? 13;
  const lineH    = codeLineHeight(fontSize);
  // 줄 번호 칸 너비 — 자릿수에 맞춤
  const lineCount = Math.max(1, code.split('\n').length);
  const gutterW   = data.codeLineNumbers ? Math.ceil(String(lineCount).length * fontSize * 0.62) + 20 : 0;

  // 접기/펼치기 — 접으면 제목 줄만 남김
  const toggleCollapsed = () => {
    const next = !collapsed;
    const h = codeBoxHeight({ ...data, codeCollapsed: next });
    if (next) setEditing(false);
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, height: h, data: { ...n.data, codeCollapsed: next, height: h } } : n)));
  };
  const { lines: colorLines, stale } = useHighlightedCode(code, data.codeLanguage, themeKey);
  // 색칠 층을 보여 줄지 — Plain Text·불러오는 중이면 색칠 층 없음,
  // 긴 코드 색칠 대기 중(stale)이면 색칠 층은 그대로 두고 숨긴 채 원래 글자를 보여 줌(지웠다 다시 만들면 느림)
  const showColor = !!colorLines && !stale;

  // 코드 갱신 — 높이도 줄 수에 맞춰 함께 바꿈
  const setCode = (next: string) => {
    const h = codeBoxHeight({ ...data, code: next });
    setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, height: h, data: { ...n.data, code: next, height: h } } : n)));
  };

  // 편집 시작 시 글 끝에 커서
  useEffect(() => {
    if (!editing || !taRef.current) return;
    const ta = taRef.current;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = ta.value.length;
  }, [editing]);

  // Tab은 들여쓰기(공백 2칸), Esc로 편집 완료
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
    if (e.key === 'Tab' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      const ta = e.currentTarget;
      const s = ta.selectionStart;
      setCode(code.slice(0, s) + '  ' + code.slice(ta.selectionEnd));
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2; });
    }
  };

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const bodyStyle: React.CSSProperties = {
    position: 'absolute', top: CODE_HEADER, left: gutterW, right: 0, bottom: 0,
    margin: 0, padding: `${CODE_PAD_Y}px 14px ${CODE_PAD_Y}px ${gutterW ? 8 : 14}px`, boxSizing: 'border-box',
    fontFamily: "'JetBrains Mono','Fira Code','Consolas','Courier New',monospace",
    fontSize, lineHeight: `${lineH}px`, tabSize: 2,
    fontVariantLigatures: 'none', letterSpacing: 'normal',   // 입력창·색칠 층 글자 폭을 똑같이
    whiteSpace: 'pre', overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'thin', scrollbarColor: t.scrollbar,
    color: t.text, background: 'transparent', border: 'none', outline: 'none', resize: 'none',
  };

  return (
    <div
      style={{
        position: 'relative', width, height, boxSizing: 'border-box', overflow: 'hidden',
        background: t.bg, borderRadius: 8, boxShadow: `0 0 0 1px ${t.border}`,
      }}
      onDoubleClick={(e) => { e.stopPropagation(); if (!collapsed) setEditing(true); }}
    >
      {/* 왼쪽: 제목 · 오른쪽: 언어 선택 · 복사 · 접기 */}
      <div
        style={{
          height: CODE_HEADER, display: 'flex', alignItems: 'center', gap: 2,
          padding: '0 4px 0 6px', boxSizing: 'border-box',
          borderBottom: collapsed ? 'none' : `1px solid ${t.divider}`,
        }}
      >
        <CodeTitle value={data.codeTitle ?? ''} onChange={(title) => updateNodeData(id, { codeTitle: title })} theme={t} />
        <LanguagePicker
          value={data.codeLanguage ?? 'Plain Text'}
          onChange={(lang) => updateNodeData(id, { codeLanguage: lang })}
          color={t.muted}
        />
        <button
          className="nodrag nopan"
          onClick={copy}
          onDoubleClick={(e) => e.stopPropagation()}
          title={tr('코드 복사', 'Copy code')}
          style={{ ...codeHeaderBtn(t), color: copied ? '#16a34a' : t.muted }}
        >
          {copied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={1.8} />}
          {copied ? tr('복사됨', 'Copied') : tr('복사', 'Copy')}
        </button>
        <button
          className="nodrag nopan"
          onClick={toggleCollapsed}
          onDoubleClick={(e) => e.stopPropagation()}
          title={collapsed ? tr('펼치기', 'Expand') : tr('접기', 'Collapse')}
          style={codeHeaderBtn(t)}
        >
          {collapsed ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronUp size={14} strokeWidth={2} />}
        </button>
      </div>

      {!collapsed && gutterW > 0 && (
        <pre
          aria-hidden
          style={{
            position: 'absolute', top: CODE_HEADER, left: 0, width: gutterW, bottom: 0, margin: 0,
            padding: `${CODE_PAD_Y}px 8px ${CODE_PAD_Y}px 0`, boxSizing: 'border-box', textAlign: 'right',
            fontFamily: "'JetBrains Mono','Fira Code','Consolas','Courier New',monospace",
            fontSize, lineHeight: `${lineH}px`, color: t.faint, userSelect: 'none', overflow: 'hidden',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => i + 1).join('\n')}
        </pre>
      )}

      {collapsed ? null : editing ? (
        <>
          {/* 편집 중 색칠: 아래층에 색칠된 코드, 위층에 글자만 투명한 입력창 — 두 층의 글꼴·여백·스크롤을 똑같이 맞춤 */}
          {colorLines && (
            <pre
              ref={preRef}
              aria-hidden
              style={{ ...bodyStyle, overflowX: 'hidden', pointerEvents: 'none', visibility: showColor ? 'visible' : 'hidden' }}
            >
              <HighlightedCode lines={colorLines} />
            </pre>
          )}
          <textarea
            ref={taRef}
            className="nodrag nopan nowheel"
            value={code}
            spellCheck={false}
            wrap="off"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => setEditing(false)}
            onScroll={(e) => { if (preRef.current) preRef.current.scrollLeft = e.currentTarget.scrollLeft; }}
            style={showColor ? { ...bodyStyle, color: 'transparent', caretColor: t.text } : bodyStyle}
          />
        </>
      ) : (
        <pre style={{ ...bodyStyle, userSelect: 'none', cursor: 'inherit' }}>
          {code
            ? (showColor && colorLines ? <HighlightedCode lines={colorLines} /> : code)
            : <span style={{ opacity: 0.35 }}>{tr('더블클릭해서 코드를 입력하세요', 'Double-click to enter code')}</span>}
        </pre>
      )}
    </div>
  );
}

// bgColor가 명시 설정된 경우 shapeCustomBg 마커 클래스 반환 (다크모드 override 제외용)
const customBgCls = (bgColor: string | undefined): string =>
  bgColor && bgColor !== 'transparent' ? styles.shapeCustomBg : '';

// ── 자유 손글씨 드로잉 ────────────────────────────────────────
function DrawingShape({ data, width, height }: { data: NodeData; width: number; height: number }) {
  const pts = (data.drawingPoints as number[][] | undefined) ?? [];
  const color = inkColor(data.drawingColor as string | undefined);
  const sw    = (data.drawingWidth  as number  | undefined) ?? 2;
  const opacity = (data.opacity as number | undefined) ?? 100;

  if (pts.length < 2) return <div style={{ width, height }} />;

  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;

  return (
    <svg
      style={{ position: 'absolute', inset: 0, width, height, overflow: 'visible', opacity: opacity / 100 }}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <path d={d} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── 워드 스타일 표 (행/열 셀 편집) ───────────────────────────
function TableShape({ data, id, width, height, selected }: { data: NodeData; id: string; width: number; height: number; selected?: boolean }) {
  // setNodes는 셀 클릭 시 표 자체의 선택을 해제하는 데 사용
  const { setNodes: _tableSetNodes } = useReactFlow();
  const { updateNodeData } = useReactFlow();
  const rows          = (data.tableRows          as number | undefined) ?? 3;
  const cols          = (data.tableCols          as number | undefined) ?? 3;
  const headerRow     = (data.tableHeaderRow     as boolean | undefined) ?? true;
  const cellMeta      = (data.tableCellMeta      as Record<string, { colSpan?: number; rowSpan?: number; hidden?: boolean }> | undefined) ?? {};
  const selectedCells  = (data.tableSelectedCells  as string[] | undefined) ?? [];
  const borderRadius   = (data.borderRadius        as number | undefined) ?? DEFAULT_RADIUS.table;
  const textAlign      = (data.tableTextAlign      as 'left' | 'center' | 'right' | undefined) ?? 'left';
  const cellColors     = (data.tableCellColors     as Record<string, string> | undefined) ?? {};
  const cellFontSizes  = (data.tableCellFontSizes  as Record<string, number> | undefined) ?? {};
  const cellBgColors   = (data.tableCellBgColors   as Record<string, string> | undefined) ?? {};
  const cellAligns     = (data.tableCellAligns     as Record<string, 'left' | 'center' | 'right'> | undefined) ?? {};

  const cells: string[][] = (() => {
    const src = (data.tableCells as string[][] | undefined) ?? [];
    const out: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < cols; c++) row.push(src[r]?.[c] ?? '');
      out.push(row);
    }
    return out;
  })();

  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const [dragRow,     setDragRow]     = useState<number | null>(null);
  const [dragOverRow, setDragOverRow] = useState<number | null>(null);
  const tableRef      = useRef<HTMLTableElement>(null);
  const dragStartCell = useRef<{ r: number; c: number } | null>(null);
  const dragMoved     = useRef(false);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      // 좌측 속성 패널 클릭은 선택 셀 유지 (셀별 설정 변경 중이므로)
      if (t && t.closest('[data-node-props-panel]')) return;
      if (tableRef.current && !tableRef.current.contains(e.target as Node)) {
        updateNodeData(id, { tableSelectedCells: [] });
      }
    };
    const onUp = () => { dragStartCell.current = null; };
    window.addEventListener('mousedown', onDown, true);
    document.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('mouseup', onUp);
    };
  }, [id, updateNodeData]);

  // 편집 모드 진입 시 input에 확실하게 focus + 커서 끝으로 이동
  // (autoFocus만으로는 RF 리렌더와 충돌해 focus가 손실되는 경우가 있음)
  const editInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      const el = editInputRef.current;
      el.focus();
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* noop */ }
    }
  }, [editingCell]);

  // 편집 진입 시 RF가 표를 selected로 만들었다면 강제 해제
  useEffect(() => {
    if (editingCell && selected) {
      _tableSetNodes(prev => prev.map(n =>
        n.id === id ? { ...n, selected: false } : n,
      ));
    }
  }, [editingCell, selected, id, _tableSetNodes]);

  const setCell = (r: number, c: number, val: string) => {
    const next = cells.map((row, ri) => row.map((cell, ci) => (ri === r && ci === c ? val : cell)));
    updateNodeData(id, { tableCells: next });
  };

  const setDims = (newRows: number, newCols: number) => {
    const next: string[][] = [];
    for (let r = 0; r < newRows; r++) {
      const row: string[] = [];
      for (let c = 0; c < newCols; c++) row.push(cells[r]?.[c] ?? '');
      next.push(row);
    }
    updateNodeData(id, { tableRows: newRows, tableCols: newCols, tableCells: next });
  };

  const toggleSelect = (r: number, c: number, e: React.MouseEvent) => {
    if (editingCell) return;
    const key = `${r}-${c}`;
    let next: string[];
    if (e.shiftKey && selectedCells.length > 0) {
      const [fr, fc] = selectedCells[0].split('-').map(Number);
      const minR = Math.min(fr, r), maxR = Math.max(fr, r);
      const minC = Math.min(fc, c), maxC = Math.max(fc, c);
      next = [];
      for (let ri = minR; ri <= maxR; ri++)
        for (let ci = minC; ci <= maxC; ci++) next.push(`${ri}-${ci}`);
    } else {
      next = selectedCells.includes(key) ? selectedCells.filter(k => k !== key) : [key];
    }
    updateNodeData(id, { tableSelectedCells: next });
  };

  const handleRowDragStart = (e: React.DragEvent, r: number) => {
    e.stopPropagation();
    setDragRow(r);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleRowDragOver = (e: React.DragEvent, r: number) => {
    e.preventDefault(); e.stopPropagation();
    setDragOverRow(r);
  };
  const handleRowDrop = (e: React.DragEvent, r: number) => {
    e.preventDefault(); e.stopPropagation();
    if (dragRow !== null && dragRow !== r) {
      const next = [...cells];
      const [moved] = next.splice(dragRow, 1);
      next.splice(r, 0, moved);
      updateNodeData(id, { tableCells: next, tableSelectedCells: [] });
    }
    setDragRow(null); setDragOverRow(null);
  };

  // 표 외곽 선택용 투명 클릭 스트립 폭(px)
  // 표 자체 레이아웃은 그대로 두고, 4변 위에 보이지 않는 영역만 깔아 두면
  // 그곳을 클릭할 때 셀 핸들러를 거치지 않고 RF wrapper로 가서 표 전체가 선택됨
  const EDGE_BAND = 10;
  const cellW    = width  / cols;
  const cellH    = height / rows;
  const fontSize = Math.max(10, Math.min(14, cellH * 0.32));

  const bg        = (data.bgColor     as string | undefined) ?? '#1a1a1a';
  const stroke    = (data.strokeColor as string | undefined) ?? 'rgba(255,255,255,0.9)';
  const headerBg  = 'rgba(255,255,255,0.08)';
  const textColor = (data.fontColor   as string | undefined) ?? '#e2e8f0';

  return (
    <>
      <div
        style={{
          position: 'absolute', inset: 0,
          background: bg,
          boxSizing: 'border-box',
          borderRadius: canvasRadius(borderRadius),
          // 모서리가 둥글 때(borderRadius>0) 셀 보더가 잘려 윤곽선이 끊겨 보이므로
          // 컨테이너 자체에 둥근 외곽선을 그려 연속되게 한다.
          border: borderRadius > 0 ? `1.5px solid ${stroke}` : undefined,
          // overflow:hidden + border-radius 클리핑은 React Flow의 transform:scale()
          // 아래에서 줌 시 모서리 틈이 생기므로, 둥글 때는 클리핑 대신
          // 모서리 셀의 border-radius로 처리한다(아래 cellRadius).
          overflow: borderRadius > 0 ? 'visible' : 'hidden',
          cursor: 'move',
        }}
      >
        <table
          ref={tableRef}
          style={{
            width: '100%', height: '100%',
            // 둥근 모서리(셀 radius)를 적용하려면 collapse 대신 separate 필요
            ...(borderRadius > 0
              ? { borderCollapse: 'separate' as const, borderSpacing: 0 }
              : { borderCollapse: 'collapse' as const }),
            tableLayout: 'fixed',
            fontFamily: 'inherit',
          }}
        >
          {/* 열 너비(%) — AI가 만든 표(PRD·API 명세)처럼 열마다 넓이가 달라야 할 때. 열 수가 바뀌면 다시 똑같이 나눔 */}
          {Array.isArray(data.tableColWidths) && (data.tableColWidths as number[]).length === cols && (
            <colgroup>
              {(data.tableColWidths as number[]).map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
            </colgroup>
          )}
          <tbody style={{ height: '100%' }}>
            {cells.map((row, r) => (
              <tr
                key={r}
                style={{
                  height: `${100 / rows}%`,
                  boxShadow: dragOverRow === r && dragRow !== r ? `inset 0 2px 0 ${stroke}` : undefined,
                }}
                onDragOver={e => handleRowDragOver(e, r)}
                onDrop={e => handleRowDrop(e, r)}
                onDragEnd={() => { setDragRow(null); setDragOverRow(null); }}
              >
                {row.map((cell, c) => {
                  const mkey  = `${r}-${c}`;
                  const meta  = cellMeta[mkey] ?? {};
                  if (meta.hidden) return null;
                  const colSpan  = meta.colSpan ?? 1;
                  const rowSpan  = meta.rowSpan ?? 1;
                  const isHeader = headerRow && r === 0;
                  const isEd     = editingCell?.r === r && editingCell.c === c;
                  const isSel    = selectedCells.includes(mkey);
                  const showSel  = isSel && !isEd;
                  const padX     = Math.max(2, Math.min(8, cellW * 0.08));
                  const padY     = Math.max(1, Math.min(4, cellH * 0.08));
                  // 모서리가 둥글 때는 컨테이너 border가 외곽선을 그리므로
                  // 셀의 바깥쪽 변 보더는 제거해 이중선/모서리 끊김을 방지한다.
                  const rounded  = borderRadius > 0;
                  const cellLine = `1.5px solid ${stroke}`;
                  const atTop    = r === 0;
                  const atBottom = r + rowSpan >= rows;
                  const atLeft   = c === 0;
                  const atRight  = c + colSpan >= cols;
                  const innerR   = canvasRadius(borderRadius, 1.5);
                  // 둥글 때는 border-collapse:separate 를 쓰므로(=셀 radius 적용 가능)
                  // 내부 격자선이 이중으로 그려지지 않도록 셀은 오른쪽·아래쪽 변만 그린다.
                  // 외곽선은 컨테이너 border가 담당.
                  const cellBorders = rounded
                    ? {
                        borderTop:    'none',
                        borderLeft:   'none',
                        borderRight:  atRight  ? 'none' : cellLine,
                        borderBottom: atBottom ? 'none' : cellLine,
                        // 모서리 셀 배경을 컨테이너 둥근 모서리에 맞춘다
                        borderTopLeftRadius:     atTop    && atLeft  ? innerR : 0,
                        borderTopRightRadius:    atTop    && atRight ? innerR : 0,
                        borderBottomLeftRadius:  atBottom && atLeft  ? innerR : 0,
                        borderBottomRightRadius: atBottom && atRight ? innerR : 0,
                      }
                    : { border: cellLine };
                  return (
                    <td
                      key={c}
                      colSpan={colSpan}
                      rowSpan={rowSpan}
                      className={selected ? undefined : 'nodrag nopan'}
                      // ── 동작 모델 ─────────────────────────────────────
                      //  • 표가 선택 안 됨 → 셀 클릭 = 편집 (RF 이벤트 차단)
                      //  • 표가 선택됨    → 셀 클릭/드래그 = 표 이동 (RF에 위임)
                      //  • 더블클릭은 어떤 상태든 편집 진입
                      onPointerDown={e => { if (!selected && !isEd) e.stopPropagation(); }}
                      onMouseDown={e => { if (!selected && !isEd) e.stopPropagation(); }}
                      onClick={e => {
                        if (isEd) return;
                        // 선택된 상태에서는 RF가 클릭/드래그를 처리하도록 둠
                        if (selected) return;
                        e.stopPropagation();
                        if (dragMoved.current) { dragMoved.current = false; return; }
                        setEditingCell({ r, c });
                        updateNodeData(id, { tableSelectedCells: [] });
                      }}
                      onDoubleClick={e => {
                        e.stopPropagation();
                        if (!isEd) {
                          // 더블클릭: 표가 선택돼 있어도 편집 진입 + 선택 해제
                          if (selected) {
                            _tableSetNodes(prev => prev.map(n =>
                              n.id === id ? { ...n, selected: false } : n,
                            ));
                          }
                          setEditingCell({ r, c });
                          updateNodeData(id, { tableSelectedCells: [] });
                        }
                      }}
                      style={{
                        ...cellBorders,
                        padding: `${padY}px ${padX}px`,
                        fontSize: cellFontSizes[mkey] ? `${cellFontSizes[mkey]}px` : fontSize,
                        color: cellColors[mkey] ?? textColor,
                        fontWeight: isHeader ? 600 : 400,
                        background: (cellBgColors[mkey] && cellBgColors[mkey] !== 'transparent')
                          ? cellBgColors[mkey]
                          : (showSel ? 'rgba(99,102,241,0.22)' : isHeader ? headerBg : 'transparent'),
                        verticalAlign: 'middle',
                        overflow: 'hidden',
                        textAlign: cellAligns[mkey] ?? textAlign,
                        cursor: isEd ? 'text' : (selected ? 'move' : 'text'),
                        position: 'relative',
                        outline: showSel ? '1.5px solid #6366f1' : 'none',
                        outlineOffset: '-1px',
                        userSelect: 'none',
                      }}
                    >
                      {c === 0 && (
                        <span
                          draggable
                          onDragStart={e => { e.stopPropagation(); handleRowDragStart(e, r); }}
                          onClick={e => e.stopPropagation()}
                          className="rowDragHandle"
                          style={{
                            position: 'absolute', left: 1, top: '50%',
                            transform: 'translateY(-50%)',
                            cursor: 'grab', opacity: 0, transition: 'opacity 0.15s',
                            display: 'flex', alignItems: 'center',
                          }}
                        >
                          <svg width="6" height="10" viewBox="0 0 6 10" fill={textColor} style={{ opacity: 0.5 }}>
                            <circle cx="1.5" cy="1.5" r="1"/><circle cx="4.5" cy="1.5" r="1"/>
                            <circle cx="1.5" cy="5"   r="1"/><circle cx="4.5" cy="5"   r="1"/>
                            <circle cx="1.5" cy="8.5" r="1"/><circle cx="4.5" cy="8.5" r="1"/>
                          </svg>
                        </span>
                      )}
                      {isEd ? (
                        <input
                          ref={editInputRef}
                          autoFocus
                          defaultValue={cell}
                          onBlur={e => { setCell(r, c, e.currentTarget.value); setEditingCell(null); }}
                          onKeyDown={e => {
                            e.stopPropagation();
                            if (e.key === 'Enter')  { setCell(r, c, e.currentTarget.value); setEditingCell(null); }
                            if (e.key === 'Escape') { setEditingCell(null); }
                          }}
                          onClick={e => e.stopPropagation()}
                          onMouseDown={e => e.stopPropagation()}
                          onPointerDown={e => e.stopPropagation()}
                          className="nodrag nopan"
                          style={{
                            width: '100%', border: 'none', outline: 'none',
                            background: 'transparent',
                            color: cellColors[mkey] ?? textColor,
                            fontSize: cellFontSizes[mkey] ? `${cellFontSizes[mkey]}px` : fontSize,
                            fontFamily: 'inherit',
                            fontWeight: isHeader ? 600 : 400,
                            textAlign: cellAligns[mkey] ?? textAlign,
                          }}
                        />
                      ) : (
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {cell || ' '}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {/* 표 외곽 선택용 투명 클릭 스트립 4개 — 표 자체는 그대로 두고
            이 영역 클릭 시 셀 핸들러를 거치지 않고 RF wrapper로 전달돼 표 전체 선택 */}
        {!selected && (() => {
          const stripBase: React.CSSProperties = {
            position: 'absolute', cursor: 'move',
            background: 'transparent', pointerEvents: 'auto', zIndex: 5,
          };
          return (
            <>
              <div style={{ ...stripBase, top: 0,    left: 0, right: 0,  height: EDGE_BAND }} />
              <div style={{ ...stripBase, bottom: 0, left: 0, right: 0,  height: EDGE_BAND }} />
              <div style={{ ...stripBase, top: 0, bottom: 0, left: 0,    width:  EDGE_BAND }} />
              <div style={{ ...stripBase, top: 0, bottom: 0, right: 0,   width:  EDGE_BAND }} />
            </>
          );
        })()}
      </div>

      {Array.from({ length: rows }, (_, r) => {
        const topPx = r * cellH + cellH / 2;
        return (
          <React.Fragment key={r}>
            <Handle type="target" position={Position.Left}  id={`row-${r}-left`}  className={styles.handle} style={{ top: topPx, left: -7, transform: 'translateY(-50%)' }} />
            <Handle type="source" position={Position.Right} id={`row-${r}-right`} className={styles.handle} style={{ top: topPx, right: -7, left: 'auto', transform: 'translateY(-50%)' }} />
          </React.Fragment>
        );
      })}
    </>
  );
}
// ── 앵커 노드 (자유 화살표 끝점) — 연결된 엣지가 선택됐을 때만 시각화 ──
function AnchorShape({ id, selected }: { id: string; selected: boolean }) {
  // React Flow store에서 이 앵커와 연결된 엣지 중 선택된 게 있는지 확인
  const edgeSelected = useStore((s) => {
    const edges = (s as unknown as { edges: { source: string; target: string; selected?: boolean }[] }).edges;
    if (!edges) return false;
    return edges.some((e) => (e.source === id || e.target === id) && !!e.selected);
  });
  const show = selected || edgeSelected;
  return (
    <div
      style={{
        position: 'relative',
        width: 12, height: 12,
        background: show ? (selected ? '#6366f1' : '#ffffff') : 'transparent',
        border: show ? '2px solid #6366f1' : 'none',
        borderRadius: '50%',
        cursor: 'grab',
        boxShadow: show ? '0 0 0 1px rgba(0,0,0,0.35)' : 'none',
      }}
    >
      <Handle id="c" type="source" position={Position.Right} isConnectable={false}
        style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 1, height: 1, background: 'transparent', border: 'none', opacity: 0, pointerEvents: 'none' }} />
      <Handle id="ct" type="target" position={Position.Left} isConnectable={false}
        style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 1, height: 1, background: 'transparent', border: 'none', opacity: 0, pointerEvents: 'none' }} />
    </div>
  );
}

function ShapeWrapper({ shape, color, data, id, width, height, selected }: {
  shape: NodeShape;
  color: { bg: string; border: string; accent: string; text: string };
  data: NodeData;
  id: string;
  width: number;
  height: number;
  selected?: boolean;
}) {
  const statusColor = getStatusColor(data.status);

  // ── anchor: 자유 화살표 끝점 (연결된 엣지 선택 시에만 보임) ──
  if (shape === 'anchor') {
    return <AnchorShape id={id} selected={!!selected} />;
  }

  // ── text: 투명 텍스트 박스 ──────────────────────────────
  if (shape === 'text') {
    return <TextShape data={data} id={id} width={width} height={height} />;
  }

  // ── code: 코드 블록 ──────────────────────────────────────
  if (shape === 'code') {
    return <CodeShape data={data} id={id} width={width} height={height} />;
  }

  // ── list / callout / page: Notion식 블록 ──────────────────
  if (shape === 'list' || shape === 'callout' || shape === 'page') {
    const Block = shape === 'list' ? ListShape : shape === 'callout' ? CalloutShape : PageShape;
    // 콜아웃은 배경이 있으니 배경 밝기에 맞춘 글자색
    const ink = shape === 'callout'
      ? shapeInk(data.fontColor, data.bgColor ?? 'transparent', 'var(--canvas-ink)')
      : inkColor(data.fontColor);
    return <Block data={data} id={id} width={width} height={height} ink={ink} font={textFontFamily(data.fontFamily)} />;
  }

  // ── table: 워드 스타일 표 ──────────────────────────────
  if (shape === 'table') {
    return <TableShape data={data} id={id} width={width} height={height} selected={selected} />;
  }

  // ── image: 붙여넣은 이미지 ───────────────────────────────
  if (shape === 'image') {
    // 윤곽선 — 고른 경우에만, 그림 안쪽으로 (크기가 늘지 않게). 둥근 모서리를 따라감
    const imgStroke = data.strokeColor && data.strokeColor !== 'transparent' ? data.strokeColor : undefined;
    const imgStrokeW = data.strokeWidth ?? 1;
    return (
      <img
        src={data.imageUrl}
        alt=""
        draggable={false}   // 브라우저 기본 이미지 드래그 대신 노드 드래그
        style={{
          display: 'block', width, height, objectFit: 'fill',
          borderRadius: canvasRadius(data.borderRadius ?? DEFAULT_RADIUS.image),   // 캡처 이미지가 각져 보이지 않게 기본으로 살짝 둥글게
          opacity: (data.opacity ?? 100) / 100,
          userSelect: 'none',
          ...(imgStroke ? { outline: `${imgStrokeW}px solid ${imgStroke}`, outlineOffset: -imgStrokeW } : {}),
        }}
      />
    );
  }

  // ── entity: DB 테이블 (ERD) ──────────────────────────────
  if (shape === 'entity') {
    return <EntityShape data={data} id={id} width={width} height={height} selected={selected} />;
  }

  // ── mockup: 아이폰 목업 ──────────────────────────────────
  if (shape === 'mockup') {
    return <MockupShape data={data} id={id} width={width} height={height} />;
  }

  // ── drawing: 자유 손글씨 ─────────────────────────────────
  if (shape === 'drawing') {
    return <DrawingShape data={data} width={width} height={height} />;
  }

  // ── frame: Excalidraw 스타일 컨테이너 ────────────────────
  if (shape === 'frame') {
    return <FrameShape data={data} id={id} width={width} height={height} />;
  }

  // ── card: 어두운 아키텍처 카드 ───────────────────────────
  if (shape === 'card') {
    return <CardShape data={data} id={id} width={width} height={height} />;
  }

  // ── document / note: 기존 카드 스타일 유지 ───────────────
  if (shape === 'document' || shape === 'note') {
    const shapeClass = shape === 'document' ? styles.shapeDocument : styles.shapeNote;
    return (
      <div className={shapeClass} style={{ borderColor: color.border, width, minHeight: height, overflow: 'hidden' }}>
        {data.status !== 'none' && (
          <div className={styles.statusDot} style={{ background: statusColor.dot }} />
        )}
        <div className={styles.iconRow}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.ntitle}>{data.title}</div>
            {data.subtitle && <div className={styles.nsub}>{data.subtitle}</div>}
          </div>
        </div>
      </div>
    );
  }

  // ── rectangle: 플레인 사각형 (isTextBox=true 이면 인라인 편집) ─
  if (shape === 'rectangle') {
    const rStrokeColor = data.strokeColor ?? 'var(--canvas-ink)';
    const rStrokeW     = data.strokeWidth ?? 1;
    const rStrokeStyle = data.strokeStyle ?? 'solid';
    // 실선 윤곽선은 box-shadow로 — 그림자(세부)가 있으면 뒤에 이어 붙임. 파선·점선은 테두리 + 그림자만
    const rShadow      = withDropShadow(rStrokeStyle === 'solid' ? `0 0 0 ${rStrokeW}px ${rStrokeColor}` : undefined, data.shadow);
    const rSolid       = rStrokeStyle === 'solid';
    return (
      <div
        className={`${styles.shapeRect} ${data.bgColor === 'transparent' ? styles.shapeTransparent : ''} ${customBgCls(data.bgColor as string | undefined)}`}
        style={{
          position:    'relative',
          background:  data.bgColor ?? color.bg,
          width, height,
          borderRadius: canvasRadius(data.borderRadius ?? DEFAULT_RADIUS.rectangle),
          opacity:      (data.opacity ?? 100) / 100,
          overflow:    data.isTextBox ? 'visible' : 'hidden',
          display:     'flex', alignItems: 'center', justifyContent: 'center',
          ...(rSolid
            ? { border: 'none', boxShadow: rShadow }
            : { borderColor: rStrokeColor, borderStyle: rStrokeStyle as React.CSSProperties['borderStyle'], borderWidth: rStrokeW, ...(rShadow && { boxShadow: rShadow }) }),
        }}
      >
        {/* 와이어프레임 이미지 칸: 사진을 받는 층 (사진이 있으면 글 대신 사진) */}
        {isImageSlot(data) && <ImageSlotLayer data={data} id={id} />}
        {isImageSlot(data) && data.imageUrl ? null : data.isTextBox
          ? <InlineTextEditor data={data} id={id} padding="6px 10px" defaultInk="var(--shape-ink)" />
          : data.icon
            ? <div className={styles.nicon}>{data.icon}</div>
            : <InlineTextEditor data={data} id={id} padding="12px 20px" placeholder={false} defaultInk="var(--shape-ink)" defaultFontSize={14} />   /* 더블클릭하면 글쓰기 */
        }
      </div>
    );
  }

  // ── circle: 원 (isTextBox=true 이면 인라인 편집) ─────────────
  if (shape === 'circle') {
    const cStrokeColor = data.strokeColor ?? 'var(--canvas-ink)';
    const cStrokeW     = data.strokeWidth ?? 1;
    const cStrokeStyle = data.strokeStyle ?? 'solid';
    const cShadow      = withDropShadow(cStrokeStyle === 'solid' ? `0 0 0 ${cStrokeW}px ${cStrokeColor}` : undefined, data.shadow);
    const cSolid       = cStrokeStyle === 'solid';
    // 원 내접 정사각형 패딩: 반지름의 (1 - 1/√2) ≈ 29%
    const circlePad = `${Math.round(Math.min(width, height) * 0.2)}px`;
    return (
      <div
        className={`${styles.shapeCircle} ${data.bgColor === 'transparent' ? styles.shapeTransparent : ''} ${customBgCls(data.bgColor as string | undefined)}`}
        style={{
          position:   'relative',
          background: data.bgColor ?? color.bg,
          width, height,
          opacity:    (data.opacity ?? 100) / 100,
          overflow:   'hidden',
          ...(cSolid
            ? { border: 'none', boxShadow: cShadow }
            : { borderColor: cStrokeColor, borderStyle: cStrokeStyle as React.CSSProperties['borderStyle'], borderWidth: cStrokeW, ...(cShadow && { boxShadow: cShadow }) }),
        }}
      >
        {data.isTextBox
          ? <InlineTextEditor data={data} id={id} padding={circlePad} defaultInk="var(--shape-ink)" />
          : data.icon
            ? <div className={styles.nicon}>{data.icon}</div>
            : <InlineTextEditor data={data} id={id} padding={circlePad} placeholder={false} defaultInk="var(--shape-ink)" defaultFontSize={14} />   /* 더블클릭하면 글쓰기 */
        }
      </div>
    );
  }

  // ── diamond ───────────────────────────────────────────────
  if (shape === 'diamond') {
    return (
      <div className={styles.shapeDiamondOuter} style={{ width, height, position: 'relative', opacity: (data.opacity ?? 100) / 100 }}>
        <div
          className={`${styles.shapeDiamondInner} ${data.bgColor === 'transparent' ? styles.shapeTransparent : ''} ${customBgCls(data.bgColor as string | undefined)}`}
          style={{ background: data.bgColor ?? color.bg, borderColor: data.strokeColor ?? 'var(--canvas-ink)' }}
        >
          <div style={{ transform: 'rotate(-45deg)', textAlign: 'center', width: 64 }}>
            {data.icon && <div className={styles.nicon}>{data.icon}</div>}
          </div>
        </div>
        {/* 더블클릭하면 글쓰기 — 마름모 안쪽(가운데 절반)에 회전 없이 */}
        {!data.icon && (
          <div style={{ position: 'absolute', inset: '25%' }}>
            <InlineTextEditor data={data} id={id} padding="0" placeholder={false} defaultInk="var(--shape-ink)" defaultFontSize={14} />
          </div>
        )}
      </div>
    );
  }

  // ── cylinder (DB) ─────────────────────────────────────────
  if (shape === 'cylinder') {
    return (
      <div className={styles.shapeCylinder} style={{ width }}>
        <div className={styles.cylinderTop} style={{ background: color.bg, borderColor: color.border }} />
        <div className={styles.cylinderBody} style={{ background: color.bg, borderColor: color.border }}>
          <div className={styles.nicon}>{data.icon}</div>
          <div className={styles.ntitle}>{data.title}</div>
          <div className={styles.nsub}>{data.subtitle}</div>
        </div>
      </div>
    );
  }

  // ── hexagon ───────────────────────────────────────────────
  if (shape === 'hexagon') {
    const hStroke = data.strokeColor ?? 'var(--canvas-ink)';
    const hBg     = data.bgColor     ?? color.bg;
    const hStrokeW = data.strokeWidth ?? 2;
    const hexClip  = 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)';
    // 배경이 투명하면 테두리 색으로 채우는 방식이 안 통함 → 윤곽선만 그림
    if (hBg === 'transparent') {
      const s = hStrokeW / 2;
      return (
        <div style={{ width, height, position: 'relative', cursor: 'grab', opacity: (data.opacity ?? 100) / 100 }}>
          <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
            <polygon
              points={`${width * 0.25 + s},${s} ${width * 0.75 - s},${s} ${width - s},${height / 2} ${width * 0.75 - s},${height - s} ${width * 0.25 + s},${height - s} ${s},${height / 2}`}
              fill="none" stroke={hStroke} strokeWidth={hStrokeW} strokeLinejoin="round"
            />
          </svg>
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {data.icon
              ? <div className={styles.nicon}>{data.icon}</div>
              : <InlineTextEditor data={data} id={id} padding="4px 22%" placeholder={false} defaultInk="#f8fafc" defaultFontSize={14} />}
          </div>
        </div>
      );
    }
    return (
      <div style={{
        width, height,
        background:   hStroke,
        clipPath:     hexClip,
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        cursor:       'grab',
        opacity:      (data.opacity ?? 100) / 100,
      }}>
        <div style={{
          width:          `calc(100% - ${hStrokeW * 2 + 2}px)`,
          height:         `calc(100% - ${hStrokeW * 2 + 2}px)`,
          background:     hBg,
          clipPath:       hexClip,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          position:       'relative',
        }}>
          {data.icon
            ? <div className={styles.nicon}>{data.icon}</div>
            : <InlineTextEditor data={data} id={id} padding="4px 22%" placeholder={false} defaultInk="#f8fafc" defaultFontSize={14} />   /* 더블클릭하면 글쓰기 */
          }
        </div>
      </div>
    );
  }

  // ── fallback ──────────────────────────────────────────────
  return (
    <div className={styles.shapeRect} style={{ borderColor: color.border, background: color.bg, width, height, overflow: 'hidden' }}>
      {data.icon && <div className={styles.nicon}>{data.icon}</div>}
      <div className={styles.ntitle} style={{ textAlign: 'center' }}>{data.title}</div>
    </div>
  );
}

// ── 와이어프레임 화면 프레임 크기 조절 → 안의 요소도 같은 비율로 ──────────
//   AI가 만든 화면(data.wire가 있는 프레임)은 한 장의 화면이라, 줄이고 늘리면 내용 전체가 같이 커지고 작아져야 함
//   끌기 시작할 때 자손(자식·손자…)을 그대로 떠 두고, 매번 그 원본 × 배율로 다시 계산 → 오차가 쌓이지 않음
const isWireScreen = (data: NodeData) => data.shape === 'frame' && !!data.wire;

function frameDescendants(all: AppNode[], frameId: string): Map<string, AppNode> {
  const out = new Map<string, AppNode>();
  let frontier = [frameId];
  while (frontier.length) {
    const next: string[] = [];
    for (const n of all) {
      if (n.parentId && frontier.includes(n.parentId) && !out.has(n.id)) { out.set(n.id, n); next.push(n.id); }
    }
    frontier = next;
  }
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const mul = (v: unknown, k: number) => (typeof v === 'number' ? r2(v * k) : v);

function scaleNode(base: AppNode, k: number): AppNode {
  const d = base.data;
  const w = r2(((d.width as number | undefined) ?? base.width ?? base.measured?.width ?? 0) * k);
  const h = r2(((d.height as number | undefined) ?? base.height ?? base.measured?.height ?? 0) * k);
  return {
    ...base,
    position: { x: r2(base.position.x * k), y: r2(base.position.y * k) },
    width: w, height: h, measured: { width: w, height: h },
    data: {
      ...d, width: w, height: h,
      fontSize:      mul(d.fontSize, k),
      borderRadius:  mul(d.borderRadius, k),
      iconSize:      mul(d.iconSize, k),
      textPadding:   mul(d.textPadding, k),
      letterSpacing: mul(d.letterSpacing, k),
      codeFontSize:  mul(d.codeFontSize, k),
      labelFontSize: mul(d.labelFontSize, k),
      drawingWidth:  mul(d.drawingWidth, k),
      ...(Array.isArray(d.drawingPoints) && { drawingPoints: (d.drawingPoints as number[][]).map((pt) => pt.map((v) => r2(v * k))) }),
    } as NodeData,
  };
}

// ── 메인 CustomNode ──────────────────────────────────────────
export const CustomNode = memo(({ data, selected, id }: NodeProps<AppNode>) => {
  const { updateNodeData, setNodes, getNodes } = useReactFlow();
  // 사진·화면을 끌어 목업·이미지 칸 위에 왔을 때 — 끄는 쪽을 흐리게 해서 아래 강조가 보이게
  const overDropTarget = useCanvasStore((s) => !!s.imageDropDimIds?.has(id));
  const nodeColor   = getNodeColor(data.type);
  const shape       = data.shape ?? 'card';
  const currentTool = useCanvasStore((s) => s.currentTool);

  const defaults    = SHAPE_DEFAULTS[shape] ?? SHAPE_DEFAULTS.rectangle;
  const editingText = useCanvasStore((s) => s.editingTextNodeId === id);
  const editingIcon = useCanvasStore((s) => s.editingIconNodeId === id);   // 카드 아이콘 선택 중
  // 선택이 풀리면 글씨 편집·아이콘 선택도 끝 — 다시 고르면 도형 패널부터
  // "선택됨 → 풀림"일 때만 끔: 안 고른 카드의 이름·아이콘을 바로 누르면 그 모드가 먼저 켜지고 선택은 한 박자 늦게 들어와서,
  // 그 사이에 끄면 패널이 바로 도형 패널로 돌아감
  const wasSelected = useRef(!!selected);
  useEffect(() => {
    if (wasSelected.current && !selected) {
      if (editingText) useCanvasStore.getState().setEditingTextNodeId(null);
      if (editingIcon) useCanvasStore.getState().setEditingIconNodeId(null);
    }
    wasSelected.current = !!selected;
  }, [selected, editingText, editingIcon]);
  // 도형 안 글씨·아이콘을 고른 동안엔 도형이 아니라 그 부분만 선택된 것처럼 — 크기 조절 점 숨김
  // 묶음에 든 요소는 묶음 안으로 들어갔을 때(더블클릭)만 크기 조절 점 — 통째로 고른 동안엔 묶음 테두리 하나만 (Canvas의 GroupOutline)
  const inGroup  = typeof data.groupId === 'string' && !!data.groupId;
  const soloGroup = useCanvasStore((s) => inGroup && s.soloGroupId === data.groupId);
  const showResizer = !!selected && currentTool !== 'connect' && !editingText && !editingIcon && (!inGroup || soloGroup);

  // 표: 행/열 수에 맞춰 최소 크기를 동적 계산 (셀당 최소 40×24px)
  const minCellW = 40;
  const minCellH = 24;
  const tableRows = shape === 'table' ? ((data.tableRows as number | undefined) ?? 3) : 1;
  const tableCols = shape === 'table' ? ((data.tableCols as number | undefined) ?? 3) : 1;
  const dynMinW = shape === 'table' ? Math.max(defaults.minW, tableCols * minCellW) : defaults.minW;
  const dynMinH = shape === 'table' ? Math.max(defaults.minH, tableRows * minCellH) : defaults.minH;

  // 리사이즈 중 실시간 크기 (드래그 동안 커서를 즉시 따라옴) — 텍스트 박스는 글자 비율(fs)도 함께
  const [liveSize, setLiveSize] = useState<{ w: number; h: number; fs?: number } | null>(null);

  // 텍스트 박스: 커서 높이로 글자 크기를 정하고(모서리를 끌면 글자가 커지고 작아짐),
  // 상자 높이는 그 글자 크기·너비에서 글이 차지하는 높이에 맞춤 → 글이 넘치지도, 아래가 비지도 않음
  const fitTextBox = useCallback(
    (width: number, pointerH: number) => {
      const fontPx = textFontPx(data.fontScale, pointerH);
      const h = Math.max(dynMinH, Math.ceil(measureTextBoxHeight(data, width, fontPx)));
      return { h, fs: fontPx / h };
    },
    [data, dynMinH],
  );

  // 높이가 내용으로 정해지는 노드: 텍스트 박스(글 높이), 코드 블록(줄 수 — 세로로 끌어도 바뀌지 않음),
  // 목록·콜아웃·페이지(블록이 스스로 높이를 맞추므로 지금 높이 유지)
  const isBlockShape = shape === 'list' || shape === 'callout' || shape === 'page';
  const fitsContent = shape === 'text' || shape === 'code' || shape === 'entity' || isBlockShape;
  const fitBox = useCallback(
    (width: number, pointerH: number): { h: number; fs?: number } =>
      shape === 'code' ? { h: codeBoxHeight(data) }
        : shape === 'entity' ? { h: entityHeight(data.columns?.length ?? 1) }
        : isBlockShape ? { h: data.height ?? defaults.h }
          : fitTextBox(width, pointerH),
    [shape, data, fitTextBox, isBlockShape, defaults.h],
  );

  // 와이어프레임 화면: 끌기 시작할 때의 프레임 크기·둥글기와 자손 원본
  const wireScreen = isWireScreen(data);
  const wireSnap = useRef<{ w: number; r?: number; kids: Map<string, AppNode> } | null>(null);
  const handleResizeStart = useCallback(() => {
    if (!wireScreen) return;
    wireSnap.current = {
      w: (data.width as number | undefined) ?? defaults.w,
      r: data.borderRadius as number | undefined,
      kids: frameDescendants(getNodes() as AppNode[], id),
    };
  }, [wireScreen, data.width, data.borderRadius, defaults.w, getNodes, id]);
  // 자손을 원본 × 배율로 (프레임 자신은 라이브러리·handleResizeEnd가 맡음)
  const scaleWireKids = useCallback((width: number) => {
    const snap = wireSnap.current;
    if (!snap || !snap.kids.size || !snap.w) return;
    const k = width / snap.w;
    setNodes((nds) => nds.map((n) => {
      const base = snap.kids.get(n.id);
      return base ? { ...scaleNode(base, k), selected: n.selected, dragging: n.dragging } : n;
    }));
  }, [setNodes]);

  const handleResize = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      if (fitsContent) {
        setLiveSize({ w: params.width, ...fitBox(params.width, params.height) });
        return;
      }
      setLiveSize({ w: params.width, h: params.height });
      if (wireScreen) scaleWireKids(params.width);
    },
    [fitsContent, fitBox, wireScreen, scaleWireKids],
  );

  const handleResizeEnd = useCallback(
    (_: unknown, params: { width: number; height: number }) => {
      setLiveSize(null);
      if (fitsContent) {
        const { h, fs } = fitBox(params.width, params.height);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? {
                  ...n, width: params.width, height: h,
                  data: { ...n.data, width: params.width, height: h, ...(fs !== undefined ? { fontScale: fs } : {}) },
                }
              : n,
          ),
        );
        // 라이브러리가 이 직후 커서 크기를 measured에 넣음 → 다음 드래그가 그 크기에서 시작해 튀므로 실제 크기로 되돌림
        requestAnimationFrame(() =>
          setNodes((nds) => nds.map((n) => (n.id === id ? { ...n, measured: { width: params.width, height: h } } : n))),
        );
      } else if (data.shape === 'frame' || data.isDocContainer) {
        // 프레임 & 문서 컨테이너: data와 노드 레벨 zIndex를 동시에 갱신
        //   와이어프레임 화면이면 프레임 둥글기와 안의 요소도 같은 비율로 (마지막 크기로 한 번 더 맞춤)
        const snap = wireScreen ? wireSnap.current : null;
        const k = snap?.w ? params.width / snap.w : 1;
        if (snap) scaleWireKids(params.width);
        wireSnap.current = null;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === id
              ? {
                  ...n,
                  zIndex: -Math.ceil(params.width * params.height / 100),
                  data: {
                    ...n.data, width: params.width, height: params.height,
                    ...(snap?.r !== undefined && { borderRadius: r2(snap.r * k) }),
                  },
                }
              : n,
          ),
        );
      } else {
        updateNodeData(id, { width: params.width, height: params.height });
      }
    },
    [id, updateNodeData, setNodes, data.shape, data.isDocContainer, fitsContent, fitBox, wireScreen, scaleWireKids],
  );

  // 표시 크기: 드래그 중이면 liveSize, 아니면 저장된 data 값
  const displayW = liveSize?.w ?? data.width ?? defaults.w;
  const displayH = liveSize?.h ?? data.height ?? defaults.h;
  const displayData = liveSize?.fs !== undefined ? { ...data, fontScale: liveSize.fs } : data;

  // anchor: 자유 화살표 끝점. 리사이저/connect 오버레이 핸들 없이 본체만 렌더
  if (shape === 'anchor') {
    return (
      <div className={styles.wrapper} style={{ width: 12, height: 12 }}>
        <ShapeWrapper shape={shape} color={nodeColor} data={data} id={id} width={12} height={12} selected={!!selected} />
      </div>
    );
  }

  return (
    <div
      className={styles.wrapper}
      style={{ width: displayW, height: displayH, ...(overDropTarget && { opacity: 0.35 }) }}
    >
      <NodeResizer
        isVisible={showResizer}
        minWidth={dynMinW}
        minHeight={dynMinH}
        keepAspectRatio={!!data.isPaperFrame || wireScreen || shape === 'image' || shape === 'mockup'}   // 원은 가로/세로 자유롭게 (타원) · 와이어프레임 화면은 내용째 줄어드니 비율 고정
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
      />
      <Handles visible={currentTool === 'connect'} />
      <ShapeWrapper shape={shape} color={nodeColor} data={displayData} id={id} width={displayW} height={displayH} selected={!!selected} />
    </div>
  );
});

CustomNode.displayName = 'CustomNode';
