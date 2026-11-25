# Web Canvas

브라우저에서 바로 쓰는 그리기 캔버스입니다.

- 도형·글자·선/화살표·선택/이동·확대축소·되돌리기
- 심플 모드 (설정 → 심플 모드): 오른쪽 위 버튼을 설정 하나만 남김
- 저장: 로그인 없이 이 브라우저에만 (localStorage) · 파일로 저장/불러오기
- 서버·DB·외부 서비스 없음

## 파일 구성

- 프로젝트 목록(첫 화면): `public/index.html` · `public/style.css` · `public/app.js` — 순수 HTML·CSS·JS
- 캔버스 화면: `app/board/page.tsx` (주소 `board/?id=<프로젝트>`), 스타일 `public/canvas.css` — Tailwind 기본 스타일만 `app/globals.css`
- 둘 다 같은 localStorage 키를 씀 (`utils/projects.ts`, `public/app.js`)
- 배포 결과(gh-pages 브랜치): 맨 위에 `index.html`과 `style.css`

## 실행

```
npm install
npm run dev
```

라이선스 고지: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
