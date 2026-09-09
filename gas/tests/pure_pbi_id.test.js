const test = require('node:test');
const assert = require('node:assert/strict');
const { nextPbiId } = require('../pure_pbi_id.js');

test('空の行集合では PBI-001 になる', () => {
  assert.equal(nextPbiId([]), 'PBI-001');
  assert.equal(nextPbiId(null), 'PBI-001');
});

test('既存の最大値 + 1 になる', () => {
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-010' }, { id: 'PBI-003' }];
  assert.equal(nextPbiId(rows), 'PBI-011');
});

test('欠番があっても最大値 + 1 で、埋め戻さない', () => {
  // 欠番を埋めると、削除された PBI の ID が別物に再利用される。
  // ローカルの Claude Code が残した参照が別の PBI を指すようになる。
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-005' }];
  assert.equal(nextPbiId(rows), 'PBI-006');
});

test('PBI 形式でない id は無視する', () => {
  const rows = [{ id: 'PBI-002' }, { id: '' }, { id: 'メモ' }, { id: 'PBI-abc' }, {}];
  assert.equal(nextPbiId(rows), 'PBI-003');
});

test('桁が繰り上がったらゼロ埋めせずに伸ばす', () => {
  assert.equal(nextPbiId([{ id: 'PBI-999' }]), 'PBI-1000');
});

test('4桁の id があればその桁数を保つ', () => {
  assert.equal(nextPbiId([{ id: 'PBI-1200' }]), 'PBI-1201');
});

test('前後に空白がある id も読む', () => {
  assert.equal(nextPbiId([{ id: '  PBI-007  ' }]), 'PBI-008');
});

// --- 高水位（highWaterId）: 最大の ID を削除しても再利用しない ---

test('highWaterId が rows の最大値より大きければそちらを採る', () => {
  // rows からは見えない（＝最大の行が既に削除された）場合を拾う。
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-002' }];
  assert.equal(nextPbiId(rows, 'PBI-005'), 'PBI-006');
});

test('rows の最大値が highWaterId より大きければそちらを採る', () => {
  // ローカルの Claude Code が rows の外（記録の前）で先に採番した場合を拾う。
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-010' }];
  assert.equal(nextPbiId(rows, 'PBI-003'), 'PBI-011');
});

test('本編: 最大の PBI を削除しても、次の採番はその ID を再利用しない', () => {
  // PBI-001, PBI-002, PBI-003 を作った後（highWaterId は最後に採番した PBI-003）、
  // PBI-003 を rows から削除しても、highWaterId を渡す限り PBI-003 は再発行されない。
  const afterDelete = [{ id: 'PBI-001' }, { id: 'PBI-002' }];
  assert.equal(nextPbiId(afterDelete, 'PBI-003'), 'PBI-004');
});

test('highWaterId が空・未指定でも rows だけで従来どおり動く', () => {
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-005' }];
  assert.equal(nextPbiId(rows, ''), 'PBI-006');
  assert.equal(nextPbiId(rows, undefined), 'PBI-006');
  assert.equal(nextPbiId(rows), 'PBI-006');
});

test('highWaterId が PBI 形式でなければ無視する', () => {
  const rows = [{ id: 'PBI-002' }];
  assert.equal(nextPbiId(rows, 'メモ'), 'PBI-003');
});
