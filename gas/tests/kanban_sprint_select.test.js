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

// ---------------------------------------------------------------------------
// 読み込みの後に現れたスプリント
//
// 盤面を読み込んだ後に別の書き手（ローカルの Claude Code 等）が新しいスプリント名を
// 付けると、その値はサーバが返した選択肢に入っていない。足さないとパネルは
// 「（未割り当て）」と表示し、利用者はそれを信じて選び直してしまう — 値が黙って消える
// のではなく、誤った表示を信じて自分で上書きさせる形になる。
// ---------------------------------------------------------------------------

// 選択肢が届いた後に、書き込み系の応答が運んできたカード（新しいスプリント付き）。
const CARD_LATE = { id: 'PBI-050', title: 'あとから来た', sprint: 'sprint999', updated_at: 'T1' };
const LATE_BOARD = cols({ New: [CARD_A, CARD_GHOST, CARD_PADDED, CARD_LATE] });

/** 選択肢を受け取った後に、選択肢に無いスプリントのカードが盤面へ現れた状態を作る。 */
function readyWithLateSprint() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL), sprintChoices: CHOICES });
  // ドラッグの応答が、選択肢に無いスプリントを持つカードごと board を運んでくる。
  h.drag('PBI-001', 'Ready');
  h.calls[h.calls.length - 1].handlers.success({ ok: true, board: h.boardOf(LATE_BOARD) });
  return h;
}

test('選択肢に無い今の値も選択肢に足され、選ばれた状態で出る', () => {
  const h = readyWithLateSprint();
  h.openCard('PBI-050');
  assert.equal(h.valueOf('f-sprint'), 'sprint999',
    '選択肢に無い今の値が「（未割り当て）」に化けている');
  assert.ok(h.optionsOf('f-sprint').some(function (o) { return o.value === 'sprint999'; }),
    '今の値が選択肢に足されていない');
});

test('画面が足した選択肢のラベルは「velocity.csv に無い」と言わない', () => {
  // 読み込みの後に足されたスプリントは velocity.csv に「ある」かもしれない。
  // 「velocity.csv に無い」と書くと嘘になる。
  const h = readyWithLateSprint();
  h.openCard('PBI-050');
  const added = h.optionsOf('f-sprint').filter(function (o) { return o.value === 'sprint999'; })[0];
  assert.equal(added.label.indexOf('velocity.csv'), -1,
    '確かめていないことを書いている: ' + added.label);
  assert.notEqual(added.label, 'sprint999', '今の値であることが分からない');
});

test('サーバ由来の選択肢と、画面が足した選択肢はラベルが異なる', () => {
  // 2つは意味が違う。サーバの unknown は「velocity.csv に無い＝ロードマップに出ない」という
  // データの質の恒常的な情報。画面が足すほうは「この画面がまだ知らない。読み込み直せば
  // 分かる」という一時的な状態。片方を直すときにもう片方へ揃えたくなる力が働くので、
  // 同じ文言に収束しないようここで止める。
  const h = readyWithLateSprint();
  h.openCard('PBI-050');
  const label = function (value) {
    const hit = h.optionsOf('f-sprint').filter(function (o) { return o.value === value; });
    assert.equal(hit.length, 1, value + ' の選択肢が ' + hit.length + ' 件');
    return hit[0].label;
  };
  // 値の部分を除いた注記どうしを比べる（値そのものは当然違うため）。
  const note = function (value) { return label(value).slice(value.length); };
  const fromServer = note('sprint 999');   // sprintChoices が unknown 付きで返したもの
  const fromClient = note('sprint999');    // 画面が今の値として足したもの
  assert.notEqual(fromClient, fromServer,
    '2つのラベルが同じ文言に揃っている（意味の違いが潰れている）: ' + fromClient);
  assert.ok(fromServer.indexOf('velocity.csv') !== -1, '前提: サーバ側のラベルが変わっている');
  assert.ok(fromClient.length > 0, '画面が足した選択肢に注記が無い');
});

test('選択肢に無いスプリントの行は、触らなければ保存で sprint を送らない', () => {
  // 表示が誤っていても値は失われない、を固定する（差分送信）。
  const h = readyWithLateSprint();
  h.openCard('PBI-050');
  h.setValue('f-title', 'あとから来た かいへん');
  h.click('panel-save');
  const fields = h.calls[h.calls.length - 1].args[1];
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'sprint'), false,
    '触っていないスプリントを送っている（元の値が書き換わる）');
  assert.equal(fields.title, 'あとから来た かいへん');
});

test('選択肢に無いスプリントの行をドラッグしても、送るのはステータスだけ', () => {
  const h = readyWithLateSprint();
  h.drag('PBI-050', 'Review');
  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdateStatus');
  assert.deepEqual(call.args.slice(0, 2), ['PBI-050', 'Review']);
});

test('選択肢に無いスプリントの行でも、未割り当てへ戻す操作が届く', () => {
  // 今の値が選択肢に無いままだと、基準が「（未割り当て）」になり、未割り当てを選び直しても
  // 差分が出ない＝無言で無視される（表示は前後とも同じなので気づけない）。
  const h = readyWithLateSprint();
  h.openCard('PBI-050');
  h.setValue('f-sprint', '');
  h.click('panel-save');
  const fields = h.calls[h.calls.length - 1].args[1];
  assert.equal(Object.prototype.hasOwnProperty.call(fields, 'sprint'), true,
    '未割り当てを選び直したのに sprint を送っていない（無言の no-op）');
  assert.equal(fields.sprint, '');
});

test('選択肢に無いスプリントの行で、別のスプリントを選べば送られる', () => {
  const h = readyWithLateSprint();
  h.openCard('PBI-050');
  h.setValue('f-sprint', 'sprint001');
  h.click('panel-save');
  assert.equal(h.calls[h.calls.length - 1].args[1].sprint, 'sprint001');
});

test('今の値が選択肢にあるときは、余計な選択肢を足さない', () => {
  const h = ready(CHOICES);
  h.openCard('PBI-001');   // sprint001 は選択肢にある
  assert.deepEqual(h.optionsOf('f-sprint').map(function (o) { return o.value; }),
    CHOICES.map(function (o) { return o.value; }), '選択肢が増えている');
});

test('スプリントが空のカードでは、空の選択肢を足さない', () => {
  const empty = cols({ New: [{ id: 'PBI-060', title: 'なし', updated_at: 'T1' }] });
  const h = createHarness(empty);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(empty), sprintChoices: CHOICES });
  h.openCard('PBI-060');
  assert.equal(h.optionsOf('f-sprint').length, CHOICES.length, '空の選択肢が増えている');
  assert.equal(h.valueOf('f-sprint'), '');
});
