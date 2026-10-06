'use strict';
// バグ探し 2巡目 H2（画面・応答の大きさ）の再現と修正の固定。
// 元の再現は gas/tests/bughunt2_P_failing.test.js.txt（BUG-P2a / P2b / P4）。

const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./bughunt2_P_support.js');
const { createHarness } = require('./kanban_harness.js');

const plain = function (v) { return JSON.parse(JSON.stringify(v)); };

// ---------------------------------------------------------------------------
// P2: ビューの応答に全コメントを載せない。件数だけを載せ、本文は対象ごとに取りに行く
// ---------------------------------------------------------------------------

test('BUG-P2a. コメント 6,000 件でも、盤面の応答はコメント無しの 3 倍未満', () => {
  const none = S.createCtx(S.standardFiles(300, null));
  const many = S.createCtx(S.standardFiles(300, 6000, { bodyChars: 200 }));
  const base = S.payloadBytes(none.ctx.apiGetView('board'));
  const big = S.payloadBytes(many.ctx.apiGetView('board'));
  assert.ok(big < 3 * base, '盤面の応答 ' + base + ' バイト → ' + big + ' バイト（' + (big / base).toFixed(1) + ' 倍）');
});

test('BUG-P2b. コメントを1件送った応答は、その対象のコメントだけ（6,000 件あっても 200KB 未満）', () => {
  const c = S.createCtx(S.standardFiles(300, 6000, { bodyChars: 200 }));
  const r = c.ctx.apiAddComment(S.pid(1), 'こんにちは');
  assert.equal(r.ok, true);
  const bytes = S.payloadBytes(r);
  assert.ok(bytes < 200000, '書き込みの応答が ' + bytes + ' バイト');
});

function smallFiles() {
  const f = S.standardFiles(3, null);
  f['comments.csv'] = S.COMMENT_HEADER + '\n'
    + 'CMT-0000000a,PBI-00001,b@example.com,2026-01-01 00:00:02,後\n'
    + 'CMT-0000000b,PBI-00001,a@example.com,2026-01-01 00:00:01,先\n'
    + 'CMT-0000000c,PBI-00002,b@example.com,2026-01-01 00:00:03,別\n'
    + 'CMT-0000000d,IMP-001,a@example.com,2026-01-01 00:00:04,障害物\n';
  return f;
}

test('P2: apiGetView（board / list / impediment）は commentCounts だけを載せ、comments を載せない', () => {
  const c = S.createCtx(smallFiles());
  ['board', 'list', 'impediment'].forEach(function (name) {
    const v = plain(c.ctx.apiGetView(name));
    assert.equal(v.ok, true, name);
    assert.equal(v.comments, undefined, name + ' が comments を載せている');
    assert.deepEqual(v.commentCounts, { 'PBI-00001': 2, 'PBI-00002': 1, 'IMP-001': 1 }, name);
  });
});

test('P2: 障害物の書き込みの応答も commentCounts だけを載せる', () => {
  const c = S.createCtx(smallFiles());
  const r = plain(c.ctx.apiCreateImpediment({ title: '新しい', description: '', reported_by: 'x', sprint: '' }));
  assert.equal(r.ok, true);
  assert.equal(r.comments, undefined);
  assert.deepEqual(r.commentCounts, { 'PBI-00001': 2, 'PBI-00002': 1, 'IMP-001': 1 });
});

test('P2: apiGetComments(targetId) はその対象のコメントを古い順に mine 付きで返す。形の不正は invalid', () => {
  const c = S.createCtx(smallFiles());
  const r = plain(c.ctx.apiGetComments('PBI-00001'));
  assert.equal(r.ok, true);
  assert.deepEqual(r.comments.map(function (x) { return [x.id, x.body, x.mine]; }),
    [['CMT-0000000b', '先', true], ['CMT-0000000a', '後', false]]);
  assert.deepEqual(plain(c.ctx.apiGetComments(' PBI-00003 ')), { ok: true, comments: [] });
  assert.equal(plain(c.ctx.apiGetComments('x')).reason, 'invalid');
  assert.equal(plain(c.ctx.apiGetComments(null)).reason, 'invalid');
  // ファイルが無くても読み取りは空（他の表示と同じ扱い）。
  const f = smallFiles();
  delete f['comments.csv'];
  assert.deepEqual(plain(S.createCtx(f).ctx.apiGetComments('PBI-00001')), { ok: true, comments: [] });
});

test('P2: コメントの書き込みの応答は、その対象の comments と count だけ（targetId 付き）', () => {
  const c = S.createCtx(smallFiles());
  const add = plain(c.ctx.apiAddComment('PBI-00002', '足す'));
  assert.equal(add.ok, true);
  assert.equal(add.targetId, 'PBI-00002');
  assert.equal(add.count, 2);
  assert.deepEqual(add.comments.map(function (x) { return x.body; }), ['別', '足す']);
  const del = plain(c.ctx.apiDeleteComment('CMT-0000000b'));
  assert.equal(del.ok, true);
  assert.equal(del.targetId, 'PBI-00001');
  assert.equal(del.count, 1);
  assert.deepEqual(del.comments.map(function (x) { return x.id; }), ['CMT-0000000a']);
  const back = plain(c.ctx.apiRestoreComment(del.removed));
  assert.equal(back.ok, true);
  assert.equal(back.targetId, 'PBI-00001');
  assert.equal(back.count, 2);
  // 失敗（他人のコメント）でも、対象が分かればその対象の一覧を返す。
  const no = plain(c.ctx.apiDeleteComment('CMT-0000000a'));
  assert.equal(no.reason, 'forbidden');
  assert.equal(no.targetId, 'PBI-00001');
  assert.equal(no.count, 2);
  // 対象の分からない失敗（見つからない）は一覧を返さない。
  const nf = plain(c.ctx.apiDeleteComment('CMT-ffffffff'));
  assert.equal(nf.reason, 'not_found');
  assert.equal(nf.comments, undefined);
});

// --- 画面 ---

const COLS = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' }, { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] }, { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
function cmt(id, target, author, at, body, mine) {
  return { id: id, target_id: target, author: author, created_at: at, body: body, mine: !!mine };
}
const C1 = cmt('CMT-00000001', 'PBI-001', 'maya@example.com', '2026-10-06 09:00:00', '先', false);
const C2 = cmt('CMT-00000002', 'PBI-001', 'me@example.com', '2026-10-06 10:00:00', '後', true);

function bootBoard(counts) {
  const h = createHarness(COLS);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(COLS),
    summary: { byStatus: [], total: { count: 2, points: 0 } }, commentCounts: counts || { 'PBI-001': 2 }, sprintChoices: [] });
  return h;
}
const pendingOf = function (h, method) { return h.calls.filter(function (c) { return c.method === method; }); };
const ids = function (h, host) { return h.commentsIn(host).map(function (c) { return c.id; }); };
function textIn(h, hostId) {
  const t = [];
  (function w(e) { if (e.textContent) t.push(e.textContent); (e.children || []).forEach(w); })(h.sandbox.document.getElementById(hostId));
  return t.join(' ');
}

test('P2: カードの件数は commentCounts から出る。パネルを開くと apiGetComments で取り、読み込み中を出す', () => {
  const h = bootBoard();
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2');
  assert.equal(h.cardCommentCountOf('PBI-002'), null);
  h.openCard('PBI-001');
  const got = pendingOf(h, 'apiGetComments');
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].args, ['PBI-001']);
  assert.match(textIn(h, 'panel-comments'), /読み込んでいます/);
  got[0].handlers.success({ ok: true, comments: [C1, C2] });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001', 'CMT-00000002']);
  assert.doesNotMatch(textIn(h, 'panel-comments'), /読み込んでいます/);
});

test('P2: 遅れて届いた前の対象の応答は捨てる（リクエスト番号）', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  const first = pendingOf(h, 'apiGetComments')[0];
  h.openCard('PBI-002');
  const second = pendingOf(h, 'apiGetComments')[1];
  second.handlers.success({ ok: true, comments: [] });
  first.handlers.success({ ok: true, comments: [C1, C2] });
  assert.deepEqual(ids(h, 'panel-comments'), [], '前の対象のコメントが出た');
  assert.match(textIn(h, 'panel-comments'), /まだコメントはありません/);
});

test('P2: 取得の失敗は節に出す（一覧は空のまま、入力はできる）', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  pendingOf(h, 'apiGetComments')[0].handlers.failure(new Error('切れた'));
  assert.match(textIn(h, 'panel-comments'), /コメントを読み込めませんでした: 切れた/);
  assert.equal(h.commentFormOf('panel-comments').inputDisabled, false);
});

test('P2: コメントの追加で件数が応答の一覧に追従する', () => {
  const h = bootBoard();
  h.openCard('PBI-002');
  pendingOf(h, 'apiGetComments')[0].handlers.success({ ok: true, comments: [] });
  h.setCommentInput('panel-comments', '一つ目');
  h.clickCommentSend('panel-comments');
  const added = cmt('CMT-00000003', 'PBI-002', 'me@example.com', '2026-10-06 11:00:00', '一つ目', true);
  pendingOf(h, 'apiAddComment')[0].handlers.success({ ok: true, comment: added, targetId: 'PBI-002', comments: [added], count: 1 });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000003']);
  assert.equal(h.cardCommentCountOf('PBI-002'), 'コメント 1');
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 2', '他の対象の件数が変わった');
});

test('P2: 取得の応答（追加より前の写し）が追加の応答より後に届いても、足したコメントは消えない', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  const fetch = pendingOf(h, 'apiGetComments')[0];
  h.setCommentInput('panel-comments', '足す');
  h.clickCommentSend('panel-comments');
  const added = cmt('CMT-00000003', 'PBI-001', 'me@example.com', '2026-10-06 11:00:00', '足す', true);
  pendingOf(h, 'apiAddComment')[0].handlers.success({ ok: true, comment: added, targetId: 'PBI-001', comments: [C1, C2, added], count: 3 });
  fetch.handlers.success({ ok: true, comments: [C1, C2] });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001', 'CMT-00000002', 'CMT-00000003']);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 3');
});

test('P2: 削除した id は、取得の応答（削除前の写し）が後から届いても出ない', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  const fetch1 = pendingOf(h, 'apiGetComments')[0];
  fetch1.handlers.success({ ok: true, comments: [C1, C2] });
  h.clickCommentDelete('panel-comments', 'CMT-00000002');
  // 削除の送信中にパネルを開き直す（取り直しは削除より前に処理される）。
  h.openCard('PBI-001');
  const fetch2 = pendingOf(h, 'apiGetComments')[0];
  pendingOf(h, 'apiDeleteComment')[0].handlers.success({ ok: true, removed: C2, targetId: 'PBI-001', comments: [C1], count: 1 });
  fetch2.handlers.success({ ok: true, comments: [C1, C2] });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001']);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 1');
});

