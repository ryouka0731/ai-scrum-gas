/**
 * 一覧・完了のビューのデータ。GAS API に依存しない純関数。
 *
 * pure_grid_backlog.js とは別に持つ。あちらはスプレッドシートの2次元配列を作るもので、
 * シートの同期が使い続ける。同じ関数に2つの出力形式を持たせると、どちらかを変えたときに
 * もう一方が壊れる。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

// 「サイズ」では何を指すか伝わらない。「ベロシティ」はスプリント単位の消化量で別物。
const LIST_COLUMNS = [
  { field: 'id', label: 'ID' },
  { field: 'title', label: 'タイトル' },
  { field: 'status', label: 'ステータス' },
  { field: 'priority', label: '優先度' },
  { field: 'size', label: 'ポイント' },
  { field: 'sprint', label: 'スプリント' },
  { field: 'acceptance_criteria', label: '受入基準' },
  { field: 'updated_at', label: '更新日' },
];

function viewRows_(rows) {
  return filterRealRows(rows || []).map(function (row) {
    const out = {};
    LIST_COLUMNS.forEach(function (c) {
      const v = row[c.field];
      out[c.field] = (v === undefined || v === null) ? '' : String(v);
    });
    return out;
  });
}

/** 一覧のビュー。 */
function buildListView(rows) {
  return { columns: LIST_COLUMNS, rows: viewRows_(rows) };
}

/** 完了のビュー。列は一覧と同じにする（同じ対象の見え方なので揃える）。 */
function buildDoneView(rows) {
  return { columns: LIST_COLUMNS, rows: viewRows_(rows) };
}

if (typeof module !== 'undefined') {
  module.exports = { LIST_COLUMNS, buildListView, buildDoneView };
}
