// ═══════════════════════════════════════════════════════════
// 📁 lib/erd/index.ts
// DB 설계(ERD) 공용 로직 — 화면(Entity.tsx · ErdEdge.tsx) · 템플릿이 같이 씀
//
//   원본은 캔버스 하나뿐: 테이블 = entity 노드(data.title · data.columns), 관계 = 'erd' 엣지
//     엣지는 "참조하는 컬럼(FK) → 참조되는 컬럼" 방향, 핸들 id에 컬럼 id가 들어 있음 (col-<컬럼id>-l|r)
//   스키마(JSON)는 따로 저장하지 않고 필요할 때 캔버스에서 뽑음 (canvasToSchema)
//
//   buildErd        — 테이블 목록 → 프레임 하나 + 테이블 노드 + 관계선 (좌표는 여기서 계산)
//   canvasToSchema  — 캔버스 → 테이블 목록
//   schemaToSql     — 테이블 목록 → CREATE TABLE 문
// ═══════════════════════════════════════════════════════════

import type { AppNode, AppEdge, EntityColumn, NodeData } from '@/types';
import { DEFAULT_RADIUS } from '@/constants/shapeRadius';
import { tr } from '@/lib/i18n';

// ── 카드 치수 (Entity.tsx · ErdEdge.tsx가 같은 값으로 그림) ──
export const ENTITY = { W: 250, MIN_W: 180, MAX_W: 340, HEADER_H: 36, ROW_H: 30 } as const;
export const entityHeight = (columnCount: number) => ENTITY.HEADER_H + Math.max(1, columnCount) * ENTITY.ROW_H;

// ── 타입 — 저장은 실제 타입, 화면에는 쉬운 이름(기본) 또는 실제 타입 ──
export const ERD_TYPES = [
  { type: 'uuid',        label: tr('고유번호', 'ID') },
  { type: 'text',        label: tr('글자', 'Text') },
  { type: 'int',         label: tr('숫자', 'Number') },
  { type: 'numeric',     label: tr('소수', 'Decimal') },
  { type: 'bool',        label: tr('예/아니오', 'Yes/No') },
  { type: 'timestamptz', label: tr('날짜·시간', 'Date & time') },
  { type: 'date',        label: tr('날짜', 'Date') },
  { type: 'jsonb',       label: tr('묶음 데이터', 'JSON data') },
] as const;
const TYPE_LABEL = new Map<string, string>(ERD_TYPES.map((t) => [t.type, t.label]));
export const typeLabel = (type: string, real: boolean) => (real ? type : TYPE_LABEL.get(type) ?? type);


// ── 컬럼 핸들 id ─────────────────────────────────────────────
export const colHandle = (colId: string, side: 'l' | 'r') => `col-${colId}-${side}`;
export const colIdOfHandle = (handle?: string | null): string | null => {
  const m = /^col-(.+)-[lr]$/.exec(handle ?? '');
  return m ? m[1] : null;
};

let colSeq = 0;
export const newColumnId = () => `c${Date.now().toString(36)}${(colSeq++).toString(36)}`;
export const newColumn = (patch: Partial<EntityColumn> = {}): EntityColumn =>
  ({ id: newColumnId(), name: '', type: 'text', ...patch });

// ── 스키마 (템플릿 · 내보내기가 주고받는 모양) ──────────
export interface ErdColumnInput {
  name: string; type: string;
  pk?: boolean; nullable?: boolean; unique?: boolean; note?: string; default?: string;
  ref?: string;   // "테이블.컬럼" — 이 컬럼이 가리키는 다른 테이블의 컬럼
}
export interface ErdTableInput { name: string; columns: ErdColumnInput[] }

// ── 글자 너비 어림 → 카드 너비 ───────────────────────────────
const charW = (c: string, px: number) => ((c.codePointAt(0) ?? 0) >= 0x1100 ? px : c === ' ' ? px * 0.3 : px * 0.58);
const textW = (t: string, px: number) => [...t].reduce((w, c) => w + charW(c, px), 0);
export function entityWidth(name: string, columns: { name: string; type: string; note?: string }[]): number {
  const rows = columns.map((c) =>
    46 + textW(c.name, 12.5) + (c.note ? Math.min(90, textW(c.note, 11) + 8) : 0) + 16 + Math.max(textW(typeLabel(c.type, false), 11), textW(c.type, 10.5)) + 14);
  return Math.round(Math.min(ENTITY.MAX_W, Math.max(ENTITY.MIN_W, 60 + textW(name, 13), ...rows)));
}

// ── 노드 · 엣지 만들기 ───────────────────────────────────────
const entityData = (name: string, columns: EntityColumn[], w: number): NodeData => ({
  title: name, subtitle: '', icon: '', type: 'database', status: 'none',
  shape: 'entity', width: w, height: entityHeight(columns.length), columns,
});

export function buildEntityNode(
  id: string, name: string, columns: EntityColumn[], position: { x: number; y: number }, extra: Partial<AppNode> = {},
): AppNode {
  const w = entityWidth(name, columns);
  return { id, type: 'custom', position, width: w, height: entityHeight(columns.length), zIndex: 0, data: entityData(name, columns, w), ...extra };
}

// 빈 테이블 — id 컬럼 하나, 만들자마자 이름 편집
export const buildBlankEntity = (position: { x: number; y: number }): AppNode => {
  const columns = [newColumn({ name: 'id', type: 'uuid', pk: true })];
  return {
    id: `node-${Date.now()}`, type: 'custom', position, width: ENTITY.W, height: entityHeight(1), zIndex: 0,
    data: { ...entityData('', columns, ENTITY.W), autoEdit: true },
  };
};

export const erdEdge = (id: string, source: string, sourceCol: string, target: string, targetCol: string): AppEdge => ({
  id, source, target, type: 'erd',
  sourceHandle: colHandle(sourceCol, 'r'), targetHandle: colHandle(targetCol, 'l'),
  data: {},
});
export const isErdEdge = (e: AppEdge) => e.type === 'erd';

// "테이블.컬럼" → 가리키는 테이블·컬럼 (컬럼이 없거나 못 찾으면 그 테이블의 대표 번호)
type Built = { name: string; columns: EntityColumn[]; refs: (string | undefined)[] };
const resolveRef = (ref: string | undefined, tables: Built[]) => {
  if (!ref) return null;
  const [tn, cn] = ref.split('.').map((s) => s.trim().toLowerCase());
  const ti = tables.findIndex((t) => t.name.toLowerCase() === tn);
  if (ti < 0) return null;
  const cols = tables[ti].columns;
  const col = cols.find((c) => c.name.toLowerCase() === cn) ?? cols.find((c) => c.pk) ?? cols[0];
  return col ? { ti, col } : null;
};

const toBuilt = (tables: ErdTableInput[]): Built[] => tables.map((t) => ({
  name: t.name,
  columns: t.columns.map(({ ref: _ref, ...c }) => ({ id: newColumnId(), ...c })),
  refs: t.columns.map((c) => c.ref),
}));

const COL_GAP = 110;      // 테이블 줄(세로 묶음) 사이 — 관계선이 지나는 자리
const ROW_GAP = 36;       // 같은 줄 테이블 사이
const MAX_COL_H = 980;    // 한 줄이 이보다 길어지면 옆 줄로 넘김
const PAD = 48;
const TITLE_H = 40;

// 테이블 배치 — 참조되는 테이블이 왼쪽, 참조하는 테이블이 오른쪽. 돌아오는 참조(순환)는 계산에서 뺌
function layoutTables(tables: Built[]): { pos: { x: number; y: number; w: number; h: number }[]; width: number; height: number } {
  const n = tables.length;
  const parents: number[][] = tables.map(() => []);
  tables.forEach((t, i) => t.refs.forEach((ref) => {
    const hit = resolveRef(ref, tables);
    if (hit && hit.ti !== i && !parents[i].includes(hit.ti)) parents[i].push(hit.ti);
  }));
  const rank = new Array<number>(n).fill(-1);
  const visiting = new Set<number>();
  const rankOf = (i: number): number => {
    if (rank[i] >= 0) return rank[i];
    if (visiting.has(i)) return -1;   // 순환 — 이 참조는 무시
    visiting.add(i);
    const r = parents[i].reduce((m, p) => Math.max(m, rankOf(p) + 1), 0);
    visiting.delete(i);
    return (rank[i] = r);
  };
  tables.forEach((_, i) => rankOf(i));

  const size = tables.map((t) => ({ w: entityWidth(t.name, t.columns), h: entityHeight(t.columns.length) }));
  const centerY = new Array<number>(n).fill(0);
  const pos = tables.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  const lanes: number[][] = [];
  const maxRank = Math.max(...rank);
  for (let r = 0; r <= maxRank; r++) {
    // 줄 안 순서 — 왼쪽 줄 부모의 높이 순 (선 꼬임 줄이기)
    const key = (i: number) => (parents[i].length ? parents[i].reduce((a, p) => a + centerY[p], 0) / parents[i].length : Infinity);
    const members = tables.map((_, i) => i).filter((i) => rank[i] === r)
      .map((i) => ({ i, k: key(i) })).sort((a, b) => (a.k - b.k) || (a.i - b.i)).map((m) => m.i);
    let lane: number[] = [];
    let h = 0;
    members.forEach((i) => {
      if (lane.length && h + size[i].h > MAX_COL_H) { lanes.push(lane); lane = []; h = 0; }
      lane.push(i);
      h += size[i].h + ROW_GAP;
    });
    if (lane.length) lanes.push(lane);
    // 이 단계 테이블의 높이(가운데)를 어림해 둠 — 다음 단계 순서에 씀
    let y = 0;
    members.forEach((i) => { centerY[i] = y + size[i].h / 2; y += size[i].h + ROW_GAP; });
  }
  const laneH = lanes.map((lane) => lane.reduce((s, i) => s + size[i].h, 0) + ROW_GAP * (lane.length - 1));
  const height = Math.max(...laneH);
  let x = 0;
  lanes.forEach((lane, li) => {
    const w = Math.max(...lane.map((i) => size[i].w));
    let y = (height - laneH[li]) / 2;
    lane.forEach((i) => {
      pos[i] = { x, y, w: size[i].w, h: size[i].h };
      y += size[i].h + ROW_GAP;
    });
    x += w + COL_GAP;
  });
  return { pos, width: x - COL_GAP, height };
}

const frameNode = (id: string, title: string, w: number, h: number): AppNode => ({
  id, type: 'custom', position: { x: 0, y: 0 }, width: w, height: h,
  zIndex: -Math.ceil(w * h / 100),
  data: {
    title: title || tr('DB 설계', 'DB design'), subtitle: '', icon: '', type: 'container', status: 'none',
    shape: 'frame', width: w, height: h, borderRadius: DEFAULT_RADIUS.frame,
  },
});

const relationEdges = (tables: Built[], idOf: (ti: number) => string, edgeId: (k: number) => string): AppEdge[] => {
  const edges: AppEdge[] = [];
  tables.forEach((t, ti) => t.refs.forEach((ref, ci) => {
    const hit = resolveRef(ref, tables);
    if (!hit) return;
    edges.push(erdEdge(edgeId(edges.length), idOf(ti), t.columns[ci].id, idOf(hit.ti), hit.col.id));
  }));
  return edges;
};

export function buildErd(title: string, input: ErdTableInput[]): { nodes: AppNode[]; edges: AppEdge[] } {
  if (!input.length) return { nodes: [], edges: [] };
  const ts = Date.now();
  const tables = toBuilt(input);
  const { pos, width, height } = layoutTables(tables);
  const frameId = `erd-${ts}-frame`;
  const idOf = (ti: number) => `erd-${ts}-${ti}`;
  const nodes = tables.map((t, ti) => buildEntityNode(
    idOf(ti), t.name, t.columns,
    { x: Math.round(PAD + pos[ti].x), y: Math.round(PAD + TITLE_H + pos[ti].y) },
    { parentId: frameId },
  ));
  const frame = frameNode(frameId, title, Math.round(width + PAD * 2), Math.round(height + PAD * 2 + TITLE_H));
  return { nodes: [frame, ...nodes], edges: relationEdges(tables, idOf, (k) => `erd-edge-${ts}-${k}`) };
}

// ── 캔버스 → 스키마 ──────────────────────────────────────────
const entitiesIn = (nodes: AppNode[], ids?: Set<string> | null) =>
  nodes.filter((n) => n.data.shape === 'entity' && (!ids || ids.has(n.id)));

export function canvasToSchema(nodes: AppNode[], edges: AppEdge[], ids?: Set<string> | null): ErdTableInput[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return entitiesIn(nodes, ids).map((n) => ({
    name: (n.data.title || '').trim() || 'untitled',
    columns: (n.data.columns ?? []).filter((c) => c.name.trim()).map(({ id, ...c }) => {
      const e = edges.find((x) => isErdEdge(x) && x.source === n.id && colIdOfHandle(x.sourceHandle) === id);
      const target = e ? byId.get(e.target) : undefined;
      const tcol = target?.data.columns?.find((tc) => tc.id === colIdOfHandle(e?.targetHandle));
      return { ...c, ...(target && tcol && { ref: `${(target.data.title || '').trim() || 'untitled'}.${tcol.name}` }) };
    }),
  }));
}

// 같은 묶음의 테이블 — 프레임이면 그 안, 테이블이면 같은 프레임(없으면 프레임 밖 전부)의 테이블
export function erdScope(nodes: AppNode[], id: string): { frame?: AppNode; ids: Set<string> } {
  const me = nodes.find((n) => n.id === id);
  const frameId = me?.data.shape === 'frame' ? me.id : me?.parentId;
  const frame = frameId ? nodes.find((n) => n.id === frameId) : undefined;
  return { frame, ids: new Set(nodes.filter((n) => n.data.shape === 'entity' && n.parentId === frameId).map((n) => n.id)) };
}

// 자동 정렬 — 같은 묶음의 테이블을 다시 배치 (묶음의 왼쪽 위 자리는 그대로)
export function relayoutErd(nodes: AppNode[], edges: AppEdge[], anyId: string): AppNode[] {
  const { frame, ids } = erdScope(nodes, anyId);
  const members = nodes.filter((n) => ids.has(n.id));
  if (members.length < 2) return nodes;
  const schema = canvasToSchema(nodes, edges, ids);
  const tables: Built[] = members.map((n, i) => ({
    name: schema[i].name, columns: n.data.columns ?? [], refs: (n.data.columns ?? []).map((c) => schema[i].columns.find((s) => s.name === c.name)?.ref),
  }));
  const { pos, width, height } = layoutTables(tables);
  const ox = frame ? PAD : Math.min(...members.map((n) => n.position.x));
  const oy = frame ? PAD + TITLE_H : Math.min(...members.map((n) => n.position.y));
  const moved = new Map(members.map((n, i) => [n.id, { x: Math.round(ox + pos[i].x), y: Math.round(oy + pos[i].y) }]));
  return nodes.map((n) => {
    if (moved.has(n.id)) return { ...n, position: moved.get(n.id)! };
    if (frame && n.id === frame.id) {
      // 테이블 말고 다른 요소도 들어 있을 수 있으니 줄이지는 않음
      const fw = Math.max((n.data.width as number | undefined) ?? 0, Math.round(width + PAD * 2));
      const fh = Math.max((n.data.height as number | undefined) ?? 0, Math.round(height + PAD * 2 + TITLE_H));
      return { ...n, width: fw, height: fh, measured: undefined, zIndex: -Math.ceil(fw * fh / 100), data: { ...n.data, width: fw, height: fh } };
    }
    return n;
  });
}

// ── 스키마 → SQL (PostgreSQL) ────────────────────────────────
const SQL_TYPE: Record<string, string> = { int: 'integer', bool: 'boolean' };
const ident = (s: string) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

export function schemaToSql(tables: ErdTableInput[]): string {
  // 참조되는 테이블을 먼저 만들도록 순서를 정함 — 순환이면 나중에 alter table로
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const done = new Set<string>();
  const order: ErdTableInput[] = [];
  const visit = (t: ErdTableInput, path: Set<string>) => {
    const key = t.name.toLowerCase();
    if (done.has(key) || path.has(key)) return;
    path.add(key);
    t.columns.forEach((c) => {
      const p = c.ref && byName.get(c.ref.split('.')[0].trim().toLowerCase());
      if (p) visit(p, path);
    });
    path.delete(key);
    done.add(key);
    order.push(t);
  };
  tables.forEach((t) => visit(t, new Set()));

  const created = new Set<string>();
  const later: string[] = [];
  const blocks = order.map((t) => {
    const pks = t.columns.filter((c) => c.pk);
    const lines = t.columns.map((c) => {
      const [rt, rc] = (c.ref ?? '').split('.').map((s) => s.trim());
      const refOk = !!rt && byName.has(rt.toLowerCase());
      const self = refOk && rt.toLowerCase() === t.name.toLowerCase();
      const inline = refOk && (created.has(rt.toLowerCase()) || self);
      if (refOk && !inline) {
        later.push(`alter table ${ident(t.name)} add foreign key (${ident(c.name)}) references ${ident(rt)}${rc ? ` (${ident(rc)})` : ''};`);
      }
      const dflt = c.default ?? (c.pk && pks.length === 1 && c.type === 'uuid' ? 'gen_random_uuid()' : '');
      return [
        `  ${ident(c.name)} ${SQL_TYPE[c.type] ?? c.type}`,
        c.pk && pks.length === 1 && 'primary key',
        !c.pk && !c.nullable && 'not null',
        c.unique && !c.pk && 'unique',
        dflt && `default ${dflt}`,
        inline && `references ${ident(rt)}${rc ? ` (${ident(rc)})` : ''}`,
      ].filter(Boolean).join(' ') + (c.note ? `,  -- ${c.note}` : ',');
    });
    if (pks.length > 1) lines.push(`  primary key (${pks.map((c) => ident(c.name)).join(', ')}),`);
    // 마지막 줄의 쉼표를 뺌 (주석이 있으면 주석 앞의 쉼표)
    const last = lines.length - 1;
    lines[last] = lines[last].replace(/,(\s*-- .*)?$/, '$1');
    created.add(t.name.toLowerCase());
    return `create table ${ident(t.name)} (\n${lines.join('\n')}\n);`;
  });
  return [...blocks, ...(later.length ? [later.join('\n')] : [])].join('\n\n');
}
