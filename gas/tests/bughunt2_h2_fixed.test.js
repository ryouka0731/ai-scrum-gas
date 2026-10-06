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

// ---------------------------------------------------------------------------
// P4: 履歴パネルは最初の 50 件だけを描き、「さらに表示（残り N 件）」で次の 50 件
// ---------------------------------------------------------------------------

function bigHistory(n, lines) {
  const entries = [];
  for (let i = 0; i < n; i++) {
    const a = []; const b = [];
    for (let k = 0; k < lines; k++) { a.push('行' + k + ' v' + i); b.push('行' + k + ' v' + (i + 1)); }
    entries.push({ at: '2026-01-01 00:' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'),
      actor: 'a@example.com', action: 'update', field: 'description', before: a.join('\n'), after: b.join('\n') });
  }
  return entries;
}
function countNodes(h, id) {
  let nodes = 0;
  (function walk(e) { nodes++; (e.children || []).forEach(walk); })(h.sandbox.document.getElementById(id));
  return nodes;
}
function moreButton(h) {
  const hit = [];
  (function w(e) { if (e.classList && e.classList.contains('history-more')) hit.push(e); (e.children || []).forEach(w); })(
    h.sandbox.document.getElementById('panel-history'));
  return hit;
}
const items = function (h) {
  const hit = [];
  (function w(e) { if (e.classList && e.classList.contains('history-item')) hit.push(e); (e.children || []).forEach(w); })(
    h.sandbox.document.getElementById('panel-history'));
  return hit.length;
};

// 元の再現（BUG-P4）は「1回の描画で 50,000 ノード以下」としていた。裁定（50 件ずつ描く）では、
// 1件 = 前 500 行 + 後 500 行 の差分なので 50 件で約 50,300 ノードになる。上限は「50 件分」に合わせた
// （元の 20 万ノードの約 1/4）。
test('BUG-P4. 履歴 200 件 × 500 行の説明でも、最初の描画は 50 件まで（DOM は 50 件分で頭打ち）', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  pendingOf(h, 'apiGetHistory')[0].handlers.success({ ok: true, entries: bigHistory(200, 500) });
  assert.equal(items(h), 50);
  const nodes = countNodes(h, 'panel-history');
  assert.ok(nodes <= 50 * 1010 + 20, '履歴パネルの DOM ノード ' + nodes);
  const more = moreButton(h);
  assert.equal(more.length, 1);
  const t = [];
  (function w(e) { if (e.textContent) t.push(e.textContent); (e.children || []).forEach(w); })(more[0]);
  assert.match(t.join(''), /さらに表示（残り 150 件）/);
});

test('P4: 「さらに表示」で次の 50 件を足す。すべて出たらボタンは消え、省略の注記は最後に出る', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  pendingOf(h, 'apiGetHistory')[0].handlers.success({ ok: true, entries: bigHistory(120, 3), truncated: true });
  assert.equal(items(h), 50);
  assert.doesNotMatch(textIn(h, 'panel-history'), /これより前の履歴は省略しています/);
  moreButton(h)[0].listeners.click.forEach(function (fn) { fn({}); });
  assert.equal(items(h), 100);
  assert.match(textIn(h, 'panel-history'), /さらに表示（残り 20 件）/);
  moreButton(h)[0].listeners.click.forEach(function (fn) { fn({}); });
  assert.equal(items(h), 120);
  assert.equal(moreButton(h).length, 0);
  assert.match(textIn(h, 'panel-history'), /これより前の履歴は省略しています/);
});

test('P4: 50 件の境目で同じ時刻・同じ人の更新が分かれても、見出しは1つにまとまる', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  const entries = [];
  for (let i = 0; i < 52; i++) {
    entries.push({ at: i < 49 ? '2026-01-01 00:00:' + String(i).padStart(2, '0') : '2026-01-02 00:00:00',
      actor: 'a@example.com', action: 'update', field: i < 49 ? 'title' : ['title', 'priority', 'size'][i - 49], before: 'a', after: 'b' });
  }
  pendingOf(h, 'apiGetHistory')[0].handlers.success({ ok: true, entries: entries });
  moreButton(h)[0].listeners.click.forEach(function (fn) { fn({}); });
  const heads = [];
  (function w(e) { if (e.classList && e.classList.contains('history-head')) heads.push(e.textContent); (e.children || []).forEach(w); })(
    h.sandbox.document.getElementById('panel-history'));
  assert.equal(heads.length, 50);
  assert.equal(heads.filter(function (t) { return t.indexOf('2026-01-02') === 0; }).length, 1);
  assert.equal(items(h), 52);
});

test('P4b: 最後のページが前のまとまりへ続けて足すだけでも、焦点はそのまとまりへ移す（PR #11 cubic）', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  const entries = [];
  for (let i = 0; i < 52; i++) {
    entries.push({ at: i < 49 ? '2026-01-01 00:00:' + String(i).padStart(2, '0') : '2026-01-02 00:00:00',
      actor: 'a@example.com', action: 'update', field: i < 49 ? 'title' : ['title', 'priority', 'size'][i - 49], before: 'a', after: 'b' });
  }
  pendingOf(h, 'apiGetHistory')[0].handlers.success({ ok: true, entries: entries });
  const more = moreButton(h)[0];
  more.focus();   // 焦点を押したボタンに置く
  more.listeners.click.forEach(function (fn) { fn({}); });
  assert.equal(moreButton(h).length, 0);
  const active = h.sandbox.document.activeElement;
  assert.ok(active && active !== more && active.classList.contains('history-group'), '焦点が失われた: ' + (active && active.className));
  const head = active.children.filter(function (c) { return c.classList.contains('history-head'); })[0];
  assert.equal(head.textContent.indexOf('2026-01-02'), 0, '続けて足したまとまりではない');
});

// ---------------------------------------------------------------------------
// S1（画面側）: 解決の取り消しは行を送らない。通知 → { undoToken }、途中で止まった操作 → { pendingId }、
// 途中で止まった取り消しの「完了する」は同じ引数で送り直す
// ---------------------------------------------------------------------------

const IROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' };
const IRESOLVED = Object.assign({}, IROW, { status: 'Resolved', resolved_at: '2026-10-02', resolution: '再起動した' });
function impResp(open, resolved, pending) {
  return { ok: true, name: 'impediment',
    view: { columns: [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }], open: open, resolved: resolved || [], pending: pending || [] },
    summary: { open: open.length, resolved: (resolved || []).length, pending: (pending || []).length }, sprintChoices: [], commentCounts: {} };
}
function onImp(resp) {
  const h = createHarness(COLS);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(COLS), summary: null, commentCounts: {}, sprintChoices: [] });
  h.clickTab('障害物');
  pendingOf(h, 'apiGetView')[0].handlers.success(resp);
  return h;
}
const argsOf = function (c) { return JSON.parse(JSON.stringify(c.args)); };

test('S1: 解決の通知の「取り消す」は { undoToken } だけを送る。途中で止まったら「完了する」で同じ鍵を送り直す', () => {
  const h = onImp(impResp([IROW]));
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  pendingOf(h, 'apiResolveImpediment')[0].handlers.success(Object.assign(impResp([], [IRESOLVED]),
    { moved: IROW, resolvedRow: IRESOLVED, undoToken: 'tok-1' }));
  h.click('toast-undo');
  const undo = pendingOf(h, 'apiUnresolveImpediment')[0];
  assert.deepEqual(argsOf(undo), [{ undoToken: 'tok-1' }]);
  undo.handlers.success(Object.assign(impResp([IROW], [IRESOLVED], [{ id: 'IMP-002', open: IROW, resolved: IRESOLVED }]),
    { ok: false, reason: 'partial', message: '途中で止まりました' }));
  assert.equal(h.labelOf('toast-undo'), '完了する');
  h.click('toast-undo');
  assert.deepEqual(argsOf(pendingOf(h, 'apiUnresolveImpediment')[0]), [{ undoToken: 'tok-1' }]);
});

test('S1: 「途中で止まった操作」の「未解決に戻す」は { pendingId } だけを送り、途中で止まったら同じ引数で送り直す', () => {
  const pending = [{ id: 'IMP-002', open: IROW, resolved: IRESOLVED }];
  const h = onImp(impResp([], [IRESOLVED], pending));
  h.clickPending('IMP-002', 'unresolve');
  const c = pendingOf(h, 'apiUnresolveImpediment')[0];
  assert.deepEqual(argsOf(c), [{ pendingId: 'IMP-002' }]);
  c.handlers.success(Object.assign(impResp([], [IRESOLVED], pending), { ok: false, reason: 'partial', message: '途中で止まりました' }));
  assert.equal(h.labelOf('toast-undo'), '完了する');
  h.click('toast-undo');
  assert.deepEqual(argsOf(pendingOf(h, 'apiUnresolveImpediment')[0]), [{ pendingId: 'IMP-002' }]);
});

test('S1: 解決の応答に undoToken が無い（預けられなかった）ときは、取り消しの通知を出さない', () => {
  const h = onImp(impResp([IROW]));
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  pendingOf(h, 'apiResolveImpediment')[0].handlers.success(Object.assign(impResp([], [IRESOLVED]),
    { moved: IROW, resolvedRow: IRESOLVED, undoToken: null }));
  assert.equal(h.hiddenOf('toast'), true);
  assert.match(h.textOf('message'), /IMP-002「止まっている」を解決しました。/);
});

// --- PR #11 cubic: 件数が同じでも一覧が最新とは限らない。遅れた取得の応答で新しい件数を戻さない ---

const C3 = cmt('CMT-00000003', 'PBI-001', 'maya@example.com', '2026-10-06 11:00:00', '別の人が足した', false);
function reloadWith(h, counts) {
  h.click('reload');
  const v = pendingOf(h, 'apiGetView');
  v[v.length - 1].handlers.success({ ok: true, name: 'board', view: h.boardOf(COLS),
    summary: { byStatus: [], total: { count: 2, points: 0 } }, commentCounts: counts, sprintChoices: [] });
}

test('P2c: 開いている対象は、新しい件数が届けば件数が同じでも取り直す（他の人の削除と追加で件数が揃った場合）', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  pendingOf(h, 'apiGetComments')[0].handlers.success({ ok: true, comments: [C1, C2] });
  reloadWith(h, { 'PBI-001': 2 });   // サーバでは C1 が消え、C3 が足された
  const again = pendingOf(h, 'apiGetComments');
  assert.equal(again.length, 1, '開いている対象を取り直していない');
  assert.deepEqual(again[0].args, ['PBI-001']);
  again[0].handlers.success({ ok: true, comments: [C2, C3] });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000002', 'CMT-00000003']);
});

test('P2c: 新しい件数より前に出した取得の応答が後から届いても、件数を古い一覧の長さへ戻さない', () => {
  const h = bootBoard();
  h.openCard('PBI-001');
  const first = pendingOf(h, 'apiGetComments')[0];
  reloadWith(h, { 'PBI-001': 3 });
  first.handlers.success({ ok: true, comments: [C1, C2] });   // 件数より古い写し
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 3', '古い一覧で件数が戻った');
  const later = pendingOf(h, 'apiGetComments');
  assert.equal(later.length, 1, '新しい件数の後に取り直していない');
  later[0].handlers.success({ ok: true, comments: [C1, C2, C3] });
  assert.deepEqual(ids(h, 'panel-comments'), ['CMT-00000001', 'CMT-00000002', 'CMT-00000003']);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 3');
});
