// ═══════════════════════════════════════════════════════════
// 📁 utils/captureNodes.ts
// 캔버스의 일부 노드만 원래 크기 그대로 사진으로 찍기 (html-to-image)
//   쓰임: 와이어프레임 화면(프레임)을 기기 목업 위에 놓으면 그 화면을 찍어 목업에 넣음
//   bounds = 찍을 캔버스 범위 / ids = 보이게 할 노드 id (나머지 노드·연결선은 뺌)
// ═══════════════════════════════════════════════════════════

import { withAllNodesRendered } from './renderAll';

export const captureNodesImage = (
  bounds: { x: number; y: number; width: number; height: number },
  ids: Set<string>,
  targetPx = 1200,
): Promise<Blob | null> => withAllNodesRendered(() => captureNodesImageNow(bounds, ids, targetPx));

const captureNodesImageNow = async (
  bounds: { x: number; y: number; width: number; height: number },
  ids: Set<string>,
  targetPx = 1200,   // 긴 쪽이 대략 이 픽셀이 되게 (휴대폰 화면 3배 정도 → 목업에서 또렷하게)
): Promise<Blob | null> => {
  const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!viewportEl || bounds.width <= 0 || bounds.height <= 0) return null;
  const w = Math.ceil(bounds.width);
  const h = Math.ceil(bounds.height);
  const pixelRatio = Math.min(4, Math.max(1, targetPx / Math.max(w, h)));

  // 선택 테두리가 찍히지 않게 잠깐 선택 표시를 뗌 (찍은 뒤 되돌림)
  const selectedEls = [...viewportEl.querySelectorAll<HTMLElement>('.react-flow__node.selected')];
  selectedEls.forEach((el) => el.classList.remove('selected'));
  // 마우스를 올려야 보이는 표시(Unsplash 작가)도 찍히게 (globals.css)
  document.documentElement.dataset.capturing = '1';
  try {
    const { toCanvas } = await import('html-to-image');
    const canvas = await toCanvas(viewportEl, {
      width: w, height: h, pixelRatio, skipFonts: true,
      // 줌 1배로, 찍을 범위의 왼쪽 위가 (0,0)에 오게
      style: { width: `${w}px`, height: `${h}px`, transform: `translate(${-bounds.x}px, ${-bounds.y}px) scale(1)` },
      filter: (el) => {
        if (!(el instanceof Element)) return true;
        const cl = el.classList;
        // 편집용 표시(크기 조절 손잡이·여러 개 선택 상자)와 연결선은 빼기
        if (cl.contains('react-flow__resize-control') || cl.contains('react-flow__nodesselection')) return false;
        if (cl.contains('react-flow__edges') || cl.contains('react-flow__edgelabel-renderer')) return false;
        if (cl.contains('react-flow__node')) return ids.has(el.getAttribute('data-id') ?? '');
        return true;
      },
    });
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch (err) {
    console.error(err);
    return null;
  } finally {
    selectedEls.forEach((el) => el.classList.add('selected'));
    delete document.documentElement.dataset.capturing;
  }
};
