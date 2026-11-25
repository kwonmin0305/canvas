// ═══════════════════════════════════════════════════════════
// 📁 utils/projects.ts
// 프로젝트 목록과 프로젝트별 캔버스 저장 (이 브라우저의 localStorage)
//
//   목록:   'web-canvas-projects'      → [{ id, name, createdAt, updatedAt, starred }]
//   캔버스: 'web-canvas-data:<id>'     → { nodes, edges }
//
//   프로젝트 목록 화면(public/index.html · public/app.js)도 같은 키를 씀 — 키를 바꾸면 둘 다 고침
// ═══════════════════════════════════════════════════════════

export const PROJECTS_KEY = 'web-canvas-projects';
export const canvasKey = (id: string) => `web-canvas-data:${id}`;

// 프로젝트가 하나뿐이던 예전 저장 키 — 남아 있으면 첫 프로젝트로 옮김
const OLD_CANVAS_KEY = 'web-canvas-data';

export interface ProjectMeta {
  id:        string;
  name:      string;
  createdAt: number;
  updatedAt: number;
  starred?:  boolean;
}

export function loadProjects(): ProjectMeta[] {
  try {
    const list = JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? 'null');
    if (Array.isArray(list)) return list as ProjectMeta[];
  } catch { /* 깨진 값이면 새로 */ }

  // 처음 — 예전 캔버스가 있으면 '내 프로젝트'로 옮김
  const projects: ProjectMeta[] = [];
  try {
    const old = localStorage.getItem(OLD_CANVAS_KEY);
    if (old) {
      const now = Date.now();
      const p = { id: `p${now.toString(36)}`, name: '내 프로젝트', createdAt: now, updatedAt: now };
      localStorage.setItem(canvasKey(p.id), old);
      localStorage.removeItem(OLD_CANVAS_KEY);
      projects.push(p);
    }
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch { /* 저장 불가 */ }
  return projects;
}

export const findProject = (id: string) => loadProjects().find((p) => p.id === id);

// 캔버스를 저장할 때 — 목록의 '마지막 수정' 시각을 갱신
export function touchProject(id: string) {
  try {
    const list = loadProjects().map((p) => (p.id === id ? { ...p, updatedAt: Date.now() } : p));
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
  } catch { /* 저장 불가 */ }
}
