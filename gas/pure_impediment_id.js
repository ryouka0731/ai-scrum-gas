/**
 * 障害物の採番。GAS API に依存しない純関数。
 *
 * 未解決と解決済の両ファイルを通した最大値の次を返す。削除の操作を作らないので、
 * 一度使った ID は必ずどちらかに残る（PBI のような高水位の記録は要らない）。
 * 雛形の IMP-001 も数に入れる（雛形を本物の行で上書きしない）。
 */

const IMPEDIMENT_ID_NUM_RE = /^IMP-(\d+)$/;

// 番号は数字列のまま比べ・足す（2^53 超・指数表記の対策。pure_pbi_id.js 参照）。
if (typeof require !== 'undefined' && typeof idDigitsIncrement_ === 'undefined') {
  globalThis.idDigitsCompare_ = require('./pure_pbi_id.js').idDigitsCompare_;
  globalThis.idDigitsIncrement_ = require('./pure_pbi_id.js').idDigitsIncrement_;
}

function nextImpedimentId(rows) {
  let max = '0';
  (rows || []).forEach(function (r) {
    const m = IMPEDIMENT_ID_NUM_RE.exec(String((r && r.id) || '').trim());
    if (m && idDigitsCompare_(m[1], max) > 0) max = m[1];
  });
  const n = idDigitsIncrement_(max);
  return 'IMP-' + (n.length < 3 ? ('000' + n).slice(-3) : n);
}

if (typeof module !== 'undefined') { module.exports = { IMPEDIMENT_ID_NUM_RE, nextImpedimentId }; }
