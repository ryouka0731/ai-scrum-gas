const test = require('node:test');
const assert = require('node:assert/strict');
const { assertHeaderMatches } = require('../pure_backlog_header.js');

// この関数は「気づかないうちに CSV の列が消える」のを止める唯一のガードのため、
// 固定して検査する。

const FIELDS = ['id', 'title', 'status', 'priority', 'size', 'sprint', 'updated_at'];

function toCsvLine(cols) {
  return cols.join(',');
}

test('正規のヘッダーは通過する', () => {
  const header = toCsvLine(FIELDS);
  assert.doesNotThrow(function () {
    assertHeaderMatches(header + '\n', FIELDS);
  });
});

test('列が1つ多いヘッダーは拒否する', () => {
  const header = toCsvLine(FIELDS.concat(['extra_column']));
  assert.throws(function () {
    assertHeaderMatches(header + '\n', FIELDS);
  }, /列構成が想定と異なります/);
});

test('列の順序が違うヘッダーは拒否する', () => {
  const shuffled = FIELDS.slice().reverse();
  const header = toCsvLine(shuffled);
  assert.throws(function () {
    assertHeaderMatches(header + '\n', FIELDS);
  }, /列構成が想定と異なります/);
});

test('列が足りないヘッダーは拒否する', () => {
  const missing = FIELDS.slice(0, -1);
  const header = toCsvLine(missing);
  assert.throws(function () {
    assertHeaderMatches(header + '\n', FIELDS);
  }, /列構成が想定と異なります/);
});
