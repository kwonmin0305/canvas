/**
 * 값을 주어진 범위 내로 제한
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value));
};

/**
 * 두 점 사이의 거리 계산
 */
export const distance = (x1: number, y1: number, x2: number, y2: number): number => {
  return Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
};

/**
 * 점이 직사각형 내에 있는지 확인
 */
export const isPointInRect = (
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): boolean => {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
};

/**
 * 두 직사각형이 겹치는지 확인
 */
export const doRectsIntersect = (
  r1x: number,
  r1y: number,
  r1w: number,
  r1h: number,
  r2x: number,
  r2y: number,
  r2w: number,
  r2h: number
): boolean => {
  return (
    r1x < r2x + r2w &&
    r1x + r1w > r2x &&
    r1y < r2y + r2h &&
    r1y + r1h > r2y
  );
};

/**
 * 고유한 ID 생성
 */
export const generateId = (prefix: string = 'id'): string => {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * 객체를 깊은 복사
 */
export const deepClone = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};
