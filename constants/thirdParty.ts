// ═══════════════════════════════════════════════════════════
// 📁 constants/thirdParty.ts
// 오픈소스 라이선스 고지 — /licenses 페이지가 보여 주는 목록 (Web Canvas 복제본)
//   원본 문서는 THIRD_PARTY_NOTICES.md — 새 폰트·아이콘·라이브러리를 넣으면 둘 다 고침
// ═══════════════════════════════════════════════════════════

export interface ThirdPartyItem {
  name:      string;
  version?:  string;
  license:   'MIT' | 'ISC' | 'OFL-1.1';
  copyright: string;
  url:       string;
  note?:     string;
}

export const FONTS: ThirdPartyItem[] = [
  {
    name: 'Excalifont', license: 'OFL-1.1',
    copyright: 'Copyright (c) 2024 by Excalidraw. Designer: Your Own Font Foundry (Virgil); Ján Filípek / DizajnDesign',
    url: 'https://plus.excalidraw.com/excalifont',
    note: '영문 손글씨 · 라이선스 원문: /fonts/OFL-Excalifont.txt',
  },
  {
    name: 'Xiaolai (小赖字体) — 한글 서브셋', license: 'OFL-1.1',
    copyright: 'Copyright 2020-2024 LXGW, Copyright 2014 Nozomi Seto',
    url: 'https://github.com/lxgw/kose-font',
    note: '한글 손글씨 · 라이선스 원문: /fonts/OFL-Xiaolai.txt',
  },
  {
    name: 'Pretendard', version: '1.3.9', license: 'OFL-1.1',
    copyright: 'Copyright (c) 2021, Kil Hyung-jin, with Reserved Font Name Pretendard',
    url: 'https://github.com/orioncactus/pretendard',
    note: '기본 글꼴 · 라이선스 원문: /fonts/OFL-Pretendard.txt',
  },
];

export const ICONS: ThirdPartyItem[] = [
  {
    name: 'Lucide', version: '1.8.0', license: 'ISC',
    copyright: 'Copyright (c) 2026 Lucide Icons and Contributors',
    url: 'https://lucide.dev',
  },
  {
    name: 'Feather (Lucide 일부 아이콘의 원본)', license: 'MIT',
    copyright: 'Copyright (c) 2013-present Cole Bemis',
    url: 'https://github.com/feathericons/feather',
  },
];

export const LIBRARIES: ThirdPartyItem[] = [
  { name: 'Next.js',               version: '14.2.35', license: 'MIT', copyright: 'Copyright (c) 2024 Vercel, Inc.',                  url: 'https://github.com/vercel/next.js' },
  { name: 'React · React DOM',     version: '18.3.1',  license: 'MIT', copyright: 'Copyright (c) Facebook, Inc. and its affiliates.', url: 'https://github.com/facebook/react' },
  { name: 'React Flow (@xyflow/react)', version: '12.10.2', license: 'MIT', copyright: 'Copyright (c) 2019-2025 webkid GmbH',        url: 'https://github.com/xyflow/xyflow' },
  { name: 'Zustand',               version: '5.0.12',  license: 'MIT', copyright: 'Copyright (c) 2019 Paul Henschel',                 url: 'https://github.com/pmndrs/zustand' },
  { name: 'zundo',                 version: '2.3.0',   license: 'MIT', copyright: 'Copyright (c) 2021 Charles Kornoelje',             url: 'https://github.com/charkour/zundo' },
  { name: 'Prism',                 version: '1.30.0',  license: 'MIT', copyright: 'Copyright (c) 2012 Lea Verou',                     url: 'https://github.com/PrismJS/prism' },
  { name: 'prism-react-renderer',  version: '2.4.1',   license: 'MIT', copyright: 'Copyright (c) 2018 Nearform',                      url: 'https://github.com/FormidableLabs/prism-react-renderer' },
  { name: 'html-to-image',         version: '1.11.13', license: 'MIT', copyright: 'Copyright (c) 2017-2025 W.Y.',                     url: 'https://github.com/bubkoo/html-to-image' },
  { name: 'Tailwind CSS',          version: '3.4.19',  license: 'MIT', copyright: 'Copyright (c) Tailwind Labs, Inc.',                url: 'https://github.com/tailwindlabs/tailwindcss' },
];

export const LICENSE_TEXT: Record<ThirdPartyItem['license'], string> = {
  'MIT': `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`,
  'ISC': `Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`,
  'OFL-1.1': 'SIL Open Font License 1.1 — 전문은 각 폰트의 라이선스 파일(/fonts/OFL-*.txt)에 있습니다. 폰트를 앱에 넣어 쓰거나 수정할 수 있지만, 폰트 파일만 따로 판매할 수는 없습니다.',
};

export const TRADEMARK_NOTICE =
  'Excalidraw는 Excalidraw의 상표입니다. Web Canvas는 Excalidraw와 제휴·후원 관계가 아니며, 이름은 폰트 출처를 밝히는 용도로만 씁니다.';
