const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BACKLOG_HEADERS, BACKLOG_KEY_COL, BACKLOG_NOTE_COL,
  buildBacklogGrid, buildDoneBacklogGrid,
} = require('../pure_grid_backlog.js');

function row(over) {
  return Object.assign({
    id: 'PBI-001', title: 'ログイン', description: '説明',
    acceptance_criteria: 'A; B', priority: 'High', size: '3',
    status: 'Ready', sprint: 'Sprint 001',
    created_at: '2026-08-14', updated_at: '2026-08-20',
  }, over || {});
}

test('見出し行の末尾がメモ列である', () => {
  assert.equal(BACKLOG_HEADERS[BACKLOG_NOTE_COL], 'メモ');
  assert.equal(BACKLOG_HEADERS[BACKLOG_KEY_COL], 'ID');
});

test('1行目が見出し行になる', () => {
  const g = buildBacklogGrid([row()], {});
  assert.deepEqual(g[0], BACKLOG_HEADERS);
});

test('CSV の値が列順どおりに並ぶ', () => {
  const g = buildBacklogGrid([row()], {});
  assert.deepEqual(g[1], [
    'PBI-001', 'ログイン', '説明', 'A; B', 'High', '3',
    'Ready', 'Sprint 001', '2026-08-14', '2026-08-20', '',
  ]);
});

test('ひな形行を除外する', () => {
  const g = buildBacklogGrid([row(), row({ id: 'PBI-002', title: '（PBIタイトル）' })], {});
  assert.equal(g.length, 2);
});

test('メモを ID で引き継ぐ', () => {
  const g = buildBacklogGrid([row()], { 'PBI-001': '要相談' });
  assert.equal(g[1][BACKLOG_NOTE_COL], '要相談');
});

test('並べ替えても ID が一致すればメモが付く', () => {
  const rows = [row({ id: 'PBI-002', title: '二番' }), row()];
  const g = buildBacklogGrid(rows, { 'PBI-001': 'A', 'PBI-002': 'B' });
  assert.equal(g[1][BACKLOG_NOTE_COL], 'B');
  assert.equal(g[2][BACKLOG_NOTE_COL], 'A');
});

test('対応する ID が無いメモは捨てる', () => {
  const g = buildBacklogGrid([row()], { 'PBI-999': '孤児' });
  assert.equal(g.length, 2);
  assert.equal(g[1][BACKLOG_NOTE_COL], '');
});

test('行が無ければ見出し行だけを返す', () => {
  assert.deepEqual(buildBacklogGrid([], {}), [BACKLOG_HEADERS]);
});

test('完了バックログにはメモ列が無い', () => {
  const g = buildDoneBacklogGrid([row({ status: 'Done' })]);
  assert.equal(g[0].indexOf('メモ'), -1);
  assert.equal(g[1].length, g[0].length);
});
