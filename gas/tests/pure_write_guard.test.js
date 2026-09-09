const test = require('node:test');
const assert = require('node:assert/strict');
const { WRITABLE_FILES, assertWritableFileName } = require('../pure_write_guard.js');

test('許可リストに product_backlog.csv がある', () => {
  assert.ok(WRITABLE_FILES.indexOf('product_backlog.csv') !== -1);
});

test('許可されたファイル名は通る', () => {
  assert.doesNotThrow(function () { assertWritableFileName('product_backlog.csv'); });
});

test('許可されていないファイル名は拒否する', () => {
  assert.throws(function () { assertWritableFileName('velocity.csv'); }, /書き込みが許可されていません/);
});

test('パス区切りを含む名前を拒否する', () => {
  assert.throws(function () { assertWritableFileName('sub/product_backlog.csv'); });
  assert.throws(function () { assertWritableFileName('sub\\product_backlog.csv'); });
});

test('親ディレクトリへの参照を拒否する', () => {
  assert.throws(function () { assertWritableFileName('../product_backlog.csv'); });
});

test('空の名前を拒否する', () => {
  assert.throws(function () { assertWritableFileName(''); });
  assert.throws(function () { assertWritableFileName(null); });
  assert.throws(function () { assertWritableFileName(undefined); });
});

test('前後の空白がある名前を拒否する', () => {
  assert.throws(function () { assertWritableFileName(' product_backlog.csv'); });
});

test('呼び出しごとに違う値を返す toString は拒否する（TOCTOU の再現）', () => {
  let n = 0;
  const evil = {
    toString() {
      n += 1;
      return n === 1 ? 'product_backlog.csv' : '../../../etc/passwd';
    }
  };
  // 検証と実利用の間で toString() の返す値が変わりうるオブジェクトは、
  // 検証時に何度呼ばれても常に拒否されなければならない。
  assert.throws(function () { assertWritableFileName(evil); });
  assert.throws(function () { assertWritableFileName(evil); });
});

test('String オブジェクト（boxed string）を拒否する', () => {
  assert.throws(function () { assertWritableFileName(new String('product_backlog.csv')); });
});

test('配列を拒否する', () => {
  assert.throws(function () { assertWritableFileName(['product_backlog.csv']); });
});

test('toString をオーバーライドしたプレーンオブジェクトを拒否する', () => {
  const obj = { toString() { return 'product_backlog.csv'; } };
  assert.throws(function () { assertWritableFileName(obj); });
});

test('WRITABLE_FILES は凍結されており push できない', () => {
  assert.throws(function () { WRITABLE_FILES.push('velocity.csv'); });
});
