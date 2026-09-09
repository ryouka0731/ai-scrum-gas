'use strict';
// Task 7 修正ラウンド 2 で直したものだけの検査（再レビューの残り4件: A/B/C/D）。
//
//   A: showView() の renderSummary(null) 呼び出し（前のタブの要約を残さない）
//   B: showView() の showTableLoading() 呼び出し（前のビューの表を残さない）
//   C: 失敗が確定したら「読み込んでいます…」を畳む。ただし捨てるべき応答では畳まない
//   D: 盤面が隠れているとき、盤面由来の操作（カードの click / 「追加」ボタン / ドラッグ）
//      のどれからも書き込みが飛ばない

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

/** 初期読み込み（盤面）を済ませたハーネスを返す。要約は無し。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL) });
  return h;
}

/** 初期読み込み（盤面）を、要約つきで済ませたハーネスを返す。 */
function readyWithSummary() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({
    ok: true, view: h.boardOf(INITIAL), summary: { byStatus: [], total: { count: 2, points: 5 } }
  });
  return h;
}

// ---------------------------------------------------------------------------
// A: #summary のクリアはクリック時点（応答を待たない）
// ---------------------------------------------------------------------------

test('タブ切替の直後（応答前）に前のタブの要約が残らない', () => {
  const h = readyWithSummary();
  assert.equal(h.textTreeOf('summary').indexOf('合計') !== -1, true, '前提: 要約が出ていない');

  h.clickTab('スプリント');   // 応答はまだ届いていない
  assert.equal(h.textTreeOf('summary'), '', 'クリック直後に前のタブの要約が残っている');
});

// ---------------------------------------------------------------------------
// B: #table-view の「読み込み中」化もクリック時点（応答を待たない）
// ---------------------------------------------------------------------------

test('表のビュー切替の直後（応答前）に前のビューの表が残らない', () => {
  const h = ready();
  h.clickView('一覧');
  h.calls[h.calls.length - 1].handlers.success({ ok: true, name: 'list', view: listView('X'), summary: null });
  assert.equal(h.textTreeOf('table-view').indexOf('X') !== -1, true, '前提: 一覧の表が出ていない');

  h.clickTab('スプリント');   // burndown への切替、応答はまだ
  const text = h.textTreeOf('table-view');
  assert.equal(text.indexOf('X') !== -1, false, '前のビュー（一覧）の表が残っている');
  assert.equal(text.indexOf('読み込んでいます') !== -1, true, '読み込み中の表示に置き換わっていない');
});

// ---------------------------------------------------------------------------
// C: 失敗が確定したら畳む。捨てるべき応答では畳まない（両側）
// ---------------------------------------------------------------------------

test('読み取りが ok:false で確定的に失敗したら「読み込んでいます…」を畳む', () => {
  const h = ready();
  h.clickView('一覧');
  const call = h.calls[h.calls.length - 1];
  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, true, '前提: 読み込み中表示が出ていない');

  call.handlers.success({ ok: false, name: 'list', message: 'CSV のヘッダーが壊れています' });

  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, false,
    '失敗したのに「読み込んでいます…」が残っている');
  assert.equal(h.textOf('message'), 'CSV のヘッダーが壊れています');
});

test('読み取りが通信断（withFailureHandler）で確定的に失敗したら「読み込んでいます…」を畳む', () => {
  const h = ready();
  h.clickView('完了');
  const call = h.calls[h.calls.length - 1];

  call.handlers.failure({ message: 'ネットワーク' });

  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, false,
    '失敗したのに「読み込んでいます…」が残っている');
});

test('捨てるべき応答（別ビューへ切替済み）の失敗では、新しいビューの読み込み中表示を畳まない', () => {
  const h = ready();
  h.clickView('一覧');
  const listCall = h.calls[h.calls.length - 1];

  h.clickTab('スプリント');   // 一覧の応答を待たずにバーンダウンへ切替（burndown の call には応答しない）
  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, true,
    '前提: バーンダウンの読み込み中表示が出ていない');
  assert.equal(h.textOf('message'), '読み込んでいます…', '前提: バーンダウンの読み込み中メッセージが出ていない');

  listCall.handlers.success({ ok: false, name: 'list', message: '古いビューのエラー' });   // 捨てるべき応答

  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, true,
    '捨てるべき応答でバーンダウンの読み込み中表示が畳まれた');
  assert.equal(h.textOf('message'), '読み込んでいます…', '捨てるべき応答のエラーで #message が上書きされた');
});

// ---------------------------------------------------------------------------
// D: 盤面が隠れているとき、盤面由来の操作はどの経路からも起こらない
// ---------------------------------------------------------------------------

test('盤面が隠れているとき、ドラッグしても apiUpdateStatus は飛ばない', () => {
  const h = ready();
  h.clickView('一覧');
  const before = h.calls.length;
  h.drag('PBI-001', 'Ready');
  assert.equal(h.calls.length, before, 'ドラッグで新しい呼び出しが発行された');
});

test('盤面が隠れているとき、カードの click でパネルが開かず apiUpdatePbi も飛ばない', () => {
  const h = ready();
  h.clickView('一覧');
  const before = h.calls.length;
  h.openCard('PBI-001');
  assert.equal(h.hiddenOf('panel'), true, '隠れた盤面のカードでパネルが開いてしまう');
  assert.equal(h.calls.length, before, 'カードの click で新しい呼び出しが発行された');
});

test('盤面が隠れているとき、「追加」ボタンでパネルが開かず apiCreatePbi も飛ばない', () => {
  const h = ready();
  h.clickView('一覧');
  const before = h.calls.length;
  h.clickAdd('New');
  assert.equal(h.hiddenOf('panel'), true, '隠れた盤面の「追加」ボタンでパネルが開いてしまう');
  assert.equal(h.calls.length, before, '「追加」ボタンで新しい呼び出しが発行された');
});
