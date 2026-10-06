'use strict';
// bughunt B: 純関数の状態遷移を、固定シードの乱数で性質（不変条件）から検査する。
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../pure_merge.js');
const PID = require('../pure_pbi_id.js');
const PV = require('../pure_pbi_validate.js');
const IID = require('../pure_impediment_id.js');
const IM = require('../pure_impediment_merge.js');
const IV = require('../pure_impediment_validate.js');
const VIEW = require('../pure_view_impediment.js');
const { IMPEDIMENT_FIELDS, isImpedimentPlaceholder } = require('../pure_grid_report.js');

function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r, n) => Math.floor(r() * n);
const pick = (r, a) => a[int(r, a.length)];
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const pad = (n, w) => String(n).padStart(w, '0');

// ---------- advanceUpdatedAt_ ----------
function randTime(r) {
  const kind = int(r, 9);
  const y = pick(r, [2026, 2026, 2027, 1999, 2100, 9999, 50, 0]);
  const mo = pick(r, [1, 2, 12, 12, 0, 13, 6]);
  const d = pick(r, [1, 28, 29, 30, 31, 32, 0]);
  const hh = pick(r, [0, 23, 24, 12, 25]);
  const mi = pick(r, [0, 59, 60]);
  const ss = pick(r, [0, 59, 60, 30]);
  const dt = `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}`;
  switch (kind) {
    case 0: return dt;
    case 1: return '';
    case 2: return 'garbage';
    case 3: return `${dt} ${pad(hh, 2)}:${pad(mi, 2)}:${pad(ss, 2)}#1`;
    default: return `${dt} ${pad(hh, 2)}:${pad(mi, 2)}:${pad(ss, 2)}`;
  }
}

test('advanceUpdatedAt_: どんな前の値でも結果は文字列として厳密に大きい（乱数・境界）', () => {
  const r = rng(20261006);
  for (let i = 0; i < 20000; i++) {
    const prev = randTime(r);
    const now = randTime(r);
    const out = M.advanceUpdatedAt_(now, prev);
    if (!(out > prev)) assert.fail(`seed=20261006 i=${i} prev=${JSON.stringify(prev)} now=${JSON.stringify(now)} out=${JSON.stringify(out)}`);
  }
});

test('advanceUpdatedAt_: 同じ now で連続して呼ぶと列は厳密に単調増加（月末・年末・23:59:59 をまたぐ）', () => {
  for (const start of ['2026-12-31 23:59:58', '2026-02-28 23:59:59', '2028-02-28 23:59:59', '2026-10-06 10:00:00', '2026-12-31', '9999-12-31 23:59:58']) {
    let prev = start;
    const seen = new Set([prev]);
    for (let i = 0; i < 6; i++) {
      const next = M.advanceUpdatedAt_(start, prev);
      assert.ok(next > prev, `${start}: ${prev} -> ${next}`);
      assert.ok(!seen.has(next), `値が戻った: ${start} ${next}`);
      seen.add(next); prev = next;
    }
  }
});

test('advanceUpdatedAt_: 23:59:59 は翌日 00:00:00 に、月末・年末も正しく繰り上がる', () => {
  assert.equal(M.advanceUpdatedAt_('2026-12-31 23:59:59', '2026-12-31 23:59:59'), '2027-01-01 00:00:00');
  assert.equal(M.advanceUpdatedAt_('2026-02-28 23:59:59', '2026-02-28 23:59:59'), '2026-03-01 00:00:00');
  assert.equal(M.advanceUpdatedAt_('2028-02-28 23:59:59', '2028-02-28 23:59:59'), '2028-02-29 00:00:00');
});

// ---------- applyRowUpdate / appendRow / deleteRow / restoreRow ----------
const FIELDS = ['id', 'title', 'status', 'priority', 'created_at', 'updated_at'];
function randRows(r, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: 'PBI-' + pad(i + 1, 3), title: 't' + int(r, 5), status: pick(r, ['New', 'Ready', 'Done']),
      priority: 'High', created_at: '2026-01-01 00:00:00',
      updated_at: pick(r, ['2026-10-06 10:00:00', '2026-10-06', '2026-10-06 23:59:59', '']),
    });
  }
  return rows;
}
const byId = (rows) => Object.fromEntries(rows.map((x) => [x.id, x]));
const strip = (x) => { const c = { ...x }; delete c.updated_at; return c; };

test('merge の4関数は入力を書き換えない（deep freeze、成功・失敗とも）', () => {
  const r = rng(11);
  for (let i = 0; i < 300; i++) {
    const rows = deepFreeze(randRows(r, 1 + int(r, 5)));
    const target = pick(r, rows);
    const snapshot = clone(rows);
    const now = pick(r, ['2026-10-06 10:00:00', '2026-10-06 10:00:00', '2030-01-01 00:00:00']);
    const exp = pick(r, [target.updated_at, 'x']);
    M.applyRowUpdate(rows, target.id, deepFreeze({ title: 'new' }), exp, now);
    M.appendRow(rows, pick(r, [target.id, 'PBI-900']), deepFreeze({ title: 'z' }), FIELDS, now);
    const del = M.deleteRow(rows, target.id, exp);
    M.restoreRow(rows, deepFreeze({ ...target, id: pick(r, [target.id, 'PBI-901']) }), FIELDS, now);
    if (del.ok) M.restoreRow(del.rows, deepFreeze({ ...target }), FIELDS, now);
    assert.deepEqual(rows, snapshot);
  }
});

test('updated_at は同じ秒・未来日・日付のみでも、更新のたびに厳密に大きくなる', () => {
  const r = rng(7);
  for (let k = 0; k < 200; k++) {
    let rows = randRows(r, 3);
    const id = 'PBI-002';
    for (let step = 0; step < 8; step++) {
      const cur = rows.find((x) => x.id === id);
      const now = pick(r, ['2026-10-06 10:00:00', '2026-10-06 10:00:01', '2020-01-01 00:00:00']);
      const res = M.applyRowUpdate(rows, id, { title: 's' + step }, cur.updated_at, now);
      assert.ok(res.ok);
      const after = res.rows.find((x) => x.id === id);
      assert.ok(after.updated_at > cur.updated_at, `${cur.updated_at} -> ${after.updated_at}`);
      // 古い画面（更新前の値）からの2回目は必ず拒否される
      const stale = M.applyRowUpdate(res.rows, id, { title: 'stale' }, cur.updated_at, now);
      assert.equal(stale.ok, false);
      assert.equal(stale.reason, 'conflict');
      rows = res.rows;
    }
  }
});

test('削除→復元で行集合が戻る（updated_at 以外）／復元の2回目は duplicate_id で何も変えない', () => {
  const r = rng(99);
  for (let i = 0; i < 300; i++) {
    const rows = randRows(r, 1 + int(r, 6));
    const t = pick(r, rows);
    const del = M.deleteRow(rows, t.id, t.updated_at);
    assert.ok(del.ok);
    assert.equal(del.rows.length, rows.length - 1);
    const res = M.restoreRow(del.rows, t, FIELDS, '2026-10-06 12:00:00');
    assert.ok(res.ok);
    assert.equal(res.rows.length, rows.length);
    const a = byId(rows); const b = byId(res.rows);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    Object.keys(a).forEach((k) => assert.deepEqual(strip(b[k]), strip(a[k])));
    const again = M.restoreRow(res.rows, t, FIELDS, '2026-10-06 12:00:01');
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'duplicate_id');
  }
});

test('appendRow: allFields 以外は捨て、id/created_at/updated_at はサーバ値。重複 id は拒否', () => {
  const rows = [{ id: 'PBI-001', title: 'a', status: '', priority: '', created_at: '', updated_at: '' }];
  const ok = M.appendRow(rows, ' PBI-002 ', { id: 'HACK', created_at: 'x', updated_at: 'y', title: 't', evil: 1 }, FIELDS, 'N');
  assert.ok(ok.ok);
  assert.deepEqual(ok.rows[1], { id: 'PBI-002', title: 't', status: '', priority: '', created_at: 'N', updated_at: 'N' });
  assert.equal(M.appendRow(ok.rows, 'PBI-002', {}, FIELDS, 'N').reason, 'duplicate_id');
});

// ---------- PBI ID ----------
test('nextPbiId: 行・高水位のどれとも重ならず、最大+1。桁あふれは数値で扱う', () => {
  const r = rng(5);
  for (let i = 0; i < 2000; i++) {
    const n = int(r, 6);
    const rows = [];
    let max = 0;
    for (let k = 0; k < n; k++) {
      const num = pick(r, [1, 2, 9, 10, 99, 100, 998, 999, 1000, 1001, int(r, 5000)]);
      const w = pick(r, [1, 3, 4, 5]);
      const id = pick(r, ['PBI-' + pad(num, w), ' PBI-' + pad(num, w) + ' ']);
      if (r() < 0.8) { rows.push({ id }); max = Math.max(max, num); } else rows.push({ id: pick(r, ['', 'XX-1', 'PBI-', 'PBI-1a']) });
    }
    let hw = null;
    if (r() < 0.6) { const num = int(r, 3000); hw = 'PBI-' + pad(num, pick(r, [3, 4])); max = Math.max(max, num); }
    const next = PID.nextPbiId(rows, hw);
    assert.match(next, /^PBI-\d+$/);
    assert.equal(PID.pbiIdNumber(next), max + 1, JSON.stringify({ rows, hw, next }));
    assert.ok(!rows.some((x) => PID.pbiIdNumber(x.id) === PID.pbiIdNumber(next)));
  }
  assert.equal(PID.nextPbiId([{ id: 'PBI-999' }], null), 'PBI-1000');
  assert.equal(PID.nextPbiId([], 'PBI-999'), 'PBI-1000');
  assert.equal(PID.nextPbiId([], null), 'PBI-001');
});

test('isPbiIdWithinHighWater: 範囲内の ID だけ true、0 や非形式は false', () => {
  assert.equal(PID.isPbiIdWithinHighWater('PBI-1000', [{ id: 'PBI-999' }], 'PBI-1000'), true);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-1001', [{ id: 'PBI-999' }], 'PBI-1000'), false);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-000', [], null), false);
  assert.equal(PID.isPbiIdWithinHighWater('PBI-5', [], null), true);
});

// ---------- 障害物 ID ----------
test('nextImpedimentId: 最大+1、IMP-999 の次は IMP-1000、雛形も数に入る', () => {
  assert.equal(IID.nextImpedimentId([{ id: 'IMP-999' }]), 'IMP-1000');
  assert.equal(IID.nextImpedimentId([]), 'IMP-001');
  assert.equal(IID.nextImpedimentId([{ id: 'IMP-001' }]), 'IMP-002');
  const r = rng(3);
  for (let i = 0; i < 1000; i++) {
    const rows = [];
    let max = 0;
    for (let k = 0; k < int(r, 6); k++) {
      const num = pick(r, [1, 9, 10, 99, 100, 999, 1000, int(r, 3000)]);
      rows.push({ id: pick(r, ['IMP-' + pad(num, pick(r, [1, 3, 4])), ' IMP-' + num + ' ']) }); max = Math.max(max, num);
    }
    const next = IID.nextImpedimentId(rows);
    assert.equal(parseInt(next.slice(4), 10), max + 1);
    assert.ok(next.length - 4 >= 3);
  }
});

// ---------- 障害物の解決・取り消し ----------
function impRow(id, title, extra) {
  return Object.assign({ id, title, description: 'd', reported_by: 'u', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'S1' }, extra || {});
}
const PLACEHOLDER = impRow('IMP-001', '（障害物タイトル）', { reported_at: 'YYYY-MM-DD' });
const canon = (rows) => rows.filter((x) => !isImpedimentPlaceholder(x)).map((x) => JSON.stringify(IMPEDIMENT_FIELDS.map((f) => x[f]))).sort();
const countId = (rows, id) => rows.filter((x) => !isImpedimentPlaceholder(x) && x.id === id).length;

function randImpState(r) {
  const open = []; const resolved = [];
  if (r() < 0.5) open.push({ ...PLACEHOLDER });
  if (r() < 0.5) resolved.push({ ...PLACEHOLDER });
  const n = 1 + int(r, 5);
  for (let i = 0; i < n; i++) {
    const id = 'IMP-' + pad(2 + i, 3);
    open.push(impRow(id, 'o' + i));
  }
  const nr = int(r, 3);
  for (let i = 0; i < nr; i++) resolved.push(impRow('IMP-' + pad(20 + i, 3), 'r' + i, { status: 'Resolved', resolved_at: '2026-10-02', resolution: 'ok' }));
  return { open, resolved };
}
function shuffle(r, a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = int(r, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

test('planResolve → planUnresolve で両ファイルが元の行集合に戻る。入力は不変', () => {
  const r = rng(1234);
  for (let i = 0; i < 500; i++) {
    const st = randImpState(r);
    const open = deepFreeze(shuffle(r, st.open)); const resolved = deepFreeze(st.resolved);
    const snap = clone({ open, resolved });
    const target = pick(r, open.filter((x) => !isImpedimentPlaceholder(x)));
    const p = IM.planResolve(open, resolved, target.id, 'fixed', target, '2026-10-06');
    assert.ok(p.ok, JSON.stringify(p));
    assert.deepEqual(clone({ open, resolved }), snap);
    assert.equal(canon(p.open).length, canon(open).length - 1);
    assert.equal(countId(p.resolved, target.id), 1);
    assert.equal(p.resolvedRow.status, 'Resolved');
    const u = IM.planUnresolve(p.open, p.resolved, p.moved, p.resolvedRow);
    assert.ok(u.ok, JSON.stringify(u));
    assert.deepEqual(canon(u.open), canon(open));
    assert.deepEqual(canon(u.resolved), canon(resolved));
  }
});

test('部分失敗（足す側だけ成功）→ 再試行で収束し、行は失われず増えない', () => {
  const r = rng(777);
  for (let i = 0; i < 500; i++) {
    const st = randImpState(r);
    const target = pick(r, st.open.filter((x) => !isImpedimentPlaceholder(x)));
    const total = canon(st.open).length + canon(st.resolved).length;
    // 解決: resolved への書き込みだけ成功
    const p1 = IM.planResolve(st.open, st.resolved, target.id, 'fixed', target, '2026-10-06');
    let open = st.open; let resolved = p1.resolved; // open 側は書けなかった
    for (let retry = 0; retry < 2; retry++) {
      const p = IM.planResolve(open, resolved, target.id, 'fixed2', target, '2026-10-06');
      if (!p.ok) { assert.equal(retry, 1, '1回目の再試行は成功するはず: ' + JSON.stringify(p)); break; }
      if (p.resolved) resolved = p.resolved;
      open = p.open;
    }
    assert.equal(countId(open, target.id), 0);
    assert.equal(countId(resolved, target.id), 1);
    assert.equal(canon(open).length + canon(resolved).length, total);
    // 画面の分割: 途中状態でも pending に現れる
    const midPending = VIEW.impedimentPendingEntries(st.open, p1.resolved).map((x) => x.id);
    assert.deepEqual(midPending, [target.id]);

    // 取り消し: open への書き込みだけ成功 → 再試行
    const un1 = IM.planUnresolve(open, resolved, p1.moved, p1.resolvedRow);
    assert.ok(un1.ok);
    let o2 = un1.open; let r2 = resolved; // resolved 側は書けなかった
    const un2 = IM.planUnresolve(o2, r2, p1.moved, p1.resolvedRow);
    assert.ok(un2.ok, JSON.stringify(un2));
    if (un2.open) o2 = un2.open;
    if (un2.resolved) r2 = un2.resolved;
    assert.deepEqual(canon(o2), canon(st.open));
    assert.deepEqual(canon(r2), canon(st.resolved));
    // 3回目（完全に戻った後）は何も書かずに成功
    const un3 = IM.planUnresolve(o2, r2, p1.moved, p1.resolvedRow);
    assert.ok(un3.ok && !un3.open && !un3.resolved);
  }
});

test('同じ ID が別の中身で resolved にあるとき planResolve は何も壊さず duplicate_id', () => {
  const o = impRow('IMP-005', 'A'); const res = impRow('IMP-005', 'B', { status: 'Resolved', resolved_at: 'x', resolution: 'y' });
  const p = IM.planResolve([o], [res], 'IMP-005', 'z', o, '2026-10-06');
  assert.equal(p.ok, false); assert.equal(p.reason, 'duplicate_id');
});

// ---------- 画面の分割 ----------
test('buildImpedimentView: 未解決の実行は open か pending のどちらか一方にだけ現れる（重複 ID・雛形入り乱数）', () => {
  const r = rng(4242);
  for (let i = 0; i < 3000; i++) {
    const open = []; const resolved = [];
    const gen = (arr, status) => {
      for (let k = 0; k < int(r, 5); k++) {
        if (r() < 0.2) { arr.push({ ...PLACEHOLDER }); continue; }
        const id = pick(r, ['IMP-002', 'IMP-003', ' IMP-002', 'IMP-004']);
        const title = pick(r, ['a', 'b']);
        arr.push(impRow(id, title, { status, resolution: pick(r, ['', 'r']) }));
      }
    };
    gen(open, 'Open'); gen(resolved, 'Resolved');
    const snap = clone({ open, resolved });
    const v = VIEW.buildImpedimentView(deepFreeze(open), deepFreeze(resolved));
    assert.deepEqual(clone({ open, resolved }), snap);
    const realOpen = open.filter((x) => !isImpedimentPlaceholder(x));
    const ctx = JSON.stringify({ open, resolved, v });
    assert.equal(v.open.length + v.pending.length, realOpen.length, ctx);
    const pendIds = v.pending.map((p) => p.id);
    assert.equal(new Set(pendIds).size, pendIds.length, ctx);
    v.open.forEach((o) => assert.ok(!pendIds.includes(o.id.trim()), ctx));
    assert.equal(v.resolved.length, resolved.filter((x) => !isImpedimentPlaceholder(x)).length);
    const cnt = {}; v.open.forEach((o) => { cnt[o.id.trim()] = (cnt[o.id.trim()] || 0) + 1; });
    v.open.forEach((o) => { if (cnt[o.id.trim()] > 1) assert.equal(o.duplicate, 'true', ctx); });
    // 画面の「見た行」を送り返すと、実際の未解決の行と全列で一致する（競合判定が通る）
    v.open.forEach((o) => assert.ok(realOpen.some((x) => IM.impedimentRowsEqual(x, o)), ctx));
  }
});

// ---------- 入力検証 ----------
test('validateImpedimentFields: 通ったタイトルの行は雛形扱いで隠れない（検証と雛形判定の整合）', () => {
  const r = rng(8);
  const chars = ['（', '）', ' ', '　', 'a', '障', '\t', '\n', '(', ')'];
  for (let i = 0; i < 5000; i++) {
    let title = ''; for (let k = 0; k < int(r, 6); k++) title += pick(r, chars);
    const v = IV.validateImpedimentFields({ title, reported_by: 'u' });
    const row = impRow('IMP-010', title);
    if (v.ok) assert.equal(isImpedimentPlaceholder(row), false, JSON.stringify(title));
    else assert.equal(isImpedimentPlaceholder(row), true, JSON.stringify(title));
  }
});

test('appendImpediment / updateImpediment: 入力不変・Open で追加・雛形は更新不可・全列競合', () => {
  const rows = deepFreeze([{ ...PLACEHOLDER }, impRow('IMP-002', 'x')]);
  const a = IM.appendImpediment(rows, 'IMP-003', { title: 't', reported_by: 'u', status: 'Resolved', id: 'IMP-099', resolution: 'zz' }, '2026-10-06');
  assert.ok(a.ok);
  assert.equal(a.row.status, 'Open'); assert.equal(a.row.id, 'IMP-003'); assert.equal(a.row.resolution, '');
  assert.equal(IM.appendImpediment(rows, 'IMP-002', {}, 'd').reason, 'duplicate_id');
  assert.equal(IM.updateImpediment(rows, 'IMP-001', { title: 'q' }, PLACEHOLDER).reason, 'not_found');
  assert.equal(IM.updateImpediment(rows, 'IMP-002', { title: 'q' }, { ...rows[1], sprint: 'S9' }).reason, 'conflict');
  const u = IM.updateImpediment(rows, 'IMP-002', { title: 'q', id: 'IMP-777', status: 'Resolved' }, rows[1]);
  assert.ok(u.ok); assert.equal(u.rows[1].title, 'q'); assert.equal(u.rows[1].id, 'IMP-002'); assert.equal(u.rows[1].status, 'Open');
});

test('validatePbiFields: 誤りを全部返す。境界値', () => {
  const st = ['New', 'Done'];
  const v = PV.validatePbiFields({ title: '  ', priority: 'x', status: 'y', size: '-1' }, st);
  assert.equal(v.ok, false); assert.equal(v.errors.length, 4);
  assert.ok(PV.validatePbiFields({ title: 't', size: '' }, st).ok);
  assert.ok(PV.validatePbiFields({ title: 't', size: ' 12 ' }, st).ok);
  assert.equal(PV.validatePbiFields({ title: 't', size: '1.5' }, st).ok, false);
  assert.equal(PV.validatePbiFields({ title: 't', size: '１' }, st).ok, false);
});
