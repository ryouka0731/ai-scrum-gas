/**
 * PBI ID の採番。GAS API に依存しない純関数。
 *
 * 欠番は埋めない。埋めると削除された PBI の ID が別物に再利用され、
 * ローカルの Claude Code が残した参照が別の PBI を指すようになる。
 *
 * rows（現在の product_backlog.csv）だけを見ると、最大の ID を持つ行が消えた
 * 瞬間に次の採番がその ID を再利用してしまう。それを防ぐため、呼び出し側が
 * 記録しておいた高水位（highWaterId、これまでに採番した最大の ID）も渡し、
 * 両者のうち大きい方を採用する。記録は一方向にしか進めない（GAS 層で
 * 採番時にだけ更新する）ので、rows 側が記録を上回ることはあっても、
 * 記録が rows 側の実際の最大値を追い越すことはなく安全である。
 */

const PBI_ID_NUM_RE = /^PBI-(\d+)$/;

/** 既存の行集合と記録済みの高水位 ID から次の PBI ID を返す。 */
function nextPbiId(rows, highWaterId) {
  let max = 0;
  let width = 3;
  function consider(idText) {
    const m = PBI_ID_NUM_RE.exec(String(idText || '').trim());
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (n > max) { max = n; width = m[1].length; }
  }
  (rows || []).forEach(function (row) { consider((row || {}).id); });
  // rows に無くても、記録済みの高水位のほうが大きければそちらを採る
  // （rows から最大の行が削除された場合や、ローカルの Claude Code が
  // rows の外で先に採番した場合を拾う）。
  consider(highWaterId);
  const s = String(max + 1);
  let padded = s;
  while (padded.length < width) padded = '0' + padded;
  return 'PBI-' + padded;
}

if (typeof module !== 'undefined') { module.exports = { nextPbiId }; }
