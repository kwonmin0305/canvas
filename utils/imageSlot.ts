// ═══════════════════════════════════════════════════════════
// 📁 utils/imageSlot.ts
// 사진을 받는 요소 — 기기 목업, 와이어프레임의 회색 "이미지" 칸
//   이미지 칸: AI 와이어프레임이 만든 자리표시 사각형 (data.imageSlot)
//     · 표시가 생기기 전에 만든 화면은 색 역할(바탕 fill2 + 글씨 faint)로 알아봄 — 이 조합은 이미지 칸뿐
//     · 테마(색 역할) 전에 만든 회색 화면은 실제 색(바탕 #e5e7eb + 글씨 #9ca3af 글상자)으로 알아봄
//   넣는 방법은 목업과 같음: 더블클릭(파일 선택) · 파일 끌어다 놓기 · 사진 노드를 끌어다 놓기 · 고르고 Ctrl+V
// ═══════════════════════════════════════════════════════════

import type { NodeData } from '@/types';

export const isImageSlot = (d: NodeData): boolean => {
  if (d.shape !== 'rectangle') return false;
  if (d.imageSlot) return true;
  const mark = d.wire as { bg?: string; color?: string } | undefined;
  if (mark) return mark.bg === 'fill2' && mark.color === 'faint';
  return !!d.isTextBox && d.bgColor === '#e5e7eb' && d.fontColor === '#9ca3af';
};

// 사진을 끼워 넣을 수 있는 요소 (목업 · 이미지 칸)
export const acceptsImage = (d: NodeData): boolean => d.shape === 'mockup' || isImageSlot(d);
