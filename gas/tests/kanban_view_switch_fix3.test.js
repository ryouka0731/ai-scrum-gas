'use strict';
// Task 7 修正ラウンド 3 で直したものだけの検査（再レビュー2の残り2件、原因は1つ）。
//
// foldTableLoading() の判定基準を「捨てるべき応答か」から「今そこに読み込み中の
// placeholder が出ているか」（tableLoading フラグ）に変えた。これにより:
//   結果1（Important・新規）: 「最新にする」（showView() を経由しない）が失敗しても、
//     描画済みの表を消さなくなる（要約と表の食い違いも解消）。
//   結果2（Minor）: writeSeq 不一致の経路でも、placeholder が出ていれば畳まれる。
// viewSeq 不一致（捨てるべき応答）では引き続き畳まれない（既存の検査
// gas/tests/kanban_view_switch_fix2.test.js の「捨てるべき応答…畳まない」で確認済み）。

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
// 結果1: 「最新にする」の失敗で描画済みの表を消さない（検査1・2）
// ---------------------------------------------------------------------------

test('一覧を表示して「最新にする」が ok:false で失敗しても、描画済みの表が消えない', () => {
  const h = ready();
  h.clickView('一覧');
  const first = h.calls[h.calls.length - 1];
  first.handlers.success({
    ok: true, name: 'list', view: listView('X'), summary: { byStatus: [], total: { count: 3, points: 8 } }
  });
  assert.equal(h.textTreeOf('table-view').indexOf('X') !== -1, true, '前提: 一覧の表が出ていない');
  assert.equal(h.textTreeOf('summary').indexOf('合計') !== -1, true, '前提: 要約が出ていない');

  h.click('reload');   // showView() を経由しない
  const reloadCall = h.calls[h.calls.length - 1];
  reloadCall.handlers.success({ ok: false, name: 'list', message: 'CSV のヘッダーが壊れています' });

  assert.equal(h.textTreeOf('table-view').indexOf('X') !== -1, true,
    '「最新にする」の失敗で描画済みの表が消えた');
  assert.equal(h.textTreeOf('summary').indexOf('合計') !== -1, true,
    '要約は残っているのに表が消えた（食い違い）');
});

test('一覧を表示して「最新にする」が通信断で失敗しても、描画済みの表が消えない', () => {
  const h = ready();
  h.clickView('一覧');
  const first = h.calls[h.calls.length - 1];
  first.handlers.success({ ok: true, name: 'list', view: listView('X'), summary: null });
  assert.equal(h.textTreeOf('table-view').indexOf('X') !== -1, true, '前提: 一覧の表が出ていない');

  h.click('reload');
  const reloadCall = h.calls[h.calls.length - 1];
  reloadCall.handlers.failure({ message: 'ネットワーク' });

  assert.equal(h.textTreeOf('table-view').indexOf('X') !== -1, true,
    '「最新にする」の失敗で描画済みの表が消えた');
});

// ---------------------------------------------------------------------------
// 結果2: writeSeq 不一致の経路でも「読み込んでいます…」を畳む（検査3）
// ---------------------------------------------------------------------------

test('writeSeq 不一致で捨てた応答でも、表示中の「読み込んでいます…」は畳まれる', () => {
  const h = ready();
  h.drag('PBI-001', 'Done');
  const dragCall = h.calls[h.calls.length - 1];

  h.clickView('一覧');   // → apiGetView('list')、table-view は「読み込んでいます…」のまま
  const listCall = h.calls[h.calls.length - 1];
  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, true,
    '前提: 読み込み中表示が出ていない');

  dragCall.handlers.success({ ok: true, board: h.boardOf(cols({ Done: [CARD_A], New: [CARD_B] })) }); // writeSeq++
  listCall.handlers.success({ ok: true, name: 'list', view: listView('X'), summary: null }); // writeSeq 不一致で捨てられる

  assert.equal(h.textOf('message'), '読み込み中に他の変更が入りました。もう一度お試しください。');
  assert.equal(h.textTreeOf('table-view').indexOf('読み込んでいます') !== -1, false,
    'writeSeq 不一致でも読み込み中表示が畳まれていない');
});

// ---------------------------------------------------------------------------
// 検査4（viewSeq 不一致では畳まれない）は既存検査で確認済み
// ---------------------------------------------------------------------------
// gas/tests/kanban_view_switch_fix2.test.js の
// 「捨てるべき応答（別ビューへ切替済み）の失敗では、新しいビューの読み込み中表示を畳まない」
// がそのまま通り続けていることをフルスイートの実行で確認している（本ラウンドで退行なし）。

// ---------------------------------------------------------------------------
// 検査5: 盤面ビューでは今までどおり内容が残る（非退行）
// ---------------------------------------------------------------------------

test('盤面ビューでは、「最新にする」が失敗しても盤面の内容が残る（非退行の確認）', () => {
  const h = ready();
  assert.equal(h.screen()[0].cards.indexOf('PBI-001') !== -1, true, '前提: 盤面にカードが出ていない');

  h.click('reload');
  const call = h.calls[h.calls.length - 1];
  call.handlers.success({ ok: false, name: 'board', message: '失敗' });

  assert.equal(h.screen()[0].cards.indexOf('PBI-001') !== -1, true, '盤面の内容が消えた');
});
