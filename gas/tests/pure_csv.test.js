const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToObjects } = require('../pure_csv.js');

test('単純な行を分解する', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('引用符内のカンマを保持する', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y",2'), [['a', 'b'], ['x,y', '2']]);
});

test('引用符内の改行を保持する', () => {
  assert.deepEqual(parseCsv('a\n"1\n2"'), [['a'], ['1\n2']]);
});

test('二重引用符のエスケープを解く', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
});

test('BOM を除去する', () => {
  assert.deepEqual(parseCsv('﻿a,b'), [['a', 'b']]);
});

test('CRLF を正規化する', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('末尾の空行を無視する', () => {
  assert.deepEqual(parseCsv('a\n1\n\n'), [['a'], ['1']]);
});

test('ヘッダを使ってオブジェクト化する', () => {
  const objs = csvToObjects('id,title\nPBI-001,ログイン');
  assert.deepEqual(objs, [{ id: 'PBI-001', title: 'ログイン' }]);
});

test('列が足りない行は空文字で埋める', () => {
  const objs = csvToObjects('id,title,note\nPBI-001,ログイン');
  assert.deepEqual(objs, [{ id: 'PBI-001', title: 'ログイン', note: '' }]);
});

test('空文字を渡すと空配列を返す', () => {
  assert.deepEqual(csvToObjects(''), []);
});
