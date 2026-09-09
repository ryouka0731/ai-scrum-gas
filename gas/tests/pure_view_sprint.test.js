const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBurndownView, buildVelocityView, buildRoadmapView,
} = require('../pure_view_sprint.js');

const VEL = [
  { sprint: 'sprint001', planned_points: '20', completed_points: '18',
    carried_over_points: '2', sprint_start: '2026-08-18', sprint_end: '2026-08-31', notes: '' },
];
const MD = [
  '# スプリントバックログ',
  '',
  '## バーンダウン',
  '',
  '| 日付 | 残り |',
  '| --- | --- |',
  '| 2026-08-18 | 20 |',
  '| 2026-08-19 | 15 |',
  '',
].join('\n');

test('バーンダウンは見出しと行に分かれる', () => {
  const v = buildBurndownView(MD);
  assert.deepEqual(v.table.headers, ['日付', '残り']);
  assert.equal(v.table.rows.length, 2);
});

test('バーンダウンは元データが無ければ null', () => {
  // 「まだありません」と出すため。エラーにしない。
  assert.equal(buildBurndownView(''), null);
  assert.equal(buildBurndownView(null), null);
  assert.equal(buildBurndownView('# 見出しだけ'), null);
});

test('ベロシティは見出しと行に分かれる', () => {
  const v = buildVelocityView(VEL);
  assert.ok(v.table.headers.length > 0);
  assert.equal(v.table.rows.length, 1);
});

test('ベロシティは空でも表の形を返す', () => {
  const v = buildVelocityView([]);
  assert.ok(v.table.headers.length > 0);
  assert.deepEqual(v.table.rows, []);
});

test('ロードマップは帯を塗る位置を返す', () => {
  const rows = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: 'sprint001',
                  created_at: '2026-08-18', updated_at: '2026-08-18' }];
  const v = buildRoadmapView(rows, VEL);
  assert.ok(v.table.headers.length > 0);
  assert.ok(Array.isArray(v.marks));
});

test('ロードマップは velocity.csv にスプリントが無ければ帯を塗らない', () => {
  // buildRoadmapGrid（既存・触らない）は実データ行を sprint 一致に関係なく常に出す
  // （スプリント列が無くなるだけ）。行数ではなく「塗る位置が無い」ことで確認する。
  const rows = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: 'sprint001',
                  created_at: '2026-08-18', updated_at: '2026-08-18' }];
  const v = buildRoadmapView(rows, []);
  assert.equal(v.marks.length, 0);
});
