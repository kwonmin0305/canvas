import type { Metadata } from 'next';
import './globals.css';   // Tailwind 기본 스타일
// 기본 글꼴 Pretendard — SIL Open Font License 1.1 (THIRD_PARTY_NOTICES.md)
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css';

export const metadata: Metadata = {
  title: { default: '캔버스', template: '%s' },
  description: '브라우저에서 바로 쓰는 그리기 캔버스',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // 기본은 라이트 모드 — 다크를 고른 적이 있으면 그리기 전에 바로 적용해 깜빡임 방지
    <html lang="ko" suppressHydrationWarning>
      <head>
        {/* 캔버스 화면 스타일 — public/canvas.css (배포 주소의 하위 경로까지 붙여서) */}
        <link rel="stylesheet" href={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/canvas.css`} />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('web-canvas-theme')==='dark')document.documentElement.classList.add('dark-mode')}catch(e){}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
