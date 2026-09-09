const test = require('node:test');
const assert = require('node:assert/strict');
const { GLOSSARY, glossaryOf } = require('../pure_glossary.js');

// 画面で使う語。ここに挙げたものは必ず説明を持つこと。
const USED_IN_UI = [
  'ストーリーポイント', 'ベロシティ', 'バーンダウン', 'ロードマップ',
  'スプリント', '障害物', '受入基準',
  'New', 'Ready', 'In Progress', 'Review', 'Done',
  'Critical', 'High', 'Medium', 'Low',
];

test('画面で使う語はすべて説明を持つ', () => {
  USED_IN_UI.forEach((t) => {
    assert.ok(GLOSSARY[t], t + ' の説明が無い');
  });
});

test('説明は空でなく、用語そのものの言い換えで終わらない', () => {
  Object.keys(GLOSSARY).forEach((t) => {
    const d = GLOSSARY[t];
    assert.ok(d.trim().length >= 10, t + ' の説明が短すぎる: ' + d);
    assert.notEqual(d.trim(), t, t + ' の説明が用語そのもの');
  });
});

test('ストーリーポイントの説明がベロシティとの関係に触れる', () => {
  // 同じ数字に見えて別物なので、ここを外すと混乱する。
  assert.ok(GLOSSARY['ストーリーポイント'].indexOf('ベロシティ') !== -1);
});

test('ベロシティの説明がスプリント単位であることに触れる', () => {
  assert.ok(GLOSSARY['ベロシティ'].indexOf('スプリント') !== -1);
});

test('glossaryOf は知らない語に空文字を返す', () => {
  assert.equal(glossaryOf('しらない語'), '');
  assert.equal(glossaryOf(''), '');
  assert.equal(glossaryOf(null), '');
  assert.equal(glossaryOf(undefined), '');
});

test('glossaryOf は前後の空白を無視する', () => {
  assert.equal(glossaryOf('  ベロシティ  '), GLOSSARY['ベロシティ']);
});
