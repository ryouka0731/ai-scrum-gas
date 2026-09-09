const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePbiFields, PBI_PRIORITIES, PBI_EDITABLE_FIELDS } = require('../pure_pbi_validate.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

test('正しい入力は通る', () => {
  const r = validatePbiFields(
    { title: 'カンバンを作る', priority: 'High', size: '5', status: 'Ready' }, STATUSES);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('タイトルが空なら拒否する', () => {
  assert.equal(validatePbiFields({ title: '' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({ title: '   ' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({}, STATUSES).ok, false);
});

test('未知の優先度を拒否する', () => {
  const r = validatePbiFields({ title: 'a', priority: 'Urgent' }, STATUSES);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(m => m.indexOf('優先度') !== -1));
});

test('未知のステータスを拒否する', () => {
  const r = validatePbiFields({ title: 'a', status: 'Blocked' }, STATUSES);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(m => m.indexOf('ステータス') !== -1));
});

test('サイズは空でもよいが、数値以外は拒否する', () => {
  assert.equal(validatePbiFields({ title: 'a', size: '' }, STATUSES).ok, true);
  assert.equal(validatePbiFields({ title: 'a', size: '0' }, STATUSES).ok, true);
  assert.equal(validatePbiFields({ title: 'a', size: '13' }, STATUSES).ok, true);
  assert.equal(validatePbiFields({ title: 'a', size: 'おおきい' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({ title: 'a', size: '-1' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({ title: 'a', size: '1.5' }, STATUSES).ok, false);
});

test('指定しなかった項目は検証しない（部分更新のため）', () => {
  const r = validatePbiFields({ title: 'a' }, STATUSES);
  assert.equal(r.ok, true);
});

test('誤りが複数あれば全部返す', () => {
  const r = validatePbiFields({ title: '', priority: 'X', status: 'Y' }, STATUSES);
  assert.equal(r.errors.length, 3);
});

test('編集できる項目に id / created_at / updated_at を含めない', () => {
  // これらを書き換えさせると、競合判定と採番の前提が崩れる。
  ['id', 'created_at', 'updated_at'].forEach(f => {
    assert.equal(PBI_EDITABLE_FIELDS.indexOf(f), -1, f + ' が編集可能になっている');
  });
});

test('優先度の語彙が4つある', () => {
  assert.deepEqual(PBI_PRIORITIES, ['Critical', 'High', 'Medium', 'Low']);
});
