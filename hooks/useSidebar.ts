'use client';

import { useEffect, useState } from 'react';
import { SidebarState } from '@/types';

// 폰 화면(640px 이하) — 오른쪽 패널이 화면 전체를 덮으므로(RightSidebar.module.css)
//   열 때마다 닫힌 채로 시작하고, 폰에서 여닫은 건 저장하지 않음 (컴퓨터에서 정한 값 유지)
const isPhone = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

export const useSidebar = () => {
  const [sidebar, setSidebar] = useState<SidebarState>({
    leftCollapsed: true,  // 기본값: 접힌 상태
    rightCollapsed: true,
  });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // localStorage에 저장된 값이 없으면(null) 기본값 true(접힘) 사용
    const leftStored  = localStorage.getItem('left-sidebar-collapsed');
    const rightStored = localStorage.getItem('right-sidebar-collapsed');
    const leftCollapsed  = leftStored  !== null ? leftStored  === 'true' : true;
    const rightCollapsed = isPhone() || (rightStored !== null ? rightStored === 'true' : true);
    setSidebar({ leftCollapsed, rightCollapsed });
  }, []);

  const toggleLeftSidebar = () => {
    const newLeftCollapsed = !sidebar.leftCollapsed;
    setSidebar(prev => ({ ...prev, leftCollapsed: newLeftCollapsed }));
    localStorage.setItem('left-sidebar-collapsed', String(newLeftCollapsed));
  };

  const toggleRightSidebar = () => {
    const newRightCollapsed = !sidebar.rightCollapsed;
    setSidebar(prev => ({ ...prev, rightCollapsed: newRightCollapsed }));
    if (!isPhone()) localStorage.setItem('right-sidebar-collapsed', String(newRightCollapsed));
  };

  return { sidebar, toggleLeftSidebar, toggleRightSidebar, mounted };
};
