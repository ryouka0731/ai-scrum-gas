const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBacklog } = require('../pure_summary.js');

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
