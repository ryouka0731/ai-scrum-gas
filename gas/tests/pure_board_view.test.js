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
    ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'sprint', 'updated_at'].sort());
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

test('カードの値が入力どおりに転写される', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', 'Ready')]);
  const card = d.columns.filter(function (c) { return c.status === 'Ready'; })[0].cards[0];
  assert.deepEqual(card, {
    id: 'PBI-001', title: 'A', description: '説明', acceptance_criteria: 'A; B',
    priority: 'High', size: '3', sprint: 'Sprint 001', updated_at: '2026-09-01',
  });
});

test('updated_at が null のとき空文字にする', () => {
  const row = pbi('PBI-001', 'A', 'Ready');
  row.updated_at = null;
  const d = buildBoardData([row]);
  const card = d.columns.filter(function (c) { return c.status === 'Ready'; })[0].cards[0];
  assert.equal(card.updated_at, '');
});

test('カードは説明と受入基準も運ぶ（詳細パネルで編集するため）', () => {
  const rows = [{
    id: 'PBI-001', title: 'a', description: 'せつめい',
    acceptance_criteria: 'きじゅん', priority: 'High', size: '3',
    status: 'New', sprint: 'sprint001', created_at: '2026-09-01', updated_at: '2026-09-01',
  }];
  const card = buildBoardData(rows).columns[0].cards[0];
  assert.equal(card.description, 'せつめい');
  assert.equal(card.acceptance_criteria, 'きじゅん');
});
