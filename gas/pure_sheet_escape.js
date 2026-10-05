/**
 * スプレッドシートへ書く値の無害化。GAS API に依存しない純関数。
 *
 * setValues は文字列でも先頭が = なら数式として評価する。CSV の値は Web アプリや
 * ローカルの Claude Code から自由に入るため、そのまま書くと共有スプレッドシートに
 * 任意の数式（外部へのリンク・IMPORTXML 等）を仕込めてしまう。
 * 先頭に ' を付けると、シートは文字列として扱い ' 自体は表示しない。
 */

// 数式の先頭になりうる文字。タブと CR は表計算ソフトが先頭の空白として読み飛ばし、
// 続く = を数式として拾うことがあるため含める（OWASP の CSV Injection の推奨）。
const SHEET_FORMULA_LEAD_RE = /^[=+\-@\t\r]/;
// 数値だけの文字列（-3, +1.5）は数式にならない。' を付けると数値として集計できなくなる。
const SHEET_PLAIN_NUMBER_RE = /^[+-]?\d+(\.\d+)?$/;

function escapeSheetCell(value) {
  if (typeof value !== 'string') return value;
  if (!SHEET_FORMULA_LEAD_RE.test(value)) return value;
  if (SHEET_PLAIN_NUMBER_RE.test(value)) return value;
  return "'" + value;
}

/** 2次元配列の全セルを無害化した新しい配列を返す。 */
function escapeSheetGrid(grid) {
  return (grid || []).map(function (row) { return row.map(escapeSheetCell); });
}

if (typeof module !== 'undefined') { module.exports = { escapeSheetCell, escapeSheetGrid }; }
