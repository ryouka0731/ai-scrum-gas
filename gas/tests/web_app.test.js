const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// web_app.js は GAS のグローバルスコープ（HtmlService 等）を前提にしており、CommonJS の
// require では単体ロードできない。gas_load.test.js と同じく vm で gas/*.js を1つの
// グローバルスコープへ読み込み、assertBacklogHeaderMatches だけを呼び出す。
//
// この関数は「気づかないうちに CSV の列が消える」のを止める唯一のガードのため、
// 固定して検査する。
const GAS_DIR = path.join(__dirname, '..');

/**
 * gas/ 直下の .js を1つの vm context に読み込み、context を返す。
 *
 * トップレベルの `const`（BACKLOG_FIELDS 等）は Script として評価すると
 * context 自身のプロパティにはならず、context 内部のレキシカル環境に留まる
 * （`function` 宣言は globalThis のプロパティになるため、gas_load.test.js の
 * `context[fn]` 参照は問題にならない）。そのままでは Node 側から
 * BACKLOG_FIELDS を読めないため、context を束縛したまま `getBacklogFields()`
 * を追加で評価し、その関数経由で値を取り出す。
 */
function loadGasContext() {
  const context = vm.createContext({});
  fs.readdirSync(GAS_DIR)
    .filter(function (name) { return name.slice(-3) === '.js'; })
    .sort()
    .forEach(function (name) {
      vm.runInContext(fs.readFileSync(path.join(GAS_DIR, name), 'utf8'), context, { filename: name });
    });
  vm.runInContext('function __getBacklogFields() { return BACKLOG_FIELDS; }', context);
  return context;
}

function toCsvLine(cols) {
  return cols.join(',');
}

test('正規のヘッダーは通過する', () => {
  const context = loadGasContext();
  const fields = context.__getBacklogFields();
  const header = toCsvLine(fields);
  assert.doesNotThrow(function () {
    context.assertBacklogHeaderMatches(header + '\n');
  });
});

test('列が1つ多いヘッダーは拒否する', () => {
  const context = loadGasContext();
  const fields = context.__getBacklogFields();
  const header = toCsvLine(fields.concat(['extra_column']));
  assert.throws(function () {
    context.assertBacklogHeaderMatches(header + '\n');
  }, /列構成が想定と異なります/);
});

test('列の順序が違うヘッダーは拒否する', () => {
  const context = loadGasContext();
  const fields = context.__getBacklogFields();
  const shuffled = fields.slice().reverse();
  const header = toCsvLine(shuffled);
  assert.throws(function () {
    context.assertBacklogHeaderMatches(header + '\n');
  }, /列構成が想定と異なります/);
});

test('列が足りないヘッダーは拒否する', () => {
  const context = loadGasContext();
  const fields = context.__getBacklogFields();
  const missing = fields.slice(0, -1);
  const header = toCsvLine(missing);
  assert.throws(function () {
    context.assertBacklogHeaderMatches(header + '\n');
  }, /列構成が想定と異なります/);
});
