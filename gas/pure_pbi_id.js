/**
 * PBI ID の採番と、その番号にまつわる判断。GAS API に依存しない純関数。
 *
 * 欠番は埋めない。埋めると削除された PBI の ID が別物に再利用され、
 * ローカルの Claude Code が残した参照が別の PBI を指すようになる。
 *
 * rows（現在の product_backlog.csv）だけを見ると、最大の ID を持つ行が消えた
 * 瞬間に次の採番がその ID を再利用してしまう。それを防ぐため、呼び出し側が
 * 記録しておいた高水位（highWaterId、これまでに採番した最大の ID）も渡し、
 * 両者のうち大きい方を採用する。記録は一方向にしか進めない（GAS 層で
 * 書き戻しのたびに更新する）ので、rows 側が記録を上回ることはあっても、
 * 記録が rows 側の実際の最大値を追い越すことはなく安全である。
 */

const PBI_ID_NUM_RE = /^PBI-(\d+)$/;

/** id 文字列の番号を返す。PBI-\d+ 形式でなければ null。 */
function pbiIdNumber(idText) {
  const m = PBI_ID_NUM_RE.exec(String(idText || '').trim());
  return m ? parseInt(m[1], 10) : null;
}

/**
 * rows（行の配列。id 文字列そのものを混ぜてもよい）の中から、番号が最大の
 * PBI ID 文字列を返す。無ければ null。元の文字列（桁数）をそのまま返すため、
 * 呼び出し側が高水位として記録する値の桁を保てる。
 */
function maxPbiId(rows) {
  let max = -1;
  let best = null;
  (rows || []).forEach(function (item) {
    const raw = String((item && typeof item === 'object' ? item.id : item) || '').trim();
    const n = pbiIdNumber(raw);
    if (n !== null && n > max) { max = n; best = raw; }
  });
  return best;
}

/** rows と highWaterId の両方から、今までに採番された最大の PBI ID 文字列を返す（無ければ null）。 */
function highWaterPbiId(rows, highWaterId) {
  return maxPbiId((rows || []).concat([highWaterId]));
}

/** rows と記録済みの高水位 ID から次の PBI ID を返す。 */
function nextPbiId(rows, highWaterId) {
  const maxId = highWaterPbiId(rows, highWaterId);
  const n = maxId === null ? 0 : pbiIdNumber(maxId);
  const width = maxId === null ? 3 : PBI_ID_NUM_RE.exec(maxId)[1].length;
  const s = String(n + 1);
  let padded = s;
  while (padded.length < width) padded = '0' + padded;
  return 'PBI-' + padded;
}

/**
 * id の番号が、rows と highWaterId から求めた「今までに採番された最大値」を
 * 超えていないかを返す。復元は既存の行をそのまま戻す操作であり、その ID が
 * 今の最大値を超えることは原理的にありえない。超えていれば、でっち上げ ID や
 * 改ざんとみなせる（それを許すと、以後の採番がその極端な値まで汚染される）。
 * id が PBI-\d+ 形式でなければ false（形式チェックは別に行う）。
 */
function isPbiIdWithinHighWater(id, rows, highWaterId) {
  const n = pbiIdNumber(id);
  if (n === null) return false;
  const maxId = highWaterPbiId(rows, highWaterId);
  const maxN = maxId === null ? 0 : pbiIdNumber(maxId);
  return n <= maxN;
}

if (typeof module !== 'undefined') {
  module.exports = { nextPbiId, pbiIdNumber, maxPbiId, highWaterPbiId, isPbiIdWithinHighWater };
}
