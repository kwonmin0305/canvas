/** @type {import('next').NextConfig} */
// GitHub Pages(무료 호스팅)용 정적 내보내기 — `next build` 하면 out/ 폴더에 HTML·JS가 만들어짐
//   Pages 주소는 https://<계정>.github.io/canvas/ 라서, 배포할 때만 PAGES_BASE_PATH=/canvas 를 줌
//   (로컬 npm run dev 는 그대로 http://localhost:3000/)
//
//   첫 화면(프로젝트 목록)은 public/index.html — 내보낼 때는 out/index.html로 그대로 복사됨
//   개발 서버는 public/index.html을 '/'에 자동으로 보여 주지 않아서, 개발 때만 '/'를 그 파일로 연결
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

const basePath = process.env.PAGES_BASE_PATH || '';

module.exports = (phase) => {
  const dev = phase === PHASE_DEVELOPMENT_SERVER;
  return {
    reactStrictMode: true,
    ...(dev
      ? { async rewrites() { return [{ source: '/', destination: '/index.html' }]; } }
      : { output: 'export' }),
    trailingSlash: true,
    basePath,
    env: { NEXT_PUBLIC_BASE_PATH: basePath },   // app/layout.tsx가 canvas.css 주소에 붙임
    images: { unoptimized: true },
  };
};
