/**
 * 障害物の採番。GAS API に依存しない純関数。
 *
 * 未解決と解決済の両ファイルを通した最大値の次を返す。削除の操作を作らないので、
 * 一度使った ID は必ずどちらかに残る（PBI のような高水位の記録は要らない）。
 * 雛形の IMP-001 も数に入れる（雛形を本物の行で上書きしない）。
 */

const IMPEDIMENT_ID_NUM_RE = /^IMP-(\d+)$/;

function nextImpedimentId(rows) {
  let max = 0;
  (rows || []).forEach(function (r) {
    const m = IMPEDIMENT_ID_NUM_RE.exec(String((r && r.id) || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  const n = String(max + 1);
  return 'IMP-' + (n.length < 3 ? ('000' + n).slice(-3) : n);
}

if (typeof module !== 'undefined') { module.exports = { IMPEDIMENT_ID_NUM_RE, nextImpedimentId }; }
