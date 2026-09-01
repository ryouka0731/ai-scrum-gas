const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildVelocityGrid, buildBurndownGrid, buildImpedimentGrid,
  IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL, buildDashboardGrid,
} = require('../pure_grid_report.js');

const VELOCITY = [
  { sprint: 'sprint001', planned_points: '21', completed_points: '18', carried_over_points: '3', sprint_start: '2026-09-08', sprint_end: '2026-09-19', notes: '' },
  { sprint: 'sprint002', planned_points: '0', completed_points: '0', carried_over_points: '0', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD', notes: '（備考）' },
];

const SPRINT_MD = [
  '# スプリントバックログ - Sprint 001',
  '## スプリントゴール',
  'ログインを使える状態にする。',
  '## バーンダウン',
  '| 日付 | 残タスク数 | 残ポイント |',
  '|------|------------|------------|',
  '| Day 1 | 8 | 21 |',
  '| Day 2 | 6 | 18 |',
].join('\n');

test('ベロシティは期間が埋まった行だけを出す', () => {
  const g = buildVelocityGrid(VELOCITY);
  assert.deepEqual(g[0], ['スプリント', '計画', '完了', '持ち越し', '開始日', '終了日', '備考']);
  assert.equal(g.length, 2);
  assert.equal(g[1][0], 'sprint001');
});

test('バーンダウン表を抽出する', () => {
  const g = buildBurndownGrid(SPRINT_MD);
  assert.deepEqual(g[0], ['日付', '残タスク数', '残ポイント']);
  assert.deepEqual(g[1], ['Day 1', '8', '21']);
});

test('バーンダウン表が無ければ null を返す', () => {
  assert.equal(buildBurndownGrid('# 見出しだけ'), null);
  assert.equal(buildBurndownGrid(''), null);
});

test('障害物は未解決を先に並べる', () => {
  const open = [{ id: 'IMP-002', title: '未解決', status: 'Open', reported_by: 'A', reported_at: '2026-09-01', description: '', resolved_at: '', resolution: '', sprint: 'sprint001' }];
  const done = [{ id: 'IMP-001', title: '解決済', status: 'Resolved', reported_by: 'B', reported_at: '2026-08-01', description: '', resolved_at: '2026-08-05', resolution: '対応', sprint: 'sprint001' }];
  const g = buildImpedimentGrid(open, done, {});
  assert.equal(g[1][IMPEDIMENT_KEY_COL], 'IMP-002');
  assert.equal(g[2][IMPEDIMENT_KEY_COL], 'IMP-001');
});

test('障害物のメモを ID で引き継ぐ', () => {
  const open = [{ id: 'IMP-002', title: '未解決', status: 'Open', reported_by: 'A', reported_at: '2026-09-01', description: '', resolved_at: '', resolution: '', sprint: '' }];
  const g = buildImpedimentGrid(open, [], { 'IMP-002': 'SMへ相談' });
  assert.equal(g[1][IMPEDIMENT_NOTE_COL], 'SMへ相談');
});

test('障害物のひな形行を除外する', () => {
  const tpl = [{ id: 'IMP-001', title: '（障害物タイトル）', status: 'Open', reported_at: 'YYYY-MM-DD', reported_by: '', description: '', resolved_at: '', resolution: '', sprint: '' }];
  assert.equal(buildImpedimentGrid(tpl, [], {}).length, 1);
});

test('ダッシュボードにゴールと進捗を出す', () => {
  const rows = [
    { id: 'PBI-001', title: 'A', status: 'Done', size: '5', priority: 'High', created_at: '2026-08-14' },
    { id: 'PBI-002', title: 'B', status: 'Ready', size: '3', priority: 'High', created_at: '2026-08-14' },
  ];
  const g = buildDashboardGrid({ syncedAt: '2026-09-02 10:00', sprintBacklogMd: SPRINT_MD, backlogRows: rows, warnings: [] });
  const flat = g.map(function (r) { return r.join(' '); }).join('\n');
  assert.match(flat, /ログインを使える状態にする。/);
  assert.match(flat, /2026-09-02 10:00/);
  assert.match(flat, /Done 1 5/);
  assert.match(flat, /Ready 1 3/);
});

test('警告があれば列挙する', () => {
  const g = buildDashboardGrid({ syncedAt: 'x', sprintBacklogMd: '', backlogRows: [], warnings: ['velocity.csv が見つかりません'] });
  assert.match(g.map(function (r) { return r.join(' '); }).join('\n'), /velocity.csv が見つかりません/);
});
