// ═══════════════════════════════════════════════════════════
// 📁 lib/i18n/index.ts
// 화면 글자 — 한국어만 씀
//   코드에는 tr('한국어', 'English') 형태로 적어 두고
//   언제나 한국어(첫 번째 글자)를 돌려줌
// ═══════════════════════════════════════════════════════════

export type L = { ko: string; en: string };

/** 한국어 글자를 돌려줌 (두 번째 인자 영어는 쓰지 않음) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tr(ko: string, _en: string): string {
  return ko;
}

/** 텍스트 상자 기본 제목(자리표시) — 영어(Text)로 저장된 파일도 자리표시로 봄 */
export function isTextPlaceholder(title: string | undefined): boolean {
  return title === '텍스트' || title === 'Text';
}
