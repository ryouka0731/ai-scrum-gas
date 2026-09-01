const test = require('node:test');
const assert = require('node:assert/strict');
const { KANBAN_STATUSES, buildKanbanGrid, buildRoadmapGrid } = require('../pure_grid_board.js');

function pbi(id, title, status, sprint) {
  return {
    id: id, title: title, status: status, sprint: sprint,
    priority: 'High', size: '3', created_at: '2026-08-14',
  };
}

const VELOCITY = [
  { sprint: 'sprint001', sprint_start: '2026-09-08', sprint_end: '2026-09-19' },
  { sprint: 'sprint002', sprint_start: '2026-09-22', sprint_end: '2026-10-03' },
];

test('カンバンの見出しがステータス並びになる', () => {
  const g = buildKanbanGrid([]);
  assert.deepEqual(g[0], KANBAN_STATUSES);
});

test('PBI が該当ステータスの列に入る', () => {
  const g = buildKanbanGrid([pbi('PBI-001', 'ログイン', 'Ready', 'Sprint 001')]);
  assert.equal(g[1][KANBAN_STATUSES.indexOf('Ready')], 'PBI-001 ログイン');
  assert.equal(g[1][KANBAN_STATUSES.indexOf('New')], '');
});

test('列ごとに上から詰めて並ぶ', () => {
  const g = buildKanbanGrid([
    pbi('PBI-001', 'A', 'Ready', ''), pbi('PBI-002', 'B', 'Ready', ''),
    pbi('PBI-003', 'C', 'Done', ''),
  ]);
  const ready = KANBAN_STATUSES.indexOf('Ready');
  assert.equal(g[1][ready], 'PBI-001 A');
  assert.equal(g[2][ready], 'PBI-002 B');
  assert.equal(g[2][KANBAN_STATUSES.indexOf('Done')], '');
});

test('未知のステータスは New 扱いにする', () => {
  const g = buildKanbanGrid([pbi('PBI-001', 'A', '謎', '')]);
  assert.equal(g[1][KANBAN_STATUSES.indexOf('New')], 'PBI-001 A');
});

test('ロードマップの見出しに期間を併記する', () => {
  const { grid } = buildRoadmapGrid([], VELOCITY);
  assert.deepEqual(grid[0], ['ID', 'タイトル', 'sprint001\n2026-09-08〜2026-09-19', 'sprint002\n2026-09-22〜2026-10-03']);
});

test('表記が揺れていても該当スプリント列に帯を置く', () => {
  const { grid, marks } = buildRoadmapGrid([pbi('PBI-001', 'A', 'Ready', 'Sprint 001')], VELOCITY);
  assert.equal(grid[1][2], '■');
  assert.equal(grid[1][3], '');
  assert.deepEqual(marks, [{ row: 1, col: 2 }]);
});

test('スプリント未割当の PBI は帯を持たない', () => {
  const { grid, marks } = buildRoadmapGrid([pbi('PBI-001', 'A', 'New', '')], VELOCITY);
  assert.deepEqual(grid[1], ['PBI-001', 'A', '', '']);
  assert.deepEqual(marks, []);
});

test('ひな形行を除外する', () => {
  const rows = [pbi('PBI-001', 'A', 'Ready', 'Sprint 001'), pbi('PBI-002', '（PBIタイトル）', 'New', '')];
  assert.equal(buildRoadmapGrid(rows, VELOCITY).grid.length, 2);
  assert.equal(buildKanbanGrid(rows).length, 2);
});

test('ひな形のスプリント行を列にしない', () => {
  const v = VELOCITY.concat([{ sprint: 'sprint003', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' }]);
  assert.equal(buildRoadmapGrid([], v).grid[0].length, 4);
});
