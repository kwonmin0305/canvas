'use client';

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useReactFlow, useStore, Panel, MarkerType } from '@xyflow/react';
import { Trash2, Copy, ArrowUpToLine, ArrowDownToLine, ChevronDown, ChevronUp, Pencil, Code, AlignLeft, AlignCenter, AlignRight, AlignJustify, AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd } from 'lucide-react';
import type { AppNode, AppEdge, NodeType, DocTemplateContent, DocTemplateElementStyle } from '@/types';
import { NODE_COLORS } from '@/utils/nodeData';
import { useCanvasStore } from '@/store/canvasStore';
import { codeBoxHeight, CODE_FONT_SIZES, cardLabelFontPx, cardIconPx } from '@/components/Node';
import { defaultRadius } from '@/constants/shapeRadius';
import { MOCKUP_COLORS, MOCKUP_DEVICES, DEVICE_COLORS, mockupDevice, mockupColorKey } from '@/components/Node/Mockup';
import { isImageSlot } from '@/utils/imageSlot';
import {
  applyDocSelectionColor, applyDocSelectionSize, applyDocSelectionFont,
  useDocSelectionPt, useDocSelectionFont,
  DOC_FONTS, DEFAULT_DOC_FONT, docFontCss, type DocFontKey,
} from '@/utils/docPageEditor';
import { EntitySection } from '@/lib/erd/EntitySection';
import { prepareCanvasImage } from '@/utils/canvasImage';
import { groupIdOf, groupNodes, ungroupNodes } from '@/utils/group';
import { WIRE_THEMES, WIRE_THEME_NAMES, applyWireTheme, wireBatchFrameIds } from '@/lib/wireframe/theme';
import { tr } from '@/lib/i18n';


// ── 아키텍처 타입 레이블 ──────────────────────────────────────
const TYPE_LABELS: Record<NodeType, string> = {
  gateway: 'Gateway', database: 'Database', worker: 'Worker',
  storage: 'Storage', queue: 'Queue', service: 'Service',
  cache: 'Cache', client: 'Client', cdn: 'CDN', auth: 'Auth',
  server: 'Server', api: 'API', load_balancer: 'LB',
  function: 'Function', container: 'Container', message_bus: 'MsgBus',
  mobile: 'Mobile', admin: 'Admin', payment_api: 'Payment',
  oauth_api: 'OAuth', ai_api: 'AI API', messaging_api: 'Msg',
  maps_api: 'Maps', data_api: 'Data', search_api: 'Search',
  social_api: 'Social', security_api: 'Security',
  translate_api: 'Translate', finance_api: 'Finance',
  api_server: 'API Srv',
};

// ── 30색 팔레트 (5행 × 6열) ──────────────────────────────────
const COLOR_PALETTE: string[][] = [
  ['#ffffff', '#d1d5db', '#9ca3af', '#6b7280', '#374151', '#111827'],
  ['#fecaca', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#7f1d1d'],
  ['#fed7aa', '#fb923c', '#f97316', '#fbbf24', '#fef08a', '#eab308'],
  ['#bbf7d0', '#4ade80', '#22c55e', '#059669', '#6ee7b7', '#14b8a6'],
  ['#bfdbfe', '#60a5fa', '#3b82f6', '#1d4ed8', '#c4b5fd', '#7c3aed'],
];
const ALL_COLORS = COLOR_PALETTE.flat();

// ── 화살표 옵션 ───────────────────────────────────────────────
type ArrowType = 'none' | 'end' | 'start' | 'both';

// ── 공통 스타일 상수 ──────────────────────────────────────────
const LABEL = 'text-[12px] font-semibold text-[rgba(var(--ui-fg-rgb),0.5)] tracking-[0.06em] uppercase select-none';
const BTN_BASE = 'flex items-center justify-center border rounded-lg cursor-pointer transition-all duration-150';
// 기본 버튼은 테두리 없이 옅은 배경만 (테두리는 투명으로 남겨 선택돼도 크기 그대로)
const BTN_IDLE = 'bg-[rgba(var(--ui-fg-rgb),0.04)] border-transparent text-[rgba(var(--ui-fg-rgb),0.65)] hover:bg-[rgba(var(--ui-fg-rgb),0.08)] hover:text-[rgb(var(--ui-fg-rgb))]';
const BTN_ON   = 'bg-indigo-400/20 border-indigo-300/40 text-[var(--ui-accent-text)]';   // 선택됨 — 연한 보라

// ── 패널 공용 부품 ────────────────────────────────────────────
// 섹션 제목 · 섹션 사이 구분선(위아래 12px)
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.55)] select-none">{children}</span>
);
const SECTION_DIV = <div className="h-px bg-[rgba(var(--ui-fg-rgb),0.06)] my-3 shrink-0" />;

// 하나로 이어진 버튼 묶음 — 바깥 테두리 하나, 안쪽은 구분선만
function Segmented<T extends string | number | boolean>({
  options, value, onChange,
}: {
  options: readonly { value: T; label: React.ReactNode; title?: string; style?: React.CSSProperties }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-7 border border-[rgba(var(--ui-fg-rgb),0.1)] rounded-lg overflow-hidden">
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          title={o.title}
          style={o.style}
          onClick={() => onChange(o.value)}
          className={`flex-1 flex items-center justify-center gap-1.5 text-[12px] cursor-pointer transition-colors ${
            i > 0 ? 'border-l border-[rgba(var(--ui-fg-rgb),0.07)]' : ''
          } ${o.value === value ? 'bg-indigo-400/20 text-[var(--ui-accent-text)]' : 'text-[rgba(var(--ui-fg-rgb),0.65)] hover:bg-[rgba(var(--ui-fg-rgb),0.06)] hover:text-[rgb(var(--ui-fg-rgb))]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// "세부" 접이식 영역 — 자주 안 쓰는 속성(그림자·여백·줄 높이·자간)을 평소엔 접어 둠
// 펼쳤는지는 기억해서 다른 요소를 골라도(패널이 다시 그려져도) 그대로
let detailOpenMemo = false;
function Detail({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(detailOpenMemo);
  const toggle = () => { detailOpenMemo = !open; setOpen(!open); };
  return (
    <div className="flex flex-col gap-2">
      <button onClick={toggle} title={open ? tr('세부 속성 접기', 'Collapse details') : tr('세부 속성 펼치기', 'Expand details')}
        className="flex items-center justify-between w-full h-5 text-[12px] text-[rgba(var(--ui-fg-rgb),0.55)] hover:text-[rgb(var(--ui-fg-rgb))] cursor-pointer select-none">
        {tr('세부', 'Details')}
        {open ? <ChevronUp size={12} strokeWidth={1.8} /> : <ChevronDown size={12} strokeWidth={1.8} />}
      </button>
      {open && children}
    </div>
  );
}

// 얇은 슬라이더 — 작은 손잡이, 채워진 부분만 연보라
function SliderRow({ label, value, min, max, unit, onChange }: {
  label: string; value: number; min: number; max: number; unit: string; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.55)] w-9 shrink-0">{label}</span>
      <input
        type="range" min={min} max={max} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 h-[3px] appearance-none rounded-full cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-[11px] [&::-webkit-slider-thumb]:h-[11px]
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-300
                   [&::-moz-range-thumb]:w-[11px] [&::-moz-range-thumb]:h-[11px] [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-indigo-300 [&::-moz-range-thumb]:border-0"
        style={{ background: `linear-gradient(to right, #a5b4fc ${pct}%, rgba(var(--ui-fg-rgb),0.15) ${pct}%)` }}
      />
      <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.42)] w-8 text-right tabular-nums shrink-0">{value}{unit}</span>
    </div>
  );
}

// 하단 아이콘 버튼 (순서 · 복사 · 삭제) — danger는 마우스를 올릴 때만 빨간색
function IconAction({ title, onClick, danger, children }: {
  title: string; onClick: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`w-7 h-7 rounded-lg flex items-center justify-center text-[rgba(var(--ui-fg-rgb),0.6)] cursor-pointer transition-colors ${
        danger ? 'hover:bg-red-500/10 hover:text-red-400' : 'hover:bg-[rgba(var(--ui-fg-rgb),0.08)] hover:text-[rgb(var(--ui-fg-rgb))]'
      }`}
    >
      {children}
    </button>
  );
}

// ── 헥스 유효성 ──────────────────────────────────────────────
function isValidHex(h: string) { return /^#[0-9a-fA-F]{6}$/.test(h); }

// 빨주노초파보 + 투명 퀵 컬러 (NodePanel 전용)
const RAINBOW_QUICK = ['#f87171','#fb923c','#facc15','#4ade80','#60a5fa','#a78bfa','transparent'] as const;
// 배경용 — 같은 무지개 순서의 연한(200) 계열, 위에 올린 글씨가 잘 보이도록
const PASTEL_QUICK  = ['#ffffff','#fecaca','#fef08a','#bbf7d0','#bfdbfe','#ddd6fe','transparent'] as const;
// 윤곽선용 — 검정을 맨 앞에, 주황은 뺌
const BORDER_QUICK  = ['#111827','#f87171','#facc15','#4ade80','#60a5fa','#a78bfa','transparent'] as const;
// 글씨 색용 — 검정·회색·빨강·초록·파랑·보라 + 기본색. 흰 바탕 대비 4.5:1 이상인 진한 계열(초록은 700), 노랑은 안 읽혀서 뺌
// 문서 페이지 글씨 색 — 기본 검정·회색·빨강·초록·파랑·보라 + 어두운 배경용 흰색
const DOC_TEXT_QUICK = ['#1a1a1a','#6b7280','#dc2626','#15803d','#2563eb','#7c3aed','#ffffff'] as const;
const TEXT_QUICK    = ['#111827','#6b7280','#dc2626','#15803d','#2563eb','#7c3aed','transparent'] as const;

// ── 색상 스와치 선택기 ─────────────────────────────────────────
function ColorSwatch({
  label, value, onChange, quickColors,
}: { label: string; value: string; onChange: (c: string) => void; quickColors?: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value);
  useEffect(() => { setHexInput(value); }, [value]);

  // 상단 퀵 스와치: 전달된 색 또는 기본 그레이 6색
  const quick = quickColors ?? ALL_COLORS.slice(0, 6);

  const isMatch = (c: string) =>
    c === 'transparent'
      ? (!value || value === 'transparent')
      : value.toLowerCase() === c.toLowerCase();

  return (
    <div className="flex flex-col gap-1.5">
      {/* 헤더: 레이블 + 토글 */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.5)]">{label}</span>
        <button
          onMouseDown={e => e.preventDefault()}
          onClick={() => setOpen(v => !v)}
          className="flex items-center justify-center w-5 h-5 text-[rgba(var(--ui-fg-rgb),0.35)] hover:text-[rgba(var(--ui-fg-rgb),0.72)] bg-transparent border-none cursor-pointer rounded transition-colors"
        >
          {open ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
        </button>
      </div>

      {/* 퀵 스와치 */}
      <div className="flex gap-[4px]">
        {quick.map(c => (
          <button
            key={c}
            // 누를 때 포커스를 뺏지 않음 → 문서에서 고른 글자 선택이 그대로 유지
            onMouseDown={e => e.preventDefault()}
            onClick={() => { onChange(c); if (c !== 'transparent') setHexInput(c); }}
            style={{
              flex: 1, minWidth: 0, aspectRatio: '1 / 1',   // 정사각형
              background: c === 'transparent' ? undefined : c,
              backgroundImage: c === 'transparent'
                ? 'repeating-conic-gradient(#444 0% 25%, #222 0% 50%)'
                : undefined,
              backgroundSize: c === 'transparent' ? '8px 8px' : undefined,
              border: '1px solid rgba(var(--ui-fg-rgb),0.15)',
              // 선택 표시는 outline으로 → 테두리 두께가 바뀌어도 크기 그대로
              outline: isMatch(c) ? '2px solid #818cf8' : 'none',
              outlineOffset: -2,
              borderRadius: 6, cursor: 'pointer', padding: 0,
            }}
            title={c === 'transparent' ? tr('투명', 'Transparent') : c}
          />
        ))}
      </div>

      {/* 확장: 전체 팔레트 + HEX 입력 */}
      {open && (
        <div className="flex flex-col gap-2 pt-0.5">
          {/* HEX 입력 */}
          <div className="flex gap-2 items-center">
            <div style={{
              width: 24, height: 24, borderRadius: 5, flexShrink: 0,
              background: isValidHex(value) ? value : (value === 'transparent' ? undefined : '#000'),
              backgroundImage: value === 'transparent' ? 'repeating-conic-gradient(#444 0% 25%, #222 0% 50%)' : undefined,
              backgroundSize: value === 'transparent' ? '8px 8px' : undefined,
              border: '1px solid rgba(var(--ui-fg-rgb),0.15)',
            }} />
            <input
              value={hexInput}
              onChange={e => {
                setHexInput(e.target.value);
                if (isValidHex(e.target.value)) onChange(e.target.value);
              }}
              onBlur={() => { if (!isValidHex(hexInput)) setHexInput(value); }}
              placeholder="#000000"
              className="flex-1 h-7 px-2 text-[12px] bg-[rgba(var(--ui-fg-rgb),0.06)] border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-md text-[rgba(var(--ui-fg-rgb),0.9)] focus:outline-none focus:border-indigo-500"
              style={{ fontFamily: "'Fira Mono','Consolas',monospace" }}
            />
          </div>

          {/* 전체 팔레트 (5행 × 6열) */}
          {COLOR_PALETTE.map((row, ri) => (
            <div key={ri} className="flex gap-[5px]">
              {row.map(c => (
                <button
                  key={c}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { onChange(c); setHexInput(c); }}
                  style={{
                    flex: 1, minWidth: 0, aspectRatio: '1 / 1',   // 정사각형 (패널 너비 따라 크기만 바뀜)
                    background: c,
                    border: '1px solid rgba(var(--ui-fg-rgb),0.1)',
                    // 선택 표시는 outline으로 → 테두리가 두꺼워져 한 칸만 넓어지는(그래서 옆 칸이 세로로 늘어나는) 일 없음
                    outline: value.toLowerCase() === c.toLowerCase() ? '2px solid #818cf8' : 'none',
                    outlineOffset: -2,
                    borderRadius: 4, cursor: 'pointer', padding: 0,
                    transition: 'border-color 0.1s, transform 0.1s',
                  }}
                  title={c}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 아코디언 섹션 ─────────────────────────────────────────────
function Section({
  title, defaultOpen = true, collapsible = true, children,
}: {
  title: string; defaultOpen?: boolean; collapsible?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  // 접을 필요 없는 섹션: 화살표 없이 제목 + 내용만
  if (!collapsible) {
    return (
      <div className="border-b border-[rgba(var(--ui-fg-rgb),0.05)]">
        <div className="px-3 py-2.5"><span className={LABEL}>{title}</span></div>
        <div className="px-3 pb-3 flex flex-col gap-[10px]">{children}</div>
      </div>
    );
  }
  return (
    <div className="border-b border-[rgba(var(--ui-fg-rgb),0.05)]">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 cursor-pointer bg-transparent border-none"
        onClick={() => setOpen(v => !v)}
      >
        <span className={LABEL}>{title}</span>
        <svg
          width="10" height="6" viewBox="0 0 10 6" fill="none"
          stroke="#555" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }}
        >
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-[10px]">
          {children}
        </div>
      )}
    </div>
  );
}

// ── 기본 6색 퀵 스와치 + 확장 팔레트 ────────────────────────────
const BASIC_COLORS = ['#ffffff', '#f87171', '#4ade80', '#60a5fa', '#fb923c', '#9ca3af'];

function InlineColorPicker({
  value, onChange, showTransparent = false,
}: { value: string; onChange: (c: string) => void; showTransparent?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const isSelected = (c: string) =>
    value.toLowerCase() === c.toLowerCase() ||
    (c === 'transparent' && (!value || value === 'transparent'));

  return (
    <div className="flex flex-col gap-2">
      {/* 퀵 스와치 행 */}
      <div className="flex items-center gap-[5px]">
        {showTransparent && (
          <button
            onClick={() => onChange('transparent')}
            title={tr('투명', 'Transparent')}
            style={{
              flex: 1, minWidth: 0, aspectRatio: '1',
              borderRadius: 6,
              backgroundImage: 'repeating-conic-gradient(#444 0% 25%, #222 0% 50%)',
              backgroundSize: '8px 8px',
              border: '1px solid rgba(var(--ui-fg-rgb),0.15)',
              outline: isSelected('transparent') ? '2px solid #818cf8' : 'none',
              outlineOffset: -2,
              cursor: 'pointer', padding: 0,
            }}
          />
        )}
        {BASIC_COLORS.map(c => (
          <button
            key={c}
            onClick={() => onChange(c)}
            title={c}
            style={{
              flex: 1, minWidth: 0, aspectRatio: '1',
              background: c,
              border: '1px solid rgba(var(--ui-fg-rgb),0.15)',
              outline: isSelected(c) ? '2px solid #818cf8' : 'none',   // 선택해도 크기 그대로
              outlineOffset: -2,
              borderRadius: 6, cursor: 'pointer', padding: 0,
            }}
          />
        ))}
        {/* 확장 토글 */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center justify-center w-5 text-[rgba(var(--ui-fg-rgb),0.35)] hover:text-[rgba(var(--ui-fg-rgb),0.72)] bg-transparent border-none cursor-pointer shrink-0"
          style={{ aspectRatio: '1' }}
        >
          {expanded
            ? <ChevronUp size={12} strokeWidth={2} />
            : <ChevronDown size={12} strokeWidth={2} />}
        </button>
      </div>

      {/* 확장: 전체 30색 팔레트 + HEX 입력 */}
      {expanded && (
        <div className="flex flex-col gap-1.5 pt-0.5">
          {COLOR_PALETTE.map((row, ri) => (
            <div key={ri} className="flex gap-[4px]">
              {row.map(c => (
                <button
                  key={c}
                  onClick={() => onChange(c)}
                  title={c}
                  style={{
                    flex: 1, minWidth: 0, aspectRatio: '1 / 1',   // 정사각형
                    background: c,
                    border: '1px solid rgba(var(--ui-fg-rgb),0.1)',
                    outline: isSelected(c) ? '2px solid #818cf8' : 'none',   // 선택해도 크기 그대로
                    outlineOffset: -2,
                    borderRadius: 4, cursor: 'pointer', padding: 0,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stepper ───────────────────────────────────────────────────
function Stepper({
  value, onChange, min = 0, max = 200, suffix,
}: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw(String(value)), [value]);

  const commit = (s: string) => {
    const n = parseFloat(s);
    if (!isNaN(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
  };

  return (
    <div className="flex items-center gap-1">
      {/* 테두리 하나로 숫자칸 + 위/아래 화살표를 묶음 → 높이가 딱 맞아 튀어나오지 않음 */}
      <div className="flex items-stretch h-6 box-border border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-md overflow-hidden bg-[rgba(var(--ui-fg-rgb),0.06)] focus-within:border-indigo-500">
        <input
          type="number" min={min} max={max} value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && commit(raw)}
          className="w-10 h-full p-0 text-center text-[12px] bg-transparent border-none text-[rgb(var(--ui-fg-rgb))]
                     focus:outline-none
                     [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none
                     [&::-webkit-inner-spin-button]:appearance-none"
        />
        <div className="flex flex-col w-[14px] border-l border-[rgba(var(--ui-fg-rgb),0.12)]">
          <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => onChange(Math.min(max, value + 1))}
            className="flex-1 min-h-0 p-0 flex items-center justify-center bg-transparent border-none hover:bg-[rgba(var(--ui-fg-rgb),0.08)] text-[rgba(var(--ui-fg-rgb),0.42)] hover:text-[rgb(var(--ui-fg-rgb))] cursor-pointer">
            <svg width="7" height="4" viewBox="0 0 7 4"><path d="M0 4L3.5 0L7 4" fill="currentColor"/></svg>
          </button>
          <div className="h-px bg-[rgba(var(--ui-fg-rgb),0.12)]" />
          <button tabIndex={-1} onMouseDown={e => e.preventDefault()} onClick={() => onChange(Math.max(min, value - 1))}
            className="flex-1 min-h-0 p-0 flex items-center justify-center bg-transparent border-none hover:bg-[rgba(var(--ui-fg-rgb),0.08)] text-[rgba(var(--ui-fg-rgb),0.42)] hover:text-[rgb(var(--ui-fg-rgb))] cursor-pointer">
            <svg width="7" height="4" viewBox="0 0 7 4"><path d="M0 0L3.5 4L7 0" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
      {suffix && <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.35)]">{suffix}</span>}
    </div>
  );
}

// ── A4 상수 ───────────────────────────────────────────────────
const DOC_A4_W = 794, DOC_A4_H = 1123, DOC_PAGE_GAP = 40, DOC_PADDING = 50;
const SIDE_LABELS: Record<string, string> = { top: tr('위', 'Top'), bottom: tr('아래', 'Bottom'), left: tr('왼쪽', 'Left'), right: tr('오른쪽', 'Right') };
const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64, 72, 96];

// ── 글씨 크기 박스 — [ − 23 ▾ + ] 테두리 하나로 묶음 (도형 패널 글씨 크기와 같은 모양) ──
// 크기 목록 드롭다운 — 패널 밖(body)에 띄움. 패널 안에 두면 패널의 스크롤 영역에 잘리고 스크롤바가 생김
// 크기 칸 바로 아래에, 아래 공간이 모자라면 위로 펼침
function PresetList({
  anchorRef, values, current, onPick, onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  values: readonly number[];
  current: number;
  onPick: (v: number) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxH: number } | null>(null);
  useLayoutEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const want  = Math.min(200, values.length * 21 + 8);
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up    = below < want && above > below;
    const maxH  = Math.min(want, up ? above : below);
    setPos({ left: r.left, top: up ? r.top - 2 - maxH : r.bottom + 2, width: r.width, maxH });
  }, [anchorRef, values.length]);
  if (!pos) return null;
  return createPortal(
    <>
      <div className="fixed inset-0" style={{ zIndex: 1000 }} onMouseDown={onClose} />
      <div
        className="fixed bg-[var(--ui-surface)] border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-md shadow-xl py-1 overflow-y-auto"
        style={{ zIndex: 1001, left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}
      >
        {values.map(v => (
          <button
            key={v}
            onMouseDown={e => { e.preventDefault(); onPick(v); onClose(); }}
            className={`w-full text-left px-3 py-0.5 text-[12px] hover:bg-[rgba(var(--ui-fg-rgb),0.08)] ${current === v ? 'text-indigo-400' : 'text-[rgba(var(--ui-fg-rgb),0.8)]'}`}
          >{v}</button>
        ))}
      </div>
    </>,
    document.body,
  );
}

function FontSizeBox({
  value, onChange, min = 6, max = 96,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const [raw, setRaw] = useState(String(value));
  const [showPresets, setShowPresets] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => setRaw(String(value)), [value]);
  const commit = (n: number) => {
    if (isNaN(n)) { setRaw(String(value)); return; }
    onChange(Math.max(min, Math.min(max, Math.round(n))));
  };

  return (
    <div ref={boxRef} className="relative flex items-center h-7 w-[92px] border border-[rgba(var(--ui-fg-rgb),0.1)] rounded-lg focus-within:border-indigo-300/60">
      <button
        className="w-5 h-full flex items-center justify-center text-[13px] text-[rgba(var(--ui-fg-rgb),0.6)] hover:text-[rgb(var(--ui-fg-rgb))] shrink-0 cursor-pointer"
        onClick={() => commit(value - 1)}
        title={tr('작게', 'Smaller')}
      >−</button>
      <input
        type="number" min={min} max={max} value={raw}
        onChange={e => setRaw(e.target.value)}
        onBlur={e => commit(Number(e.target.value))}
        onKeyDown={e => e.key === 'Enter' && commit(Number(raw))}
        className="flex-1 min-w-0 w-0 h-full text-center text-[12px] font-semibold bg-transparent border-none text-[rgb(var(--ui-fg-rgb))] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button
        tabIndex={-1}
        onClick={() => setShowPresets(v => !v)}
        className={`h-full w-4 flex items-center justify-center shrink-0 cursor-pointer ${showPresets ? 'text-[rgb(var(--ui-fg-rgb))]' : 'text-[rgba(var(--ui-fg-rgb),0.42)] hover:text-[rgb(var(--ui-fg-rgb))]'}`}
        title={tr('크기 목록', 'Size list')}
      >
        <svg width="7" height="4" viewBox="0 0 7 4"><path d="M0 0L3.5 4L7 0" fill="currentColor"/></svg>
      </button>
      <button
        className="w-5 h-full flex items-center justify-center text-[13px] text-[rgba(var(--ui-fg-rgb),0.6)] hover:text-[rgb(var(--ui-fg-rgb))] shrink-0 cursor-pointer"
        onClick={() => commit(value + 1)}
        title={tr('크게', 'Larger')}
      >+</button>
      {showPresets && (
        <PresetList
          anchorRef={boxRef}
          values={FONT_SIZE_PRESETS.filter(s => s >= min && s <= max)}
          current={value}
          onPick={commit}
          onClose={() => setShowPresets(false)}
        />
      )}
    </div>
  );
}
const _DOC_A4_W = 794, _DOC_A4_H = 1123, _DOC_PAGE_GAP = 40, _DOC_PADDING = 50;

// ── DocContainerPanel ─────────────────────────────────────────
type DragProps = { onHeaderMouseDown?: (e: React.MouseEvent) => void; dragging?: boolean; onClose?: () => void };

function DocContainerPanel({ node, onHeaderMouseDown, dragging, onClose }: { node: AppNode } & DragProps) {
  const { setNodes } = useReactFlow<AppNode>();
  const d = node.data;

  const currentBg = (d.docPageBg as string | undefined) ?? '#ffffff';
  const currentFontSize = (d.docFontSize as number | undefined) ?? 11;

  const updateData = (patch: Record<string, unknown>) =>
    setNodes(nds => (nds as AppNode[]).map(n => n.id === node.id ? { ...n, data: { ...n.data, ...patch } } : n));

  return (
    <PanelShell title={tr('문서 컨테이너', 'Document container')} onHeaderMouseDown={onHeaderMouseDown} dragging={dragging} onClose={onClose}>
      <Section title={tr('배경색', 'Background')}>
        <div className="flex gap-1.5 flex-wrap">
          {BG_PRESETS.map(({ color, label }) => (
            <button key={color}
              className={`w-6 h-6 rounded-md border-2 cursor-pointer transition-transform flex-shrink-0 hover:scale-[1.15] ${currentBg === color ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-[rgba(var(--ui-fg-rgb),0.18)]'}`}
              style={{ background: color }} title={label}
              onClick={() => updateData({ docPageBg: color })}
            />
          ))}
        </div>
      </Section>

    </PanelShell>
  );
}

// ── DocPagePanel ──────────────────────────────────────────────
const BG_PRESETS = [
  { color: '#ffffff', label: tr('흰색', 'White') }, { color: '#fffef5', label: tr('크림', 'Cream') },
  { color: '#fefce8', label: tr('노랑', 'Yellow') }, { color: '#eff6ff', label: tr('파랑', 'Blue') },
  { color: '#f0fdf4', label: tr('초록', 'Green') }, { color: '#f9fafb', label: tr('회색', 'Gray') },
];

function DocPagePanel({ node, onHeaderMouseDown, dragging, onClose }: { node: AppNode; onClose?: () => void } & DragProps) {
  const { setNodes, deleteElements } = useReactFlow<AppNode>();
  const selectionPt = useDocSelectionPt(node.id);
  const selectionFont = useDocSelectionFont(node.id);
  const currentFont = ((node.data.docFontFamily as DocFontKey | undefined) ?? DEFAULT_DOC_FONT);
  const allNodes = useStore(s => s.nodes as AppNode[]);
  const d = node.data;

  const margins = {
    top:    (d.docMarginTop    as number | undefined) ?? 5,
    bottom: (d.docMarginBottom as number | undefined) ?? 5,
    left:   (d.docMarginLeft   as number | undefined) ?? 10,
    right:  (d.docMarginRight  as number | undefined) ?? 10,
  };

  const currentBg = (d.docPageBg as string | undefined) ?? '#ffffff';
  const currentFontSize = (d.docFontSize as number | undefined) ?? 11;

  const updateData = (patch: Record<string, unknown>) =>
    setNodes(nds => (nds as AppNode[]).map(n => n.id === node.id ? { ...n, data: { ...n.data, ...patch } } : n));


  const handleCopy = () => {
    const parentId = node.parentId;
    if (!parentId) return;
    const ts = Date.now();
    const siblings = allNodes.filter(n => n.parentId === parentId && n.data?.isDocPage);
    const row = (d.docRow as number | undefined) ?? 0;
    const maxColInRow = Math.max(...siblings.filter(s => ((s.data.docRow as number | undefined) ?? 0) === row).map(s => (s.data.docCol as number | undefined) ?? 0));
    const newCol = maxColInRow + 1;
    const newPage: AppNode = {
      id: `doc-page-${ts}`, type: 'custom',
      position: { x: DOC_PADDING + newCol * (DOC_A4_W + DOC_PAGE_GAP), y: DOC_PADDING + row * (DOC_A4_H + DOC_PAGE_GAP) },
      width: DOC_A4_W, height: DOC_A4_H, zIndex: 0, parentId,
      data: { ...d, docRow: row, docCol: newCol, docPageText: '', docPageHtml: '' },
    };
    setNodes(prev => {
      const prevArr = prev as AppNode[];
      const allPlusNew = [...prevArr.filter(n => n.parentId === parentId && n.data?.isDocPage), newPage];
      const maxRow = Math.max(...allPlusNew.map(n => (n.data.docRow as number | undefined) ?? 0));
      const colsArr: number[] = Array(maxRow + 1).fill(0);
      allPlusNew.forEach(n => { const r = (n.data.docRow as number | undefined) ?? 0; const c = (n.data.docCol as number | undefined) ?? 0; colsArr[r] = Math.max(colsArr[r], c + 1); });
      const maxC = Math.max(...colsArr);
      const newW = DOC_PADDING * 2 + maxC * DOC_A4_W + (maxC - 1) * DOC_PAGE_GAP;
      const newH = DOC_PADDING * 2 + colsArr.length * DOC_A4_H + (colsArr.length - 1) * DOC_PAGE_GAP;
      const updated = prevArr.map(n => n.id === parentId ? { ...n, width: newW, height: newH, zIndex: -Math.ceil(newW * newH / 100), data: { ...n.data, width: newW, height: newH, docColsPerRow: colsArr } } : n);
      const withNew = [...updated, newPage];
      return [...withNew.filter(n => n.data.shape === 'frame'), ...withNew.filter(n => n.data.shape !== 'frame')];
    });
  };

  const currentBgOpacity = (d.docPageBgOpacity as number | undefined) ?? 100;

  return (
    <PanelShell title={tr('문서 페이지', 'Document page')} onHeaderMouseDown={onHeaderMouseDown} dragging={dragging} onClose={onClose}>
      <Section title={tr('배경색', 'Background')} collapsible={false}>
        <div className="flex gap-1.5 flex-wrap">
          {BG_PRESETS.map(({ color, label }) => (
            <button key={color}
              className={`w-6 h-6 rounded-md border-2 cursor-pointer transition-transform flex-shrink-0 hover:scale-[1.15] ${currentBg === color ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-[rgba(var(--ui-fg-rgb),0.18)]'}`}
              style={{ background: color }} title={label}
              onClick={() => updateData({ docPageBg: color })}
            />
          ))}
        </div>
      </Section>

      {/* 글씨 — 색상 · 크기 · 정렬 */}
      <Section title={tr('글씨', 'Text')} collapsible={false}>
        {/* 글꼴 + 크기 한 줄 (워드처럼) — 글 쓰는 중이면 고른 글자(또는 이어 쓸 글자)만 바뀜
            글꼴은 상업적 사용 가능한 무료 글꼴만 */}
        <div className="flex items-center gap-1.5">
          <select
            title={tr('글꼴', 'Font')}
            value={selectionFont ?? currentFont}
            onChange={e => {
              const key = e.target.value as DocFontKey;
              if (!applyDocSelectionFont(node.id, key)) updateData({ docFontFamily: key });
            }}
            className="flex-1 min-w-0 h-6 px-1.5 text-[12px] bg-[rgba(var(--ui-fg-rgb),0.06)] border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-md text-[rgb(var(--ui-fg-rgb))] cursor-pointer focus:outline-none focus:border-indigo-500"
            style={{ fontFamily: docFontCss(selectionFont ?? currentFont) }}
          >
            {DOC_FONTS.map(f => (
              <option key={f.key} value={f.key} style={{ fontFamily: f.css }}>{f.label}</option>
            ))}
          </select>
          {/* 크기 — 글 쓰는 중이면 커서 자리 글자 크기를 보여 줌 */}
          <div title={tr('글자 크기 (pt)', 'Font size (pt)')}>
            <Stepper
              value={selectionPt ?? currentFontSize}
              onChange={v => { if (!applyDocSelectionSize(node.id, v)) updateData({ docFontSize: v }); }}
              min={6} max={96} suffix="pt"
            />
          </div>
        </div>
        <ColorSwatch
          label={tr('색상', 'Color')}
          value={(d.docTextColor as string | undefined) ?? '#1a1a1a'}
          // 글자를 골라 둔 상태면 그 글자만, 아니면 페이지 전체 글씨 색
          onChange={c => { if (!applyDocSelectionColor(node.id, c)) updateData({ docTextColor: c }); }}
          quickColors={DOC_TEXT_QUICK}
        />
        <div className="flex flex-col gap-1.5 mt-1">
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.5)]">{tr('정렬', 'Align')}</span>
          <Segmented
            value={(d.docTextAlign as 'left' | 'center' | 'right' | 'justify' | undefined) ?? 'left'}
            onChange={v => updateData({ docTextAlign: v })}
            options={[
              { value: 'left',    title: tr('왼쪽 정렬', 'Align left'),   label: <AlignLeft size={13} strokeWidth={1.8} /> },
              { value: 'center',  title: tr('가운데 정렬', 'Align center'), label: <AlignCenter size={13} strokeWidth={1.8} /> },
              { value: 'right',   title: tr('오른쪽 정렬', 'Align right'), label: <AlignRight size={13} strokeWidth={1.8} /> },
              { value: 'justify', title: tr('양쪽 정렬', 'Justify'),   label: <AlignJustify size={13} strokeWidth={1.8} /> },
            ] as const}
          />
        </div>
      </Section>

      <Section title={tr('쪽 여백 (mm)', 'Page margins (mm)')} defaultOpen={false}>
        {(['top', 'bottom', 'left', 'right'] as const).map(side => (
          <div key={side} className="flex items-center justify-between">
            <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.5)]">{SIDE_LABELS[side]}</span>
            <Stepper
              value={margins[side]}
              onChange={v => updateData({ [`docMargin${side.charAt(0).toUpperCase()}${side.slice(1)}`]: v })}
              min={0}
              max={80}
            />
          </div>
        ))}
        <button
          className={`w-full h-7 mt-1 text-[12px] ${BTN_BASE} ${BTN_IDLE}`}
          onClick={() => updateData({ docMarginTop: 0, docMarginBottom: 0, docMarginLeft: 0, docMarginRight: 0 })}
        >
          {tr('쪽 여백 없애기', 'Remove page margins')}
        </button>
      </Section>

      <Section title={tr('액션', 'Actions')} defaultOpen={true}>
        <div className="flex gap-1.5">
          <button className={`flex-1 h-8 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} onClick={handleCopy} title={tr('페이지 복사', 'Copy page')}>
            <Copy size={13} strokeWidth={1.8} className="mr-1" /> {tr('복사', 'Copy')}
          </button>
          <button className={`w-9 h-8 ${BTN_BASE} ${BTN_IDLE} hover:bg-red-950 hover:border-red-500 hover:text-red-500`}
            onClick={() => deleteElements({ nodes: [{ id: node.id }] })} title={tr('삭제', 'Delete')}>
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        </div>
      </Section>
    </PanelShell>
  );
}

// ── 엣지 패널 ─────────────────────────────────────────────────
const ARROW_OPTIONS: { value: ArrowType; label: string; icon: React.ReactNode }[] = [
  { value: 'none', label: tr('없음', 'None'), icon: <svg width="28" height="12" viewBox="0 0 28 12"><line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg> },
  { value: 'start', label: tr('왼쪽', 'Left'), icon: <svg width="28" height="12" viewBox="0 0 28 12"><line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><polyline points="8,2 2,6 8,10" stroke="currentColor" strokeWidth="1.8" fill="currentColor" strokeLinejoin="round"/></svg> },
  { value: 'end', label: tr('오른쪽', 'Right'), icon: <svg width="28" height="12" viewBox="0 0 28 12"><line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><polyline points="20,2 26,6 20,10" stroke="currentColor" strokeWidth="1.8" fill="currentColor" strokeLinejoin="round"/></svg> },
  { value: 'both', label: tr('양방향', 'Both'), icon: <svg width="28" height="12" viewBox="0 0 28 12"><line x1="2" y1="6" x2="26" y2="6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><polyline points="8,2 2,6 8,10" stroke="currentColor" strokeWidth="1.8" fill="currentColor" strokeLinejoin="round"/><polyline points="20,2 26,6 20,10" stroke="currentColor" strokeWidth="1.8" fill="currentColor" strokeLinejoin="round"/></svg> },
];
const LINE_TYPE_OPTIONS = [
  { value: 'step',      label: tr('꺾는선', 'Elbow'),   icon: <svg width="36" height="16" viewBox="0 0 36 16"><polyline points="2,14 18,14 18,2 34,2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  { value: 'curve',     label: tr('곡선', 'Curve'),    icon: <svg width="36" height="16" viewBox="0 0 36 16"><path d="M2 13 C10 13 26 3 34 3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round"/></svg> },
  { value: 'elbow',     label: tr('두번꺾임', 'Double elbow'), icon: <svg width="36" height="16" viewBox="0 0 36 16"><polyline points="2,13 18,13 18,3 34,3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg> },
] as const;

// labelMode: 캔버스에서 라벨 박스를 눌러 고른 경우 → 라벨 설정만, 선을 눌렀으면 선 설정
function EdgePanel({ edge, labelMode, onHeaderMouseDown, dragging, onClose }: { edge: AppEdge; labelMode?: boolean } & DragProps) {
  const { setEdges, deleteElements } = useReactFlow();
  const arrowType: ArrowType = (edge.data?.arrowType as ArrowType) ?? 'end';
  const strokeColor = edge.data?.strokeColor ?? '#94a3b8';
  // 선 종류 — 라벨 선(labeled)은 data.lineShape로 곡선/꺾는선을 나눔, 기본 선은 type 자체로
  const lineType = edge.type === 'elbow' ? 'elbow'
    : (edge.data?.lineShape === 'curve' || edge.type === 'default' || edge.type === 'smoothstep' || edge.type === 'simplebezier') ? 'curve'
    : 'step';

  const patchEdge = (patch: Partial<AppEdge>) =>
    setEdges(eds => eds.map(e => e.id === edge.id ? { ...e, ...patch } : e));
  // 라벨 꾸미기는 data 안에 — 다른 data 값은 그대로 두고 덮어씀
  const patchLabel = (patch: Partial<NonNullable<AppEdge['data']>>) =>
    setEdges(eds => eds.map(e => e.id === edge.id ? { ...e, data: { ...(e.data ?? {}), ...patch } } : e));
  // 라벨 기본색 — globals.css의 --edge-label-* 와 같은 값 (색 칸 선택 표시용)
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark-mode');
  const labelDefaults = dark
    ? { bg: '#111113', border: 'transparent', ink: '#a8a8b2' }
    : { bg: '#f4f4f1', border: 'transparent', ink: '#5c5c58' };
  // 라벨 박스가 그려지는 선 종류 (Canvas의 LabeledEdge·ElbowEdge)
  const hasLabelBox = edge.type === 'labeled' || edge.type === 'elbow';

  const handleColor = (color: string) => {
    const marker = { type: MarkerType.ArrowClosed, color };
    patchEdge({ style: { ...(edge.style ?? {}), stroke: color }, data: { ...edge.data, strokeColor: color },
      markerEnd: (arrowType === 'end' || arrowType === 'both') ? marker : undefined,
      markerStart: (arrowType === 'start' || arrowType === 'both') ? marker : undefined });
  };

  const handleArrow = (type: ArrowType) => {
    const marker = { type: MarkerType.ArrowClosed, color: strokeColor };
    patchEdge({ data: { ...edge.data, arrowType: type },
      markerEnd: (type === 'end' || type === 'both') ? marker : undefined,
      markerStart: (type === 'start' || type === 'both') ? marker : undefined });
  };

  const currentStrokeWidth = (() => { const sw = (edge.style as Record<string, unknown>)?.strokeWidth; return sw === 2 || sw === '2' ? 2 : sw === 3 || sw === '3' ? 3 : 1; })();
  const currentStrokeStyle = (() => { const da = (edge.style as Record<string, unknown>)?.strokeDasharray as string | undefined; if (!da) return 'solid'; if (da.startsWith('1')) return 'dotted'; return 'dashed'; })();

  // 라벨 선은 라벨 박스를 지키려고 type을 labeled/elbow로 두고 모양만 바꿈, 기본 선은 React Flow 기본 type으로
  const handleLineType = (v: 'step' | 'curve' | 'elbow') => {
    if (v === 'elbow') return patchEdge({ type: 'elbow', data: { ...edge.data, lineShape: undefined } });
    if (hasLabelBox) return patchEdge({ type: 'labeled', data: { ...edge.data, lineShape: v === 'curve' ? 'curve' : undefined } });
    patchEdge({ type: v === 'curve' ? 'default' : 'step' });
  };

  const handleStrokeWidth = (w: number) => patchEdge({ style: { ...(edge.style ?? {}), strokeWidth: w } });
  const handleStrokeStyle = (s: 'solid' | 'dashed' | 'dotted') => {
    const da = s === 'dashed' ? '5 4' : s === 'dotted' ? '1 4' : undefined;
    patchEdge({ style: { ...(edge.style ?? {}), strokeDasharray: da } });
  };

  const labelInput = (
    <input
      value={(edge.label as string | undefined) ?? ''}
      onChange={(e) => patchEdge({ label: e.target.value })}
      placeholder={tr('라벨 텍스트 입력...', 'Enter label text...')}
      style={{
        width: '100%', background: 'rgba(var(--ui-fg-rgb),0.06)',
        border: '1px solid rgba(var(--ui-fg-rgb),0.12)', borderRadius: 6,
        color: 'rgb(var(--ui-fg-rgb))', fontSize: 12, padding: '5px 8px', outline: 'none',
        boxSizing: 'border-box',
      }}
      onFocus={(e) => { e.currentTarget.style.borderColor = 'rgba(var(--ui-fg-rgb),0.3)'; }}
      onBlur={(e) => { e.currentTarget.style.borderColor = 'rgba(var(--ui-fg-rgb),0.12)'; }}
    />
  );

  if (labelMode && hasLabelBox) {
    return (
      <PanelShell title={tr('라벨', 'Label')} onHeaderMouseDown={onHeaderMouseDown} dragging={dragging} onClose={onClose}>
        <Section title={tr('라벨', 'Label')}>
          {labelInput}
          <ColorSwatch label={tr('배경 색상', 'Background color')} value={edge.data?.labelBgColor ?? labelDefaults.bg}
            onChange={c => patchLabel({ labelBgColor: c })}
            quickColors={PASTEL_QUICK} />
          <ColorSwatch label={tr('윤곽선 색상', 'Border color')} value={edge.data?.labelBorderColor ?? labelDefaults.border}
            onChange={c => patchLabel({ labelBorderColor: c })}
            quickColors={BORDER_QUICK} />
          <ColorSwatch label={tr('글씨 색상', 'Text color')} value={edge.data?.labelColor ?? labelDefaults.ink}
            onChange={c => patchLabel({ labelColor: c === 'transparent' ? undefined : c })}
            quickColors={TEXT_QUICK} />
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.5)]">{tr('글씨 크기', 'Font size')}</span>
            <FontSizeBox value={edge.data?.labelFontSize ?? 11} onChange={v => patchLabel({ labelFontSize: v })} min={6} max={48} />
          </div>
        </Section>
      </PanelShell>
    );
  }

  return (
    <PanelShell title={tr('연결선', 'Connector')} onHeaderMouseDown={onHeaderMouseDown} dragging={dragging} onClose={onClose}>
      {hasLabelBox && (
        <Section title={tr('라벨', 'Label')}>
          {labelInput}
        </Section>
      )}
      <Section title={tr('색상', 'Color')}>
        <ColorSwatch label={tr('선 색상', 'Line color')} value={strokeColor} onChange={handleColor}
          quickColors={['#111827', ...RAINBOW_QUICK.slice(0, 6)]} />
      </Section>
      <Section title={tr('화살표', 'Arrow')}>
        <div className="grid grid-cols-4 gap-1">
          {ARROW_OPTIONS.map(({ value, label, icon }) => (
            <button key={value} className={`h-8 ${BTN_BASE} ${arrowType === value ? BTN_ON : BTN_IDLE}`} title={label} onClick={() => handleArrow(value)}>{icon}</button>
          ))}
        </div>
      </Section>
      <Section title={tr('두께', 'Thickness')}>
        <div className="flex gap-1.5">
          {[1, 2, 3].map((w, i) => (
            <button key={w} className={`flex-1 h-8 ${BTN_BASE} ${currentStrokeWidth === w ? BTN_ON : BTN_IDLE}`} onClick={() => handleStrokeWidth(w)}>
              <svg width="24" height="10" viewBox="0 0 24 10"><line x1="2" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth={i + 1} strokeLinecap="round"/></svg>
            </button>
          ))}
        </div>
      </Section>
      <Section title={tr('스타일', 'Style')}>
        <div className="flex gap-1.5">
          {(['solid', 'dashed', 'dotted'] as const).map(s => (
            <button key={s} className={`flex-1 h-8 ${BTN_BASE} ${currentStrokeStyle === s ? BTN_ON : BTN_IDLE}`} onClick={() => handleStrokeStyle(s)}>
              <svg width="24" height="10" viewBox="0 0 24 10"><line x1="2" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={s === 'dashed' ? '5 3' : s === 'dotted' ? '1 3' : undefined} strokeLinecap="round"/></svg>
            </button>
          ))}
        </div>
      </Section>
      <Section title={tr('선 종류', 'Line type')}>
        <div className="flex gap-1.5">
          {LINE_TYPE_OPTIONS.map(({ value, label, icon }) => (
            <button key={value} className={`flex-1 h-8 ${BTN_BASE} ${lineType === value ? BTN_ON : BTN_IDLE}`} title={label} onClick={() => handleLineType(value)}>{icon}</button>
          ))}
        </div>
      </Section>
      <Section title={tr('액션', 'Actions')} defaultOpen={true}>
        <button className={`w-9 h-8 ${BTN_BASE} ${BTN_IDLE} hover:bg-red-950 hover:border-red-500 hover:text-red-500`}
          onClick={() => deleteElements({ edges: [{ id: edge.id }] })} title={tr('삭제', 'Delete')}>
          <Trash2 size={14} strokeWidth={1.8} />
        </button>
      </Section>
    </PanelShell>
  );
}

// ── 다중 선택 패널 ────────────────────────────────────────────
function MultiNodePanel({ nodes, onHeaderMouseDown, dragging }: { nodes: AppNode[] } & DragProps) {
  const { setNodes } = useReactFlow<AppNode>();

  const bringToFront = () =>
    setNodes(nds => {
      const ids = new Set(nodes.map(n => n.id));
      const maxZ = Math.max(0, ...nds.filter(n => !ids.has(n.id)).map(n => n.zIndex ?? 0));
      const sorted = [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      const zMap = new Map(sorted.map((n, i) => [n.id, maxZ + i + 1]));
      return nds.map(n => ids.has(n.id) ? { ...n, zIndex: zMap.get(n.id)! } : n);
    });

  const sendToBack = () =>
    setNodes(nds => {
      const ids = new Set(nodes.map(n => n.id));
      const minZ = Math.min(0, ...nds.filter(n => !ids.has(n.id)).map(n => n.zIndex ?? 0));
      const sorted = [...nodes].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0));
      const zMap = new Map(sorted.map((n, i) => [n.id, minZ - sorted.length + i]));
      return nds.map(n => ids.has(n.id) ? { ...n, zIndex: zMap.get(n.id)! } : n);
    });

  // 묶음 — 고른 것이 전부 한 묶음이면 "풀기", 아니면 "묶기" (utils/group.ts · Ctrl+G / Ctrl+Shift+G)
  const ids = new Set(nodes.map(n => n.id));
  const gids = new Set(nodes.map(groupIdOf));
  const oneGroup = gids.size === 1 && !gids.has(undefined);
  const hasGroup = [...gids].some(Boolean);

  return (
    <PanelShell title={oneGroup ? tr(`묶음 · ${nodes.length}개`, `Group · ${nodes.length}`) : tr(`${nodes.length}개 선택됨`, `${nodes.length} selected`)} onHeaderMouseDown={onHeaderMouseDown} dragging={dragging}>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex gap-2">
          <button className={`flex-1 h-7 ${BTN_BASE} ${BTN_IDLE}`} onClick={bringToFront} title={tr('앞으로 가져오기', 'Bring forward')}>
            <ArrowUpToLine size={13} strokeWidth={1.8} />
          </button>
          <button className={`flex-1 h-7 ${BTN_BASE} ${BTN_IDLE}`} onClick={sendToBack} title={tr('뒤로 보내기', 'Send backward')}>
            <ArrowDownToLine size={13} strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex gap-2">
          {!oneGroup && (
            <button className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} title={tr('한 덩어리로 묶기 (Ctrl+G)', 'Group (Ctrl+G)')}
              onClick={() => setNodes(nds => groupNodes(nds, ids))}>
              {tr('묶기', 'Group')}
            </button>
          )}
          {hasGroup && (
            <button className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} title={tr('묶음 풀기 (Ctrl+Shift+G)', 'Ungroup (Ctrl+Shift+G)')}
              onClick={() => setNodes(nds => ungroupNodes(nds, ids))}>
              {tr('묶음 풀기', 'Ungroup')}
            </button>
          )}
        </div>
        {oneGroup && (
          <span className="text-[12px] leading-relaxed text-[rgba(var(--ui-fg-rgb),0.45)]">
            {tr('더블클릭하면 안의 요소 하나만 골라 고칠 수 있습니다.', 'Double-click to select and edit a single element inside.')}
          </span>
        )}
      </div>
    </PanelShell>
  );
}

// ── 노드 패널 ─────────────────────────────────────────────────
function NodePanel({ node, onHeaderMouseDown, dragging, onClose }: { node: AppNode } & DragProps) {
  const { setNodes, getNodes, deleteElements } = useReactFlow<AppNode>();
  const d  = node.data;
  const id = node.id;
  const isText = d.shape === 'text';
  const isCode = d.shape === 'code';
  const isMockup = d.shape === 'mockup';
  const isEntity = d.shape === 'entity';
  // 와이어프레임 이미지 칸 — 도형 패널 대신 사진에 필요한 것만 (이미지 · 모양)
  const isSlot = isImageSlot(d);
  const slotFileRef = useRef<HTMLInputElement>(null);
  const [slotUploading, setSlotUploading] = useState(false);
  const putSlotImage = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setSlotUploading(true);
    try {
      const img = await prepareCanvasImage(file);
      update({ imageUrl: img.src, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined });
    } catch (err) {
      console.error(err);
      alert(tr('이미지를 업로드하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'Could not upload the image. Please try again in a moment.'));
    } finally {
      setSlotUploading(false);
    }
  };
  // 글씨를 쓸 수 있는 일반 도형 — 글꼴만 고를 수 있음 (아이콘 도형 제외)
  const isTextShape = ['rectangle', 'circle', 'diamond', 'hexagon'].includes(d.shape) && !d.icon;
  // 아이콘 카드 — 이름을 누르면 텍스트 패널 (글씨 크기는 도형처럼 px로 저장)
  const isCard = d.shape === 'card';
  const usesPxFont = isTextShape || isCard;
  // 도형·글상자를 선택하면 원래 패널, 더블클릭해 글씨를 편집하는 동안엔 텍스트 패널(글씨 색·글꼴·크기·굵게·기울임)
  const textEditMode = useCanvasStore(s => s.editingTextNodeId === id) && (isTextShape || isText || isCard);
  // 카드 아이콘을 누른 동안엔 아이콘 패널(색·크기)
  const iconEditMode = useCanvasStore(s => s.editingIconNodeId === id) && isCard;
  const setLastFontFamily = useCanvasStore(s => s.setLastFontFamily);

  // 글꼴 선택 — 고른 글꼴은 기억해서 다음에 만드는 글상자·도형에도 적용
  const fontPicker = (
    <Segmented
      value={(d.fontFamily as string | undefined) ?? 'normal'}
      onChange={v => {
        const font = v as NonNullable<AppNode['data']['fontFamily']>;
        update({ fontFamily: font });
        setLastFontFamily(font);
      }}
      options={[
        { value: 'normal',      title: tr('일반', 'Normal'),   label: <span style={{ fontFamily: "'Apple SD Gothic Neo','Pretendard','Segoe UI',sans-serif", fontSize: 13, fontWeight: 600 }}>A</span> },
        { value: 'handwriting', title: tr('손글씨', 'Handwriting'), label: <Pencil size={12} strokeWidth={1.8} /> },
        { value: 'mono',        title: tr('코드', 'Code'),   label: <Code size={13} strokeWidth={1.8} /> },
        { value: 'serif',       title: tr('세리프', 'Serif'), label: <span style={{ fontFamily: "'Georgia','Times New Roman',serif", fontSize: 13, fontWeight: 600, fontStyle: 'italic' }}>A</span> },
      ]}
    />
  );

  const update = useCallback((patch: Partial<AppNode['data']>) =>
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)),
  [id, setNodes]);

  // 목업·이미지 칸의 사진을 옆에 사진 노드로 꺼냄 (칸은 비워짐) — 사진은 원래 비율 그대로
  //   목업: 목업 바로 오른쪽 / 이미지 칸: 칸이 든 화면(맨 바깥 프레임) 오른쪽 — 화면 안 다른 요소와 겹치지 않게
  const ejectMockupImage = () => {
    const url = d.imageUrl;
    if (!url) return;
    const place = (nw: number, nh: number) => setNodes(nds => {
      const me = nds.find(n => n.id === id);
      if (!me) return nds;
      const mw = (me.data.width as number | undefined) ?? me.width ?? 260;
      const mh = (me.data.height as number | undefined) ?? me.height ?? 539;
      const box = isMockup ? Math.max(mw, mh) * 0.7 : Math.max(mw, mh, 240);   // 목업 긴 변의 70% · 이미지 칸은 칸 크기(최소 240)
      const s = Math.min(box / nw, box / nh);
      const w = Math.round(nw * s);
      const h = Math.round(nh * s);
      let parentId = me.parentId;
      let position = { x: me.position.x + mw + 24, y: me.position.y + (mh - h) / 2 };
      if (!isMockup && me.parentId) {
        // 칸의 캔버스 위치와 맨 바깥 프레임 찾기
        let ax = me.position.x, ay = me.position.y;
        let root: AppNode | undefined = nds.find(n => n.id === me.parentId);
        let top = root;
        for (let guard = 0; root && guard < 50; guard++) {
          ax += root.position.x; ay += root.position.y;
          top = root;
          root = root.parentId ? nds.find(n => n.id === root!.parentId) : undefined;
        }
        if (top) {
          let tx = top.position.x;
          for (let p = top.parentId ? nds.find(n => n.id === top!.parentId) : undefined, g = 0; p && g < 50; g++) {
            tx += p.position.x;
            p = p.parentId ? nds.find(n => n.id === p!.parentId) : undefined;
          }
          const tw = (top.data.width as number | undefined) ?? top.width ?? 400;
          parentId = undefined;
          position = { x: tx + tw + 24, y: ay + (mh - h) / 2 };
        }
      }
      const photo: AppNode = {
        id: `node-${Date.now()}`, type: 'custom', parentId,
        position,
        width: w, height: h, zIndex: 0, selected: true,
        data: { title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'image', width: w, height: h, imageUrl: url },
      };
      return [
        ...nds.map(n => n.id === id
          ? { ...n, selected: false, data: { ...n.data, imageUrl: undefined, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined } }
          : n),
        photo,
      ];
    });
    const img = new Image();
    img.onload  = () => place(img.naturalWidth || 3, img.naturalHeight || 2);
    img.onerror = () => place(3, 2);
    img.src = url;
  };

  // 코드 블록: 글자 크기를 바꾸면 줄 높이가 달라지므로 상자 높이도 함께 갱신
  const updateCode = (patch: Partial<AppNode['data']>) =>
    setNodes(nds => nds.map(n => {
      if (n.id !== id) return n;
      const data = { ...n.data, ...patch };
      const h = codeBoxHeight(data);
      return { ...n, height: h, data: { ...data, height: h } };
    }));

  // 텍스트 폰트 크기 — 글상자는 높이 비율(fontScale), 도형 안 글씨는 px(fontSize, 기본 14)로 저장
  // 글상자는 data.height로 그려짐(Node 컴포넌트) — node.height는 크기 조절·되돌리기 뒤 어긋날 수 있어 data 먼저
  const nodeH = (d.height as number | undefined) ?? node.height ?? 60;
  // 카드는 안 골랐으면 카드 크기에 맞춘 기본 크기 (Node의 cardLabelFontPx와 같은 값)
  const defaultPx = isCard
    ? cardLabelFontPx((d.width as number | undefined) ?? 100, (d.height as number | undefined) ?? 90)
    : 14;
  const currentPt = usesPxFont
    ? Math.round(((d.fontSize as number | undefined) ?? defaultPx) * 0.75)
    : Math.round(nodeH * (d.fontScale ?? 0.27) * 0.75);
  const [fontInputVal, setFontInputVal] = useState(String(currentPt));
  const [showPresets, setShowPresets] = useState(false);
  const fontBoxRef = useRef<HTMLDivElement>(null);   // 글씨 크기 칸 — 크기 목록을 이 아래에 띄움
  const cellBoxRef = useRef<HTMLDivElement>(null);   // 표 칸 글씨 크기 칸
  const [showCellColorPicker, setShowCellColorPicker] = useState(false);
  const [showCellSizePresets, setShowCellSizePresets] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  useEffect(() => { setFontInputVal(String(currentPt)); }, [currentPt]);
  const changeFontSize = (pt: number) => {
    const clamped = Math.max(6, Math.min(300, Math.round(pt)));
    update(usesPxFont ? { fontSize: Math.round(clamped * (4 / 3)) } : { fontScale: (clamped * (4 / 3)) / nodeH });
    setFontInputVal(String(clamped));
  };

  // 레이어 조작
  const bringToFront = () =>
    setNodes(nds => {
      const maxZ = Math.max(0, ...nds.filter(n => n.id !== id).map(n => n.zIndex ?? 0));
      return nds.map(n => n.id === id ? { ...n, zIndex: maxZ + 1, data: { ...n.data } } : n);
    });
  const sendToBack = () =>
    setNodes(nds => {
      const minZ = Math.min(0, ...nds.filter(n => n.id !== id).map(n => n.zIndex ?? 0));
      return nds.map(n => n.id === id ? { ...n, zIndex: minZ - 1, data: { ...n.data } } : n);
    });

  // 복사 — Ctrl+C와 같은 copy 이벤트를 보내서 캔버스 클립보드에 담음 (선택된 노드 = 이 노드)
  // → 캔버스에서 Ctrl+V로 붙여넣기 (프레임 안 노드·연결선까지 함께 복사됨)
  const copyNode = () => { document.execCommand('copy'); };

  // 표 전용: 병합 / 분할
  const tableSelectedCells = d.shape === 'table' ? ((d.tableSelectedCells as string[] | undefined) ?? []) : [];
  const tableCellMeta      = d.shape === 'table' ? ((d.tableCellMeta as Record<string, { colSpan?: number; rowSpan?: number }> | undefined) ?? {}) : {};
  const canMerge = tableSelectedCells.length >= 2;
  const canSplit = tableSelectedCells.length === 1 && !!(tableCellMeta[tableSelectedCells[0]]?.colSpan || tableCellMeta[tableSelectedCells[0]]?.rowSpan);
  // 표 셀 글씨 크기 입력값 (IIFE 밖에서 state 선언)
  const _cellFSizesOuter = (d.tableCellFontSizes as Record<string, number> | undefined) ?? {};
  const _firstSelOuter = tableSelectedCells[0];
  const curCellSizeOuter = _firstSelOuter ? (_cellFSizesOuter[_firstSelOuter] ?? 12) : 12;
  const [cellSizeInputVal, setCellSizeInputVal] = useState(String(curCellSizeOuter));
  useEffect(() => setCellSizeInputVal(String(curCellSizeOuter)), [curCellSizeOuter]);
  // 배경 색상: 표에서 셀 선택 시 선택 셀에만, 없으면 표 전체
  const _cellBgColors = (d.tableCellBgColors as Record<string, string> | undefined) ?? {};
  const _bgTargetsCells = d.shape === 'table' && tableSelectedCells.length > 0;
  const curBgValue = _bgTargetsCells
    ? (_cellBgColors[tableSelectedCells[0]] ?? (d.bgColor as string ?? '#242424'))
    : (d.bgColor as string ?? '#242424');
  const applyBg = (color: string) => {
    if (_bgTargetsCells) {
      const next = { ..._cellBgColors };
      tableSelectedCells.forEach(k => { next[k] = color; });
      update({ tableCellBgColors: next });
    } else {
      update({ bgColor: color });
    }
  };

  const mergeTableCells = () => {
    if (!canMerge) return;
    const positions = tableSelectedCells.map(k => k.split('-').map(Number));
    const minR = Math.min(...positions.map(([r]) => r));
    const maxR = Math.max(...positions.map(([r]) => r));
    const minC = Math.min(...positions.map(([, c]) => c));
    const maxC = Math.max(...positions.map(([, c]) => c));
    const meta: Record<string, { colSpan?: number; rowSpan?: number; hidden?: boolean }> = { ...tableCellMeta };
    meta[`${minR}-${minC}`] = { colSpan: maxC - minC + 1, rowSpan: maxR - minR + 1 };
    for (let r = minR; r <= maxR; r++)
      for (let c = minC; c <= maxC; c++)
        if (r !== minR || c !== minC) meta[`${r}-${c}`] = { hidden: true };
    update({ tableCellMeta: meta, tableSelectedCells: [] });
  };

  const splitTableCell = () => {
    if (!canSplit) return;
    const key = tableSelectedCells[0];
    const meta: Record<string, { colSpan?: number; rowSpan?: number; hidden?: boolean }> = { ...tableCellMeta };
    const [minR, minC] = key.split('-').map(Number);
    const m = meta[key] ?? {};
    const maxR = minR + ((m.rowSpan ?? 1) - 1);
    const maxC = minC + ((m.colSpan ?? 1) - 1);
    for (let r = minR; r <= maxR; r++)
      for (let c = minC; c <= maxC; c++)
        delete meta[`${r}-${c}`];
    update({ tableCellMeta: meta, tableSelectedCells: [] });
  };

  return (
    <PanelShell
      title={iconEditMode ? tr('아이콘', 'Icon') : isText || textEditMode ? tr('텍스트', 'Text') : d.shape === 'table' ? tr('표', 'Table') : d.shape === 'frame' ? tr('프레임', 'Frame') : d.shape === 'code' ? tr('코드', 'Code')
        : d.shape === 'list' ? tr('목록', 'List') : d.shape === 'callout' ? tr('콜아웃', 'Callout') : d.shape === 'page' ? tr('페이지', 'Page') : isEntity ? tr('DB 테이블', 'DB table') : isMockup ? tr(`${MOCKUP_DEVICES[mockupDevice(d)].name} 목업`, `${MOCKUP_DEVICES[mockupDevice(d)].name} mockup`) : isSlot ? tr('이미지 칸', 'Image slot') : tr('도형', 'Shape')}
      onHeaderMouseDown={onHeaderMouseDown}
      dragging={dragging}
      onClose={onClose}
    >
      {/* 섹션(그룹)끼리는 SECTION_DIV로 넉넉히 띄우고, 섹션 안은 gap-2 */}
      <div className="flex flex-col p-3">

        {/* 코드 블록 전용: 테마 · 글자 크기 · 줄 번호 (배경·윤곽선 색은 문법 색이 안 보일 수 있어 테마로 대신) */}
        {isCode && (
          <div className="flex flex-col gap-2">
            <SectionTitle>{tr('테마', 'Theme')}</SectionTitle>
            <Segmented
              value={d.codeTheme ?? 'auto'}
              onChange={v => update({ codeTheme: v })}
              options={([['auto', tr('자동', 'Auto'), 'linear-gradient(135deg,#1e1f22 50%,#f7f6f3 50%)'], ['dark', tr('어둡게', 'Dark'), '#1e1f22'], ['light', tr('밝게', 'Light'), '#f7f6f3']] as const).map(([value, label, swatch]) => ({
                value,
                title: value === 'auto' ? tr('화면 모드(밝게/어둡게)를 따라감', 'Follows app mode (light/dark)') : undefined,
                label: <><span className="w-2.5 h-2.5 rounded-sm border border-[rgba(var(--ui-fg-rgb),0.25)]" style={{ background: swatch }} />{label}</>,
              }))}
            />
            <SectionTitle>{tr('글자 크기', 'Font size')}</SectionTitle>
            <Segmented
              value={d.codeFontSize ?? 13}
              onChange={px => updateCode({ codeFontSize: px })}
              options={CODE_FONT_SIZES.map((px, i) => ({ value: px, label: [tr('작게', 'Small'), tr('보통', 'Medium'), tr('크게', 'Large')][i], style: { fontSize: 12 + i * 1.5 } }))}
            />
            <SectionTitle>{tr('줄 번호', 'Line numbers')}</SectionTitle>
            <Segmented
              value={!!d.codeLineNumbers}
              onChange={v => update({ codeLineNumbers: v })}
              options={[{ value: false, label: tr('끄기', 'Off') }, { value: true, label: tr('켜기', 'On') }]}
            />
          </div>
        )}

        {/* 카드 아이콘을 고른 동안: 아이콘 색 · 크기 (안 고르면 이름 글씨색 · 카드 크기에 맞춘 크기) */}
        {iconEditMode && (
          <div className="flex flex-col gap-2">
            <ColorSwatch
              label={tr('아이콘 색상', 'Icon color')}
              value={d.iconColor ?? 'transparent'}
              onChange={c => update({ iconColor: c === 'transparent' ? undefined : c })}
              quickColors={BORDER_QUICK}
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.5)]">{tr('아이콘 크기', 'Icon size')}</span>
              <FontSizeBox
                value={d.iconSize ?? cardIconPx((d.width as number | undefined) ?? 100, (d.height as number | undefined) ?? 90)}
                onChange={v => update({ iconSize: v })}
                min={12} max={96}
              />
            </div>
          </div>
        )}

        {/* AI가 만든 와이어프레임 화면 전용: 색 테마 — 같이 만든 화면들에 함께 적용 (디자인 입히기) */}
        {d.shape === 'frame' && typeof d.wireTheme === 'string' && !textEditMode && (
          <>
            <div className="flex flex-col gap-2">
              <SectionTitle>{tr('테마', 'Theme')}</SectionTitle>
              <div className="grid grid-cols-8 gap-1">
                {WIRE_THEME_NAMES.map(name => {
                  const t = WIRE_THEMES[name];
                  const on = d.wireTheme === name && !d.wireBrand;
                  return (
                    <button key={name} title={t.label}
                      className={`h-7 ${BTN_BASE} ${on ? BTN_ON : BTN_IDLE}`}
                      onClick={() => setNodes(nds => applyWireTheme(nds, wireBatchFrameIds(nds, id), name))}>
                      <span className="w-3.5 h-3.5 rounded-full border border-[rgba(var(--ui-fg-rgb),0.25)]"
                        style={{ background: name === 'wireframe' ? '#9ca3af' : name === 'dark' ? t.surface : t.primary }} />
                    </button>
                  );
                })}
              </div>
              <span className="text-[12px] leading-relaxed text-[rgba(var(--ui-fg-rgb),0.45)]">
                {tr('같이 만든 화면들에 함께 적용됩니다. 회색은 색 없는 와이어프레임입니다.', 'Applies to all screens made together. Gray is a colorless wireframe.')}
              </span>
            </div>
            {SECTION_DIV}
          </>
        )}

        {/* 기기 목업 전용: 방향 · 틀 색 · 화면 맞춤 · 그림자 · 화면 이미지 비우기 */}
        {isMockup && (
          <div className="flex flex-col gap-2">
            <SectionTitle>{tr('방향', 'Orientation')}</SectionTitle>
            <Segmented
              value={d.mockupOrientation === 'landscape' ? 'landscape' : 'portrait'}
              // 방향을 바꾸면 가운데를 지킨 채 가로·세로 크기를 맞바꿈
              onChange={v => setNodes(nds => nds.map(n => {
                if (n.id !== id || (n.data.mockupOrientation === 'landscape' ? 'landscape' : 'portrait') === v) return n;
                const w = (n.data.width as number | undefined) ?? n.width ?? 260;
                const h = (n.data.height as number | undefined) ?? n.height ?? 539;
                return {
                  ...n, width: h, height: w, measured: { width: h, height: w },
                  position: { x: n.position.x + (w - h) / 2, y: n.position.y + (h - w) / 2 },
                  data: { ...n.data, width: h, height: w, mockupOrientation: v },
                };
              }))}
              options={[{ value: 'portrait', label: tr('세로', 'Portrait') }, { value: 'landscape', label: tr('가로', 'Landscape') }] as const}
            />
            <SectionTitle>{tr('틀 색상', 'Frame color')}</SectionTitle>
            <Segmented
              value={mockupColorKey(d)}
              onChange={v => update({ mockupColor: v })}
              options={DEVICE_COLORS[mockupDevice(d)].map(k => ({
                value: k,
                title: MOCKUP_COLORS[k].label,
                label: <span className="w-3.5 h-3.5 rounded-full border border-[rgba(var(--ui-fg-rgb),0.25)]" style={{ background: MOCKUP_COLORS[k].base }} />,
              }))}
            />
            <SectionTitle>{tr('화면 이미지', 'Screen image')}</SectionTitle>
            <Segmented
              value={d.mockupFit === 'contain' ? 'contain' : 'cover'}
              onChange={v => update({ mockupFit: v })}
              options={[
                { value: 'cover',   label: tr('채우기', 'Fill'), title: tr('화면을 꽉 채움 (넘치는 부분은 잘림)', 'Fill the screen (overflow is cropped)') },
                { value: 'contain', label: tr('맞추기', 'Fit'), title: tr('이미지 전체가 보이게', 'Show the whole image') },
              ] as const}
            />
            {/* 비율이 안 맞는 이미지 — 확대하고 보일 부분을 옮김 */}
            {d.imageUrl && (
              <>
                <SliderRow label={tr('확대', 'Zoom')} min={100} max={300} unit="%"
                  value={(d.mockupZoom as number | undefined) ?? 100}
                  onChange={v => update({ mockupZoom: v })} />
                <SliderRow label={tr('좌우', 'Horizontal')} min={0} max={100} unit="%"
                  value={(d.mockupPosX as number | undefined) ?? 50}
                  onChange={v => update({ mockupPosX: v })} />
                <SliderRow label={tr('상하', 'Vertical')} min={0} max={100} unit="%"
                  value={(d.mockupPosY as number | undefined) ?? (d.mockupFit === 'contain' ? 50 : 0)}
                  onChange={v => update({ mockupPosY: v })} />
              </>
            )}
            <SectionTitle>{tr('그림자', 'Shadow')}</SectionTitle>
            <Segmented
              value={d.mockupShadow !== false}
              onChange={v => update({ mockupShadow: v })}
              options={[{ value: false, label: tr('끄기', 'Off') }, { value: true, label: tr('켜기', 'On') }]}
            />
            {/* 꺼내기: 화면 이미지를 목업 옆에 사진으로 다시 꺼냄 · 비우기: 그냥 지움 */}
            {d.imageUrl && (
              <div className="flex gap-1.5 mt-1">
                <button className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} title={tr('화면 이미지를 목업 옆에 사진으로 꺼냄', 'Take the screen image out next to the mockup')} onClick={ejectMockupImage}>
                  {tr('이미지 꺼내기', 'Take image out')}
                </button>
                <button className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} title={tr('화면 이미지를 지움', 'Clear the screen image')} onClick={() => update({ imageUrl: undefined })}>
                  {tr('비우기', 'Clear')}
                </button>
              </div>
            )}
          </div>
        )}

        {/* 와이어프레임 이미지 칸: 사진 넣기 · 확대·위치 · 꺼내기 · 비우기 (색·글꼴은 테마가 정하므로 없음) */}
        {isSlot && !textEditMode && !iconEditMode && (
          <div className="flex flex-col gap-2">
            <SectionTitle>{tr('이미지', 'Image')}</SectionTitle>
            {d.imageUrl ? (
              <>
                <SliderRow label={tr('확대', 'Zoom')} min={100} max={300} unit="%"
                  value={(d.mockupZoom as number | undefined) ?? 100}
                  onChange={v => update({ mockupZoom: v })} />
                <SliderRow label={tr('좌우', 'Horizontal')} min={0} max={100} unit="%"
                  value={(d.mockupPosX as number | undefined) ?? 50}
                  onChange={v => update({ mockupPosX: v })} />
                <SliderRow label={tr('상하', 'Vertical')} min={0} max={100} unit="%"
                  value={(d.mockupPosY as number | undefined) ?? 50}
                  onChange={v => update({ mockupPosY: v })} />
                <div className="flex gap-1.5 mt-1">
                  <button className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} title={tr('사진을 화면 옆에 사진으로 꺼냄', 'Take the photo out next to the screen')} onClick={ejectMockupImage}>
                    {tr('이미지 꺼내기', 'Take image out')}
                  </button>
                  <button className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} title={tr('사진을 빼고 회색 칸으로', 'Remove the photo, leave a gray slot')}
                    onClick={() => update({ imageUrl: undefined, mockupZoom: undefined, mockupPosX: undefined, mockupPosY: undefined })}>
                    {tr('비우기', 'Clear')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <input ref={slotFileRef} type="file" accept="image/*" hidden
                  onChange={e => { void putSlotImage(e.target.files?.[0]); e.target.value = ''; }} />
                <button className={`h-8 text-[12px] ${BTN_BASE} ${BTN_IDLE}`} disabled={slotUploading}
                  onClick={() => slotFileRef.current?.click()}>
                  {slotUploading ? tr('올리는 중…', 'Uploading…') : tr('사진 넣기', 'Add photo')}
                </button>
                <span className="text-[12px] leading-relaxed text-[rgba(var(--ui-fg-rgb),0.45)]">
                  {tr('칸을 더블클릭하거나 사진을 끌어다 놓거나, 고른 채 Ctrl+V로도 넣을 수 있습니다.', 'Double-click the slot, drag a photo onto it, or select it and press Ctrl+V.')}
                </span>
              </>
            )}
          </div>
        )}

        {/* DB 테이블 전용: 타입 표시 · 고른 컬럼 설정 · 자동 정렬 · SQL (색은 화면 모드를 따라가므로 없음) */}
        {isEntity && <EntitySection node={node} />}

        {/* 배경 · 윤곽선 색 — 모양은 그대로 */}

        {!isCode && !isMockup && !isSlot && !isEntity && !textEditMode && !iconEditMode && (
          <div className="flex flex-col gap-2">
            {/* 이미지는 바탕이 그림에 가려 보일 일이 없어 배경 색상을 뺌 */}
            {d.shape !== 'image' && (
              <ColorSwatch
                label={tr('배경 색상', 'Background color')}
                value={curBgValue}
                onChange={applyBg}
                quickColors={PASTEL_QUICK}
              />
            )}
            <ColorSwatch
              label={tr('윤곽선 색상', 'Border color')}
              // 화면 기본 윤곽선과 맞춤 — 이미지는 기본이 테두리 없음
              value={d.strokeColor ?? (d.shape === 'image' ? 'transparent' : 'var(--canvas-ink)')}
              onChange={c => update({ strokeColor: c })}
              quickColors={BORDER_QUICK}
            />
            {/* 목록 전용: 윤곽선 모양 — 연결선 모양과 같은 실선·파선·점선 버튼 */}
            {d.shape === 'list' && (
              <div className="flex gap-1.5 mt-2">
                {([['solid', tr('실선', 'Solid')], ['dashed', tr('파선', 'Dashed')], ['dotted', tr('점선', 'Dotted')]] as const).map(([s, label]) => (
                  <button key={s} title={tr(`윤곽선 ${label}`, `Border ${label}`)}
                    className={`flex-1 h-8 ${BTN_BASE} ${(d.strokeStyle ?? 'solid') === s ? BTN_ON : BTN_IDLE}`}
                    onClick={() => update({ strokeStyle: s, ...(!d.strokeColor || d.strokeColor === 'transparent' ? { strokeColor: 'var(--canvas-ink)' } : {}) })}>
                    <svg width="24" height="10" viewBox="0 0 24 10"><line x1="2" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={s === 'dashed' ? '5 3' : s === 'dotted' ? '1 3' : undefined} strokeLinecap="round"/></svg>
                  </button>
                ))}
              </div>
            )}
            {/* 윤곽선 두께 — 연결선 두께와 같은 1·2·3px 버튼 (이미지는 윤곽선 색만) */}
            {d.shape !== 'image' && (
              <div className={`flex gap-1.5 ${d.shape === 'list' ? '' : 'mt-2'}`}>
                {[1, 2, 3].map(w => (
                  <button key={w} title={tr(`윤곽선 두께 ${w}px`, `Border width ${w}px`)}
                    className={`flex-1 h-8 ${BTN_BASE} ${(d.strokeWidth ?? 1) === w ? BTN_ON : BTN_IDLE}`}
                    onClick={() => update({ strokeWidth: w })}>
                    <svg width="24" height="10" viewBox="0 0 24 10"><line x1="2" y1="5" x2="22" y2="5" stroke="currentColor" strokeWidth={w} strokeLinecap="round"/></svg>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 표 전용: 텍스트 정렬 + 병합 / 분할 */}
        {d.shape === 'table' && (() => {
          const cellColors    = (d.tableCellColors    as Record<string, string> | undefined) ?? {};
          const cellFontSizes = (d.tableCellFontSizes as Record<string, number> | undefined) ?? {};
          const firstSel      = tableSelectedCells[0];
          const curCellColor  = firstSel ? (cellColors[firstSel] ?? '#e2e8f0') : '#e2e8f0';
          const curCellSize   = firstSel ? (cellFontSizes[firstSel] ?? 12) : 12;
          const cellAligns    = (d.tableCellAligns as Record<string, 'left' | 'center' | 'right'> | undefined) ?? {};
          const tableAlign    = (d.tableTextAlign as 'left' | 'center' | 'right' | undefined) ?? 'left';
          const curAlign      = firstSel ? (cellAligns[firstSel] ?? tableAlign) : tableAlign;
          const applyAlign = (value: 'left' | 'center' | 'right') => {
            if (tableSelectedCells.length > 0) {
              const next = { ...cellAligns };
              tableSelectedCells.forEach(k => { next[k] = value; });
              update({ tableCellAligns: next });
            } else {
              update({ tableTextAlign: value });
            }
          };

          const applyToSelected = (patch: { color?: string; size?: number }) => {
            const keys = tableSelectedCells.length > 0 ? tableSelectedCells : Object.keys(
              patch.color !== undefined ? cellColors : cellFontSizes
            );
            if (patch.color !== undefined) {
              const next = { ...cellColors };
              (keys.length > 0 ? keys : ['__all__']).forEach(k => { next[k] = patch.color!; });
              update({ tableCellColors: next });
            }
            if (patch.size !== undefined) {
              const next = { ...cellFontSizes };
              (keys.length > 0 ? keys : ['__all__']).forEach(k => { next[k] = patch.size!; });
              update({ tableCellFontSizes: next });
            }
          };

          return (
          <>
            {SECTION_DIV}
            <div className="flex flex-col gap-2">
            <SectionTitle>{tr('텍스트', 'Text')}</SectionTitle>
            {/* 글씨 색상 + 크기 */}
            <div className="flex items-center gap-2">
              {/* 가 색상 버튼 */}
              <div className="relative">
                <button
                  className={`h-7 px-2 flex items-center gap-1 ${BTN_BASE} ${BTN_IDLE}`}
                  onClick={() => setShowCellColorPicker(v => !v)}
                  title={tr('글씨 색상', 'Text color')}
                >
                  <div className="flex flex-col items-center gap-[3px]">
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'rgb(var(--ui-fg-rgb))', lineHeight: 1 }}>{tr('가', 'A')}</span>
                    <div style={{ width: 14, height: 3, background: curCellColor, borderRadius: 1 }} />
                  </div>
                  <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" className="text-[rgba(var(--ui-fg-rgb),0.42)]"><path d="M0 0L3.5 4L7 0"/></svg>
                </button>
                {showCellColorPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowCellColorPicker(false)} />
                    <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--ui-surface)] border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-lg p-2 shadow-xl" style={{ width: 180 }}>
                      <InlineColorPicker
                        value={curCellColor}
                        onChange={c => applyToSelected({ color: c })}
                      />
                    </div>
                  </>
                )}
              </div>
              {/* 글씨 크기 */}
              <div className="flex items-center gap-1 flex-1">
                <button
                  className={`w-6 h-7 flex items-center justify-center text-sm ${BTN_BASE} ${BTN_IDLE} shrink-0`}
                  onClick={() => { const v = Math.max(6, curCellSize - 1); applyToSelected({ size: v }); setCellSizeInputVal(String(v)); }}
                >−</button>
                <div ref={cellBoxRef} className="relative flex items-center border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-md bg-[rgba(var(--ui-fg-rgb),0.06)] overflow-hidden focus-within:border-indigo-500 flex-1">
                  <input
                    type="number" min={6} max={96} value={cellSizeInputVal}
                    onChange={e => setCellSizeInputVal(e.target.value)}
                    onBlur={e => { const v = Math.max(6, Math.min(96, Math.round(Number(e.target.value)))); applyToSelected({ size: v }); setCellSizeInputVal(String(v)); }}
                    onKeyDown={e => { if (e.key === 'Enter') { const v = Math.max(6, Math.min(96, Math.round(Number(cellSizeInputVal)))); applyToSelected({ size: v }); setCellSizeInputVal(String(v)); } }}
                    className="flex-1 min-w-0 w-0 h-7 text-center text-[12px] font-semibold bg-transparent border-none text-[rgb(var(--ui-fg-rgb))] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.35)] shrink-0 pr-1">pt</span>
                  <button
                    tabIndex={-1}
                    onClick={() => setShowCellSizePresets(v => !v)}
                    className={`h-7 w-5 flex items-center justify-center border-l border-[rgba(var(--ui-fg-rgb),0.12)] shrink-0 ${showCellSizePresets ? 'text-[rgb(var(--ui-fg-rgb))] bg-[rgba(var(--ui-fg-rgb),0.1)]' : 'text-[rgba(var(--ui-fg-rgb),0.42)] hover:text-[rgb(var(--ui-fg-rgb))] hover:bg-[rgba(var(--ui-fg-rgb),0.1)]'}`}
                  >
                    <svg width="7" height="4" viewBox="0 0 7 4"><path d="M0 0L3.5 4L7 0" fill="currentColor"/></svg>
                  </button>
                  {showCellSizePresets && (
                    <PresetList
                      anchorRef={cellBoxRef}
                      values={FONT_SIZE_PRESETS}
                      current={curCellSize}
                      onPick={v => { applyToSelected({ size: v }); setCellSizeInputVal(String(v)); }}
                      onClose={() => setShowCellSizePresets(false)}
                    />
                  )}
                </div>
                <button
                  className={`w-6 h-7 flex items-center justify-center text-sm ${BTN_BASE} ${BTN_IDLE} shrink-0`}
                  onClick={() => { const v = Math.min(96, curCellSize + 1); applyToSelected({ size: v }); setCellSizeInputVal(String(v)); }}
                >+</button>
              </div>
            </div>
            {/* 글씨 정렬 */}
            <Segmented
              value={curAlign}
              onChange={applyAlign}
              options={[
                { value: 'left',   title: tr('왼쪽 정렬', 'Align left'),   label: <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="4.5" width="9" height="2" rx="1"/><rect x="0" y="9" width="11" height="2" rx="1"/></svg> },
                { value: 'center', title: tr('가운데 정렬', 'Align center'), label: <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2.5" y="4.5" width="9" height="2" rx="1"/><rect x="1.5" y="9" width="11" height="2" rx="1"/></svg> },
                { value: 'right',  title: tr('오른쪽 정렬', 'Align right'), label: <svg width="14" height="11" viewBox="0 0 14 11" fill="currentColor"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="5" y="4.5" width="9" height="2" rx="1"/><rect x="3" y="9" width="11" height="2" rx="1"/></svg> },
              ]}
            />
            <div className="flex gap-2">
              <button
                className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`}
                onClick={mergeTableCells}
                disabled={!canMerge}
                style={{ opacity: canMerge ? 1 : 0.35, cursor: canMerge ? 'pointer' : 'not-allowed' }}
                title={tr('선택한 셀 병합 (2개 이상 선택)', 'Merge selected cells (select 2+)')}
              >{tr('병합', 'Merge')}</button>
              <button
                className={`flex-1 h-7 text-[12px] ${BTN_BASE} ${BTN_IDLE}`}
                onClick={splitTableCell}
                disabled={!canSplit}
                style={{ opacity: canSplit ? 1 : 0.35, cursor: canSplit ? 'pointer' : 'not-allowed' }}
                title={tr('병합된 셀 분할', 'Split merged cells')}
              >{tr('분할', 'Split')}</button>
            </div>
            </div>
          </>
          );
        })()}

        {/* 일반 도형: 글꼴 + 글씨 정렬 (글씨 편집 중엔 아래 텍스트 도구) */}
        {isTextShape && !isSlot && !textEditMode && (
          <>
            {SECTION_DIV}
            <div className="flex flex-col gap-2">
              <SectionTitle>{tr('글꼴', 'Font')}</SectionTitle>
              {fontPicker}
              {/* 가로(왼쪽·가운데·오른쪽) · 세로(위·가운데·아래) 정렬 — 한 줄에 두 묶음 */}
              <div className="flex gap-1.5 mt-1.5">
                <div className="flex-1">
                  <Segmented
                    value={d.textAlignH ?? 'center'}
                    onChange={v => update({ textAlignH: v })}
                    options={[
                      { value: 'left',   title: tr('왼쪽 정렬', 'Align left'),   label: <AlignLeft size={13} strokeWidth={1.8} /> },
                      { value: 'center', title: tr('가운데 정렬', 'Align center'), label: <AlignCenter size={13} strokeWidth={1.8} /> },
                      { value: 'right',  title: tr('오른쪽 정렬', 'Align right'), label: <AlignRight size={13} strokeWidth={1.8} /> },
                    ] as const}
                  />
                </div>
                <div className="flex-1">
                  <Segmented
                    value={d.textAlignV ?? 'middle'}
                    onChange={v => update({ textAlignV: v })}
                    options={[
                      { value: 'top',    title: tr('위 정렬', 'Align top'),     label: <AlignVerticalJustifyStart size={13} strokeWidth={1.8} /> },
                      { value: 'middle', title: tr('가운데 정렬', 'Align center'), label: <AlignVerticalJustifyCenter size={13} strokeWidth={1.8} /> },
                      { value: 'bottom', title: tr('아래 정렬', 'Align bottom'),   label: <AlignVerticalJustifyEnd size={13} strokeWidth={1.8} /> },
                    ] as const}
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {/* 글씨 상자 · 글씨 편집 중 */}
        {(isText || textEditMode) && (
          <>
            {/* 글씨 편집 중: 맨 위에 글씨 색 — 도형 패널의 윤곽선처럼 무지개 견본. 마지막 칸은 기본색(배경에 맞춰 자동) */}
            {textEditMode && (
              <ColorSwatch
                label={tr('글씨 색상', 'Text color')}
                value={d.fontColor ?? 'transparent'}
                onChange={c => update({ fontColor: c === 'transparent' ? undefined : c })}
                quickColors={TEXT_QUICK}
              />
            )}
            {SECTION_DIV}
            <div className="flex flex-col gap-2">
            <SectionTitle>{tr('텍스트', 'Text')}</SectionTitle>
            {/* 글꼴 — 하나로 이어진 버튼 묶음 */}
            {fontPicker}
            {/* 글씨 색(글상자) · 크기 · 굵게 · 기울임 — 한 줄 */}
            <div className="flex items-center gap-1.5 mt-1.5">
              {/* 가 색상 버튼 — 글상자를 선택만 했을 때 (편집 중엔 위 견본 줄) */}
              {isText && !textEditMode && (
              <div className="relative shrink-0">
                <button
                  className={`h-7 px-1.5 flex items-center gap-1 ${BTN_BASE} ${BTN_IDLE}`}
                  onClick={() => setShowTextColorPicker(v => !v)}
                  title={tr('글씨 색상', 'Text color')}
                >
                  <div className="flex flex-col items-center gap-[2px]">
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--ui-fg-rgb))', lineHeight: 1 }}>{tr('가', 'A')}</span>
                    <div style={{ width: 12, height: 2, background: d.fontColor ?? '#e2e8f0', borderRadius: 1 }} />
                  </div>
                  <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" className="text-[rgba(var(--ui-fg-rgb),0.42)]"><path d="M0 0L3.5 4L7 0"/></svg>
                </button>
                {showTextColorPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowTextColorPicker(false)} />
                    <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--ui-surface)] border border-[rgba(var(--ui-fg-rgb),0.12)] rounded-lg p-2 shadow-xl" style={{ width: 180 }}>
                      <InlineColorPicker
                        value={d.fontColor ?? '#e2e8f0'}
                        onChange={c => update({ fontColor: c })}
                      />
                    </div>
                  </>
                )}
              </div>
              )}
              {/* 글씨 크기 — [ − 23 ▾ + ]를 테두리 하나로 묶음 */}
              <div ref={fontBoxRef} className="relative flex items-center h-7 flex-1 min-w-0 border border-[rgba(var(--ui-fg-rgb),0.1)] rounded-lg focus-within:border-indigo-300/60">
                <button
                  className="w-4 h-full flex items-center justify-center text-[13px] text-[rgba(var(--ui-fg-rgb),0.6)] hover:text-[rgb(var(--ui-fg-rgb))] shrink-0 cursor-pointer"
                  onClick={() => changeFontSize(currentPt - 1)}
                  title={tr('작게', 'Smaller')}
                >−</button>
                <input
                  type="number" min={6} max={300} value={fontInputVal}
                  onChange={e => setFontInputVal(e.target.value)}
                  onBlur={e => changeFontSize(Number(e.target.value))}
                  onKeyDown={e => e.key === 'Enter' && changeFontSize(Number(fontInputVal))}
                  className="flex-1 min-w-[3ch] w-0 h-full text-center text-[12px] font-semibold bg-transparent border-none text-[rgb(var(--ui-fg-rgb))] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  tabIndex={-1}
                  onClick={() => setShowPresets(v => !v)}
                  className={`h-full w-3.5 flex items-center justify-center shrink-0 cursor-pointer ${showPresets ? 'text-[rgb(var(--ui-fg-rgb))]' : 'text-[rgba(var(--ui-fg-rgb),0.42)] hover:text-[rgb(var(--ui-fg-rgb))]'}`}
                  title={tr('크기 목록', 'Size list')}
                >
                  <svg width="7" height="4" viewBox="0 0 7 4"><path d="M0 0L3.5 4L7 0" fill="currentColor"/></svg>
                </button>
                <button
                  className="w-4 h-full flex items-center justify-center text-[13px] text-[rgba(var(--ui-fg-rgb),0.6)] hover:text-[rgb(var(--ui-fg-rgb))] shrink-0 cursor-pointer"
                  onClick={() => changeFontSize(currentPt + 1)}
                  title={tr('크게', 'Larger')}
                >+</button>
                {showPresets && (
                  <PresetList
                    anchorRef={fontBoxRef}
                    values={FONT_SIZE_PRESETS}
                    current={currentPt}
                    onPick={changeFontSize}
                    onClose={() => setShowPresets(false)}
                  />
                )}
              </div>
              {/* 굵게 · 기울임 토글 */}
              <button
                className={`w-7 h-7 shrink-0 text-[12px] font-semibold ${BTN_BASE} ${d.fontWeight && d.fontWeight !== 'normal' ? BTN_ON : BTN_IDLE}`}
                onClick={() => update({ fontWeight: d.fontWeight && d.fontWeight !== 'normal' ? 'normal' : 'bold' })}
                title={tr('굵게', 'Bold')}
              >B</button>
              <button
                className={`w-7 h-7 shrink-0 text-[13px] italic font-serif ${BTN_BASE} ${(d.fontStyle as string | undefined) === 'italic' ? BTN_ON : BTN_IDLE}`}
                onClick={() => update({ fontStyle: (d.fontStyle as string | undefined) === 'italic' ? 'normal' : 'italic' })}
                title={tr('기울임', 'Italic')}
              >I</button>
            </div>
            {/* 세부: 줄 높이 · 자간 — 도형 안 글씨를 편집 중일 때 (글상자·카드는 높이를 글에 맞춰 재는 방식이라 제외) */}
            {textEditMode && isTextShape && (
              <Detail>
                <SliderRow
                  label={tr('줄높이', 'Line height')} min={100} max={220} unit="%"
                  value={Math.round((typeof d.lineHeight === 'number' ? d.lineHeight : 1.4) * 100)}
                  onChange={v => update({ lineHeight: v / 100 })}
                />
                <SliderRow
                  label={tr('자간', 'Letter spacing')} min={-2} max={10} unit="px"
                  value={typeof d.letterSpacing === 'number' ? d.letterSpacing : 0}
                  onChange={v => update({ letterSpacing: v })}
                />
              </Detail>
            )}
            </div>
          </>
        )}

        {/* 모양: 투명도 · 모서리 둥글기 — 코드 블록은 읽기 어려워지거나 바꿀 일이 없어 제외 */}
        {!isCode && !isEntity && !textEditMode && !iconEditMode && (
          <>
            {SECTION_DIV}
            <div className="flex flex-col gap-2">
              <SectionTitle>{tr('모양', 'Appearance')}</SectionTitle>
              {/* 저장값은 불투명도(opacity, 100 = 또렷함) — 화면에는 투명도(0% = 또렷함)로 뒤집어 표시 */}
              <SliderRow
                label={tr('투명도', 'Opacity')} min={0} max={100} unit="%"
                value={100 - (d.opacity ?? 100)}
                onChange={v => update({ opacity: 100 - v })}
              />
              {/* 원·마름모·육각형·손그림은 모서리가 없어 둥글기 숨김 */}
              {!['circle', 'diamond', 'hexagon', 'drawing', 'mockup'].includes(d.shape) && (
                <SliderRow
                  label={tr('둥글기', 'Corner radius')} min={0} max={32} unit="px"
                  value={d.borderRadius ?? defaultRadius(d.shape)}   // 도형별 화면 기본값과 맞춤
                  onChange={v => update({ borderRadius: v })}
                />
              )}
              {/* 세부: 그림자 · 글씨 안쪽 여백 — 사각형·원 */}
              {(d.shape === 'rectangle' || d.shape === 'circle') && !isSlot && (
                <Detail>
                  <SectionTitle>{tr('그림자', 'Shadow')}</SectionTitle>
                  <Segmented
                    value={typeof d.shadow === 'number' ? d.shadow : 0}
                    onChange={v => update({ shadow: v })}
                    options={[{ value: 0, label: tr('없음', 'None') }, { value: 1, label: tr('약하게', 'Light') }, { value: 2, label: tr('보통', 'Normal') }, { value: 3, label: tr('강하게', 'Strong') }]}
                  />
                  {!d.icon && (
                    <SliderRow
                      label={tr('여백', 'Padding')} min={0} max={40} unit="px"
                      // 기본값은 도형마다 다름 — 글상자 도형은 좌우 10, 일반 도형은 좌우 20 (Node의 InlineTextEditor)
                      value={typeof d.textPadding === 'number' ? d.textPadding : d.isTextBox ? 10 : 20}
                      onChange={v => update({ textPadding: v })}
                    />
                  )}
                </Detail>
              )}
            </div>
          </>
        )}

        {SECTION_DIV}

        {/* 순서 · 복사 · 삭제 — 아이콘 한 줄 (붙여넣기는 캔버스에서 Ctrl+V) */}
        <div className="flex items-center gap-1">
          <IconAction title={tr('맨 앞으로', 'Bring to front')} onClick={bringToFront}><ArrowUpToLine size={14} strokeWidth={1.8} /></IconAction>
          <IconAction title={tr('맨 뒤로', 'Send to back')} onClick={sendToBack}><ArrowDownToLine size={14} strokeWidth={1.8} /></IconAction>
          <span className="flex-1" />
          <IconAction title={tr('복사 (캔버스에서 Ctrl+V로 붙여넣기)', 'Copy (paste on canvas with Ctrl+V)')} onClick={copyNode}><Copy size={14} strokeWidth={1.8} /></IconAction>
          <IconAction title={tr('삭제', 'Delete')} danger onClick={() => deleteElements({ nodes: [{ id }] })}><Trash2 size={14} strokeWidth={1.8} /></IconAction>
        </div>

      </div>
    </PanelShell>
  );
}

// ── 템플릿 2 요소 편집 패널 ────────────────────────────────────
function DocElementPanel({ onHeaderMouseDown, dragging }: DragProps = {}) {
  const { setNodes } = useReactFlow<AppNode>();
  const selectedDocElement = useCanvasStore(s => s.selectedDocElement);
  const clearSelectedDocElement = useCanvasStore(s => s.clearSelectedDocElement);

  const node = useStore(s => {
    if (!selectedDocElement) return null;
    return (s.nodes as AppNode[]).find(n => n.id === selectedDocElement.nodeId) ?? null;
  });

  if (!selectedDocElement || !node) return null;

  const { nodeId, elementId } = selectedDocElement;
  const existingContent = (node.data.docTemplateContent ?? {}) as DocTemplateContent;
  const elemStyle: DocTemplateElementStyle = existingContent[elementId] ?? {};

  const updateElement = (patch: DocTemplateElementStyle) => {
    setNodes(nds => (nds as AppNode[]).map(n => {
      if (n.id !== nodeId) return n;
      const existing = (n.data.docTemplateContent ?? {}) as DocTemplateContent;
      return {
        ...n, data: {
          ...n.data, docTemplateContent: {
            ...existing,
            [elementId]: { ...(existing[elementId] ?? {}), ...patch },
          },
        },
      };
    }));
  };

  // element ID → 한국어 레이블
  const elemLabels: Record<string, string> = {
    // music-streaming (요구사항 페이지)
    'header-title': tr('제목', 'Title'), 'header-subtitle': tr('부제목', 'Subtitle'),
    'section1-title': tr('Section 01 제목', 'Section 01 title'), 'req-card-0': tr('요구사항 1', 'Requirement 1'), 'req-card-1': tr('요구사항 2', 'Requirement 2'),
    'req-card-2': tr('요구사항 3', 'Requirement 3'), 'req-card-3': tr('요구사항 4', 'Requirement 4'),
    'req-audio-note': tr('오디오 포맷', 'Audio format'), 'req-scale-note': tr('규모 가정', 'Scale assumptions'),
    'section2-title': tr('Section 02 제목', 'Section 02 title'),
    'stat-card-0': tr('통계 1', 'Stat 1'), 'stat-card-1': tr('통계 2', 'Stat 2'), 'stat-card-2': tr('통계 3', 'Stat 3'), 'stat-card-3': tr('통계 4', 'Stat 4'),
    'capacity-estimate': tr('스토리지 추정', 'Storage estimate'), 'capacity-note': tr('메모', 'Note'),
    // sequence-diagram 요소
    'sd-title': tr('다이어그램 제목', 'Diagram title'),
    'sd-actor-user-top': tr('User (상단)', 'User (top)'), 'sd-actor-mob-top': tr('Mobile App (상단)', 'Mobile App (top)'),
    'sd-actor-lb-top': tr('Load Balancer (상단)', 'Load Balancer (top)'), 'sd-actor-api-top': tr('API Server (상단)', 'API Server (top)'),
    'sd-actor-db-top': tr('SQL Database (상단)', 'SQL Database (top)'), 'sd-actor-blob-top': tr('Blob Storage (상단)', 'Blob Storage (top)'),
    'sd-actor-user-bot': tr('User (하단)', 'User (bottom)'), 'sd-actor-mob-bot': tr('Mobile App (하단)', 'Mobile App (bottom)'),
    'sd-actor-lb-bot': tr('Load Balancer (하단)', 'Load Balancer (bottom)'), 'sd-actor-api-bot': tr('API Server (하단)', 'API Server (bottom)'),
    'sd-actor-db-bot': tr('SQL Database (하단)', 'SQL Database (bottom)'), 'sd-actor-blob-bot': tr('Blob Storage (하단)', 'Blob Storage (bottom)'),
    'sd-alt-label': tr('ALT 프레임 키워드', 'ALT frame keyword'), 'sd-alt-valid-cond': tr('ALT 유효 조건', 'ALT valid condition'),
    'sd-alt-invalid-x': tr('ALT 무효 구분자', 'ALT invalid separator'), 'sd-alt-invalid-cond': tr('ALT 무효 조건', 'ALT invalid condition'),
    'sd-par-label': tr('PAR 프레임 키워드', 'PAR frame keyword'), 'sd-par-cond': tr('PAR 조건 라벨', 'PAR condition label'),
    'sd-step-1': tr('스텝 1: Hits play button', 'Step 1: Hits play button'), 'sd-step-2': tr('스텝 2: GET /songs/{id}', 'Step 2: GET /songs/{id}'),
    'sd-step-3': tr('스텝 3: Route request', 'Step 3: Route request'), 'sd-step-4': tr('스텝 4: Validate JWT token', 'Step 4: Validate JWT token'),
    'sd-step-5.1': tr('스텝 5.1: Query song metadata', 'Step 5.1: Query song metadata'), 'sd-step-5.2': tr('스텝 5.2: Return song details', 'Step 5.2: Return song details'),
    'sd-step-5.3': tr('스텝 5.3: Generate signed URL', 'Step 5.3: Generate signed URL'), 'sd-step-5.4': tr('스텝 5.4: Return metadata + signed URL', 'Step 5.4: Return metadata + signed URL'),
    'sd-step-5.5.1': tr('스텝 5.5.1: Range requests', 'Step 5.5.1: Range requests'), 'sd-step-5.5.2': tr('스텝 5.5.2: Stream audio data', 'Step 5.5.2: Stream audio data'),
    'sd-step-5.6': tr('스텝 5.6: POST analytics', 'Step 5.6: POST analytics'), 'sd-step-6.1': tr('스텝 6.1: Return auth error', 'Step 6.1: Return auth error'),
  };

  const currentFontSize = elemStyle.fontSize ?? 12;
  const currentFontWeight = elemStyle.fontWeight ?? 'normal';
  const currentFontStyle = elemStyle.fontStyle ?? 'normal';
  const currentColor = elemStyle.color ?? '#333333';
  const currentBg = elemStyle.background ?? 'transparent';

  return (
    <PanelShell title={tr('템플릿 요소 편집', 'Edit template element')} onHeaderMouseDown={onHeaderMouseDown} dragging={dragging} onClose={clearSelectedDocElement}>

      {/* 배경색 — 토글 없는 항상 열린 행 */}
      <div className="border-b border-[rgba(var(--ui-fg-rgb),0.05)] px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <span className={LABEL}>{tr('배경색', 'Background')}</span>
        <InlineColorPicker value={currentBg} onChange={c => updateElement({ background: c })} showTransparent />
      </div>

      {/* 테두리 — 토글 없는 항상 열린 행 */}
      <div className="border-b border-[rgba(var(--ui-fg-rgb),0.05)] px-3 pt-2.5 pb-3 flex flex-col gap-2">
        <span className={LABEL}>{tr('테두리', 'Border')}</span>
        <InlineColorPicker value={elemStyle.borderColor ?? 'transparent'} onChange={c => updateElement({ borderColor: c })} showTransparent />
      </div>

      {/* 글씨 — 토글 없는 항상 열린 행 */}
      <div className="border-b border-[rgba(var(--ui-fg-rgb),0.05)] px-3 pt-2.5 pb-3 flex flex-col gap-[10px]">
        <span className={LABEL}>{tr('글씨', 'Text')}</span>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.42)] min-w-[28px]">{tr('크기', 'Size')}</span>
          <Stepper value={currentFontSize} onChange={v => updateElement({ fontSize: v })} min={6} max={96} suffix="pt" />
        </div>
        <div className="flex gap-1.5">
          {(['normal', 'bold'] as const).map(w => (
            <button key={w} className={`flex-1 h-8 text-[12px] ${BTN_BASE} ${currentFontWeight === w ? BTN_ON : BTN_IDLE}`}
              style={{ fontWeight: w === 'bold' ? 700 : 400 }}
              onClick={() => updateElement({ fontWeight: w })}>
              {w === 'normal' ? 'Normal' : 'Bold'}
            </button>
          ))}
          <button
            className={`w-9 h-8 text-[13px] italic font-serif ${BTN_BASE} ${currentFontStyle === 'italic' ? BTN_ON : BTN_IDLE}`}
            onClick={() => updateElement({ fontStyle: currentFontStyle === 'italic' ? 'normal' : 'italic' })}
            title={tr('이탤릭', 'Italic')}>
            I
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.42)]">{tr('텍스트 색상', 'Text color')}</span>
          <InlineColorPicker value={currentColor} onChange={c => updateElement({ color: c })} />
        </div>
        {/* 투명도 — 저장값은 불투명도(100 = 또렷함), 화면에는 투명도(0% = 또렷함)로 뒤집어 표시 */}
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.42)] shrink-0">{tr('투명도', 'Opacity')}</span>
          <input
            type="range" min={0} max={100}
            value={100 - (elemStyle.opacity ?? 100)}
            onChange={e => updateElement({ opacity: 100 - Number(e.target.value) })}
            className="flex-1 min-w-0 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.35)] min-w-[34px] text-right tabular-nums shrink-0">
            {100 - (elemStyle.opacity ?? 100)}%
          </span>
        </div>
        {/* 모서리 반경 */}
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.42)] shrink-0">{tr('둥글기', 'Corner radius')}</span>
          <input
            type="range" min={0} max={32}
            value={elemStyle.borderRadius ?? 8}
            onChange={e => updateElement({ borderRadius: Number(e.target.value) })}
            className="flex-1 min-w-0 h-1 accent-indigo-500 cursor-pointer"
          />
          <span className="text-[12px] text-[rgba(var(--ui-fg-rgb),0.35)] min-w-[34px] text-right tabular-nums shrink-0">
            {elemStyle.borderRadius ?? 8}px
          </span>
        </div>
      </div>
    </PanelShell>
  );
}

// ── 패널 외곽 껍질 ────────────────────────────────────────────
function PanelShell({
  title, children, onHeaderMouseDown, dragging, onClose,
}: {
  title: string;
  children: React.ReactNode;
  onHeaderMouseDown?: (e: React.MouseEvent) => void;
  dragging?: boolean;
  onClose?: () => void;
}) {
  return (
    <div
      data-node-props-panel
      className="bg-[var(--ui-panel)] border border-[rgba(var(--ui-fg-rgb),0.08)] rounded-2xl w-52 shadow-[var(--ui-shadow)] flex flex-col"
      style={{ maxHeight: 'calc(100vh - 100px)', overflow: 'hidden' }}
    >
      {/* 패널 헤더 — 드래그 핸들 */}
      <div
        className="flex items-center justify-between px-3.5 py-2.5 border-b border-[rgba(var(--ui-fg-rgb),0.06)] select-none shrink-0"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={onHeaderMouseDown}
      >
        <span className="text-[12px] font-semibold text-[rgba(var(--ui-fg-rgb),0.8)] tracking-wide">{title}</span>
        <div className="flex gap-1.5 items-center">
          {onClose && (
            <button
              onClick={onClose}
              onMouseDown={e => e.stopPropagation()}
              className="flex items-center justify-center text-[rgba(var(--ui-fg-rgb),0.35)] hover:text-[rgba(var(--ui-fg-rgb),0.65)] cursor-pointer bg-transparent border-none leading-none text-[13px] transition-colors"
              title={tr('닫기', 'Close')}
            >✕</button>
          )}
        </div>
      </div>
      {/* 패널 내용 (스크롤 가능) */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden
                      scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[#333]
                      [&::-webkit-scrollbar]:w-[4px]
                      [&::-webkit-scrollbar-thumb]:bg-[rgba(var(--ui-fg-rgb),0.1)]
                      [&::-webkit-scrollbar-thumb]:rounded-full">
        {children}
      </div>
    </div>
  );
}

// ── 메인 패널 — 드래그 가능한 플로팅 패널 ──────────────────
export function NodePropertiesPanel() {
  const selectedNodes = useStore(s =>
    s.nodes.filter(n => n.selected) as AppNode[]
  );

  const selectedNode = useStore(s => {
    const nodes = s.nodes.filter(n => n.selected);
    const edges = s.edges.filter(e => e.selected);
    return nodes.length === 1 && edges.length === 0 ? (nodes[0] as AppNode) : null;
  });

  const selectedEdge = useStore(s => {
    const edges = s.edges.filter(e => e.selected);
    const nodes = s.nodes.filter(n => n.selected);
    return edges.length === 1 && nodes.length === 0 ? (edges[0] as AppEdge) : null;
  });

  const selectedDocElement = useCanvasStore(s => s.selectedDocElement);
  const labelFocusEdgeId   = useCanvasStore(s => s.labelFocusEdgeId);
  const chatOffset = 0;   // 오른쪽에 붙는 다른 패널 너비 (지금은 없음)

  // 드래그 상태
  const [pos, setPos] = useState({ x: 12, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const posRef  = useRef(pos);
  useEffect(() => { posRef.current = pos; }, [pos]);

  // 채팅 패널 열리면 패널이 채팅 영역 오른쪽에 오도록 위치 조정
  const prevChatOffset = useRef(chatOffset);
  useEffect(() => {
    const delta = chatOffset - prevChatOffset.current;
    prevChatOffset.current = chatOffset;
    if (delta !== 0) {
      setPos(p => ({ ...p, x: Math.max(chatOffset + 12, p.x + delta) }));
    }
  }, [chatOffset]);

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startMx = e.clientX;
    const startMy = e.clientY;
    const startPx = posRef.current.x;
    const startPy = posRef.current.y;

    const onMove = (me: MouseEvent) => {
      setPos({
        x: Math.max(chatOffset + 12, startPx + me.clientX - startMx),
        y: Math.max(0, startPy + me.clientY - startMy),
      });
    };
    const onUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, [chatOffset]);

  // 선택한 노드를 패널이 가리면 옆으로 비켜 띄움
  // (가린 채로 두면 두 번 클릭의 두 번째 클릭이 패널에 들어가 텍스트 편집이 안 됨)
  const boxRef = useRef<HTMLDivElement>(null);
  const selectedId = selectedNode?.id;
  const selectedIsDocPage = !!selectedNode?.data?.isDocPage;
  useLayoutEffect(() => {
    if (!selectedId || !boxRef.current) return;
    const nodeEl = document.querySelector(`.react-flow__node[data-id="${CSS.escape(selectedId)}"]`);
    const flowEl = nodeEl?.closest('.react-flow');
    if (!nodeEl || !flowEl) return;
    const n = nodeEl.getBoundingClientRect();
    const p = boxRef.current.getBoundingClientRect();
    const b = flowEl.getBoundingClientRect();
    const overlaps = (x: number, y: number) =>
      x < n.right && x + p.width > n.left && y < n.bottom && y + p.height > n.top;
    if (!overlaps(p.left, p.top)) return;
    const gap  = 12;
    const minX = Math.max(b.left, chatOffset) + gap;
    const fits = (x: number, y: number) =>
      x >= minX && y >= b.top && x + p.width <= b.right - gap && y + p.height <= b.bottom - gap;
    const next = [
      { x: n.right + gap,          y: p.top },   // 노드 오른쪽
      { x: n.left - p.width - gap, y: p.top },   // 노드 왼쪽
      { x: p.left, y: n.bottom + gap },          // 노드 아래
      { x: p.left, y: n.top - p.height - gap },  // 노드 위
    ].find((c) => fits(c.x, c.y) && !overlaps(c.x, c.y));
    if (next) { setPos(next); return; }
    if (!selectedIsDocPage) return;

    // 비킬 자리가 없을 만큼 큰 노드(문서 페이지 등): 패널은 왼쪽 끝에 두고,
    // 캔버스를 옮겨(필요하면 축소) 노드를 패널 오른쪽 빈 곳에 맞춤
    const panelX = minX;
    const panelY = Math.max(b.top + gap, Math.min(p.top, b.bottom - gap - p.height));
    setPos({ x: panelX, y: panelY });
    const regionL = panelX + p.width + gap * 2;
    const regionR = b.right - gap * 2;
    const regionT = b.top + gap * 2;
    const regionB = b.bottom - gap * 2;
    if (regionR - regionL < 120) return;   // 화면이 너무 좁으면 그대로
    const vp = getViewport();
    const k  = Math.min(1, (regionR - regionL) / n.width, (regionB - regionT) / n.height);
    const z  = vp.zoom * k;
    // 노드 중심(캔버스 좌표) → 빈 영역 가운데로
    const cx = (n.left + n.width / 2 - b.left - vp.x) / vp.zoom;
    const cy = (n.top + n.height / 2 - b.top - vp.y) / vp.zoom;
    const tx = (regionL + regionR) / 2 - b.left;
    const ty = k < 1 ? (regionT + regionB) / 2 - b.top : n.top + n.height / 2 - b.top;
    setViewport({ x: tx - cx * z, y: ty - cy * z, zoom: z }, { duration: 300 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, chatOffset]);

  const { setNodes, setEdges, getViewport, setViewport } = useReactFlow();
  const deselectAll = useCallback(() => {
    setNodes(ns => ns.map(n => ({ ...n, selected: false })));
    setEdges(es => es.map(e => ({ ...e, selected: false })));
  }, [setNodes, setEdges]);

  if (!selectedNodes.length && !selectedEdge && !selectedDocElement) return null;

  return (
    <Panel position="top-left" style={{ pointerEvents: 'none', background: 'none', border: 'none', padding: 0 }}>
      <div
        ref={boxRef}
        style={{
          position:       'fixed',
          left:           pos.x,
          top:            pos.y,
          zIndex:         1000,
          pointerEvents:  'auto',
          userSelect:     isDragging ? 'none' : undefined,
        }}
      >
        {selectedDocElement && (
          <DocElementPanel onHeaderMouseDown={handleHeaderMouseDown} dragging={isDragging} />
        )}
        {!selectedDocElement && selectedNode && (
          selectedNode.data?.isDocPage
            ? <DocPagePanel    node={selectedNode} onHeaderMouseDown={handleHeaderMouseDown} dragging={isDragging} onClose={deselectAll} />
            : selectedNode.data?.isDocContainer
              ? <DocContainerPanel node={selectedNode} onHeaderMouseDown={handleHeaderMouseDown} dragging={isDragging} onClose={deselectAll} />
              : <NodePanel     node={selectedNode} onHeaderMouseDown={handleHeaderMouseDown} dragging={isDragging} onClose={deselectAll} />
        )}
        {/* 여러 개(묶음 포함)를 골랐을 때 — 순서 · 묶기 / 묶음 풀기 */}
        {!selectedDocElement && !selectedNode && !selectedEdge && selectedNodes.length > 1 && (
          <MultiNodePanel nodes={selectedNodes} onHeaderMouseDown={handleHeaderMouseDown} dragging={isDragging} />
        )}
        {!selectedDocElement && selectedEdge && (
          <EdgePanel edge={selectedEdge} labelMode={labelFocusEdgeId === selectedEdge.id} onHeaderMouseDown={handleHeaderMouseDown} dragging={isDragging} onClose={deselectAll} />
        )}
      </div>
    </Panel>
  );
}
