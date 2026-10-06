'use strict';
// バグ探し 2巡目 P: 規模・性能（画面側。kanban.html を DOM シムで動かす）。
//
// 時間より「作った DOM ノードの数」「再描画の回数」「LCS の表のセル数」で縛る（機械に依らない）。
// 実時間は generous な上限だけ（シムは実ブラウザより遅い・速いの両方がありうる）。
// 実ブラウザでの実測は gas/tests/browser/bughunt2_P_browser.test.js。
// 現状で落ちる期待（履歴の DOM が20万ノードになる）は bughunt2_P_failing.test.js.txt。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');
const { buildListView } = require('../pure_view_backlog.js');
const { buildRoadmapView } = require('../pure_view_sprint.js');
const { buildImpedimentView } = require('../pure_view_impediment.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function ms(f) { const s = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - s) / 1e6; }
function countNodes(root) { let n = 0; (function w(e) { n++; (e.children || []).forEach(w); })(root); return n; }
function pid(i) { return 'PBI-' + String(i).padStart(4, '0'); }

function cards(n) {
  const cols = STATUSES.map((s) => ({ status: s, cards: [] }));
  for (let i = 1; i <= n; i++) {
    cols[i % 5].cards.push({ id: pid(i), title: 'タイトル' + i, description: 'd', acceptance_criteria: 'a', priority: 'Medium', size: '3', sprint: 'sprint001', updated_at: 'T' });
  }
  return cols;
}

/** counts は { target_id: 件数 }（ビューの応答は件数だけを運ぶ。本文はパネルを開いたときに取る）。 */
function boot(n, counts) {
  const cols = cards(n);
  const h = createHarness(cols);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: { columns: cols }, summary: { byStatus: [], total: { count: n, points: 0 } }, commentCounts: counts || {}, sprintChoices: [] });
  return { h, cols };
}

/** カードを開き、その対象のコメントの取得（apiGetComments）に list で答える。 */
function openWithComments(h, id, list) {
  h.openCard(id);
  const fetch = h.calls.filter((c) => c.method === 'apiGetComments' && c.args[0] === id);
  assert.equal(fetch.length, 1, 'コメントの取得が出ていない');
  fetch[0].handlers.success({ ok: true, comments: list });
}

function comments(n, target) {
  const l = [];
  for (let i = 0; i < n; i++) {
    l.push({ id: 'CMT-' + i.toString(16).padStart(8, 'f'), target_id: target, author: 'a@example.com',
      created_at: '2026-01-01 00:00:' + String(i % 60).padStart(2, '0'), body: '本文' + i + '\n2行目', mine: i % 2 === 0 });
  }
  return l;
}

/** 関数を包んで呼び出し回数を数える（kanban.html の関数は vm のグローバルなので差し替えられる）。 */
function countCalls(h, name) {
  const orig = h.sandbox[name];
  const box = { n: 0 };
  h.sandbox[name] = function () { box.n++; return orig.apply(this, arguments); };
  return box;
}

test('C1. 盤面: カード数に線形にノードが増え、1枚あたり 16 ノード以内', () => {
  const nodes = [500, 1000, 2000].map((n) => countNodes(boot(n).h.sandbox.document.getElementById('board')));
  nodes.forEach((x, i) => assert.ok(x / [500, 1000, 2000][i] <= 16, 'カード1枚あたり ' + x / [500, 1000, 2000][i]));
  // 線形: 2倍にして増えるのは 2倍（列の枠の固定ぶんを除く）。
  const per = (nodes[2] - nodes[1]) / 1000;
  assert.ok(Math.abs((nodes[1] - nodes[0]) / 500 - per) < 0.01, '増え方が一定でない: ' + nodes.join(','));
});

test('C2. 盤面: 1,000枚の初回描画と再描画が、シムで 3秒未満。再描画でノードが増えない', () => {
  const { h } = boot(1000);
  const root = h.sandbox.document.getElementById('board');
  const before = countNodes(root);
  const t = ms(() => { for (let i = 0; i < 5; i++) h.sandbox.render(h.sandbox.board); });
  assert.ok(t < 3000, '5回の再描画 ' + t.toFixed(0) + 'ms');
  assert.equal(countNodes(root), before, '再描画でノードが増えた（作り直しで古いものが残っている）');
});

test('C3. ドラッグ1回の描画回数: 楽観的更新と応答で、盤面の再構築は 2回以内（1,000枚）', () => {
  const { h } = boot(1000);
  const renders = countCalls(h, 'render');
  h.drag(pid(1), 'Done');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdateStatus');
  const moved = cards(1000);
  moved.forEach((c) => { c.cards = c.cards.filter((x) => x.id !== pid(1)); });
  moved[4].cards.push({ id: pid(1), title: 'タイトル1', description: 'd', acceptance_criteria: 'a', priority: 'Medium', size: '3', sprint: 'sprint001', updated_at: 'T2' });
  call.handlers.success({ ok: true, board: { columns: moved }, id: null, removed: null });
  assert.ok(renders.n <= 2, '再構築 ' + renders.n + ' 回');
});

test('C4. コメント1件の送信: 盤面の再構築は 2回以内。1,000枚・コメント 2,000件', () => {
  const { h } = boot(1000, { [pid(1)]: 2000 });
  openWithComments(h, pid(1), comments(2000, pid(1)));
  assert.equal(h.commentsIn('panel-comments').length, 2000, '前提: 2,000 件を描いている');
  const renders = countCalls(h, 'render');
  h.setCommentInput('panel-comments', 'こんにちは');
  h.clickCommentSend('panel-comments');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiAddComment');
  const sent = { id: 'CMT-eeeeeeee', target_id: pid(1), author: 'a@example.com', created_at: '2026-02-01 00:00:00', body: 'こんにちは', mine: true };
  const t = ms(() => call.handlers.success({ ok: true, comment: sent, targetId: pid(1), comments: comments(2000, pid(1)).concat([sent]), count: 2001 }));
  assert.equal(h.commentsIn('panel-comments').length, 2001, '応答の一覧を取り込んでいない');
  assert.ok(renders.n <= 2, '送信の応答で盤面を ' + renders.n + ' 回作り直した');
  assert.ok(t < 3000, '応答の処理 ' + t.toFixed(0) + 'ms');
});

test('C5. コメント節: 件数に線形のノード、1件あたり 10 ノード以内。何度描き直しても増えない', () => {
  const counts = [100, 500, 2000].map((n) => {
    const { h } = boot(20, { [pid(1)]: n });
    openWithComments(h, pid(1), comments(n, pid(1)));   // 取得に答えないと一覧は描かれない（PR #11 cubic）
    assert.equal(h.commentsIn('panel-comments').length, n, '前提: ' + n + ' 件を描いている');
    const host = h.sandbox.document.getElementById('panel-comments');
    const first = countNodes(host);
    for (let i = 0; i < 5; i++) h.sandbox.refreshOpenComments();
    assert.equal(countNodes(host), first, n + ' 件: 描き直しでノードが増えた');
    return first;
  });
  [100, 500, 2000].forEach((n, i) => assert.ok(counts[i] / n <= 10, n + ' 件で 1件あたり ' + counts[i] / n));
  const per = (counts[2] - counts[1]) / 1500;
  assert.ok(Math.abs((counts[1] - counts[0]) / 400 - per) < 0.05, '増え方が一定でない: ' + counts.join(','));
});

test('C6. 一覧: 行数に線形（1行あたり 10 ノード以内）。ロードマップ: 行 × (スプリント+2) のセルで、2,000 行 × 40 でもノードは行 × 44 以内', () => {
  const { h } = boot(10);
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: pid(i + 1), title: 't' + i, description: '', acceptance_criteria: 'a', priority: 'Medium', size: '3', status: 'New', sprint: 'sprint' + String(1 + (i % 40)).padStart(3, '0'), updated_at: 'T', created_at: 'T' }));
  const host = h.sandbox.document.getElementById('table-view');
  h.sandbox.renderTable(buildListView(rows(2000)));
  const list = countNodes(host);
  assert.ok(list / 2000 <= 10, '一覧 1行あたり ' + list / 2000);
  const vel = Array.from({ length: 40 }, (_, i) => ({ sprint: 'sprint' + String(i + 1).padStart(3, '0'), sprint_start: '2026-01-01', sprint_end: '2026-01-14' }));
  const t = ms(() => h.sandbox.renderTable(buildRoadmapView(rows(2000), vel)));
  const grid = countNodes(host);
  // 1行 = tr + ID + タイトル + 40 セル（空セルも作る）。それより大きく膨らまない。
  assert.ok(grid <= 2000 * (40 + 4) + 100, 'ロードマップのノード ' + grid);
  assert.ok(t < 5000, 'ロードマップ 2,000 行 × 40 の描画 ' + t.toFixed(0) + 'ms');
});

test('C7. 障害物の表: 解決済 1,000 件・未解決 100 件で、行ごとに 10 ノード以内（上限なしの全件表示である点を固定）', () => {
  const { h } = boot(10);
  const imp = (k, base, st) => Array.from({ length: k }, (_, i) => ({ id: 'IMP-' + String(base + i).padStart(5, '0'), title: 't', description: 'd', reported_by: 'a', reported_at: '2026-01-01', status: st, resolved_at: '', resolution: '', sprint: '' }));
  h.sandbox.renderTable(buildImpedimentView(imp(100, 1, 'open'), imp(1000, 10000, 'resolved')));
  const nodes = countNodes(h.sandbox.document.getElementById('table-view'));
  assert.ok(nodes / 1100 <= 10, '1行あたり ' + nodes / 1100);
});

function histEntries(nEntries, lines, opt) {
  const o = opt || {};
  const out = [];
  for (let i = 0; i < nEntries; i++) {
    const a = []; const b = [];
    for (let k = 0; k < lines; k++) { a.push('行' + k + ' v' + i); b.push(o.same ? '行' + k + ' v' + i : '行' + k + ' v' + (i + 1)); }
    if (o.same) b[0] = '変えた行';
    out.push({ at: '2026-01-01 00:' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'),
      actor: 'a@example.com', action: 'update', field: o.field || 'description', before: a.join('\n'), after: b.join('\n') });
  }
  return out;
}

function showHistory(entries) {
  const { h } = boot(5);
  h.openCard(pid(1));
  h.historyToggle('panel-history');
  const lcsCells = { n: 0, calls: 0 };
  const orig = h.sandbox.historyLineDiff;
  h.sandbox.historyLineDiff = function (before, after) {
    lcsCells.calls++;
    const a = String(before || '') === '' ? 0 : String(before).split(/\r?\n/).length;
    const b = String(after || '') === '' ? 0 : String(after).split(/\r?\n/).length;
    if (a <= 500 && b <= 500) lcsCells.n += (a + 1) * (b + 1);
    return orig.apply(this, arguments);
  };
  const call = h.calls[h.calls.length - 1];
  const t = ms(() => call.handlers.success({ ok: true, entries: entries }));
  const host = h.sandbox.document.getElementById('panel-history');
  const collect = (cls) => { const hit = []; (function w(e) { if (e.classList && e.classList.contains(cls)) hit.push(e); (e.children || []).forEach(w); })(host); return hit; };
  // 1回の描画（最初のページ）で描いた件数。「さらに表示」で残りを足す前に数える。
  const firstItems = collect('history-item').length;
  const firstLcs = { n: lcsCells.n, calls: lcsCells.calls };
  // 1件あたりのノードは、すべてのページを足してから全件で割る（PR #11 cubic）。
  let more;
  while ((more = collect('history-more')).length) more[0].listeners.click.forEach((fn) => fn({}));
  return { nodes: countNodes(host), items: collect('history-item').length, t, firstItems, lcs: firstLcs };
}

test('C8. 履歴: 200 件 × 短い値は 1件あたり 40 ノード以内、複数行（10行）でも 60 ノード以内', () => {
  const short = showHistory(histEntries(200, 1, { field: 'title' }));
  assert.equal(short.items, 200, '前提: 全件を描いている');
  assert.ok(short.nodes / 200 <= 40, '1行の値 1件あたり ' + short.nodes / 200);
  const ten = showHistory(histEntries(200, 10));
  assert.equal(ten.items, 200, '前提: 全件を描いている');
  assert.ok(ten.nodes / 200 <= 60, '10行の差分 1件あたり ' + ten.nodes / 200);
});

test('C9. 履歴の行差分は、1回の描画で LCS の表を 200万セルまでしか作らない（200 件 × 400 行）。使い切った後は丸ごと del/add', () => {
  const r = showHistory(histEntries(200, 400));
  assert.ok(r.lcs.n <= 2000000, 'LCS のセル ' + r.lcs.n);
  assert.ok(r.lcs.n > 0, '予算の範囲では行差分を作っている');
  // 予算が尽きた後の件は LCS を呼ばない（1回の描画で描いた件数より少ない）。
  assert.ok(r.firstItems > 0 && r.lcs.calls < r.firstItems, 'LCS を ' + r.lcs.calls + ' 回呼んだ（描いた ' + r.firstItems + ' 件）');
  assert.ok(r.t < 10000, 'シムでの描画 ' + r.t.toFixed(0) + 'ms');
});

test('C10. 履歴の DOM は 1件の複数行の値が N 行なら高々 2N+定数ノード（500 行まで）。1件だけなら 1,100 ノード以内', () => {
  const r = showHistory(histEntries(1, 500));
  assert.ok(r.nodes <= 1100, '500 行の1件で ' + r.nodes);
  const over = showHistory(histEntries(1, 501));
  assert.ok(over.nodes <= 1100, '501 行（丸ごと）の1件で ' + over.nodes);
});

test('C11. 履歴の描画は何度描き直しても DOM が増えない（応答を2回渡す）', () => {
  const { h } = boot(5);
  h.openCard(pid(1));
  h.historyToggle('panel-history');
  const entries = histEntries(50, 20);
  h.calls[h.calls.length - 1].handlers.success({ ok: true, entries: entries });
  const first = countNodes(h.sandbox.document.getElementById('panel-history'));
  h.sandbox.fillHistory(h.sandbox.historyUi['panel-history'].content, entries, false);
  assert.equal(countNodes(h.sandbox.document.getElementById('panel-history')), first);
});
