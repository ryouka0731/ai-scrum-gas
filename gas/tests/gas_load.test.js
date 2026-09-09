const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// GAS は gas/*.js を「1つのグローバル字句スコープ」で順に評価する。CommonJS の require は
// ファイルごとにスコープが分かれるため、トップレベル const の重複を他のテストでは検出できない。
// ここでは vm で GAS のロードモデルを再現し、プロジェクト全体が評価できることを確かめる。
// 層をまたぐ唯一の自動検査であり、重複宣言による「プロジェクト全体が起動しない」事故を防ぐ。
const GAS_DIR = path.join(__dirname, '..');

/** gas/ 直下の .js をファイル名順に返す（tests/ は含まない）。 */
function gasFileNames() {
  return fs.readdirSync(GAS_DIR)
    .filter(function (name) { return name.slice(-3) === '.js'; })
    .sort();
}

test('gas/*.js を読み込み対象として列挙できる', () => {
  const names = gasFileNames();
  // 列挙に失敗して0件のまま通過する（空振りするテストになる）ことを防ぐ
  assert.ok(names.length >= 10, 'gas/*.js が見つかりません: ' + names.join(', '));
  assert.ok(names.indexOf('gas_sync.js') !== -1);
  assert.ok(names.indexOf('pure_grid_report.js') !== -1);
});

test('全ファイルを1つのグローバルスコープで評価しても例外にならない', () => {
  const context = vm.createContext({});
  const failures = [];
  gasFileNames().forEach(function (name) {
    const code = fs.readFileSync(path.join(GAS_DIR, name), 'utf8');
    try {
      vm.runInContext(code, context, { filename: name });
    } catch (e) {
      failures.push(name + ' -> ' + e.message);
    }
  });
  assert.deepEqual(failures, [], '同名のトップレベル宣言が衝突しています:\n' + failures.join('\n'));
});

test('評価後のグローバルから各層の関数を参照できる', () => {
  const context = vm.createContext({});
  gasFileNames().forEach(function (name) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, name), 'utf8'), context, { filename: name });
  });
  // GAS 側の呼び出しは「同じグローバルに他ファイルの関数がある」ことが前提になっている
  ['syncAll_', 'onOpen', 'writeGrid_', 'buildBacklogGrid', 'buildSyncLogGrid', 'pickLatestSprintName']
    .forEach(function (fn) {
      assert.equal(typeof context[fn], 'function', fn + ' がグローバルに見つかりません');
    });
});
