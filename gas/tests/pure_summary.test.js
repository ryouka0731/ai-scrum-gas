const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBacklog, summarizeSprint, summarizeImpediment } = require('../pure_summary.js');

const ST = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const real = (over) => Object.assign({
  id: 'PBI-001', title: 'a', priority: 'High', size: '5',
  status: 'New', created_at: '2026-09-01', updated_at: '2026-09-01',
}, over || {});

test('ステータス別の件数とポイントを数える', () => {
  const s = summarizeBacklog([
    real({ id: 'PBI-001', status: 'New', size: '5' }),
    real({ id: 'PBI-002', status: 'New', size: '3' }),
    real({ id: 'PBI-003', status: 'Done', size: '8' }),
  ], ST);
  const byStatus = {};
  s.byStatus.forEach((x) => { byStatus[x.status] = x; });
  assert.equal(byStatus['New'].count, 2);
  assert.equal(byStatus['New'].points, 8);
  assert.equal(byStatus['Done'].count, 1);
  assert.equal(byStatus['Ready'].count, 0);
  assert.equal(s.total.count, 3);
  assert.equal(s.total.points, 16);
});

test('語彙外のステータスは先頭のステータスに数える', () => {
  // buildBoardData が語彙外を New 列に入れるのと揃える。
  const s = summarizeBacklog([real({ status: 'Backlog', size: '2' })], ST);
  const first = s.byStatus[0];
  assert.equal(first.status, 'New');
  assert.equal(first.count, 1);
  assert.equal(first.points, 2);
});

test('ポイントが空や数値でない行は 0 として数える', () => {
  const s = summarizeBacklog([
    real({ id: 'PBI-001', size: '' }),
    real({ id: 'PBI-002', size: 'M' }),
  ], ST);
  assert.equal(s.total.count, 2);
  assert.equal(s.total.points, 0);
});

test('雛形行は数えない', () => {
  const s = summarizeBacklog([
    real(),
    { id: 'PBI-999', title: '（PBIタイトル）', created_at: 'YYYY-MM-DD' },
  ], ST);
  assert.equal(s.total.count, 1);
});

test('空でも全ステータスが 0 で並ぶ', () => {
  const s = summarizeBacklog([], ST);
  assert.equal(s.byStatus.length, ST.length);
  assert.equal(s.total.count, 0);
  assert.equal(s.total.points, 0);
});

test('スプリントの要約は velocity.csv の最新行から作る', () => {
  const vel = [
    { sprint: 'sprint001', planned_points: '20', completed_points: '18',
      carried_over_points: '2', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
    { sprint: 'sprint002', planned_points: '25', completed_points: '0',
      carried_over_points: '0', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  ];
  const s = summarizeSprint(vel, '## スプリントゴール\n\n動くものを出す\n');
  assert.equal(s.sprint, 'sprint002');
  assert.equal(s.planned, 25);
  assert.ok(s.goal.indexOf('動くものを出す') !== -1);
});

test('スプリントの要約は日付が埋まった行が無ければ null', () => {
  assert.equal(summarizeSprint([{ sprint: 'sprint001', sprint_start: 'YYYY-MM-DD' }], ''), null);
  assert.equal(summarizeSprint([], ''), null);
});

test('ポイントが空でも 0 になる', () => {
  const s = summarizeSprint(
    [{ sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }], '');
  assert.equal(s.planned, 0);
  assert.equal(s.completed, 0);
  assert.equal(s.carriedOver, 0);
});

test('障害物の要約はファイル別に数え、雛形行を除く', () => {
  const s = summarizeImpediment(
    [{ id: 'IMP-001', title: 'a' }, { id: 'メモ', title: '' }],
    [{ id: 'IMP-002', title: 'b' }, { id: 'メモ', title: '' }]);
  assert.equal(s.open, 1);
  assert.equal(s.resolved, 1);
});

test('障害物の要約は空でも 0 で返る', () => {
  assert.deepEqual(summarizeImpediment(null, null), { open: 0, resolved: 0 });
});

// ---------------------------------------------------------------------------
// 数字（velocity.csv）とゴール（最新スプリントフォルダの sprint_backlog.md）は
// 出所が違う。ずれたまま並べると、別々のスプリントの数字と目的が1行に混ざる。
// ---------------------------------------------------------------------------

/** ひな形と同じ形の sprint_backlog.md。 */
const backlogMd = (sprintName, goal) => [
  '# スプリントバックログ - ' + sprintName,
  '',
  '## スプリントゴール',
  goal,
  '',
  '## スプリント情報',
  '| 項目 | 内容 |',
  '|------|------|',
  '| スプリント番号 | ' + sprintName + ' |',
  '| 開始日 | 2026-09-01 |',
].join('\n');

const VEL2 = [
  { sprint: 'sprint002', planned_points: '25', completed_points: '0',
    carried_over_points: '0', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
];

test('velocity.csv と sprint_backlog.md が同じスプリントならゴールを出す', () => {
  const s = summarizeSprint(VEL2, backlogMd('sprint002', '動くものを出す'));
  assert.equal(s.sprint, 'sprint002');
  assert.equal(s.goal, '動くものを出す');
});

test('表記が揺れていても同じスプリントとして扱う', () => {
  // sprint_backlog.md 側は "Sprint 002"（product_backlog.csv と同じ表記）、
  // velocity.csv 側は "sprint002"。成果物のひな形がそう書き分けている（実データ）。
  assert.equal(summarizeSprint(VEL2, backlogMd('Sprint 002', '動くものを出す')).goal, '動くものを出す');
});

test('velocity.csv と sprint_backlog.md がずれていたらゴールを出さない', () => {
  // 次のスプリントのフォルダだけ先にできている状況。sprint003 のゴールを
  // sprint002 の数字の隣に並べると、読み手はどちらの話か区別できない。
  const s = summarizeSprint(VEL2, backlogMd('sprint003', '次の目的'));
  assert.equal(s.sprint, 'sprint002');
  assert.equal(s.goal, '', '別のスプリントのゴールが混ざっている: ' + s.goal);
  assert.equal(s.planned, 25, '数字まで落としている');
});

test('sprint_backlog.md が名乗っていなければ、そのままゴールを出す', () => {
  // 突き合わせようがない。ずれているとは限らないので落とさない（今までどおり）。
  const s = summarizeSprint(VEL2, '## スプリントゴール\n\n動くものを出す\n');
  assert.equal(s.goal, '動くものを出す');
});
