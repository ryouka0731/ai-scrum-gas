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
  last(h).handlers.success({ ok: true, undoToken: 'tok-del', removed: A, board: h.boardOf(cols({ New: [B] })) });
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
  last(h).handlers.success({ ok: true, undoToken: 'tok-del', removed: A, board: h.boardOf(cols({ New: [B], Ready: [C] })) });
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
  last(h).handlers.success({ ok: true, undoToken: 'tok-del', removed: A, board: h.boardOf(cols({ Ready: [B] })) });
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
  last(h).handlers.success({ ok: true, undoToken: 'tok-del', removed: A, board: h.boardOf(cols({ New: [B] })) });
  assert.deepEqual(Object.keys(h.sandbox.deletedPbiIds), []);
});

// --- I3: 同じ障害物への書き込みが送信中の間は、その行・ボタンを塞ぐ ---

const IMP_INITIAL = cols({});
const ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const RESOLVED_ROW = Object.assign({}, ROW, { status: 'Resolved', resolution: '再起動した' });
const PENDING = { id: 'IMP-002', open: ROW, resolved: RESOLVED_ROW };
const COLUMNS = [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }];
const CHOICES = [{ value: '', label: '（未割り当て）' }, { value: 'sprint001', label: 'sprint001' }];
function impResponse(open, resolved, pending) {
  return { ok: true, name: 'impediment',
    view: { columns: COLUMNS, open: open, resolved: resolved || [], pending: pending || [] },
    summary: { open: open.length, resolved: (resolved || []).length, pending: (pending || []).length }, sprintChoices: CHOICES };
}
const partial = (open, resolved, pending) => Object.assign(impResponse(open, resolved, pending),
  { ok: false, reason: 'partial', message: '途中で止まりました。（x）' });
function onImpediment(resp) {
  const h = createHarness(IMP_INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(IMP_INITIAL),
    summary: { byStatus: [], total: { count: 0, points: 0 } }, sprintChoices: CHOICES });
  h.clickTab('障害物');
  last(h).handlers.success(resp || impResponse([ROW]));
  return h;
}
/** #table-view の下の要素を探す（描き直しで作られた要素も含む）。 */
function findIn(h, pred) {
  const out = [];
  (function walk(n) { (n.children || []).forEach(function (c) { if (pred(c)) out.push(c); walk(c); }); })(h.sandbox.document.getElementById('table-view'));
  return out;
}
const openRow = (h, id) => findIn(h, (e) => e.tagName === 'tr' && e.dataset && e.dataset.id === id)[0];
const pendingBtn = (h, which) => findIn(h, (e) => e.id === 'imp-pending-' + which + '-IMP-002')[0];

test('I3: 保存の送信中は、その障害物の行を送信中として出し、押しても開かない。応答が返れば開ける', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setValue('i-title', '新しい題');
  h.click('imp-panel-save');
  const save = last(h);
  h.pressKey('Escape');
  assert.equal(h.hiddenOf('imp-panel'), true);
  const tr = openRow(h, 'IMP-002');
  assert.ok(tr.classList.contains('pending'), '送信中の印が無い');
  assert.equal(tr.getAttribute('aria-disabled'), 'true');
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel'), true, '送信中の障害物のパネルが開いた');
  save.handlers.success(impResponse([Object.assign({}, ROW, { title: '新しい題' })]));
  assert.ok(!openRow(h, 'IMP-002').classList.contains('pending'), '応答のあとも送信中の印が残っている');
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel'), false);
});

test('I3: 保存が失敗（通信）しても、行の送信中の印は外れる', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const save = last(h);
  h.pressKey('Escape');
  save.handlers.failure(new Error('x'));
  assert.ok(!openRow(h, 'IMP-002').classList.contains('pending'));
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel'), false);
});

test('I3: 「完了する」を送信中は、同じ障害物のパネルの保存・解決・やめるを塞ぎ、応答で戻す', () => {
  // 取り消しが途中で止まり、未解決にも行が見えている（パネルを開ける）状態
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  last(h).handlers.success(Object.assign(impResponse([], [RESOLVED_ROW]), { moved: ROW, resolvedRow: RESOLVED_ROW }));
  h.click('toast-undo');
  last(h).handlers.success(partial([ROW], [RESOLVED_ROW]));
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');   // 「やめる」を出す
  h.click('toast-undo');           // 「完了する」（取り消しの送り直し）
  const retry = last(h);
  assert.equal(retry.method, 'apiUnresolveImpediment');
  assert.equal(h.disabledOf('imp-panel-save'), true);
  assert.equal(h.disabledOf('imp-panel-resolve'), true);
  assert.equal(h.disabledOf('imp-panel-cancel-resolve'), true);
  retry.handlers.success(impResponse([ROW], []));
  assert.equal(h.disabledOf('imp-panel-resolve'), false);
  assert.equal(h.disabledOf('imp-panel-cancel-resolve'), false);
});

test('I3: 途中で止まった操作のボタンと「完了する」の通知は、同じ障害物の送信中は押せない', () => {
  const h = onImpediment(impResponse([], [RESOLVED_ROW], [PENDING]));
  h.clickPending('IMP-002', 'resolve');
  const c = last(h);
  assert.equal(c.method, 'apiResolveImpediment');
  assert.equal(pendingBtn(h, 'resolve').disabled, true);
  assert.equal(pendingBtn(h, 'unresolve').disabled, true);
  c.handlers.success(partial([], [RESOLVED_ROW], [PENDING]));   // また途中で止まる → 「完了する」が出る
  assert.equal(h.hiddenOf('toast'), false);
  assert.equal(h.disabledOf('toast-undo'), false);
  assert.equal(pendingBtn(h, 'unresolve').disabled, false);
  h.clickPending('IMP-002', 'unresolve');
  const u = last(h);
  assert.equal(u.method, 'apiUnresolveImpediment');
  assert.equal(h.disabledOf('toast-undo'), true, '送信中なのに「完了する」を押せる');
  u.handlers.success(impResponse([ROW], []));
  assert.equal(h.disabledOf('toast-undo'), false);
});

test('[乱択] 障害物（サーバの処理順も乱す）: 種 6119 で静止時の表がサーバと一致する（解決の途中で未解決側を編集させない）', () => {
  const F = require('./bughunt_d_fuzzer.js');
  const r = F.runSeed(6119, { steps: 60, busy: 0.1, partial: 0.15, fail: 0.1, strictImp: true, strictComments: true, startTab: '障害物',
    ops: ['impOpen', 'impOpen', 'impAdd', 'impSave', 'impSave', 'impResolve', 'impResolve', 'impCancelResolve', 'impClose',
      'toastAction', 'toastAction', 'timers', 'pending', 'pending', 'commentAdd', 'commentDelete', 'reload', 'escape'] });
  assert.deepEqual(r.error ? [r.error.stack] : r.violations, []);
});

// --- M3: 盤面を描き直しても、カードの焦点を失わない ---

function cardEl(h, id) {
  const out = [];
  (function walk(n) { (n.children || []).forEach(function (c) { if (c.classList && c.classList.contains('card') && c.dataset.id === id) out.push(c); walk(c); }); })(h.sandbox.document.getElementById('board'));
  return out[0] || null;
}
const focusedId = (h) => { const a = h.sandbox.document.activeElement; return a && a.dataset ? a.dataset.id || null : null; };

test('M3: カードに焦点がある間に盤面を描き直しても、同じ ID のカードへ焦点を戻す', () => {
  const h = boot({ New: [A, B] });
  cardEl(h, 'PBI-002').focus();
  h.drag('PBI-001', 'Ready');   // 描き直し（楽観的な移動）
  assert.equal(focusedId(h), 'PBI-002', '描き直しで焦点が落ちた');
  last(h).handlers.success({ ok: true, board: h.boardOf(cols({ New: [B], Ready: [{ ...A, updated_at: 'T2' }] })) });
  assert.equal(focusedId(h), 'PBI-002', '応答の描き直しで焦点が落ちた');
});

test('M3: 焦点のあるカードそのものが動いても、そのカードに焦点を戻す。消えたら戻さない', () => {
  const h = boot({ New: [A, B] });
  cardEl(h, 'PBI-001').focus();
  h.drag('PBI-001', 'Ready');
  assert.equal(focusedId(h), 'PBI-001');
  last(h).handlers.success({ ok: true, board: h.boardOf(cols({ New: [B] })) });   // 別の経路で消えていた
  assert.equal(h.sandbox.document.activeElement, null);
});

test('M3: 焦点が盤面の外にあれば、描き直しで焦点を奪わない', () => {
  const h = boot({ New: [A, B] });
  h.sandbox.document.getElementById('reload').focus();
  h.drag('PBI-001', 'Ready');
  assert.equal(h.sandbox.document.activeElement, h.sandbox.document.getElementById('reload'));
});
