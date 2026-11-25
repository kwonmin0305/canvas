'use client';

// ═══════════════════════════════════════════════════════════
// 📁 app/board/page.tsx
// 캔버스 화면 — 주소: board/?id=<프로젝트 id> (프로젝트 목록은 public/index.html)
//
//   저장 위치: 이 브라우저의 localStorage만 (utils/projects.ts) — 로그인·서버·DB 없음
//   없는 프로젝트 id면 목록으로 돌려보냄
//
//   왼쪽 위: 목록으로 돌아가기 + 프로젝트 이름
//   오른쪽 위 버튼: 설정 · 저장(파일) · 테마
//   심플 모드(설정에서 켬): 설정 버튼과 돌아가기 버튼만 남김 — 브라우저에 기억
// ═══════════════════════════════════════════════════════════

import dynamic from 'next/dynamic';
import { useState, useEffect, useRef } from 'react';
import { Map as MapIcon, Ruler, MoveVertical, Minimize2 } from 'lucide-react';

import { useSidebar }     from '@/hooks/useSidebar';
import { useTheme }       from '@/hooks/useTheme';
import { useCanvasStore } from '@/store/canvasStore';
import { INITIAL_NODES }  from '@/utils/nodeData';
import { canvasKey, findProject, type ProjectMeta } from '@/utils/projects';
import type { AppNode, AppEdge } from '@/types';

// 캔버스 영역 — SSR 끔 (React Flow는 브라우저 전용)
const FlowArea = dynamic(
  () => import('@/components/FlowArea').then((m) => ({ default: m.FlowArea })),
  { ssr: false, loading: () => null },
);

// 설정 드롭다운 안의 on/off 토글 (클릭은 감싸는 줄이 처리)
const Toggle = ({ on }: { on: boolean }) => (
  <div
    style={{
      width: 30, height: 16, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--green-primary)' : 'var(--border-lighter)',
      position: 'relative', transition: 'background 0.2s',
    }}
  >
    <div style={{
      position: 'absolute', top: 2, left: on ? 16 : 2,
      width: 12, height: 12, borderRadius: '50%',
      background: '#fff', transition: 'left 0.2s',
    }} />
  </div>
);

// 오른쪽 위 아이콘 버튼 공통 클래스 (32×32)
const iconBtnCls = 'w-8 h-8 flex items-center justify-center bg-transparent border border-border-light rounded-lg cursor-pointer text-text-secondary transition-colors hover:bg-hover-bg hover:text-text-primary';

export default function CanvasPage() {
  const { sidebar, toggleRightSidebar, mounted } = useSidebar();

  // 폰 화면(640px 이하) — 오른쪽 패널이 화면 전체를 덮어서 위쪽 버튼을 옆으로 밀지 않음
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const panelBeside = !sidebar.rightCollapsed && !isPhone;

  // 주소의 프로젝트 찾기 → 저장된 캔버스 읽기 (없으면 인사 글상자 하나)
  const [project, setProject] = useState<ProjectMeta | null>(null);
  const [initial, setInitial] = useState<{ nodes: AppNode[]; edges: AppEdge[] } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id') ?? '';
    const p = id ? findProject(id) : undefined;
    if (!p) { window.location.replace('../'); return; }
    setProject(p);
    document.title = p.name;
    try {
      const saved = localStorage.getItem(canvasKey(p.id));
      if (saved) {
        const { nodes, edges } = JSON.parse(saved);
        setInitial({ nodes: (nodes as AppNode[]) ?? INITIAL_NODES, edges: (edges as AppEdge[]) ?? [] });
        return;
      }
    } catch { /* 깨진 값이면 새로 시작 */ }
    setInitial({ nodes: INITIAL_NODES, edges: [] });
  }, []);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  const { theme, toggleTheme } = useTheme();
  const showMiniMap       = useCanvasStore((s) => s.showMiniMap);
  const toggleMiniMap     = useCanvasStore((s) => s.toggleMiniMap);
  const snapGuides        = useCanvasStore((s) => s.snapGuides);
  const toggleSnapGuides  = useCanvasStore((s) => s.toggleSnapGuides);
  const wheelPan          = useCanvasStore((s) => s.wheelPan);
  const toggleWheelPan    = useCanvasStore((s) => s.toggleWheelPan);
  const simpleMode        = useCanvasStore((s) => s.simpleMode);
  const toggleSimpleMode  = useCanvasStore((s) => s.toggleSimpleMode);
  const saveDialogOpen    = useCanvasStore((s) => s.saveDialogOpen);
  const setSaveDialogOpen = useCanvasStore((s) => s.setSaveDialogOpen);

  // 설정 드롭다운 바깥을 누르면 닫기 (캔버스가 전파를 막아서 capture 단계에서 받음)
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: PointerEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', handler, true);
    return () => document.removeEventListener('pointerdown', handler, true);
  }, [settingsOpen]);

  if (!mounted || !initial || !project) return null;

  return (
    <div className="bg-bg-primary transition-colors duration-300 flex flex-col w-screen h-screen overflow-hidden">
      <div className="flex-1 flex overflow-hidden relative">

        {/* 왼쪽 위: 목록으로 + 프로젝트 이름 (심플 모드면 이름 숨김) */}
        <div className="absolute top-[14px] left-[14px] z-[100] flex items-center gap-2">
          <a href="../" className={`${iconBtnCls} no-underline`} title="프로젝트 목록">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </a>
          {!simpleMode && (
            <span className="text-[14px] font-semibold text-text-primary select-none truncate max-w-[40vw]">
              {project.name}
            </span>
          )}
        </div>

        {/* 오른쪽 위: 버튼 모음 */}
        <div
          className="absolute top-[14px] z-[100] flex gap-1 items-center"
          style={{
            // 심플 모드 + 패널 접힘: 패널 열기 버튼(38px)이 맨 위 오른쪽으로 올라오므로 그 왼쪽에
            right: !panelBeside ? (simpleMode ? 14 + 38 + 8 : 14) : 216 + 14,
            top: simpleMode && !panelBeside ? 14 + 3 : 14,
            transition: 'right 0.25s cubic-bezier(.4,0,.2,1)',
          }}
        >
          {/* 설정 버튼 + 드롭다운 */}
          <div ref={settingsRef} className="relative">
            <button
              className={`${iconBtnCls} ${settingsOpen ? 'bg-hover-bg' : ''}`}
              onClick={() => setSettingsOpen((v) => !v)}
              title="설정"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>

            {settingsOpen && (
              <div className="absolute top-[calc(100%+6px)] right-0 w-[236px] bg-bg-primary border border-border-light rounded-[10px] shadow-[0_8px_24px_rgba(0,0,0,0.15)] py-1.5 z-[9999]">
                <div className="px-3 pt-1 pb-1.5 text-[12px] font-semibold text-text-tertiary uppercase tracking-[0.06em]">
                  캔버스 설정
                </div>

                {[
                  { Icon: MapIcon,      label: '미니맵',           on: showMiniMap, toggle: toggleMiniMap },
                  { Icon: Ruler,        label: '정렬 가이드',      on: snapGuides,  toggle: toggleSnapGuides },
                  { Icon: MoveVertical, label: '휠로 위아래 이동', on: wheelPan,    toggle: toggleWheelPan },
                  { Icon: Minimize2,    label: '심플 모드',        on: simpleMode,  toggle: toggleSimpleMode },
                ].map(({ Icon, label, on, toggle }) => (
                  <div
                    key={label}
                    onClick={toggle}
                    className="flex items-center justify-between px-3 py-[7px] cursor-pointer hover:bg-hover-bg transition-colors"
                  >
                    <span className="flex items-center gap-2 text-xs text-text-primary">
                      <Icon size={13} strokeWidth={1.8} className="text-text-secondary" />{label}
                    </span>
                    <Toggle on={on} />
                  </div>
                ))}

                <div className="h-px bg-border-light my-1.5" />
                <a
                  href="../licenses/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setSettingsOpen(false)}
                  className="block px-3 py-1.5 text-[12px] text-text-tertiary hover:text-text-primary no-underline transition-colors"
                >
                  오픈소스 라이선스
                </a>
              </div>
            )}
          </div>

          {/* 저장 버튼 — 파일로 저장 / 불러오기 (심플 모드면 숨김) */}
          {!simpleMode && (
            <button
              className={`${iconBtnCls} ${saveDialogOpen ? 'bg-hover-bg' : ''}`}
              title="저장"
              data-save-trigger
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setSaveDialogOpen(!saveDialogOpen, { top: r.bottom, right: window.innerWidth - r.right });
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
          )}

          {/* 테마 전환 (심플 모드면 숨김) */}
          {!simpleMode && (
            <button className={iconBtnCls} onClick={toggleTheme} title="테마 전환">
              {theme?.isDark
                ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
                : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              }
            </button>
          )}
        </div>

        {/* 실제 캔버스 — React Flow 기반 */}
        <FlowArea
          projectId={project.id}
          projectName={project.name}
          initialNodes={initial.nodes}
          initialEdges={initial.edges}
          rightCollapsed={sidebar.rightCollapsed}
          onToggleRight={toggleRightSidebar}
        />
      </div>
    </div>
  );
}
