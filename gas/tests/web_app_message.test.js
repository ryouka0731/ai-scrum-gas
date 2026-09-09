const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// web_app.js は GAS API に依存する（module.exports も持たない）ため、require ではなく
// gas_load.test.js と同じ vm 評価で関数だけを取り出す。トップレベルは const 2つと
// 関数宣言だけなので、この1ファイルの評価で conflictMessage_ を参照できる。
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'web_app.js'), 'utf8'), context, { filename: 'web_app.js' });
const conflictMessage_ = context.conflictMessage_;

test('競合の文面は、次に何をすれば通るかを操作ごとに書く', () => {
  // 「最新の内容に更新しました」だけだと、やり直せば通ると読める。パネルでは
  // やり直しても通らない（expectedUpdatedAt を合わせて初めて通る）ため、
  // ドラッグと同じ文面にすると効かない復帰手順を案内することになる。
  const save = conflictMessage_('conflict', '内容を確認し、もう一度保存すると上書きします。');
  assert.ok(save.indexOf('他の変更が先に入っています。') === 0, save);
  assert.ok(save.indexOf('もう一度保存') !== -1, '保存で復帰する方法が書かれていない: ' + save);

  const del = conflictMessage_('conflict', '内容を確認し、もう一度削除すると更新後の内容ごと消します。');
  assert.ok(del.indexOf('もう一度削除') !== -1, '削除で復帰する方法が書かれていない: ' + del);
});

test('ドラッグ（retryHint なし）は従来の文面のまま', () => {
  // ドラッグは move() が毎回 updated_at を読み直すので、やり直せば通る。
  assert.equal(conflictMessage_('conflict'), '他の変更が先に入っています。最新の内容に更新しました。');
});

test('不在の文面は retryHint に左右されない', () => {
  // 消えてしまった PBI は、もう一度押しても通らない。
  ['not_found', undefined].forEach(function (reason) {
    assert.equal(conflictMessage_(reason, '内容を確認し、もう一度保存すると上書きします。'),
      'この PBI が見つかりません。最新の内容に更新しました。');
  });
});

test('パネル系 API は競合の文面に復帰手順を載せる', () => {
  // conflictMessage_ を直接呼べても、apiUpdatePbi / apiDeletePbi が retryHint を
  // 渡していなければ画面には従来の文面が出る。呼び出し側も見る。
  const src = fs.readFileSync(path.join(__dirname, '..', 'web_app.js'), 'utf8');
  assert.ok(/apiUpdatePbi[\s\S]*?conflictMessage_\(r\.reason,\s*'内容を確認し、もう一度保存/.test(src),
    'apiUpdatePbi が復帰手順を渡していません');
  assert.ok(/apiDeletePbi[\s\S]*?conflictMessage_\(r\.reason,\s*'内容を確認し、もう一度削除/.test(src),
    'apiDeletePbi が復帰手順を渡していません');
});
