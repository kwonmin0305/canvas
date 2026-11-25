import type { AppNode, AppEdge, NodeType, NodeStatus } from '@/types';
import { tr } from '@/lib/i18n';

// ── 초기 노드 데이터 (React Flow 포맷) ─────────────────────────
// 첫 화면: 손글씨 인사 글상자 하나 ('안녕하세요')
// 글자 크기 = 높이 × fontScale → 48px
const WELCOME_W = 300;
const WELCOME_H = 72;
export const INITIAL_NODES: AppNode[] = [
  {
    id: 'welcome', type: 'custom', position: { x: -WELCOME_W / 2, y: -WELCOME_H / 2 },
    width: WELCOME_W, height: WELCOME_H, zIndex: 0,
    data: {
      title: tr('안녕하세요', 'Hello'), subtitle: '', icon: '', type: 'service', status: 'none',
      shape: 'text', width: WELCOME_W, height: WELCOME_H,
      bgColor: 'transparent', strokeColor: 'transparent', fontScale: 48 / WELCOME_H, fontWeight: 'normal',
      fontFamily: 'handwriting',
    },
  },
];

// ── 노드 타입별 색상 ─────────────────────────────────────────
export const NODE_COLORS: Record<NodeType, { bg: string; border: string; accent: string; text: string }> = {
  gateway:  { bg: '#111111', border: '#222222', accent: '#6366f1', text: '#ffffff' },
  database: { bg: '#111111', border: '#222222', accent: '#22c55e', text: '#ffffff' },
  
  storage:  { bg: '#111111', border: '#222222', accent: '#3b82f6', text: '#ffffff' },
 
 
  cache:    { bg: '#111111', border: '#222222', accent: '#eab308', text: '#ffffff' },
 
  cdn:          { bg: '#111111', border: '#222222', accent: '#06b6d4', text: '#ffffff' },
  auth:         { bg: '#111111', border: '#222222', accent: '#ef4444', text: '#ffffff' },
 
  
  load_balancer:{ bg: '#111111', border: '#222222', accent: '#0ea5e9', text: '#ffffff' },
  api_server:   { bg: '#111111', border: '#222222', accent: '#8b5cf6', text: '#ffffff' },
  container:    { bg: '#111111', border: '#222222', accent: '#f43f5e', text: '#ffffff' },
 
  mobile:       { bg: '#111111', border: '#222222', accent: '#38bdf8', text: '#ffffff' },
  admin:        { bg: '#111111', border: '#222222', accent: '#a78bfa', text: '#ffffff' },
  payment_api:  { bg: '#111111', border: '#222222', accent: '#10b981', text: '#ffffff' },
  oauth_api:    { bg: '#111111', border: '#222222', accent: '#f59e0b', text: '#ffffff' },
  ai_api:       { bg: '#111111', border: '#222222', accent: '#a855f7', text: '#ffffff' },
  messaging_api:{ bg: '#111111', border: '#222222', accent: '#0ea5e9', text: '#ffffff' },
  maps_api:     { bg: '#111111', border: '#222222', accent: '#34d399', text: '#ffffff' },
  data_api:     { bg: '#111111', border: '#222222', accent: '#fb923c', text: '#ffffff' },
  search_api:   { bg: '#111111', border: '#222222', accent: '#60a5fa', text: '#ffffff' },
  social_api:   { bg: '#111111', border: '#222222', accent: '#f472b6', text: '#ffffff' },
  security_api: { bg: '#111111', border: '#222222', accent: '#f87171', text: '#ffffff' },
  translate_api:{ bg: '#111111', border: '#222222', accent: '#818cf8', text: '#ffffff' },
  finance_api:  { bg: '#111111', border: '#222222', accent: '#fbbf24', text: '#ffffff' },
  client:       { bg: '#111111', border: '#222222', accent: '#38bdf8', text: '#ffffff' },
  worker:       { bg: '#111111', border: '#222222', accent: '#fb923c', text: '#ffffff' },
  server:       { bg: '#111111', border: '#222222', accent: '#8b5cf6', text: '#ffffff' },
  service:      { bg: '#111111', border: '#222222', accent: '#6366f1', text: '#ffffff' },
  queue:        { bg: '#111111', border: '#222222', accent: '#f59e0b', text: '#ffffff' },
  message_bus:  { bg: '#111111', border: '#222222', accent: '#0ea5e9', text: '#ffffff' },
  api:          { bg: '#111111', border: '#222222', accent: '#34d399', text: '#ffffff' },
  function:     { bg: '#111111', border: '#222222', accent: '#a855f7', text: '#ffffff' },
};

// ── 상태별 색상 ──────────────────────────────────────────────
export const STATUS_COLORS: Record<NodeStatus, { dot: string; badge: string; text: string }> = {
  ok:   { dot: '#22C55E', badge: '#F0FDF4', text: '#15803D' },
  err:  { dot: '#EF4444', badge: '#FEF2F2', text: '#B91C1C' },
  warn: { dot: '#F59E0B', badge: '#FFFBEB', text: '#B45309' },
  none: { dot: 'transparent', badge: 'transparent', text: 'transparent' },
};

export const getNodeColor   = (type: NodeType)     => NODE_COLORS[type]   ?? NODE_COLORS.mobile;
export const getStatusColor = (status: NodeStatus) => STATUS_COLORS[status] ?? STATUS_COLORS.ok;
