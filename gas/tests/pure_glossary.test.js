const test = require('node:test');
const assert = require('node:assert/strict');
const { GLOSSARY, GLOSSARY_ALIASES, glossaryOf } = require('../pure_glossary.js');

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

// 画面の見出し語が用語集のキーと違うとき、別名で繋ぐ。一覧の列見出しは「ポイント」、
// 用語集のキーは「ストーリーポイント」。繋がないと、利用者が名指しした語に説明が出ない。
test('別名は用語集のキーへ解決する', () => {
  assert.equal(glossaryOf('ポイント'), GLOSSARY['ストーリーポイント']);
});

test('別名の先はすべて用語集に存在する', () => {
  Object.keys(GLOSSARY_ALIASES).forEach((alias) => {
    const key = GLOSSARY_ALIASES[alias];
    assert.ok(GLOSSARY[key], alias + ' の別名先 ' + key + ' が用語集に無い');
  });
});

test('別名は用語集のキーと衝突しない', () => {
  // 同じ語が別名とキーの両方にあると、どちらが出るかが実装順で決まってしまう。
  Object.keys(GLOSSARY_ALIASES).forEach((alias) => {
    assert.equal(Object.prototype.hasOwnProperty.call(GLOSSARY, alias), false,
      alias + ' が別名とキーの両方にある');
  });
});

test('別名でも前後の空白を無視する', () => {
  assert.equal(glossaryOf('  ポイント  '), GLOSSARY['ストーリーポイント']);
});
