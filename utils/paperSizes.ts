import { tr } from '@/lib/i18n';
// w·h는 세로 기준 — 가로를 고르면 서로 바뀜. fixed는 방향과 상관없이 이 크기 그대로 (발표 화면)
export const PAPER_SIZES = [
  { name: '16:9',   desc: tr('발표 화면용 (1920×1080). 슬라이드로 띄우면 화면을 꽉 채움', 'For presenting (1920×1080). Fills the screen as a slide'),     w: 1920, h: 1080, fixed: true },
  { name: 'A4',     desc: tr('일반적인 공문서, 레포트, 사무용 인쇄의 절대적 표준', 'The standard for documents, reports and office printing'),           w: 794,  h: 1123 },
  { name: 'A3',     desc: tr('A4의 두 배 크기. 설계도면, 포스터, 홍보물 제작용', 'Twice the size of A4. For drawings, posters and flyers'),             w: 1123, h: 1587 },
  { name: 'B4',     desc: tr('시험지나 문제집, 만화책 등에서 주로 사용', 'Common for exam papers, workbooks and comics'),                      w: 945,  h: 1334 },
  { name: 'B5',     desc: tr('시험지나 문제집, 만화책 등에서 주로 사용', 'Common for exam papers, workbooks and comics'),                      w: 665,  h:  945 },
  { name: 'Letter', desc: tr('미국 기반 회사와 협업하거나 북미 지역으로 문서를 보낼 때 사용', 'US/North American standard size'),  w: 816,  h: 1056 },
] as const;

export type PaperSize = typeof PAPER_SIZES[number];

// 고른 방향(세로/가로)에 맞춘 실제 크기
export const paperDims = (p: PaperSize, orientation: 'portrait' | 'landscape') =>
  'fixed' in p || orientation === 'portrait' ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
