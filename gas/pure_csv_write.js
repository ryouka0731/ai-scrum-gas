/**
 * オブジェクト配列を CSV 文字列に直す。GAS API に依存しない純関数。
 * pure_csv.js の parseCsv と往復できることをテストで担保している。
 */

/** CSV の1セルを表す。カンマ・改行・引用符を含むときだけ引用符で囲む。 */
function escapeCsvCell(value) {
  const raw = value === undefined || value === null ? '' : String(value);
  // parseCsv（pure_csv.js）は引用符の内側も含めて \r\n / \r を無条件に \n へ正規化して読む。
  // このチームは Mac / Windows 混在で、Windows 側の編集で値に CRLF が混入し得る。
  // 書き出し側で同じ正規化をしないと「書いた値と読み直した値が一致しない」往復崩れが起き、
  // toCsv の出力は Drive の実ファイルを上書きするため、気付かないまま値が壊れる。
  const s = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (s.indexOf(',') === -1 && s.indexOf('\n') === -1 && s.indexOf('"') === -1) {
    return s;
  }
  return '"' + s.split('"').join('""') + '"';
}

/**
 * 見出し行を含む CSV 文字列を返す。列は fields の順に並べる。
 * 既知の制約: fields が1列だけで、かつその値が空文字の行は、
 * parseCsv 側の「末尾の空行（空セル1個だけの行）を落とす」処理に巻き込まれて消える。
 * BACKLOG_FIELDS 等の実利用は10列のため発生しないが、単一列での往復では起こり得る。
 */
function toCsv(rows, fields) {
  const lines = [fields.map(escapeCsvCell).join(',')];
  (rows || []).forEach(function (row) {
    lines.push(fields.map(function (f) { return escapeCsvCell(row[f]); }).join(','));
  });
  return lines.join('\n') + '\n';
}

if (typeof module !== 'undefined') { module.exports = { escapeCsvCell, toCsv }; }
