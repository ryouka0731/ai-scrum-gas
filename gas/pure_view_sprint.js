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
if (typeof require !== 'undefined' && typeof realSprints === 'undefined') {
  var { realSprints } = require('./pure_grid_board.js');
}

// velocity.csv に実在スプリントが1件も無いときに、ロードマップへ添える案内。
//
// この状態の buildRoadmapGrid は ID とタイトルだけの2列の表を返す（スプリントの列が
// 無くなるので帯を塗る位置も無い）。表そのものは何事もなく描かれるため、**帯が出ない
// 理由がどこにも出ない**。設計書が「実害がある」として名指しした形そのもの
// （「velocity.csv に無い名前を書くと、その PBI はロードマップから消える。しかも
// エラーは出ない」）なので、理由をビューのデータに載せて画面に出させる。
const ROADMAP_NO_SPRINT_NOTICE = 'velocity.csv にスプリントが登録されていません。';

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
 *
 * velocity.csv に実在スプリントが無いときは notice を添える（ROADMAP_NO_SPRINT_NOTICE）。
 */
function buildRoadmapView(rows, velocityRows) {
  const out = buildRoadmapGrid(rows || [], velocityRows || []);
  const marks = (out.marks || []).map(function (m) { return { row: m.row - 1, col: m.col }; });
  const view = { table: splitGrid_(out.grid), marks: marks };
  // 帯が1本も出ない理由は、表を見ても分からない。判定は buildRoadmapGrid と同じ
  // realSprints で行う（marks が0件かどうかでは判定しない。実在スプリントはあるのに
  // どの PBI も割り当たっていないだけ、という別の状態まで同じ案内にしてしまう）。
  if (realSprints(velocityRows || []).length === 0) view.notice = ROADMAP_NO_SPRINT_NOTICE;
  return view;
}

if (typeof module !== 'undefined') {
  module.exports = {
    ROADMAP_NO_SPRINT_NOTICE, buildBurndownView, buildVelocityView, buildRoadmapView,
  };
}
