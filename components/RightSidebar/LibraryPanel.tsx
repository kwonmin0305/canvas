'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/RightSidebar/LibraryPanel.tsx
// (저장 위치: 이 브라우저의 IndexedDB — store/libraryStore.ts)
// 라이브러리 탭 — 자주 쓰는 요소 묶음 보관함
//
//   - 캔버스에서 요소를 고르고 [선택한 요소 추가] → 묶음으로 저장 (프레임은 안의 것까지)
//   - 카드를 누르면 화면 가운데에, 끌어다 놓으면 놓은 자리에 들어감 (몇 번이든)
//   - 이름 더블클릭으로 수정, 마우스를 올리면 파일로 저장·삭제
//   - [가져오기]로 남이 준 라이브러리 파일(.wclib)을 내 라이브러리에 추가
//   - [모두 내보내기]로 내 라이브러리 전체를 파일 하나로
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { Plus, Upload, Download, Trash2 } from 'lucide-react';
import type { AppNode, AppEdge } from '@/types';
import { useLibraryStore } from '@/store/libraryStore';
import {
  makeLibraryItem, instantiateLibraryItem, itemBounds, sizeOfNode,
  toLibraryFile, parseLibraryFile, captureLibraryThumbnail, blobToDataUrl, LIBRARY_DRAG_TYPE, type LibraryItem,
} from '@/utils/library';
import styles from './RightSidebar.module.css';
import { tr } from '@/lib/i18n';

// ── 미리보기 — 저장된 요소 모양을 작은 그림으로 ─────────────────
const Preview = ({ item }: { item: LibraryItem }) => {
  const { w, h } = itemBounds(item);
  const byId = new Map(item.nodes.map((n) => [n.id, n]));
  // 묶음 기준 위치 (부모 위치를 더함)
  const pos = (n: AppNode) => {
    let { x, y } = n.position;
    for (let p = n.parentId ? byId.get(n.parentId) : undefined, g = 0; p && g < 50; p = p.parentId ? byId.get(p.parentId) : undefined, g++) {
      x += p.position.x; y += p.position.y;
    }
    return { x, y };
  };
  const box = new Map(item.nodes.map((n) => [n.id, { ...pos(n), ...sizeOfNode(n) }]));
  const pad = Math.max(w, h) * 0.04;
  const sw  = Math.max(w, h) / 90;   // 크기와 상관없이 비슷한 굵기

  return (
    <svg viewBox={`${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`} className={styles.libPreview} preserveAspectRatio="xMidYMid meet">
      {item.edges.map((e) => {
        const a = box.get(e.source), b = box.get(e.target);
        if (!a || !b) return null;
        return <line key={e.id} x1={a.x + a.w / 2} y1={a.y + a.h / 2} x2={b.x + b.w / 2} y2={b.y + b.h / 2}
                     stroke="currentColor" strokeOpacity={0.45} strokeWidth={sw} />;
      })}
      {item.nodes.map((n) => {
        const b = box.get(n.id)!;
        const shape = n.data.shape;
        const common = { stroke: 'currentColor', strokeWidth: sw };
        if (shape === 'frame')   return <rect key={n.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(b.w, b.h) * 0.06} fill="none" {...common} stroke="#818cf8" />;
        if (shape === 'circle')  return <ellipse key={n.id} cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill="currentColor" fillOpacity={0.08} {...common} />;
        if (shape === 'diamond') return <polygon key={n.id} points={`${b.x + b.w / 2},${b.y} ${b.x + b.w},${b.y + b.h / 2} ${b.x + b.w / 2},${b.y + b.h} ${b.x},${b.y + b.h / 2}`} fill="currentColor" fillOpacity={0.08} {...common} />;
        if (shape === 'text')    return <rect key={n.id} x={b.x} y={b.y + b.h * 0.35} width={b.w * 0.8} height={b.h * 0.3} rx={b.h * 0.1} fill="currentColor" fillOpacity={0.35} />;
        return <rect key={n.id} x={b.x} y={b.y} width={b.w} height={b.h} rx={Math.min(b.w, b.h) * 0.1} fill="currentColor" fillOpacity={0.08} {...common} />;
      })}
    </svg>
  );
};

// 파일 내려받기
const downloadFile = (items: LibraryItem[], filename: string) => {
  const blob = new Blob([JSON.stringify(toLibraryFile(items), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[\\/:*?"<>|]/g, '_')}.wclib`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const LibraryPanel = () => {
  const { getNodes, getEdges, setNodes, setEdges, getViewport, getNodesBounds } = useReactFlow<AppNode, AppEdge>();
  const { items, init, add, remove, rename } = useLibraryStore();
  const selectedCount = useStore((s) => s.nodes.filter((n) => n.selected).length);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice]       = useState<string | null>(null);
  const author: string | undefined = undefined;   // 로그인이 없어 만든 사람은 비워 둠
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { init(); }, [init]);

  // 잠깐 보이는 안내
  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((v) => (v === msg ? null : v)), 2500);
  };

  // 선택한 요소를 라이브러리에 추가 — 실제 모습을 작게 찍어 미리보기로
  const addSelection = async () => {
    const all = getNodes();
    const item = makeLibraryItem(all.filter((n) => n.selected), all, getEdges(), tr(`항목 ${items.length + 1}`, `Item ${items.length + 1}`), author);
    if (!item) return;
    const ids  = new Set(item.nodes.map((n) => n.id));
    const blob = await captureLibraryThumbnail(
      getNodesBounds([...ids]), ids, new Set(item.edges.map((e) => e.id)),
    );
    if (blob) item.thumbnail = await blobToDataUrl(blob);   // 로그인 상태면 저장할 때 Storage로 올라감
    setEditingId(item.id);   // 바로 이름을 붙일 수 있게
    if (!(await add([item]))) { setEditingId(null); flash(tr('저장하지 못했어요. 잠시 후 다시 시도해 주세요', "Couldn't save. Please try again in a moment")); }
  };

  // 화면 가운데에 넣기
  const insertAtCenter = (item: LibraryItem) => {
    const vp = getViewport();
    const { w, h } = itemBounds(item);
    const cx = (window.innerWidth / 2 - vp.x) / vp.zoom;
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom;
    const { nodes, edges } = instantiateLibraryItem(item, { x: cx - w / 2, y: cy - h / 2 });
    setNodes((prev) => [...prev.map((n) => (n.selected ? { ...n, selected: false } : n)), ...nodes]);
    setEdges((prev) => [...prev, ...edges]);
  };

  // 남이 준 파일 가져오기
  const importFile = async (file: File) => {
    try {
      const imported = parseLibraryFile(await file.text());
      if (imported.length === 0) { flash(tr('가져올 항목이 없어요', 'Nothing to import')); return; }
      flash((await add(imported)) ? tr(`${imported.length}개를 가져왔어요`, `Imported ${imported.length}`) : tr('가져오지 못했어요. 잠시 후 다시 시도해 주세요', "Couldn't import. Please try again in a moment"));
    } catch {
      flash(tr('라이브러리 파일이 아니에요', 'Not a library file'));
    }
  };

  return (
    <div className={styles.libPanel}>
      {/* 위쪽 동작 — 추가 / 가져오기 / 모두 내보내기 */}
      <button
        className={styles.libAddBtn}
        onClick={addSelection}
        disabled={selectedCount === 0}
        title={selectedCount === 0 ? tr('캔버스에서 요소를 먼저 선택하세요', 'Select elements on the canvas first') : tr('선택한 요소를 라이브러리에 저장', 'Save the selection to your library')}
      >
        <Plus size={14} strokeWidth={2.2} />
        {selectedCount > 0 ? tr(`선택한 ${selectedCount}개 추가`, `Add ${selectedCount} selected`) : tr('선택한 요소 추가', 'Add selection')}
      </button>
      <div className={styles.libActions}>
        <button className={styles.libActionBtn} onClick={() => fileRef.current?.click()} title={tr('남이 준 라이브러리 파일을 내 라이브러리에 추가', 'Add a library file someone shared to your library')}>
          <Upload size={13} strokeWidth={2} /> {tr('가져오기', 'Import')}
        </button>
        <button
          className={styles.libActionBtn}
          onClick={() => downloadFile(items, tr('내 라이브러리', 'My library'))}
          disabled={items.length === 0}
          title={tr('내 라이브러리 전체를 파일 하나로 저장', 'Save your whole library as one file')}
        >
          <Download size={13} strokeWidth={2} /> {tr('모두 내보내기', 'Export all')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".wclib,application/json"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ''; }}
        />
      </div>
      {notice && <div className={styles.libNotice}>{notice}</div>}

      {items.length === 0 ? (
        <div className={styles.slideEmpty}>
          {tr('자주 쓰는 요소를 모아 두는 곳이에요.', 'Keep elements you use often here.')}<br />
          {tr('캔버스에서 요소를 선택하고', 'Select elements on the canvas and')}<br />{tr('[선택한 요소 추가]를 눌러 보세요.', 'press [Add selection].')}
        </div>
      ) : (
        <div className={styles.libGrid}>
          {items.map((item) => (
            <div
              key={item.id}
              className={styles.libCard}
              draggable={editingId !== item.id}
              onDragStart={(e) => { e.dataTransfer.setData(LIBRARY_DRAG_TYPE, item.id); e.dataTransfer.effectAllowed = 'copy'; }}
              onClick={() => insertAtCenter(item)}
              title={tr(`누르면 화면 가운데에 · 끌어서 원하는 자리에${item.author ? `\n만든 사람: ${item.author}` : ''}`, `Click to place in the center · drag to place anywhere${item.author ? `\nBy: ${item.author}` : ''}`)}
            >
              <div className={styles.libThumb}>
                {item.thumbnail
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={item.thumbnail} alt="" className={styles.libPreview} draggable={false} />
                  : <Preview item={item} />}
              </div>
              {editingId === item.id ? (
                <input
                  autoFocus
                  className={styles.slideTitleInput}
                  defaultValue={item.name}
                  maxLength={40}
                  onFocus={(e) => e.currentTarget.select()}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => { const v = e.target.value.trim(); if (v) rename(item.id, v); setEditingId(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')  e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <span
                  className={styles.libName}
                  onDoubleClick={(e) => { e.stopPropagation(); setEditingId(item.id); }}
                >{item.name}</span>
              )}
              {/* 마우스를 올리면 보이는 버튼 — 이 항목만 파일로 / 삭제 */}
              <div className={styles.libCardTools}>
                <button
                  onClick={(e) => { e.stopPropagation(); downloadFile([item], item.name); }}
                  title={tr('이 항목만 파일로 저장', 'Save just this item as a file')}
                  aria-label={tr('파일로 저장', 'Save as file')}
                ><Download size={12} strokeWidth={2} /></button>
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm(tr(`'${item.name}'을(를) 라이브러리에서 지울까요?`, `Remove '${item.name}' from your library?`))) remove(item.id); }}
                  title={tr('라이브러리에서 삭제', 'Remove from library')}
                  aria-label={tr('삭제', 'Delete')}
                ><Trash2 size={12} strokeWidth={2} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
