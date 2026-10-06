const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../pure_history.js');

const F = ['id', 'title', 'status', 'updated_at'];
const r = (over) => Object.assign({ id: 'PBI-001', title: 'A', status: 'New', updated_at: 'T1' }, over || {});

test('列と操作の名前', () => {
  assert.deepEqual(h.HISTORY_FIELDS, ['id', 'at', 'actor', 'target_id', 'action', 'field', 'before', 'after']);
  assert.deepEqual(h.HISTORY_ACTIONS, ['create', 'update', 'delete', 'restore', 'resolve', 'unresolve',
    'comment_add', 'comment_delete', 'comment_restore']);
});

test('diffRows: 変わった列ごとに update。無視する列は出ない。変化なしは空', () => {
  assert.deepEqual(h.diffRows([r()], [r({ status: 'Ready', updated_at: 'T2' })], F, ['updated_at']),
    [{ target_id: 'PBI-001', action: 'update', field: 'status', before: 'New', after: 'Ready' }]);
  assert.deepEqual(h.diffRows([r()], [r({ updated_at: 'T2' })], F, ['updated_at']), []);
});

test('diffRows: 増えた行は create、消えた行は delete。id は trim して突き合わせる', () => {
  assert.deepEqual(h.diffRows([r()], [r({ id: ' PBI-001 ' }), r({ id: 'PBI-002' })], F, ['updated_at']),
    [{ target_id: 'PBI-002', action: 'create' }]);
  assert.deepEqual(h.diffRows([r(), r({ id: 'PBI-002' })], [r()], F, []), [{ target_id: 'PBI-002', action: 'delete' }]);
});

test('diffRows: undefined と空文字は同じ。複数列の変更は列の順', () => {
  assert.deepEqual(h.diffRows([r({ title: undefined })], [r({ title: '' })], F, []), []);
  assert.deepEqual(h.diffRows([r()], [r({ title: 'B', status: 'Done' })], F, []).map((e) => e.field), ['title', 'status']);
});

test('historyRows: 共通の時刻と書いた人、行ごとに新しい id', () => {
  let n = 0;
  const rows = h.historyRows(
    [{ target_id: 'PBI-001', action: 'update', field: 'title', before: 'A', after: 'B' }, { target_id: 'PBI-002', action: 'create' }],
    { at: '2026-10-07 10:00:00', actor: 'me@x.jp', newId: () => 'CHG-0000000' + (++n) });
  assert.deepEqual(rows, [
    { id: 'CHG-00000001', at: '2026-10-07 10:00:00', actor: 'me@x.jp', target_id: 'PBI-001', action: 'update', field: 'title', before: 'A', after: 'B' },
    { id: 'CHG-00000002', at: '2026-10-07 10:00:00', actor: 'me@x.jp', target_id: 'PBI-002', action: 'create', field: '', before: '', after: '' },
  ]);
});

test('historyFor: 対象で絞り、新しい順、同じ時刻は元の並び、上限', () => {
  const row = (id, at, field) => ({ id: id, at: at, actor: 'a', target_id: 'PBI-001', action: 'update', field: field, before: '', after: '' });
  const rows = [row('CHG-1', '2026-10-07 09:00:00', 'title'), row('CHG-2', '2026-10-07 10:00:00', 'title'),
    row('CHG-3', '2026-10-07 10:00:00', 'status'), Object.assign(row('CHG-4', '2026-10-07 11:00:00', 'x'), { target_id: 'PBI-002' })];
  assert.deepEqual(h.historyFor(rows, 'PBI-001', 200).map((e) => e.field), ['title', 'status', 'title']);
  assert.equal(h.historyFor(rows, 'PBI-001', 2).length, 2);
  assert.deepEqual(Object.keys(h.historyFor(rows, 'PBI-001', 1)[0]).sort(), ['action', 'actor', 'after', 'at', 'before', 'field']);
});

test('groupHistory: 連続する同じ時刻と書いた人をまとめる', () => {
  const e = (at, actor, field) => ({ at: at, actor: actor, action: 'update', field: field, before: '', after: '' });
  const g = h.groupHistory([e('T2', 'a', 'title'), e('T2', 'a', 'status'), e('T2', 'b', 'title'), e('T1', 'a', 'title')]);
  assert.deepEqual(g.map((x) => [x.at, x.actor, x.items.length]), [['T2', 'a', 2], ['T2', 'b', 1], ['T1', 'a', 1]]);
});

test('lineDiff: 同じ・足した・消した・入れ替え', () => {
  assert.deepEqual(h.lineDiff('a\nb', 'a\nb'), [{ op: 'same', text: 'a' }, { op: 'same', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a', 'a\nb'), [{ op: 'same', text: 'a' }, { op: 'add', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a\nb', 'b'), [{ op: 'del', text: 'a' }, { op: 'same', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a\nx\nc', 'a\ny\nc'),
    [{ op: 'same', text: 'a' }, { op: 'del', text: 'x' }, { op: 'add', text: 'y' }, { op: 'same', text: 'c' }]);
  assert.deepEqual(h.lineDiff('', 'a'), [{ op: 'add', text: 'a' }]);
  assert.deepEqual(h.lineDiff('a', ''), [{ op: 'del', text: 'a' }]);
});

test('lineDiff: CRLF でも LF と同じ行に分ける（\\r を行に残さない）', () => {
  assert.deepEqual(h.lineDiff('a\r\nb', 'a\nb'), [{ op: 'same', text: 'a' }, { op: 'same', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a\r\nx', 'a\r\ny'),
    [{ op: 'same', text: 'a' }, { op: 'del', text: 'x' }, { op: 'add', text: 'y' }]);
});

test('lineDiff: 上限を超えたら丸ごと del / add', () => {
  const big = Array.from({ length: 501 }, (_, i) => 'l' + i).join('\n');
  const d = h.lineDiff(big, 'x');
  assert.equal(d.filter((x) => x.op === 'del').length, 501);
  assert.deepEqual(d[d.length - 1], { op: 'add', text: 'x' });
});
