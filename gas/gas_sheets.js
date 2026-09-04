/**
 * スプレッドシートへの書き込み。setValues で1シート1回にまとめる。
 */

const HEADER_BACKGROUND = '#1a73e8';
const HEADER_FONT_COLOR = '#ffffff';
const ROADMAP_BAND_COLOR = '#a8c7fa';

/** 既存シートの「キー → メモ」を読み出す。シートが無ければ空の辞書。 */
function readNotes_(ss, sheetName, keyCol, noteCol) {
  const sheet = ss.getSheetByName(sheetName);
  const notes = {};
  if (!sheet) return notes;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol <= noteCol || lastCol <= keyCol) return notes;
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  values.forEach(function (row) {
    const key = String(row[keyCol] || '').trim();
    const note = String(row[noteCol] || '').trim();
    if (key && note) notes[key] = note;
  });
  return notes;
}

/**
 * setValues が範囲外にならないよう、シートの行数・列数を必要分まで広げる。
 * insertSheet の既定は 1000行 × 26列で、getRange は自動拡張しない。ロードマップの列数は
 * 2 + スプリント数なので、スプリントが増えると既定の列数を超える。
 */
function ensureSheetSize_(sheet, numRows, numCols) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < numRows) sheet.insertRowsAfter(maxRows, numRows - maxRows);
  const maxCols = sheet.getMaxColumns();
  if (maxCols < numCols) sheet.insertColumnsAfter(maxCols, numCols - maxCols);
}

/** シートを作成またはクリアして2次元配列を書き込む。 */
function writeGrid_(ss, sheetName, grid) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  if (!grid || grid.length === 0) return sheet;

  const width = grid.reduce(function (max, r) { return Math.max(max, r.length); }, 0);
  if (width < 1) return sheet;
  const normalized = grid.map(function (r) {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  ensureSheetSize_(sheet, normalized.length, width);
  sheet.getRange(1, 1, normalized.length, width).setValues(normalized);
  applyHeaderStyle_(sheet, width);
  return sheet;
}

/** 1行目を見出しとして装飾し、固定する。 */
function applyHeaderStyle_(sheet, width) {
  if (width < 1) return;
  const header = sheet.getRange(1, 1, 1, width);
  header.setBackground(HEADER_BACKGROUND).setFontColor(HEADER_FONT_COLOR).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * ロードマップの帯を塗る。marks は 0 起点の {row, col}。
 * marks が外接する矩形を求め、setBackgrounds を1回だけ呼んで塗る（全体制約: セル単位の書き込み禁止）。
 */
function paintMarks_(sheet, marks, color) {
  if (!marks || marks.length === 0) return;
  const fillColor = color || ROADMAP_BAND_COLOR;

  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  marks.forEach(function (m) {
    if (m.row < minRow) minRow = m.row;
    if (m.row > maxRow) maxRow = m.row;
    if (m.col < minCol) minCol = m.col;
    if (m.col > maxCol) maxCol = m.col;
  });

  const numRows = maxRow - minRow + 1;
  const numCols = maxCol - minCol + 1;
  const matrix = [];
  for (let r = 0; r < numRows; r++) {
    matrix.push(new Array(numCols).fill(null));
  }
  marks.forEach(function (m) {
    matrix[m.row - minRow][m.col - minCol] = fillColor;
  });

  // matrix は 0 起点の矩形内インデックス。getRange は 1 起点なので +1 する。
  sheet.getRange(minRow + 1, minCol + 1, numRows, numCols).setBackgrounds(matrix);
}
