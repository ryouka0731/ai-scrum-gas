const test = require('node:test');
const assert = require('node:assert/strict');
const { assertHeaderMatches } = require('../pure_backlog_header.js');

// この関数は「気づかないうちに CSV の列が消える」のを止める唯一のガードのため、
// 全ての分岐を検査する。
//
// FIELDS は検査用の作り物で、実際のバックログの列構成ではない（それは
// pure_grid_backlog.js の BACKLOG_FIELDS）。assertHeaderMatches は列を引数で
// 受け取る汎用関数なので、ここを実物に合わせる必要はない。合わせると、列が
// 増えるたびにこのテストを直すことになる。

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
