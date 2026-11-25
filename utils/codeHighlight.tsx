// ═══════════════════════════════════════════════════════════
// 📁 utils/codeHighlight.tsx
// 코드 블록 문법 색상 (Prism)
//
//   - 라이브러리는 코드 블록이 처음 색칠될 때만 불러옴 → 코드 블록이 없으면 로딩 비용 0
//   - 코드·언어가 바뀔 때만 다시 색칠 (useMemo)
//   - 줄마다 HTML 문자열로 만들어 기억 → 타이핑하면 바뀐 줄만 다시 그림
//   - 긴 코드는 타이핑이 멈춘 뒤에 색칠 → 타이핑 중 키 입력 비용은 색이 없을 때와 같음
// ═══════════════════════════════════════════════════════════

import { memo, useEffect, useMemo, useState } from 'react';

type PrismModule = typeof import('prism-react-renderer');

// 코드 블록 언어 이름 → Prism 문법 이름 (Plain Text는 색칠 안 함)
const PRISM_LANG: Record<string, string> = {
  JavaScript: 'javascript', TypeScript: 'typescript', TSX: 'tsx', Python: 'python',
  Java: 'java', C: 'c', 'C++': 'cpp', 'C#': 'csharp', Go: 'go', Rust: 'rust',
  HTML: 'markup', CSS: 'css', JSON: 'json', SQL: 'sql', Bash: 'bash', YAML: 'yaml', Markdown: 'markdown',
};

export type CodeTheme = 'dark' | 'light';

// 토큰 종류 → 색. 어둡게: VS Code Dark+ 계열 / 밝게: VS Code Light+ 계열
const DARK_COLORS: Record<string, string> = {
  comment: '#6a9955', prolog: '#6a9955', doctype: '#6a9955', cdata: '#6a9955',
  keyword: '#569cd6', builtin: '#569cd6', boolean: '#569cd6', 'interpolation-punctuation': '#569cd6',
  string: '#ce9178', char: '#ce9178', 'attr-value': '#ce9178', 'template-string': '#ce9178', regex: '#d16969',
  number: '#b5cea8', constant: '#4fc1ff',
  function: '#dcdcaa', 'class-name': '#4ec9b0', tag: '#569cd6', selector: '#d7ba7d',
  'attr-name': '#9cdcfe', property: '#9cdcfe', variable: '#9cdcfe', parameter: '#9cdcfe',
  operator: '#d4d4d4', punctuation: '#d4d4d4',
};

const LIGHT_COLORS: Record<string, string> = {
  comment: '#008000', prolog: '#008000', doctype: '#008000', cdata: '#008000',
  keyword: '#0000ff', builtin: '#0000ff', boolean: '#0000ff', 'interpolation-punctuation': '#0000ff',
  string: '#a31515', char: '#a31515', 'attr-value': '#0451a5', 'template-string': '#a31515', regex: '#811f3f',
  number: '#098658', constant: '#0070c1',
  function: '#795e26', 'class-name': '#267f99', tag: '#800000', selector: '#800000',
  'attr-name': '#e50000', property: '#001080', variable: '#001080', parameter: '#001080',
  operator: '#000000', punctuation: '#000000',
};

const TOKEN_COLORS: Record<CodeTheme, Record<string, string>> = { dark: DARK_COLORS, light: LIGHT_COLORS };

let prism: PrismModule | null = null;
let loading: Promise<void> | null = null;

// 라이브러리 + 기본 묶음에 없는 언어(Java·C#·Bash)를 한 번만 불러옴
const loadPrism = () =>
  (loading ??= (async () => {
    const mod = await import('prism-react-renderer');
    // prismjs 언어 파일은 전역 Prism에 문법을 등록하는 방식
    (globalThis as { Prism?: unknown }).Prism = mod.Prism;
    await import('prismjs/components/prism-java');
    await import('prismjs/components/prism-csharp');
    await import('prismjs/components/prism-bash');
    prism = mod;
  })());

// 이보다 긴 코드는 타이핑이 멈춘 뒤에 색칠 (측정: 1만 자 ≈ 키 입력당 +13ms, 8만 자 ≈ +78ms — 개발 모드)
const DEFER_OVER_CHARS = 10000;
const DEFER_MS = 200;

const tokenColor = (types: string[], colors: Record<string, string>) => {
  let color: string | undefined;
  for (const t of types) color = colors[t] ?? color;
  return color;
};

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// 한 줄 — HTML 문자열이 같으면 다시 그리지 않음
const CodeLine = memo(function CodeLine({ html, last }: { html: string; last: boolean }) {
  return (
    <>
      <span dangerouslySetInnerHTML={{ __html: html }} />
      {last ? null : '\n'}
    </>
  );
});

// 색칠된 코드 (줄 목록) — <pre> 안에 넣어서 사용
export const HighlightedCode = memo(function HighlightedCode({ lines }: { lines: string[] }) {
  return <>{lines.map((html, i) => <CodeLine key={i} html={html} last={i === lines.length - 1} />)}</>;
});

/**
 * 줄마다 색칠된 HTML을 반환. 색칠할 수 없으면(Plain Text·불러오는 중) null.
 * stale: 긴 코드를 타이핑하는 중이라 아직 이전 내용으로 색칠된 상태 — 이때는 색칠 층 대신 원래 글자를 보여 줘야 함
 */
export function useHighlightedCode(code: string, language: string | undefined, theme: CodeTheme = 'dark') {
  const lang = language ? PRISM_LANG[language] : undefined;
  const [ready, setReady] = useState(!!prism);

  useEffect(() => {
    if (!lang) return;
    if (prism) { setReady(true); return; }   // 다른 코드 블록이 이미 불러온 경우
    let alive = true;
    void loadPrism().then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [lang]);

  // 긴 코드: 마지막 입력 후 DEFER_MS 동안 입력이 없을 때의 내용으로 색칠
  const [settled, setSettled] = useState(code);
  useEffect(() => {
    if (code.length <= DEFER_OVER_CHARS) return;
    const t = setTimeout(() => setSettled(code), DEFER_MS);
    return () => clearTimeout(t);
  }, [code]);
  const source = code.length > DEFER_OVER_CHARS ? settled : code;

  const lines = useMemo(() => {
    if (!lang || !ready || !prism) return null;
    const grammar = prism.Prism.languages[lang];
    if (!grammar) return null;
    const colors = TOKEN_COLORS[theme];
    return prism.normalizeTokens(prism.Prism.tokenize(source, grammar)).map((line) =>
      line.map((tok) => {
        // 빈 줄은 prism이 "\n" 토큰(empty)으로 주는데, 줄 사이 "\n"은 따로 붙이므로 그리면 한 줄이 더 생김
        if (tok.empty) return '';
        const text  = escapeHtml(tok.content);
        const color = tokenColor(tok.types, colors);
        return color ? `<span style="color:${color}">${text}</span>` : text;
      }).join(''),
    );
  }, [source, lang, ready, theme]);

  return { lines, stale: source !== code };
}
