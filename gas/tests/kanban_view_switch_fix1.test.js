'use strict';
// Task 7 修正ラウンド 1 で直したものだけの検査（裁定C）。
//
// タブ/ビュー切り替え機能そのものの網羅的な検査は Task 9（gas/tests/kanban_view.test.js）
// の仕事なので、ここでは今回のラウンドで直した6点に限る:
//   1. 裁定A: 読み取り失敗（ok:false / withFailureHandler）で前のタブの盤面が
//      表示されたまま操作できてしまう問題（Critical-1 再現A/B）
//   2. 裁定A: writeSeq で応答を捨てたとき、盤面が出たままになる問題（Critical-1 再現C）
//   3. 裁定B: 同じビューへの読み込みが逆順に届くと古い方が勝つ問題（Important-4）
//   4. 裁定B: 判定順序により、離れたビューのエラーが今のビューへ被さる問題（Important-3）
//   5. task-7-lead-gaps.md 欠落2: ビュー切替で発行中の読み込みを破棄する防御
//   6. task-7-lead-gaps.md 欠落1: ロードマップの marks

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function cols(placed) {
  return STATUSES.map(function (s) { return { status: s, cards: (placed || {})[s] || [] }; });
}

const CARD_A = { id: 'PBI-001', title: 'A', updated_at: 'T1' };
const CARD_B = { id: 'PBI-002', title: 'B', updated_at: 'T1' };
const INITIAL = cols({ New: [CARD_A, CARD_B] });

const LIST_COLUMNS = [{ field: 'id', label: 'ID' }];
const listView = (id) => ({ columns: LIST_COLUMNS, rows: [{ id: id }] });

/** 初期読み込み（盤面）を済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL) });
  return h;
}

// ---------------------------------------------------------------------------
// 1. 裁定A（Critical-1 再現A/B）: 読み取り失敗で前のタブの盤面が残らない
// ---------------------------------------------------------------------------

test('タブ切替の読み取りが ok:false でも、選んだタブ側が表示され、隠れた盤面はドラッグしても送信されない', () => {
  const h = ready();
  h.clickTab('スプリント');                        // → apiGetView('burndown')
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiGetView');
  assert.deepEqual(call.args, ['burndown']);

  call.handlers.success({ ok: false, name: 'burndown', message: 'CSV のヘッダーが壊れています' });

  assert.equal(h.hiddenOf('board'), true, '盤面が隠れていない（前のタブが操作できてしまう）');
  assert.equal(h.hiddenOf('table-view'), false, '選んだタブ側（表）が出ていない');

  const before = h.calls.length;
  // 実ブラウザでは隠れた盤面に触れない。ここは画面側のガードそのものを見たいので raw。
  h.raw.drag('PBI-001', 'Ready');
  assert.equal(h.calls.length, before, '隠れた盤面をドラッグしたら送信されてしまった');
});

test('タブ切替の読み取りが通信断（withFailureHandler）でも、選んだタブ側が表示されたまま', () => {
  const h = ready();
  h.clickTab('障害物');                            // → apiGetView('impediment')
  const call = h.calls[h.calls.length - 1];
  call.handlers.failure({ message: 'ネットワーク' });

  assert.equal(h.hiddenOf('board'), true, '盤面が隠れていない');
  assert.equal(h.hiddenOf('table-view'), false, '選んだタブ側（表）が出ていない');

  const before = h.calls.length;
  h.raw.drag('PBI-001', 'Ready');
  assert.equal(h.calls.length, before, '隠れた盤面をドラッグしたら送信されてしまった');
});

// ---------------------------------------------------------------------------
// 2. 裁定A（Critical-1 再現C）: writeSeq で捨てても盤面は出たままにならない
// ---------------------------------------------------------------------------

test('ドラッグ送信中に一覧へ切り替えると、確定後に届く一覧の応答を writeSeq で捨てても盤面は出たままにならない', () => {
  const h = ready();
  h.drag('PBI-001', 'Done');
  const dragCall = h.calls[h.calls.length - 1];

  h.clickView('一覧');                             // → apiGetView('list')
  const listCall = h.calls[h.calls.length - 1];
  assert.deepEqual(listCall.args, ['list']);

  dragCall.handlers.success({ ok: true, board: h.boardOf(cols({ Done: [CARD_A], New: [CARD_B] })) });
  listCall.handlers.success({ ok: true, name: 'list', view: listView('X'), summary: null });

  assert.equal(h.hiddenOf('board'), true, '盤面が出たままになった');
  assert.equal(h.hiddenOf('table-view'), false, '一覧（表）が出ていない');
  assert.equal(h.textOf('message'), '読み込み中に他の変更が入りました。もう一度お試しください。');
});

// ---------------------------------------------------------------------------
// 3. 裁定B（Important-4）: 同じビューの読み込みが逆順に届いても古い方で上書きされない
// ---------------------------------------------------------------------------

test('同じビューを続けて2回読み、2回目→1回目の順に届いても、古い方の内容で上書きされない', () => {
  const h = ready();
  h.clickView('一覧');
  const r1 = h.calls[h.calls.length - 1];
  h.click('reload');
  const r2 = h.calls[h.calls.length - 1];

  r2.handlers.success({ ok: true, name: 'list', view: listView('新しい'), summary: null });
  r1.handlers.success({ ok: true, name: 'list', view: listView('古い'), summary: null });

  const text = h.textTreeOf('table-view');
  assert.equal(text.indexOf('新しい') !== -1, true, '新しい内容が描かれていない');
  assert.equal(text.indexOf('古い') !== -1, false, '古い応答が新しい内容を上書きした');
});

// ---------------------------------------------------------------------------
// 4. 裁定B（Important-3）: 判定順序 — 離れたビューのエラーが今のビューへ被さらない
// ---------------------------------------------------------------------------

test('離れたビューの遅延応答（writeSeq 不一致）が、正常に描けた今のビューへエラーを被せない', () => {
  const h = ready();
  // ドラッグは盤面タブにいる間に行う（別タブへ切り替えた後のドラッグは move() が送信を止める）。
  h.drag('PBI-001', 'Done');
  const dragCall = h.calls[h.calls.length - 1];

  h.clickView('一覧');                             // → apiGetView('list')
  const listCall = h.calls[h.calls.length - 1];

  dragCall.handlers.success({ ok: true, board: h.boardOf(cols({ Done: [CARD_A], New: [CARD_B] })) }); // writeSeq++

  h.clickTab('スプリント');                        // → apiGetView('burndown')
  const bdCall = h.calls[h.calls.length - 1];
  bdCall.handlers.success({ ok: true, name: 'burndown', view: { table: { headers: ['日'], rows: [['D1']] } }, summary: null });

  assert.equal(h.textOf('message'), '', '前提: バーンダウンが正常に描けていない');
  assert.equal(h.textTreeOf('table-view').indexOf('D1') !== -1, true, '前提: バーンダウンの表が描かれていない');

  listCall.handlers.success({ ok: true, name: 'list', view: listView('X'), summary: null }); // 見てもいない一覧が遅れて届く

  assert.equal(h.textOf('message'), '', '見てもいない一覧のエラーが今のビューへ被さった');
  assert.equal(h.textTreeOf('table-view').indexOf('D1') !== -1, true, 'バーンダウンの表が消えた');
});

// ---------------------------------------------------------------------------
// 5. 欠落2: ビュー切替で発行中の読み込みを破棄する（同名比較ではなく viewSeq）
// ---------------------------------------------------------------------------

test('読み込み中に他のビューへ切り替えると、後から届く遅延応答で今のビューの表が上書きされない', () => {
  const h = ready();
  h.clickView('一覧');
  const listCall = h.calls[h.calls.length - 1];

  h.clickTab('スプリント');                        // burndown の読み込みが発行される（応答は返さない）
  h.clickView('ベロシティ');
  const veloCall = h.calls[h.calls.length - 1];
  assert.deepEqual(veloCall.args, ['velocity']);
  veloCall.handlers.success({
    ok: true, name: 'velocity', view: { table: { headers: ['スプリント'], rows: [['sprint003']] } }, summary: null
  });

  listCall.handlers.success({ ok: true, name: 'list', view: listView('X'), summary: null }); // 遅れて一覧が届く

  const text = h.textTreeOf('table-view');
  assert.equal(text.indexOf('sprint003') !== -1, true, 'ベロシティの表が残っていない');
  assert.equal(text.indexOf('ID') !== -1, false, '一覧の表で上書きされた');
});

// ---------------------------------------------------------------------------
// 6. 欠落1: ロードマップの marks
// ---------------------------------------------------------------------------

test('ロードマップの marks が指定したセルだけに mark クラスを付ける（指定していないセルには付かない）', () => {
  const h = ready();
  h.clickTab('スプリント');
  h.clickView('ロードマップ');
  const call = h.calls[h.calls.length - 1];
  assert.deepEqual(call.args, ['roadmap']);

  const headers = ['PBI', 'sprint001', 'sprint002'];
  const rows = [['PBI-1', '', ''], ['PBI-2', '', '']];
  const marks = [{ row: 0, col: 1 }, { row: 1, col: 2 }];
  call.handlers.success({ ok: true, name: 'roadmap', view: { table: { headers: headers, rows: rows }, marks: marks }, summary: null });

  const grid = h.tableRowsOf('table-view').map(function (r) { return r.map(function (c) { return c.marked; }); });
  assert.deepEqual(grid, [
    [false, true, false],
    [false, false, true],
  ]);
});

test('ロードマップの marks が空配列なら mark の付いたセルは0個になる', () => {
  const h = ready();
  h.clickTab('スプリント');
  h.clickView('ロードマップ');
  const call = h.calls[h.calls.length - 1];

  const headers = ['PBI', 'sprint001'];
  const rows = [['PBI-1', ''], ['PBI-2', '']];
  call.handlers.success({ ok: true, name: 'roadmap', view: { table: { headers: headers, rows: rows }, marks: [] }, summary: null });

  const grid = h.tableRowsOf('table-view');
  const markedCount = grid.reduce(function (n, r) { return n + r.filter(function (c) { return c.marked; }).length; }, 0);
  assert.equal(markedCount, 0);
});
