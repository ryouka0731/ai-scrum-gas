/**
 * スプレッドシートへの書き込み。setValues で1シート1回にまとめる。
 */

const HEADER_BACKGROUND = '#1a73e8';
const HEADER_FONT_COLOR = '#ffffff';
const ROADMAP_BAND_COLOR = '#a8c7fa';

/** 既存シートの「キー → メモ」を読み出す。シートが無ければ空の辞書。 */
function readNotes(ss, sheetName, keyCol, noteCol) {
  const sheet = ss.getSheetByName(sheetName);
  const notes = {};
  if (!sheet) return notes;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol <= noteCol) return notes;
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  values.forEach(function (row) {
    const key = String(row[keyCol] || '').trim();
    const note = String(row[noteCol] || '').trim();
    if (key && note) notes[key] = note;
  });
  return notes;
}

/** シートを作成またはクリアして2次元配列を書き込む。 */
function writeGrid(ss, sheetName, grid) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  if (!grid || grid.length === 0) return sheet;

  const width = grid.reduce(function (max, r) { return Math.max(max, r.length); }, 0);
  const normalized = grid.map(function (r) {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  sheet.getRange(1, 1, normalized.length, width).setValues(normalized);
  applyHeaderStyle(sheet, width);
  return sheet;
}

/** 1行目を見出しとして装飾し、固定する。 */
function applyHeaderStyle(sheet, width) {
  if (width < 1) return;
  const header = sheet.getRange(1, 1, 1, width);
  header.setBackground(HEADER_BACKGROUND).setFontColor(HEADER_FONT_COLOR).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/** ロードマップの帯を塗る。marks は 0 起点の {row, col}。 */
function paintMarks(sheet, marks, color) {
  (marks || []).forEach(function (m) {
    sheet.getRange(m.row + 1, m.col + 1).setBackground(color || ROADMAP_BAND_COLOR);
  });
}
