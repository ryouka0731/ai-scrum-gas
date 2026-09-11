'use strict';
// 用語の差し替えと補足（Task 8）の検査。
//
// 補足は「押しても、カーソルを当てても、キーボードでも開く」。第2段階でタッチ端末に
// 対応したので、カーソルだけに頼る形は採らない。モーダルにもしない（開いている間も
// 盤面を操作できること）。判定は内部変数ではなく、画面の操作から辿る。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, htmlSource, styleRules, topLevelRules, selectorList, declarations } = require('./kanban_harness.js');
const { GLOSSARY, GLOSSARY_ALIASES, glossaryOf } = require('../pure_glossary.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function cols(placed) {
  return STATUSES.map(function (s) { return { status: s, cards: (placed || {})[s] || [] }; });
}

const CARD_A = { id: 'PBI-001', title: 'A', priority: 'High', size: '3', updated_at: 'T1' };
const CARD_B = { id: 'PBI-002', title: 'B', updated_at: 'T1' };   // 優先度もポイントも無い
const INITIAL = cols({ New: [CARD_A, CARD_B] });

const CHOICES = [{ value: '', label: '（未割り当て）', unknown: false }];

/** 初期読み込み（盤面）を済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL), sprintChoices: CHOICES });
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
  assert.deepEqual(Object.assign({}, h.sandbox.GLOSSARY_ALIASES), Object.assign({}, GLOSSARY_ALIASES));
});

test('kanban.html の glossaryOf は、あらゆる語で本体と同じ答えを返す', () => {
  // データだけを比べても、照合の仕方（別名の解決・trim・大文字小文字）を変えられると
  // すり抜ける。キー集合は有限なので、全キー + 全別名 + 境界の入力で網羅できる。
  const h = createHarness(INITIAL);
  h.sandbox.load();
  const inputs = Object.keys(GLOSSARY)
    .concat(Object.keys(GLOSSARY_ALIASES))
    .concat(Object.keys(GLOSSARY).map((k) => '  ' + k + '  '))
    .concat(Object.keys(GLOSSARY_ALIASES).map((k) => ' ' + k + ' '))
    .concat(Object.keys(GLOSSARY).map((k) => k.toLowerCase()))
    .concat(Object.keys(GLOSSARY).map((k) => k.toUpperCase()))
    .concat(['', ' ', 'しらない語', 'ストーリー', null, undefined, 0, false]);
  inputs.forEach((v) => {
    assert.equal(h.sandbox.glossaryOf(v), glossaryOf(v),
      '写しの答えが本体と違う: ' + JSON.stringify(v));
  });
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

test('パネルのポイント欄は見出しが「ポイント」で、用語集の文面を常に見せる', () => {
  // 入力欄の id と CSV の列名は size のまま（列名は変えない）。
  const html = htmlSource();
  assert.ok(html.indexOf('<label for="f-size">ポイント</label>') !== -1,
    'ポイント欄の見出しが「ポイント」ではない');
  assert.ok(html.indexOf('<input id="f-size"') !== -1, 'f-size の input が変わっている');

  // 文面は直書きせず用語集から入れる。直書きすると、同じ語の説明が用語集と画面で
  // 2通りになる（受入基準で自ら掲げた原則）。
  const h = ready();
  assert.equal(h.textOf('f-size-hint'), GLOSSARY['ストーリーポイント'],
    'ポイント欄の .hint が用語集の文面になっていない');
});

test('一覧の「ポイント」の見出しに補足が出る（別名で用語集に繋ぐ）', () => {
  // 利用者が名指しした語。列見出しは「ポイント」、用語集のキーは「ストーリーポイント」。
  const h = readyList([{ field: 'size', label: 'ポイント' }]);
  assert.equal(h.helpFor('table-view', 'ポイント').text(), GLOSSARY['ストーリーポイント'],
    '「ポイント」の見出しに補足が出ていない');
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

test('キーボードで Enter / Space を押しても補足は閉じない（押すと開く）', () => {
  // Tab で来た時点で focus が開く。そこで Enter を押すと click が続けて来るので、
  // 「今開いているから閉じる」と判定すると、押した瞬間に閉じる（設計書の
  // 「押すと開く」の裏返し）。実測（Chrome の headless に Input.dispatchKeyEvent で
  // 本物の Enter）: focus で開き、Enter の click は isTrusted=true / detail=0 で閉じた。
  const h = ready();
  const help = h.helpFor('board', 'Done');
  help.keyPress();
  assert.equal(help.isOpen(), true, 'キーボードで押すと閉じてしまう');
  assert.equal(help.expanded(), 'true', 'aria-expanded が開いた状態になっていない');

  // 押し続けても開いたまま（開くほうへ倒す。閉じるのは Escape とフォーカス外し）。
  help.keyPress();
  assert.equal(help.isOpen(), true, '2打目で閉じてしまう');
});

test('キーボードで開いた補足は Escape で閉じられる', () => {
  // 「押すと閉じる」を止めた分、閉じる手段が残っていることを確かめる。
  const h = ready();
  const help = h.helpFor('board', 'Done');
  help.keyPress();
  assert.equal(help.isOpen(), true, '前提: 開いていない');
  h.pressKey('Escape');
  assert.equal(help.isOpen(), false, 'Escape で閉じない（キーボードでは閉じられない）');
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
    ok: true, view: h.boardOf(cols({ New: [CARD_B] })), sprintChoices: CHOICES
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

// ---------------------------------------------------------------------------
// 用語集に無い語では何も作らない
// ---------------------------------------------------------------------------

test('用語集に無い見出しには、空の入れ物も作らない', () => {
  // 空の <span class="help"></span> は、幅0のうちは害が無い。当たり判定を 24px に
  // 広げた瞬間、6列すべてに幽霊の隙間が出る。
  const h = readyList([
    { field: 'id', label: 'ID' },
    { field: 'title', label: 'タイトル' },
    { field: 'status', label: 'ステータス' },
    { field: 'updated_at', label: '更新日' },
  ]);
  assert.equal(h.helpWrapsIn('table-view').length, 0,
    '用語集に無い見出しに空の .help が作られている');
});

test('優先度の無いカードには、空の入れ物も作らない', () => {
  // .card .prio は display: flex; gap: var(--sp-2) なので、空の要素でも隙間が入る。
  const only = cols({ New: [CARD_B] });
  const h = createHarness(only);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(only), sprintChoices: CHOICES });
  const inCards = h.helpWrapsIn('board').length - STATUSES.length;   // 列の見出しの分を引く
  assert.equal(inCards, 0, '優先度の無いカードに空の .help が作られている');
});

// ---------------------------------------------------------------------------
// 位置（position: fixed。切り取る祖先から逃げる代わりに、自分で画面内に収める）
// ---------------------------------------------------------------------------

/** 表のヘッダーの補足に位置を与えて開く。 */
function openPlaced(h, term, btnRect, bodyRect) {
  const help = h.helpFor('table-view', term);
  help.setRects(btnRect, bodyRect);
  help.hover();
  return help;
}

test('補足は ? のすぐ下に置かれる', () => {
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = openPlaced(h, 'スプリント',
    { left: 100, top: 200, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 90 });
  assert.deepEqual(help.position(), { left: '100px', top: '232px' },
    '? の直下（8px 空けて）に置かれていない');
});

test('画面の右端をはみ出す補足は内側へ寄る', () => {
  // 表の右端の列（受入基準・更新日）の補足は、実測で 17px 切れていた。
  const h = readyList([{ field: 'acceptance_criteria', label: '受入基準' }]);
  const help = openPlaced(h, '受入基準',
    { left: 1400, top: 100, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 90 });
  assert.equal(help.position().left, '1152px',   // 1440 - 280 - 8
    '右端をはみ出したままになっている: ' + help.position().left);
});

test('画面の下端に入らない補足は ? の上に出る', () => {
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = openPlaced(h, 'スプリント',
    { left: 100, top: 840, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 90 });
  assert.equal(help.position().top, '742px',   // 840 - 90 - 8
    '下端をはみ出したままになっている: ' + help.position().top);
});

test('狭い画面でも補足は画面の内側に収まる', () => {
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  h.setViewport(360, 640);
  const help = openPlaced(h, 'スプリント',
    { left: 300, top: 20, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 120 });
  assert.equal(help.position().left, '72px',   // 360 - 280 - 8
    '狭い画面で右端からはみ出している: ' + help.position().left);
});

test('表を横スクロールして ? が左端の外へ出ても、補足は画面の内側に出る', () => {
  // #table-view は横スクロールする。列が左へ流れると ? の left は 0 や負になる。
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = openPlaced(h, 'スプリント',
    { left: -30, top: 100, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 90 });
  assert.equal(help.position().left, '8px', '画面の左外に出ている: ' + help.position().left);
});

test('位置は開くたびに測り直す', () => {
  // 表は横スクロールし、盤面は縦に伸びる。作った時点の位置は当てにならない。
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = openPlaced(h, 'スプリント',
    { left: 100, top: 200, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 90 });
  help.leave();
  help.setRects({ left: 40, top: 500, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 90 });
  help.hover();
  assert.deepEqual(help.position(), { left: '40px', top: '532px' }, '前の位置のまま出ている');
});

test('狭い端末では、見えている幅（documentElement）に収める', () => {
  // 実測: 375px の端末で window.innerWidth は 628 を返す（ページが横に伸びると
  // innerWidth はそちらに付いてくる）。その値を信じて収めると、補足は右端 606px に
  // 置かれ、実際に見えている 375px の外に出る。
  const h = readyList([{ field: 'acceptance_criteria', label: '受入基準' }]);
  h.setViewport(375, 800);
  h.setWindowInner(628, 800);   // 見えている幅とずらす
  const help = openPlaced(h, '受入基準',
    { left: 326, top: 100, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 120 });
  assert.equal(help.position().left, '87px',   // 375 - 280 - 8
    '見えていない幅（window.innerWidth）を基準に収めている: ' + help.position().left);
});

test('狭い端末では、見えている高さ（documentElement）に収める', () => {
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  h.setViewport(375, 800);
  h.setWindowInner(375, 1200);
  const help = openPlaced(h, 'スプリント',
    { left: 20, top: 740, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 120 });
  assert.equal(help.position().top, '612px',   // 740 - 120 - 8（下に入らないので上へ）
    '見えていない高さ（window.innerHeight）を基準に収めている: ' + help.position().top);
});

test('狭い画面では表が親の幅で止まり、枠の中で横スクロールする', () => {
  // シムは CSS を評価しないので、規則そのものを見る（実機での確認はリードが行う）。
  // 縦積みの flex では交差軸（＝幅）が align-items: flex-start で中身なりに決まるため、
  // 幅を指定しないと #table-view が表の幅まで広がり、ページごと横に伸びる
  // （375px の端末で 616px まで広がる実測がある）。そうなると補足の収め先も崩れる。
  const narrow = styleRules().filter(function (r) {
    return r.selector.indexOf('@media') === 0 && r.selector.indexOf('max-width: 900px') !== -1;
  });
  assert.ok(narrow.length > 0, '狭い画面向けの規則が無い');

  const inner = narrow.map(function (r) { return topLevelRules(r.body); })
    .reduce(function (a, b) { return a.concat(b); }, []);
  const forTable = inner.filter(function (r) { return selectorList(r.selector).indexOf('#table-view') !== -1; });
  assert.equal(forTable.length > 0, true, '狭い画面で #table-view の幅を止めていない');

  const props = {};
  forTable.forEach(function (r) {
    declarations(r.body).forEach(function (d) { props[d.property] = d.value; });
  });
  assert.ok(props['width'] === '100%' || props['align-self'] === 'stretch',
    '#table-view が親の幅で止まらない: ' + JSON.stringify(props));

  // 枠の中で横スクロールする側（.table-wrap = #table-view と同じ要素）も残っていること。
  const wrap = styleRules().find(function (r) { return r.selector === '.table-wrap'; });
  assert.ok(wrap && /overflow-x\s*:\s*auto/.test(wrap.body), '表が枠の中で横スクロールしない');
});

test('スクロールすると開いている補足は閉じる', () => {
  // fixed は画面に貼り付くので、下の表がスクロールすると指した語から離れる。
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = h.helpFor('table-view', 'スプリント');
  help.hover();
  assert.equal(help.isOpen(), true, '前提: 開いていない');
  h.fireWindow('scroll');
  assert.equal(help.isOpen(), false, 'スクロールしても補足が残る（指した語から離れる）');
});

test('表の中でスクロールしても開いている補足は閉じる', () => {
  // 本文は position: fixed なので画面に貼り付く。表が枠の中で横スクロールすると、
  // 補足だけが取り残されて別の列を指す。要素の scroll は bubble しないので、
  // 捕捉フェーズで受けていないとここだけが黙って戻る（一番直したかった場面）。
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = h.helpFor('table-view', 'スプリント');
  help.hover();
  assert.equal(help.isOpen(), true, '前提: 開いていない');
  h.fireScrollIn('table-view');
  assert.equal(help.isOpen(), false,
    '表の中のスクロールで閉じない（捕捉フェーズで受けていない）');
});

test('下にも上にも入らない補足は、画面の上端で止まる', () => {
  // 横向きの端末でソフトキーボードが出ている等、見えている高さが本文2つ分に満たない場合。
  // 最後の砦が無いと、上へ回した補足が画面の上に飛び出して読めなくなる。
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  h.setViewport(375, 200);
  const help = openPlaced(h, 'スプリント',
    { left: 20, top: 100, width: 24, height: 24 }, { left: 0, top: 0, width: 280, height: 120 });
  assert.equal(help.position().top, '8px',
    '上端から飛び出している: ' + help.position().top);
});

test('画面の大きさが変わると開いている補足は閉じる', () => {
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = h.helpFor('table-view', 'スプリント');
  help.hover();
  h.fireWindow('resize');
  assert.equal(help.isOpen(), false, 'リサイズしても補足が残る');
});

// ---------------------------------------------------------------------------
// 読み上げ・置き場所
// ---------------------------------------------------------------------------

test('? ボタンは本文を aria-describedby で指す', () => {
  // aria-expanded だけでは「開いた」ことしか伝わらない。blur で閉じるので、
  // 読み上げ利用者が本文の中へ入る手段は無い。焦点を当てた時点で読まれるようにする。
  const h = ready();
  const help = h.helpFor('board', 'Ready');
  assert.ok(help.bodyId(), '本文に id が無い');
  assert.equal(help.describedBy(), help.bodyId(), 'aria-describedby が本文を指していない');
});

test('補足の id は重複しない', () => {
  const h = ready();
  const ids = h.helpsIn('board').map(function (x) { return x.bodyId(); });
  assert.equal(new Set(ids).size, ids.length, '同じ id の補足がある: ' + ids.join(','));
});

test('補足の本文は span（列の見出しの h2 に div は置けない）', () => {
  const h = ready();
  assert.equal(h.helpFor('board', 'Ready').bodyTag(), 'span');
});

test('表の補足を開いたまま盤面へ戻ると、その補足は閉じられる', () => {
  // 盤面へ切り替えても #table-view は hidden になるだけで中身は残る。閉じずに
  // 記録だけ捨てると、見えない場所に開いたままの補足が置き去りになり、
  // 一覧へ戻ったときに一瞬それが見える（Escape でも閉じられない）。
  const h = readyList([{ field: 'sprint', label: 'スプリント' }]);
  const help = h.helpFor('table-view', 'スプリント');
  help.hover();
  assert.equal(help.isOpen(), true, '前提: 開いていない');

  h.clickView('盤面');
  assert.equal(help.isOpen(), false, '見えない場所に開いたままの補足が残っている');
});

test('盤面の補足を開いたままビューを切り替えても、Escape は通知に届く', () => {
  const h = readyWithToast();
  h.helpFor('board', 'New').hover();
  h.clickView('一覧');
  h.pressKey('Escape');
  assert.equal(h.hiddenOf('toast'), true, '切り替えで消えた補足が Escape を吸い取った');
});

// ---------------------------------------------------------------------------
// 補足を含みうる領域を空にするのは clearHost だけ
// ---------------------------------------------------------------------------

/** kanban.html の <script> から関数1つの本文を切り出す（入れ子の {} を数える）。 */
function functionBody(name) {
  const js = require('./kanban_harness.js').scriptSource();
  const at = js.indexOf('\nfunction ' + name + '(');
  assert.notEqual(at, -1, name + ' が見つかりません');
  const open = js.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < js.length; i++) {
    if (js[i] === '{') depth++;
    else if (js[i] === '}') { depth--; if (depth === 0) return js.slice(open, i + 1); }
  }
  throw new Error(name + ' の本文を切り出せません');
}

test('補足を含みうる領域を空にするのは clearHost 経由だけ', () => {
  // 直に innerHTML を空にすると、そこに開いていた補足の記録（openHelp）が腐り、
  // Escape の一打が「もう画面に無い補足」に吸われる。#summary は今は補足を
  // 持たないが、「ベロシティ」等に補足を足した瞬間に同じ穴が開く。
  ['render', 'showTableLoading', 'renderTable', 'foldTableLoading', 'renderSummary']
    .forEach(function (name) {
      const body = functionBody(name);
      assert.ok(body.indexOf('clearHost(') !== -1, name + ' が clearHost を使っていない');
      assert.equal(/innerHTML\s*=/.test(body), false, name + ' が直に innerHTML を書いている');
    });
});

// ---------------------------------------------------------------------------
// 補足の本文を切り取る／位置の基準をずらす祖先がいないこと
// ---------------------------------------------------------------------------

// position: fixed の包含ブロックは viewport だが、祖先に transform / filter /
// perspective / contain / backdrop-filter / will-change があるとその要素が包含ブロックに
// なり、overflow を持つ箱の中へ引き戻されて切り取られる。
//
// absolute（＝この修正の前）なら overflow を持つ祖先そのものが切り取り箱になる
// （#table-view の overflow-x: auto は、CSS が overflow-y: visible を auto に格上げするので
// 両軸のクリップ箱になる）。どちらの作りに戻されても捕まえられるよう、見る性質を
// .help-body の position から決める。
const CONTAINING_BLOCK = [
  'transform', 'filter', 'perspective', 'contain', 'backdrop-filter', 'will-change',
];
const CLIPPING = ['overflow', 'overflow-x', 'overflow-y'];

/** 結合子（子孫・子・兄弟）を含むセレクタか。 */
function hasCombinator(selector) {
  return /[\s>+~]/.test(selector);
}

/** .help-body の宣言を { プロパティ: 値 } で返す。 */
function helpBodyDeclarations() {
  const rule = styleRules().find(function (r) { return r.selector === '.help-body'; });
  assert.ok(rule, '.help-body の規則が無い');
  const out = {};
  declarations(rule.body).forEach(function (d) { out[d.property] = d.value; });
  return out;
}

/**
 * 単純セレクタ（tag / #id / .class の連なり）で el に当たる規則の宣言を集める。
 * 疑似クラスは「当たりうる」と見なす（:hover でも包含ブロックは作られるため）。
 */
function declarationsFor(el, watched) {
  const watchedRe = new RegExp('(^|[\\s;])(' + watched.join('|') + ')\\s*:');
  const keys = [el.tagName]
    .concat(el.id ? ['#' + el.id] : [])
    .concat(String(el.className || '').split(/\s+/).filter(Boolean).map(function (c) { return '.' + c; }));
  const out = [];
  styleRules().forEach(function (rule) {
    const risky = watchedRe.test(rule.body);
    rule.selector.split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      .forEach(function (sel) {
        if (hasCombinator(sel)) {
          // 解釈できないセレクタは黙って見逃さない。見逃すと検査が静かに盲目化する。
          if (risky) throw new Error('解釈できないセレクタが補足の置き場所を壊しうる: ' + sel);
          return;
        }
        const parts = sel.replace(/:{1,2}[a-z-]+(\([^)]*\))?/g, '')
          .split(/(?=[.#])/).map(function (x) { return x.trim(); }).filter(Boolean);
        if (parts.length === 0) return;
        const hit = parts.every(function (part) { return keys.indexOf(part) !== -1; });
        if (hit) declarations(rule.body).forEach(function (d) { out.push(d); });
      });
  });
  return out;
}

test('補足の本文を切り取る／位置の基準をずらす祖先がいない', () => {
  // シムが持っているのは #board / #table-view から下だけ（body / #main は模していない）。
  // 実ブラウザでの確認はリードが行う。ここで見るのは「この画面の CSS が自分で
  // 切り取り箱や包含ブロックを作っていないか」。
  const position = helpBodyDeclarations()['position'];
  const watched = position === 'fixed' ? CONTAINING_BLOCK : CONTAINING_BLOCK.concat(CLIPPING);

  const board = ready();
  board.helpFor('board', 'Ready').hover();
  const list = readyList([
    { field: 'sprint', label: 'スプリント' },
    { field: 'acceptance_criteria', label: '受入基準' },
  ]);

  const targets = board.helpBodiesIn('board').concat(list.helpBodiesIn('table-view'));
  assert.ok(targets.length >= 3, '前提: 補足の本文が見つからない');

  targets.forEach(function (body) {
    for (let el = body.parentNode; el; el = el.parentNode) {
      declarationsFor(el, watched).forEach(function (d) {
        if (watched.indexOf(d.property) === -1) return;
        assert.ok(d.value === 'visible' || d.value === 'none',
          '補足の祖先（' + el.tagName + (el.id ? '#' + el.id : '') +
          (el.className ? '.' + el.className : '') + '）が ' + d.property + ': ' + d.value +
          ' を持つ。補足が切り取られるか、位置の基準がずれる');
      });
    }
  });
});

test('補足の本文は fixed で、th の nowrap を継承しない', () => {
  // 切り取りとは独立した不具合。white-space を戻さないと、50 字前後の本文が
  // 1行に潰れて 280px の枠を突き抜ける（th { white-space: nowrap } は継承する）。
  const rule = styleRules().find(function (r) { return r.selector === '.help-body'; });
  assert.ok(rule, '.help-body の規則が無い');
  const decls = {};
  declarations(rule.body).forEach(function (d) { decls[d.property] = d.value; });
  assert.equal(decls['position'], 'fixed', '補足が切り取られる位置指定のままになっている');
  assert.equal(decls['white-space'], 'normal', '本文が th の nowrap を継承して1行に潰れる');
});

test('? の当たり判定は 24×24 CSS px 以上ある', () => {
  // WCAG 2.5.8。見た目の ? は 11px のままでよいが、指で当てられないと
  // タッチ端末では無いのと同じ（click の判定を直した意味が消える）。
  const rule = styleRules().find(function (r) { return r.selector === '.help > button'; });
  assert.ok(rule, '.help > button の規則が無い');
  const decls = {};
  declarations(rule.body).forEach(function (d) { decls[d.property] = d.value; });
  assert.ok(parseFloat(decls['min-width']) >= 24, '? の幅が 24px 未満: ' + decls['min-width']);
  assert.ok(parseFloat(decls['min-height']) >= 24, '? の高さが 24px 未満: ' + decls['min-height']);
  // 広げた分は負のマージンで打ち消す（列の見出し・カード・表の行の高さを変えない）。
  assert.ok(parseFloat(decls['margin-top']) < 0, '広げた分だけ行が高くなる（margin-top）');
  assert.ok(parseFloat(decls['margin-bottom']) < 0, '広げた分だけ行が高くなる（margin-bottom）');
});
