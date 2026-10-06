'use strict';
// 最終レビューで見つかった不具合（I1・I3・M3）の再現テスト。直したあとも残し、戻らないことを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const S = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const cols = (p) => S.map((s) => ({ status: s, cards: (p || {})[s] || [] }));
const A = { id: 'PBI-001', title: 'A', updated_at: 'T1' };
const B = { id: 'PBI-002', title: 'B', updated_at: 'T1' };
const C = { id: 'PBI-003', title: 'C', updated_at: 'T1' };
const has = (scr, id) => scr.some((c) => c.cards.indexOf(id) !== -1);

function boot(p) {
  const h = createHarness(cols(p));
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(cols(p)) });
  return h;
}
const last = (h) => h.calls[h.calls.length - 1];

// --- I1: 削除の控え（deletedPbiIds）が消えない ---

test('I1: 削除したカードが別の経路で戻り、読み込みで見えたあと、重なった移動の応答で消えない', () => {
  const h = boot({ New: [A, B] });
  h.openCard('PBI-001');
  h.click('panel-delete');
  last(h).handlers.success({ ok: true, removed: A, board: h.boardOf(cols({ New: [B] })) });
  h.click('reload');
  last(h).handlers.success({ ok: true, view: h.boardOf(cols({ New: [A, B] })) });
  h.drag('PBI-001', 'Ready');
  const mA = last(h);
  h.drag('PBI-002', 'Ready');
  const mB = last(h);
  mA.handlers.success({ ok: true, board: h.boardOf(cols({ New: [B], Ready: [{ ...A, updated_at: 'T3' }] })) });
  mB.handlers.success({ ok: true, board: h.boardOf(cols({ Ready: [{ ...A, updated_at: 'T3' }, { ...B, updated_at: 'T3' }] })) });
  assert.ok(has(h.screen(), 'PBI-001'), 'PBI-001 が消えた');
});

test('I1: 削除の確定時に送信中の書き込みが残っていても、読み込みに載った id は控えから外す', () => {
  const h = boot({ New: [A, B, C] });
  h.drag('PBI-003', 'Ready');   // 削除より前に出し、返らないままにする
  const mC = last(h);
  h.openCard('PBI-001');
  h.click('panel-delete');
  last(h).handlers.success({ ok: true, removed: A, board: h.boardOf(cols({ New: [B], Ready: [C] })) });
  h.click('reload');
  last(h).handlers.success({ ok: true, view: h.boardOf(cols({ New: [A, B], Ready: [C] })) });
  assert.ok(has(h.screen(), 'PBI-001'));
  h.drag('PBI-001', 'Ready');   // C が送信中なので重なる（盤面全体は信じない）
  last(h).handlers.success({ ok: true, board: h.boardOf(cols({ New: [B], Ready: [C, { ...A, updated_at: 'T3' }] })) });
  assert.ok(has(h.screen(), 'PBI-001'), '戻ったカードを移した応答で、カードが消えた');
  mC.handlers.success({ ok: true, board: h.boardOf(cols({ New: [B], Ready: [{ ...C, updated_at: 'T2' }, { ...A, updated_at: 'T3' }] })) });
  assert.ok(has(h.screen(), 'PBI-001'));
});

test('I1: 削除の確定前に出した書き込みの古い写しでは戻さず、それが返ったら控えを捨てる', () => {
  const h = boot({ New: [A, B] });
  h.drag('PBI-002', 'Ready');   // 削除より前に出した移動
  const mB = last(h);
  h.openCard('PBI-001');
  h.click('panel-delete');
  last(h).handlers.success({ ok: true, removed: A, board: h.boardOf(cols({ Ready: [B] })) });
  assert.deepEqual(Object.keys(h.sandbox.deletedPbiIds), ['PBI-001']);
  // 削除より先にサーバが処理した移動の応答（A がまだある古い写し）
  mB.handlers.success({ ok: true, board: h.boardOf(cols({ New: [A], Ready: [{ ...B, updated_at: 'T2' }] })) });
  assert.ok(!has(h.screen(), 'PBI-001'), '削除したカードが古い写しで戻った');
  assert.deepEqual(Object.keys(h.sandbox.deletedPbiIds), [], '控えが残り続けている');
});

test('I1: 送信中の書き込みが無いときに確定した削除は、控えを残さない', () => {
  const h = boot({ New: [A, B] });
  h.openCard('PBI-001');
  h.click('panel-delete');
  last(h).handlers.success({ ok: true, removed: A, board: h.boardOf(cols({ New: [B] })) });
  assert.deepEqual(Object.keys(h.sandbox.deletedPbiIds), []);
});
