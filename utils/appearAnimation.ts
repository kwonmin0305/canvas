// ═══════════════════════════════════════════════════════════
// 📁 utils/appearAnimation.ts
// AI가 만든 요소가 캔버스에 "툭" 생기지 않고 차례로 떠오르게 하는 연출
//
//   노드는 한 번에 넣고(실행취소 한 번), 보이는 순서만 CSS로 늦춤
//     1) 다른 요소를 품은 바깥 프레임(묶음) — 맨 먼저 옅게
//     2) 단위(화면 프레임·카드 등 맨 바깥 바로 아래, 또는 프레임 없는 노드) — 왼쪽→오른쪽, 위→아래 순서로
//     3) 단위 안 요소 — 틀이 나온 뒤 위에서 아래로. 한 단위가 다 그려진 뒤에 다음 단위 시작 (차례로)
//     4) 연결선·선 라벨 — 마지막에
//   노드 데이터에는 아무것도 남기지 않음: <style>을 잠깐 붙였다가 연출이 끝나면 뗌 (저장·실행취소와 무관)
//   전체 길이는 MAX_TOTAL 안으로 — 화면이 많으면 같은 비율로 빨라짐 / "동작 줄이기" 설정이면 연출 없음
// ═══════════════════════════════════════════════════════════

import type { AppNode, AppEdge } from '@/types';

// 단위는 차례로: 앞 단위(화면)가 안 요소까지 다 그려진 뒤 다음 단위 시작
const MAX_TOTAL = 6000;   // 마지막 단위가 끝나는 때(ms) 상한 — 넘으면 전체를 같은 비율로 줄임
const UNIT_GAP = 120;     // 앞 단위가 끝나고 다음 단위가 시작하기까지
const CHILD_LAG = 140;    // 단위(화면 틀)가 나온 뒤 안 요소가 따라 나오기까지
const CHILD_STEP = 40;    // 안 요소끼리 (위→아래)
const CHILD_SPAN = 800;   // 한 단위 안 요소가 다 나오는 데 걸리는 최대 시간
const DURATION = 380;     // 요소 하나가 나타나는 시간

const cssId = (id: string) => id.replace(/["\\]/g, '\\$&');

export function playAppear(nodes: AppNode[], edges: AppEdge[]): void {
  if (typeof document === 'undefined' || !nodes.length) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chainOf = (n: AppNode) => {
    const chain = [n];
    for (let p = n.parentId ? byId.get(n.parentId) : undefined; p && chain.length < 50; p = p.parentId ? byId.get(p.parentId) : undefined) chain.push(p);
    return chain;   // [자기, 부모, …, 맨 바깥]
  };
  const abs = (n: AppNode) => chainOf(n).reduce((a, c) => ({ x: a.x + c.position.x, y: a.y + c.position.y }), { x: 0, y: 0 });
  const hasKids = new Set(nodes.map((n) => n.parentId).filter((p): p is string => !!p && byId.has(p)));

  // 단위 정하기 — 맨 바깥이 다른 프레임을 품은 묶음이면 그 바로 아래가 단위, 아니면 맨 바깥이 단위
  const groups = new Set<string>();   // 단위보다 먼저 나오는 바깥 묶음
  const unitOf = new Map<string, string>();
  nodes.forEach((n) => {
    const chain = chainOf(n);
    const top = chain[chain.length - 1];
    const topIsGroup = nodes.some((c) => c.parentId === top.id && hasKids.has(c.id));
    if (topIsGroup && chain.length >= 2) { groups.add(top.id); unitOf.set(n.id, chain[chain.length - 2].id); }
    else if (topIsGroup) groups.add(top.id);
    else unitOf.set(n.id, top.id);
  });

  // 단위 순서 — 왼쪽→오른쪽 (x가 비슷하면 위→아래)
  const units = [...new Set(unitOf.values())].map((id) => ({ id, p: abs(byId.get(id)!) }));
  units.sort((a, b) => (Math.abs(a.p.x - b.p.x) > 40 ? a.p.x - b.p.x : a.p.y - b.p.y));

  // 단위 안 요소 — 위→아래 순위
  const kidsOf = new Map<string, AppNode[]>();
  nodes.forEach((n) => {
    const u = unitOf.get(n.id);
    if (u && u !== n.id) kidsOf.set(u, [...(kidsOf.get(u) ?? []), n]);
  });

  // 단위마다: 틀 → (조금 뒤) 안 요소 위→아래 → 다 나오면 다음 단위
  const delay = new Map<string, number>();
  let t = groups.size ? 200 : 0;
  units.forEach((u) => {
    delay.set(u.id, t);
    const kids = [...(kidsOf.get(u.id) ?? [])].sort((a, b) => abs(a).y - abs(b).y || abs(a).x - abs(b).x);
    const k = kids.length > 1 ? Math.min(CHILD_STEP, CHILD_SPAN / (kids.length - 1)) : 0;
    kids.forEach((n, i) => delay.set(n.id, t + CHILD_LAG + i * k));
    const end = kids.length ? t + CHILD_LAG + (kids.length - 1) * k : t;
    t = end + (kids.length ? DURATION * 0.6 : 0) + UNIT_GAP;
  });
  // 너무 길면 전체를 같은 비율로 줄임 (순서는 그대로)
  const lastStart = Math.max(0, ...delay.values());
  if (lastStart > MAX_TOTAL) {
    const f = MAX_TOTAL / lastStart;
    delay.forEach((d, id) => delay.set(id, d * f));
  }
  groups.forEach((id) => delay.set(id, 0));

  const last = Math.max(0, ...delay.values());
  const edgeDelay = last + DURATION * 0.6;
  const rules: string[] = [];
  delay.forEach((d, id) => {
    const anim = groups.has(id) ? 'aiFadeIn' : 'aiAppear';
    rules.push(`.react-flow__node[data-id="${cssId(id)}"]>*{animation:${anim} ${DURATION}ms cubic-bezier(.2,.75,.25,1) ${Math.round(d)}ms both}`);
  });
  edges.forEach((e) => {
    const sel = `.react-flow__edge[data-id="${cssId(e.id)}"],[data-edge-label="${cssId(e.id)}"]`;
    rules.push(`${sel}{animation:aiFadeIn 420ms ease ${Math.round(edgeDelay)}ms both}`);
  });

  const style = document.createElement('style');
  style.dataset.aiAppear = '';
  style.textContent = rules.join('\n');
  document.head.appendChild(style);
  setTimeout(() => style.remove(), edgeDelay + 420 + 200);
}
