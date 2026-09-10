const test = require('node:test');
const assert = require('node:assert/strict');
const { sprintOptions, sprintChoices } = require('../pure_sprint_options.js');

const VEL = [
  { sprint: 'sprint002', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  { sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
  { sprint: '（未設定）', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' },
];

test('先頭は必ず未割り当て（空文字）', () => {
  const o = sprintOptions(VEL, '');
  assert.equal(o[0].value, '');
  assert.ok(o[0].label.length > 0);
  assert.equal(o[0].unknown, false);
});

test('velocity.csv の行順に従う（名前で並べ替えない）', () => {
  // realSprints は絞り込むだけで並べ替えない。行順はスプリントの時系列そのもの。
  const o = sprintOptions(VEL, '');
  assert.deepEqual(o.slice(1).map((x) => x.value), ['sprint002', 'sprint001']);
});

test('日付が埋まっていない雛形行は選択肢に出ない', () => {
  const o = sprintOptions(VEL, '');
  assert.equal(o.some((x) => x.value === '（未設定）'), false);
});

test('velocity.csv に無い今の値は末尾に足され、unknown が立つ', () => {
  const o = sprintOptions(VEL, 'sprint 003');
  const last = o[o.length - 1];
  assert.equal(last.value, 'sprint 003');
  assert.equal(last.unknown, true);
  assert.ok(last.label.indexOf('sprint 003') !== -1);
});

test('velocity.csv にある今の値は重複して足されない', () => {
  const o = sprintOptions(VEL, 'sprint001');
  assert.equal(o.filter((x) => x.value === 'sprint001').length, 1);
  assert.equal(o.some((x) => x.unknown), false);
});

test('今の値が空なら余計な選択肢は増えない', () => {
  assert.equal(sprintOptions(VEL, '').length, 3);
  assert.equal(sprintOptions(VEL, null).length, 3);
  assert.equal(sprintOptions(VEL, undefined).length, 3);
});

test('今の値の前後の空白は無視して比較する', () => {
  const o = sprintOptions(VEL, '  sprint001  ');
  assert.equal(o.some((x) => x.unknown), false);
});

test('velocity.csv が空でも未割り当てだけは出る', () => {
  assert.deepEqual(sprintOptions([], '').map((x) => x.value), ['']);
  assert.deepEqual(sprintOptions(null, '').map((x) => x.value), ['']);
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
  assert.deepEqual(o.map((x) => x.value), ['', 'sprint002', 'sprint001', 'ゆうれい']);
  assert.deepEqual(o.map((x) => x.unknown), [false, false, false, true]);
  assert.ok(o[3].label.indexOf('velocity.csv に無い') !== -1);
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
  assert.deepEqual(sprintChoices(VEL, []).map((x) => x.value), ['', 'sprint002', 'sprint001']);
  assert.deepEqual(sprintChoices(VEL, null).map((x) => x.value), ['', 'sprint002', 'sprint001']);
});

test('sprintChoices は velocity.csv が空でも PBI 側の名前を拾う', () => {
  // velocity.csv が読めない日でも、今そこにある値は選び直せる。
  assert.deepEqual(sprintChoices([], ROWS).map((x) => x.value), ['', 'sprint001', 'ゆうれい']);
});

test('velocity.csv に同じスプリントが2行あっても選択肢は1つ', () => {
  // 追記の重複や手直しで同じ名前が並ぶことがある。同じ選択肢を2つ出さない。
  const dup = VEL.concat([{ sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }]);
  assert.equal(sprintOptions(dup, '').filter((x) => x.value === 'sprint001').length, 1);
  assert.equal(sprintChoices(dup, []).filter((x) => x.value === 'sprint001').length, 1);
});

test('日付が YYYY-MM-DD でない行は選択肢に出ない（ロードマップの判定と同じ）', () => {
  // 判定は realSprints（buildRoadmapGrid と共有）。ここが緩むと、ロードマップには
  // 出るのに選択肢には出ないスプリントが生まれ、プルダウンにした目的が裏返る。
  const slashed = [{ sprint: 'sprint003', sprint_start: '2026/09/15', sprint_end: '2026/09/28' }];
  assert.deepEqual(sprintOptions(slashed, '').map((x) => x.value), ['']);
  assert.deepEqual(sprintChoices(slashed, []).map((x) => x.value), ['']);
});
