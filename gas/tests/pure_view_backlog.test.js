const test = require('node:test');
const assert = require('node:assert/strict');
const { LIST_COLUMNS, buildListView, buildDoneView } = require('../pure_view_backlog.js');
const real = (over) => Object.assign({
  id: 'PBI-001', title: 'やること', description: 'せつめい',
  acceptance_criteria: 'きじゅん', priority: 'High', size: '5',
  status: 'New', sprint: 'sprint001', created_at: '2026-09-01', updated_at: '2026-09-01',
}, over || {});

test('列は field と label の対で、id が先頭', () => {
  assert.equal(LIST_COLUMNS[0].field, 'id');
  LIST_COLUMNS.forEach((c) => {
    assert.ok(c.field, '列に field が無い');
    assert.ok(c.label, c.field + ' に label が無い');
  });
});

test('列の label に「サイズ」を使わない（ストーリーポイント）', () => {
  // ベロシティとは別物なので「ベロシティ」も使わない。
  const labels = LIST_COLUMNS.map((c) => c.label).join(' ');
  assert.equal(labels.indexOf('サイズ'), -1);
  assert.equal(labels.indexOf('ベロシティ'), -1);
  assert.ok(labels.indexOf('ポイント') !== -1);
});

test('雛形行は除かれる', () => {
  const rows = [real(), { id: 'PBI-002', title: '（PBIタイトル）', created_at: 'YYYY-MM-DD' }];
  assert.equal(buildListView(rows).rows.length, 1);
});

test('行は列の field をすべて持ち、値は文字列になる', () => {
  const v = buildListView([real({ size: 5 })]);
  LIST_COLUMNS.forEach((c) => {
    assert.equal(typeof v.rows[0][c.field], 'string', c.field + ' が文字列でない');
  });
  assert.equal(v.rows[0].size, '5');
});

test('元の配列を書き換えない', () => {
  const rows = [real()];
  buildListView(rows);
  assert.equal(rows[0].title, 'やること');
  assert.equal(Object.keys(rows[0]).length, 10);   // 元の行の項目数が変わっていない
});

test('完了のビューも同じ形を返す', () => {
  const v = buildDoneView([real({ status: 'Done' })]);
  assert.deepEqual(v.columns.map((c) => c.field), LIST_COLUMNS.map((c) => c.field));
  assert.equal(v.rows.length, 1);
});

test('空でも columns は返る', () => {
  assert.deepEqual(buildListView([]).rows, []);
  assert.ok(buildListView(null).columns.length > 0);
});
