const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

/**
 * タブとビューの切り替えを、画面の操作から辿って検査する。
 *
 * この画面は「応答の到達順によって画面とサーバが永続的に食い違う」不具合を5回踏んでいる。
 * 5回とも読むだけでは見えず、実行して初めて分かった。ここは「タブ機能を丸ごと元に戻したら
 * 落ちる」ところまでを担保する層。判定はすべて描画された DOM から読む。
 */

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                           { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];

const BOARD_SUMMARY = { byStatus: [], total: { count: 2, points: 0 } };

/** 初期読み込み（apiGetView('board')）まで済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  const first = h.calls[0];
  assert.equal(first.method, 'apiGetView', '初期読み込みが apiGetView になっていない');
  assert.deepEqual(first.args, ['board']);
  first.handlers.success({
    ok: true, name: 'board', view: h.boardOf(INITIAL), summary: BOARD_SUMMARY,
  });
  return h;
}

/** 未応答の呼び出しのうち、いちばん新しいもの。 */
function latest(h) {
  assert.ok(h.calls.length > 0, '未応答の呼び出しがありません');
  return h.calls[h.calls.length - 1];
}

// ---------------------------------------------------------------------------
// 1. 書き込みの送信中にビューを行き来する
// ---------------------------------------------------------------------------

test('タブを切り替えても、送信中のドラッグの結果が失われない', () => {
  // ドラッグを送信中のまま一覧へ切り替え、盤面へ戻す。戻ったときの読み取りは
  // まだ移動が確定していない古い board を返すことがある（apiGetView はロックを
  // 取らない）。最後に届くドラッグの応答が、その古い盤面を正しく上書きすること。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  const move = latest(h);
  assert.equal(move.method, 'apiUpdateStatus');
  assert.deepEqual(move.args, ['PBI-001', 'Ready', 'T1']);

  h.clickView('一覧');
  latest(h).handlers.success({
    ok: true, name: 'list', view: { columns: [{ field: 'id', label: 'ID' }], rows: [] }, summary: null,
  });

  h.clickView('盤面');
  // サーバはまだ移動を書き終えていない（PBI-001 は New のまま）。
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  assert.deepEqual(h.screen()[0].cards, ['PBI-001', 'PBI-002'], '古い board が描かれていない前提が崩れた');

  // 最後にドラッグの応答（移動後の board）が届く。
  move.handlers.success({
    ok: true,
    board: h.boardOf([
      { status: 'New', cards: [{ id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
      { status: 'Ready', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T2' }] },
      { status: 'In Progress', cards: [] }, { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
    ]),
  });

  const cols = h.screen();
  assert.deepEqual(cols[0].cards, ['PBI-002'], 'PBI-001 が New に残っている');
  assert.deepEqual(cols[1].cards, ['PBI-001'], '送信中だったドラッグの結果が失われた');
});

test('書き込みが確定したあとに届く読み取りは、画面を巻き戻さずに知らせる', () => {
  // 読み取りを出したあとにドラッグが確定すると、その読み取りはもう古い。
  // 黙って描くと移動が巻き戻り、黙って捨てると何も起きなかったように見える。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  const move = latest(h);

  h.clickView('一覧');
  const list = latest(h);

  move.handlers.success({ ok: true, board: h.boardOf(INITIAL) });   // writeSeq が進む
  list.handlers.success({
    ok: true, name: 'list', view: { columns: [{ field: 'id', label: 'ID' }], rows: [{ id: 'PBI-001' }] }, summary: null,
  });

  assert.equal(h.classOf('message'), 'error', '古い読み取りを黙って受け入れている');
  assert.deepEqual(h.childClassesOf('table-view'), [], '古い読み取りの内容が描かれた');
});

// ---------------------------------------------------------------------------
// 2. 読み取りの失敗は他のタブを巻き添えにしない
// ---------------------------------------------------------------------------

test('ビューの読み取りに失敗しても、他のタブが開ける', () => {
  const h = ready();
  h.clickTab('スプリント');
  latest(h).handlers.success({ ok: false, name: 'burndown', message: '読めません' });
  assert.equal(h.classOf('message'), 'error', '失敗が知らされていない');

  h.clickTab('やること');
  const again = latest(h);
  assert.deepEqual(again.args, ['board'], '他のタブが開けなくなっている');
  again.handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: BOARD_SUMMARY });
  assert.equal(h.hiddenOf('board'), false);
  assert.equal(h.classOf('message'), 'info');
});

test('バーンダウンの元データが無いとき「まだありません」と出る', () => {
  const h = ready();
  h.clickTab('スプリント');
  latest(h).handlers.success({ ok: true, name: 'burndown', view: null, summary: null });
  assert.ok(h.textTreeOf('table-view').indexOf('まだありません') !== -1);
  assert.equal(h.hiddenOf('table-view'), false);
  assert.equal(h.hiddenOf('board'), true);
});

// ---------------------------------------------------------------------------
// 3. どのビューを読みに行くか（引数の固定化を検出する）
// ---------------------------------------------------------------------------

// 画面のラベルと、サーバへ渡すビュー名。ラベルは画面から押すために要る。
const VIEWS = [
  { view: 'board', tab: 'やること', label: '盤面' },
  { view: 'list', tab: 'やること', label: '一覧' },
  { view: 'done', tab: 'やること', label: '完了' },
  { view: 'burndown', tab: 'スプリント', label: 'バーンダウン' },
  { view: 'velocity', tab: 'スプリント', label: 'ベロシティ' },
  { view: 'roadmap', tab: 'スプリント', label: 'ロードマップ' },
  { view: 'impediment', tab: '障害物', label: null },   // ビューが1つだけのタブ
];
const BY_VIEW = {};
VIEWS.forEach(function (v) { BY_VIEW[v.view] = v; });
/** タブを押したときに最初に開くビュー（TABS の views[0]）。 */
const LANDING = { 'やること': 'board', 'スプリント': 'burndown', '障害物': 'impediment' };

/**
 * 今 from にいる画面で、to のビューを選ぶ。タブをまたぐときは
 * 「タブを押す → そのタブの先頭ビューが開く → 目的のビューを押す」の2手になる
 * （実際の利用者と同じ手順。途中の読み取りは応答を待たずに置き去りになる）。
 *
 * 同じビューをもう一度選ぶ手段が無い（ビューが1つだけのタブ）ときは「最新にする」。
 * こちらは showView() を経由しない別の経路で、読み込み中表示の扱いが変わる。
 */
function navigate(h, from, to) {
  const target = BY_VIEW[to];
  if (BY_VIEW[from].tab !== target.tab) {
    h.clickTab(target.tab);
    if (LANDING[target.tab] !== to) h.clickView(target.label);
    return 'showView';
  }
  if (target.label === null) { h.click('reload'); return 'reload'; }
  h.clickView(target.label);
  return 'showView';
}

test('選んだビューがそのままサーバへ渡る（盤面以外を選んだ状態でも）', () => {
  // apiGetView('board') に固定して戻す退行を検出する。既定のビュー（盤面）のままの
  // シナリオだけを見ていると、固定化しても引数は 'board' のままで気づけない。
  VIEWS.forEach(function (v) {
    const h = ready();
    navigate(h, 'board', v.view);
    assert.deepEqual(latest(h).args, [v.view], v.label + ' を選んだのに別のビューを読んでいる');
  });
});

test('「最新にする」は、今見ているビューを読み直す', () => {
  VIEWS.forEach(function (v) {
    const h = ready();
    navigate(h, 'board', v.view);
    latest(h).handlers.success(okResponse(h, v.view));
    h.click('reload');
    assert.deepEqual(latest(h).args, [v.view], v.label + ' を見ているのに別のビューを読み直している');
  });
});

// ---------------------------------------------------------------------------
// 4. タブとビューのボタンそのもの
// ---------------------------------------------------------------------------

test('選んでいるタブとビューがボタンに出る', () => {
  const h = ready();
  assert.deepEqual(h.tabState().tabs,
    [{ label: 'やること', selected: true },
     { label: 'スプリント', selected: false },
     { label: '障害物', selected: false }]);
  assert.deepEqual(h.tabState().views,
    [{ label: '盤面', selected: true },
     { label: '一覧', selected: false },
     { label: '完了', selected: false }]);

  h.clickView('完了');
  assert.deepEqual(h.tabState().views.map(function (b) { return b.selected; }), [false, false, true],
    'ビューを選び直してもボタンの選択状態が付いてこない');

  h.clickTab('スプリント');
  const after = h.tabState();
  assert.deepEqual(after.tabs.map(function (b) { return b.selected; }), [false, true, false],
    'タブを切り替えてもボタンの選択状態が付いてこない');
  assert.deepEqual(after.views.map(function (b) { return b.label; }),
    ['バーンダウン', 'ベロシティ', 'ロードマップ'], '切り替えたタブのビューが出ていない');
  assert.deepEqual(after.views.map(function (b) { return b.selected; }), [true, false, false]);
  assert.equal(after.viewsHidden, false);
});

test('ビューが1つだけのタブでは、ビューの切り替えを出さない', () => {
  const h = ready();
  h.clickTab('障害物');
  assert.equal(h.tabState().viewsHidden, true, '押せる先が無い切り替えが出ている');
  assert.deepEqual(h.tabState().views, []);
});

test('タブを切り替えると、開いていたパネルは閉じる', () => {
  // 別の対象を見に行くのに、前の対象の詳細が残っていると、そのまま保存できてしまう。
  const h = ready();
  h.openCard('PBI-001');
  assert.equal(h.hiddenOf('panel'), false, 'パネルが開いていない前提が崩れた');

  h.clickTab('スプリント');
  assert.equal(h.hiddenOf('panel'), true, 'タブを切り替えてもパネルが開いたまま');
});

test('ビューを切り替えても、開いていたパネルは閉じる', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.clickView('一覧');
  assert.equal(h.hiddenOf('panel'), true, 'ビューを切り替えてもパネルが開いたまま');
});

test('パネルを閉じると、選択中だったカードの印が消える', () => {
  // openCard() が付ける '選択中' の印（renderCard() が panelState.id との一致で決める）は、
  // パネルの hidden とは別の会計。closePanel() が panelState をクリアしても、盤面を
  // render() し直さない限り、そのカード要素の class は古いまま残る。
  const h = ready();
  h.openCard('PBI-001');
  assert.ok(h.cardClassOf('PBI-001').split(' ').indexOf('selected') !== -1,
    'カードに選択中の印が付いていない前提が崩れた');

  h.click('panel-close');
  assert.equal(h.hiddenOf('panel'), true, 'パネルが閉じていない前提が崩れた');
  assert.equal(h.cardClassOf('PBI-001').split(' ').indexOf('selected'), -1,
    'パネルを閉じても、選択中だったカードの印が残っている');
});

test('選択中のタブをもう一度押しても、見ているビューは変わらない', () => {
  // views[0] に戻すと、ベロシティを見ている最中にバーンダウンへ飛んでしまう。
  const h = ready();
  h.clickTab('スプリント');
  latest(h).handlers.success(okResponse(h, 'burndown'));
  h.clickView('ベロシティ');
  latest(h).handlers.success(okResponse(h, 'velocity'));

  const before = h.calls.length;
  h.clickTab('スプリント');
  assert.equal(h.calls.length, before, '同じタブを押しただけで読み直している');
  assert.deepEqual(h.tabState().views.map(function (b) { return b.selected; }), [false, true, false],
    '見ているビューが勝手に変わった');
});

// ---------------------------------------------------------------------------
// 5. 補足（用語の説明）
// ---------------------------------------------------------------------------

test('Escape は補足を先に閉じ、パネルは閉じない', () => {
  const h = ready();
  h.openCard('PBI-001');
  const help = h.helpsIn('board')[0];
  assert.ok(help, '補足が描かれていない');
  help.press();
  assert.equal(help.isOpen(), true);

  h.pressKey('Escape');
  assert.equal(help.isOpen(), false, '補足が閉じない');
  assert.equal(h.hiddenOf('panel'), false, 'パネルまで閉じた');

  h.pressKey('Escape');
  assert.equal(h.hiddenOf('panel'), true, '2回目でパネルが閉じない');
});

// ---------------------------------------------------------------------------
// 6. 表示先の切り替え
// ---------------------------------------------------------------------------

test('表のビューでは盤面が隠れ、盤面のビューでは表が隠れる', () => {
  const h = ready();
  assert.equal(h.hiddenOf('board'), false);
  assert.equal(h.hiddenOf('table-view'), true);

  h.clickView('一覧');
  latest(h).handlers.success({
    ok: true, name: 'list',
    view: { columns: [{ field: 'id', label: 'ID' }], rows: [{ id: 'PBI-001' }] }, summary: null,
  });
  assert.equal(h.hiddenOf('board'), true);
  assert.equal(h.hiddenOf('table-view'), false);

  h.clickView('盤面');
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: BOARD_SUMMARY });
  assert.equal(h.hiddenOf('board'), false);
  assert.equal(h.hiddenOf('table-view'), true);
});

test('表示先は押した時点で決まる（応答を待たない）', () => {
  const h = ready();
  h.clickView('一覧');
  assert.equal(h.hiddenOf('board'), true, '応答を待ってから隠している');
  assert.equal(h.hiddenOf('table-view'), false);
});

// ---------------------------------------------------------------------------
// 7. 要約
// ---------------------------------------------------------------------------

test('ビューごとの要約が出て、切り替えると前の要約は消える', () => {
  const h = ready();
  assert.ok(h.textTreeOf('summary').indexOf('合計') !== -1, '盤面の要約が出ていない');

  h.clickTab('スプリント');
  assert.equal(h.textTreeOf('summary').trim(), '', '切り替えた直後に前のタブの要約が残っている');
  latest(h).handlers.success(okResponse(h, 'burndown'));
  assert.ok(h.textTreeOf('summary').indexOf('スプリント') !== -1, 'スプリントの要約が出ていない');

  h.clickTab('障害物');
  latest(h).handlers.success(okResponse(h, 'impediment'));
  assert.ok(h.textTreeOf('summary').indexOf('未解決') !== -1, '障害物の要約が出ていない');
});

// ---------------------------------------------------------------------------
// 8. 不変条件: #table-view の中身は、その手番から一意に決まる
//
// 「tableLoading が true であることと、#table-view に読み込み中の placeholder が
// 出ていることは常に一致する」を、画面から観測できる形に言い換えたもの。
// tableLoading は showTableLoading() / renderTable() / foldTableLoading() の3者だけが
// 触る内部の会計で、直接は覗かない（覗く検査は利用経路と無関係になる）。代わりに、
// その会計が正しいときにだけ成り立つ「#table-view の中身」を全手番で照合する。
//
// 会計そのものが3者だけのものであることは kanban_ui_structure.test.js が源で見る。
// ---------------------------------------------------------------------------

/** ビューごとの、成功したときの応答。 */
function okResponse(h, view) {
  if (view === 'board') {
    return { ok: true, name: 'board', view: h.boardOf(INITIAL), summary: BOARD_SUMMARY };
  }
  if (view === 'list' || view === 'done') {
    return { ok: true, name: view,
      view: { columns: [{ field: 'id', label: 'ID' }], rows: [{ id: 'PBI-001' }] },
      summary: view === 'list' ? BOARD_SUMMARY : null };
  }
  if (view === 'impediment') {
    return { ok: true, name: 'impediment',
      view: { columns: [{ field: 'id', label: 'ID' }], open: [{ id: 'IMP-1' }], resolved: [] },
      summary: { open: 1, resolved: 0 } };
  }
  return { ok: true, name: view,
    view: { table: { headers: ['日付', '残り'], rows: [['2026-09-01', '10']] } },
    summary: { sprint: 'sprint001', planned: 10, completed: 5, carriedOver: 5, goal: 'ゴール' } };
}

/**
 * 画面が出す「読み込んでいます…」と「まだありません。」の文面を、画面自身から採る。
 * ここに直書きすると、言い回しを変えたときにこの検査が黙って壊れる。
 */
let placeholderCache = null;
function placeholders() {
  if (placeholderCache) return placeholderCache;
  const h = ready();
  h.clickView('一覧');
  const loading = h.textTreeOf('table-view').trim();
  latest(h).handlers.success({ ok: true, name: 'list', view: null, summary: null });
  const notYet = h.textTreeOf('table-view').trim();
  assert.ok(loading.length > 0 && notYet.length > 0 && loading !== notYet,
    '読み込み中と「まだありません」を見分けられない');
  placeholderCache = { loading: loading, notYet: notYet };
  return placeholderCache;
}

/** #table-view が今どの状態にあるかを、描かれたものだけから読む。 */
function tableShape(h) {
  if (h.childClassesOf('table-view').length === 0) return 'empty';
  const text = h.textTreeOf('table-view').trim();
  const p = placeholders();
  if (text === p.loading) return 'loading';
  if (text === p.notYet) return 'notYet';
  return 'data';
}

/** #message が今どの状態にあるかを、文面ではなく種別と空かどうかで読む。 */
function messageShape(h) {
  if (h.classOf('message') === 'error') return 'error';
  return h.textOf('message') === '' ? 'idle' : 'busy';
}

/**
 * 応答の届き方。ビューを読みに行ってから応答が返るまでの間に何が起きうるか。
 *
 * settle は「その読み取りの応答を届ける」。staleView / staleWrite は、届ける前に
 * 別のことを起こして、その応答を捨てるべきものにする。
 */
const DELIVERIES = {
  /** 成功して中身が届く。 */
  ok: {
    settle: function (h, call, view) { call.handlers.success(okResponse(h, view)); },
    table: function (view, before) { return view === 'board' ? before : 'data'; },
    message: 'idle',
  },
  /** 成功したが元データが無い（バーンダウン等）。盤面はこの形を返さない。 */
  empty: {
    views: function (view) { return view !== 'board'; },
    settle: function (h, call) { call.handlers.success({ ok: true, name: 'x', view: null, summary: null }); },
    table: function () { return 'notYet'; },
    message: 'idle',
  },
  /** 読めなかったことが確定した。 */
  ng: {
    settle: function (h, call) { call.handlers.success({ ok: false, name: 'x', message: '読めません' }); },
    table: foldedFrom,
    message: 'error',
  },
  /** 通信が切れた。 */
  down: {
    settle: function (h, call) { call.handlers.failure({ message: 'ネットワーク' }); },
    table: foldedFrom,
    message: 'error',
  },
  /** 届く前に読み直していた（viewSeq 不一致）。捨てるので画面は動かない。 */
  staleView: {
    before: function (h) { h.click('reload'); },
    settle: function (h, call, view) { call.handlers.success(okResponse(h, view)); },
    table: function (view, before) { return before; },
    message: 'busy',
  },
  /** 届く前に書き込みが確定していた（writeSeq 不一致）。もう古いので描かない。 */
  staleWrite: {
    before: function (h, arm) {
      assert.ok(arm.length > 0, '確定させる書き込みが残っていません');
      arm.shift().handlers.success({ ok: true, board: h.boardOf(INITIAL) });
    },
    settle: function (h, call, view) { call.handlers.success(okResponse(h, view)); },
    table: foldedFrom,
    message: 'error',
  },
};

/** 読み込み中表示だけを畳む（実データや「まだありません」はそのまま残す）。 */
function foldedFrom(view, before) { return before === 'loading' ? 'empty' : before; }

const DELIVERY_NAMES = Object.keys(DELIVERIES);

/** その手番でその届き方が起こりうるか。 */
function applies(name, view) {
  const d = DELIVERIES[name];
  return !d.views || d.views(view);
}

/**
 * 1手番: to のビューを選び、その読み取りに delivery の届き方をさせる。
 * 期待する #table-view の形と #message の種別を、実際の画面と突き合わせる。
 */
function turn(h, from, to, deliveryName, arm, trace) {
  const d = DELIVERIES[deliveryName];
  const kind = navigate(h, from, to);
  // 「最新にする」は showView() を経由しないので、読み込み中表示は立ち直らない。
  const afterNav = (kind === 'reload' || to === 'board') ? tableShape(h) : 'loading';
  assert.equal(tableShape(h), afterNav, trace + ' 選んだ直後の #table-view');
  assert.equal(h.hiddenOf('board'), to !== 'board', trace + ' 選んだ直後の #board の hidden');
  assert.equal(h.hiddenOf('table-view'), to === 'board', trace + ' 選んだ直後の #table-view の hidden');
  assert.equal(messageShape(h), 'busy', trace + ' 選んだ直後の #message');

  const call = latest(h);
  assert.deepEqual(call.args, [to], trace + ' 読みに行ったビュー');
  if (d.before) d.before(h, arm);
  d.settle(h, call, to);

  const expected = d.table(to, afterNav);
  assert.equal(tableShape(h), expected, trace + ' 応答のあとの #table-view');
  assert.equal(messageShape(h), d.message, trace + ' 応答のあとの #message');
  assert.equal(h.hiddenOf('board'), to !== 'board', trace + ' 応答は表示先を動かさない (#board)');
  assert.equal(h.hiddenOf('table-view'), to === 'board', trace + ' 応答は表示先を動かさない (#table-view)');
  return expected;
}

test('どのビューからどのビューへ、どんな応答の届き方でも、読み込み中表示と表示先が食い違わない', () => {
  // 7ビュー × 7ビュー × 届き方6種 × 届き方6種（盤面に「元データ無し」は無いので実数は
  // 41 × 41 = 1681 通り）。各手番で #table-view の中身・#board / #table-view の hidden・
  // #message の種別を照合する。
  let scenarios = 0;
  VIEWS.forEach(function (a) {
    DELIVERY_NAMES.forEach(function (d1) {
      if (!applies(d1, a.view)) return;
      VIEWS.forEach(function (b) {
        DELIVERY_NAMES.forEach(function (d2) {
          if (!applies(d2, b.view)) return;
          const trace = '[' + a.view + '/' + d1 + ' → ' + b.view + '/' + d2 + ']';
          const h = ready();
          // writeSeq を進めるための書き込みを2つ用意しておく（盤面が見えている今しか
          // 始められない）。staleWrite の手番が1つ取り出して確定させる。
          h.drag('PBI-001', 'Ready');
          const arm = [latest(h)];
          h.drag('PBI-002', 'Ready');
          arm.push(latest(h));

          turn(h, 'board', a.view, d1, arm, trace + ' 1手目');
          turn(h, a.view, b.view, d2, arm, trace + ' 2手目');
          scenarios++;
        });
      });
    });
  });
  assert.equal(scenarios, 41 * 41, '想定した組み合わせ数と違う');
});

test('書き込みが重なっても、読み込み中表示と表示先は食い違わない', () => {
  // 上の表は「読み取りの届き方」を尽くしている。こちらは書き込み側の経路
  // （ドラッグ・保存・作成・削除・取り消し）が読み取りと重なる場合。
  const writes = [
    { name: 'ドラッグ', start: function (h) { h.drag('PBI-001', 'Ready'); },
      ok: function (h) { return { ok: true, board: h.boardOf(INITIAL) }; } },
    { name: '保存', start: function (h) { h.openCard('PBI-001'); h.setValue('f-title', 'A2'); h.click('panel-save'); },
      ok: function (h) { return { ok: true, id: 'PBI-001', board: h.boardOf(INITIAL) }; } },
    { name: '作成', start: function (h) { h.clickAdd('New'); h.setValue('f-title', '新規'); h.click('panel-save'); },
      ok: function (h) { return { ok: true, id: 'PBI-003', board: h.boardOf(INITIAL) }; } },
    { name: '削除', start: function (h) { h.openCard('PBI-001'); h.click('panel-delete'); },
      ok: function (h) { return { ok: true, id: null,
        removed: { id: 'PBI-001', title: 'A', updated_at: 'T1' }, board: h.boardOf(INITIAL) }; } },
  ];

  writes.forEach(function (w) {
    // (a) 書き込みの送信中に表のビューを読み、書き込みが先に確定する
    //     → その読み取りはもう古い。読み込み中表示は畳んで知らせる。
    const h1 = ready();
    w.start(h1);
    const write1 = latest(h1);
    h1.clickView('一覧');
    const read1 = latest(h1);
    write1.handlers.success(w.ok(h1));
    read1.handlers.success(okResponse(h1, 'list'));
    assert.equal(tableShape(h1), 'empty', w.name + ': 古い読み取りが描かれた');
    assert.equal(messageShape(h1), 'error', w.name + ': 古い読み取りを黙って捨てている');
    assert.equal(h1.hiddenOf('table-view'), false, w.name + ': 表示先が動いた');

    // (b) 読み取りが先に確定してから書き込みが確定する → 読み取りは有効。
    const h2 = ready();
    w.start(h2);
    const write2 = latest(h2);
    h2.clickView('一覧');
    const read2 = latest(h2);
    read2.handlers.success(okResponse(h2, 'list'));
    assert.equal(tableShape(h2), 'data', w.name + ': 有効な読み取りが描かれていない');
    write2.handlers.success(w.ok(h2));
    assert.equal(tableShape(h2), 'data', w.name + ': 書き込みの応答が表を消した');
    assert.equal(h2.hiddenOf('board'), true, w.name + ': 書き込みの応答が盤面を出し戻した');
  });
});

test('削除の取り消しが読み取りと重なっても、読み込み中表示と表示先は食い違わない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-delete');
  latest(h).handlers.success({ ok: true, id: null,
    removed: { id: 'PBI-001', title: 'A', updated_at: 'T1' }, board: h.boardOf(INITIAL) });
  assert.equal(h.hiddenOf('toast'), false, '取り消しの通知が出ていない');

  h.click('toast-undo');
  const undo = latest(h);
  assert.equal(undo.method, 'apiRestorePbi');

  h.clickView('一覧');
  const read = latest(h);
  undo.handlers.success({ ok: true, board: h.boardOf(INITIAL) });   // writeSeq が進む
  read.handlers.success(okResponse(h, 'list'));

  assert.equal(tableShape(h), 'empty', '取り消しより古い読み取りが描かれた');
  assert.equal(messageShape(h), 'error', '古い読み取りを黙って捨てている');
  assert.equal(h.hiddenOf('table-view'), false, '表示先が動いた');
});
