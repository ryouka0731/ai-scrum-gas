/**
 * バックログシートの2次元配列を組み立てる。GAS API に依存しない純関数。
 */

// GAS 上では pure_filter.js が同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

const BACKLOG_FIELDS = [
  'id', 'title', 'description', 'acceptance_criteria', 'priority',
  'size', 'status', 'sprint', 'created_at', 'updated_at',
];
const BACKLOG_LABELS = [
  'ID', 'タイトル', '説明', '受入基準', '優先度',
  'サイズ', 'ステータス', 'スプリント', '作成日', '更新日',
];
const BACKLOG_HEADERS = BACKLOG_LABELS.concat(['メモ']);
const BACKLOG_KEY_COL = 0;
const BACKLOG_NOTE_COL = BACKLOG_HEADERS.length - 1;

/** 1行分の値を CSV の列順で取り出す。 */
function backlogValues(row) {
  return BACKLOG_FIELDS.map(function (f) { return String(row[f] === undefined ? '' : row[f]); });
}

/** バックログシート用の2次元配列を返す（メモ列付き）。 */
function buildBacklogGrid(rows, notesByKey) {
  const notes = notesByKey || {};
  const grid = [BACKLOG_HEADERS];
  filterRealRows(rows).forEach(function (row) {
    const id = String(row.id || '').trim();
    grid.push(backlogValues(row).concat([String(notes[id] || '')]));
  });
  return grid;
}

/** 完了バックログシート用の2次元配列を返す（メモ列なし）。 */
function buildDoneBacklogGrid(rows) {
  const grid = [BACKLOG_LABELS];
  filterRealRows(rows).forEach(function (row) { grid.push(backlogValues(row)); });
  return grid;
}

if (typeof module !== 'undefined') {
  module.exports = {
    BACKLOG_FIELDS, BACKLOG_LABELS, BACKLOG_HEADERS,
    BACKLOG_KEY_COL, BACKLOG_NOTE_COL,
    buildBacklogGrid, buildDoneBacklogGrid,
  };
}
