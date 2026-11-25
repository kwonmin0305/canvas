// ═══════════════════════════════════════════════════════════
// 📁 lib/i18n/index.ts
// 화면 글자 — 이 복제본은 한국어만 씀
//   원본(Course)에서 가져온 코드가 tr('한국어', 'English') 형태로 적혀 있어서
//   함수 모양은 그대로 두고 언제나 한국어(첫 번째 글자)를 돌려줌
// ═══════════════════════════════════════════════════════════

export type Lang = 'ko' | 'en';
export type L = { ko: string; en: string };

/** 한국어 글자를 돌려줌 (두 번째 인자 영어는 쓰지 않음) */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function tr(ko: string, _en: string): string {
  return ko;
}

/** { ko, en } 묶음에서 한국어 글자 */
export function tl(label: L): string {
  return label.ko;
}

/** 날짜·숫자 표기에 쓰는 로케일 */
export function locale(): string {
  return 'ko-KR';
}

/** 텍스트 상자 기본 제목(자리표시) — 원본에서 영어로 만든 파일도 자리표시로 봄 */
export function isTextPlaceholder(title: string | undefined): boolean {
  return title === '텍스트' || title === 'Text';
}
