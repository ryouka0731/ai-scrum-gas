const test = require('node:test');
const assert = require('node:assert/strict');
const { nextImpedimentId } = require('../pure_impediment_id.js');

test('行が無ければ IMP-001', () => {
  assert.equal(nextImpedimentId([]), 'IMP-001');
  assert.equal(nextImpedimentId(null), 'IMP-001');
});

test('雛形の IMP-001 も数に入れる（雛形を上書きしない）', () => {
  assert.equal(nextImpedimentId([{ id: 'IMP-001', title: '（障害物タイトル）' }]), 'IMP-002');
});

test('最大値の次。欠番は埋めない', () => {
  assert.equal(nextImpedimentId([{ id: 'IMP-001' }, { id: 'IMP-007' }, { id: 'IMP-003' }]), 'IMP-008');
});

test('前後の空白は無視し、形の違う ID は数えない', () => {
  assert.equal(nextImpedimentId([{ id: ' IMP-004 ' }, { id: 'imp-099' }, { id: 'IMP-x' }, {}]), 'IMP-005');
});

test('3桁を超えたらそのまま伸ばす', () => {
  assert.equal(nextImpedimentId([{ id: 'IMP-999' }]), 'IMP-1000');
});
