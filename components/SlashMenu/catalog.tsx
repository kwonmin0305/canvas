// ═══════════════════════════════════════════════════════════
// 📁 components/SlashMenu/catalog.tsx
// '/' 메뉴로 넣는 요소 목록과 만드는 함수 — 기본 도형 · 표 템플릿 · 아키텍처 카드 · 외부 API 카드
// ═══════════════════════════════════════════════════════════

import {
  Smartphone, UserCog, Cloud, Server, Scale,
  Code2, Database, Zap, HardDrive,
  CreditCard, Lock,
  KeyRound, Sparkles, MessageSquare, Map, BarChart2,
  Search, Share2, ShieldCheck, Languages, Landmark,
  Table,
} from 'lucide-react';
import { withLastFont } from '@/store/canvasStore';
import type { NodeData, NodeShape, AppNode, NodeType } from '@/types';
import { tr } from '@/lib/i18n';

// ── SVG 아이콘 ───────────────────────────────────────────────
const IC = {
  rectangle: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="6" width="18" height="12" rx="2"/></svg>,
  circle:    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/></svg>,
  diamond:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><polygon points="12 2, 22 12, 12 22, 2 12"/></svg>,
  hexagon:   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><polygon points="21 16, 21 8, 12 3, 3 8, 3 16, 12 21"/></svg>,
  cylinder:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><ellipse cx="12" cy="6" rx="9" ry="3"/><path d="M3 6v12a9 3 0 0 0 18 0V6"/><path d="M3 12a9 3 0 0 0 18 0"/></svg>,
  cloud:     <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>,
  document:  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  note:      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>,
  // 네모 텍스트 상자: 사각형 + 텍스트 줄 아이콘
  rectText: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <line x1="6" y1="9.5"  x2="18" y2="9.5"/>
      <line x1="6" y1="12.5" x2="15" y2="12.5"/>
      <line x1="6" y1="15.5" x2="12" y2="15.5"/>
    </svg>
  ),
  // 동그라미 텍스트 상자: 원 + 중앙 텍스트 줄 아이콘
  circText: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="12" cy="12" r="9"/>
      <line x1="8"  y1="10.5" x2="16" y2="10.5"/>
      <line x1="8"  y1="13.5" x2="14" y2="13.5"/>
    </svg>
  ),
  // 섹션 헤더 화살표 (펼침 ▼ / 접힘 ▶)
  chevronDown: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>,
  chevronRight:<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>,
};

// ── 섹션 데이터 ──────────────────────────────────────────────

export interface BasicShapeItem {
  shape:      NodeShape;
  icon:       React.ReactNode;
  label:      string;
  extraData?: Record<string, unknown>;
  nodeW?:     number;
  nodeH?:     number;
}

export const BASIC_SHAPES: BasicShapeItem[] = [
  { shape: 'rectangle', icon: IC.rectangle, get label() { return tr('사각형', 'Rectangle'); } },
  { shape: 'circle',    icon: IC.circle,    get label() { return tr('원', 'Circle'); } },
  { shape: 'diamond',   icon: IC.diamond,   get label() { return tr('마름모', 'Diamond'); } },
  { shape: 'hexagon',   icon: IC.hexagon,   get label() { return tr('육각형', 'Hexagon'); } },
  {
    shape:     'rectangle',
    icon:      IC.rectText,
    get label() { return tr('네모 텍스트 상자', 'Text box'); },
    extraData: { isTextBox: true, title: '' },
    nodeW:     160,
    nodeH:     80,
  },
  {
    shape:     'circle',
    icon:      IC.circText,
    get label() { return tr('동그라미 텍스트 상자', 'Round text box'); },
    extraData: { isTextBox: true, title: '' },
    nodeW:     120,
    nodeH:     120,
  },
];

// ── 템플릿 (미리 채워진 표 노드) ─────────────────────────────
export interface TableTemplate {
  key:        string;
  label:      string;
  icon:       React.ReactNode;
  accent:     string;
  cols:       number;
  cellW:      number;
  cells:      string[][];
  cellMeta?:  Record<string, { colSpan?: number; rowSpan?: number; hidden?: boolean }>;
  cellAligns?: Record<string, 'left' | 'center' | 'right'>;
  cellColors?: Record<string, string>;
}

export const TABLE_TEMPLATES: TableTemplate[] = [
  {
    key:    'users',
    get label() { return tr('users 테이블', 'users table'); },
    icon:   <Table size={14} />,
    accent: '#facc15',
    cols:   2,
    cellW:  130,
    cells: [
      ['users', ''],
      ['UserID',           'bigint pk'],
      ['Email',            'citext unique'],
      ['PasswordHash',     'text'],
      ['CreatedAt',        'timestamptz'],
      ['LastLogin',        'timestamptz'],
      ['SubscriptionType', 'text'],
      ['Country',          'text'],
    ],
    cellMeta:   { '0-0': { colSpan: 2 }, '0-1': { hidden: true } },
    cellAligns: { '0-0': 'center' },
    cellColors: {
      '0-0': '#facc15',
      '1-1': 'rgba(255,255,255,0.55)', '2-1': 'rgba(255,255,255,0.55)',
      '3-1': 'rgba(255,255,255,0.55)', '4-1': 'rgba(255,255,255,0.55)',
      '5-1': 'rgba(255,255,255,0.55)', '6-1': 'rgba(255,255,255,0.55)',
      '7-1': 'rgba(255,255,255,0.55)',
    },
  },
];

const ARCH_TYPE_LABELS: Record<NodeType, string> = {
  client:       'Web App',
  mobile:       'Mobile App',
  admin:        'Admin',
  gateway:      'API Gateway',
  auth:         'Auth',
  api:          'External API',
  server:       'API Server',
  service:      'Services',
  worker:       'Worker',
  function:     'Function',
  database:     'Database',
  storage:      'Storage',
  cache:        'Cache',
  queue:        'Payment Gateway',
  message_bus:  'Email Service',
  cdn:          'CDN',
  load_balancer:'Load Balancer',
  container:    'Container',
  get payment_api() { return tr('결제 API', 'Payment API'); },
  get oauth_api() { return tr('인증 API', 'Auth API'); },
  ai_api:       'AI API',
  get messaging_api() { return tr('메시징 API', 'Messaging API'); },
  get maps_api() { return tr('지도 API', 'Maps API'); },
  get data_api() { return tr('데이터 API', 'Data API'); },
  get search_api() { return tr('검색 API', 'Search API'); },
  get social_api() { return tr('소셜 API', 'Social API'); },
  get security_api() { return tr('보안 API', 'Security API'); },
  get translate_api() { return tr('번역 API', 'Translation API'); },
  get finance_api() { return tr('금융 API', 'Finance API'); },
  api_server:   'API Server',
};

export const ARCH_CARDS: { nodeType: NodeType; label: string; icon: React.ReactNode }[] = [
  { nodeType: 'mobile',        label: 'Web / Mobile App', icon: <Smartphone   size={14} /> },
  { nodeType: 'admin',         label: 'Admin',            icon: <UserCog      size={14} /> },
  { nodeType: 'cdn',           label: 'CDN',              icon: <Cloud        size={14} /> },
  { nodeType: 'gateway',       label: 'API Gateway',      icon: <Server       size={14} /> },
  { nodeType: 'load_balancer', label: 'Load Balancer',    icon: <Scale        size={14} /> },
  { nodeType: 'api_server',    label: 'API Server',       icon: <Code2        size={14} /> },
  { nodeType: 'auth',          label: 'Auth',             icon: <Lock         size={14} /> },
  { nodeType: 'database',      label: 'Database',         icon: <Database     size={14} /> },
  { nodeType: 'cache',         label: 'Cache',            icon: <Zap          size={14} /> },
  { nodeType: 'storage',       label: 'Storage',          icon: <HardDrive    size={14} /> },
];

export const EXTERNAL_API_CARDS: { nodeType: NodeType; label: string; icon: React.ReactNode }[] = [
  { nodeType: 'payment_api',   get label() { return tr('결제 API', 'Payment API'); },   icon: <CreditCard    size={14} /> },
  { nodeType: 'oauth_api',     get label() { return tr('인증 API', 'Auth API'); },   icon: <KeyRound      size={14} /> },
  { nodeType: 'ai_api',        label: 'AI API',     icon: <Sparkles      size={14} /> },
  { nodeType: 'messaging_api', get label() { return tr('메시징 API', 'Messaging API'); }, icon: <MessageSquare size={14} /> },
  { nodeType: 'maps_api',      get label() { return tr('지도 API', 'Maps API'); },   icon: <Map           size={14} /> },
  { nodeType: 'data_api',      get label() { return tr('데이터 API', 'Data API'); }, icon: <BarChart2     size={14} /> },
  { nodeType: 'search_api',    get label() { return tr('검색 API', 'Search API'); },   icon: <Search        size={14} /> },
  { nodeType: 'social_api',    get label() { return tr('소셜 API', 'Social API'); },   icon: <Share2        size={14} /> },
  { nodeType: 'security_api',  get label() { return tr('보안 API', 'Security API'); },   icon: <ShieldCheck   size={14} /> },
  { nodeType: 'translate_api', get label() { return tr('번역 API', 'Translation API'); },   icon: <Languages     size={14} /> },
  { nodeType: 'finance_api',   get label() { return tr('금융 API', 'Finance API'); },   icon: <Landmark      size={14} /> },
];


const SHAPE_DEFAULTS: Partial<Record<NodeShape, Partial<{ title: string; subtitle: string; icon: string; type: NodeData['type']; status: NodeData['status'] }>>> = {
  rectangle: { get title() { return tr('텍스트', 'Text'); }, subtitle: '', icon: '',   type: 'mobile',    status: 'none' },
  circle:    { title: '',            subtitle: '', icon: '',   type: 'mobile',    status: 'none' },
  diamond:   { title: '',            subtitle: '', icon: '',   type: 'mobile',    status: 'none' },
  hexagon:   { title: '',            subtitle: '', icon: '',   type: 'mobile',    status: 'none' },
  cylinder:  { title: 'Database',    subtitle: 'DB',  icon: '', type: 'database', status: 'ok'   },
  cloud:     { get title() { return tr('외부 서비스', 'External service'); }, subtitle: 'API', icon: '', type: 'cdn',      status: 'ok'   },
  document:  { get title() { return tr('문서', 'Document'); }, subtitle: '',    icon: '', type: 'mobile',    status: 'ok'   },
  note:      { get title() { return tr('메모', 'Note'); }, subtitle: '',    icon: '', type: 'mobile',    status: 'ok'   },
  card:      { get title() { return tr('새 노드', 'New node'); }, subtitle: '',    icon: '', type: 'mobile',    status: 'none' },
};

// ── 노드 생성 (사이드바·슬래시 메뉴 공용) ─────────────────────
// 기본 도형 크기 — 지정이 없으면 노드 기본 크기를 따름(undefined)
export const basicNodeSize = ({ shape, nodeW, nodeH }: BasicShapeItem) => ({
  w: nodeW ?? (shape === 'card' ? 170 : undefined),
  h: nodeH ?? (shape === 'card' ? 160 : undefined),
});

export const buildBasicNode = (item: BasicShapeItem, position: { x: number; y: number }): AppNode => {
  const { shape, extraData } = item;
  const defaults = SHAPE_DEFAULTS[shape] ?? { title: tr('새 노드', 'New node'), subtitle: '', icon: '', type: 'service', status: 'none' };
  const { w, h } = basicNodeSize(item);
  return {
    id:       `node-${Date.now()}`,
    type:     'custom',
    position,
    width:    w,
    height:   h,
    data: {
      title:    defaults.title    ?? tr('새 노드', 'New node'),
      subtitle: defaults.subtitle ?? '',
      icon:     defaults.icon     ?? '',
      type:     defaults.type     ?? 'service',
      status:   defaults.status   ?? 'ok',
      shape,
      // 배경 없이 윤곽선만 — 캔버스 글자색(라이트: 진한 회색 / 다크: 밝은 회색)
      bgColor:     'transparent',
      strokeColor: 'var(--canvas-ink)',
      ...(extraData ?? {}),
    },
  };
};

export const templateNodeSize = (t: TableTemplate) => ({ w: t.cellW * t.cols, h: 30 * t.cells.length });

export const buildTemplateNode = (t: TableTemplate, position: { x: number; y: number }): AppNode => {
  const rows = t.cells.length;
  const cols = t.cols;
  const { w, h } = templateNodeSize(t);
  return {
    id:       `node-${Date.now()}`,
    type:     'custom',
    position,
    width:    w,
    height:   h,
    zIndex:   0,
    data: {
      title: '', subtitle: '', icon: '',
      type: 'service', status: 'none', shape: 'table',
      width: w, height: h,
      bgColor: '#161616', strokeColor: t.accent, fontColor: '#e2e8f0',
      borderRadius: 8,
      tableRows: rows, tableCols: cols, tableHeaderRow: true,
      tableCells:      t.cells,
      tableCellMeta:   t.cellMeta,
      tableCellAligns: t.cellAligns,
      tableCellColors: t.cellColors,
    },
  };
};

export const ARCH_NODE_SIZE = { w: 170, h: 160 };

export const buildArchNode = (nodeType: NodeType, position: { x: number; y: number }): AppNode => ({
  id:       `node-${Date.now()}`,
  type:     'custom',
  position,
  width:    ARCH_NODE_SIZE.w,
  height:   ARCH_NODE_SIZE.h,
  data: {
    title:    ARCH_TYPE_LABELS[nodeType],
    subtitle: '',
    icon:     '',
    type:     nodeType,
    status:   'none',
    shape:    'card',
  },
});

