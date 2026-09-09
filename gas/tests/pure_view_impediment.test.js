const test = require('node:test');
const assert = require('node:assert/strict');
const { IMPEDIMENT_COLUMNS, buildImpedimentView } = require('../pure_view_impediment.js');

const imp = (over) => Object.assign({
  id: 'IMP-001', title: '止まっている', description: 'せつめい',
  reported_by: 'マヤ', reported_at: '2026-09-01', status: 'Open',
  resolved_at: '', resolution: '', sprint: 'sprint001',
}, over || {});

test('列は field と label の対で、id が先頭', () => {
  assert.equal(IMPEDIMENT_COLUMNS[0].field, 'id');
  IMPEDIMENT_COLUMNS.forEach((c) => {
    assert.ok(c.field && c.label, c.field + ' の対が不完全');
  });
});

test('未解決と解決済がファイル別に分かれる', () => {
  const v = buildImpedimentView(
    [imp({ id: 'IMP-001' })],
    [imp({ id: 'IMP-002', status: 'Resolved', resolved_at: '2026-09-05' })]);
  assert.deepEqual(v.open.map((r) => r.id), ['IMP-001']);
  assert.deepEqual(v.resolved.map((r) => r.id), ['IMP-002']);
});

test('雛形行は両方から除かれる', () => {
  const v = buildImpedimentView(
    [imp(), { id: 'メモ', title: '' }],
    [{ id: '', title: '' }]);
  assert.equal(v.open.length, 1);
  assert.equal(v.resolved.length, 0);
});

test('値は文字列になり、欠けた項目は空文字', () => {
  const v = buildImpedimentView([{ id: 'IMP-001', title: 'a', reported_at: '2026-09-01' }], []);
  IMPEDIMENT_COLUMNS.forEach((c) => {
    assert.equal(typeof v.open[0][c.field], 'string', c.field + ' が文字列でない');
  });
});

test('どちらも無ければ空で返る', () => {
  const v = buildImpedimentView(null, null);
  assert.deepEqual(v.open, []);
  assert.deepEqual(v.resolved, []);
  assert.ok(v.columns.length > 0);
});
