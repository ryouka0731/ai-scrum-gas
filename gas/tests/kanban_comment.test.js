const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

/**
 * パネルのコメント節と、カード・障害物の表の件数を、画面の操作から辿って検査する。
 * 判定は描画された DOM から読む（commentsIn / commentFormOf 等）。
 */

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                           { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];

function cmt(id, target, author, at, body, mine) {
  return { id: id, target_id: target, author: author, created_at: at, body: body, mine: !!mine };
}

const C1 = cmt('CMT-00000001', 'PBI-001', 'maya@example.com', '2026-10-06 09:00:00', '先に書いた', false);
const C2 = cmt('CMT-00000002', 'PBI-001', 'me@example.com', '2026-10-06 10:00:00', '後で書いた', true);
const COMMENTS = { 'PBI-001': [C1, C2] };

const latest = (h) => h.calls[h.calls.length - 1];

/** 初期読み込み（盤面）まで済ませる。comments を載せる。 */
function ready(comments) {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({
    ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 2, points: 0 } },
    comments: comments === undefined ? COMMENTS : comments,
  });
  return h;
}

test('盤面の応答の comments が、カードを開くと古い順に出る。自分のものだけ削除が出る', () => {
  const h = ready();
  h.openCard('PBI-001');
  assert.equal(h.hiddenOf('panel-comments'), false);
  assert.deepEqual(h.commentsIn('panel-comments'), [
    { id: 'CMT-00000001', author: 'maya', body: '先に書いた', canDelete: false },
    { id: 'CMT-00000002', author: 'me', body: '後で書いた', canDelete: true },
  ]);
  // コメントの無い対象では一覧が空（他の対象のものを出さない）。
  h.openCard('PBI-002');
  assert.deepEqual(h.commentsIn('panel-comments'), []);
});

test('新規作成のパネルではコメントの節が隠れている', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickAdd('Ready');
  assert.equal(h.hiddenOf('panel-comments'), true);
  assert.deepEqual(h.commentsIn('panel-comments'), [], '前のカードのコメントが残っている');
});

test('空白だけでは送れない。文字を入れると送れ、送信中は入力が塞がる', () => {
  const h = ready();
  h.openCard('PBI-002');
  assert.equal(h.commentFormOf('panel-comments').sendDisabled, true, '空なのに押せる');
  h.setCommentInput('panel-comments', '  \n ');
  assert.equal(h.commentFormOf('panel-comments').sendDisabled, true, '空白だけなのに押せる');
  h.setCommentInput('panel-comments', '確認しました');
  assert.equal(h.commentFormOf('panel-comments').sendDisabled, false);
  const before = h.calls.length;
  h.clickCommentSend('panel-comments');
  assert.equal(h.calls.length, before + 1);
  const c = latest(h);
  assert.equal(c.method, 'apiAddComment');
  assert.deepEqual(c.args, ['PBI-002', '確認しました']);
  const form = h.commentFormOf('panel-comments');
  assert.equal(form.inputDisabled, true, '送信中に入力が塞がっていない');
  assert.equal(form.sendDisabled, true, '送信中に送信ボタンが押せる');
});

test('追加の応答で一覧が増え、入力が空になる。失敗では文言が出て入力は残る', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.setCommentInput('panel-comments', '一つ目');
  h.clickCommentSend('panel-comments');
  const added = cmt('CMT-00000003', 'PBI-002', 'me@example.com', '2026-10-06 11:00:00', '一つ目', true);
  latest(h).handlers.success({ ok: true, comment: added,
    comments: Object.assign({}, COMMENTS, { 'PBI-002': [added] }) });
  assert.deepEqual(h.commentsIn('panel-comments').map(function (c) { return c.id; }), ['CMT-00000003']);
  let form = h.commentFormOf('panel-comments');
  assert.equal(form.inputValue, '');
  assert.equal(form.inputDisabled, false);

  h.setCommentInput('panel-comments', '二つ目');
  h.clickCommentSend('panel-comments');
  latest(h).handlers.success({ ok: false, reason: 'busy', message: '混み合っています。' });
  form = h.commentFormOf('panel-comments');
  assert.equal(form.message, '混み合っています。');
  assert.ok(form.messageClass.indexOf('error') !== -1);
  assert.equal(form.inputValue, '二つ目', '失敗したのに入力が消えた');
  assert.equal(form.inputDisabled, false);
  assert.equal(form.sendDisabled, false);
  assert.equal(h.commentsIn('panel-comments').length, 1, '失敗で一覧が変わった');
});

test('削除は apiDeleteComment を呼び、成功で通知が出る。取り消すと apiRestoreComment を呼ぶ', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  const c = latest(h);
  assert.equal(c.method, 'apiDeleteComment');
  assert.deepEqual(c.args, ['CMT-00000002']);
  const removed = { id: C2.id, target_id: C2.target_id, author: C2.author, created_at: C2.created_at, body: C2.body };
  c.handlers.success({ ok: true, removed: removed, comments: { 'PBI-001': [C1] } });
  assert.deepEqual(h.commentsIn('panel-comments').map(function (x) { return x.id; }), ['CMT-00000001']);
  assert.equal(h.hiddenOf('toast'), false);
  assert.equal(h.textOf('toast-text'), 'コメントを削除しました。');
  h.click('toast-undo');
  const r = latest(h);
  assert.equal(r.method, 'apiRestoreComment');
  assert.deepEqual(r.args, [removed]);
  r.handlers.success({ ok: true, comments: COMMENTS });
  assert.equal(h.commentsIn('panel-comments').length, 2);
  // 他人のコメントには削除が無いので押せない。
  assert.throws(function () { h.clickCommentDelete('panel-comments', 'CMT-00000001'); }, /削除/);
});

test('書き込みが2つ飛び、新しい応答→古い応答の順に届くと、新しい方の一覧のまま', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  const first = latest(h);
  h.openCard('PBI-002');
  h.setCommentInput('panel-comments', '別の対象へ');
  h.clickCommentSend('panel-comments');
  const second = latest(h);
  const added = cmt('CMT-00000003', 'PBI-002', 'me@example.com', '2026-10-06 11:00:00', '別の対象へ', true);
  const newest = { 'PBI-001': [C1], 'PBI-002': [added] };
  second.handlers.success({ ok: true, comment: added, comments: newest });
  // 古い応答（削除の処理時点の全体。PBI-002 の追加をまだ含まない）。
  first.handlers.success({ ok: true, removed: C2, comments: { 'PBI-001': [C1] } });
  assert.deepEqual(h.commentsIn('panel-comments').map(function (x) { return x.id; }), ['CMT-00000003'],
    '古い応答で一覧が戻った');
  h.openCard('PBI-001');
  assert.deepEqual(h.commentsIn('panel-comments').map(function (x) { return x.id; }), ['CMT-00000001']);
});

const IMP = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' };
const IMP_DONE = Object.assign({}, IMP, { id: 'IMP-001', title: '片付いた', status: 'Resolved' });
const IMP_COMMENTS = {
  'IMP-002': [cmt('CMT-0000000a', 'IMP-002', 'me@example.com', '2026-10-06 09:00:00', '見ています', true)],
  'IMP-001': [cmt('CMT-0000000b', 'IMP-001', '', '2026-10-05 09:00:00', 'x', false),
              cmt('CMT-0000000c', 'IMP-001', 'ken@example.com', '2026-10-05 10:00:00', 'y', false)],
};

function onImpediment() {
  const h = ready();
  h.clickTab('障害物');
  latest(h).handlers.success({ ok: true, name: 'impediment',
    view: { columns: [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }],
      open: [IMP], resolved: [IMP_DONE], pending: [] },
    summary: { open: 1, resolved: 1, pending: 0 }, sprintChoices: [], comments: IMP_COMMENTS });
  return h;
}

test('障害物のパネルにも同じ節が出て、IMP の ID でコメントを送る', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel-comments'), false);
  assert.deepEqual(h.commentsIn('imp-panel-comments'), [
    { id: 'CMT-0000000a', author: 'me', body: '見ています', canDelete: true },
  ]);
  h.setCommentInput('imp-panel-comments', '対応します');
  h.clickCommentSend('imp-panel-comments');
  assert.equal(latest(h).method, 'apiAddComment');
  assert.deepEqual(latest(h).args, ['IMP-002', '対応します']);
  // 新規作成中は節を出さない。
  h.clickImpAdd();
  assert.equal(h.hiddenOf('imp-panel-comments'), true);
});

test('カードと障害物の表に件数が出る。コメントの無いものには出ない', () => {
  const h = ready();
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2');
  assert.equal(h.cardCommentCountOf('PBI-002'), null);
  h.clickTab('障害物');
  latest(h).handlers.success({ ok: true, name: 'impediment',
    view: { columns: [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }],
      open: [IMP], resolved: [IMP_DONE], pending: [] },
    summary: { open: 1, resolved: 1, pending: 0 }, sprintChoices: [], comments: IMP_COMMENTS });
  // 未解決の IMP-002 が1件、解決済の IMP-001 が2件（DOM 順）。
  assert.deepEqual(h.commentCountsIn('table-view'), ['コメント 1', 'コメント 2']);
  h.clickImpRow('IMP-002');
  h.clickTab('やること');
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: null, comments: IMP_COMMENTS });
  assert.equal(h.cardCommentCountOf('PBI-001'), null, '件数が最新の comments に追従していない');
});

test('本文の改行が保たれ、タグは文字のまま出る。書いた人が空なら「不明」', () => {
  const body = '1行目\n2行目\n<b>x</b>';
  const h = ready({ 'PBI-002': [cmt('CMT-00000009', 'PBI-002', '', '2026-10-06 09:00:00', body, false)] });
  h.openCard('PBI-002');
  const got = h.commentsIn('panel-comments');
  assert.equal(got.length, 1);
  assert.equal(got[0].body, body);
  assert.equal(got[0].author, '不明');
  assert.equal(h.commentBodyTagsIn('panel-comments'), 0, '本文の中に要素が作られた');
});

test('comments を持たない応答（完了のビュー・PBI の保存）では一覧も件数も消えない', () => {
  const h = ready();
  h.clickView('完了');
  latest(h).handlers.success({ ok: true, name: 'done', view: { columns: [], rows: [] }, summary: null });
  h.clickView('盤面');
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2');
  h.openCard('PBI-001');
  h.click('panel-save');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  h.openCard('PBI-001');
  assert.equal(h.commentsIn('panel-comments').length, 2);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2');
});

/** 未応答の呼び出しのうち、その API のものをちょうど1件返す。 */
function callOf(h, method) {
  const hit = h.calls.filter(function (c) { return c.method === method; });
  assert.equal(hit.length, 1, method + ' の未応答が ' + hit.length + ' 件');
  return hit[0];
}

test('追加の送信中に届いた読み直し（追加を含まない）で、追加の応答が捨てられない', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.setCommentInput('panel-comments', '送信中');
  h.clickCommentSend('panel-comments');
  h.click('reload');
  callOf(h, 'apiGetView').handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: null, comments: COMMENTS });
  const added = cmt('CMT-00000003', 'PBI-002', 'me@example.com', '2026-10-06 11:00:00', '送信中', true);
  callOf(h, 'apiAddComment').handlers.success({ ok: true, comment: added,
    comments: Object.assign({}, COMMENTS, { 'PBI-002': [added] }) });
  assert.deepEqual(h.commentsIn('panel-comments').map(function (c) { return c.id; }), ['CMT-00000003'],
    '送ったコメントが消えた（入力は空になるので、もう一度送られてしまう）');
  assert.equal(h.cardCommentCountOf('PBI-002'), 'コメント 1');
});

test('削除の送信中に届いた読み直し（削除前の写し）で、削除の応答が捨てられない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  h.click('reload');
  callOf(h, 'apiGetView').handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: null, comments: COMMENTS });
  callOf(h, 'apiDeleteComment').handlers.success({ ok: true, removed: C2, comments: { 'PBI-001': [C1] } });
  assert.deepEqual(h.commentsIn('panel-comments').map(function (c) { return c.id; }), ['CMT-00000001'],
    '消したコメントが戻った');
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 1');
});

const IMP_VIEW_COLUMNS = [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }];
function impWriteResponse(open, comments, extra) {
  return Object.assign({ ok: true,
    view: { columns: IMP_VIEW_COLUMNS, open: open, resolved: [IMP_DONE], pending: [] },
    summary: { open: open.length, resolved: 1, pending: 0 }, sprintChoices: [], comments: comments }, extra || {});
}

test('障害物の書き込みの応答の comments は、コメントの書き込みと競らなければ件数と開いている節を差し替える', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const other = cmt('CMT-0000000d', 'IMP-002', 'ken@example.com', '2026-10-06 10:00:00', '別の人', false);
  const fresh = Object.assign({}, IMP_COMMENTS, { 'IMP-002': IMP_COMMENTS['IMP-002'].concat([other]) });
  // 競合（パネルは開いたまま）。応答はビューとコメントの全体を運ぶ。
  callOf(h, 'apiUpdateImpediment').handlers.success(impWriteResponse([IMP], fresh,
    { ok: false, reason: 'conflict', message: '他の変更が先に入っています。' }));
  assert.equal(h.hiddenOf('imp-panel'), false);
  assert.deepEqual(h.commentsIn('imp-panel-comments').map(function (c) { return c.id; }),
    ['CMT-0000000a', 'CMT-0000000d']);
  assert.deepEqual(h.commentCountsIn('table-view'), ['コメント 2', 'コメント 2']);
});

test('コメントの送信中に出した障害物の書き込みの応答の comments は使わない', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setCommentInput('imp-panel-comments', '送信中');
  h.clickCommentSend('imp-panel-comments');
  h.click('imp-panel-save');
  // 障害物の写しは、送信中のコメントより前に読まれたかもしれない（ここでは IMP-002 のコメントが無い）。
  const stale = { 'IMP-001': IMP_COMMENTS['IMP-001'] };
  callOf(h, 'apiUpdateImpediment').handlers.success(impWriteResponse([IMP], stale,
    { ok: false, reason: 'conflict', message: '他の変更が先に入っています。' }));
  assert.deepEqual(h.commentsIn('imp-panel-comments').map(function (c) { return c.id; }), ['CMT-0000000a'],
    '競りうる写しで一覧が戻った');
  assert.deepEqual(h.commentCountsIn('table-view'), ['コメント 1', 'コメント 2']);
  const added = cmt('CMT-0000000e', 'IMP-002', 'me@example.com', '2026-10-06 11:00:00', '送信中', true);
  callOf(h, 'apiAddComment').handlers.success({ ok: true, comment: added,
    comments: Object.assign({}, IMP_COMMENTS, { 'IMP-002': IMP_COMMENTS['IMP-002'].concat([added]) }) });
  assert.deepEqual(h.commentsIn('imp-panel-comments').map(function (c) { return c.id; }),
    ['CMT-0000000a', 'CMT-0000000e']);
});

// ---------------------------------------------------------------------------
// 最終レビュー I1: 古い（発行順で負けた）応答でも、その書き込み自身の操作は反映する
// ---------------------------------------------------------------------------

const ids = function (h, hostId) { return h.commentsIn(hostId).map(function (c) { return c.id; }); };

test('削除(#1)→追加(#2)。#2 の応答（削除前の写し）が先に届き、#1 が後でも、消したものは消え、足したものは残る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  const del = callOf(h, 'apiDeleteComment');
  h.setCommentInput('panel-comments', '追加');
  h.clickCommentSend('panel-comments');
  const add = callOf(h, 'apiAddComment');
  const added = { id: 'CMT-00000003', target_id: 'PBI-001', author: 'me@example.com',
    created_at: '2026-10-06 11:00:00', body: '追加' };
  // サーバは #2 を先に処理した（写しにはまだ C2 が残っている）。
  add.handlers.success({ ok: true, comment: added,
    comments: { 'PBI-001': [C1, C2, Object.assign({ mine: true }, added)] } });
  del.handlers.success({ ok: true, removed: C2, comments: { 'PBI-001': [C1] } });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001', 'CMT-00000003'],
    '自分の削除が古い応答と一緒に捨てられた');
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2');
});

test('追加(#1)→追加(#2)。#2 の応答（#1 を含まない写し）が先でも、#1 の応答で足したものが出る', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.setCommentInput('panel-comments', '一つ目');
  h.clickCommentSend('panel-comments');
  const first = callOf(h, 'apiAddComment');
  h.openCard('PBI-001');
  h.setCommentInput('panel-comments', '二つ目');
  h.clickCommentSend('panel-comments');
  const second = h.calls.filter(function (c) { return c.method === 'apiAddComment'; })[1];
  const a1 = { id: 'CMT-00000003', target_id: 'PBI-002', author: 'me@example.com',
    created_at: '2026-10-06 11:00:00', body: '一つ目' };
  const a2 = { id: 'CMT-00000004', target_id: 'PBI-001', author: 'me@example.com',
    created_at: '2026-10-06 11:00:01', body: '二つ目' };
  second.handlers.success({ ok: true, comment: a2,
    comments: { 'PBI-001': [C1, C2, Object.assign({ mine: true }, a2)] } });
  first.handlers.success({ ok: true, comment: a1,
    comments: { 'PBI-001': [C1, C2], 'PBI-002': [Object.assign({ mine: true }, a1)] } });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001', 'CMT-00000002', 'CMT-00000004']);
  assert.equal(h.cardCommentCountOf('PBI-002'), 'コメント 1', '先に送った追加が消えた');
  h.openCard('PBI-002');
  assert.deepEqual(h.commentsIn('panel-comments'), [
    { id: 'CMT-00000003', author: 'me', body: '一つ目', canDelete: true },
  ]);
});

test('取り消し（戻す）の応答が古くても、戻したコメントは作成日時の順に入る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  const removed = { id: C2.id, target_id: C2.target_id, author: C2.author, created_at: C2.created_at, body: C2.body };
  callOf(h, 'apiDeleteComment').handlers.success({ ok: true, removed: removed, comments: { 'PBI-001': [C1] } });
  h.click('toast-undo');
  const restore = callOf(h, 'apiRestoreComment');
  h.setCommentInput('panel-comments', '後から');
  h.clickCommentSend('panel-comments');
  const added = cmt('CMT-00000003', 'PBI-001', 'me@example.com', '2026-10-06 11:00:00', '後から', true);
  // 追加が先に処理された（戻す前の写し）。戻す応答は写しを運ばない（rows が変わらない場合など）。
  callOf(h, 'apiAddComment').handlers.success({ ok: true, comment: added, comments: { 'PBI-001': [C1, added] } });
  restore.handlers.success({ ok: true, comments: { 'PBI-001': [C1] } });
  assert.deepEqual(h.commentsIn('panel-comments'), [
    { id: 'CMT-00000001', author: 'maya', body: '先に書いた', canDelete: false },
    { id: 'CMT-00000002', author: 'me', body: '後で書いた', canDelete: true },
    { id: 'CMT-00000003', author: 'me', body: '後から', canDelete: true },
  ]);
});

// ---------------------------------------------------------------------------
// 最終レビュー I3: コメントの書き込みは、読み込み中の表を「他の変更が入った」で捨てさせない
// ---------------------------------------------------------------------------

test('表の読み込み中にコメントの追加が成功しても、表は描かれ、一覧は追加の内容のまま', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setCommentInput('imp-panel-comments', '読み込み中');
  h.clickCommentSend('imp-panel-comments');
  h.click('reload');
  const load = callOf(h, 'apiGetView');
  const added = cmt('CMT-0000000e', 'IMP-002', 'me@example.com', '2026-10-06 11:00:00', '読み込み中', true);
  callOf(h, 'apiAddComment').handlers.success({ ok: true, comment: added,
    comments: Object.assign({}, IMP_COMMENTS, { 'IMP-002': IMP_COMMENTS['IMP-002'].concat([added]) }) });
  // 読み込みの写しは追加より前に読まれた。
  load.handlers.success({ ok: true, name: 'impediment',
    view: { columns: IMP_VIEW_COLUMNS, open: [IMP], resolved: [IMP_DONE], pending: [] },
    summary: { open: 1, resolved: 1, pending: 0 }, sprintChoices: [], comments: IMP_COMMENTS });
  assert.notEqual(h.textOf('message'), '読み込み中に他の変更が入りました。もう一度お試しください。');
  assert.equal(h.hiddenOf('table-view'), false);
  assert.deepEqual(h.commentCountsIn('table-view'), ['コメント 2', 'コメント 2'], '表が描かれていない、または古い件数');
  assert.deepEqual(ids(h, 'imp-panel-comments'), ['CMT-0000000a', 'CMT-0000000e'], '追加が読み込みの写しで消えた');
});

// ---------------------------------------------------------------------------
// 最終レビュー M1: 描き直しで入力欄を作り直さない（書きかけ・フォーカス・変換中を保つ）
// ---------------------------------------------------------------------------

test('一覧が描き直されても、入力欄は同じ要素のままで書きかけが残る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.setCommentInput('panel-comments', '書きかけ');
  const before = h.commentInputElement('panel-comments');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  callOf(h, 'apiDeleteComment').handlers.success({ ok: true, removed: C2, comments: { 'PBI-001': [C1] } });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001']);
  const after = h.commentInputElement('panel-comments');
  assert.equal(after, before, '入力欄が作り直された');
  assert.equal(after.value, '書きかけ');
  assert.equal(h.commentFormOf('panel-comments').sendDisabled, false);
  // 別の対象を開けば作り直す（前の書きかけを持ち込まない）。
  h.openCard('PBI-002');
  assert.equal(h.commentFormOf('panel-comments').inputValue, '');
});

// ---------------------------------------------------------------------------
// PR #7 レビュー: 取り消しの失敗は、コメント節が開いていればその節に出す
// ---------------------------------------------------------------------------

function deletedThenUndo() {
  const h = ready();
  h.openCard('PBI-001');
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  const removed = { id: C2.id, target_id: C2.target_id, author: C2.author, created_at: C2.created_at, body: C2.body };
  latest(h).handlers.success({ ok: true, removed: removed, comments: { 'PBI-001': [C1] } });
  h.click('toast-undo');
  return h;
}

test('取り消しが ok:false で失敗したら、開いているコメント節にエラーを出す', () => {
  const h = deletedThenUndo();
  callOf(h, 'apiRestoreComment').handlers.success({ ok: false, message: '戻せませんでした（理由）' });
  const form = h.commentFormOf('panel-comments');
  assert.equal(form.message, '戻せませんでした（理由）');
  assert.match(form.messageClass, /error/);
});

test('取り消しが通信失敗したら、開いているコメント節にエラーを出す', () => {
  const h = deletedThenUndo();
  callOf(h, 'apiRestoreComment').handlers.failure(new Error('切れた'));
  const form = h.commentFormOf('panel-comments');
  assert.equal(form.message, '取り消せませんでした: 切れた');
  assert.match(form.messageClass, /error/);
});

test('追加(#1)の応答が遅れ、その間に新しい写しで現れ、利用者が削除(#3)した。遅れた #1 の応答でも消したものは戻らない', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.setCommentInput('panel-comments', '一つ目');
  h.clickCommentSend('panel-comments');
  const first = callOf(h, 'apiAddComment');
  const a1 = { id: 'CMT-00000003', target_id: 'PBI-002', author: 'me@example.com',
    created_at: '2026-10-06 11:00:00', body: '一つ目' };
  const mine1 = Object.assign({ mine: true }, a1);
  // 別の書き込み(#2)の応答が、#1 を含む新しい写しを運ぶ。
  h.openCard('PBI-001');
  h.setCommentInput('panel-comments', '二つ目');
  h.clickCommentSend('panel-comments');
  const second = h.calls.filter(function (c) { return c.method === 'apiAddComment'; })[1];
  const a2 = { id: 'CMT-00000004', target_id: 'PBI-001', author: 'me@example.com',
    created_at: '2026-10-06 11:00:01', body: '二つ目' };
  second.handlers.success({ ok: true, comment: a2,
    comments: { 'PBI-001': [C1, C2, Object.assign({ mine: true }, a2)], 'PBI-002': [mine1] } });
  h.openCard('PBI-002');
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000003']);
  // 利用者が #1 を削除(#3)。成功。
  h.clickCommentDelete('panel-comments', 'CMT-00000003');
  callOf(h, 'apiDeleteComment').handlers.success({ ok: true, removed: mine1,
    comments: { 'PBI-001': [C1, C2, Object.assign({ mine: true }, a2)], 'PBI-002': [] } });
  assert.deepEqual(ids(h, 'panel-comments'), []);
  // 非常に遅れた #1 の応答（古い写し）が今届く。
  first.handlers.success({ ok: true, comment: a1,
    comments: { 'PBI-001': [C1, C2], 'PBI-002': [mine1] } });
  assert.deepEqual(ids(h, 'panel-comments'), [], '消したコメントが遅れた追加の応答で戻った');
  assert.equal(h.cardCommentCountOf('PBI-002'), null, '件数にも戻っている');
});
