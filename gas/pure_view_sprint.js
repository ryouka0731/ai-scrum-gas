/**
 * スプリントのビューのデータ。GAS API に依存しない純関数。
 *
 * 既存の build*Grid（pure_grid_report.js / pure_grid_board.js）は2次元配列を返す。
 * シートの同期が使い続けるので触らず、ここで表の形に組み替えるだけにする。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof buildBurndownGrid === 'undefined') {
  var { buildBurndownGrid, buildVelocityGrid } = require('./pure_grid_report.js');
}
if (typeof require !== 'undefined' && typeof buildRoadmapGrid === 'undefined') {
  var { buildRoadmapGrid } = require('./pure_grid_board.js');
}

/** 2次元配列（先頭行がヘッダー）を { headers, rows } に分ける。 */
function splitGrid_(grid) {
  const g = grid || [];
  if (g.length === 0) return { headers: [], rows: [] };
  return { headers: g[0], rows: g.slice(1) };
}

/** バーンダウン。元データが無ければ null（「まだありません」と出すため）。 */
function buildBurndownView(sprintBacklogMd) {
  const grid = buildBurndownGrid(sprintBacklogMd || '');
  if (!grid) return null;
  return { table: splitGrid_(grid) };
}

/** ベロシティ。空でも表の形は返す。 */
function buildVelocityView(velocityRows) {
  return { table: splitGrid_(buildVelocityGrid(velocityRows || [])) };
}

/**
 * ロードマップ。marks は table.rows（ヘッダーを除いた配列）基準の帯を塗るセル位置。
 * buildRoadmapGrid の marks.row はヘッダー込みグリッドの添字なので、ここで -1 して
 * table.rows の添字に正規化する（画面側にこの知識を漏らさないため）。
 */
function buildRoadmapView(rows, velocityRows) {
  const out = buildRoadmapGrid(rows || [], velocityRows || []);
  const marks = (out.marks || []).map(function (m) { return { row: m.row - 1, col: m.col }; });
  return { table: splitGrid_(out.grid), marks: marks };
}

if (typeof module !== 'undefined') {
  module.exports = { buildBurndownView, buildVelocityView, buildRoadmapView };
}
