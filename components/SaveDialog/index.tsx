'use client';

// ═══════════════════════════════════════════════════════════
// 📁 components/SaveDialog/index.tsx
// 저장 말풍선 — 저장 버튼 바로 아래에 붙어 뜨는 작은 메뉴
// 화면을 가리지 않아 열어 둔 채로 계속 작업할 수 있음
//   내 컴퓨터에 저장 / 저장한 파일 불러오기 (고른 뒤 이 말풍선 안에서 바꿀지 한 번 더 물음)
//   코딩용으로 내보내기 — 기획·설계 결과물을 마크다운으로 (utils/specExport.ts)
// (온라인 저장은 자동 저장이 맡으므로 여기엔 없음)
// ═══════════════════════════════════════════════════════════

import { useEffect, useRef } from 'react';
import { Download, FileUp } from 'lucide-react';
import { FILE_ACCEPT } from '@/utils/canvasFile';
import { tr } from '@/lib/i18n';

interface SaveDialogProps {
  anchor:     { top: number; right: number };
  error:      string;
  onSaveFile: () => void;
  onLoadFile: (file: File) => void;
  pendingFileName: string | null;   // 골라 둔 파일 — 있으면 바꿀지 묻는 화면
  onConfirmLoad:   () => void;
  onCancelLoad:    () => void;
  onClose:    () => void;
}

export const SaveDialog = ({ anchor, error, onSaveFile, onLoadFile, pendingFileName, onConfirmLoad, onCancelLoad, onClose }: SaveDialogProps) => {
  const boxRef       = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Esc 또는 말풍선 바깥 클릭으로 닫기 (저장 버튼은 자체 토글이므로 제외)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (boxRef.current?.contains(t) || t.closest('[data-save-trigger]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const options = [
    {
      icon: <Download size={16} strokeWidth={1.8} />,
      title: tr('내 컴퓨터에 저장', 'Save to my computer'),
      desc: tr('파일로 내려받기', 'Download as a file'),
      onClick: onSaveFile,
    },
    {
      icon: <FileUp size={16} strokeWidth={1.8} />,
      title: tr('파일 불러오기', 'Open file'),
      desc: tr('저장한 파일로 캔버스 바꾸기', 'Replace the canvas with a saved file'),
      onClick: () => fileInputRef.current?.click(),
    },
  ];

  return (
    <div
      ref={boxRef}
      className="fixed z-[10000] w-[240px] bg-bg-primary border border-border-light rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.18)] p-1.5"
      style={{ top: anchor.top + 8, right: Math.max(8, anchor.right - 4), animation: 'saveBubbleIn 0.14s ease-out' }}
    >
      {/* 말풍선 꼬리 — 저장 버튼 가운데(오른쪽에서 버튼 반 너비)를 가리킴 */}
      <div
        className="absolute -top-[6px] w-[10px] h-[10px] rotate-45 bg-bg-primary border-l border-t border-border-light"
        style={{ right: 15 }}
      />

      {pendingFileName ? (
        // 불러오기 확인 — 지금 탭 캔버스가 파일 내용으로 바뀜 (확인 버튼은 앱 툴바처럼 무채색: 라이트 검정 · 다크 흰색)
        <div className="relative px-2 py-2 flex flex-col gap-2">
          <p className="text-[12px] leading-relaxed text-text-primary m-0">
            {tr('', 'Replace this tab\'s canvas with ')}<span className="font-semibold break-all">{pendingFileName}</span>{tr(' 파일로 지금 탭의 캔버스를 바꿀까요?', '?')}
          </p>
          <p className="text-[12px] text-text-tertiary m-0">{tr('지금 캔버스 내용은 파일 내용으로 덮어써집니다.', 'The current canvas will be overwritten by the file.')}</p>
          <div className="flex gap-1.5">
            <button
              onClick={onConfirmLoad}
              className="flex-1 h-8 rounded-lg border-none cursor-pointer text-[12px] font-semibold text-bg-primary bg-text-primary hover:opacity-85"
            >
              {tr('바꾸기', 'Replace')}
            </button>
            <button
              onClick={onCancelLoad}
              className="flex-1 h-8 rounded-lg border border-border-light cursor-pointer text-[12px] text-text-secondary bg-transparent hover:bg-hover-bg"
            >
              {tr('취소', 'Cancel')}
            </button>
          </div>
        </div>
      ) : options.map((o) => (
        <button
          key={o.title}
          onClick={o.onClick}
          className="relative w-full flex items-center gap-2.5 px-2 py-2 rounded-lg bg-transparent border-none cursor-pointer text-left hover:bg-hover-bg transition-colors"
        >
          {/* 앱 툴바 아이콘과 같은 톤 — 색 원 대신 옅은 사각 타일 */}
          <span className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center bg-[rgba(var(--ui-fg-rgb),0.06)] text-text-secondary">
            {o.icon}
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-text-primary">{o.title}</span>
            <span className="text-[12px] text-text-tertiary">{o.desc}</span>
          </span>
        </button>
      ))}

      {error && <p className="text-[12px] text-[#EF4444] px-2 pt-1 pb-1.5 m-0">{error}</p>}

      <input
        ref={fileInputRef}
        type="file"
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // 같은 파일을 다시 골라도 onChange가 불리도록
          if (file) onLoadFile(file);
        }}
      />

      <style>{`@keyframes saveBubbleIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
};
