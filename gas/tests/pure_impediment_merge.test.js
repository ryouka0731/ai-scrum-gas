const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../pure_impediment_merge.js');

const imp = (over) => Object.assign({
  id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001',
}, over || {});
const ids = (rows) => rows.map((r) => r.id);

test('全列が同じなら等しい。undefined は空文字と同じ。前後の空白は区別する', () => {
  assert.equal(m.impedimentRowsEqual(imp(), imp()), true);
  assert.equal(m.impedimentRowsEqual(imp({ description: undefined }), imp({ description: '' })), true);
  assert.equal(m.impedimentRowsEqual(imp({ title: 'A ' }), imp({ title: 'A' })), false);
  assert.equal(m.impedimentRowsEqual(imp({ sprint: 'x' }), imp()), false);
});

test('追記はサーバの値で id / 報告日 / status を決め、編集できない列は捨てる', () => {
  const r = m.appendImpediment([imp()], 'IMP-003',
    { title: 'B', reported_by: 'ダイチ', status: 'Resolved', resolution: 'ずる', id: 'IMP-999' }, '2026-10-05');
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r.rows), ['IMP-002', 'IMP-003']);
  assert.deepEqual(r.row, {
    id: 'IMP-003', title: 'B', description: '', reported_by: 'ダイチ', reported_at: '2026-10-05',
    status: 'Open', resolved_at: '', resolution: '', sprint: '',
  });
});

test('追記は同じ ID があれば拒否する', () => {
  assert.equal(m.appendImpediment([imp()], 'IMP-002', { title: 'B' }, '2026-10-05').reason, 'duplicate_id');
});

test('更新は全列一致のときだけ、編集できる列だけを書き換える', () => {
  const rows = [imp()];
  const r = m.updateImpediment(rows, 'IMP-002', { title: '新', reported_at: '1999-01-01' }, imp());
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].title, '新');
  assert.equal(r.rows[0].reported_at, '2026-10-01');
  assert.equal(rows[0].title, '止まっている', '引数を書き換えた');
});

test('更新は1列でも違えば conflict、無ければ not_found', () => {
  assert.equal(m.updateImpediment([imp({ description: '誰かが追記' })], 'IMP-002', { title: '新' }, imp()).reason, 'conflict');
  assert.equal(m.updateImpediment([imp()], 'IMP-404', { title: '新' }, imp()).reason, 'not_found');
});

test('解決: resolved に足し、open から消す。足す行は Resolved / 今日 / 解決策', () => {
  const r = m.planResolve([imp(), imp({ id: 'IMP-003' })], [], 'IMP-002', '再起動した', imp(), '2026-10-05');
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r.open), ['IMP-003']);
  assert.deepEqual(ids(r.resolved), ['IMP-002']);
  assert.deepEqual(r.resolvedRow, imp({ status: 'Resolved', resolved_at: '2026-10-05', resolution: '再起動した' }));
  assert.deepEqual(r.moved, imp());
});

test('解決: 途中で止まって両方にある状態からは、resolved を書かず open から消すだけ（冪等）', () => {
  const done = imp({ status: 'Resolved', resolved_at: '2026-10-04', resolution: '前回の分' });
  const r = m.planResolve([imp()], [done], 'IMP-002', '再起動した', imp(), '2026-10-05');
  assert.equal(r.ok, true);
  assert.equal(r.resolved, null);
  assert.deepEqual(r.open, []);
  assert.deepEqual(r.resolvedRow, done, '既に書いた行を、取り消しの照合に使う');
});

test('解決: 画面が見た行と違えば conflict、既に解決済なら conflict、どこにも無ければ not_found', () => {
  assert.equal(m.planResolve([imp({ title: '変わった' })], [], 'IMP-002', 'x', imp(), 'd').reason, 'conflict');
  assert.equal(m.planResolve([], [imp({ status: 'Resolved' })], 'IMP-002', 'x', imp(), 'd').reason, 'conflict');
  assert.equal(m.planResolve([], [], 'IMP-002', 'x', imp(), 'd').reason, 'not_found');
});

const resolvedRow = imp({ status: 'Resolved', resolved_at: '2026-10-05', resolution: '再起動した' });

test('取り消し: open に元の行を戻し、resolved から消す', () => {
  const r = m.planUnresolve([], [resolvedRow], imp(), resolvedRow);
  assert.equal(r.ok, true);
  assert.deepEqual(r.open, [imp()]);
  assert.deepEqual(r.resolved, []);
});

test('取り消し: 戻すのは IMPEDIMENT_FIELDS の列だけ', () => {
  const r = m.planUnresolve([], [resolvedRow], Object.assign(imp(), { evil: 'x' }), resolvedRow);
  assert.deepEqual(Object.keys(r.open[0]).sort(), Object.keys(imp()).sort());
});

test('取り消し: 両方にある状態からは open を書かず resolved から消すだけ', () => {
  const r = m.planUnresolve([imp()], [resolvedRow], imp(), resolvedRow);
  assert.equal(r.open, null);
  assert.deepEqual(r.resolved, []);
});

test('取り消し: 既に戻っていれば何も書かずに成功、どこにも無ければ not_found', () => {
  const r = m.planUnresolve([imp()], [], imp(), resolvedRow);
  assert.equal(r.ok, true);
  assert.equal(r.open, null);
  assert.equal(r.resolved, null);
  assert.equal(m.planUnresolve([], [], imp(), resolvedRow).reason, 'not_found');
});

test('取り消し: 解決済の行が書き換えられていれば conflict', () => {
  assert.equal(m.planUnresolve([], [imp(Object.assign({}, resolvedRow, { resolution: '直した' }))], imp(), resolvedRow).reason, 'conflict');
});

test('取り消し: 不正な入力は invalid（ID の形・空タイトル・ID の食い違い）', () => {
  assert.equal(m.planUnresolve([], [resolvedRow], imp({ id: 'PBI-001' }), resolvedRow).reason, 'invalid');
  assert.equal(m.planUnresolve([], [resolvedRow], imp({ title: ' ' }), resolvedRow).reason, 'invalid');
  assert.equal(m.planUnresolve([], [resolvedRow], imp({ id: 'IMP-009' }), resolvedRow).reason, 'invalid');
  assert.equal(m.planUnresolve([], [resolvedRow], null, resolvedRow).reason, 'invalid');
});

// 配布の雛形行（IMP-001 / （障害物タイトル） / YYYY-MM-DD）は本物の行として扱わない。
const tmpl = (over) => imp(Object.assign({
  id: 'IMP-001', title: '（障害物タイトル）', reported_by: '（報告者）', reported_at: 'YYYY-MM-DD', sprint: '',
}, over || {}));

test('解決: resolved に同じ ID の雛形行があっても、本物の行を resolved に足して open から消す', () => {
  const real = imp({ id: 'IMP-001' });
  const r = m.planResolve([tmpl(), real], [tmpl({ status: 'Resolved' })], 'IMP-001', '直した', real, '2026-10-05');
  assert.equal(r.ok, true);
  assert.deepEqual(r.open, [tmpl()], '雛形行は残す');
  assert.notEqual(r.resolved, null, 'resolved を書かずに open から消すと行が失われる');
  assert.deepEqual(r.resolved, [tmpl({ status: 'Resolved' }),
    imp({ id: 'IMP-001', status: 'Resolved', resolved_at: '2026-10-05', resolution: '直した' })]);
});

test('解決: resolved に同じ ID で中身の違う行があれば duplicate_id（途中で止まった解決とみなさない）', () => {
  // 以前は conflict。何度押しても通らない行になるため、ID の重複として知らせる。
  const other = imp({ title: '別の障害物', status: 'Resolved', resolved_at: '2026-09-01', resolution: '昔の' });
  assert.equal(m.planResolve([imp()], [other], 'IMP-002', 'x', imp(), 'd').reason, 'duplicate_id');
});

test('取り消し: open に同じ ID の雛形行があっても、取り消し済みとみなさず open に戻す', () => {
  const real = imp({ id: 'IMP-001' });
  const done = imp({ id: 'IMP-001', status: 'Resolved', resolved_at: '2026-10-05', resolution: '直した' });
  const r = m.planUnresolve([tmpl()], [done], real, done);
  assert.equal(r.ok, true);
  assert.deepEqual(r.open, [tmpl(), real]);
  assert.deepEqual(r.resolved, []);
  // resolved 側も雛形しか無ければ「既に戻っている」とみなさない
  assert.equal(m.planUnresolve([tmpl()], [tmpl({ status: 'Resolved' })], real, done).reason, 'not_found');
});

test('取り消し: open に同じ ID で中身の違う行があれば duplicate_id', () => {
  // 以前は conflict。解決済の行の有無にかかわらず、ID の重複として知らせる。
  const other = imp({ title: '別の障害物' });
  assert.equal(m.planUnresolve([other], [resolvedRow], imp(), resolvedRow).reason, 'duplicate_id');
  assert.equal(m.planUnresolve([other], [], imp(), resolvedRow).reason, 'duplicate_id');
});

test('更新は雛形の行を編集させない（not_found）', () => {
  const tpl = imp({ id: 'IMP-001', title: '（障害物タイトル）', reported_at: 'YYYY-MM-DD' });
  assert.equal(m.updateImpediment([tpl], 'IMP-001', { title: '乗っ取り' }, tpl).reason, 'not_found');
});

test('impedimentSameIdentity: 解決で変わらない列だけを比べる', () => {
  assert.equal(m.impedimentSameIdentity(imp(), imp({ status: 'Resolved', resolved_at: 'd', resolution: 'x' })), true);
  assert.equal(m.impedimentSameIdentity(imp(), imp({ title: '別' })), false);
  assert.equal(m.impedimentSameIdentity(imp(), imp({ sprint: 'sprint002' })), false);
});

test('impedimentHalfResolved: 未解決と解決済に同じ障害物（ID と変わらない列が同じ）があるときだけ真', () => {
  const tpl = imp({ id: 'IMP-001', title: '（障害物タイトル）', description: '（詳細説明）', reported_by: '（報告者）', reported_at: 'YYYY-MM-DD', resolution: '（解決策）' });
  const done = imp({ status: 'Resolved', resolved_at: '2026-10-02', resolution: '直した' });
  assert.equal(m.impedimentHalfResolved([imp()], [done], 'IMP-002'), true);
  assert.equal(m.impedimentHalfResolved([imp()], [done], ' IMP-002 '), true);
  assert.equal(m.impedimentHalfResolved([imp()], [], 'IMP-002'), false);
  assert.equal(m.impedimentHalfResolved([imp()], [imp({ title: '別', status: 'Resolved' })], 'IMP-002'), false, '中身の違う行は別の障害物');
  assert.equal(m.impedimentHalfResolved([], [done], 'IMP-002'), false);
  assert.equal(m.impedimentHalfResolved([tpl], [Object.assign({}, tpl, { status: 'Resolved' })], 'IMP-001'), false, '雛形は数えない');
});

test('解決済に同じ ID が複数あれば、途中で止まった状態とみなさず、解決も揃えもしない（PR #11 cubic）', () => {
  const done = imp({ status: 'Resolved', resolution: '直した' });
  const other = imp({ title: '別の', status: 'Resolved', resolution: '別' });
  [[done, done], [done, other], [other, done]].forEach((resolved) => {
    assert.equal(m.planUnresolvePending([imp()], resolved, 'IMP-002').reason, 'not_pending');
    assert.equal(m.planResolve([imp()], resolved, 'IMP-002', 'r', imp(), '2026-10-07').reason, 'duplicate_id');
    assert.equal(m.impedimentHalfResolved([imp()], resolved, 'IMP-002'), false);
  });
});

test('impedimentDuplicateId: 未解決か解決済に同じ ID が複数あるときだけ真（PR #11 cubic）', () => {
  const done = imp({ status: 'Resolved', resolution: '直した' });
  const other = imp({ title: '別の', status: 'Resolved', resolution: '別' });
  assert.equal(m.impedimentDuplicateId([imp()], [], 'IMP-002'), false);
  assert.equal(m.impedimentDuplicateId([imp()], [done], 'IMP-002'), false, '途中で止まった操作は重複ではない');
  assert.equal(m.impedimentDuplicateId([imp(), imp({ title: 'x' })], [], 'IMP-002'), true);
  assert.equal(m.impedimentDuplicateId([imp()], [done, done], 'IMP-002'), true);
  assert.equal(m.impedimentDuplicateId([imp()], [other], 'IMP-002'), false, '中身の違う1行は対象外（未解決側の編集は止めない）');
  assert.equal(m.impedimentDuplicateId([imp()], [], ' IMP-002 '), false);
});
