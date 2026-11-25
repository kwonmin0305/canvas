/** @type {import('next').NextConfig} */
// GitHub Pages(무료 호스팅)용 정적 내보내기 — `next build` 하면 out/ 폴더에 HTML·JS가 만들어짐
//   Pages 주소는 https://<계정>.github.io/canvas/ 라서, 배포할 때만 PAGES_BASE_PATH=/canvas 를 줌
//   (로컬 npm run dev 는 그대로 http://localhost:3000/)
const basePath = process.env.PAGES_BASE_PATH || '';

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
};

module.exports = nextConfig;
