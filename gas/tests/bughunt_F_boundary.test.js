'use strict';
// bug hunter F: 境界値と差分（同じデータを別のビュー・シートが同じ数に数えるか）のテスト。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const GAS_DIR = path.join(__dirname, '..');
const md = require('../pure_markdown.js');
const { normalizeSprint, filterRealRows } = require('../pure_filter.js');
const { KANBAN_STATUSES, buildKanbanGrid, buildRoadmapGrid, realSprints } = require('../pure_grid_board.js');
const { buildDashboardGrid, buildVelocityGrid, buildBurndownGrid } = require('../pure_grid_report.js');
const { buildBacklogGrid, buildDoneBacklogGrid } = require('../pure_grid_backlog.js');
const { buildBoardData } = require('../pure_board_view.js');
const { buildListView } = require('../pure_view_backlog.js');
const { buildRoadmapView, buildVelocityView, buildBurndownView } = require('../pure_view_sprint.js');
const { summarizeBacklog, summarizeSprint } = require('../pure_summary.js');
const { sprintChoices } = require('../pure_sprint_options.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- markdown ----------

test('CRLF の表・見出しでも見出しと表が取れ、セルに \\r が残らない', () => {
  const t = md.extractMarkdownTable('# x\r\n\r\n## バーンダウン  \r\n\r\n| 日 | 残 |  \r\n|---|---|\r\n| 1 | 10 |  \r\n', 'バーンダウン');
  assert.deepEqual(t, { headers: ['日', '残'], rows: [['1', '10']] });
});

test('区切り行の配置指定（:---: / ---:）と全角スペース入りの見出しを扱える', () => {
  const t = md.extractMarkdownTable('##　T　\n| a | b |\n|:---:|---:|\n| 1 | 2 |\n', 'T');
  assert.deepEqual(t, { headers: ['a', 'b'], rows: [['1', '2']] });
});

test('セル内の \\| はパイプ文字として残り、列は増えない', () => {
  const t = md.extractMarkdownTable('## T\n| a \\| x | b |\n|---|---|\n| 1 \\| | 2 |\n', 'T');
  assert.deepEqual(t, { headers: ['a | x', 'b'], rows: [['1 |', '2']] });
});

test('見出しだけで本文が無いセクションは表 null・本文空', () => {
  assert.equal(md.extractMarkdownTable('## T\n## U\n| a |\n|---|\n', 'T'), null);
  assert.equal(md.extractSection('## T\n## U\nfoo\n', 'T'), '');
  assert.equal(md.extractSection('', 'T'), '');
  assert.equal(md.extractSection(null, 'T'), '');
});

test('同名の見出しが複数あれば最初のものを採る', () => {
  const text = '## T\nfirst\n## U\nx\n## T\nsecond\n';
  assert.equal(md.extractSection(text, 'T'), 'first');
});

test('ヘッダーだけ（区切り行無し・1行）の表は null、ヘッダー+区切りは行 0 件', () => {
  assert.equal(md.extractMarkdownTable('## T\n| a | b |\n', 'T'), null);
  assert.deepEqual(md.extractMarkdownTable('## T\n| a | b |\n|---|---|\n', 'T'), { headers: ['a', 'b'], rows: [] });
});

test('テンプレートのバーンダウン（Day 1 | - | -）の行は落ちない', () => {
  const text = fs.readFileSync(path.join(GAS_DIR, '..', 'scrum', 'sprintSAMPLE', 'sprint_backlog.md'), 'utf8');
  const g = buildBurndownGrid(text);
  assert.deepEqual(g, [['日付', '残タスク数', '残ポイント'], ['Day 1', '-', '-']]);
});

test('目標セクション: 引用と表を除き、CRLF でも先頭末尾が trim される', () => {
  const text = '## スプリントゴール\r\n\r\nA\r\n\r\n> 引用\r\n> — x\r\n\r\n| a |\r\n\r\n## 次\r\n';
  assert.equal(md.extractSection(text, 'スプリントゴール'), 'A');
});

// ---------- スプリント名 ----------

test('normalizeSprint: 大文字小文字・区切り・ゼロ埋めの揺れを同じ鍵にする', () => {
  const same = ['Sprint 1', 'sprint001', 'SPRINT_1', 'sprint-1', 'sprint0001', ' Sprint 001 ', 'Sprint  01', 'sprint\t1'];
  const keys = new Set(same.map(normalizeSprint));
  assert.equal(keys.size, 1, JSON.stringify(Array.from(keys)));
});

test('normalizeSprint: 別のスプリントは別の鍵・空は空', () => {
  assert.notEqual(normalizeSprint('Sprint 1'), normalizeSprint('Sprint 2'));
  assert.notEqual(normalizeSprint('Sprint 1'), normalizeSprint('Sprint 10'));
  assert.notEqual(normalizeSprint('Sprint 1'), normalizeSprint('Sprint 100'));
  assert.equal(normalizeSprint('   '), '');
  assert.equal(normalizeSprint(null), '');
  assert.equal(normalizeSprint(undefined), '');
  assert.equal(normalizeSprint('Sprint 1000'), 'sprint1000');
});

test('sprintChoices: 表記が違うだけのスプリントは「velocity.csv に無い」にならない', () => {
  const vel = [{ sprint: 'sprint001', sprint_start: '2026-01-01', sprint_end: '2026-01-14' }];
  const rows = [
    { id: 'PBI-001', title: 'a', sprint: 'Sprint 1' },
    { id: 'PBI-002', title: 'b', sprint: 'SPRINT_001' },
    { id: 'PBI-003', title: 'c', sprint: 'Sprint 2' },
    { id: 'PBI-004', title: 'd', sprint: '  Sprint 2  ' },
  ];
  const opts = sprintChoices(vel, rows);
  const byValue = {};
  opts.forEach((o) => { assert.equal(byValue[o.value], undefined, '重複 ' + o.value); byValue[o.value] = o; });
  assert.equal(byValue['Sprint 1'].unknown, false);
  assert.equal(byValue['SPRINT_001'].unknown, false);
  assert.equal(byValue['Sprint 2'].unknown, true);
  assert.equal(opts.filter((o) => o.value.trim() === 'Sprint 2').length, 1);
});

// ---------- 差分: 同じバックログを数える全ての経路 ----------

const STATUS_POOL = ['New', 'Ready', 'In Progress', 'Review', 'Done', ' done', 'Done ', 'done', '', '完了', 'IN PROGRESS', '  Review  '];
const SIZE_POOL = ['1', '2', '3', '5', '8', '0.5', '', 'x', '3pt', '1e1', ' 4 ', '-1', '（ポイント）'];
const SPRINT_POOL = ['', 'Sprint 1', 'sprint001', 'Sprint 2', 'sprint 3', 'Sprint 9', ' Sprint 2 '];

function randomBacklog(rand) {
  const n = Math.floor(rand() * 14);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = rand();
    const row = {
      id: r < 0.1 ? 'PBI-XXX' : 'PBI-' + String(i + 1).padStart(3, '0'),
      title: r > 0.9 ? '（タイトル）' : r > 0.8 ? '' : 'タイトル' + i,
      size: SIZE_POOL[Math.floor(rand() * SIZE_POOL.length)],
      status: STATUS_POOL[Math.floor(rand() * STATUS_POOL.length)],
      sprint: SPRINT_POOL[Math.floor(rand() * SPRINT_POOL.length)],
      priority: rand() > 0.95 ? 'Critical/High' : 'High',
      created_at: '2026-01-01',
    };
    rows.push(row);
  }
  return rows;
}

function normStatus(s) {
  const t = String(s || '').trim();
  return KANBAN_STATUSES.indexOf(t) === -1 ? 'New' : t;
}

test('差分: 盤面・一覧・要約・ダッシュボード・カンバンシート・バックログシートが同じ件数/ポイントを数える', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const rows = randomBacklog(mulberry32(seed));
    const ctxMsg = 'seed=' + seed + ' rows=' + JSON.stringify(rows);
    const real = filterRealRows(rows);
    const expectCount = {};
    const expectPoints = {};
    KANBAN_STATUSES.forEach((s) => { expectCount[s] = 0; expectPoints[s] = 0; });
    real.forEach((r) => {
      const s = normStatus(r.status);
      expectCount[s] += 1;
      const n = parseFloat(r.size);
      expectPoints[s] += isNaN(n) ? 0 : n;
    });

    const summary = summarizeBacklog(rows, KANBAN_STATUSES);
    summary.byStatus.forEach((x) => {
      assert.equal(x.count, expectCount[x.status], ctxMsg);
      assert.equal(x.points, expectPoints[x.status], ctxMsg);
    });
    assert.equal(summary.total.count, real.length, ctxMsg);

    const board = buildBoardData(rows);
    board.columns.forEach((c) => assert.equal(c.cards.length, expectCount[c.status], ctxMsg));
    const boardIds = [].concat(...board.columns.map((c) => c.cards.map((k) => k.id))).sort();
    assert.deepEqual(boardIds, real.map((r) => r.id.trim()).sort(), ctxMsg);

    const list = buildListView(rows);
    assert.equal(list.rows.length, real.length, ctxMsg);

    const dash = buildDashboardGrid({ backlogRows: rows });
    const at = dash.findIndex((r) => r[0] === 'ステータス' && r[1] === '件数');
    KANBAN_STATUSES.forEach((s, i) => {
      assert.deepEqual(dash[at + 1 + i].slice(0, 3), [s, String(expectCount[s]), String(expectPoints[s])], ctxMsg);
    });
    assert.equal(dash[at + 6][1], String(real.length), ctxMsg);

    const kanban = buildKanbanGrid(rows);
    KANBAN_STATUSES.forEach((s, c) => {
      const cells = kanban.slice(1).map((r) => r[c]).filter((x) => x !== '');
      assert.equal(cells.length, expectCount[s], ctxMsg);
    });

    assert.equal(buildBacklogGrid(rows, {}).length - 1, real.length, ctxMsg);
    assert.equal(buildDoneBacklogGrid(rows).length - 1, real.length, ctxMsg);
  }
});

test('差分: ロードマップの ■ の数 = 帯の位置の数 = velocity に在るスプリントの PBI 数（重複なしの velocity）', () => {
  const vel = [
    { sprint: 'sprint001', sprint_start: '2026-01-01', sprint_end: '2026-01-14' },
    { sprint: 'sprint002', sprint_start: '2026-01-15', sprint_end: '2026-01-28' },
    { sprint: 'sprint003', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' },
  ];
  for (let seed = 1; seed <= 200; seed++) {
    const rows = randomBacklog(mulberry32(seed + 1000));
    const msg = 'seed=' + seed;
    const view = buildRoadmapView(rows, vel);
    const real = filterRealRows(rows);
    const inRoadmap = real.filter((r) => ['sprint001', 'sprint002'].indexOf(normalizeSprint(r.sprint)) !== -1);
    assert.equal(view.table.rows.length, real.length, msg);
    const bandCells = view.table.rows.reduce((a, r) => a + r.slice(2).filter((c) => c === '■').length, 0);
    assert.equal(bandCells, inRoadmap.length, msg);
    assert.equal(view.marks.length, inRoadmap.length, msg);
    view.marks.forEach((m) => assert.equal(view.table.rows[m.row][m.col], '■', msg));
    // 実在 2 スプリントしか列にならない
    assert.equal(view.table.headers.length, 2 + 2, msg);
  }
});

test('差分: ベロシティのビューとシートは同じ行、サマリは最後の実在スプリント', () => {
  const vel = [
    { sprint: 'sprint001', planned_points: '10', completed_points: '8', carried_over_points: '2', sprint_start: '2026-01-01', sprint_end: '2026-01-14', notes: '' },
    { sprint: 'sprint002', planned_points: '', completed_points: 'abc', carried_over_points: '', sprint_start: '2026-02-29', sprint_end: '2026-03-01', notes: 'うるう日でない' },
    { sprint: 'sprint003', planned_points: '1', completed_points: '1', carried_over_points: '0', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD', notes: '' },
  ];
  const view = buildVelocityView(vel);
  const grid = buildVelocityGrid(vel);
  assert.deepEqual(view.table.headers, grid[0]);
  assert.deepEqual(view.table.rows, grid.slice(1));
  const s = summarizeSprint(vel, '');
  assert.equal(s.sprint, 'sprint002');
  assert.equal(s.planned, 0);
  assert.equal(s.completed, 0);
  assert.equal(realSprints(vel).length, view.table.rows.length);
});

test('日付の境界: 同日開始終了・年またぎ・うるう日は実在スプリントとして扱われる', () => {
  const mk = (a, b) => ({ sprint: 's' + a, sprint_start: a, sprint_end: b });
  const rows = [mk('2026-03-01', '2026-03-01'), mk('2026-12-28', '2027-01-10'), mk('2028-02-29', '2028-03-13')];
  assert.equal(realSprints(rows).length, 3);
  assert.equal(buildVelocityGrid(rows).length, 4);
  const road = buildRoadmapGrid([], rows);
  assert.equal(road.grid[0].length, 5);
  // 区切りが違う・桁が足りない・時刻付きは対象外
  const bad = [mk('2026/03/01', '2026/03/02'), mk('2026-3-1', '2026-3-2'), mk('2026-03-01 00:00', '2026-03-02'), mk('', '2026-03-02')];
  assert.equal(realSprints(bad).length, 0);
  assert.equal(buildVelocityGrid(bad).length, 1);
});

test('velocity が空・実在 0 件でもビューは落ちず、ロードマップは案内を持つ', () => {
  const v = buildRoadmapView([{ id: 'PBI-001', title: 'a', sprint: 'Sprint 1' }], []);
  assert.equal(v.marks.length, 0);
  assert.ok(v.notice);
  assert.deepEqual(v.table.headers, ['ID', 'タイトル']);
  assert.equal(summarizeSprint([], 'x'), null);
  assert.equal(buildBurndownView('') , null);
  assert.equal(buildBurndownView(undefined), null);
});

// ---------- GAS 層（vm） ----------

function loadGas() {
  const context = vm.createContext({ console: console });
  fs.readdirSync(GAS_DIR).filter((n) => n.slice(-3) === '.js').sort().forEach((n) => {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), context, { filename: n });
  });
  return context;
}

function fakeSheet(opts) {
  const o = opts || {};
  const s = {
    maxRows: o.maxRows === undefined ? 1000 : o.maxRows,
    maxCols: o.maxCols === undefined ? 26 : o.maxCols,
    values: o.values || [],
    log: [],
    written: null,
  };
  const checkRange = (r, c, nr, nc) => {
    if (r + nr - 1 > s.maxRows || c + nc - 1 > s.maxCols) throw new Error('範囲外 ' + r + ',' + c + ',' + nr + ',' + nc + ' max ' + s.maxRows + 'x' + s.maxCols);
  };
  s.clear = () => { s.log.push('clear'); };
  s.getMaxRows = () => s.maxRows;
  s.getMaxColumns = () => s.maxCols;
  s.insertRowsAfter = (pos, n) => { assert.equal(pos, s.maxRows); s.maxRows += n; };
  s.insertColumnsAfter = (pos, n) => { assert.equal(pos, s.maxCols); s.maxCols += n; };
  s.getLastRow = () => s.values.length;
  s.getLastColumn = () => s.values.reduce((m, r) => Math.max(m, r.length), 0);
  s.setFrozenRows = () => {};
  s.getRange = (r, c, nr, nc) => {
    nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
    checkRange(r, c, nr, nc);
    const range = {
      setValues: (v) => {
        assert.equal(v.length, nr, 'setValues の行数');
        v.forEach((row) => assert.equal(row.length, nc, 'setValues の列数（行ごとに揃っていること）'));
        s.written = JSON.parse(JSON.stringify(v));
        return range;
      },
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = [];
          for (let j = 0; j < nc; j++) {
            const src = s.values[r - 1 + i] || [];
            row.push(src[c - 1 + j] === undefined ? '' : src[c - 1 + j]);
          }
          out.push(row);
        }
        return out;
      },
      setBackground: () => range, setFontColor: () => range, setFontWeight: () => range,
      setBackgrounds: (m) => { s.bg = { r, c, nr, nc, m: JSON.parse(JSON.stringify(m)) }; return range; },
    };
    return range;
  };
  return s;
}

function fakeSs(sheet) {
  return { getSheetByName: () => sheet, insertSheet: () => sheet };
}

test('writeGrid_: スプリントが増えて 26 列を超えるロードマップでも範囲外にならず、列が足される', () => {
  const ctx = loadGas();
  const vel = [];
  for (let i = 1; i <= 40; i++) {
    vel.push({ sprint: 'sprint' + String(i).padStart(3, '0'), sprint_start: '2026-01-01', sprint_end: '2026-01-14' });
  }
  const rows = [{ id: 'PBI-001', title: 'a', sprint: 'Sprint 40' }];
  const road = ctx.buildRoadmapGrid(rows, vel);
  const sheet = fakeSheet();
  ctx.writeGrid_(fakeSs(sheet), 'ロードマップ', road.grid);
  assert.equal(sheet.maxCols, 42);
  assert.equal(sheet.written[0].length, 42);
  ctx.paintMarks_(sheet, road.marks, '#a8c7fa');
  assert.equal(sheet.bg.c, 42);
  assert.equal(sheet.bg.m[0][0], '#a8c7fa');
});

test('writeGrid_: 1000 行を超える表でも行が足される', () => {
  const ctx = loadGas();
  const grid = [['ID']];
  for (let i = 0; i < 1500; i++) grid.push(['PBI-' + i]);
  const sheet = fakeSheet();
  ctx.writeGrid_(fakeSs(sheet), 'x', grid);
  assert.equal(sheet.maxRows, 1501);
  assert.equal(sheet.written.length, 1501);
});

test('writeGrid_: 行ごとに列数が違う表は空文字で埋めて書く・空の表は何も書かない', () => {
  const ctx = loadGas();
  const sheet = fakeSheet();
  ctx.writeGrid_(fakeSs(sheet), 'x', [['a', 'b', 'c'], ['1'], [], ['1', '2', '3', '4']]);
  assert.deepEqual(sheet.written, [['a', 'b', 'c', ''], ['1', '', '', ''], ['', '', '', ''], ['1', '2', '3', '4']]);
  const empty = fakeSheet();
  ctx.writeGrid_(fakeSs(empty), 'x', [[], []]);
  assert.equal(empty.written, null);
  ctx.writeGrid_(fakeSs(empty), 'x', []);
  ctx.writeGrid_(fakeSs(empty), 'x', null);
  assert.equal(empty.written, null);
});

test('readNotes_: 奇妙なシート（空・ヘッダーだけ・列が足りない・数値/空白のキー）', () => {
  const ctx = loadGas();
  const read = (values) => JSON.parse(JSON.stringify(ctx.readNotes_(fakeSs(fakeSheet({ values: values })), 'x', 0, 10)));
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.readNotes_({ getSheetByName: () => null }, 'x', 0, 10))), {});
  assert.deepEqual(read([]), {});
  assert.deepEqual(read([['ID']]), {});
  const pad = (key, note) => { const r = new Array(11).fill(''); r[0] = key; r[10] = note; return r; };
  const header = new Array(11).fill('h');
  assert.deepEqual(read([header, pad('PBI-001', 'メモ')]), { 'PBI-001': 'メモ' });
  // 前後の空白は落とす・キーかメモが空なら捨てる・数値メモは文字列
  assert.deepEqual(read([header, pad(' PBI-002 ', ' 注 '), pad('', 'キー無し'), pad('PBI-003', ''), pad('PBI-004', 42)]),
    { 'PBI-002': '注', 'PBI-004': '42' });
  // メモ列まで届いていない（列が足りない）シートはメモ無し
  assert.deepEqual(read([['ID', 'タイトル'], ['PBI-001', 'a']]), {});
  // 同じキーが2行あれば後の行が勝つ（実装の挙動を固定）
  assert.deepEqual(read([header, pad('PBI-001', '古'), pad('PBI-001', '新')]), { 'PBI-001': '新' });
});

test('writeGrid_ → readNotes_ の往復: 先頭が数式記号のメモは \' 付きで書かれ、メモ列の位置がずれない', () => {
  const ctx = loadGas();
  const grid = ctx.buildBacklogGrid([{ id: 'PBI-001', title: 'a', created_at: '2026-01-01', priority: 'High' }], { 'PBI-001': '=HYPERLINK("x")' });
  const sheet = fakeSheet();
  ctx.writeGrid_(fakeSs(sheet), 'バックログ', grid);
  assert.equal(sheet.written[0][vm.runInContext('BACKLOG_NOTE_COL', ctx)], 'メモ');
  assert.equal(sheet.written[1][vm.runInContext('BACKLOG_NOTE_COL', ctx)], '\'=HYPERLINK("x")');
  assert.equal(sheet.written[1][vm.runInContext('BACKLOG_KEY_COL', ctx)], 'PBI-001');
});

// ---------- scripts/publish.js（一時ディレクトリ内の偽リポジトリで実行） ----------

function makeFakeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-f-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(GAS_DIR, '..', 'scripts', 'publish.js'), path.join(root, 'scripts', 'publish.js'));
  return root;
}

function runPublish(root, dest) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'publish.js'), dest], { encoding: 'utf8' });
}

test('publish: 空白・日本語のファイル名、空ディレクトリ、よく似た名前のファイルを欠かさず配布する', () => {
  const root = makeFakeRepo();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-f-dest-'));
  try {
    fs.mkdirSync(path.join(root, 'scrum', 'sprint 001', '日本語 フォルダ'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scrum', 'emptydir'));
    fs.mkdirSync(path.join(root, '.claude', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Scrum'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scrum', 'sprint 001', '日本語 フォルダ', 'ふぁいる 1.md'), 'a');
    fs.writeFileSync(path.join(root, 'scrum', 'comments.csv'), 'x');
    fs.writeFileSync(path.join(root, 'scrum', 'comments.csv.bak'), 'y');
    fs.writeFileSync(path.join(root, '.claude', 'agents', 'a.md'), 'z');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'c');
    fs.writeFileSync(path.join(root, 'README.md'), 'r');
    const r = runPublish(root, dest);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(dest, 'scrum', 'sprint 001', '日本語 フォルダ', 'ふぁいる 1.md'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(dest, 'scrum', 'comments.csv'), 'utf8'), 'x');
    assert.equal(fs.readFileSync(path.join(dest, 'scrum', 'comments.csv.bak'), 'utf8'), 'y');
    assert.ok(fs.statSync(path.join(dest, 'scrum', 'emptydir')).isDirectory());
    // 配布対象外（Scrum/ は4点に無い）
    assert.equal(fs.existsSync(path.join(dest, 'Scrum')) && !fs.existsSync(path.join(dest, 'scrum')), false);
    const rec = JSON.parse(fs.readFileSync(path.join(dest, 'scrum', '.published.json'), 'utf8'));
    assert.ok(rec.publishedAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rec.publishedAt));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('publish: 配布先にだけあるファイル（メンバーが作った成果物）は消えず、再実行しても同じ結果', () => {
  // Web アプリが書き戻すファイル（KEEP_IF_EXISTS）は上書きしない仕様なので、ここでは書き戻さないファイルで見る。
  const root = makeFakeRepo();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-f-dest-'));
  try {
    fs.mkdirSync(path.join(root, 'scrum'));
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, 'scrum', 'velocity.csv'), 'v1');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'c');
    fs.mkdirSync(path.join(dest, 'scrum', 'sprint009'), { recursive: true });
    fs.writeFileSync(path.join(dest, 'scrum', 'sprint009', 'mine.md'), 'keep');
    assert.equal(runPublish(root, dest).status, 0);
    fs.writeFileSync(path.join(root, 'scrum', 'velocity.csv'), 'v2');
    assert.equal(runPublish(root, dest).status, 0);
    assert.equal(fs.readFileSync(path.join(dest, 'scrum', 'sprint009', 'mine.md'), 'utf8'), 'keep');
    assert.equal(fs.readFileSync(path.join(dest, 'scrum', 'velocity.csv'), 'utf8'), 'v2');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('publish: ファイルとディレクトリが入れ替わった場合は失敗として終了コード 1 で、配布記録を書かない', () => {
  const root = makeFakeRepo();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-f-dest-'));
  try {
    fs.mkdirSync(path.join(root, 'scrum'));
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, 'scrum', 'thing'), 'file now');
    fs.mkdirSync(path.join(dest, 'scrum', 'thing'), { recursive: true });
    const r = runPublish(root, dest);
    assert.equal(r.status, 1);
    assert.equal(fs.existsSync(path.join(dest, 'scrum', '.published.json')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});
