/**
 * オブジェクト配列を CSV 文字列に直す。GAS API に依存しない純関数。
 * pure_csv.js の parseCsv と往復できることをテストで担保している。
 */

/** CSV の1セルを表す。カンマ・改行・引用符を含むときだけ引用符で囲む。 */
function escapeCsvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (s.indexOf(',') === -1 && s.indexOf('\n') === -1 && s.indexOf('"') === -1) {
    return s;
  }
  return '"' + s.split('"').join('""') + '"';
}

/** 見出し行を含む CSV 文字列を返す。列は fields の順に並べる。 */
function toCsv(rows, fields) {
  const lines = [fields.map(escapeCsvCell).join(',')];
  (rows || []).forEach(function (row) {
    lines.push(fields.map(function (f) { return escapeCsvCell(row[f]); }).join(','));
  });
  return lines.join('\n') + '\n';
}

if (typeof module !== 'undefined') { module.exports = { escapeCsvCell, toCsv }; }
