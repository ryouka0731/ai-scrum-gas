const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../pure_comment.js');

const row = (over) => Object.assign({ id: 'CMT-0000000a', target_id: 'PBI-001', author: 'a@x.jp',
  created_at: '2026-10-06 10:00:00', body: 'はじめ' }, over || {});

test('列は5つ', () => {
  assert.deepEqual(c.COMMENT_FIELDS, ['id', 'target_id', 'author', 'created_at', 'body']);
});

test('検証: 対象の形・空・2000字超', () => {
  assert.equal(c.validateComment('PBI-001', 'よい').ok, true);
  assert.equal(c.validateComment('IMP-002', 'よい').ok, true);
  assert.deepEqual(c.validateComment('PBI-001', '  ').errors, ['コメントを入力してください。']);
  assert.deepEqual(c.validateComment('PBI-001', 'あ'.repeat(2001)).errors, ['コメントは2000字以内で入力してください。']);
  assert.equal(c.validateComment('PBI-001', 'あ'.repeat(2000)).ok, true);
  // 字数はコードポイントで数える（絵文字は UTF-16 で2単位だが1字）。
  assert.equal(c.validateComment('PBI-001', '😀'.repeat(2000)).ok, true);
  assert.equal(c.validateComment('PBI-001', '😀'.repeat(2001)).ok, false);
  assert.deepEqual(c.validateComment('X-1', 'よい').errors, ['コメントの対象が不正です: X-1']);
  assert.equal(c.validateComment(null, null).ok, false);
});

test('追記: 末尾に足し、引数を変えない', () => {
  const rows = [row()];
  const r = c.appendComment(rows, 'CMT-0000000b', 'PBI-001', 'b@x.jp', '次', '2026-10-06 11:00:00');
  assert.equal(r.ok, true);
  assert.deepEqual(r.comment, { id: 'CMT-0000000b', target_id: 'PBI-001', author: 'b@x.jp', created_at: '2026-10-06 11:00:00', body: '次' });
  assert.equal(r.rows.length, 2);
  assert.deepEqual(r.rows[0], row(), '既存の行が変わった');
  assert.deepEqual(r.rows[1], r.comment);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows, [row()], '引数の行が変わった');
});

test('削除: 本人だけ。他人は forbidden、無ければ not_found', () => {
  const r = c.deleteComment([row()], 'CMT-0000000a', 'a@x.jp');
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.removed, row());
  assert.equal(c.deleteComment([row()], 'CMT-0000000a', 'b@x.jp').reason, 'forbidden');
  assert.equal(c.deleteComment([row()], 'CMT-0000000a', '').reason, 'forbidden');
  assert.equal(c.deleteComment([row()], 'CMT-ffffffff', 'a@x.jp').reason, 'not_found');
});

test('戻し: 元の id と日時のまま末尾へ。既にあれば変えない。形が不正なら invalid', () => {
  const r = c.restoreComment([], row());
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [row()]);
  const again = c.restoreComment([row()], row());
  assert.equal(again.ok, true);
  assert.equal(again.unchanged, true);
  assert.equal(again.rows.length, 1);
  // id は形を問わず、空だけを拒む（削除はどんな形の id も受け付けるため。バグ探し C-5）
  assert.equal(c.restoreComment([], row({ id: ' ' })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ target_id: 'x' })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ body: ' ' })).reason, 'invalid');
  assert.equal(c.restoreComment([], null).reason, 'invalid');
  assert.deepEqual(Object.keys(c.restoreComment([], Object.assign(row(), { evil: 1 })).rows[0]).sort(),
    ['author', 'body', 'created_at', 'id', 'target_id']);
});

test('まとめ: 対象ごと・古い順・mine 付き・不正な対象は捨てる', () => {
  const g = c.groupComments([
    row({ id: 'CMT-00000003', created_at: '2026-10-06 12:00:00', author: 'b@x.jp' }),
    row({ id: 'CMT-00000001', created_at: '2026-10-06 09:00:00' }),
    row({ id: 'CMT-00000002', target_id: 'IMP-002' }),
    row({ id: 'CMT-00000004', target_id: 'メモ' }),
  ], 'a@x.jp');
  assert.deepEqual(Object.keys(g).sort(), ['IMP-002', 'PBI-001']);
  assert.deepEqual(g['PBI-001'].map((x) => x.id), ['CMT-00000001', 'CMT-00000003']);
  assert.deepEqual(g['PBI-001'].map((x) => x.mine), [true, false]);
  assert.equal(c.groupComments([row()], '')['PBI-001'][0].mine, false, 'ログインが取れないときは誰のものでもない');
});

test('戻し: 2000字超と日時が空のものは invalid（日時の形は問わない。バグ探し C-5）', () => {
  assert.equal(c.restoreComment([], row({ body: 'あ'.repeat(2001) })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ body: 'あ'.repeat(2000) })).ok, true);
  assert.equal(c.restoreComment([], row({ created_at: '' })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ created_at: ' ' })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ created_at: '2026-10-06' })).ok, true);
});

test('restoreComment: 戻す行の id は、検査と同じく前後の空白を落として保存する', () => {
  const r = c.restoreComment([], row({ id: ' ' + row().id + ' ' }));
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].id, row().id);
  const again = c.restoreComment(r.rows, row({ id: row().id + ' ' }));
  assert.equal(again.unchanged, true, '空白違いの同じ id を2回足した');
});
