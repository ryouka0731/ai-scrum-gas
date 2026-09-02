const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPlaceholderRow, normalizeSprint, filterRealRows, pickLatestSprintName,
} = require('../pure_filter.js');

const real = {
  id: 'PBI-001', title: 'タスクの登録', priority: 'Critical',
  created_at: '2026-08-14', status: 'Ready', sprint: 'Sprint 001',
};

test('実データの行はひな形ではない', () => {
  assert.equal(isPlaceholderRow(real), false);
});

test('id が PBI-数字 でなければひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, id: '' }), true);
  assert.equal(isPlaceholderRow({ ...real, id: 'XXX-1' }), true);
});

test('タイトルが空ならひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, title: '' }), true);
});

test('全角括弧で囲まれたタイトルはひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, title: '（PBIタイトル）' }), true);
});

test('created_at が YYYY-MM-DD のままならひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, created_at: 'YYYY-MM-DD' }), true);
});

test('priority が複合値ならひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, priority: 'Critical/High/Medium/Low' }), true);
});

test('欠けたキーがあっても例外にならない', () => {
  assert.equal(isPlaceholderRow({}), true);
});

test('スプリント名の表記揺れを同一視する', () => {
  const want = 'sprint001';
  ['Sprint 001', 'sprint001', 'sprint-1', 'SPRINT_1', 'sprint 1'].forEach((n) => {
    assert.equal(normalizeSprint(n), want, n);
  });
});

test('連番を3桁ゼロ埋めに揃える', () => {
  assert.equal(normalizeSprint('sprint 12'), 'sprint012');
  assert.equal(normalizeSprint('sprint0012'), 'sprint012');
});

test('空文字は空文字のまま返す', () => {
  assert.equal(normalizeSprint(''), '');
  assert.equal(normalizeSprint(null), '');
});

test('ひな形行を除外する', () => {
  const rows = [real, { ...real, id: 'PBI-002', title: '（PBIタイトル）' }];
  assert.deepEqual(filterRealRows(rows), [real]);
});

test('スプリントフォルダは連番の最大値で選ぶ', () => {
  assert.equal(pickLatestSprintName(['sprint001', 'sprint002', 'sprint010']), 'sprint010');
});

test('ひな形の sprintSAMPLE は選ばない', () => {
  assert.equal(
    pickLatestSprintName(['sprint001', 'sprint002', 'sprint010', 'sprintSAMPLE']),
    'sprint010');
});

test('桁数が不揃いでも数値として比較する', () => {
  assert.equal(pickLatestSprintName(['sprint9', 'sprint10']), 'sprint10');
  assert.equal(pickLatestSprintName(['sprint10', 'sprint9']), 'sprint10');
});

test('該当するフォルダが無ければ null', () => {
  assert.equal(pickLatestSprintName(['sprintSAMPLE', 'scrum', 'sprint', 'sprint001a']), null);
});

test('空配列や未指定でも null を返す', () => {
  assert.equal(pickLatestSprintName([]), null);
  assert.equal(pickLatestSprintName(null), null);
  assert.equal(pickLatestSprintName(undefined), null);
});

test('戻り値は引数に入っていた文字列そのもの（呼び出し側で対応づけられる）', () => {
  const names = ['sprintSAMPLE', 'sprint007'];
  assert.equal(pickLatestSprintName(names), names[1]);
});
