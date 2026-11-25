'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas }       from '@/components/Canvas';
import { RightSidebar } from '@/components/RightSidebar';
import { SaveDialog }   from '@/components/SaveDialog';
import { useCanvasStore }  from '@/store/canvasStore';
import { downloadCanvasFile, readCanvasFile } from '@/utils/canvasFile';
import type { AppNode, AppEdge } from '@/types';
import { tr } from '@/lib/i18n';
import { canvasKey, touchProject } from '@/utils/projects';

// 저장 위치: 이 브라우저의 localStorage만 (프로젝트마다 키 하나 — utils/projects.ts) — 로그인·서버·DB 없음

// 자동 저장 디바운스 지연 시간 (밀리초)
const AUTOSAVE_DELAY = 2000;

type CanvasSnapshot = { nodes: AppNode[]; edges: AppEdge[] };

interface FlowAreaProps {
  projectId: string;
  projectName: string;
  initialNodes: AppNode[];
  initialEdges: AppEdge[];
  rightCollapsed: boolean;
  onToggleRight: () => void;
}

// 저장 상태 타입
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// ReactFlowProvider + Canvas + RightSidebar를 함께 묶어
// dynamic(ssr:false)로 로드 → Next.js HMR과 ReactFlow 스토어 충돌 방지
export const FlowArea = ({
  projectId,
  projectName,
  initialNodes,
  initialEdges,
  rightCollapsed,
  onToggleRight,
}: FlowAreaProps) => {
  // ── 자동 저장 상태 ────────────────────────────────────────
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // 디바운스 타이머 ref (cleanup을 위해 ref에 보관)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 아직 저장하지 않은 변경 (디바운스 대기 중) — 화면을 떠날 때 바로 저장
  const pendingRef = useRef<CanvasSnapshot | null>(null);
  // 지금 캔버스 내용 (파일로 저장할 때 사용)
  const latestRef = useRef<CanvasSnapshot>({ nodes: initialNodes, edges: initialEdges });

  // ── 실제 저장 (localStorage) — await 없이 바로 끝나서 창이 닫히는 순간에도 안전
  const persist = useCallback(({ nodes, edges }: CanvasSnapshot) => {
    try {
      localStorage.setItem(canvasKey(projectId), JSON.stringify({ nodes, edges }));
      touchProject(projectId);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch {
      setSaveStatus('error');   // 용량 초과(큰 이미지 등)·사생활 보호 모드
    }
  }, [projectId]);

  // ── 대기 중인 변경을 지금 바로 저장 ──────────────────────
  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    persist(pending);
  }, [persist]);

  // ── 캔버스 변경 시 디바운스 자동 저장 ─────────────────────
  const handleCanvasChange = useCallback(
    (nodes: AppNode[], edges: AppEdge[]) => {
      latestRef.current  = { nodes, edges };
      pendingRef.current = { nodes, edges };

      // 이전 타이머 취소
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      setSaveStatus('saving');
      saveTimerRef.current = setTimeout(flushSave, AUTOSAVE_DELAY);
    },
    [flushSave]
  );

  // ── 화면을 떠날 때 즉시 저장 (탭 숨김·창 닫기·새로고침·언마운트) ──
  const flushSaveRef = useRef(flushSave);
  flushSaveRef.current = flushSave;

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSaveRef.current();
    };
    const onBeforeUnload = () => flushSaveRef.current();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => () => flushSaveRef.current(), []);

  // ── 저장 창: 파일로 저장 / 파일 불러오기 ─────────────────
  const saveDialogOpen    = useCanvasStore((s) => s.saveDialogOpen);
  const saveDialogAnchor  = useCanvasStore((s) => s.saveDialogAnchor);
  const setSaveDialogOpen = useCanvasStore((s) => s.setSaveDialogOpen);
  const [fileError, setFileError] = useState('');
  // 불러온 파일 내용 + Canvas를 새로 그리기 위한 버전 (key)
  const [loaded, setLoaded] = useState<(CanvasSnapshot & { version: number }) | null>(null);

  // 고른 파일 — 바로 바꾸지 않고 저장 메뉴 안에서 한 번 더 물음 (브라우저 기본 확인 창은 앱 안 브라우저에서 안 뜰 수 있음)
  const [pendingLoad, setPendingLoad] = useState<(CanvasSnapshot & { fileName: string }) | null>(null);

  const closeSaveDialog = useCallback(() => {
    setSaveDialogOpen(false);
    setFileError('');
    setPendingLoad(null);
  }, [setSaveDialogOpen]);

  const handleSaveFile = () => {
    const { nodes, edges } = latestRef.current;
    downloadCanvasFile(projectName, nodes, edges);
    closeSaveDialog();
  };

  const handleLoadFile = async (file: File) => {
    try {
      const data = await readCanvasFile(file);
      setFileError('');
      setPendingLoad({ ...data, fileName: file.name });
    } catch (err) {
      setPendingLoad(null);
      setFileError(err instanceof Error ? err.message : tr('파일을 불러오지 못했습니다.', 'Could not open the file.'));
    }
  };

  const confirmLoadFile = () => {
    if (!pendingLoad) return;
    try {
      const data = { nodes: pendingLoad.nodes, edges: pendingLoad.edges };
      flushSave();
      latestRef.current = data;
      setLoaded((prev) => ({ ...data, version: (prev?.version ?? 0) + 1 }));
      setSaveStatus('saving');
      persist(data);
      closeSaveDialog();
    } catch (err) {
      setFileError(err instanceof Error ? err.message : tr('파일을 불러오지 못했습니다.', 'Could not open the file.'));
    }
  };

  // ── 저장 상태 표시 텍스트 ────────────────────────────────
  const saveLabel =
    saveStatus === 'saving' ? tr('저장 중...', 'Saving...') :
    saveStatus === 'saved'  ? tr('저장됨', 'Saved')    :
    saveStatus === 'error'  ? tr('저장 실패', 'Save failed') :
    null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'flex' }}>
      <ReactFlowProvider>
        <Canvas
          key={loaded?.version ?? 0}
          initialNodes={loaded?.nodes ?? initialNodes}
          initialEdges={loaded?.edges ?? initialEdges}
          rightCollapsed={rightCollapsed}
          onCanvasChange={handleCanvasChange}
        />
        <RightSidebar
          collapsed={rightCollapsed}
          onToggle={onToggleRight}
        />
      </ReactFlowProvider>

      {saveDialogOpen && saveDialogAnchor && (
        <SaveDialog
          anchor={saveDialogAnchor}
          error={fileError}
          onSaveFile={handleSaveFile}
          onLoadFile={handleLoadFile}
          pendingFileName={pendingLoad?.fileName ?? null}
          onConfirmLoad={confirmLoadFile}
          onCancelLoad={() => setPendingLoad(null)}
          onClose={closeSaveDialog}
        />
      )}

      {/* 저장 상태 인디케이터 (우측 상단에 작게 표시) */}
      {saveLabel && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            background: saveStatus === 'error' ? '#E24B4A' : 'var(--bg-primary)',
            color: saveStatus === 'error' ? '#fff' : 'var(--text-tertiary)',
            border: '1px solid var(--border-light)',
            borderRadius: 6,
            padding: '4px 10px',
            fontSize: 12,
            fontWeight: 500,
            pointerEvents: 'none',
            zIndex: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {saveLabel}
        </div>
      )}
    </div>
  );
};
