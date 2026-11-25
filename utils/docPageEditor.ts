// 문서 페이지(A4) 글쓰기 영역 — 워드처럼 "고른 글자만" 색을 바꾸기 위한 도우미
//  · 페이지는 서식 있는 HTML(docPageHtml)과 순수 글(docPageText)을 함께 저장
//    (AI·내보내기 등은 docPageText만 읽음)
//  · 속성 패널의 색 버튼은 applyDocSelectionColor 로 지금 고른 글자에만 색을 칠함

import { useSyncExternalStore } from 'react';
import { tr } from '@/lib/i18n';

type DocEditorHandle = {
  applyColor: (color: string) => boolean;
  applySize: (pt: number) => boolean;
  applyFont: (key: DocFontKey) => boolean;
};

const editors = new Map<string, DocEditorHandle>();

export function registerDocEditor(nodeId: string, handle: DocEditorHandle) {
  editors.set(nodeId, handle);
  return () => { if (editors.get(nodeId) === handle) editors.delete(nodeId); };
}

/** 이 페이지에서 글자를 고른 상태(또는 글 쓰는 중)면 거기에만 색을 칠하고 true. 아니면 false → 페이지 전체 글씨 색으로 */
export function applyDocSelectionColor(nodeId: string, color: string): boolean {
  return editors.get(nodeId)?.applyColor(color) ?? false;
}

/** 크기도 같은 방식 — 고른 글자(또는 커서 뒤로 쓸 글자)만. 아니면 false → 페이지 전체 크기로 */
export function applyDocSelectionSize(nodeId: string, pt: number): boolean {
  return editors.get(nodeId)?.applySize(pt) ?? false;
}

/** 글꼴도 같은 방식 — 고른 글자(또는 커서 뒤로 쓸 글자)만. 아니면 false → 페이지 전체 글꼴로 */
export function applyDocSelectionFont(nodeId: string, key: DocFontKey): boolean {
  return editors.get(nodeId)?.applyFont(key) ?? false;
}

// ── 지금 커서가 있는 글자의 크기·글꼴 — 속성 패널 "크기"·"글꼴" 칸에 보여 주기 위해 ──
type SelFormat = { nodeId: string; pt: number; font: DocFontKey };
let selFormat: SelFormat | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function setDocSelectionFormat(v: SelFormat | null) {
  if (selFormat?.nodeId === v?.nodeId && selFormat?.pt === v?.pt && selFormat?.font === v?.font) return;
  selFormat = v;
  listeners.forEach(l => l());
}

/** 이 페이지에서 글 쓰는 중이면 커서 자리 글자 크기(pt), 아니면 null */
export function useDocSelectionPt(nodeId: string): number | null {
  return useSyncExternalStore(subscribe, () => (selFormat?.nodeId === nodeId ? selFormat.pt : null), () => null);
}

/** 이 페이지에서 글 쓰는 중이면 커서 자리 글꼴, 아니면 null */
export function useDocSelectionFont(nodeId: string): DocFontKey | null {
  return useSyncExternalStore(subscribe, () => (selFormat?.nodeId === nodeId ? selFormat.font : null), () => null);
}

// ── 문서 글꼴 — 전부 SIL OFL 1.1 무료 글꼴(상업적 사용 가능). 시스템 글꼴(맑은 고딕 등)은 쓰지 않음 ──
export const DOC_FONTS = [
  { key: 'pretendard',     label: tr('프리텐다드', 'Pretendard'), css: "'Pretendard Variable', Pretendard, sans-serif" },
  { key: 'noto-sans',      label: tr('본고딕', 'Noto Sans KR'),     css: "'Noto Sans KR', sans-serif" },
  { key: 'nanum-gothic',   label: tr('나눔고딕', 'Nanum Gothic'),   css: "'Nanum Gothic', sans-serif" },
  { key: 'nanum-myeongjo', label: tr('나눔명조', 'Nanum Myeongjo'),   css: "'Nanum Myeongjo', serif" },
  { key: 'noto-serif',     label: tr('본명조', 'Noto Serif KR'),     css: "'Noto Serif KR', serif" },
] as const;
export type DocFontKey = typeof DOC_FONTS[number]['key'];
export const DEFAULT_DOC_FONT: DocFontKey = 'pretendard';
export const docFontCss = (key?: string) =>
  (DOC_FONTS.find(f => f.key === key) ?? DOC_FONTS[0]).css;
const isDocFontKey = (k: string | null): k is DocFontKey => !!k && DOC_FONTS.some(f => f.key === k);

/** 글꼴을 담는 span */
export function styleDocFontSpan(span: HTMLElement, key: DocFontKey) {
  span.dataset.font = key;
  span.style.fontFamily = docFontCss(key);
}

/** 글자 크기(pt)를 담는 span — 실제 px 은 페이지 확대율에 맞춰 --doc-pt 로 계산 */
export function styleDocSizeSpan(span: HTMLElement, pt: number) {
  span.dataset.pt = String(pt);
  span.style.fontSize = `calc(var(--doc-pt) * ${pt})`;
}

// ── 저장된 HTML 정리 — 허용한 태그와 글자색만 남김 (다른 사람이 넣은 스크립트 등 차단) ──
const KEEP_TAGS = new Set(['DIV', 'P', 'BR', 'SPAN', 'FONT', 'B', 'I', 'U', 'STRONG', 'EM']);
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'svg', 'SVG', 'MATH']);
const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? '')];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP_TAGS.has(el.tagName) || DROP_TAGS.has(tag)) return [];
  const kids = Array.from(el.childNodes).flatMap(c => cleanNode(c, doc));
  if (!KEEP_TAGS.has(tag)) return kids;          // 모르는 태그는 껍데기만 벗기고 글은 유지
  const out = doc.createElement(tag === 'FONT' ? 'span' : tag.toLowerCase());
  const color = tag === 'FONT' ? el.getAttribute('color') : (el as HTMLElement).style?.color;
  if (color && SAFE_COLOR.test(color.trim())) out.style.color = color.trim();
  const pt = Number(el.getAttribute('data-pt'));
  if (tag === 'SPAN' && Number.isFinite(pt) && pt >= 1 && pt <= 400) styleDocSizeSpan(out, pt);
  const font = el.getAttribute('data-font');
  if (tag === 'SPAN' && isDocFontKey(font)) styleDocFontSpan(out, font);
  kids.forEach(k => out.appendChild(k));
  return [out];
}

export function sanitizeDocHtml(html: string): string {
  if (typeof window === 'undefined' || !html) return '';
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return '';
  const box = document.createElement('div');
  Array.from(root.childNodes).flatMap(c => cleanNode(c, document)).forEach(n => box.appendChild(n));
  return box.innerHTML;
}

/** 편집 영역 → 순수 글 (줄바꿈 유지). 브라우저가 Enter 때 넣는 <div>·<br> 을 \n 으로 */
export function docElementToText(root: Node): string {
  let out = '';
  const walk = (node: Node) => {
    node.childNodes.forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) { out += child.textContent ?? ''; return; }
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      const tag = (child as Element).tagName;
      if (tag === 'BR') { out += '\n'; return; }
      if (tag === 'DIV' || tag === 'P') {
        if (out && !out.endsWith('\n')) out += '\n';
        walk(child);
        return;
      }
      walk(child);
    });
  };
  walk(root);
  return out.replace(/​/g, '');   // 크기 바꾼 직후 커서 자리용 빈 글자는 빼고
}

export function docHtmlToText(html: string): string {
  if (typeof window === 'undefined' || !html) return '';
  const box = document.createElement('div');
  box.innerHTML = sanitizeDocHtml(html);
  return docElementToText(box);
}
