// ═══════════════════════════════════════════════════════════
// 📁 lib/ai/wireframe/theme.ts
// 와이어프레임 테마 — 색·둥글기 한 세트. "디자인 입히기"는 테마만 바꿔 다시 칠하는 것
//
//   요소는 실제 색 대신 "어떤 역할의 색인지"(토큰: primary, muted …)를 data.wire에 같이 들고 있음
//   → applyWireTheme이 그 토큰을 새 테마의 색으로 바꿔 줌 (위치·글은 그대로)
//   브랜드 색(#rrggbb)을 주면 그 색을 주 색으로 하고 옅은 색·강조 글자색을 거기서 만들어 냄
//   서버(AI 도구)와 화면(속성 패널·캔버스 수정)이 같이 씀 — 순수 함수만
// ═══════════════════════════════════════════════════════════

import type { AppNode } from '@/types';
import { tr } from '@/lib/i18n';
import { wireIconUrl } from './icons';

export interface WireTheme {
  label:     string;   // 패널에 보이는 이름
  ink:       string;   // 제목
  text:      string;   // 본문
  muted:     string;   // 보조 글
  faint:     string;   // 안내 글 (입력창 placeholder 등) — 바탕 대비 3:1 이상 (madia D5)
  line:      string;   // 구분선·카드 테두리
  border:    string;   // 입력창·버튼·화면 테두리
  fill:      string;   // 옅은 채움
  fill2:     string;   // 이미지 자리
  surface:   string;   // 화면·카드 바탕
  side:      string;   // 사이드바 바탕
  primary:   string;   // 주 버튼·선택된 칩
  onPrimary: string;   // 주 버튼 글자
  soft:      string;   // 주 색의 옅은 바탕 (랜딩 소개, 선택된 메뉴, 꼬리표)
  accent:    string;   // 주 색 글자 (선택된 메뉴·탭)
  radius:    number;   // 기본 모서리 둥글기 (8 기준 — 다른 둥글기는 이 비율로)
}
export type WireToken = Exclude<keyof WireTheme, 'label' | 'radius'>;

const SLATE = {
  ink: '#0f172a', text: '#334155', muted: '#64748b', faint: '#7b8aa0',
  line: '#e2e8f0', border: '#cbd5e1', fill: '#f1f5f9', fill2: '#e2e8f0', surface: '#ffffff', side: '#f8fafc',
};
const STONE = {
  ink: '#1c1917', text: '#44403c', muted: '#78716c', faint: '#8a837e',
  line: '#e7e5e4', border: '#d6d3d1', fill: '#f5f5f4', fill2: '#e7e5e4', surface: '#ffffff', side: '#fafaf9',
};

export const WIRE_THEMES = {
  wireframe: {
    label: tr('와이어프레임', 'Wireframe'),
    ink: '#111827', text: '#374151', muted: '#6b7280', faint: '#868b94',
    line: '#e5e7eb', border: '#d1d5db', fill: '#f3f4f6', fill2: '#e5e7eb', surface: '#ffffff', side: '#f9fafb',
    primary: '#111827', onPrimary: '#ffffff', soft: '#f3f4f6', accent: '#111827', radius: 8,
  },
  indigo: { label: tr('인디고', 'Indigo'), ...SLATE, primary: '#4f46e5', onPrimary: '#ffffff', soft: '#eef2ff', accent: '#4338ca', radius: 10 },
  blue:   { label: tr('블루', 'Blue'),   ...SLATE, primary: '#2563eb', onPrimary: '#ffffff', soft: '#eff6ff', accent: '#1d4ed8', radius: 8 },
  green:  { label: tr('그린', 'Green'),   ...SLATE, primary: '#059669', onPrimary: '#ffffff', soft: '#ecfdf5', accent: '#047857', radius: 10 },
  violet: { label: tr('바이올렛', 'Violet'), ...SLATE, primary: '#7c3aed', onPrimary: '#ffffff', soft: '#f5f3ff', accent: '#6d28d9', radius: 12 },
  orange: { label: tr('오렌지', 'Orange'), ...STONE, primary: '#ea580c', onPrimary: '#ffffff', soft: '#fff7ed', accent: '#c2410c', radius: 12 },
  rose:   { label: tr('로즈', 'Rose'),   ...STONE, primary: '#e11d48', onPrimary: '#ffffff', soft: '#fff1f2', accent: '#be123c', radius: 14 },
  dark: {
    label: tr('다크', 'Dark'),
    ink: '#f8fafc', text: '#cbd5e1', muted: '#94a3b8', faint: '#6f7f96',
    line: '#1e293b', border: '#334155', fill: '#1e293b', fill2: '#334155', surface: '#0f172a', side: '#0b1220',
    primary: '#6366f1', onPrimary: '#ffffff', soft: '#1e1b4b', accent: '#a5b4fc', radius: 10,
  },
} satisfies Record<string, WireTheme>;

export type WireThemeName = keyof typeof WIRE_THEMES;
export const WIRE_THEME_NAMES = Object.keys(WIRE_THEMES) as WireThemeName[];
export const isWireThemeName = (v: unknown): v is WireThemeName =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(WIRE_THEMES, v);

// ── 브랜드 색에서 옅은 색·강조 글자색 만들기 ──────────────────
const HEX = /^#([0-9a-f]{6})$/i;
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
const lum = (c: string) => { const [r, g, b] = rgb(c).map((v) => v / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

export const validBrand = (v: unknown): string | undefined =>
  typeof v === 'string' && HEX.test(v.trim()) ? v.trim().toLowerCase() : undefined;

// 받은 이름을 실제 테마 이름으로 — 모르는 이름은 와이어프레임, 회색 와이어프레임에 브랜드 색만 주면 색이 어울리는 인디고 바탕
export const wireThemeName = (name: unknown, brand?: unknown): WireThemeName => {
  const n = isWireThemeName(name) ? name : 'wireframe';
  return n === 'wireframe' && validBrand(brand) ? 'indigo' : n;
};

// 테마 이름(+브랜드 색) → 실제 색 세트
export function resolveWireTheme(name: unknown, brand?: unknown): WireTheme {
  const b = validBrand(brand);
  const base: WireTheme = WIRE_THEMES[wireThemeName(name, brand)];
  if (!b) return base;
  const dark = lum(base.surface) < 0.4;
  return {
    ...base,
    primary:   b,
    onPrimary: lum(b) > 0.62 ? '#111827' : '#ffffff',
    soft:      mix(b, base.surface, dark ? 0.78 : 0.92),
    accent:    dark ? mix(b, '#ffffff', 0.45) : lum(b) > 0.45 ? mix(b, '#000000', 0.45) : mix(b, '#000000', 0.15),
  };
}

// 요소가 들고 다니는 색 역할 — data.wire
// icon: 선 아이콘 이름 (icons.ts) — 그림 칸에 color 색으로 그림
export interface WireMark { bg?: WireToken; stroke?: WireToken; color?: WireToken; r?: number; icon?: string }

// 기준 둥글기(8 기준 값) → 이 테마의 둥글기. 0(각짐)과 알약 모양(높이의 절반 이상)은 그대로
export const wireRadius = (theme: WireTheme, r: number, height: number) =>
  r <= 0 ? 0 : r * 2 >= height ? r : Math.round(r * theme.radius / 8);

// 토큰 → 색을 요소 data에 칠함 (새 data를 돌려줌)
const paint = (data: AppNode['data'], theme: WireTheme): AppNode['data'] => {
  const mark = data.wire as WireMark | undefined;
  if (!mark) return data;
  return {
    ...data,
    ...(mark.bg     && { bgColor:     theme[mark.bg] }),
    ...(mark.stroke && { strokeColor: theme[mark.stroke] }),
    ...(mark.color  && { fontColor:   theme[mark.color] }),
    ...(mark.r !== undefined && { borderRadius: wireRadius(theme, mark.r, (data.height as number | undefined) ?? 0) }),
    ...(mark.icon && { imageUrl: wireIconUrl(mark.icon, theme[mark.color ?? 'accent']) }),
  };
};

// 와이어프레임 화면(프레임)인지 — 만들 때 data.wireTheme을 적어 둠
export const isWireFrame = (n: AppNode) => n.data.shape === 'frame' && typeof n.data.wireTheme === 'string';

// 같은 요청으로 함께 만든 화면들 (id가 wireframe-<시각>-<번호>-frame) — 테마는 한 서비스 화면끼리 같이 바꿈
// 나중에 이어 붙인 화면도 같은 바깥 프레임에 들어 있으면 한 묶음으로 봄
export const wireBatchFrameIds = (nodes: AppNode[], frameId: string): Set<string> => {
  const batch = frameId.replace(/-\d+-frame$/, '-');
  const parent = nodes.find((n) => n.id === frameId)?.parentId;
  return new Set(nodes.filter((n) => isWireFrame(n)
    && (n.id === frameId || n.id.startsWith(batch) || (!!parent && n.parentId === parent))).map((n) => n.id));
};

// 화면들의 테마를 바꿈 — frameIds가 없으면 캔버스의 와이어프레임 화면 전부. 바뀐 게 없으면 받은 배열 그대로
export function applyWireTheme(nodes: AppNode[], frameIds: Set<string> | null, name: unknown, brand?: unknown): AppNode[] {
  const targets = new Set(nodes.filter((n) => isWireFrame(n) && (!frameIds || frameIds.has(n.id))).map((n) => n.id));
  if (targets.size === 0) return nodes;
  const theme = resolveWireTheme(name, brand);
  const themeName = wireThemeName(name, brand);
  const b = validBrand(brand);
  return nodes.map((n) => {
    if (targets.has(n.id)) return { ...n, data: { ...paint(n.data, theme), wireTheme: themeName, wireBrand: b } };
    if (n.parentId && targets.has(n.parentId) && n.data.wire) return { ...n, data: paint(n.data, theme) };
    return n;
  });
}
