'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./bughunt_d_world.js');
const F = require('./bughunt_d_fuzzer.js');

/**
 * バグ探し D: 到達順・処理順の乱択（kanban.html の画面 × 本物のサーバ）。
 *
 * 呼び出しごとに「サーバで処理する時点」と「画面へ届く時点」を種から決める。サーバは本物
 * （gas/*.js を vm に載せ、Drive をインメモリに差し替えたもの）なので、応答は処理した順に
 * 矛盾の無い写しになる。見つけた不具合（D-1〜D-4）は直し、その再現は bughunt_g2_fixed.test.js にある。
 */

const ALL = ['drag', 'openCard', 'addCard', 'editTitleSave', 'deletePbi', 'closePanel', 'escape', 'toastAction', 'timers',
  'tab', 'view', 'reload', 'commentAdd', 'commentDelete', 'historyToggle', 'impOpen', 'impAdd', 'impSave', 'impResolve',
  'impCancelResolve', 'impClose', 'pending'];

function campaign(name, cfg, from, to) {
  const failures = [];
  for (let s = from; s <= to; s++) {
    const r = F.runSeed(s, cfg);
    if (r.ok) continue;
    failures.push('種 ' + s + ' (' + name + '): ' + (r.error ? r.error.stack : r.violations.join(' / '))
      + '\n  操作列: ' + JSON.stringify(r.ops));
    if (failures.length >= 3) break;
  }
  return failures;
}

const BASE = { steps: 60, busy: 0.1, partial: 0.15, fail: 0.1, checkPendingMark: false };

test('乱択（サーバの処理順も届く順も乱す）: 例外が無く、最新にした後は画面がサーバと一致し、塞がったままの操作も「読み込んでいます…」も残らない', () => {
  const f = campaign('全操作', Object.assign({}, BASE, { ops: ALL }), 1, 200)
    .concat(campaign('障害物', Object.assign({}, BASE, { startTab: '障害物',
      ops: ['impOpen', 'impOpen', 'impAdd', 'impSave', 'impSave', 'impResolve', 'impResolve', 'impCancelResolve', 'impClose',
        'toastAction', 'timers', 'pending', 'commentAdd', 'commentDelete', 'historyToggle', 'reload', 'escape', 'tab'] }), 1, 150));
  assert.deepEqual(f, []);
});

test('乱択（サーバは発行順に処理し、届く順だけ乱す）: 静止した時点で、コメントの一覧・件数がサーバと一致する', () => {
  const f = campaign('コメント', Object.assign({}, BASE, { fifoServer: true, strictComments: true,
    ops: ['openCard', 'commentAdd', 'commentAdd', 'commentDelete', 'toastAction', 'historyToggle', 'timers', 'reload', 'tab', 'view', 'drag'] }), 1, 200);
  assert.deepEqual(f, []);
});

test('乱択（サーバは発行順に処理し、届く順だけ乱す）: 静止した時点で、障害物の表・件数・パネルのコメントがサーバと一致する', () => {
  const f = campaign('障害物', Object.assign({}, BASE, { fifoServer: true, strictComments: true, strictImp: true, startTab: '障害物',
    ops: ['impOpen', 'impOpen', 'impAdd', 'impSave', 'impSave', 'impResolve', 'impResolve', 'impCancelResolve', 'impClose',
      'toastAction', 'timers', 'pending', 'commentAdd', 'commentDelete', 'historyToggle', 'reload', 'escape'] }), 1, 200);
  assert.deepEqual(f, []);
});

test('乱択（サーバは発行順に処理し、届く順だけ乱す）: 静止した時点で、盤面の列とタイトルがサーバと一致する（列の中の並びは問わない）', () => {
  const f = campaign('盤面', Object.assign({}, BASE, { fifoServer: true, strictBoard: true,
    ops: ['drag', 'drag', 'openCard', 'addCard', 'editTitleSave', 'editTitleSave', 'deletePbi', 'closePanel', 'toastAction', 'timers', 'reload'] }), 1, 200);
  assert.deepEqual(f, []);
});

// サーバが後から発行した書き込みを先に処理しても、確定した自分の書き込みは画面から消えない（D-1）。
test('乱択（サーバの処理順も届く順も乱す）: 静止した時点で、盤面・コメント・障害物の表がサーバと一致し、「完了する」の通知は止まった操作がある間だけ出る', () => {
  const f = campaign('全操作・厳密', Object.assign({}, BASE, { ops: ALL, strictBoard: true, strictComments: true, strictImp: true, checkSticky: true }), 1, 150)
    .concat(campaign('障害物・厳密', Object.assign({}, BASE, { startTab: '障害物', strictImp: true, strictComments: true, checkSticky: true,
      ops: ['impOpen', 'impOpen', 'impAdd', 'impSave', 'impSave', 'impResolve', 'impResolve', 'impCancelResolve', 'impClose',
        'toastAction', 'toastAction', 'timers', 'pending', 'pending', 'commentAdd', 'commentDelete', 'reload', 'escape'] }), 1, 150));
  assert.deepEqual(f, []);
});

// --- 狙った順序（今の実装で正しく扱えているもの） ---------------------------------------

function boot() { const w = W.createWorld(); w.boot(); return w; }
const own = 'CMT-0000000b';   // PBI-001 の自分のコメント

test('削除の送信中に出した読み込みが、削除より前の写しで先に届いても、削除の応答の後に消したコメントは出ない', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', own);
  const del = w.pendingNs()[0];
  h.click('reload');
  const load = w.pendingNs()[1];
  w.process(load);          // 読み込みは削除より前の状態を読む
  w.process(del);
  w.deliver(load);          // 古い写しが先に届く（送信中なので一覧には残っていてよい）
  w.deliver(del);
  assert.deepEqual(h.commentsIn('panel-comments').map((c) => c.id), ['CMT-0000000a']);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 1');
});

test('削除の応答の後に、削除より前の写しの読み込みが届いても、消したコメントは戻らない', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-001');
  h.click('reload');
  const load = w.pendingNs()[0];
  h.clickCommentDelete('panel-comments', own);
  const del = w.pendingNs()[1];
  w.process(load);
  w.process(del);
  w.deliver(del);
  w.deliver(load);
  assert.deepEqual(h.commentsIn('panel-comments').map((c) => c.id), ['CMT-0000000a']);
});

test('削除の取り消しは、送信中に届いた古い写しでは出さず、成功の応答で出す', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', own);
  w.drain();
  h.click('toast-undo');             // 取り消す
  const restore = w.pendingNs()[0];
  h.click('reload');
  const load = w.pendingNs()[1];
  w.process(restore);
  w.process(load);                   // 戻した後の写し
  w.deliver(load);
  // 戻す応答がまだなので、出さないのが仕様（画面が成功を知るまでは消えたまま）
  assert.deepEqual(h.commentsIn('panel-comments').map((c) => c.id), ['CMT-0000000a']);
  w.deliver(restore);
  assert.deepEqual(h.commentsIn('panel-comments').map((c) => c.id), ['CMT-0000000a', own]);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2');
});

test('「完了する」の通知は Escape でも時間でも消えず、上に出た普通の通知が消えると戻ってくる', () => {
  const w = boot();
  const h = w.h;
  h.clickTab('障害物'); w.drain();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve'); h.setValue('i-resolution', 'fixed'); h.click('imp-panel-resolve');
  const n = w.pendingNs()[0];
  w.process(n, 'partial'); w.deliver(n);
  assert.equal(h.labelOf('toast-undo'), '完了する');
  h.pressKey('Escape'); h.flushTimers();
  assert.equal(h.hiddenOf('toast'), false);
  assert.equal(h.labelOf('toast-undo'), '完了する');
  // 普通の通知（コメントの削除）を上に出す
  h.clickImpRow('IMP-001');
  h.clickCommentDelete('imp-panel-comments', 'CMT-0000000c');
  w.drain();
  assert.equal(h.labelOf('toast-undo'), '取り消す');
  h.click('imp-panel-close');
  h.pressKey('Escape');                // 普通の通知を閉じる
  assert.equal(h.hiddenOf('toast'), false);
  assert.equal(h.labelOf('toast-undo'), '完了する');
  assert.match(h.textOf('toast-text'), /IMP-002/);
});

test('履歴: 閉じて開き直した節に、前に出した取得の応答は描かれない（新しい応答で描く）', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  const first = w.pendingNs()[0];
  h.historyToggle('panel-history');   // 閉じる
  h.historyToggle('panel-history');   // 開き直す
  const second = w.pendingNs()[1];
  assert.equal(h.historyStateOf('panel-history').status, '読み込んでいます…');
  w.process(first);
  w.deliver(first);
  assert.equal(h.historyStateOf('panel-history').status, '読み込んでいます…', '古い応答で描いた');
  w.process(second);
  w.deliver(second);
  assert.equal(h.historyStateOf('panel-history').status, 'まだ履歴がありません');
});

test('障害物の書き込みの応答は、別のタブへ移った後に届いても、そのタブの表を上書きしない', () => {
  const w = boot();
  const h = w.h;
  h.clickTab('障害物'); w.drain();
  h.clickImpRow('IMP-001');
  h.setValue('i-title', 'renamed');
  h.click('imp-panel-save');
  const save = w.pendingNs()[0];
  h.clickTab('スプリント');
  w.drain();   // 保存とバーンダウンの読み込みが届く
  assert.equal(h.tabState().tabs.find((t) => t.selected).label, 'スプリント');
  assert.equal(W.collect(w.activeTable(), (e) => e.id === 'imp-add').length, 0, 'スプリントの表が障害物の表で上書きされた');
  h.clickTab('障害物'); w.drain();
  assert.ok(w.impTable().open.indexOf('IMP-001:renamed') !== -1);
  assert.ok(save >= 0);
});
