const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRowUpdate } = require('../pure_merge.js');

function rows() {
  return [
    { id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-01' },
    { id: 'PBI-002', title: 'B', status: 'Ready', updated_at: '2026-09-02' },
  ];
}

test('状態を書き換えて updated_at を更新する', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].status, 'Ready');
  assert.equal(r.rows[0].updated_at, '2026-09-04');
});

test('他の行に影響しない', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.deepEqual(r.rows[1], rows()[1]);
});

test('変更しない列を保つ', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].title, 'A');
});

test('元の配列を書き換えない', () => {
  const original = rows();
  applyRowUpdate(original, 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(original[0].status, 'New');
});

test('行の順序を保つ', () => {
  const r = applyRowUpdate(rows(), 'PBI-002', { status: 'Done' }, '2026-09-02', '2026-09-04');
  assert.deepEqual(r.rows.map(function (x) { return x.id; }), ['PBI-001', 'PBI-002']);
});

test('id が無ければ not_found を返す', () => {
  const r = applyRowUpdate(rows(), 'PBI-999', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.current, null);
});

test('updated_at が違えば conflict を返す', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-08-31', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(r.current.status, 'New');
  assert.equal(r.current.updated_at, '2026-09-01');
});

test('conflict のとき元の配列を書き換えない', () => {
  const original = rows();
  applyRowUpdate(original, 'PBI-001', { status: 'Ready' }, '2026-08-31', '2026-09-04');
  assert.equal(original[0].status, 'New');
});

test('複数の列を同時に変えられる', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Done', size: '5' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].status, 'Done');
  assert.equal(r.rows[0].size, '5');
});

test('changes に updated_at があっても nowText で上書きする', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready', updated_at: '1999-01-01' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].updated_at, '2026-09-04');
});

// --- 同じ秒に更新されると競合判定をすり抜ける問題（単調性の担保） ---

test('同じ秒に2回更新すると2回目の updated_at が1回目と異なる', () => {
  const timedRows = [{ id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-04 14:30:00' }];
  const first = applyRowUpdate(timedRows, 'PBI-001', { status: 'Ready' }, '2026-09-04 14:30:00', '2026-09-04 14:30:00');
  assert.equal(first.ok, true);
  assert.notEqual(first.rows[0].updated_at, '2026-09-04 14:30:00');
});

test('同じ秒に2回更新した後、2人目が持つ古い expectedUpdatedAt は conflict で弾かれる', () => {
  const timedRows = [{ id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-04 14:30:00' }];
  // A: B が画面を開いた後、同じ秒のうちに先に更新する
  const afterA = applyRowUpdate(timedRows, 'PBI-001', { status: 'Ready' }, '2026-09-04 14:30:00', '2026-09-04 14:30:00');
  assert.equal(afterA.ok, true);
  // B: 画面を開いた時点の古い updated_at（'2026-09-04 14:30:00'）のまま更新しようとする
  const afterB = applyRowUpdate(afterA.rows, 'PBI-001', { status: 'Done' }, '2026-09-04 14:30:00', '2026-09-04 14:30:00');
  assert.equal(afterB.ok, false);
  assert.equal(afterB.reason, 'conflict');
  // A の変更（Ready）が黙って消えていないこと
  assert.equal(afterB.current.status, 'Ready');
});

test('1秒進めるときに分・時・日へ正しく繰り上がる', () => {
  const timedRows = [{ id: 'PBI-001', updated_at: '2026-09-04 23:59:59' }];
  const r = applyRowUpdate(timedRows, 'PBI-001', { status: 'Ready' }, '2026-09-04 23:59:59', '2026-09-04 23:59:59');
  assert.equal(r.rows[0].updated_at, '2026-09-05 00:00:00');
});

test('解析できない形式（日付のみ）が衝突しても必ず異なる値になる', () => {
  // ローカルの Claude Code がこの列に yyyy-MM-dd 形式で書くことがある
  const timedRows = [{ id: 'PBI-001', updated_at: '2026-09-04' }];
  const r = applyRowUpdate(timedRows, 'PBI-001', { status: 'Ready' }, '2026-09-04', '2026-09-04');
  assert.equal(r.ok, true);
  assert.notEqual(r.rows[0].updated_at, '2026-09-04');
});

test('nowText が直前の値と異なるときはそのまま使う（不要に進めない）', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04 00:00:00');
  assert.equal(r.rows[0].updated_at, '2026-09-04 00:00:00');
});

test('空の id は中間の空行にマッチせず not_found を返す', () => {
  const withBlankRow = [
    { id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-01' },
    { id: '', title: '', status: '', updated_at: '' },
    { id: 'PBI-002', title: 'B', status: 'Ready', updated_at: '2026-09-02' },
  ];
  const r = applyRowUpdate(withBlankRow, '', { status: 'Done' }, '', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.current, null);
});

test('同じ秒に3回書き込んでも updated_at は単調増加する', () => {
  // 「直前と異なる値」だけでは足りない。T → T+1秒 → T と戻ると、
  // T を見て画面を開いた利用者の古い更新が再び通ってしまう。
  const now = '2026-09-04 14:30:00';
  let list = [{ id: 'PBI-001', status: 'New', updated_at: now }];
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const r = applyRowUpdate(list, 'PBI-001', { status: 'S' + i }, list[0].updated_at, now);
    assert.equal(r.ok, true);
    list = r.rows;
    seen.push(list[0].updated_at);
  }
  assert.ok(seen[0] < seen[1] && seen[1] < seen[2], '単調増加していない: ' + seen.join(' → '));
});

test('過去に戻った値を古い期待値で更新しようとしても拒否される', () => {
  const now = '2026-09-04 14:30:00';
  let list = [{ id: 'PBI-001', status: 'New', updated_at: now }];
  const stale = list[0].updated_at;               // 利用者 B が画面を開いた時点の値
  list = applyRowUpdate(list, 'PBI-001', { status: 'A1' }, stale, now).rows;   // A の1回目
  list = applyRowUpdate(list, 'PBI-001', { status: 'A2' }, list[0].updated_at, now).rows; // A の2回目
  const r = applyRowUpdate(list, 'PBI-001', { status: 'B' }, stale, now);      // B の更新
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
});

test('未来日の日付のみでもマーカーが伸びず、解析できる値のまま進む', () => {
  // ローカルの Claude Code は yyyy-MM-dd で書き、時差で未来日になることがある。
  // 日付のみを解析できないと `2026-09-05#1#1#1…` と際限なく伸び、
  // この列（ローカルの AI と共同所有）が読めない値で埋まる。
  const now = '2026-09-04 14:30:00';
  let list = [{ id: 'PBI-001', updated_at: '2026-09-05' }];
  const seen = [];
  for (let i = 0; i < 3; i++) {
    list = applyRowUpdate(list, 'PBI-001', { status: 'S' + i }, list[0].updated_at, now).rows;
    seen.push(list[0].updated_at);
  }
  assert.deepEqual(seen, ['2026-09-05 00:00:01', '2026-09-05 00:00:02', '2026-09-05 00:00:03']);
});
