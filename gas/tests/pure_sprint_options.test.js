const test = require('node:test');
const assert = require('node:assert/strict');
const { sprintOptions, sprintChoices } = require('../pure_sprint_options.js');

const VEL = [
  { sprint: 'sprint002', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  { sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
  // 手書きの CSV では前後に空白が残る。選択肢は trim 済みの名前で出す
  // （揃えないと、PBI 側の trim 済みの値と一致せず選択肢が2つに割れる）。
  { sprint: ' sprint003 ', sprint_start: '2026-09-15', sprint_end: '2026-09-28' },
  { sprint: '（未設定）', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' },
];

test('先頭は必ず未割り当て（空文字）', () => {
  const o = sprintOptions(VEL);
  assert.equal(o[0].value, '');
  assert.ok(o[0].label.length > 0);
  assert.equal(o[0].unknown, false);
});

test('velocity.csv の行順に従う（名前で並べ替えない）', () => {
  // realSprints は絞り込むだけで並べ替えない。行順はスプリントの時系列そのもの。
  const o = sprintOptions(VEL);
  assert.deepEqual(o.slice(1).map((x) => x.value), ['sprint002', 'sprint001', 'sprint003']);
});

test('日付が埋まっていない雛形行は選択肢に出ない', () => {
  const o = sprintOptions(VEL);
  assert.equal(o.some((x) => x.value === '（未設定）'), false);
});

test('velocity.csv が空でも未割り当てだけは出る', () => {
  assert.deepEqual(sprintOptions([]).map((x) => x.value), ['']);
  assert.deepEqual(sprintOptions(null).map((x) => x.value), ['']);
});

// ---------------------------------------------------------------------------
// sprintChoices: 画面へ渡す「完成した選択肢」
//
// 「今の値が選択肢に無ければ足す」規則を画面側に残すと、その分だけ規則の写しが
// ブラウザに残り、サーバ側だけを直したときに黙ってずれる。ここで完成させる。
// ---------------------------------------------------------------------------

const ROWS = [
  { id: 'PBI-001', title: 'A', sprint: 'sprint001' },
  { id: 'PBI-002', title: 'B', sprint: 'ゆうれい' },
  { id: 'PBI-003', title: 'C', sprint: '  ゆうれい  ' },   // 前後の空白は同じものとして扱う
  { id: 'PBI-004', title: 'D', sprint: '' },
];

test('sprintChoices は velocity.csv の選択肢に、PBI 側の未知のスプリントを足す', () => {
  const o = sprintChoices(VEL, ROWS);
  assert.deepEqual(o.map((x) => x.value), ['', 'sprint002', 'sprint001', 'sprint003', 'ゆうれい']);
  assert.deepEqual(o.map((x) => x.unknown), [false, false, false, false, true]);
  assert.ok(o[4].label.indexOf('velocity.csv に無い') !== -1);
});

test('sprintChoices は同じ未知のスプリントを1度だけ足す', () => {
  assert.equal(sprintChoices(VEL, ROWS).filter((x) => x.value === 'ゆうれい').length, 1);
});

test('sprintChoices は velocity.csv にあるスプリントを重ねない', () => {
  assert.equal(sprintChoices(VEL, ROWS).filter((x) => x.value === 'sprint001').length, 1);
});

test('sprintChoices は雛形の行を選択肢にしない', () => {
  // 空タイトル等の雛形行（filterRealRows が落とす）から幽霊スプリントを作らない。
  const withPlaceholder = ROWS.concat([{ id: '', title: '', sprint: 'まぼろし' }]);
  assert.equal(sprintChoices(VEL, withPlaceholder).some((x) => x.value === 'まぼろし'), false);
});

test('sprintChoices は PBI が無くても未割り当てと velocity.csv の分を返す', () => {
  assert.deepEqual(sprintChoices(VEL, []).map((x) => x.value), ['', 'sprint002', 'sprint001', 'sprint003']);
  assert.deepEqual(sprintChoices(VEL, null).map((x) => x.value), ['', 'sprint002', 'sprint001', 'sprint003']);
});

test('sprintChoices は velocity.csv が空でも PBI 側の名前を拾う', () => {
  // velocity.csv が読めない日でも、今そこにある値は選び直せる。
  assert.deepEqual(sprintChoices([], ROWS).map((x) => x.value), ['', 'sprint001', 'ゆうれい']);
});

test('velocity.csv に同じスプリントが2行あっても選択肢は1つ', () => {
  // 追記の重複や手直しで同じ名前が並ぶことがある。同じ選択肢を2つ出さない。
  const dup = VEL.concat([{ sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }]);
  assert.equal(sprintOptions(dup).filter((x) => x.value === 'sprint001').length, 1);
  assert.equal(sprintChoices(dup, []).filter((x) => x.value === 'sprint001').length, 1);
});

test('日付が YYYY-MM-DD でない行は選択肢に出ない（ロードマップの判定と同じ）', () => {
  // 判定は realSprints（buildRoadmapGrid と共有）。ここが緩むと、ロードマップには
  // 出るのに選択肢には出ないスプリントが生まれ、プルダウンにした目的が裏返る。
  const slashed = [{ sprint: 'sprint003', sprint_start: '2026/09/15', sprint_end: '2026/09/28' }];
  assert.deepEqual(sprintOptions(slashed).map((x) => x.value), ['']);
  assert.deepEqual(sprintChoices(slashed, []).map((x) => x.value), ['']);
});

test('velocity.csv の名前に前後の空白があっても、PBI 側の同じ名前と1つにまとまる', () => {
  // 揃えないと、velocity.csv 側の 'sprint001 ' と PBI 側の 'sprint001' が別物になり、
  // 「sprint001 」と「sprint001（velocity.csv に無い）」の2つがパネルに並ぶ
  // （後者は嘘の注記。その PBI は実際にはロードマップに出る）。
  const vel = [{ sprint: 'sprint001 ', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }];
  const rows = [{ id: 'PBI-001', title: 'A', sprint: 'sprint001' }];
  assert.deepEqual(sprintChoices(vel, rows).map((x) => x.value), ['', 'sprint001']);
  assert.deepEqual(sprintChoices(vel, rows).map((x) => x.unknown), [false, false]);
});

test('表記が揺れていても、ロードマップに出るスプリントに「無い」と書かない', () => {
  // product_backlog.csv は "Sprint 001"、velocity.csv は "sprint001" と書く（実データ）。
  // 生の文字列で突き合わせると、ロードマップには帯が出ているのに選択肢では
  // 「velocity.csv に無い」と書かれる。判定はロードマップと同じ normalizeSprint で行う。
  const vel = [{ sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }];
  const rows = [{ id: 'PBI-001', title: 'A', sprint: 'Sprint 001' }];
  const o = sprintChoices(vel, rows);
  assert.deepEqual(o.map((x) => x.unknown), [false, false, false],
    'ロードマップに出るスプリントに「velocity.csv に無い」が付いている: ' + JSON.stringify(o));
  // value は PBI に入っている生の値のまま。ここを正規化すると、その PBI を開いた
  // ときに `<select>` が一致する選択肢を見つけられず、選択済みにならない。
  assert.deepEqual(o.map((x) => x.value), ['', 'sprint001', 'Sprint 001']);
});

test('表記が揺れた未知のスプリントは、2つ目も「velocity.csv に無い」のまま', () => {
  // 足した未知の名前を「在るもの」として控えると、綴り違いの2つ目だけ注記が消える。
  const rows = [
    { id: 'PBI-001', title: 'A', sprint: 'ゆうれい 1' },
    { id: 'PBI-002', title: 'B', sprint: 'ゆうれい1' },
  ];
  assert.deepEqual(sprintChoices([], rows).map((x) => x.unknown), [false, true, true]);
});

test('スプリント名が __proto__ でも選択肢は重ならない', () => {
  // 素の `{}` に `seen['__proto__'] = true` を入れても own property にならず、
  // 重複の判定が常に素通りする（同じ選択肢が行の数だけ並ぶ）。名前は CSV 由来。
  const vel = [
    { sprint: '__proto__', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
    { sprint: '__proto__', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  ];
  assert.deepEqual(sprintOptions(vel).map((x) => x.value), ['', '__proto__']);

  const rows = [
    { id: 'PBI-001', title: 'A', sprint: '__proto__' },
    { id: 'PBI-002', title: 'B', sprint: '__proto__' },
  ];
  assert.deepEqual(sprintChoices([], rows).map((x) => x.value), ['', '__proto__']);
  // velocity.csv 側にある __proto__ を、PBI 側からもう一度足さない。
  assert.deepEqual(sprintChoices(vel, rows).map((x) => x.value), ['', '__proto__']);
});
