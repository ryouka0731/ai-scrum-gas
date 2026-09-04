const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRowUpdate } = require('../pure_merge.js');

function rows() {
  return [
    { id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-01' },
    { id: 'PBI-002', title: 'B', status: 'Ready', updated_at: '2026-09-02' },
  ];
}

test('状態を書き換えて updated_at を更新する', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].status, 'Ready');
  assert.equal(r.rows[0].updated_at, '2026-09-04');
});

test('他の行に影響しない', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.deepEqual(r.rows[1], rows()[1]);
});

test('変更しない列を保つ', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].title, 'A');
});

test('元の配列を書き換えない', () => {
  const original = rows();
  applyRowUpdate(original, 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(original[0].status, 'New');
});

test('行の順序を保つ', () => {
  const r = applyRowUpdate(rows(), 'PBI-002', { status: 'Done' }, '2026-09-02', '2026-09-04');
  assert.deepEqual(r.rows.map(function (x) { return x.id; }), ['PBI-001', 'PBI-002']);
});

test('id が無ければ not_found を返す', () => {
  const r = applyRowUpdate(rows(), 'PBI-999', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.current, null);
});

test('updated_at が違えば conflict を返す', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-08-31', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(r.current.status, 'New');
  assert.equal(r.current.updated_at, '2026-09-01');
});

test('conflict のとき元の配列を書き換えない', () => {
  const original = rows();
  applyRowUpdate(original, 'PBI-001', { status: 'Ready' }, '2026-08-31', '2026-09-04');
  assert.equal(original[0].status, 'New');
});

test('複数の列を同時に変えられる', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Done', size: '5' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].status, 'Done');
  assert.equal(r.rows[0].size, '5');
});

test('changes に updated_at があっても nowText で上書きする', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready', updated_at: '1999-01-01' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].updated_at, '2026-09-04');
});

test('空の id は中間の空行にマッチせず not_found を返す', () => {
  const withBlankRow = [
    { id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-01' },
    { id: '', title: '', status: '', updated_at: '' },
    { id: 'PBI-002', title: 'B', status: 'Ready', updated_at: '2026-09-02' },
  ];
  const r = applyRowUpdate(withBlankRow, '', { status: 'Done' }, '', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.current, null);
});
