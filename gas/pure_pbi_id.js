/**
 * PBI ID の採番。GAS API に依存しない純関数。
 *
 * 欠番は埋めない。埋めると削除された PBI の ID が別物に再利用され、
 * ローカルの Claude Code が残した参照が別の PBI を指すようになる。
 */

const PBI_ID_NUM_RE = /^PBI-(\d+)$/;

/** 既存の行集合から次の PBI ID を返す。 */
function nextPbiId(rows) {
  let max = 0;
  let width = 3;
  (rows || []).forEach(function (row) {
    const m = PBI_ID_NUM_RE.exec(String((row || {}).id || '').trim());
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (n > max) { max = n; width = m[1].length; }
  });
  const s = String(max + 1);
  let padded = s;
  while (padded.length < width) padded = '0' + padded;
  return 'PBI-' + padded;
}

if (typeof module !== 'undefined') { module.exports = { nextPbiId }; }
