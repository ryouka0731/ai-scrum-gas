'use strict';
// パネルのスプリント欄をプルダウンにした（Task 8 Step 5）ことの検査。
//
// 自由入力だと打ち間違いが幽霊スプリントを作り、velocity.csv に無い名前を書くと
// その PBI はロードマップから黙って消える。真実の源泉は velocity.csv なので、
// そこから選ばせる。選択肢の元になる行は盤面の応答が運ぶ（パネルを開くたびに
// サーバへ往復させない）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');
const { sprintOptions } = require('../pure_sprint_options.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function cols(placed) {
  return STATUSES.map(function (s) { return { status: s, cards: (placed || {})[s] || [] }; });
}

const CARD_A = { id: 'PBI-001', title: 'A', sprint: 'sprint001', updated_at: 'T1' };
// velocity.csv に無いスプリントを持つ行（ローカルの Claude Code が直接書いた等）。
const CARD_GHOST = { id: 'PBI-009', title: 'ゆうれい', sprint: 'sprint 999', updated_at: 'T1' };
const INITIAL = cols({ New: [CARD_A, CARD_GHOST] });

const VELOCITY = [
  { sprint: 'sprint002', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  { sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
  // 日付が埋まっていない雛形行。実在しないので選択肢に出さない。
  { sprint: '（未設定）', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' },
];

/** 初期読み込み（盤面）を済ませたハーネスを返す。 */
function ready(velocityRows) {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  const res = { ok: true, view: h.boardOf(INITIAL) };
  if (velocityRows !== undefined) res.velocityRows = velocityRows;
  h.calls[0].handlers.success(res);
  return h;
}

// vm コンテキストの配列・オブジェクトは別レルムのため deepEqual が prototype で弾く。
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------------------
// 選択肢の組み立ての写し
// ---------------------------------------------------------------------------

test('kanban.html の sprintOptions は pure_sprint_options.js と同じ結果を返す', () => {
  // GAS のサーバ側 .js はブラウザから呼べないため、kanban.html に写しを持っている。
  // 写しが黙ってずれると、画面が出す選択肢だけが本体の規則から外れる。
  const h = createHarness(INITIAL);
  h.sandbox.load();
  const cases = [
    [VELOCITY, ''],
    [VELOCITY, 'sprint001'],
    [VELOCITY, 'sprint 999'],
    [VELOCITY, '  sprint001  '],
    [[], ''],
    [null, 'sprint001'],
  ];
  cases.forEach(function (c) {
    assert.deepEqual(plain(h.sandbox.sprintOptions(c[0], c[1])), plain(sprintOptions(c[0], c[1])),
      '写しの結果が本体と違う: ' + JSON.stringify(c[1]));
  });
});

// ---------------------------------------------------------------------------
// パネルの選択肢
// ---------------------------------------------------------------------------

test('スプリント欄はプルダウンで、自由入力ではない', () => {
  // 自由入力に戻ると打ち間違いが幽霊スプリントを作る。シムは <input> にも
  // <option> を足せてしまうので、選択肢の中身だけでは自由入力と見分けられない。
  const h = ready(VELOCITY);
  assert.equal(h.tagOf('f-sprint'), 'select', 'スプリント欄が自由入力のままになっている');
});

test('スプリント欄は velocity.csv の行順で選択肢を出す（先頭は未割り当て）', () => {
  const h = ready(VELOCITY);
  h.openCard('PBI-001');
  assert.deepEqual(h.optionsOf('f-sprint').map(function (o) { return o.value; }),
    ['', 'sprint002', 'sprint001'], 'velocity.csv の行順になっていない');
  assert.equal(h.optionsOf('f-sprint')[0].label, '（未割り当て）');
  assert.equal(h.valueOf('f-sprint'), 'sprint001', '今のスプリントが選ばれていない');
});

test('日付が埋まっていない雛形行は選択肢に出ない', () => {
  const h = ready(VELOCITY);
  h.openCard('PBI-001');
  assert.equal(h.optionsOf('f-sprint').some(function (o) { return o.value === '（未設定）'; }), false);
});

test('velocity.csv に無い今の値も選択肢に残り、その旨がラベルに出る', () => {
  // 既存値を黙って失わせない。開いて保存しただけでスプリントが消えるのを防ぐ。
  const h = ready(VELOCITY);
  h.openCard('PBI-009');
  const last = h.optionsOf('f-sprint').pop();
  assert.equal(last.value, 'sprint 999', 'velocity.csv に無い今の値が選択肢から消えている');
  assert.ok(last.label.indexOf('velocity.csv に無い') !== -1,
    'velocity.csv に無い選択肢が見分けられない: ' + last.label);
  assert.equal(h.valueOf('f-sprint'), 'sprint 999', '今の値が選ばれていない');
});

test('パネルを開いてもサーバへ往復しない（選択肢は盤面の応答が運ぶ）', () => {
  const h = ready(VELOCITY);
  const before = h.calls.length;
  h.openCard('PBI-001');
  assert.equal(h.calls.length, before, 'パネルを開くだけでサーバを呼んでいる');
  assert.ok(h.optionsOf('f-sprint').length > 1, '選択肢が組み立てられていない');
});

test('選んだスプリントがそのままサーバへ送られる', () => {
  const h = ready(VELOCITY);
  h.openCard('PBI-001');
  h.setValue('f-sprint', 'sprint002');
  h.click('panel-save');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdatePbi');
  assert.equal(call.args[1].sprint, 'sprint002', '選んだスプリントが送られていない');
});

test('velocity.csv が読めなくても未割り当ては選べる', () => {
  const h = ready([]);
  h.clickAdd('New');
  assert.deepEqual(h.optionsOf('f-sprint').map(function (o) { return o.value; }), ['']);
  assert.equal(h.valueOf('f-sprint'), '');
});

test('選択肢を運ばない応答（一覧など）で、集めた選択肢を失わない', () => {
  // 一覧・ロードマップの応答は velocityRows を運ばない。そこで空にしてしまうと、
  // 一覧を見てから盤面へ戻ってパネルを開いた人だけ選択肢を失う。
  const h = ready(VELOCITY);
  h.clickView('一覧');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'list', view: { columns: [{ field: 'id', label: 'ID' }], rows: [] }
  });
  h.clickView('盤面');
  h.calls[h.calls.length - 1].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL) });

  h.openCard('PBI-001');
  assert.deepEqual(h.optionsOf('f-sprint').map(function (o) { return o.value; }),
    ['', 'sprint002', 'sprint001'], '選択肢が失われている');
});
