'use strict';
// 用語の差し替えと補足（Task 8）の検査。
//
// 補足は「押しても、カーソルを当てても、キーボードでも開く」。第2段階でタッチ端末に
// 対応したので、カーソルだけに頼る形は採らない。モーダルにもしない（開いている間も
// 盤面を操作できること）。判定は内部変数ではなく、画面の操作から辿る。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, htmlSource, styleRules, declarations } = require('./kanban_harness.js');
const { GLOSSARY } = require('../pure_glossary.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function cols(placed) {
  return STATUSES.map(function (s) { return { status: s, cards: (placed || {})[s] || [] }; });
}

const CARD_A = { id: 'PBI-001', title: 'A', priority: 'High', size: '3', updated_at: 'T1' };
const CARD_B = { id: 'PBI-002', title: 'B', updated_at: 'T1' };   // 優先度もポイントも無い
const INITIAL = cols({ New: [CARD_A, CARD_B] });

const VELOCITY = [
  { sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
];

/** 初期読み込み（盤面）を済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL), velocityRows: VELOCITY });
  return h;
}

/** 一覧を表示したハーネスを返す。columns はそのまま表のヘッダーになる。 */
function readyList(columns) {
  const h = ready();
  h.clickView('一覧');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'list', view: { columns: columns, rows: [{ id: 'PBI-001' }] }
  });
  return h;
}

// ---------------------------------------------------------------------------
// 用語集の写し
// ---------------------------------------------------------------------------

test('kanban.html の用語集は pure_glossary.js と一字一句同じ', () => {
  // GAS のサーバ側 .js はブラウザから呼べないため、画面に出す文面は kanban.html に
  // 写しを持っている。写しが黙ってずれると、同じ語の説明が画面ごとに違うという、
  // 用語集を1か所に持った理由そのものが崩れる。
  const h = createHarness(INITIAL);
  h.sandbox.load();
  assert.deepEqual(Object.assign({}, h.sandbox.GLOSSARY), Object.assign({}, GLOSSARY));
});

// ---------------------------------------------------------------------------
// 用語の差し替え
// ---------------------------------------------------------------------------

test('画面のどこにも「サイズ」と書かない', () => {
  assert.equal(htmlSource().indexOf('サイズ'), -1, '「サイズ」が残っている');
});

test('カードのポイントは「3 pt」と出る', () => {
  const h = ready();
  assert.ok(h.textTreeOf('board').indexOf('3 pt') !== -1,
    'カードにポイントが「3 pt」で出ていない: ' + h.textTreeOf('board'));
});

test('パネルのポイント欄は見出しが「ポイント」で、相対見積りの補足を常に見せる', () => {
  // 入力欄の id と CSV の列名は size のまま（列名は変えない）。
  const html = htmlSource();
  assert.ok(html.indexOf('<label for="f-size">ポイント</label>') !== -1,
    'ポイント欄の見出しが「ポイント」ではない');
  assert.ok(html.indexOf('相対見積り。ベロシティは完了したポイントの合計') !== -1,
    'ポイント欄の .hint が無い');
  assert.ok(html.indexOf('<input id="f-size"') !== -1, 'f-size の input が変わっている');
});

test('受入基準の補足は用語集の文面を常に見せる（押させない）', () => {
  const h = ready();
  assert.equal(h.textOf('f-acceptance-hint'), GLOSSARY['受入基準'],
    'パネルの受入基準に用語集の文面が出ていない');
});

// ---------------------------------------------------------------------------
// 補足の開き方（押す・カーソル・キーボード）
// ---------------------------------------------------------------------------

test('列の見出しの補足は、押すと開き、もう一度押すと閉じる', () => {
  const h = ready();
  const help = h.helpFor('board', 'Ready');
  assert.equal(help.isOpen(), false, '最初から開いている');
  assert.equal(help.expanded(), 'false');

  help.press();
  assert.equal(help.isOpen(), true, '押しても開かない（タッチ端末では開けない）');
  assert.equal(help.text(), GLOSSARY['Ready'], '用語集と違う文面が出ている');
  assert.equal(help.expanded(), 'true', 'aria-expanded が開いた状態になっていない');

  help.press();
  assert.equal(help.isOpen(), false, 'もう一度押しても閉じない');
  assert.equal(help.expanded(), 'false');
});

test('タッチ端末でタップすると補足が開き、もう一度タップすると閉じる', () => {
  // 1回のタップは pointerdown → 合成の mouseenter → focus → click の順に来る。
  // click の時点の状態で開閉を決めると、先に開いた補足を自分で閉じてしまい、
  // タッチでは「押しても開かない」ことになる（カーソルが無い端末では致命的）。
  const h = ready();
  const help = h.helpFor('board', 'Ready');
  help.tap();
  assert.equal(help.isOpen(), true, 'タップしても開かない（タッチ端末で読めない）');
  assert.equal(help.expanded(), 'true');

  help.tap();
  assert.equal(help.isOpen(), false, 'もう一度タップしても閉じない');
});

test('マウスでは、カーソルを当てて開いた補足をクリックで閉じられる', () => {
  const h = ready();
  const help = h.helpFor('board', 'Ready');
  help.mouseClick();
  assert.equal(help.isOpen(), false, 'クリックで閉じられない（開いたまま残る）');
});

test('補足はカーソルを当てても開き、離れると閉じる', () => {
  const h = ready();
  const help = h.helpFor('board', 'New');
  help.hover();
  assert.equal(help.isOpen(), true, 'カーソルを当てても開かない');
  help.leave();
  assert.equal(help.isOpen(), false, 'カーソルが離れても閉じない');
});

test('補足はキーボードのフォーカスでも開き、外れると閉じる', () => {
  const h = ready();
  const help = h.helpFor('board', 'Done');
  help.focus();
  assert.equal(help.isOpen(), true, 'フォーカスしても開かない（キーボードで読めない）');
  help.blur();
  assert.equal(help.isOpen(), false, 'フォーカスが外れても閉じない');
});

test('補足を開いている間も盤面を操作できる（モーダルにしない）', () => {
  const h = ready();
  h.helpFor('board', 'New').press();
  h.drag('PBI-001', 'Ready');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdateStatus', '補足を開くと盤面が操作できなくなっている');
});

test('補足は同時に1つだけ開く', () => {
  const h = ready();
  const first = h.helpFor('board', 'New');
  first.press();
  const second = h.helpFor('board', 'Review');
  second.press();
  assert.equal(second.isOpen(), true);
  assert.equal(first.isOpen(), false, '前の補足が開いたまま残っている');
  assert.equal(first.expanded(), 'false', '閉じた補足の aria-expanded が true のまま');
});

// ---------------------------------------------------------------------------
// Escape の順番（一番手前にあるものから閉じる）
// ---------------------------------------------------------------------------

/** PBI-001 を削除して通知を出したハーネスを返す。 */
function readyWithToast() {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-delete');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, removed: CARD_A, board: h.boardOf(cols({ New: [CARD_B] }))
  });
  assert.equal(h.hiddenOf('toast'), false, '前提: 通知が出ていない');
  return h;
}

test('Escape は通知より先に補足を閉じる', () => {
  // 補足は通知より手前（z-index 20 対 10）に出る。手前のものから閉じないと、
  // 見えている補足が残ったまま通知だけ消える。
  const h = readyWithToast();
  const help = h.helpFor('board', 'New');
  help.hover();

  h.pressKey('Escape');
  assert.equal(help.isOpen(), false, '補足が閉じていない');
  assert.equal(h.hiddenOf('toast'), false, '補足より先に通知が閉じてしまった');

  h.pressKey('Escape');
  assert.equal(h.hiddenOf('toast'), true, '2打目で通知が閉じない');
});

test('描き直しで消えた補足は、Escape を奪わない', () => {
  // 開いた補足は次の描き直しで要素ごと消える。「開いている」記録が残っていると、
  // Escape が画面に無い補足を閉じたことにして、その一打が通知まで届かない。
  const h = readyWithToast();
  h.helpFor('board', 'New').hover();

  h.click('reload');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, view: h.boardOf(cols({ New: [CARD_B] })), velocityRows: VELOCITY
  });

  h.pressKey('Escape');
  assert.equal(h.hiddenOf('toast'), true, '消えた補足が Escape を吸い取った');
});

// ---------------------------------------------------------------------------
// 補足を置く場所
// ---------------------------------------------------------------------------

test('列の見出しはステータス名の補足を出す', () => {
  const h = ready();
  const terms = h.helpsIn('board').map(function (x) { return x.term; });
  STATUSES.forEach(function (s) {
    assert.ok(terms.indexOf(s) !== -1, s + ' の列の見出しに補足が出ていない');
  });
  assert.equal(h.helpFor('board', 'In Progress').text(), GLOSSARY['In Progress']);
});

test('カードは優先度の補足を出し、優先度が無いカードには出さない', () => {
  const h = ready();
  const terms = h.helpsIn('board').map(function (x) { return x.term; });
  assert.equal(terms.filter(function (t) { return t === 'High'; }).length, 1,
    'PBI-001（High）の補足が出ていない');
  assert.equal(terms.indexOf('未設定'), -1, '優先度が無いカードに補足を出している');
  assert.equal(h.helpFor('board', 'High').text(), GLOSSARY['High']);
});

test('表のヘッダーは、用語集にある見出しにだけ補足を出す', () => {
  const h = readyList([
    { field: 'id', label: 'ID' },
    { field: 'sprint', label: 'スプリント' },
    { field: 'acceptance_criteria', label: '受入基準' },
  ]);
  assert.deepEqual(h.helpsIn('table-view').map(function (x) { return x.term; }),
    ['スプリント', '受入基準'], '表のヘッダーの補足が用語集と噛み合っていない');
  assert.equal(h.helpFor('table-view', 'スプリント').text(), GLOSSARY['スプリント']);
});

test('表のヘッダーの補足も押して開ける', () => {
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = h.helpFor('table-view', 'スプリント');
  help.press();
  assert.equal(help.isOpen(), true, '表のヘッダーの補足が開かない');
});

// ---------------------------------------------------------------------------
// 見た目（シムは CSS を評価しないので、規則そのものを見る）
// ---------------------------------------------------------------------------

test('補足の本文は通知より手前に出る', () => {
  // 通知（#toast）は z-index: 10 で固定表示される。補足がそれより後ろだと、
  // 削除直後に用語を確かめようとしたときだけ黙って隠れる。
  const zOf = function (selector) {
    const rule = styleRules().find(function (r) { return r.selector === selector; });
    assert.ok(rule, selector + ' の規則が無い');
    const z = declarations(rule.body).find(function (d) { return d.property === 'z-index'; });
    assert.ok(z, selector + ' に z-index が無い');
    return Number(z.value);
  };
  assert.ok(zOf('.help-body') > zOf('#toast'),
    '補足が通知より後ろに出る（削除直後に読めない）');
});
