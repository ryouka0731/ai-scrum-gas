const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBoardData } = require('../pure_board_view.js');
const { KANBAN_STATUSES } = require('../pure_grid_board.js');

function pbi(id, title, status) {
  return {
    id: id, title: title, status: status, priority: 'High', size: '3',
    sprint: 'Sprint 001', created_at: '2026-08-14', updated_at: '2026-09-01',
    description: '説明', acceptance_criteria: 'A; B',
  };
}

test('5つの列を status の順に返す', () => {
  const d = buildBoardData([]);
  assert.deepEqual(d.columns.map(function (c) { return c.status; }), KANBAN_STATUSES);
});

test('PBI を該当する列に入れる', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', 'Ready')]);
  const ready = d.columns.filter(function (c) { return c.status === 'Ready'; })[0];
  assert.equal(ready.cards.length, 1);
  assert.equal(ready.cards[0].id, 'PBI-001');
});

test('カードに必要な項目だけを載せる', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', 'Ready')]);
  const card = d.columns.filter(function (c) { return c.status === 'Ready'; })[0].cards[0];
  assert.deepEqual(Object.keys(card).sort(),
    ['id', 'priority', 'size', 'sprint', 'title', 'updated_at'].sort());
});

test('未知のステータスを New に寄せる', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', '謎')]);
  const nw = d.columns.filter(function (c) { return c.status === 'New'; })[0];
  assert.equal(nw.cards.length, 1);
});

test('ひな形行を除外する', () => {
  const tpl = { id: 'PBI-001', title: '（PBIタイトル）', status: 'New', created_at: 'YYYY-MM-DD' };
  assert.equal(buildBoardData([tpl]).columns.reduce(function (n, c) { return n + c.cards.length; }, 0), 0);
});

test('同じ列の中で元の順序を保つ', () => {
  const d = buildBoardData([pbi('PBI-002', 'B', 'Ready'), pbi('PBI-001', 'A', 'Ready')]);
  const ready = d.columns.filter(function (c) { return c.status === 'Ready'; })[0];
  assert.deepEqual(ready.cards.map(function (x) { return x.id; }), ['PBI-002', 'PBI-001']);
});

test('行が無ければ空の列を5つ返す', () => {
  const d = buildBoardData([]);
  assert.equal(d.columns.length, 5);
  d.columns.forEach(function (c) { assert.deepEqual(c.cards, []); });
});

test('null を渡しても壊れない', () => {
  assert.equal(buildBoardData(null).columns.length, 5);
});
