'use strict';
// バグ探しで見つかったデータ整合性のバグ（G1）の再現テスト。直したので緑で守る。
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToObjects } = require('../pure_csv.js');
const { toCsv } = require('../pure_csv_write.js');

test('A1: 途中の空行は幻の空行オブジェクトにならず、書き戻しで ",," 行として永続化しない', () => {
  const rows = csvToObjects('a,b\n1,2\n\n3,4\n');
  assert.equal(rows.length, 2, JSON.stringify(rows));
  assert.ok(!toCsv(rows, ['a', 'b']).includes('\n,\n'));
});

test('A1: カンマだけの行（全列が空）は書かれた内容として残す（toCsv との往復で行数を変えない）', () => {
  assert.deepEqual(csvToObjects('a,b\n1,2\n,\n3,4\n'), [{ a: '1', b: '2' }, { a: '', b: '' }, { a: '3', b: '4' }]);
});

test('A2: 引用符で始まらないフィールド中の " はただの文字で、以降の行を飲み込まない', () => {
  // 手書き CSV の「5" モニタ」のようなタイトル
  assert.deepEqual(parseCsv('a,b\n5" monitor,x\n3,4\n'), [['a', 'b'], ['5" monitor', 'x'], ['3', '4']]);
});
