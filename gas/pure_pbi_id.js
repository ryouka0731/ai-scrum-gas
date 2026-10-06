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

/*
 * 番号は数値にせず、10進の数字列のまま比べ・足す。Number にすると 2^53 を超える番号で
 * n+1 が n と同じになり（既存 ID の再利用）、さらに大きいと指数表記（1e+25）になって
 * 以後の採番が壊れる。手で CSV に書かれた桁の多い ID でも正しく扱うため。
 */

/** 数字列の先頭の 0 を落とす（全部 0 なら '0'）。 */
function idDigitsNormalize_(digits) {
  const s = String(digits).replace(/^0+/, '');
  return s === '' ? '0' : s;
}

/** 数字列どうしを数として比べる（-1 / 0 / 1）。 */
function idDigitsCompare_(a, b) {
  const x = idDigitsNormalize_(a);
  const y = idDigitsNormalize_(b);
  if (x.length !== y.length) return x.length < y.length ? -1 : 1;
  return x === y ? 0 : (x < y ? -1 : 1);
}

/** 数字列に 1 を足した数字列を返す（先頭の 0 は落とす）。 */
function idDigitsIncrement_(digits) {
  const d = idDigitsNormalize_(digits).split('');
  let i = d.length - 1;
  while (i >= 0 && d[i] === '9') { d[i] = '0'; i--; }
  if (i < 0) return '1' + d.join('');
  d[i] = String(Number(d[i]) + 1);
  return d.join('');
}

/** id 文字列の番号の数字列（元の桁のまま）を返す。PBI-\d+ 形式でなければ null。 */
function pbiIdDigits_(idText) {
  const m = PBI_ID_NUM_RE.exec(String(idText || '').trim());
  return m ? m[1] : null;
}

/**
 * id 文字列の番号を返す。PBI-\d+ 形式でなければ null。
 * 2^53 を超える番号は正確でないため、大小の判断には comparePbiIds を使う。
 */
function pbiIdNumber(idText) {
  const d = pbiIdDigits_(idText);
  return d === null ? null : parseInt(d, 10);
}

/** 2つの PBI ID の番号を比べる（-1 / 0 / 1）。PBI-\d+ 形式でない方を小さいとみなす。 */
function comparePbiIds(a, b) {
  const x = pbiIdDigits_(a);
  const y = pbiIdDigits_(b);
  if (x === null || y === null) return x === y ? 0 : (x === null ? -1 : 1);
  return idDigitsCompare_(x, y);
}

/**
 * rows（行の配列。id 文字列そのものを混ぜてもよい）の中から、番号が最大の
 * PBI ID 文字列を返す。無ければ null。元の文字列（桁数）をそのまま返すため、
 * 呼び出し側が高水位として記録する値の桁を保てる。
 */
function maxPbiId(rows) {
  let best = null;
  (rows || []).forEach(function (item) {
    const raw = String((item && typeof item === 'object' ? item.id : item) || '').trim();
    if (pbiIdDigits_(raw) === null) return;
    if (best === null || comparePbiIds(raw, best) > 0) best = raw;
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
  const digits = maxId === null ? '0' : pbiIdDigits_(maxId);
  const width = maxId === null ? 3 : digits.length;
  let padded = idDigitsIncrement_(digits);
  while (padded.length < width) padded = '0' + padded;
  return 'PBI-' + padded;
}

/**
 * id の番号が、rows と highWaterId から求めた「今までに採番された最大値」を
 * 超えていないかを返す。復元は既存の行をそのまま戻す操作であり、その ID が
 * 今の最大値を超えることは原理的にありえない。超えていれば、でっち上げ ID や
 * 改ざんとみなせる（それを許すと、以後の採番がその極端な値まで汚染される）。
 *
 * ただしこの上限判定は汚染を防ぐための当て推量であり、正しさの保証ではない。
 * rows も highWaterId も空で上限が一つも立たないとき（高水位の記帳が
 * best-effort であるため、記帳が失敗した状態で削除が起きると起こりうる。
 * readDoneBacklogRowsBestEffort_ と同じ考え方）は、判定をあきらめて通す。
 * ここで拒否すると、削除した行を戻す先が無くなり、取り消せず失われる。
 *
 * id が PBI-\d+ 形式でない、または番号が 0 以下（採番は PBI-001 から始まる）
 * なら false。
 */
function isPbiIdWithinHighWater(id, rows, highWaterId) {
  const d = pbiIdDigits_(id);
  if (d === null || idDigitsNormalize_(d) === '0') return false;
  const maxId = highWaterPbiId(rows, highWaterId);
  if (maxId === null) return true;
  return comparePbiIds(id, maxId) <= 0;
}

if (typeof module !== 'undefined') {
  module.exports = { nextPbiId, pbiIdNumber, comparePbiIds, maxPbiId, highWaterPbiId, isPbiIdWithinHighWater,
    idDigitsCompare_, idDigitsIncrement_ };
}
