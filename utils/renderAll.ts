// ═══════════════════════════════════════════════════════════
// 📁 utils/renderAll.ts
// 캔버스는 화면에 보이는 요소만 그림 (onlyRenderVisibleElements — 요소가 많을 때 끊김 방지)
//   그런데 썸네일·인쇄·목업·라이브러리 사진은 화면 밖 요소까지 HTML로 있어야 찍힘
//   → 사진 찍는 동안만 잠깐 전부 그리게 하고, 다 찍으면 되돌림
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand';

// 0보다 크면 전부 그림 (여러 곳에서 동시에 찍어도 마지막이 끝날 때 되돌아가도록 개수로 셈)
export const useRenderAll = create<{ count: number }>(() => ({ count: 0 }));

export async function withAllNodesRendered<T>(fn: () => Promise<T> | T): Promise<T> {
  useRenderAll.setState((s) => ({ count: s.count + 1 }));
  // React가 빠진 요소를 HTML로 붙일 때까지 기다림
  //   두 프레임 뒤면 확실하지만, 탭이 뒤에 있으면 프레임이 안 돌아서 시간 제한도 같이 둠
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 120);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); resolve(); }));
  });
  try {
    return await fn();
  } finally {
    useRenderAll.setState((s) => ({ count: s.count - 1 }));
  }
}
