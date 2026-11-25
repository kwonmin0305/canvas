# 외부 저작물·라이선스 고지 (Third-Party Notices) — Web Canvas

Web Canvas가 쓰는 남의 폰트·아이콘·라이브러리와 그 조건을 모아 둔 문서.
앱 안의 `/licenses` 페이지(`app/licenses/page.tsx`, 데이터는 `constants/thirdParty.ts`)가 같은 내용을 보여 준다.

> 새 폰트·아이콘·라이브러리를 넣으면 이 문서와 `constants/thirdParty.ts`를 같이 고친다.
> 원본 Course(vibestructure)의 고지에서 이 복제본에 실제로 들어 있는 것만 남김 — 2026-11-25
> Web Canvas는 외부 서비스(로그인·AI·통계 등)를 쓰지 않는다. 그래서 원본의 "외부 서비스" 절은 뺐다.

---

## 1. 폰트 (모두 SIL Open Font License 1.1)

| 폰트 | 파일 / 제공 방식 | 저작권 | 라이선스 원문 |
|---|---|---|---|
| Excalifont (영문 손글씨) | `public/fonts/Excalifont-Regular.woff2` | Copyright (c) 2024 by Excalidraw. Designer: Your Own Font Foundry (Virgil); Ján Filípek / DizajnDesign | `public/fonts/OFL-Excalifont.txt` |
| Xiaolai (小赖字体) 한글 서브셋 | `public/fonts/Xiaolai-KR-*.woff2` | Copyright 2020-2024 LXGW, Copyright 2014 Nozomi Seto | `public/fonts/OFL-Xiaolai.txt` |
| Pretendard 1.3.9 | npm 패키지 `pretendard` | Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name Pretendard | `public/fonts/OFL-Pretendard.txt` |

- 조건: 상업적 사용·앱에 넣기·수정 가능 / 배포 시 라이선스 동봉 / **폰트 파일만 따로 판매 금지**
- Pretendard는 예약된 폰트 이름이 있어서, 폰트 파일을 고쳐 배포하면 이름을 바꿔야 함 (그대로 쓰는 건 문제없음)

## 2. 아이콘

- **Lucide** (lucide-react 1.8.0) — ISC, Copyright (c) 2026 Lucide Icons and Contributors — https://lucide.dev
  - 일부 아이콘은 Feather에서 파생 — MIT, Copyright (c) 2013-present Cole Bemis
  - `lib/wireframe/icons.ts`에 Lucide 아이콘 선 데이터 일부를 옮겨 둠 (같은 ISC 조건)

## 3. 라이브러리 (앱에 포함되어 배포됨)

| 이름 | 버전 | 라이선스 | 저작권자 | 출처 |
|---|---|---|---|---|
| Next.js | 14.2.35 | MIT | Vercel, Inc. | https://github.com/vercel/next.js |
| React / React DOM | 18.3.1 | MIT | Facebook, Inc. and its affiliates | https://github.com/facebook/react |
| React Flow (@xyflow/react) | 12.10.2 | MIT | webkid GmbH | https://github.com/xyflow/xyflow |
| Zustand | 5.0.12 | MIT | Paul Henschel | https://github.com/pmndrs/zustand |
| zundo | 2.3.0 | MIT | Charles Kornoelje | https://github.com/charkour/zundo |
| Prism | 1.30.0 | MIT | Lea Verou | https://github.com/PrismJS/prism |
| prism-react-renderer | 2.4.1 | MIT | Nearform | https://github.com/FormidableLabs/prism-react-renderer |
| html-to-image | 1.11.13 | MIT | W.Y. | https://github.com/bubkoo/html-to-image |
| lucide-react | 1.8.0 | ISC | Lucide Icons and Contributors | https://github.com/lucide-icons/lucide |
| Tailwind CSS (만든 CSS에 일부 포함) | 3.4.19 | MIT | Tailwind Labs, Inc. | https://github.com/tailwindlabs/tailwindcss |

- 개발할 때만 쓰는 도구(TypeScript, PostCSS, autoprefixer, @types/*)는 앱에 포함되지 않아 고지 대상 아님.

### MIT 라이선스 전문 (위 MIT 항목 공통)

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ISC 라이선스 전문 (Lucide)

```
Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## 4. 상표

Excalidraw는 Excalidraw의 상표. Web Canvas는 Excalidraw와 제휴·후원 관계가 아니며, 이름은 폰트 출처를 밝히는 용도로만 쓴다.

---

*이 문서는 법률 자문이 아니다. 유료화·대규모 배포 전에는 전문가 검토를 받을 것.*
