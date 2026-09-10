'use strict';
// パネルのスプリント欄をプルダウンにした（Task 8 Step 5）ことの検査。
//
// 自由入力だと打ち間違いが幽霊スプリントを作り、velocity.csv に無い名前を書くと
// その PBI はロードマップから黙って消える。真実の源泉は velocity.csv なので、
// そこから選ばせる。
//
// 選択肢の組み立ては**サーバ側だけ**にある（pure_sprint_options.js の sprintChoices）。
// 画面は盤面の応答が運んできたものを並べて選ぶだけ。組み立ての規則を画面に写すと、
// サーバ側だけを直したときに黙ってずれる（velocity.csv の日付判定を緩めると、
// ロードマップには出るのに選択肢には出ないスプリントが生まれる）。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

function cols(placed) {
  return STATUSES.map(function (s) { return { status: s, cards: (placed || {})[s] || [] }; });
}

const CARD_A = { id: 'PBI-001', title: 'A', sprint: 'sprint001', updated_at: 'T1' };
// velocity.csv に無いスプリントを持つ行（ローカルの Claude Code が直接書いた等）。
const CARD_GHOST = { id: 'PBI-009', title: 'ゆうれい', sprint: 'sprint 999', updated_at: 'T1' };
// CSV は前後の空白を落とさない。選択肢の value は trim 済みなので、揃わないと化ける。
const CARD_PADDED = { id: 'PBI-010', title: 'すきま', sprint: '  sprint001  ', updated_at: 'T1' };
const INITIAL = cols({ New: [CARD_A, CARD_GHOST, CARD_PADDED] });

// サーバ（sprintChoices）が完成させて返す形。velocity.csv の行順のまま、
// velocity.csv に無い PBI 側の名前が末尾に unknown 付きで続く。
const CHOICES = [
  { value: '', label: '（未割り当て）', unknown: false },
  { value: 'sprint002', label: 'sprint002', unknown: false },
  { value: 'sprint001', label: 'sprint001', unknown: false },
  { value: 'sprint 999', label: 'sprint 999（velocity.csv に無い）', unknown: true },
];

/** 初期読み込み（盤面）を済ませたハーネスを返す。 */
function ready(choices) {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  const res = { ok: true, view: h.boardOf(INITIAL) };
  if (choices !== undefined) res.sprintChoices = choices;
  h.calls[0].handlers.success(res);
  return h;
}

// ---------------------------------------------------------------------------
// 組み立ての規則が画面に残っていないこと
// ---------------------------------------------------------------------------

test('画面は選択肢を組み立てない（写しを持たない）', () => {
  // サーバ側だけを直したときに黙ってずれる面を無くすため、規則そのものを置かない。
  // 標本一致の検査では、標本に無い入力（重複行・別形式の日付）ですり抜ける。
  const h = createHarness(INITIAL);
  h.sandbox.load();
  ['sprintOptions', 'realSprints', 'ROADMAP_DATE_RE', 'SPRINT_UNASSIGNED_LABEL']
    .forEach(function (name) {
      assert.equal(h.sandbox[name], undefined, name + ' の写しが画面に残っている');
    });
});

// ---------------------------------------------------------------------------
// パネルの選択肢
// ---------------------------------------------------------------------------

test('スプリント欄はプルダウンで、自由入力ではない', () => {
  // 自由入力に戻ると打ち間違いが幽霊スプリントを作る。シムは <input> にも
  // <option> を足せてしまうので、選択肢の中身だけでは自由入力と見分けられない。
  const h = ready(CHOICES);
  assert.equal(h.tagOf('f-sprint'), 'select', 'スプリント欄が自由入力のままになっている');
});

test('スプリント欄はサーバが返した選択肢をその順で出す', () => {
  const h = ready(CHOICES);
  h.openCard('PBI-001');
  assert.deepEqual(h.optionsOf('f-sprint').map(function (o) { return o.value; }),
    ['', 'sprint002', 'sprint001', 'sprint 999'], 'サーバが返した順になっていない');
  assert.equal(h.optionsOf('f-sprint')[0].label, '（未割り当て）');
  assert.equal(h.valueOf('f-sprint'), 'sprint001', '今のスプリントが選ばれていない');
});

test('velocity.csv に無い値は、その旨がラベルに出る', () => {
  const h = ready(CHOICES);
  h.openCard('PBI-009');
  assert.equal(h.valueOf('f-sprint'), 'sprint 999', '今の値が選ばれていない');
  const chosen = h.optionsOf('f-sprint').filter(function (o) { return o.value === 'sprint 999'; })[0];
  assert.ok(chosen.label.indexOf('velocity.csv に無い') !== -1,
    'velocity.csv に無い選択肢が見分けられない: ' + chosen.label);
});

test('前後に空白のあるスプリントも、そのスプリントとして選ばれる', () => {
  // CSV は前後の空白を落とさないが、選択肢の value は trim 済み。揃えないと
  // パネルだけ「（未割り当て）」に化け、ロードマップ（normalizeSprint で trim）と食い違う。
  const h = ready(CHOICES);
  h.openCard('PBI-010');
  assert.equal(h.valueOf('f-sprint'), 'sprint001',
    '前後に空白のあるスプリントが未割り当てに化けている');
});

test('前後に空白のあるスプリントを触らずに保存しても、スプリントを送らない', () => {
  // 表示の揃え方を間違えても値を失わないことを固定する（差分送信）。
  const h = ready(CHOICES);
  h.openCard('PBI-010');
  h.setValue('f-title', 'すきま かいへん');
  h.click('panel-save');
  const fields = h.calls[h.calls.length - 1].args[1];
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'sprint'), false,
    '触っていないスプリントを送っている（元の値が書き換わる）');
});

test('パネルを開いてもサーバへ往復しない（選択肢は盤面の応答が運ぶ）', () => {
  const h = ready(CHOICES);
  const before = h.calls.length;
  h.openCard('PBI-001');
  assert.equal(h.calls.length, before, 'パネルを開くだけでサーバを呼んでいる');
  assert.ok(h.optionsOf('f-sprint').length > 1, '選択肢が並んでいない');
});

test('選んだスプリントがそのままサーバへ送られる', () => {
  const h = ready(CHOICES);
  h.openCard('PBI-001');
  h.setValue('f-sprint', 'sprint002');
  h.click('panel-save');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdatePbi');
  assert.equal(call.args[1].sprint, 'sprint002', '選んだスプリントが送られていない');
});

test('選択肢が1件も届かなくても、パネルは開ける', () => {
  const h = ready([]);
  h.clickAdd('New');
  assert.equal(h.hiddenOf('panel'), false);
  assert.deepEqual(h.optionsOf('f-sprint'), []);
});

test('選択肢を運ばない応答（一覧など）で、集めた選択肢を失わない', () => {
  // 一覧・ロードマップの応答は sprintChoices を運ばない。そこで空にしてしまうと、
  // 一覧を見てから盤面へ戻ってパネルを開いた人だけ選択肢を失う。
  const h = ready(CHOICES);
  h.clickView('一覧');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'list', view: { columns: [{ field: 'id', label: 'ID' }], rows: [] }
  });
  h.clickView('盤面');
  h.calls[h.calls.length - 1].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL) });

  h.openCard('PBI-001');
  assert.deepEqual(h.optionsOf('f-sprint').map(function (o) { return o.value; }),
    ['', 'sprint002', 'sprint001', 'sprint 999'], '選択肢が失われている');
});
