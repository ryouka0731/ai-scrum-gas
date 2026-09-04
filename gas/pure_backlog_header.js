/**
 * CSV のヘッダー検査。GAS API に依存しない純関数。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof parseCsv === 'undefined') {
  var { parseCsv } = require('./pure_csv.js');
}

/**
 * CSV のヘッダーが fields と一致するかを検査する。書き戻しの直前に必ず呼ぶこと。
 *
 * toCsv(rows, fields) は fields の列だけを固定の順序で書き出す。
 * ヘッダーがそれと食い違ったまま書き戻すと、CSV 側にしかない列（この CSV は
 * ローカルの Claude Code と共同所有のため、将来列が増える可能性がある）が
 * 気づかないまま消える。列の集合が一致していても順序がずれていれば
 * toCsv の出力は既存ファイルと食い違うため、順序まで含めた完全一致を要求する。
 */
function assertHeaderMatches(text, fields) {
  const header = parseCsv(text)[0] || [];
  const matches = header.length === fields.length &&
    header.every(function (name, i) { return name === fields[i]; });
  if (!matches) {
    throw new Error(
      'CSV の列構成が想定と異なります。管理者に連絡してください。' +
      '（想定: ' + fields.join(',') + ' / 実際: ' + header.join(',') + '）'
    );
  }
}

if (typeof module !== 'undefined') { module.exports = { assertHeaderMatches }; }
