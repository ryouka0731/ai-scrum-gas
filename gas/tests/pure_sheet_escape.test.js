const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeSheetCell, escapeSheetGrid } = require('../pure_sheet_escape.js');

test('数式として解釈されうる先頭文字の文字列には \' を付ける', () => {
  ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1'].forEach((v) => {
    assert.equal(escapeSheetCell(v), "'" + v, JSON.stringify(v));
  });
});

test('数値だけの文字列はそのまま（ポイントや残数を数値として扱わせる）', () => {
  ['-3', '+1.5', '-0.25', '12'].forEach((v) => assert.equal(escapeSheetCell(v), v, v));
});

test('ふつうの文字列・空文字・文字列以外はそのまま', () => {
  assert.equal(escapeSheetCell('同期の失敗を画面に出す'), '同期の失敗を画面に出す');
  assert.equal(escapeSheetCell('2026-10-01'), '2026-10-01');
  assert.equal(escapeSheetCell(''), '');
  assert.equal(escapeSheetCell(5), 5);
  assert.equal(escapeSheetCell(null), null);
  assert.equal(escapeSheetCell(true), true);
});

test('表は全セルを無害化し、元の配列は書き換えない', () => {
  const grid = [['ID', 'タイトル'], ['IMP-002', '=1+1'], ['IMP-003', 3]];
  const out = escapeSheetGrid(grid);
  assert.deepEqual(out, [['ID', 'タイトル'], ['IMP-002', "'=1+1"], ['IMP-003', 3]]);
  assert.equal(grid[1][1], '=1+1', '引数を書き換えた');
});
