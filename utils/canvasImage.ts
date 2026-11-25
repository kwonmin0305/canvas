// ═══════════════════════════════════════════════════════════
// 📁 utils/canvasImage.ts
// 캔버스에 붙여넣은 이미지 처리 (압축 → data URL)
//   압축된 data URL을 노드 data에 그대로 넣음 → 캔버스와 함께 localStorage에 저장
// ═══════════════════════════════════════════════════════════
import { tr } from '@/lib/i18n';

// 긴 변 최대 길이(px) / WebP 품질 — 파워포인트 기본 압축처럼 화질은 유지하되 용량을 줄임
const MAX_SIDE = 1600;
const QUALITY  = 0.85;

export interface CanvasImage {
  src:    string;   // 표시용 data URL
  width:  number;   // 압축 후 원본 픽셀 크기
  height: number;
}

// 이미지 파일을 긴 변 MAX_SIDE 이하로 줄이고 WebP로 압축
async function compressImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale  = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width  = Math.round(bitmap.width  * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width  = width;
  canvas.height = height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr('이미지 압축 실패', 'Image compression failed')))), 'image/webp', QUALITY),
  );
  return { blob, width, height };
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// 붙여넣은 이미지 파일 → 캔버스에 넣을 이미지 정보
export async function prepareCanvasImage(file: Blob): Promise<CanvasImage> {
  const { blob, width, height } = await compressImage(file);
  const src = await blobToDataUrl(blob);
  return { src, width, height };
}
