'use strict';
// 2巡目 V: 純関数層の、未到達だった分岐（null / undefined / 空・境界のフォールバック）。
// 「欠けた入力でも例外にならず、仕様どおりの空・既定を返す」ことと、その次に続く規則を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');

const filter = require('../pure_filter.js');
const csv = require('../pure_csv.js');
const csvw = require('../pure_csv_write.js');
const comment = require('../pure_comment.js');
const history = require('../pure_history.js');
const merge = require('../pure_merge.js');
const impMerge = require('../pure_impediment_merge.js');
const impView = require('../pure_view_impediment.js');
const gridBoard = require('../pure_grid_board.js');
const gridReport = require('../pure_grid_report.js');
const gridBacklog = require('../pure_grid_backlog.js');
const pbiId = require('../pure_pbi_id.js');
const pbiValidate = require('../pure_pbi_validate.js');
const sprintOptions = require('../pure_sprint_options.js');
const summary = require('../pure_summary.js');
const viewSprint = require('../pure_view_sprint.js');
const boardView = require('../pure_board_view.js');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- pure_filter ----------------------------------------------------------
test('isPlaceholderRow / filterRealRows / pickLatestSprintName: 欠けた入力でも例外にならない', () => {
  assert.equal(filter.isPlaceholderRow(undefined), true);
  assert.equal(filter.isPlaceholderRow(null), true);
  assert.deepEqual(filter.filterRealRows(undefined), []);
  assert.deepEqual(filter.filterRealRows(null), []);
  assert.equal(filter.pickLatestSprintName(undefined), null);
  assert.equal(filter.pickLatestSprintName([undefined, null, 'sprint2']), 'sprint2');
  assert.equal(filter.pickLatestSprintName(['sprint01', 'sprint1']), 'sprint01', '同じ番号は先に出たほう');
  assert.equal(filter.pickLatestSprintName(['sprint9', 'sprint10', 'sprint100x', 'Sprint11']), 'sprint10');
});

test('normalizeSprint: 区切りと大文字小文字の揺れ・桁揃え。数字で終わらない名前はそのまま小文字', () => {
  assert.equal(filter.normalizeSprint(' Sprint_1 '), 'sprint001');
  assert.equal(filter.normalizeSprint('SPRINT-0001'), 'sprint001');
  assert.equal(filter.normalizeSprint('sprint 1000'), 'sprint1000');
  assert.equal(filter.normalizeSprint('Backlog'), 'backlog');
  assert.equal(filter.normalizeSprint(null), '');
  assert.equal(filter.normalizeSprint('   '), '');
  assert.equal(filter.normalizeSprint('7'), '007');
});

// ---- pure_csv -------------------------------------------------------------
test('findOverlongCsvRow: 1行以下・空・見出しだけは null。余りが空白だけの行は見逃す', () => {
  assert.equal(csv.findOverlongCsvRow(''), null);
  assert.equal(csv.findOverlongCsvRow(undefined), null);
  assert.equal(csv.findOverlongCsvRow('a,b\n'), null);
  assert.equal(csv.findOverlongCsvRow('a,b\n1,2, ,\n'), null);
  const bad = csv.findOverlongCsvRow('a,b\n1,2\n x ,3,4\n');
  assert.deepEqual(JSON.parse(JSON.stringify(bad)), { id: 'x', line: 3, cells: 3, expected: 2 });
});

test('findOverlongCsvRow: 引用符の中の改行を数えた行番号を返す', () => {
  const bad = csv.findOverlongCsvRow('a,b\n"x\ny",2\n3,4,5\n');
  assert.equal(bad.line, 4);
  assert.equal(bad.id, '3');
});

test('csvEndsInsideQuotes: BOM・CR のみの改行・null を parseCsv と同じ読み方で扱う', () => {
  assert.equal(csv.csvEndsInsideQuotes(null), false);
  assert.equal(csv.csvEndsInsideQuotes('﻿"abc'), true, 'BOM の直後の引用符も開始とみなす');
  assert.equal(csv.csvEndsInsideQuotes('a\r"b'), true, 'CR だけの改行の後の引用符は開始');
  assert.equal(csv.csvEndsInsideQuotes('a\r\n"b"\r\n'), false);
  assert.equal(csv.csvEndsInsideQuotes('a,5" モニタ\n'), false, '途中の引用符は文字');
  assert.equal(csv.csvEndsInsideQuotes('"a""'), true);
});

test('parseCsv と csvEndsInsideQuotes は、乱択した入力で「閉じていないか」の判断が一致する', () => {
  const r = mulberry32(20261006);
  const alpha = ['a', 'b', '"', ',', '\n', '\r', '\r\n', ' ', 'é'];
  for (let n = 0; n < 3000; n++) {
    let s = r() < 0.1 ? '﻿' : '';
    const len = Math.floor(r() * 14);
    for (let i = 0; i < len; i++) s += alpha[Math.floor(r() * alpha.length)];
    // 閉じていないなら、末尾に行を足しても、その行は別の行にならない（セルの続きとして飲み込まれる）
    const open = csv.csvEndsInsideQuotes(s);
    const rows = csv.parseCsv(s + '\nZ,Z');
    const last = rows[rows.length - 1];
    const separate = last.length === 2 && last[0] === 'Z' && last[1] === 'Z';
    assert.equal(separate, !open, 'seed 20261006 n=' + n + ' input=' + JSON.stringify(s) + ' open=' + open);
  }
});

// ---- pure_comment ---------------------------------------------------------
test('comment: 欠けた入力（null の rows / author / body）は空として扱う', () => {
  assert.deepEqual(comment.validateComment(null, null).errors.length, 2);
  const r = comment.appendComment(null, 'CMT-00000001', null, null, null, '2026-01-01 00:00:00');
  assert.equal(r.rows.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.comment)), { id: 'CMT-00000001', target_id: '', author: '', created_at: '2026-01-01 00:00:00', body: '' });
  assert.equal(comment.deleteComment(null, 'x', 'me').reason, 'not_found');
  assert.deepEqual(comment.groupComments(null, undefined), {});
  assert.equal(comment.restoreComment(null, null).reason, 'invalid');
  assert.equal(comment.restoreComment(undefined, { id: 'CMT-1', target_id: 'PBI-1', body: 'x', created_at: 't' }).ok, true);
});

test('deleteComment: ID の前後の空白は無視、ログインが空なら空の作者のコメントも消せない', () => {
  const rows = [{ id: 'CMT-1', target_id: 'PBI-1', author: '', created_at: 't', body: 'x' }];
  assert.equal(comment.deleteComment(rows, ' CMT-1 ', '').reason, 'forbidden');
  assert.equal(comment.deleteComment(rows, ' CMT-1 ', undefined).reason, 'forbidden');
  const ok = comment.deleteComment([{ id: 'CMT-1', target_id: 'PBI-1', author: 'a', created_at: 't', body: 'x' }], ' CMT-1 ', 'a');
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.rows, []);
});

test('groupComments: 同じ時刻は元の並び、対象ごとに分ける。形の違う対象・空は捨てる。mine は本人のみ', () => {
  const rows = [
    { id: '3', target_id: 'PBI-1', author: 'a', created_at: '2026-01-02', body: 'c' },
    { id: '1', target_id: ' PBI-1 ', author: 'b', created_at: '2026-01-01', body: 'a' },
    { id: '2', target_id: 'PBI-1', author: 'a', created_at: '2026-01-01', body: 'b' },
    { id: '4', target_id: 'xx', author: 'a', created_at: '2026-01-01', body: 'd' },
    { id: '5', target_id: 'IMP-2', author: '', created_at: '2026-01-01', body: 'e' },
  ];
  const g = JSON.parse(JSON.stringify(comment.groupComments(rows, 'a')));
  assert.deepEqual(Object.keys(g).sort(), ['IMP-2', 'PBI-1']);
  assert.deepEqual(g['PBI-1'].map((c) => c.id), ['1', '2', '3']);
  assert.deepEqual(g['PBI-1'].map((c) => c.mine), [false, true, true]);
  assert.equal(g['IMP-2'][0].mine, false, '作者が空でログインも空なら本人ではない');
  assert.equal(JSON.parse(JSON.stringify(comment.groupComments(rows, '')))['IMP-2'][0].mine, false);
});

// ---- pure_merge -----------------------------------------------------------
test('merge: null / 空の入力のガード', () => {
  assert.equal(merge.applyRowUpdate(null, '', {}, '', 't').reason, 'not_found');
  assert.equal(merge.applyRowUpdate(null, 'PBI-1', {}, '', 't').reason, 'not_found');
  assert.equal(merge.deleteRow(null, 'PBI-1', '').reason, 'not_found');
  const a = merge.appendRow(null, 'PBI-1', null, null, 't');
  assert.deepEqual(JSON.parse(JSON.stringify(a.rows)), [{ id: 'PBI-1', created_at: 't', updated_at: 't' }]);
  assert.equal(merge.restoreRow(null, null, [], 't').reason, 'invalid');
  assert.equal(merge.restoreRow(null, { id: '  ' }, [], 't').reason, 'invalid');
  const r = merge.restoreRow(undefined, { id: 'PBI-1', title: 'x', evil: 1 }, ['id', 'title', 'updated_at'], 'now');
  assert.deepEqual(JSON.parse(JSON.stringify(r.rows)), [{ id: 'PBI-1', title: 'x', updated_at: 'now' }]);
});

test('restoreRow: 雛形の行を戻すときは、同じ ID の本物の行があれば重複とする（本物を戻すときは雛形を数えない）', () => {
  const placeholder = { id: 'PBI-001', title: '（雛形）', created_at: 'YYYY-MM-DD', priority: 'a/b' };
  const real = { id: 'PBI-001', title: '本物', created_at: 't', priority: 'Low' };
  const f = ['id', 'title', 'created_at', 'priority', 'updated_at'];
  assert.equal(merge.restoreRow([placeholder], real, f, 'n').ok, true);
  assert.equal(merge.restoreRow([real], placeholder, f, 'n').reason, 'duplicate_id');
  assert.equal(merge.restoreRow([placeholder], placeholder, f, 'n').reason, 'duplicate_id');
  assert.equal(merge.restoreRow([real], real, f, 'n', { allowSameId: true }).rows.length, 2);
});

test('addOneSecondToTimeText_: 不正な日付・閏年・年またぎ・桁あふれ', () => {
  const add = merge.addOneSecondToTimeText_;
  assert.equal(add('2026-12-31 23:59:59'), '2027-01-01 00:00:00');
  assert.equal(add('2028-02-28 23:59:59'), '2028-02-29 00:00:00');
  assert.equal(add('2026-02-28 23:59:59'), '2026-03-01 00:00:00');
  assert.equal(add('2026-09-05'), '2026-09-05 00:00:01');
  assert.equal(add('abc'), null);
  assert.equal(add(''), null);
  assert.equal(add(undefined), null);
  assert.equal(add('2026-09-05T10:00:00'), null);
});

test('advanceUpdatedAt_: どんな prev でも、結果は prev より辞書順で大きい（乱択）', () => {
  const r = mulberry32(777);
  const pad = (n, w) => ('0000' + n).slice(-w);
  for (let i = 0; i < 5000; i++) {
    const kind = r();
    let prev;
    if (kind < 0.4) prev = pad(Math.floor(r() * 10000), 4) + '-' + pad(Math.floor(r() * 14), 2) + '-' + pad(Math.floor(r() * 33), 2) + ' ' + pad(Math.floor(r() * 26), 2) + ':' + pad(Math.floor(r() * 62), 2) + ':' + pad(Math.floor(r() * 62), 2);
    else if (kind < 0.6) prev = pad(Math.floor(r() * 10000), 4) + '-' + pad(Math.floor(r() * 14), 2) + '-' + pad(Math.floor(r() * 33), 2);
    else if (kind < 0.7) prev = '9999-12-31 23:59:59' + (r() < 0.5 ? '#1' : '');
    else if (kind < 0.8) prev = '';
    else prev = ['', 'x', '#', '2026-01-01 00:00:00#1#1', '0000-00-00 00:00:00'][Math.floor(r() * 5)];
    const now = r() < 0.5 ? '2026-01-01 00:00:00' : pad(Math.floor(r() * 10000), 4) + '-01-01 00:00:00';
    const out = merge.advanceUpdatedAt_(now, prev);
    assert.ok(out > prev, 'seed 777 i=' + i + ' now=' + now + ' prev=' + JSON.stringify(prev) + ' out=' + out);
    assert.ok(out >= now, 'now より小さい値は書かない: ' + out);
  }
});

// ---- pure_history ---------------------------------------------------------
test('diffRows: null の入力・id の無い行・fields 無しは何も出さない', () => {
  assert.deepEqual(history.diffRows(null, null, null, null), []);
  assert.deepEqual(history.diffRows([{ title: 'x' }, null], [{ title: 'y' }, null], ['id', 'title'], []), []);
  assert.deepEqual(history.diffRows([{ id: 'A', title: 'x' }], [{ id: 'A', title: 'y' }], undefined, undefined), []);
});

test('diffRows: id の前後の空白は同じ行、同じ参照の行が重なっても delete は1回、プロトタイプ名の ID でも壊れない', () => {
  const o = history.diffRows([{ id: ' A ', t: '1' }], [{ id: 'A', t: '2' }], ['id', 't'], []);
  assert.deepEqual(JSON.parse(JSON.stringify(o)), [{ target_id: 'A', action: 'update', field: 't', before: '1', after: '2' }]);
  const proto = history.diffRows([{ id: '__proto__', t: '1' }, { id: 'constructor', t: '1' }], [{ id: '__proto__', t: '2' }], ['id', 't'], []);
  assert.deepEqual(JSON.parse(JSON.stringify(proto)), [
    { target_id: '__proto__', action: 'update', field: 't', before: '1', after: '2' },
    { target_id: 'constructor', action: 'delete' },
  ]);
  const same = { id: 'D', t: '1' };
  assert.deepEqual(JSON.parse(JSON.stringify(history.diffRows([same], [], ['id', 't'], []))), [{ target_id: 'D', action: 'delete' }]);
});

test('diffRows: null / undefined / 数値の値は文字列として比べる（null と空文字は同じ）', () => {
  assert.deepEqual(history.diffRows([{ id: 'A', t: null, n: 1 }], [{ id: 'A', t: '', n: '1' }], ['id', 't', 'n'], []), []);
  assert.equal(history.diffRows([{ id: 'A', t: undefined }], [{ id: 'A', t: '0' }], ['id', 't'], []).length, 1);
});

test('historyRows / historyFor / groupHistory: 欠けた値は空文字、limit 0 は空、同じ時刻は元の並び', () => {
  let n = 0;
  const rows = history.historyRows([{ target_id: 'PBI-1', action: 'update' }, { target_id: null }], { at: undefined, actor: null, newId: () => 'CHG-' + (++n) });
  assert.deepEqual(JSON.parse(JSON.stringify(rows[1])), { id: 'CHG-2', at: '', actor: '', target_id: '', action: '', field: '', before: '', after: '' });
  assert.deepEqual(history.historyRows(null, {}), []);
  const log = [
    { target_id: 'PBI-1', at: '2026-01-01', actor: 'a', action: 'x' },
    { target_id: 'PBI-1', at: '2026-01-02', actor: 'a', action: 'y' },
    { target_id: 'PBI-1', at: '2026-01-02', actor: 'a', action: 'z' },
    { target_id: ' PBI-1 ', at: '2026-01-03', actor: 'b', action: 'w' },
    { target_id: 'PBI-2', at: '2027-01-01', actor: 'a', action: 'q' },
  ];
  assert.deepEqual(history.historyFor(log, 'PBI-1').map((e) => e.action), ['w', 'y', 'z', 'x']);
  assert.deepEqual(history.historyFor(log, ' PBI-1 ', 2).map((e) => e.action), ['w', 'y']);
  assert.deepEqual(history.historyFor(log, 'PBI-1', 0), []);
  assert.deepEqual(history.historyFor(null, 'PBI-1'), []);
  assert.deepEqual(history.historyFor([{ target_id: 'PBI-1' }], undefined), []);
  const g = history.groupHistory(history.historyFor(log, 'PBI-1'));
  assert.deepEqual(g.map((x) => [x.at, x.items.length]), [['2026-01-03', 1], ['2026-01-02', 2], ['2026-01-01', 1]]);
  assert.deepEqual(history.groupHistory(null), []);
});

test('lineDiff: same+del で前、same+add で後ろが必ず復元できる（乱択）。上限超えは丸ごと del/add', () => {
  const r = mulberry32(4242);
  const words = ['a', 'b', 'c', '', 'd'];
  const gen = () => { const n = Math.floor(r() * 7); const out = []; for (let i = 0; i < n; i++) out.push(words[Math.floor(r() * words.length)]); return out.join(r() < 0.3 ? '\r\n' : '\n'); };
  for (let i = 0; i < 800; i++) {
    const a = gen(), b = gen();
    const d = history.lineDiff(a, b);
    const split = (s) => (s === '' ? [] : s.split(/\r?\n/));
    assert.deepEqual(d.filter((x) => x.op !== 'add').map((x) => x.text), split(a), 'seed 4242 i=' + i + ' a=' + JSON.stringify(a) + ' b=' + JSON.stringify(b));
    assert.deepEqual(d.filter((x) => x.op !== 'del').map((x) => x.text), split(b), 'seed 4242 i=' + i);
  }
  const big = Array.from({ length: history.LINE_DIFF_MAX + 1 }, (_, i) => 'l' + i).join('\n');
  const d = history.lineDiff(big, 'x');
  assert.equal(d.filter((x) => x.op === 'same').length, 0);
  assert.equal(d.length, history.LINE_DIFF_MAX + 2);
  assert.deepEqual(history.lineDiff(null, undefined), []);
});

// ---- pure_impediment_merge --------------------------------------------------
const IM = (id, title, extra) => Object.assign({ id, title, description: 'd', reported_by: 'r', reported_at: '2026-01-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' }, extra || {});

test('impediment_merge: null の入力のガード（例外にならず、理由つきで断る）', () => {
  assert.equal(impMerge.impedimentRowsEqual(null, undefined), true);
  assert.equal(impMerge.impedimentRowsEqual({ id: 'a' }, null), false);
  assert.equal(impMerge.impedimentSameIdentity(null, null), true);
  assert.equal(impMerge.impedimentHalfResolved(null, null, 'IMP-1'), false);
  assert.equal(impMerge.updateImpediment(null, 'IMP-1', null, null).reason, 'not_found');
  assert.equal(impMerge.planResolve(null, null, 'IMP-1', 'x', null, 't').reason, 'not_found');
  assert.equal(impMerge.planUnresolve(null, null, null, null).reason, 'invalid');
  const a = impMerge.appendImpediment(null, 'IMP-001', null, '2026-01-01');
  assert.equal(a.ok, true);
  assert.equal(a.row.status, 'Open');
  assert.equal(a.row.reported_at, '2026-01-01');
});

test('appendImpediment: ID の前後の空白は落として保存し、重複は空白違いでも検出する。サーバ決定の列は申告で上書きできない', () => {
  const rows = [IM('IMP-001', 't')];
  assert.equal(impMerge.appendImpediment(rows, ' IMP-001 ', {}, 'd').reason, 'duplicate_id');
  const a = impMerge.appendImpediment(rows, ' IMP-002 ', { title: 'x', reported_by: 'me', status: 'Resolved', resolution: 'ずる', reported_at: '1999-01-01', id: 'IMP-999' }, '2026-02-02');
  assert.equal(a.row.id, 'IMP-002');
  assert.equal(a.row.status, 'Open');
  assert.equal(a.row.resolution, '');
  assert.equal(a.row.reported_at, '2026-02-02');
  assert.equal(a.rows.length, 2);
});

test('updateImpediment: 編集可の列だけ書き換わり、ID・状態・解決の列は申告しても変わらない。雛形は触れない', () => {
  const rows = [IM('IMP-001', '雛形のはず', { reported_at: 'YYYY-MM-DD' }), IM('IMP-001', '本物')];
  const r = impMerge.updateImpediment(rows, 'IMP-001', { title: '新', status: 'Resolved', id: 'IMP-9', resolution: 'ずる', sprint: null }, rows[1]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.rows[1].title, '新');
  assert.equal(r.rows[1].sprint, '');
  assert.equal(r.rows[1].status, 'Open');
  assert.equal(r.rows[1].id, 'IMP-001');
  assert.equal(r.rows[1].resolution, '');
  assert.equal(r.rows[0].title, '雛形のはず');
  assert.equal(rows[1].title, '本物', '入力は書き換えない');
});

test('planResolve: 解決の再送（resolved に同じ行がある）は resolved を書かず、open からだけ消す', () => {
  const open = [IM('IMP-001', 't')];
  const resolved = [IM('IMP-001', 't', { status: 'Resolved', resolved_at: '2026-01-05', resolution: 'x' })];
  const r = impMerge.planResolve(open, resolved, 'IMP-001', 'y', open[0], '2026-02-02');
  assert.equal(r.ok, true);
  assert.equal(r.resolved, null);
  assert.deepEqual(r.open, []);
  assert.equal(r.resolvedRow.resolution, 'x', '前回の解決策を変えない');
});

test('planUnresolve: 取り消しの再送（open に戻っていて resolved に無い）は何も書かず成功', () => {
  const src = IM('IMP-001', 't');
  const r = impMerge.planUnresolve([src], [], src, IM('IMP-001', 't', { status: 'Resolved' }));
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true, open: null, resolved: null });
  const r2 = impMerge.planUnresolve([], [], src, IM('IMP-001', 't', { status: 'Resolved' }));
  assert.equal(r2.reason, 'not_found');
  const r3 = impMerge.planUnresolve([IM('IMP-001', '別物')], [IM('IMP-001', 't', { status: 'Resolved' })], src, IM('IMP-001', 't', { status: 'Resolved' }));
  assert.equal(r3.reason, 'duplicate_id');
});

test('planUnresolve: 形の不正な ID・空タイトル・resolvedRow の ID 食い違いは invalid', () => {
  const good = IM('IMP-001', 't');
  const res = IM('IMP-001', 't', { status: 'Resolved' });
  assert.equal(impMerge.planUnresolve([], [res], IM('XX-1', 't'), IM('XX-1', 't')).reason, 'invalid');
  assert.equal(impMerge.planUnresolve([], [res], IM('IMP-001', '  '), res).reason, 'invalid');
  assert.equal(impMerge.planUnresolve([], [res], good, IM('IMP-002', 't')).reason, 'invalid');
  assert.equal(impMerge.planUnresolve([], [res], IM(' IMP-001 ', 't'), res).ok, true, 'ID の空白は無視');
});

// ---- pure_view_impediment ---------------------------------------------------
test('buildImpedimentView: null の入力は空のビュー。解決済の行はそのまま全列が出る', () => {
  const v = impView.buildImpedimentView(null, null);
  assert.deepEqual(JSON.parse(JSON.stringify({ o: v.open, r: v.resolved, p: v.pending })), { o: [], r: [], p: [] });
  assert.equal(v.columns.length, 8);
  const v2 = impView.buildImpedimentView([IM('IMP-001', 't', { description: null })], [IM('IMP-002', 'u', { status: 'Resolved', resolution: 'ok' })]);
  assert.equal(v2.open[0].description, '', 'null は空文字');
  assert.equal(v2.resolved[0].resolution, 'ok');
  assert.equal(Object.keys(v2.resolved[0]).length, 9, '全列（status を含む）を持つ');
});

test('openImpedimentsShown / impedimentPendingEntries: 未解決に同じ ID が複数あれば隠さず、pending にもしない', () => {
  const a = IM('IMP-001', 't');
  const res = IM('IMP-001', 't', { status: 'Resolved' });
  assert.equal(impView.openImpedimentsShown([a, a], [res]).length, 2);
  assert.deepEqual(impView.impedimentPendingEntries([a, a], [res]), []);
  assert.equal(impView.openImpedimentsShown([a], [res]).length, 0);
  assert.equal(impView.impedimentPendingEntries([a], [res]).length, 1);
  assert.equal(impView.openImpedimentsShown(null, null).length, 0);
});

test('buildImpedimentView: 解決済と中身の違う同 ID の未解決は duplicate 印を付けて出す', () => {
  const v = impView.buildImpedimentView([IM('IMP-001', '別物')], [IM('IMP-001', 't', { status: 'Resolved' })]);
  assert.equal(v.open.length, 1);
  assert.equal(v.open[0].duplicate, 'true');
  const v2 = impView.buildImpedimentView([IM('IMP-002', 'x')], []);
  assert.equal(v2.open[0].duplicate, undefined);
});

// ---- pure_grid_* ----------------------------------------------------------
test('grid_board: null / 欠けた値でも空の表。未知のステータスは New。スプリント名が prototype 名でも壊れない', () => {
  assert.equal(gridBoard.buildKanbanGrid(null).length, 1);
  assert.equal(gridBoard.buildKanbanGrid(undefined)[0].length, 5);
  const g = gridBoard.buildKanbanGrid([{ id: ' PBI-1 ', title: ' t ', status: 'weird' }, { id: 'PBI-2', title: 'u', status: undefined }]);
  assert.deepEqual(g[1], ['PBI-1 t', '', '', '', '']);
  assert.deepEqual(g[2], ['PBI-2 u', '', '', '', '']);
  const rm = gridBoard.buildRoadmapGrid(null, null);
  assert.deepEqual(rm.grid, [['ID', 'タイトル']]);
  assert.deepEqual(rm.marks, []);
  const vel = [{ sprint: 'constructor', sprint_start: '2026-01-01', sprint_end: '2026-01-02' }, { sprint: '__proto__', sprint_start: '2026-01-03', sprint_end: '2026-01-04' }];
  const rm2 = gridBoard.buildRoadmapGrid([{ id: 'PBI-1', title: 't', sprint: '__proto__' }], vel);
  assert.equal(rm2.grid[0].length, 4);
  assert.deepEqual(rm2.marks, [{ row: 1, col: 3 }]);
});

test('buildRoadmapGrid: 表記違いの同じスプリントは1列。帯の位置は列の位置と一致する（乱択）', () => {
  const r = mulberry32(31337);
  const spell = (n) => ['Sprint ' + n, 'sprint' + ('00' + n).slice(-3), 'SPRINT_' + n][Math.floor(r() * 3)];
  for (let it = 0; it < 300; it++) {
    const nS = 1 + Math.floor(r() * 5);
    const vel = [];
    for (let i = 1; i <= nS; i++) { const c = 1 + Math.floor(r() * 2); for (let k = 0; k < c; k++) vel.push({ sprint: spell(i), sprint_start: '2026-01-0' + i, sprint_end: '2026-02-0' + i }); }
    const rows = [];
    for (let i = 1; i <= 6; i++) rows.push({ id: 'PBI-' + i, title: 't' + i, sprint: r() < 0.2 ? '' : spell(1 + Math.floor(r() * (nS + 1))) });
    const out = gridBoard.buildRoadmapGrid(rows, vel);
    out.marks.forEach((m) => {
      assert.equal(out.grid[m.row][m.col], '■', 'it=' + it);
      assert.ok(m.col >= 2);
    });
    // ■ の数 = marks の数
    let cnt = 0; out.grid.slice(1).forEach((row) => row.forEach((c) => { if (c === '■') cnt++; }));
    assert.equal(cnt, out.marks.length, 'it=' + it);
    // 見出しのスプリント列は、正規化したときの種類の数
    const kinds = new Set(vel.map((v) => require('../pure_filter.js').normalizeSprint(v.sprint)));
    assert.equal(out.grid[0].length - 2, kinds.size, 'it=' + it);
  }
});

test('grid_report: ダッシュボード・同期ログ・配布情報・障害物の欠けた入力', () => {
  const d = gridReport.buildDashboardGrid(null);
  const width = d[0].length;
  d.forEach((row) => assert.equal(row.length, width, '全行の列数が揃っている'));
  assert.ok(d.some((r) => r[0] === '（未設定）'));
  assert.ok(d.some((r) => r[0] === 'なし'));
  assert.deepEqual(d.find((r) => r[0] === '配布日時'), ['配布日時', '（記録なし）', '']);
  const d2 = gridReport.buildDashboardGrid({ published: { publishedAt: '2026-02-01', commit: 'abc' }, backlogRows: [{ id: 'PBI-1', title: 't', status: 'Weird', size: 'abc' }, { id: 'PBI-2', title: 'u', status: 'Done', size: '2.5' }], warnings: ['w1'] });
  assert.deepEqual(d2.find((r) => r[0] === 'コミット').slice(0, 2), ['コミット', 'abc']);
  assert.deepEqual(d2.find((r) => r[0] === 'New').slice(0, 3), ['New', '1', '0']);
  assert.deepEqual(d2.find((r) => r[0] === 'Done').slice(0, 3), ['Done', '1', '2.5']);
  assert.deepEqual(d2.find((r) => r[0] === '合計').slice(0, 3), ['合計', '2', '2.5']);
  assert.ok(d2.some((r) => r[0] === 'w1'));
  assert.deepEqual(gridReport.buildSyncLogGrid(null, null, null)[1], ['', 'なし', 'なし']);
  assert.deepEqual(gridReport.buildSyncLogGrid('t', ['a', 'b'], ['w'])[1], ['t', 'a\nb', 'w']);
});

test('parsePublished: 壊れた JSON・配列・publishedAt 無し・空白は null。commit/branch の欠けは unknown', () => {
  ['', null, undefined, '{bad', '[]', '123', 'null', '{}', '{"publishedAt":"  "}'].forEach((t) => assert.equal(gridReport.parsePublished(t), null, String(t)));
  assert.deepEqual(JSON.parse(JSON.stringify(gridReport.parsePublished('{"publishedAt":" 2026-01-01 ","commit":"  "}'))), { publishedAt: '2026-01-01', commit: 'unknown', branch: 'unknown' });
});

test('buildImpedimentGrid / buildVelocityGrid / buildBurndownGrid: 欠けた入力・雛形除外・メモ', () => {
  assert.equal(gridReport.buildImpedimentGrid(null, null, null).length, 1);
  const g = gridReport.buildImpedimentGrid([IM('IMP-001', 't', { description: undefined }), IM('IMP-002', '（雛形）')], [IM('IMP-003', 'u', { status: 'Resolved' })], { 'IMP-003': 'めも' });
  assert.equal(g.length, 3);
  assert.equal(g[1][2], '');
  assert.equal(g[2][g[2].length - 1], 'めも');
  assert.equal(gridReport.buildVelocityGrid(null).length, 1);
  assert.equal(gridReport.buildVelocityGrid([{ sprint: 'a', sprint_start: '2026-1-1', sprint_end: '2026-01-02' }]).length, 1, '日付の形が違う行は出さない');
  assert.equal(gridReport.buildBurndownGrid(''), null);
  assert.equal(gridReport.buildBurndownGrid(undefined), null);
});

test('grid_backlog: null の入力。メモは ID の前後の空白を無視して引く', () => {
  assert.equal(gridBacklog.buildBacklogGrid(null, null).length, 1);
  assert.equal(gridBacklog.buildDoneBacklogGrid(undefined).length, 1);
  const g = gridBacklog.buildBacklogGrid([{ id: ' PBI-1 ', title: 't', created_at: '2026-01-01' }], { 'PBI-1': 'メモ' });
  assert.equal(g[1][g[1].length - 1], 'メモ');
  assert.equal(g[1][2], '', '欠けた列は空文字');
});

// ---- pure_pbi_id / validate / sprint_options -------------------------------
test('pbi_id: 欠けた入力・桁あふれ・0 の番号', () => {
  assert.equal(pbiId.nextPbiId(null, undefined), 'PBI-001');
  assert.equal(pbiId.nextPbiId(['PBI-009'], null), 'PBI-010');
  assert.equal(pbiId.nextPbiId([{ id: 'PBI-999' }], ''), 'PBI-1000');
  assert.equal(pbiId.nextPbiId([{ id: 'PBI-0099' }], ''), 'PBI-0100');
  assert.equal(pbiId.nextPbiId([{ id: 'PBI-1' }], 'PBI-12345678901234567890'), 'PBI-12345678901234567891');
  assert.equal(pbiId.maxPbiId([null, undefined, {}, 'xx', 'PBI-2', { id: 'PBI-10' }]), 'PBI-10');
  assert.equal(pbiId.maxPbiId(null), null);
  assert.equal(pbiId.comparePbiIds('PBI-2', 'PBI-10'), -1);
  assert.equal(pbiId.comparePbiIds('xx', 'xx'), 0);
  assert.equal(pbiId.comparePbiIds('xx', 'PBI-1'), -1);
  assert.equal(pbiId.comparePbiIds('PBI-1', 'xx'), 1);
  assert.equal(pbiId.pbiIdNumber('PBI-007'), 7);
  assert.equal(pbiId.pbiIdNumber(null), null);
  assert.equal(pbiId.isPbiIdWithinHighWater('PBI-000', [], ''), false);
  assert.equal(pbiId.isPbiIdWithinHighWater('PBI-5', [], ''), true, '上限が立たないときはあきらめて通す');
  assert.equal(pbiId.isPbiIdWithinHighWater('PBI-5', [], 'PBI-004'), false);
  assert.equal(pbiId.isPbiIdWithinHighWater('PBI-5', null, 'PBI-005'), true);
  assert.equal(pbiId.isPbiIdWithinHighWater(undefined, [], ''), false);
});

test('nextPbiId: 乱択した ID 群で、結果は常に全 ID より大きく、桁は落ちない', () => {
  const r = mulberry32(99);
  for (let i = 0; i < 2000; i++) {
    const ids = [];
    const n = Math.floor(r() * 5);
    for (let k = 0; k < n; k++) {
      const digits = 1 + Math.floor(r() * 25);
      let d = ''; for (let j = 0; j < digits; j++) d += String(Math.floor(r() * 10));
      ids.push('PBI-' + d);
    }
    const hw = r() < 0.5 ? '' : 'PBI-' + String(Math.floor(r() * 1000)).padStart(3, '0');
    const next = pbiId.nextPbiId(ids, hw);
    ids.concat(hw ? [hw] : []).forEach((x) => assert.equal(pbiId.comparePbiIds(next, x), 1, 'i=' + i + ' ' + next + ' vs ' + x));
    // 番号は最大値 + 1 ちょうどで、桁は最大値の ID の桁（同じ値が複数あれば短い方）より落ちない（PR #11 cubic）
    const all = ids.concat(hw ? [hw] : []);
    const nextDigits = next.slice('PBI-'.length);
    if (all.length === 0) { assert.equal(next, 'PBI-001'); continue; }
    const max = all.reduce((m, x) => (BigInt(x.slice(4)) > m ? BigInt(x.slice(4)) : m), -1n);
    const maxWidth = Math.min.apply(null, all.filter((x) => BigInt(x.slice(4)) === max).map((x) => x.length - 4));
    assert.equal(BigInt(nextDigits), max + 1n, 'i=' + i + ' ' + next);
    assert.ok(nextDigits.length >= maxWidth, 'i=' + i + ' 桁が落ちた: ' + next + ' / ' + JSON.stringify(all));
  }
});

test('validatePbiFields: null の fields は全項目の誤りではなくタイトル不足だけ。優先度 null・ステータス未指定の扱い', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(pbiValidate.validatePbiFields(null, null).errors)), ['タイトルを入力してください。']);
  assert.equal(pbiValidate.validatePbiFields({ title: 't', priority: null }, []).ok, false, 'priority:null は指定された不正値');
  assert.equal(pbiValidate.validatePbiFields({ title: 't', status: 'Done' }, null).ok, false, '語彙が無ければ全部不正');
  assert.equal(pbiValidate.validatePbiFields({ title: 't', size: null }, []).ok, true);
  assert.equal(pbiValidate.validatePbiFields({ title: 't', size: ' ' }, []).ok, true);
});

test('sprintOptions / sprintChoices: null の入力、同名の重複排除、prototype 名、未知の綴りは unknown', () => {
  const o = sprintOptions.sprintOptions(null);
  assert.equal(o.length, 1);
  assert.equal(o[0].value, '');
  const c = sprintOptions.sprintChoices(null, null);
  assert.equal(c.length, 1);
  const vel = [{ sprint: 'sprint001', sprint_start: '2026-01-01', sprint_end: '2026-01-02' }, { sprint: 'sprint001', sprint_start: '2026-01-01', sprint_end: '2026-01-02' }];
  const c2 = sprintOptions.sprintChoices(vel, [
    { id: 'PBI-1', title: 't', sprint: 'Sprint 001' },
    { id: 'PBI-2', title: 't', sprint: '__proto__' },
    { id: 'PBI-3', title: 't', sprint: '__proto__ ' },
    { id: 'PBI-4', title: 't', sprint: 'sprint 099' },
    { id: 'PBI-5', title: 't', sprint: 'sprint099' },
    { id: 'PBI-6', title: 't', sprint: '  ' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(c2)).map((x) => [x.value, x.unknown]), [
    ['', false], ['sprint001', false], ['Sprint 001', false], ['__proto__', true], ['sprint 099', true], ['sprint099', true],
  ]);
});

// ---- pure_summary / pure_view_sprint / pure_board_view ---------------------
test('summarizeBacklog: null と空の語彙。語彙外の状態は先頭へ寄せ、サイズが数でなければ 0 点', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(summary.summarizeBacklog(null, null))), { byStatus: [], total: { count: 0, points: 0 } });
  assert.deepEqual(JSON.parse(JSON.stringify(summary.summarizeBacklog([{ id: 'PBI-1', title: 't' }], []))), { byStatus: [], total: { count: 0, points: 0 } });
  const s = summary.summarizeBacklog([{ id: 'PBI-1', title: 't', status: 'x', size: 'abc' }, { id: 'PBI-2', title: 't', status: 'B', size: '3' }], ['A', 'B']);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), { byStatus: [{ status: 'A', count: 1, points: 0 }, { status: 'B', count: 1, points: 3 }], total: { count: 2, points: 3 } });
});

test('summarizeSprint: velocity が無ければ null。名乗りの無い md はゴールをそのまま載せ、別名乗りならゴールを落とす', () => {
  const vel = [{ sprint: 'sprint001', planned_points: 'x', completed_points: '3', carried_over_points: '', sprint_start: '2026-01-01', sprint_end: '2026-01-02' }];
  assert.equal(summary.summarizeSprint(null, null), null);
  assert.equal(summary.summarizeSprint([], ''), null);
  const md = (name) => '## スプリント情報\n\n| 項目 | 内容 |\n|---|---|\n' + (name === null ? '' : '| スプリント番号 | ' + name + ' |\n') + '\n## スプリントゴール\n\nG\n';
  assert.equal(summary.summarizeSprint(vel, md(null)).goal, 'G');
  assert.equal(summary.summarizeSprint(vel, md('Sprint 1')).goal, 'G', '表記の揺れは同じスプリント');
  assert.equal(summary.summarizeSprint(vel, md('Sprint 2')).goal, '');
  assert.equal(summary.summarizeSprint(vel, md('  ')).goal, 'G', '空の名乗りは名乗り無し');
  assert.deepEqual(JSON.parse(JSON.stringify(summary.summarizeSprint(vel, undefined))), { sprint: 'sprint001', goal: '', planned: 0, completed: 3, carriedOver: 0 });
});

test('summarizeImpediment: null の入力・雛形は数えない・途中で止まった行は解決済として数え pending にも出す', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(summary.summarizeImpediment(null, null))), { open: 0, resolved: 0, pending: 0 });
  const o = IM('IMP-001', 't');
  const res = IM('IMP-001', 't', { status: 'Resolved' });
  assert.deepEqual(JSON.parse(JSON.stringify(summary.summarizeImpediment([o, IM('IMP-9', '（雛形）')], [res, IM('IMP-8', '（雛形）')]))), { open: 0, resolved: 1, pending: 1 });
});

test('view_sprint: null の入力。実在スプリントが無ければロードマップに理由（notice）を添える', () => {
  assert.equal(viewSprint.buildBurndownView(undefined), null);
  assert.equal(viewSprint.buildBurndownView('# 表なし'), null);
  const v = viewSprint.buildVelocityView(undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(v)), { table: { headers: ['スプリント', '計画', '完了', '持ち越し', '開始日', '終了日', '備考'], rows: [] } });
  const rm = viewSprint.buildRoadmapView(null, null);
  assert.equal(rm.notice, viewSprint.ROADMAP_NO_SPRINT_NOTICE);
  assert.deepEqual(JSON.parse(JSON.stringify(rm.marks)), []);
  const rm2 = viewSprint.buildRoadmapView([{ id: 'PBI-1', title: 't', sprint: 'sprint001' }], [{ sprint: 'sprint001', sprint_start: '2026-01-01', sprint_end: '2026-01-02' }]);
  assert.equal(rm2.notice, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(rm2.marks)), [{ row: 0, col: 2 }], 'marks は見出しを除いた行基準');
  const rm3 = viewSprint.buildRoadmapView([], [{ sprint: 'sprint001', sprint_start: '2026-01-01', sprint_end: '2026-01-02' }]);
  assert.equal(rm3.notice, undefined, '実在スプリントはあるが PBI が無いだけなら notice は出ない');
});

test('buildBoardData: null の入力。語彙外のステータスは先頭の列、欠けた項目は空文字', () => {
  const b = boardView.buildBoardData(null);
  assert.equal(b.columns.length, 5);
  const b2 = boardView.buildBoardData([{ id: 'PBI-1', title: 't', status: 'weird', size: null }, { id: 'PBI-2', title: 'u', status: ' Done ' }]);
  assert.equal(b2.columns[0].cards[0].size, '');
  assert.equal(b2.columns[4].cards[0].id, 'PBI-2');
  assert.equal(Object.keys(b2.columns[0].cards[0]).length, boardView.BOARD_CARD_FIELDS.length);
});

test('toCsv: null の rows は見出しのみ。欠けた値は空、改行は LF に揃う（往復で値が変わらない）', () => {
  assert.equal(csvw.toCsv(null, ['a', 'b']), 'a,b\n');
  const text = csvw.toCsv([{ a: null, b: 'x\r\ny,"z"' }, { a: undefined }], ['a', 'b']);
  assert.deepEqual(csv.parseCsv(text), [['a', 'b'], ['', 'x\ny,"z"'], ['', '']]);
});
