'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/Node/ImageSlot.tsx
// 와이어프레임 "이미지" 칸 위에 깔리는 층 — 사진을 넣고 보여 줌
//   더블클릭: 파일 선택 (글 편집 대신) · 파일 끌어다 놓기 · 사진 노드 끌어다 놓기·Ctrl+V는 Canvas가 처리
//   사진은 칸을 꽉 채움(넘치는 부분은 잘림) — 확대·좌우·상하는 속성 패널에서
// ═══════════════════════════════════════════════════════════

import { useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { prepareCanvasImage } from '@/utils/canvasImage';
import { useCanvasStore } from '@/store/canvasStore';
import type { NodeData } from '@/types';
import { tr } from '@/lib/i18n';

export function ImageSlotLayer({ data, id }: { data: NodeData; id: string }) {
  const { updateNodeData } = useReactFlow();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dropping, setDropping]   = useState(false);
  const capturing = useCanvasStore((s) => s.mockupBusyId === id);
  // 캔버스의 사진을 끌어 칸 안으로 오면 강조 (놓으면 들어간다는 표시)
  const hovering = useCanvasStore((s) => s.imageDropTargetId === id);
  const lit = dropping || hovering;
  const busy = uploading || capturing;

  const zoom = Math.max(100, (data.mockupZoom as number | undefined) ?? 100) / 100;
  const posX = (data.mockupPosX as number | undefined) ?? 50;
  const posY = (data.mockupPosY as number | undefined) ?? 50;
  const credit = data.photoCredit as { url: string; name: string; profile: string; site: string } | undefined;

  const setImage = async (file: File | undefined | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const img = await prepareCanvasImage(file);
      updateNodeData(id, { imageUrl: img.src, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined });
    } catch (err) {
      console.error(err);
      alert(tr('이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Could not upload the image. Please try again in a moment.'));
    } finally {
      setUploading(false);
    }
  };
  const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <div
      className="wire-photo"
      style={{
        position: 'absolute', inset: 0, zIndex: 1, borderRadius: 'inherit', overflow: 'hidden',
        outline: lit ? '3px solid #818cf8' : undefined, outlineOffset: -3,
        // 사진이 없으면 아래 글("이미지")이 보이게 투명 — 더블클릭·끌어다 놓기만 받음
        background: data.imageUrl ? (data.bgColor as string | undefined) ?? 'transparent' : 'transparent',
      }}
      // 글 편집 대신 파일 고르기
      onDoubleClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); e.stopPropagation();
        setDropping(false);
        void setImage(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')));
      }}
    >
      <input
        ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => { void setImage(e.target.files?.[0]); e.target.value = ''; }}
      />
      {data.imageUrl && (
        <img
          src={data.imageUrl}
          alt=""
          draggable={false}
          style={{
            width: '100%', height: '100%', objectFit: 'cover', objectPosition: `${posX}% ${posY}%`, display: 'block',
            ...(zoom > 1 ? { transform: `scale(${zoom})`, transformOrigin: `${posX}% ${posY}%` } : {}),
          }}
        />
      )}
      {/* Unsplash 사진이면 작가·Unsplash 표시 (Unsplash 규칙) — 사용자가 사진을 바꾸면 주소가 달라져 숨겨짐
          평소엔 숨기고 사진에 마우스를 올리면 보임 · 사진으로 내보내기·인쇄할 땐 항상 (globals.css의 .wire-credit) */}
      {credit && credit.url === data.imageUrl && (
        <div
          className="nodrag nopan wire-credit"
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', left: 6, bottom: 6, maxWidth: 'calc(100% - 12px)', padding: '2px 6px', borderRadius: 4,
            background: 'rgba(0,0,0,0.45)', color: '#fff', fontSize: 11, lineHeight: 1.4, fontWeight: 400,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}
        >
          Photo by <a href={credit.profile} target="_blank" rel="noopener noreferrer" style={{ color: '#fff', textDecoration: 'underline' }}>{credit.name}</a>
          {' on '}<a href={credit.site} target="_blank" rel="noopener noreferrer" style={{ color: '#fff', textDecoration: 'underline' }}>Unsplash</a>
        </div>
      )}
      {lit && !busy && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(99,102,241,0.3)', color: '#fff', fontSize: 12, fontWeight: 700,
        }}>{tr('놓으면 넣기', 'Drop to add')}</div>
      )}
      {busy && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.35)', color: '#fff', fontSize: 12, fontWeight: 600,
        }}>{tr('올리는 중…', 'Uploading…')}</div>
      )}
    </div>
  );
}
