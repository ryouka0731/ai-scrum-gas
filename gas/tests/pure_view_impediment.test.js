const test = require('node:test');
const assert = require('node:assert/strict');
const { IMPEDIMENT_COLUMNS, buildImpedimentView } = require('../pure_view_impediment.js');

const imp = (over) => Object.assign({
  id: 'IMP-001', title: '止まっている', description: 'せつめい',
  reported_by: 'マヤ', reported_at: '2026-09-01', status: 'Open',
  resolved_at: '', resolution: '', sprint: 'sprint001',
}, over || {});

test('列は field と label の対で、id が先頭', () => {
  assert.equal(IMPEDIMENT_COLUMNS[0].field, 'id');
  IMPEDIMENT_COLUMNS.forEach((c) => {
    assert.ok(c.field && c.label, c.field + ' の対が不完全');
  });
});

test('列は status を含まない（未解決/解決済はファイルで分かれるため）', () => {
  assert.deepEqual(
    IMPEDIMENT_COLUMNS.map((c) => c.field),
    ['id', 'title', 'description', 'reported_by', 'reported_at', 'sprint', 'resolved_at', 'resolution']);
});

test('未解決と解決済がファイル別に分かれる', () => {
  const v = buildImpedimentView(
    [imp({ id: 'IMP-001' })],
    [imp({ id: 'IMP-002', status: 'Resolved', resolved_at: '2026-09-05' })]);
  assert.deepEqual(v.open.map((r) => r.id), ['IMP-001']);
  assert.deepEqual(v.resolved.map((r) => r.id), ['IMP-002']);
});

test('雛形行は両方から除かれる', () => {
  const v = buildImpedimentView(
    [imp(), { id: 'メモ', title: '' }],
    [{ id: '', title: '' }]);
  assert.equal(v.open.length, 1);
  assert.equal(v.resolved.length, 0);
});

test('値は文字列になり、欠けた項目は空文字', () => {
  const v = buildImpedimentView([{ id: 'IMP-001', title: 'a', reported_at: '2026-09-01' }], []);
  IMPEDIMENT_COLUMNS.forEach((c) => {
    assert.equal(typeof v.open[0][c.field], 'string', c.field + ' が文字列でない');
  });
});

test('どちらも無ければ空で返る', () => {
  const v = buildImpedimentView(null, null);
  assert.deepEqual(v.open, []);
  assert.deepEqual(v.resolved, []);
  assert.ok(v.columns.length > 0);
});

const { openImpedimentsShown } = require('../pure_view_impediment.js');

test('行は表に出さない status も含めて全列を持つ（画面が競合判定の基準として送り返す）', () => {
  const v = buildImpedimentView([imp()], []);
  assert.deepEqual(Object.keys(v.open[0]).sort(),
    ['description', 'id', 'reported_at', 'reported_by', 'resolution', 'resolved_at', 'sprint', 'status', 'title']);
  assert.equal(v.open[0].status, 'Open');
});

test('両方にある ID は未解決から隠し、解決済にだけ出す（書き込みが途中で止まった状態）', () => {
  const v = buildImpedimentView([imp({ id: 'IMP-002' }), imp({ id: 'IMP-003' })],
    [imp({ id: ' IMP-002 ', status: 'Resolved' })]);
  assert.deepEqual(v.open.map((r) => r.id), ['IMP-003']);
  assert.deepEqual(v.resolved.map((r) => r.id.trim()), ['IMP-002']);
  assert.deepEqual(openImpedimentsShown([imp({ id: 'IMP-002' })], [imp({ id: 'IMP-002' })]), []);
});

test('解決済に同じ ID・同じ中身があれば未解決に出さない。同じ ID でも中身が違えば未解決に出す', () => {
  const done = imp({ status: 'Resolved', resolved_at: '2026-10-02', resolution: '直した' });
  assert.deepEqual(buildImpedimentView([imp()], [done]).open, []);
  const other = imp({ title: '別の障害物' });
  assert.deepEqual(buildImpedimentView([other], [done]).open.map((r) => r.title), ['別の障害物']);
  assert.deepEqual(openImpedimentsShown([other], [done]), [other]);
});

test('pending: 同じ ID・同じ中身が両方にあれば1件作る。行は全列の文字列で、未解決には出さない', () => {
  const done = imp({ status: 'Resolved', resolved_at: '2026-10-02', resolution: '直した' });
  const v = buildImpedimentView([imp(), imp({ id: 'IMP-003' })], [done]);
  assert.equal(v.pending.length, 1);
  assert.equal(v.pending[0].id, 'IMP-001');
  assert.deepEqual(v.pending[0].open, buildImpedimentView([imp()], []).open[0]);
  assert.equal(v.pending[0].resolved.resolution, '直した');
  assert.equal(v.pending[0].open.status, 'Open');
  assert.deepEqual(v.open.map((r) => r.id), ['IMP-003']);
  assert.deepEqual(v.resolved.map((r) => r.id), ['IMP-001']);
});

test('pending: 中身が違えば作らない。雛形も作らない', () => {
  const done = imp({ status: 'Resolved', resolution: '直した' });
  assert.deepEqual(buildImpedimentView([imp({ title: '別' })], [done]).pending, []);
  assert.deepEqual(buildImpedimentView([{ id: 'IMP-001', title: '（障害物タイトル）' }], [{ id: 'IMP-001', title: '（障害物タイトル）' }]).pending, []);
  assert.deepEqual(buildImpedimentView([imp()], []).pending, []);
});

test('duplicate: 未解決に同じ ID が2行ある、または解決済と中身が違う未解決の行に duplicate が付く', () => {
  const two = buildImpedimentView([imp(), imp({ title: '別の' }), imp({ id: 'IMP-005' })], []);
  assert.deepEqual(two.open.map((r) => r.duplicate), ['true', 'true', undefined]);
  const done = imp({ status: 'Resolved', resolution: '直した' });
  const diff = buildImpedimentView([imp({ title: '別の' })], [done]);
  assert.equal(diff.open[0].duplicate, 'true');
  assert.deepEqual(diff.pending, []);
  const same = buildImpedimentView([imp()], [done]);
  assert.deepEqual(same.open, []);
});

test('同じ ID が未解決に複数あれば、解決済と同じ中身でも隠さず全部 duplicate で出し、pending は作らない', () => {
  const done = imp({ status: 'Resolved', resolution: '直した' });
  const v = buildImpedimentView([imp(), imp()], [done]);
  assert.equal(v.open.length, 2);
  assert.deepEqual(v.open.map((r) => r.duplicate), ['true', 'true']);
  assert.deepEqual(v.pending, []);
  assert.equal(openImpedimentsShown([imp(), imp()], [done]).length, 2);
});
