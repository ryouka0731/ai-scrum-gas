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

// --- B1: 2^53 を超える番号 ---
const PID = require('../pure_pbi_id.js');
const IID = require('../pure_impediment_id.js');

test('B1: nextPbiId は 2^53 を超える番号でも既存の ID を再利用しない', () => {
  assert.equal(PID.nextPbiId([{ id: 'PBI-9007199254740992' }], null), 'PBI-9007199254740993');
});

test('B1: nextPbiId は巨大な番号でも PBI-\\d+ 形式の ID を返す（指数表記・桁埋めの暴走をしない）', () => {
  assert.equal(PID.nextPbiId([{ id: 'PBI-' + '9'.repeat(25) }], null), 'PBI-1' + '0'.repeat(25));
  assert.equal(PID.nextPbiId([{ id: 'PBI-0099' }], null), 'PBI-0100');
});

test('B1: nextImpedimentId は巨大な番号でも IMP-\\d+ 形式の ID を返す', () => {
  assert.equal(IID.nextImpedimentId([{ id: 'IMP-' + '9'.repeat(25) }]), 'IMP-1' + '0'.repeat(25));
  assert.equal(IID.nextImpedimentId([{ id: 'IMP-9007199254740992' }]), 'IMP-9007199254740993');
});

test('B1: 高水位の比較・上限判定は 2^53 を超える番号でも正しい', () => {
  const big = 'PBI-9007199254740993';
  assert.equal(PID.maxPbiId(['PBI-9007199254740992', big]), big);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-9007199254740994', [], big), false);
  assert.equal(PID.isPbiIdWithinHighWater(big, [], big), true);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-000', [], big), false);
  assert.equal(PID.comparePbiIds('PBI-10', 'PBI-009'), 1);
});
