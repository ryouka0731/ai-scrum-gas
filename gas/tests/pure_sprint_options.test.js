const test = require('node:test');
const assert = require('node:assert/strict');
const { sprintOptions } = require('../pure_sprint_options.js');

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
