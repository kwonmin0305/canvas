// ═══════════════════════════════════════════════════════════
// 📁 utils/canvasFile.ts
// 캔버스를 내 컴퓨터에 파일(.course)로 저장 / 다시 불러오기
// 파일 내용은 JSON — { type, version, name, nodes, edges }
//   예전 이름(.vibestructure, type 'vibestructure')으로 저장한 파일도 그대로 불러옴
// ═══════════════════════════════════════════════════════════

import type { AppNode, AppEdge } from '@/types';
import { tr } from '@/lib/i18n';

const FILE_TYPE    = 'course';
const OLD_FILE_TYPE = 'vibestructure';
const FILE_VERSION = 1;
export const FILE_EXT = '.course';
// 불러오기 창에서 고를 수 있는 파일 (예전 확장자 포함)
export const FILE_ACCEPT = '.course,.vibestructure,.json';

// 파일 이름에 쓸 수 없는 문자 제거
const safeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, '').trim() || 'canvas';

// ── 저장: 브라우저 다운로드로 파일 내려받기 ─────────────────
export const downloadCanvasFile = (name: string, nodes: AppNode[], edges: AppEdge[]) => {
  const json = JSON.stringify({ type: FILE_TYPE, version: FILE_VERSION, name, nodes, edges });
  const url  = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${safeFileName(name)}${FILE_EXT}`;
  a.click();
  URL.revokeObjectURL(url);
};

// ── 불러오기: 파일을 읽어 노드·엣지로 변환 (형식이 다르면 에러) ──
export const readCanvasFile = async (file: File): Promise<{ nodes: AppNode[]; edges: AppEdge[] }> => {
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error(tr('파일을 읽을 수 없습니다. Web Canvas(또는 Course)에서 저장한 파일인지 확인해 주세요.', 'Could not read the file. Make sure it was saved from Course.'));
  }
  const d = data as { type?: unknown; nodes?: unknown; edges?: unknown };
  if ((d?.type !== FILE_TYPE && d?.type !== OLD_FILE_TYPE) || !Array.isArray(d.nodes) || !Array.isArray(d.edges)) {
    throw new Error(tr('Course 캔버스 파일이 아닙니다.', 'This is not a Course canvas file.'));
  }
  return { nodes: d.nodes as AppNode[], edges: d.edges as AppEdge[] };
};
