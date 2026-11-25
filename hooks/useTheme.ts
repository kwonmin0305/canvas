'use client';

import { useEffect, useState } from 'react';
import { ThemeMode } from '@/types';

export const useTheme = () => {
  const [theme, setTheme] = useState<ThemeMode>({ isDark: false });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // 처음 방문(저장값 없음) → 라이트 모드
    const isDark = localStorage.getItem('web-canvas-theme') === 'dark';

    setTheme({ isDark });
    document.documentElement.classList.toggle('dark-mode', isDark);
  }, []);

  const toggleTheme = () => {
    const newIsDark = !theme.isDark;
    setTheme({ isDark: newIsDark });
    localStorage.setItem('web-canvas-theme', newIsDark ? 'dark' : 'light');

    if (newIsDark) {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  };

  return { theme, toggleTheme, mounted };
};
