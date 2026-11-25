'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/RightSidebar/SlideList.tsx
// 페이지 탭 — 슬라이드(프레임) 목록
//
//   - 섹션(다른 프레임을 품은 프레임)은 번호 없는 제목 줄, 안의 슬라이드는 들여써서 이어서 번호
//   - 슬라이드: 번호 · 모양 미리보기 · 이름 · 규격
//   - 누르면 그 프레임으로 화면 이동, 이름을 더블클릭하면 수정
//   - 끌어서 놓으면 순서 변경 (같은 섹션 안에서) → 캔버스 번호 배지·인쇄 순서도 같이 바뀜
//     섹션 제목을 끌면 안의 슬라이드가 통째로 움직임
// ═══════════════════════════════════════════════════════════

import { useMemo, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import type { AppNode } from '@/types';
import { useCanvasStore } from '@/store/canvasStore';
import { slideTree, paperSizeOf, slideTitleOf } from '@/utils/slides';
import styles from './RightSidebar.module.css';
import { tr } from '@/lib/i18n';

type Row = {
  id: string; kind: 'section' | 'slide'; depth: number; parent?: string;
  no: number;   // 슬라이드 번호 (섹션은 0)
  title: string; paper?: string; w: number; h: number;
};

export const SlideList = () => {
  const { setNodes, fitView } = useReactFlow<AppNode>();
  const requestPresent = useCanvasStore((s) => s.requestPresent);

  // 노드가 움직일 때마다 다시 그리지 않도록, 목록에 필요한 값만 문자열로 묶어 비교
  const key = useStore((s) => {
    let no = 0;
    return JSON.stringify(slideTree(s.nodes as AppNode[]).map(({ node: n, kind, depth, parent }): Row => ({
      id: n.id, kind, depth, parent,
      no:    kind === 'slide' ? ++no : 0,
      title: slideTitleOf(n.data.title),
      // DB 테이블이 든 프레임은 규격 자리에 "ERD" (캔버스 프레임 꼬리표와 같게)
      paper: paperSizeOf(n) ?? ((s.nodes as AppNode[]).some((c) => c.parentId === n.id && c.data.shape === 'entity') ? 'ERD' : undefined),
      w:     (n.width  ?? (n.data.width  as number | undefined)) ?? 794,
      h:     (n.height ?? (n.data.height as number | undefined)) ?? 1123,
    })));
  });
  const rows = useMemo(() => JSON.parse(key) as Row[], [key]);

  const [dragId, setDragId]       = useState<string | null>(null);
  const [overId, setOverId]       = useState<string | null>(null);   // 이 줄 위에 놓으면 그 자리로
  const [editingId, setEditingId] = useState<string | null>(null);   // 이름을 고치는 중
  const [closed, setClosed]       = useState<Set<string>>(new Set()); // 접은 섹션

  // 이름 바꾸기 — 캔버스 프레임 라벨도 같은 title을 보므로 함께 바뀜
  const rename = (id: string, title: string) => {
    const trimmed = title.trim();
    // 규격을 이름에서 읽던 예전 프레임도 칩이 유지되도록 규격을 따로 저장
    if (trimmed) setNodes((nds) => nds.map((n) => n.id === id ? { ...n, data: { ...n.data, title: trimmed, paperSize: paperSizeOf(n) } } : n));
    setEditingId(null);
  };

  // 같은 부모(섹션) 안에서만 순서 변경 — 놓은 줄 앞으로 끼우고 형제들의 pageNumber를 1, 2, 3…으로
  const dragRow = rows.find((r) => r.id === dragId);
  const canDrop = (target: Row) => !!dragRow && dragRow.id !== target.id && dragRow.parent === target.parent;
  const move = (fromId: string, toId: string) => {
    const from = rows.find((r) => r.id === fromId);
    if (!from) return;
    const siblings = rows.filter((r) => r.parent === from.parent).map((r) => r.id).filter((id) => id !== fromId);
    siblings.splice(siblings.indexOf(toId), 0, fromId);
    const order = new Map(siblings.map((id, i) => [id, i + 1]));
    setNodes((nds) => nds.map((n) => order.has(n.id) ? { ...n, data: { ...n.data, pageNumber: order.get(n.id) } } : n));
  };

  // 접힌 섹션 안의 줄은 숨김
  const hidden = (r: Row): boolean => {
    let p = r.parent;
    while (p) {
      if (closed.has(p)) return true;
      p = rows.find((x) => x.id === p)?.parent;
    }
    return false;
  };

  if (rows.length === 0) {
    return (
      <div className={styles.slideEmpty}>
        {tr('아직 슬라이드가 없어요.', 'No slides yet.')}<br />
        {tr('아래 툴바에서 프레임을 만들면 여기에 순서대로 쌓여요.', 'Frames you make from the toolbar below will stack up here in order.')}
      </div>
    );
  }

  return (
    <div className={styles.slideList}>
      {/* 발표 시작 */}
      <button className={styles.presentBtn} onClick={() => requestPresent('start')} title={tr('처음부터 발표 (F5) · 지금 슬라이드부터는 Shift+F5', 'Present from start (F5) · from current slide: Shift+F5')}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg>
        {tr('슬라이드 쇼', 'Slideshow')}
        <span className={styles.presentKey}>F5</span>
      </button>
      {rows.filter((r) => !hidden(r)).map((r) => {
        const isSection = r.kind === 'section';
        // 미리보기 상자 — 가로·세로 비율만 맞춤 (가로 최대 44, 세로 최대 32)
        const scale = Math.min(44 / r.w, 32 / r.h);
        const title = editingId === r.id ? (
          <input
            autoFocus
            className={styles.slideTitleInput}
            defaultValue={r.title}
            placeholder={tr('제목 입력', 'Enter title')}
            maxLength={40}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => rename(r.id, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter')  e.currentTarget.blur();
              if (e.key === 'Escape') setEditingId(null);
            }}
          />
        ) : (
          <span
            className={`${isSection ? styles.sectionTitle : styles.slideTitle} ${r.title ? '' : styles.slideTitleEmpty}`}
            onDoubleClick={(e) => { e.stopPropagation(); setEditingId(r.id); }}
          >{r.title || (isSection ? tr('이름 없는 섹션', 'Untitled section') : tr('제목 없음', 'Untitled'))}</span>
        );

        return (
          <div
            key={r.id}
            className={`${styles.slideRow} ${isSection ? styles.sectionRow : ''} ${dragId === r.id ? styles.slideDragging : ''} ${overId === r.id && canDrop(r) ? styles.slideOver : ''}`}
            style={{ paddingLeft: 6 + r.depth * 14 }}
            draggable={editingId !== r.id}
            onDragStart={(e) => { setDragId(r.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (canDrop(r)) { e.preventDefault(); setOverId(r.id); } }}
            onDragLeave={() => setOverId((v) => (v === r.id ? null : v))}
            onDrop={(e) => { e.preventDefault(); if (dragId && canDrop(r)) move(dragId, r.id); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}
            onClick={() => fitView({ nodes: [{ id: r.id }], padding: 0.35, maxZoom: 1.2, duration: 450 })}
            title={tr('누르면 이동 · 끌어서 순서 변경 · 이름을 더블클릭하면 수정', 'Click to go · drag to reorder · double-click name to rename')}
          >
            {isSection ? (
              <>
                {/* 접기/펼치기 */}
                <button
                  className={styles.sectionToggle}
                  onClick={(e) => {
                    e.stopPropagation();
                    setClosed((prev) => { const next = new Set(prev); if (next.has(r.id)) next.delete(r.id); else next.add(r.id); return next; });
                  }}
                  aria-label={closed.has(r.id) ? tr('섹션 펼치기', 'Expand section') : tr('섹션 접기', 'Collapse section')}
                >{closed.has(r.id) ? '▸' : '▾'}</button>
                <span className={styles.slideInfo}>{title}</span>
              </>
            ) : (
              <>
                <span className={styles.slideNo}>{r.no}</span>
                <span className={styles.slideThumbBox}>
                  <span className={styles.slideThumb} style={{ width: Math.round(r.w * scale), height: Math.round(r.h * scale) }} />
                </span>
                <span className={styles.slideInfo}>
                  {title}
                  <span className={styles.slidePaper}>{r.paper ?? tr('자유', 'Free')}</span>
                </span>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
