'use strict';
// B2: 不変条件・メタモルフィックな乱数テスト（固定シード）。
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../pure_comment.js');
const H = require('../pure_history.js');
const V = require('../pure_view_impediment.js');
const M = require('../pure_impediment_merge.js');
const { isImpedimentPlaceholder } = require('../pure_grid_report.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); }
  return o;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
function forSeeds(n, fn) {
  for (let seed = 1; seed <= n; seed++) {
    try { fn(mulberry32(seed), seed); } catch (e) { e.message = 'seed=' + seed + ': ' + e.message; throw e; }
  }
}

// ---------- comments ----------
const AUTHORS = ['a@x.com', 'b@x.com', '', 'A@x.com'];
function randComments(r, n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: 'CMT-' + Math.floor(r() * 0xffffffff).toString(16).padStart(8, '0').slice(0, 8),
      target_id: pick(r, ['PBI-1', 'PBI-10', 'IMP-1', ' PBI-1 ', 'bad']),
      author: pick(r, AUTHORS),
      created_at: '2026-10-0' + (1 + Math.floor(r() * 3)) + ' 10:00:0' + Math.floor(r() * 3),
      body: pick(r, ['hi', 'x\ny', '😀']),
    });
  }
  return rows;
}

test('comments: no input mutation', () => {
  forSeeds(100, (r) => {
    const rows = deepFreeze(randComments(r, 6));
    const me = pick(r, AUTHORS);
    C.groupComments(rows, me);
    C.appendComment(rows, 'CMT-00000001', 'PBI-1', me, 'b', '2026-10-01 00:00:00');
    C.deleteComment(rows, rows[0].id, me);
    C.restoreComment(rows, deepFreeze({ id: 'CMT-abcdef01', target_id: 'PBI-1', author: 'a', created_at: '2026-10-01 00:00:00', body: 'x' }));
  });
});

test('comments: delete by non-author forbidden; empty me never matches', () => {
  forSeeds(200, (r) => {
    const rows = randComments(r, 6);
    const target = rows[0];
    for (const me of ['', undefined, null]) {
      const res = C.deleteComment(rows, target.id, me);
      assert.equal(res.ok, false);
      assert.equal(res.reason, 'forbidden');
    }
    const res = C.deleteComment(rows, target.id, target.author + 'zz');
    assert.equal(res.ok, false);
  });
});

test('comments: restore after delete restores identical row; twice is idempotent', () => {
  forSeeds(200, (r) => {
    const rows = [];
    const n = 1 + Math.floor(r() * 5);
    for (let i = 0; i < n; i++) {
      rows.push({ id: 'CMT-0000000' + i, target_id: pick(r, ['PBI-1', 'IMP-2']), author: 'a@x.com',
        created_at: '2026-10-01 10:00:0' + i, body: pick(r, ['hi', '😀', 'a\nb']) });
    }
    const k = Math.floor(r() * n);
    const del = C.deleteComment(rows, rows[k].id, 'a@x.com');
    assert.equal(del.ok, true);
    assert.equal(del.rows.length, n - 1);
    assert.deepEqual(del.removed, rows[k]);
    const res = C.restoreComment(del.rows, del.removed);
    assert.equal(res.ok, true);
    assert.equal(res.rows.length, n);
    assert.deepEqual(res.rows.find((x) => x.id === rows[k].id), rows[k]);
    const res2 = C.restoreComment(res.rows, del.removed);
    assert.equal(res2.ok, true);
    assert.deepEqual(res2.rows, res.rows);
  });
});

test('comments: groupComments oldest-first, stable, only valid targets, mine strict', () => {
  forSeeds(200, (r) => {
    const rows = randComments(r, 12);
    const me = pick(r, AUTHORS);
    const g = C.groupComments(rows, me);
    let total = 0;
    Object.keys(g).forEach((t) => {
      assert.match(t, C.COMMENT_TARGET_RE);
      const list = g[t];
      total += list.length;
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].created_at <= list[i].created_at);
      list.forEach((c) => { assert.equal(c.mine, !!me && c.author === me); });
    });
    assert.equal(total, rows.filter((x) => C.COMMENT_TARGET_RE.test(x.target_id.trim())).length);
  });
});

test('comments: limit counts code points consistently (emoji)', () => {
  assert.equal(C.validateComment('PBI-1', '😀'.repeat(2000)).ok, true);
  assert.equal(C.validateComment('PBI-1', '😀'.repeat(2001)).ok, false);
  assert.equal(C.validateComment('PBI-1', 'a'.repeat(2000)).ok, true);
  assert.equal(C.validateComment('PBI-1', 'a'.repeat(2001)).ok, false);
  assert.equal(C.validateComment('PBI-1', '   ').ok, false);
});

test('comments: target_id trimming consistent between validate/append/group; PBI-1 vs PBI-10', () => {
  assert.equal(C.validateComment(' PBI-1 ', 'x').ok, true);
  const ap = C.appendComment([], 'CMT-00000001', ' PBI-1 ', 'a', 'x', '2026-10-01 00:00:00');
  assert.equal(ap.comment.target_id, 'PBI-1');
  const g = C.groupComments([{ id: 'CMT-00000002', target_id: ' PBI-1 ', author: 'a', created_at: '2026-10-01 00:00:00', body: 'x' }], 'a');
  assert.deepEqual(Object.keys(g), ['PBI-1']);
  const g2 = C.groupComments([
    { id: 'CMT-00000004', target_id: 'PBI-1', author: 'a', created_at: '2026-10-01 00:00:00', body: 'x' },
    { id: 'CMT-00000005', target_id: 'PBI-10', author: 'a', created_at: '2026-10-01 00:00:00', body: 'x' }], 'a');
  assert.equal(g2['PBI-1'].length, 1);
  assert.equal(g2['PBI-10'].length, 1);
});

// ---------- lineDiff ----------
function lcsLen(a, b) {
  const L = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      L[i][j] = a[i - 1] === b[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    }
  }
  return L[a.length][b.length];
}
const lines = (s) => (s === '' ? [] : s.split(/\r?\n/));
function randText(r) {
  const n = Math.floor(r() * 7);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(pick(r, ['a', 'b', 'c', '', ' ']));
  let s = parts.join(pick(r, ['\n', '\r\n']));
  if (r() < 0.3) s += '\n';
  return s;
}

test('lineDiff: same+del / same+add reconstruct, same count = LCS', () => {
  forSeeds(1500, (r) => {
    const a = randText(r);
    const b = randText(r);
    const d = H.lineDiff(a, b);
    assert.deepEqual(d.filter((x) => x.op !== 'add').map((x) => x.text), lines(a), JSON.stringify([a, b]));
    assert.deepEqual(d.filter((x) => x.op !== 'del').map((x) => x.text), lines(b), JSON.stringify([a, b]));
    assert.equal(d.filter((x) => x.op === 'same').length, lcsLen(lines(a), lines(b)), JSON.stringify([a, b]));
  });
});

test('lineDiff: 500 lines diffed, 501 lines whole del/add', () => {
  const mk = (n) => Array.from({ length: n }, (_, i) => 'l' + (i % 7)).join('\n');
  const d500 = H.lineDiff(mk(500), mk(500));
  assert.equal(d500.every((x) => x.op === 'same'), true);
  const d501 = H.lineDiff(mk(501), mk(501));
  assert.equal(d501.filter((x) => x.op === 'same').length, 0);
  assert.equal(d501.length, 1002);
  assert.equal(H.lineDiff(mk(10), mk(501)).filter((x) => x.op === 'same').length, 0);
  assert.deepEqual(H.lineDiff('', ''), []);
  assert.deepEqual(H.lineDiff(undefined, null), []);
});

// ---------- diffRows ----------
const FIELDS = ['id', 'title', 'status', 'updated_at'];
function randRows(r, ids) {
  return ids.filter(() => r() < 0.7).map((id) => ({
    id: (r() < 0.2 ? ' ' + id + ' ' : id), title: pick(r, ['t1', 't2', '']), status: pick(r, ['New', 'Done']), updated_at: String(Math.floor(r() * 3)),
  }));
}
test('diffRows: events applied to before yield after on non-ignored fields; ignore honored; no mutation', () => {
  const ids = ['PBI-1', 'PBI-2', 'PBI-3', 'PBI-4'];
  forSeeds(500, (r) => {
    const before = deepFreeze(randRows(r, ids));
    const after = deepFreeze(randRows(r, ids));
    const ev = H.diffRows(before, after, FIELDS, ['updated_at']);
    ev.forEach((e) => assert.notEqual(e.field, 'updated_at'));
    const state = {};
    before.forEach((x) => { const k = x.id.trim(); if (!(k in state)) state[k] = { title: x.title, status: x.status }; });
    ev.forEach((e) => {
      if (e.action === 'create') { assert.ok(!(e.target_id in state)); state[e.target_id] = { title: '', status: '' }; }
      else if (e.action === 'delete') { assert.ok(e.target_id in state); delete state[e.target_id]; }
      else { assert.equal(state[e.target_id][e.field], e.before); state[e.target_id][e.field] = e.after; }
    });
    // create は項目の差分を出さないので、新規行の値は after から補う
    const want = {};
    after.forEach((x) => { const k = x.id.trim(); if (!(k in want)) want[k] = { title: x.title, status: x.status }; });
    const created = ev.filter((e) => e.action === 'create').map((e) => e.target_id);
    created.forEach((k) => { state[k] = want[k]; });
    assert.deepEqual(state, want);
    assert.deepEqual(H.diffRows(before, clone(before), FIELDS), []);
  });
});

test('diffRows: __proto__ / constructor ids do not break', () => {
  const ev = H.diffRows([], [{ id: '__proto__', title: 'x' }, { id: 'constructor', title: 'y' }], FIELDS);
  assert.deepEqual(ev.map((e) => e.target_id), ['__proto__', 'constructor']);
});

// ---------- historyFor / groupHistory ----------
test('historyFor: newest-first, stable ties, exact target, limit, no mutation', () => {
  forSeeds(300, (r) => {
    const rows = [];
    const n = Math.floor(r() * 25);
    for (let i = 0; i < n; i++) rows.push({ id: 'H' + i, at: '2026-10-0' + (1 + Math.floor(r() * 3)), actor: 'a', target_id: pick(r, ['PBI-1', 'PBI-10', ' PBI-1 ', 'IMP-1']), action: 'update', field: 'f' + i, before: '', after: '' });
    deepFreeze(rows);
    const all = H.historyFor(rows, 'PBI-1');
    const want = rows.map((x, i) => ({ x, i })).filter((p) => p.x.target_id.trim() === 'PBI-1')
      .sort((p, q) => (p.x.at < q.x.at ? 1 : p.x.at > q.x.at ? -1 : p.i - q.i)).map((p) => p.x.field);
    assert.deepEqual(all.map((e) => e.field), want);
    const lim = Math.floor(r() * 6);
    assert.deepEqual(H.historyFor(rows, 'PBI-1', lim).map((e) => e.field), want.slice(0, lim));
    assert.equal(H.historyFor(rows, ' PBI-1').length, all.length);
  });
  const many = Array.from({ length: 250 }, (_, i) => ({ at: '2026-10-01 00:00:' + String(i % 60).padStart(2, '0'), actor: 'a', target_id: 'PBI-1', action: 'update', field: 'f' + i }));
  assert.equal(H.historyFor(many, 'PBI-1').length, H.HISTORY_LIMIT);
  assert.equal(H.historyFor(many, 'PBI-1', H.HISTORY_LIMIT + 1).length, 201);
});

test('groupHistory: groups only consecutive same at+actor, preserves order', () => {
  forSeeds(300, (r) => {
    const es = Array.from({ length: Math.floor(r() * 15) }, (_, i) => ({ at: pick(r, ['t1', 't2']), actor: pick(r, ['a', 'b']), field: 'f' + i }));
    deepFreeze(es);
    const g = H.groupHistory(es);
    assert.deepEqual(g.flatMap((x) => x.items), es);
    for (let i = 1; i < g.length; i++) assert.ok(g[i - 1].at !== g[i].at || g[i - 1].actor !== g[i].actor);
    g.forEach((x) => x.items.forEach((it) => { assert.equal(it.at, x.at); assert.equal(it.actor, x.actor); }));
  });
});

// ---------- impediment view partition ----------
function randImp(r, resolved) {
  return { id: pick(r, ['IMP-001', 'IMP-002', ' IMP-002 ', 'IMP-003', 'IMP-004']), title: pick(r, ['t', 'u', '（例）', '']), description: pick(r, ['d', 'e']), reported_by: 'x', reported_at: pick(r, ['2026-10-01', 'YYYY-MM-DD']), sprint: '1', status: resolved ? 'Resolved' : 'Open', resolved_at: resolved ? '2026-10-02' : '', resolution: resolved ? 'ok' : '' };
}
test('impediment view: every real open row is exactly one of shown/pending; dup flag consistent; no mutation', () => {
  forSeeds(1500, (r, seed) => {
    const open = Array.from({ length: Math.floor(r() * 6) }, () => randImp(r, false));
    const res = Array.from({ length: Math.floor(r() * 5) }, () => randImp(r, true));
    res.forEach((x, i) => { if (open[i] && r() < 0.6) Object.assign(x, open[i], { status: 'Resolved', resolved_at: '2026-10-02', resolution: 'ok' }); });
    deepFreeze(open); deepFreeze(res);
    const v = V.buildImpedimentView(open, res);
    const real = open.filter((o) => !isImpedimentPlaceholder(o));
    const shown = V.openImpedimentsShown(open, res);
    const pend = V.impedimentPendingEntries(open, res);
    assert.equal(shown.length + pend.length, real.length, 'seed ' + seed);
    assert.equal(v.open.length, shown.length);
    assert.equal(v.pending.length, pend.length);
    real.forEach((o) => assert.ok(shown.includes(o) !== pend.some((p) => p.open === o)));
    pend.forEach((p) => assert.equal(real.filter((o) => o.id.trim() === p.id).length, 1));
    const cnt = {};
    real.forEach((o) => { cnt[o.id.trim()] = (cnt[o.id.trim()] || 0) + 1; });
    v.open.forEach((o) => { if (cnt[o.id.trim()] > 1) assert.equal(o.duplicate, 'true'); });
    assert.equal(v.resolved.length, res.filter((x) => !isImpedimentPlaceholder(x)).length);
  });
});

test('impedimentSameIdentity: symmetric, ignores resolution fields, trims id only', () => {
  forSeeds(300, (r) => {
    const a = randImp(r, false);
    const b = randImp(r, true);
    assert.equal(M.impedimentSameIdentity(a, b), M.impedimentSameIdentity(b, a));
    assert.equal(M.impedimentSameIdentity(a, Object.assign({}, a, { status: 'Resolved', resolved_at: 'z', resolution: 'z' })), true);
  });
  assert.equal(M.impedimentSameIdentity({ id: ' IMP-001 ' }, { id: 'IMP-001' }), true);
  assert.equal(M.impedimentSameIdentity({ id: 'IMP-001', title: 'a' }, { id: 'IMP-001', title: ' a' }), false);
});
