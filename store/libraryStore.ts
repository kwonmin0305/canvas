// ═══════════════════════════════════════════════════════════
// 📁 store/libraryStore.ts
// 내 라이브러리 — 프로젝트와 상관없이 어디서든 꺼내 씀
//
// 저장 위치: 이 브라우저의 IndexedDB (로그인·서버 없음, DB 변경 필요 없음)
// 형식은 utils/library.ts 그대로 (파일 내보내기·가져오기와 같음)
// ═══════════════════════════════════════════════════════════

import { create } from 'zustand';
import { idbGet, idbSet } from '@/utils/idb';
import type { LibraryItem } from '@/utils/library';

const IDB_KEY      = 'library-items';

// ── 브라우저(비로그인) 보관 ─────────────────────────────────
const loadLocal = async (): Promise<LibraryItem[]> => {
  try { return (await idbGet<LibraryItem[]>(IDB_KEY)) ?? []; } catch { return []; /* IndexedDB 불가 */ }
};

const saveLocal = async (items: LibraryItem[]) => {
  try { await idbSet(IDB_KEY, items); } catch { /* 저장 불가(사생활 보호 모드 등) — 이번 세션만 */ }
};

// ── 스토어 ───────────────────────────────────────────────────
interface LibraryState {
  items:   LibraryItem[];
  loaded:  boolean;
  init:    () => Promise<void>;                          // 처음 열 때 읽기
  add:     (items: LibraryItem[]) => Promise<boolean>;   // 맨 앞에 추가
  remove:  (id: string) => Promise<void>;
  rename:  (id: string, name: string) => Promise<void>;
}

let initPromise: Promise<void> | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  items:  [],
  loaded: false,

  init: () => {
    if (get().loaded) return Promise.resolve();
    if (!initPromise) initPromise = loadLocal().then((items) => set({ items, loaded: true })).finally(() => { initPromise = null; });
    return initPromise;
  },

  add: async (newItems) => {
    set({ items: [...newItems, ...get().items] });
    await saveLocal(get().items);
    return true;
  },

  remove: async (id) => {
    set({ items: get().items.filter((it) => it.id !== id) });
    await saveLocal(get().items);
  },

  rename: async (id, name) => {
    set({ items: get().items.map((it) => (it.id === id ? { ...it, name } : it)) });
    await saveLocal(get().items);
  },
}));
