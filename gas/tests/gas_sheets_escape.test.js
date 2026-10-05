'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// writeGrid_ は共有スプレッドシートへの唯一の書き込み口。ここで無害化されていれば、
// どのシート（PBI・障害物・ダッシュボード等）にも数式が仕込まれない。
// gas/*.js を GAS と同じ1つのグローバルスコープへ読み込み、偽のシートで受ける。
const GAS_DIR = path.join(__dirname, '..');

function loadGas() {
  const context = vm.createContext({ console: console });
  fs.readdirSync(GAS_DIR).filter((n) => n.slice(-3) === '.js').sort().forEach((n) => {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), context, { filename: n });
  });
  return context;
}

function fakeSpreadsheet() {
  const written = [];
  const range = {
    setValues: (v) => { written.push(JSON.parse(JSON.stringify(v))); return range; },
    setBackground: () => range, setFontColor: () => range, setFontWeight: () => range,
  };
  const sheet = {
    clear: () => {}, getMaxRows: () => 1000, getMaxColumns: () => 26,
    getRange: () => range, setFrozenRows: () => {},
  };
  return { ss: { getSheetByName: () => sheet }, written: written };
}

test('writeGrid_ は数式になりうる値に \' を付けて書く', () => {
  const ctx = loadGas();
  const { ss, written } = fakeSpreadsheet();
  ctx.writeGrid_(ss, '障害物', [['ID', 'タイトル', 'ポイント'], ['IMP-002', '=IMPORTXML("http://x","//a")', '-3']]);
  assert.equal(written.length, 1);
  assert.deepEqual(written[0], [['ID', 'タイトル', 'ポイント'], ['IMP-002', '\'=IMPORTXML("http://x","//a")', '-3']]);
});
