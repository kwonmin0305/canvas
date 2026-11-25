'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/SlashMenu/index.tsx
// 캔버스 빈 곳에서 "/" 를 누르면 뜨는 요소 추가 메뉴 (Notion 슬래시 명령 방식)
//
//   - 바로 타이핑해서 검색 (한글 초성 검색 지원: ㅍ → 표)
//   - ↑↓ 로 고르고 Enter 로 추가, Esc·바깥 클릭으로 닫기
//   - 고른 요소는 메뉴를 연 위치(마우스 위치)에 생성
// ═══════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { Type, Table, Frame, Code, List, ListOrdered, ListTodo, ListCollapse, FileText, Lightbulb, Smartphone, Tablet, Database } from 'lucide-react';
import { mockupDefaultSize } from '@/components/Node/Mockup';
import { SHAPE_DEFAULTS, codeBoxHeight } from '@/components/Node';
import { newBlock } from '@/components/Node/Blocks';
import {
  BASIC_SHAPES, TABLE_TEMPLATES, ARCH_CARDS, EXTERNAL_API_CARDS,
  basicNodeSize, buildBasicNode, templateNodeSize, buildTemplateNode, ARCH_NODE_SIZE, buildArchNode,
} from './catalog';
import type { AppNode, AppEdge } from '@/types';
import { ENTITY, entityHeight, buildBlankEntity, buildErd } from '@/lib/erd';
import { ERD_TEMPLATES } from '@/lib/erd/templates';
import styles from './SlashMenu.module.css';
import { tr } from '@/lib/i18n';

export interface SlashItem {
  key:       string;
  section:   string;
  label:     string;
  icon:      React.ReactNode;
  keywords?: string;                                       // 검색용 추가 단어
  build:     (center: { x: number; y: number }) => AppNode;  // 캔버스 좌표 중심에 노드 생성
  // 요소 여러 개 + 연결선을 한꺼번에 놓는 항목 (DB 설계 템플릿) — 있으면 build 대신 이걸 씀
  cluster?:  () => { nodes: AppNode[]; edges: AppEdge[] };
}

// 중심 좌표 → 왼쪽 위 좌표
const topLeft = (c: { x: number; y: number }, w: number, h: number) => ({ x: c.x - w / 2, y: c.y - h / 2 });

// Notion식 블록 노드 (목록·콜아웃·페이지) — 만들자마자 바로 편집(페이지는 모달 열림)
const buildBlockNode = (
  shape: 'list' | 'callout' | 'page', c: { x: number; y: number }, blocks: AppNode['data']['blocks'], blockIcon?: string,
): AppNode => {
  const { w, h } = SHAPE_DEFAULTS[shape];
  return {
    id: `node-${Date.now()}`, type: 'custom', position: topLeft(c, w, h), width: w, height: h, zIndex: 0,
    data: {
      title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape, width: w, height: h,
      blocks, blockIcon, autoEdit: true,
    },
  };
};

const LIST_ITEMS = [
  { kind: 'bullet', label: tr('글머리 기호 목록', 'Bulleted list'), icon: <List size={16} strokeWidth={1.8} />,         keywords: 'bullet list ul 글머리 리스트 목록' },
  { kind: 'number', label: tr('번호 매기기 목록', 'Numbered list'), icon: <ListOrdered size={16} strokeWidth={1.8} />,  keywords: 'number numbered list ol 번호 리스트 목록' },
  { kind: 'todo',   label: tr('할 일 목록', 'To-do list'),      icon: <ListTodo size={16} strokeWidth={1.8} />,     keywords: 'todo check checkbox 할일 체크 목록' },
  { kind: 'toggle', label: tr('토글 목록', 'Toggle list'),       icon: <ListCollapse size={16} strokeWidth={1.8} />, keywords: 'toggle 토글 접기 목록' },
] as const;

const SLASH_ITEMS: SlashItem[] = [
  {
    key: 'text', section: tr('기본 블록', 'Basic blocks'), label: tr('텍스트', 'Text'), icon: <Type size={16} strokeWidth={1.8} />, keywords: 'text 글 글자',
    build: (c) => {
      const { w, h } = SHAPE_DEFAULTS.text;
      return {
        id: `node-${Date.now()}`, type: 'custom', position: topLeft(c, w, h), width: w, height: h, zIndex: 0,
        data: {
          title: tr('텍스트', 'Text'), subtitle: '', icon: '', type: 'service', status: 'none', shape: 'text', width: w, height: h,
          bgColor: 'transparent', strokeColor: 'transparent', fontScale: 0.27, fontWeight: 'normal',
        },
      };
    },
  },
  ...LIST_ITEMS.map(({ kind, label, icon, keywords }): SlashItem => ({
    key: `list-${kind}`, section: tr('기본 블록', 'Basic blocks'), label, icon, keywords,
    build: (c) => buildBlockNode('list', c, [newBlock(kind)]),
  })),
  {
    key: 'page', section: tr('기본 블록', 'Basic blocks'), label: tr('페이지', 'Page'), icon: <FileText size={16} strokeWidth={1.8} />, keywords: 'page 페이지 문서 하위',
    build: (c) => buildBlockNode('page', c, []),
  },
  {
    key: 'callout', section: tr('기본 블록', 'Basic blocks'), label: tr('콜아웃', 'Callout'), icon: <Lightbulb size={16} strokeWidth={1.8} />, keywords: 'callout 콜아웃 강조 메모 알림',
    build: (c) => buildBlockNode('callout', c, [newBlock()], '💡'),
  },
  ...BASIC_SHAPES.map((item): SlashItem => ({
    key: `basic-${item.shape}-${item.label}`, section: tr('기본 블록', 'Basic blocks'), label: item.label, icon: item.icon, keywords: item.shape,
    build: (c) => {
      const size = basicNodeSize(item);
      const w = size.w ?? SHAPE_DEFAULTS[item.shape]?.w ?? 100;
      const h = size.h ?? SHAPE_DEFAULTS[item.shape]?.h ?? 100;
      return buildBasicNode(item, topLeft(c, w, h));
    },
  })),
  {
    key: 'table', section: tr('기본 블록', 'Basic blocks'), label: tr('표', 'Table'), icon: <Table size={16} strokeWidth={1.8} />, keywords: 'table 테이블',
    build: (c) => {
      const { w, h } = SHAPE_DEFAULTS.table;
      return {
        id: `node-${Date.now()}`, type: 'custom', position: topLeft(c, w, h), width: w, height: h, zIndex: 0,
        data: {
          title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'table', width: w, height: h,
          bgColor: 'transparent', strokeColor: 'var(--canvas-ink)', fontColor: 'var(--canvas-ink)',
          tableRows: 3, tableCols: 3, tableHeaderRow: false,
          tableCells: Array.from({ length: 3 }, () => Array(3).fill('')),
        },
      };
    },
  },
  {
    key: 'entity', section: tr('기본 블록', 'Basic blocks'), label: tr('DB 테이블', 'DB table'), icon: <Database size={16} strokeWidth={1.8} />, keywords: 'db database erd entity table 디비 데이터베이스 테이블 엔티티 스키마',
    build: (c) => buildBlankEntity(topLeft(c, ENTITY.W, entityHeight(1))),
  },
  {
    key: 'code', section: tr('기본 블록', 'Basic blocks'), label: tr('코드', 'Code'), icon: <Code size={16} strokeWidth={1.8} />, keywords: 'code 코드 snippet 스니펫',
    build: (c) => {
      const w = SHAPE_DEFAULTS.code.w;
      const h = codeBoxHeight({ code: '' });
      return {
        id: `node-${Date.now()}`, type: 'custom', position: topLeft(c, w, h), width: w, height: h, zIndex: 0,
        data: {
          title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'code', width: w, height: h,
          code: '', codeLanguage: 'Plain Text',
        },
      };
    },
  },
  // 기기 목업 — 세로로만 넣음. 가로는 속성 패널의 방향 전환으로 (그래서 '가로'로 찾아도 나오게 키워드에 둠)
  ...([
    ['iphone', tr('아이폰 목업', 'iPhone mockup'),          'mockup iphone phone 아이폰 폰 휴대폰 스마트폰'],
    ['ipad11', tr('아이패드 Pro 11 목업', 'iPad Pro 11 mockup'), 'mockup ipad tablet pro 11 아이패드 태블릿 패드 11인치'],
    ['ipad13', tr('아이패드 Pro 13 목업', 'iPad Pro 13 mockup'), 'mockup ipad tablet pro 13 아이패드 태블릿 패드 13인치'],
  ] as const).map(([device, label, extra]): SlashItem => ({
    key: `mockup-${device}`, section: tr('기본 블록', 'Basic blocks'), label,
    icon: device === 'iphone' ? <Smartphone size={16} strokeWidth={1.8} /> : <Tablet size={16} strokeWidth={1.8} />,
    keywords: `목업 기기 디바이스 device 세로 가로 portrait landscape ${extra}`,
    build: (c) => {
      const { w, h } = mockupDefaultSize(device, false);
      return {
        id: `node-${Date.now()}`, type: 'custom', position: topLeft(c, w, h), width: w, height: h, zIndex: 0,
        data: { title: '', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'mockup', width: w, height: h, mockupDevice: device, mockupOrientation: 'portrait' },
      };
    },
  })),
  {
    key: 'frame', section: tr('기본 블록', 'Basic blocks'), label: tr('프레임', 'Frame'), icon: <Frame size={16} strokeWidth={1.8} />, keywords: 'frame 그룹 영역',
    build: (c) => {
      const { w, h } = SHAPE_DEFAULTS.frame;
      return {
        id: `node-${Date.now()}`, type: 'custom', position: topLeft(c, w, h), width: w, height: h,
        zIndex: -Math.ceil(w * h / 100),   // 프레임은 다른 노드 아래에 깔림
        data: { title: 'Frame', subtitle: '', icon: '', type: 'service', status: 'none', shape: 'frame', width: w, height: h },
      };
    },
  },
  ...TABLE_TEMPLATES.map((t): SlashItem => ({
    key: `template-${t.key}`, section: tr('템플릿', 'Templates'), label: t.label, icon: t.icon, keywords: 'template 템플릿 table 테이블',
    build: (c) => { const { w, h } = templateNodeSize(t); return buildTemplateNode(t, topLeft(c, w, h)); },
  })),
  ...ERD_TEMPLATES.map((t): SlashItem => ({
    key: `erd-${t.key}`, section: tr('템플릿', 'Templates'), label: t.label, icon: <Database size={16} strokeWidth={1.8} />,
    keywords: `template 템플릿 db erd database 디비 데이터베이스 설계 ${t.keywords}`,
    build: (c) => buildBlankEntity(c),   // 쓰이지 않음 — cluster로 놓음
    cluster: () => buildErd(t.title, t.tables),
  })),
  ...ARCH_CARDS.map(({ nodeType, label, icon }): SlashItem => ({
    key: `arch-${nodeType}`, section: tr('아키텍처', 'Architecture'), label, icon, keywords: nodeType.replace(/_/g, ' '),
    build: (c) => buildArchNode(nodeType, topLeft(c, ARCH_NODE_SIZE.w, ARCH_NODE_SIZE.h)),
  })),
  ...EXTERNAL_API_CARDS.map(({ nodeType, label, icon }): SlashItem => ({
    key: `api-${nodeType}`, section: tr('외부 API', 'External APIs'), label, icon, keywords: nodeType.replace(/_/g, ' '),
    build: (c) => buildArchNode(nodeType, topLeft(c, ARCH_NODE_SIZE.w, ARCH_NODE_SIZE.h)),
  })),
];

// ── 한글 초성 검색 ────────────────────────────────────────────
const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const toChoseong = (s: string) =>
  Array.from(s).map((ch) => {
    const code = ch.charCodeAt(0) - 0xac00;
    return code >= 0 && code < 11172 ? CHOSEONG[Math.floor(code / 588)] : ch;
  }).join('');

const matches = (item: SlashItem, query: string) => {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  const hay = `${item.label} ${item.section} ${item.keywords ?? ''}`.toLowerCase().replace(/\s+/g, '');
  return hay.includes(q) || toChoseong(hay).includes(q);
};

// ── 메뉴 ─────────────────────────────────────────────────────
const MENU_W = 300;
const MENU_H = 380;

export const SlashMenu = ({
  x, y, boundsW, boundsH, onSelect, onClose,
}: {
  x: number;            // 메뉴를 연 위치 (캔버스 영역 기준 px)
  y: number;
  boundsW: number;      // 캔버스 영역 크기 — 화면 밖으로 나가지 않게
  boundsH: number;
  onSelect: (item: SlashItem) => void;
  onClose: () => void;
}) => {
  const [query, setQuery]   = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => SLASH_ITEMS.filter((it) => matches(it, query)), [query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [query]);

  // 키보드로 고른 항목이 보이게 스크롤
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;   // 한글 조합 중 Enter/방향키는 조합 확정용
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) onSelect(filtered[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Backspace' && !query) { e.preventDefault(); onClose(); }   // Notion처럼 빈 상태에서 지우면 닫힘
  };

  // 오른쪽·아래 공간이 모자라면 반대쪽으로 펼침
  const left = x + MENU_W + 8 > boundsW ? Math.max(8, x - MENU_W) : x;
  const top  = y + MENU_H + 8 > boundsH ? Math.max(8, y - MENU_H) : y;

  let lastSection = '';
  return (
    <>
      {/* 바깥 클릭 시 닫힘 */}
      <div className={styles.backdrop} onMouseDown={(e) => { e.stopPropagation(); onClose(); }} />
      <div
        className={`${styles.menu} nowheel`}
        style={{ left, top, width: MENU_W, maxHeight: MENU_H }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className={styles.search}>
          <span className={styles.slash}>/</span>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={tr('검색어를 입력하세요', 'Type to search')}
          />
        </div>
        <div className={styles.list} ref={listRef}>
          {filtered.length === 0 && <div className={styles.empty}>{tr('검색 결과가 없습니다', 'No results')}</div>}
          {filtered.map((item, i) => {
            const header = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <div key={item.key}>
                {header && <div className={styles.section}>{header}</div>}
                <button
                  data-index={i}
                  className={`${styles.item} ${i === active ? styles.active : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onSelect(item)}
                >
                  <span className={styles.icon}>{item.icon}</span>
                  <span className={styles.label}>{item.label}</span>
                </button>
              </div>
            );
          })}
        </div>
        <button className={styles.footer} onClick={onClose}>
          <span>{tr('메뉴 닫기', 'Close menu')}</span>
          <span className={styles.kbd}>esc</span>
        </button>
      </div>
    </>
  );
};
