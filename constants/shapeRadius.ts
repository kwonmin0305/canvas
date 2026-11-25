// ═══════════════════════════════════════════════════════════
// 📁 constants/shapeRadius.ts
// 요소별 기본 모서리 둥글기 (px) — 둥글기를 따로 정하지 않은 요소에 씀
//   바깥일수록 크게, 안쪽일수록 작게: 프레임 16 → 카드 12 → 도형·글상자·표 8
//   화면(Node), 오른쪽 패널 슬라이더, 템플릿 요소가 모두 이 값을 같이 씀
// ═══════════════════════════════════════════════════════════

export const DEFAULT_RADIUS: Record<string, number> = {
  frame:     16,
  card:      12,
  rectangle: 8,
  image:     8,
  text:      8,
  table:     8,
  list:      8,
  callout:   8,
  page:      8,
};

// 표에 없는 요소(원·마름모 등 모서리 없는 도형)는 0
export const defaultRadius = (shape: string) => DEFAULT_RADIUS[shape] ?? 0;

// 캔버스 기준 둥글기: 설정값(px)이 요소의 일부라서 줌하면 요소와 같이 커지고 작아짐
//   (Figma·Miro와 같은 방식 — 축소·확대해도 요소 모양 비율이 그대로)
//   inset: 테두리 두께만큼 안쪽 모서리를 줄일 때 (도형 px)
export const canvasRadius = (r: number, inset = 0): string => `${Math.max(0, r - inset)}px`;
