/**
 * カンバンとロードマップの2次元配列を組み立てる。GAS API に依存しない純関数。
 */

if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows, normalizeSprint } = require('./pure_filter.js');
}

const KANBAN_STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const ROADMAP_MARK = '■';
// GAS は全ファイルを1つのグローバル字句スコープで評価するため、
// トップレベルの const は他ファイルと衝突しない名前にする。
const ROADMAP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ステータスを既知の値に丸める。未知の値は New に寄せる。 */
function normalizeStatus(status) {
  const s = String(status || '').trim();
  return KANBAN_STATUSES.indexOf(s) === -1 ? 'New' : s;
}

/** カンバンシート用の2次元配列を返す。 */
function buildKanbanGrid(rows) {
  const columns = KANBAN_STATUSES.map(function () { return []; });
  filterRealRows(rows).forEach(function (row) {
    const idx = KANBAN_STATUSES.indexOf(normalizeStatus(row.status));
    columns[idx].push(String(row.id || '').trim() + ' ' + String(row.title || '').trim());
  });
  const depth = columns.reduce(function (max, c) { return Math.max(max, c.length); }, 0);
  const grid = [KANBAN_STATUSES.slice()];
  for (let r = 0; r < depth; r++) {
    grid.push(columns.map(function (c) { return r < c.length ? c[r] : ''; }));
  }
  return grid;
}

/** 期間が実データとして埋まっているスプリント行だけを残す。 */
function realSprints(velocityRows) {
  return (velocityRows || []).filter(function (v) {
    return String(v.sprint || '').trim() !== '' &&
      ROADMAP_DATE_RE.test(String(v.sprint_start || '').trim()) &&
      ROADMAP_DATE_RE.test(String(v.sprint_end || '').trim());
  });
}

/** ロードマップシート用の2次元配列と、帯を塗るセル位置を返す。 */
function buildRoadmapGrid(rows, velocityRows) {
  const sprints = realSprints(velocityRows);
  const header = ['ID', 'タイトル'].concat(sprints.map(function (v) {
    return String(v.sprint).trim() + '\n' + String(v.sprint_start).trim() + '〜' + String(v.sprint_end).trim();
  }));
  const keys = sprints.map(function (v) { return normalizeSprint(v.sprint); });

  const grid = [header];
  const marks = [];
  filterRealRows(rows).forEach(function (row) {
    const target = normalizeSprint(row.sprint);
    const cells = keys.map(function (k) { return (k !== '' && k === target) ? ROADMAP_MARK : ''; });
    grid.push([String(row.id || '').trim(), String(row.title || '').trim()].concat(cells));
    const hit = keys.indexOf(target);
    if (target !== '' && hit !== -1) marks.push({ row: grid.length - 1, col: hit + 2 });
  });
  return { grid: grid, marks: marks };
}

if (typeof module !== 'undefined') {
  module.exports = { KANBAN_STATUSES, ROADMAP_MARK, realSprints, buildKanbanGrid, buildRoadmapGrid };
}
