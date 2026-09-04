/**
 * カンバン画面へ渡すデータを組み立てる。GAS API に依存しない純関数。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

const BOARD_CARD_FIELDS = ['id', 'title', 'priority', 'size', 'sprint', 'updated_at'];

/**
 * KANBAN_STATUSES を実行環境に応じて解決する。
 * GAS は全ファイルを単一のグローバル字句スコープで評価するため、pure_grid_board.js の
 * const 宣言をここで var 経由で再宣言すると衝突しプロジェクト全体のロードが失敗する。
 * そのため var では受けず、GAS ではグローバルの const を直接参照し、Node では
 * 呼び出し時に require する。
 */
function boardKanbanStatuses() {
  if (typeof KANBAN_STATUSES !== 'undefined') return KANBAN_STATUSES;
  return require('./pure_grid_board.js').KANBAN_STATUSES;
}

/** カンバン用に { columns: [{ status, cards }] } を返す。 */
function buildBoardData(rows) {
  const statuses = boardKanbanStatuses();
  const columns = statuses.map(function (s) { return { status: s, cards: [] }; });
  filterRealRows(rows || []).forEach(function (row) {
    const s = String(row.status || '').trim();
    const idx = statuses.indexOf(s) === -1 ? 0 : statuses.indexOf(s);
    const card = {};
    BOARD_CARD_FIELDS.forEach(function (f) { card[f] = String(row[f] === undefined ? '' : row[f]); });
    columns[idx].cards.push(card);
  });
  return { columns: columns };
}

if (typeof module !== 'undefined') {
  module.exports = { BOARD_CARD_FIELDS, buildBoardData };
}
