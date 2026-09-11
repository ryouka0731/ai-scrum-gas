const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROADMAP_NO_SPRINT_NOTICE, buildBurndownView, buildVelocityView, buildRoadmapView,
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

test('ロードマップの marks.row は table.rows（ヘッダーを除いた配列）の添字を指す', () => {
  // buildRoadmapGrid の marks.row はヘッダー込みグリッドの添字なので、
  // ビューで -1 して正規化していないと1行ずれる。
  const rows = [
    { id: 'PBI-001', title: '不一致', status: 'New', sprint: 'sprint999',
      created_at: '2026-08-18', updated_at: '2026-08-18' },
    { id: 'PBI-002', title: '一致', status: 'New', sprint: 'sprint001',
      created_at: '2026-08-18', updated_at: '2026-08-18' },
  ];
  const v = buildRoadmapView(rows, VEL);
  assert.equal(v.marks.length, 1);
  assert.equal(v.marks[0].row, 1);
  assert.equal(v.table.rows[v.marks[0].row][0], 'PBI-002');
});

test('ロードマップは velocity.csv にスプリントが無ければ帯を塗らない', () => {
  // buildRoadmapGrid（既存・触らない）は実データ行を sprint 一致に関係なく常に出す
  // （スプリント列が無くなるだけ）。行数ではなく「塗る位置が無い」ことで確認する。
  const rows = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: 'sprint001',
                  created_at: '2026-08-18', updated_at: '2026-08-18' }];
  const v = buildRoadmapView(rows, []);
  assert.equal(v.marks.length, 0);
});

test('ロードマップは velocity.csv にスプリントが無ければ理由を添える', () => {
  // 帯が出ない理由は表を見ても分からない（ID とタイトルだけの2列の表が黙って出る）。
  // 文面は設計書 §読み取りの失敗 が指定したもの。
  const rows = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: 'sprint001',
                  created_at: '2026-08-18', updated_at: '2026-08-18' }];
  assert.equal(buildRoadmapView(rows, []).notice,
    'velocity.csv にスプリントが登録されていません。');
  assert.equal(buildRoadmapView(rows, []).notice, ROADMAP_NO_SPRINT_NOTICE);
  // 雛形のまま（sprint 名はあるが開始・終了日が日付になっていない）も同じ扱い。
  const template = [{ sprint: 'sprintXXX', planned_points: '', completed_points: '',
                      carried_over_points: '', sprint_start: 'YYYY-MM-DD',
                      sprint_end: 'YYYY-MM-DD', notes: '' }];
  assert.equal(buildRoadmapView(rows, template).notice, ROADMAP_NO_SPRINT_NOTICE);
});

test('ロードマップは実在スプリントがあれば理由を添えない', () => {
  // 帯が1本も塗られないことと、スプリントが1つも無いことは別。PBI がどれも
  // 割り当たっていないだけのときに同じ案内を出すと、velocity.csv を疑わせてしまう。
  const unassigned = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: '',
                        created_at: '2026-08-18', updated_at: '2026-08-18' }];
  const v = buildRoadmapView(unassigned, VEL);
  assert.equal(v.marks.length, 0, '前提: 帯が1本も塗られていない状態で見ている');
  assert.equal(v.notice, undefined);
});
