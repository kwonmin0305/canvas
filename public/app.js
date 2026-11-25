// ═══════════════════════════════════════════════════════════
// app.js — 프로젝트 목록 화면 (index.html)
//
//   저장: 이 브라우저의 localStorage (캔버스 화면과 같은 키 — utils/projects.ts)
//     목록   'web-canvas-projects'  → [{ id, name, createdAt, updatedAt, starred }]
//     캔버스 'web-canvas-data:<id>' → { nodes, edges }
//   카드를 누르면 캔버스 화면(board/?id=<id>)으로 이동
//   다른 탭에서 캔버스를 고치면 목록·미리보기가 바로 바뀜 (storage 이벤트)
// ═══════════════════════════════════════════════════════════

(function () {
  'use strict';

  var PROJECTS_KEY = 'web-canvas-projects';
  var OLD_CANVAS_KEY = 'web-canvas-data';
  var THEME_KEY = 'web-canvas-theme';
  var VIEW_KEY = 'web-canvas-list-view';
  var SORT_KEY = 'web-canvas-list-sort';
  var canvasKey = function (id) { return 'web-canvas-data:' + id; };
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ── 저장소 ────────────────────────────────────────────
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };

  function loadProjects() {
    try {
      var list = JSON.parse(store.get(PROJECTS_KEY) || 'null');
      if (Array.isArray(list)) return list;
    } catch (e) { /* 깨진 값이면 새로 */ }
    // 처음 — 예전 캔버스 하나가 있으면 '내 프로젝트'로 옮김
    var projects = [];
    var old = store.get(OLD_CANVAS_KEY);
    if (old) {
      var now = Date.now();
      var p = { id: 'p' + now.toString(36), name: '내 프로젝트', createdAt: now, updatedAt: now };
      store.set(canvasKey(p.id), old);
      store.del(OLD_CANVAS_KEY);
      projects.push(p);
    }
    store.set(PROJECTS_KEY, JSON.stringify(projects));
    return projects;
  }
  function saveProjects(list) { return store.set(PROJECTS_KEY, JSON.stringify(list)); }
  function loadCanvas(id) {
    try { return JSON.parse(store.get(canvasKey(id)) || 'null'); } catch (e) { return null; }
  }
  function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ── 상태 ──────────────────────────────────────────────
  var state = {
    projects: loadProjects(),
    query: '',
    filter: 'all',
    sort: store.get(SORT_KEY) || 'updated',
    view: store.get(VIEW_KEY) || 'grid',
  };

  var $ = function (id) { return document.getElementById(id); };
  var listEl = $('projects');

  // ── 시간 표기 ─────────────────────────────────────────
  function ago(t) {
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return '방금 전';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    if (s < 86400 * 30) return Math.floor(s / 86400) + '일 전';
    return date(t);
  }
  function date(t) {
    var d = new Date(t);
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  }

  // ── 미리보기: 저장된 노드를 작은 SVG로 그림 ────────────
  function el(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function color(v, d) {
    return typeof v === 'string' && v && v !== 'transparent' && /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|[a-z]+)$/i.test(v) ? v : d;
  }

  function renderThumb(id) {
    var box = document.createElement('div');
    box.className = 'thumb';
    var data = loadCanvas(id);
    var nodes = data && Array.isArray(data.nodes) ? data.nodes.slice(0, 600) : [];
    if (!nodes.length) {
      var blank = document.createElement('div');
      blank.className = 'thumb__blank';
      blank.textContent = '빈 캔버스';
      box.appendChild(blank);
      return box;
    }

    // 부모(프레임) 위치를 더해 절대 좌표로
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });
    function abs(n, depth) {
      var x = num(n.position && n.position.x, 0), y = num(n.position && n.position.y, 0);
      var p = n.parentId && byId[n.parentId];
      if (p && depth < 20) { var a = abs(p, depth + 1); x += a.x; y += a.y; }
      return { x: x, y: y };
    }
    var rects = nodes.map(function (n) {
      var d = n.data || {};
      var pos = abs(n, 0);
      var w = num(n.width, num(d.width, num(n.measured && n.measured.width, 150)));
      var h = num(n.height, num(d.height, num(n.measured && n.measured.height, 60)));
      return { n: n, d: d, x: pos.x, y: pos.y, w: w, h: h };
    });

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach(function (r) {
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    });
    var bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
    var pad = Math.max(bw, bh) * 0.12 + 8;

    var svg = el('svg', {
      viewBox: [minX - pad, minY - pad, bw + pad * 2, bh + pad * 2].join(' '),
      preserveAspectRatio: 'xMidYMid meet',
      'aria-hidden': 'true',
    });

    // 연결선 먼저 (요소 아래)
    var centers = {};
    rects.forEach(function (r) { centers[r.n.id] = { x: r.x + r.w / 2, y: r.y + r.h / 2 }; });
    var stroke = Math.max(bw, bh) / 300;
    (data.edges || []).slice(0, 600).forEach(function (e) {
      var a = centers[e.source], b = centers[e.target];
      if (!a || !b) return;
      svg.appendChild(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'currentColor', 'stroke-opacity': 0.35, 'stroke-width': stroke * 1.4 }));
    });

    // 프레임(큰 것)부터 그려서 안의 요소가 위에 오게
    rects.sort(function (a, b) { return (a.d.shape === 'frame' ? 0 : 1) - (b.d.shape === 'frame' ? 0 : 1); });
    rects.forEach(function (r) {
      var d = r.d, shape = d.shape;
      var fill = color(d.bgColor, null);
      var line = color(d.strokeColor, null);
      if (shape === 'text') {
        drawText(svg, r, d);
        return;
      }
      if (shape === 'drawing' && Array.isArray(d.drawingPoints)) {
        var pts = d.drawingPoints.slice(0, 400).map(function (p) { return (r.x + num(p[0], 0)) + ',' + (r.y + num(p[1], 0)); }).join(' ');
        svg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: color(d.drawingColor, 'currentColor'), 'stroke-width': Math.max(num(d.drawingWidth, 2), stroke * 2), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        return;
      }
      var common = {
        fill: fill || 'none',
        stroke: line || 'currentColor',
        'stroke-opacity': line ? 1 : 0.28,
        'stroke-width': stroke * (shape === 'frame' ? 1.2 : 1.6),
      };
      var node;
      if (shape === 'circle') {
        node = el('ellipse', { cx: r.x + r.w / 2, cy: r.y + r.h / 2, rx: r.w / 2, ry: r.h / 2 });
      } else if (shape === 'diamond') {
        node = el('polygon', { points: [r.x + r.w / 2, r.y, r.x + r.w, r.y + r.h / 2, r.x + r.w / 2, r.y + r.h, r.x, r.y + r.h / 2].join(' ') });
      } else {
        node = el('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: Math.min(r.w, r.h) * (shape === 'frame' ? 0.03 : 0.12) });
      }
      for (var k in common) node.setAttribute(k, common[k]);
      if (!fill && shape !== 'frame') node.style.fill = 'var(--surface)';
      if (shape === 'image' && typeof d.imageUrl === 'string' && d.imageUrl.indexOf('data:image/') === 0) {
        svg.appendChild(node);
        svg.appendChild(el('image', { href: d.imageUrl, x: r.x, y: r.y, width: r.w, height: r.h, preserveAspectRatio: 'xMidYMid slice' }));
        return;
      }
      svg.appendChild(node);
      if (shape !== 'frame' && d.title) drawText(svg, r, d, true);
    });

    box.appendChild(svg);
    return box;
  }

  function drawText(svg, r, d, inside) {
    var text = String(d.title || '').split('\n')[0].slice(0, 60);
    if (!text) return;
    var size = inside ? Math.min(r.h * 0.32, r.w / Math.max(text.length, 1) * 1.6) : r.h * num(d.fontScale, 0.4);
    if (!(size > 0)) return;
    var hand = d.fontFamily === 'handwriting';
    var t = el('text', {
      x: r.x + r.w / 2,
      y: r.y + (inside ? r.h / 2 : size * 1.05),
      'font-size': size,
      'font-family': hand ? "Excalifont, 'Xiaolai KR', cursive" : 'inherit',
      'font-weight': d.fontWeight === 'bold' ? 700 : 400,
      'text-anchor': 'middle',
      'dominant-baseline': inside ? 'central' : 'auto',
      fill: color(d.textColor, 'currentColor'),
    });
    t.textContent = text;
    svg.appendChild(t);
  }

  // ── 아이콘 (별 · ⋯) ───────────────────────────────────
  function icon(paths) {
    var s = el('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    paths.forEach(function (p) { s.appendChild(el(p[0], p[1])); });
    return s;
  }
  var STAR = [['path', { d: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z' }]];
  var DOTS = [['circle', { cx: 5, cy: 12, r: 1.3 }], ['circle', { cx: 12, cy: 12, r: 1.3 }], ['circle', { cx: 19, cy: 12, r: 1.3 }]];

  function tools(p) {
    var wrap = document.createElement('div');
    wrap.className = 'row__tools';
    var star = document.createElement('button');
    star.type = 'button';
    star.className = 'mini mini--star' + (p.starred ? ' is-on' : '');
    star.title = p.starred ? '즐겨찾기에서 빼기' : '즐겨찾기';
    star.setAttribute('aria-label', star.title);
    star.setAttribute('aria-pressed', p.starred ? 'true' : 'false');
    star.appendChild(icon(STAR));
    star.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); toggleStar(p.id); });

    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'mini';
    more.title = '더 보기';
    more.setAttribute('aria-label', p.name + ' 메뉴');
    more.setAttribute('aria-haspopup', 'menu');
    more.appendChild(icon(DOTS));
    more.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); openMenu(p.id, more); });

    wrap.appendChild(star);
    wrap.appendChild(more);
    return wrap;
  }

  // ── 목록 그리기 ───────────────────────────────────────
  function visible() {
    var q = state.query.trim().toLowerCase();
    var list = state.projects.filter(function (p) {
      if (state.filter === 'starred' && !p.starred) return false;
      return !q || p.name.toLowerCase().indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      if (state.sort === 'name') return a.name.localeCompare(b.name, 'ko');
      if (state.sort === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
    return list;
  }

  var firstRender = true;
  function render() {
    var list = visible();
    var total = state.projects.length;
    $('count').textContent = total ? total + '개' : '';

    listEl.className = 'projects projects--' + state.view;
    listEl.textContent = '';

    if (state.view === 'list' && list.length) {
      var head = document.createElement('div');
      head.className = 'list-head';
      ['이름', '마지막 수정', '만든 날'].forEach(function (t) {
        var s = document.createElement('span'); s.textContent = t; head.appendChild(s);
      });
      listEl.appendChild(head);
    }

    list.forEach(function (p, i) {
      var a = document.createElement('a');
      a.href = 'board/?id=' + encodeURIComponent(p.id);
      a.dataset.id = p.id;
      if (state.view === 'grid') {
        a.className = firstRender ? 'card card--in' : 'card';
        if (firstRender) a.style.animationDelay = Math.min(i * 30, 300) + 'ms';
        a.appendChild(renderThumb(p.id));
        var body = document.createElement('div');
        body.className = 'card__body';
        var text = document.createElement('div');
        text.className = 'card__text';
        var name = document.createElement('div');
        name.className = 'card__name';
        name.textContent = p.name;
        var meta = document.createElement('div');
        meta.className = 'card__meta';
        meta.textContent = ago(p.updatedAt) + ' 수정';
        text.appendChild(name);
        text.appendChild(meta);
        body.appendChild(text);
        body.appendChild(tools(p));
        a.appendChild(body);
      } else {
        a.className = 'row';
        a.appendChild(renderThumb(p.id));
        var n = document.createElement('div');
        n.className = 'row__name';
        n.textContent = p.name;
        var u = document.createElement('div');
        u.className = 'row__date';
        u.textContent = ago(p.updatedAt);
        var c = document.createElement('div');
        c.className = 'row__date';
        c.textContent = date(p.createdAt);
        a.appendChild(n); a.appendChild(u); a.appendChild(c);
        a.appendChild(tools(p));
      }
      listEl.appendChild(a);
    });

    var empty = $('empty');
    empty.hidden = list.length > 0;
    listEl.hidden = list.length === 0;
    if (!list.length) {
      var searching = state.query.trim() !== '';
      var starredOnly = state.filter === 'starred' && total > 0;
      $('empty-title').textContent = searching ? '찾는 프로젝트가 없어요' : starredOnly ? '즐겨찾기한 프로젝트가 없어요' : '아직 프로젝트가 없어요';
      $('empty-text').textContent = searching ? '다른 이름으로 검색해 보세요.' : starredOnly ? '카드의 별을 눌러 자주 여는 프로젝트를 모아 두세요.' : '새 프로젝트를 만들어 바로 그려 보세요.';
      $('empty-new').hidden = searching || starredOnly;
    }

    document.querySelectorAll('[data-filter]').forEach(function (b) {
      var on = b.dataset.filter === state.filter;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.classList.toggle('is-on', b.dataset.view === state.view);
      b.setAttribute('aria-pressed', b.dataset.view === state.view ? 'true' : 'false');
    });
    $('sort').value = state.sort;
    firstRender = false;
  }

  // ── 동작 ──────────────────────────────────────────────
  function update(id, patch) {
    state.projects = state.projects.map(function (p) { return p.id === id ? Object.assign({}, p, patch) : p; });
    saveProjects(state.projects);
    render();
  }
  function toggleStar(id) {
    var p = find(id);
    if (p) update(id, { starred: !p.starred });
  }
  function find(id) {
    for (var i = 0; i < state.projects.length; i++) if (state.projects[i].id === id) return state.projects[i];
    return null;
  }
  function uniqueName(base) {
    var names = {};
    state.projects.forEach(function (p) { names[p.name] = true; });
    if (!names[base]) return base;
    for (var i = 2; ; i++) if (!names[base + ' ' + i]) return base + ' ' + i;
  }

  function createProject() {
    ask({ title: '새 프로젝트', value: uniqueName('제목 없는 프로젝트'), ok: '만들기' }, function (name) {
      var now = Date.now();
      var p = { id: newId(), name: name, createdAt: now, updatedAt: now };
      state.projects.push(p);
      if (!saveProjects(state.projects)) { state.projects.pop(); alertMsg('저장 공간이 부족해 만들 수 없어요.'); return; }
      location.href = 'board/?id=' + encodeURIComponent(p.id);
    });
  }
  function renameProject(id) {
    var p = find(id);
    if (!p) return;
    ask({ title: '이름 바꾸기', value: p.name, ok: '바꾸기' }, function (name) { update(id, { name: name }); });
  }
  function duplicateProject(id) {
    var p = find(id);
    if (!p) return;
    var now = Date.now();
    var copy = { id: newId(), name: uniqueName(p.name + ' 사본'), createdAt: now, updatedAt: now, starred: false };
    var data = store.get(canvasKey(id));
    if (data && !store.set(canvasKey(copy.id), data)) { alertMsg('저장 공간이 부족해 복제할 수 없어요.'); return; }
    state.projects.push(copy);
    saveProjects(state.projects);
    render();
  }
  function deleteProject(id) {
    var p = find(id);
    if (!p) return;
    confirmMsg({ title: '프로젝트를 삭제할까요?', text: '‘' + p.name + '’의 캔버스가 이 브라우저에서 지워지고 되돌릴 수 없어요.', ok: '삭제', danger: true }, function () {
      state.projects = state.projects.filter(function (x) { return x.id !== id; });
      saveProjects(state.projects);
      store.del(canvasKey(id));
      render();
    });
  }

  // ── ⋯ 메뉴 ────────────────────────────────────────────
  var menu = $('menu');
  var menuFor = null, menuAnchor = null;
  function openMenu(id, anchor) {
    if (menuFor === id && !menu.hidden) { closeMenu(); return; }
    menuFor = id; menuAnchor = anchor;
    menu.hidden = false;
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.min(r.right - mw, window.innerWidth - mw - 8);
    var top = r.bottom + 6 + mh > window.innerHeight ? r.top - mh - 6 : r.bottom + 6;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus();
  }
  function closeMenu(refocus) {
    if (menu.hidden) return;
    menu.hidden = true;
    if (menuAnchor) {
      menuAnchor.setAttribute('aria-expanded', 'false');
      if (refocus) menuAnchor.focus();
    }
    menuFor = null; menuAnchor = null;
  }
  menu.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var id = menuFor;
    closeMenu();
    var act = b.dataset.act;
    if (act === 'open') location.href = 'board/?id=' + encodeURIComponent(id);
    else if (act === 'rename') renameProject(id);
    else if (act === 'duplicate') duplicateProject(id);
    else if (act === 'delete') deleteProject(id);
  });
  menu.addEventListener('keydown', function (e) {
    var items = Array.prototype.slice.call(menu.querySelectorAll('button'));
    var i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  });
  document.addEventListener('pointerdown', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== menuAnchor && !(menuAnchor && menuAnchor.contains(e.target))) closeMenu();
  });
  window.addEventListener('resize', function () { closeMenu(); });
  window.addEventListener('scroll', function () { closeMenu(); }, true);

  // ── 창: 이름 입력 / 확인 ──────────────────────────────
  var dialog = $('dialog');
  var dInput = $('dialog-input');
  var dOk = $('dialog-ok');
  var onOk = null;

  function openDialog(opts, cb) {
    $('dialog-title').textContent = opts.title;
    $('dialog-text').textContent = opts.text || '';
    dInput.hidden = opts.value === undefined;
    dInput.required = opts.value !== undefined;
    dInput.value = opts.value || '';
    dOk.textContent = opts.ok || '확인';
    dOk.className = 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary');
    var cancel = dialog.querySelector('[value="cancel"]');
    cancel.hidden = !!opts.noCancel;
    onOk = cb;
    dialog.returnValue = '';
    dialog.showModal();
    if (!dInput.hidden) { dInput.focus(); dInput.select(); } else dOk.focus();
  }
  function ask(opts, cb) {
    openDialog(opts, function () {
      var name = dInput.value.trim().slice(0, 60);
      if (name) cb(name);
    });
  }
  function confirmMsg(opts, cb) { openDialog(opts, cb); }
  function alertMsg(text) { openDialog({ title: '알림', text: text, ok: '확인', noCancel: true }, null); }

  dialog.addEventListener('close', function () {
    var cb = onOk;
    onOk = null;
    if (dialog.returnValue === 'ok' && cb) cb();
  });
  // 입력 칸에서 Enter = 확인 (폼 기본 동작은 첫 버튼인 '취소'를 누름)
  dInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing) return;
    e.preventDefault();
    if (dInput.value.trim()) dialog.close('ok');
  });
  $('dialog-form').addEventListener('submit', function (e) {
    var submitter = e.submitter;
    if (submitter && submitter.value === 'ok' && !dInput.hidden && !dInput.value.trim()) {
      e.preventDefault();
      dInput.focus();
    }
  });

  // ── 테마 (캔버스 화면과 같은 설정) ────────────────────
  $('theme-btn').addEventListener('click', function () {
    var dark = !document.documentElement.classList.contains('dark-mode');
    document.documentElement.classList.toggle('dark-mode', dark);
    store.set(THEME_KEY, dark ? 'dark' : 'light');
  });

  // ── 도구 줄 ───────────────────────────────────────────
  var search = $('search');
  search.addEventListener('input', function () { state.query = search.value; render(); });
  document.querySelectorAll('[data-filter]').forEach(function (b) {
    b.addEventListener('click', function () { state.filter = b.dataset.filter; render(); });
  });
  document.querySelectorAll('[data-view]').forEach(function (b) {
    b.addEventListener('click', function () { state.view = b.dataset.view; store.set(VIEW_KEY, state.view); render(); });
  });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; store.set(SORT_KEY, state.sort); render(); });
  $('new-btn').addEventListener('click', createProject);
  $('empty-new').addEventListener('click', createProject);

  // 단축키: / 검색, Esc 메뉴·검색 닫기
  document.addEventListener('keydown', function (e) {
    if (dialog.open) return;
    if (e.key === 'Escape') {
      if (!menu.hidden) closeMenu(true);
      else if (document.activeElement === search && search.value) { search.value = ''; state.query = ''; render(); }
      return;
    }
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); search.focus(); }
  });

  // 다른 탭(캔버스)에서 저장하면 목록·미리보기·테마 바로 반영
  window.addEventListener('storage', function (e) {
    if (e.key === THEME_KEY) document.documentElement.classList.toggle('dark-mode', e.newValue === 'dark');
    if (e.key === PROJECTS_KEY || (e.key && e.key.indexOf('web-canvas-data:') === 0)) {
      state.projects = loadProjects();
      render();
    }
  });
  // 캔버스에서 뒤로 왔을 때 (페이지 캐시) 최신으로
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { state.projects = loadProjects(); render(); }
  });
  // '3분 전' 같은 글자를 1분마다 새로
  setInterval(function () { if (menu.hidden && !dialog.open) render(); }, 60000);

  render();
})();
