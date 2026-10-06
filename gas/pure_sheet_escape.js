/**
 * スプレッドシートへ書く値の無害化。GAS API に依存しない純関数。
 *
 * setValues は文字列でも先頭が = なら数式として評価する。CSV の値は Web アプリや
 * ローカルの Claude Code から自由に入るため、そのまま書くと共有スプレッドシートに
 * 任意の数式（外部へのリンク・IMPORTXML 等）を仕込めてしまう。
 * 先頭に ' を付けると、シートは文字列として扱い ' 自体は表示しない。
 */

// 数式の先頭になりうる文字。先頭の空白（半角スペース・タブ・改行）は表計算ソフトが
// 読み飛ばして続く = を数式として拾うことがあるため、その後ろも見る。
// タブ・CR・LF で始まる値はそれ自体も無害化する（OWASP の CSV Injection の推奨）。
const SHEET_FORMULA_LEAD_RE = /^\s*[=+\-@]|^[\t\r\n]/;
// 数値だけの文字列（-3, +1.5, -1e3, -.5）は数式にならない。' を付けると数値として
// 集計できなくなる。前後の空白はシートが数値として読むときに無視するので許す。
// 数字の並びの切り方が1通りに決まる形にしておく（\d+\.?\d* のように小数点が任意だと、
// 長い数字の並びの後ろで照合に失敗したときに切り方を総当たりし、長さの2乗の時間がかかる）。
const SHEET_PLAIN_NUMBER_RE = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

function escapeSheetCell(value) {
  if (typeof value !== 'string') return value;
  if (!SHEET_FORMULA_LEAD_RE.test(value)) return value;
  // タブ・CR・LF で始まる値は、続きが数値でも無害化する（先頭の制御文字が数式注入の足場になりうる）。
  if (/^[\t\r\n]/.test(value)) return "'" + value;
  if (SHEET_PLAIN_NUMBER_RE.test(value)) return value;
  return "'" + value;
}

/** 2次元配列の全セルを無害化した新しい配列を返す。 */
function escapeSheetGrid(grid) {
  return (grid || []).map(function (row) { return row.map(escapeSheetCell); });
}

if (typeof module !== 'undefined') { module.exports = { escapeSheetCell, escapeSheetGrid }; }
