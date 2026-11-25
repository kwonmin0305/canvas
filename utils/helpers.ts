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
