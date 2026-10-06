const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, scriptSource } = require('./kanban_harness.js');
const { groupHistory, lineDiff, LINE_DIFF_MAX, HISTORY_ACTIONS } = require('../pure_history.js');
const { LIST_COLUMNS } = require('../pure_view_backlog.js');
const { IMPEDIMENT_COLUMNS } = require('../pure_view_impediment.js');

/**
 * パネルの「履歴」節を、画面の操作から辿って検査する。
 * 判定は描画された DOM から読む（historyGroupsIn / historyLinesIn / historyStateOf）。
 */

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                           { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];

const WITHOUT_1 = [{ status: 'New', cards: [INITIAL[0].cards[1]] }].concat(INITIAL.slice(1));

const latest = (h) => h.calls[h.calls.length - 1];
const callsOf = (h, method) => h.calls.filter(function (c) { return c.method === method; });

function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({
    ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 2, points: 0 } }, comments: {},
  });
  return h;
}

function e(at, actor, action, field, before, after) {
  return { at: at, actor: actor, action: action, field: field || '', before: before || '', after: after || '' };
}

// 新しい順（apiGetHistory の契約）。同じ at + actor の2行は1回の書き込み。
const ENTRIES = [
  e('2026-10-06 11:00:00', 'maya@example.com', 'update', 'title', 'A', 'B'),
  e('2026-10-06 11:00:00', 'maya@example.com', 'update', 'size', '', '3'),
  e('2026-10-06 10:00:00', '', 'create'),
];

/** 履歴を開き、出た apiGetHistory に entries で答える。 */
function openHistory(h, hostId, entries) {
  h.historyToggle(hostId);
  latest(h).handlers.success({ ok: true, entries: entries });
}

test('1. カードのパネルに履歴の節があり、閉じて始まる。新規作成中は節ごと隠れる', () => {
  const h = ready();
  h.openCard('PBI-001');
  assert.equal(h.hiddenOf('panel-history'), false);
  const s = h.historyStateOf('panel-history');
  assert.equal(s.expanded, 'false');
  assert.equal(s.bodyHidden, true);
  assert.equal(s.note, 'Web アプリからの変更だけを記録しています');
  assert.equal(callsOf(h, 'apiGetHistory').length, 0, '開く前に取りに行っている');
  h.clickAdd('Ready');
  assert.equal(h.hiddenOf('panel-history'), true, '新規作成中に履歴の節が出ている');
  // 履歴の節は .panel-foot の後ろ・コメント節の直前に置く。
  const html = require('./kanban_harness.js').htmlSource();
  const at = function (s2) { const i = html.indexOf(s2); assert.notEqual(i, -1, s2); return i; };
  assert.ok(at('id="panel-history"') < at('id="panel-comments"'));
  assert.ok(at('id="imp-panel-history"') < at('id="imp-panel-comments"'));
  assert.ok(at('id="panel-save"') < at('id="panel-history"'));
});

test('2. 開くと apiGetHistory(id) を1回だけ呼び、応答のまとまりが新しい順に出る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  const calls = callsOf(h, 'apiGetHistory');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['PBI-001']);
  const s = h.historyStateOf('panel-history');
  assert.equal(s.expanded, 'true');
  assert.equal(s.bodyHidden, false);
  assert.equal(s.status, '読み込んでいます…');
  calls[0].handlers.success({ ok: true, entries: ENTRIES });
  assert.equal(callsOf(h, 'apiGetHistory').length, 0, '2回以上呼んでいる');
  assert.deepEqual(h.historyGroupsIn('panel-history').map(function (g) { return g.head; }), [
    '2026-10-06 11:00:00 · maya · 変更',
    '2026-10-06 10:00:00 · 不明 · 作成',
  ]);
  assert.equal(h.historyStateOf('panel-history').status, null, '読み込み中の文言が残っている');
});

test('3. update の1行の値は「項目名: 前 → 後」。項目名は画面の言葉、空は「（空）」', () => {
  const h = ready();
  h.openCard('PBI-001');
  openHistory(h, 'panel-history', ENTRIES);
  assert.deepEqual(h.historyGroupsIn('panel-history')[0].items, ['タイトル: A → B', 'ポイント: （空） → 3']);
});

test('4. 説明の差分は行単位。消えた行は del・足した行は add で行頭に記号。<b> は文字のまま', () => {
  const h = ready();
  h.openCard('PBI-001');
  openHistory(h, 'panel-history', [
    e('2026-10-06 12:00:00', 'me@example.com', 'update', 'description', '残る\n<b>旧</b>', '残る\n<b>新</b>'),
  ]);
  assert.deepEqual(h.historyGroupsIn('panel-history')[0].items, ['説明:']);
  assert.deepEqual(h.historyLinesIn('panel-history'), [
    { op: 'same', text: '　残る', children: 0 },
    { op: 'del', text: '−<b>旧</b>', children: 0 },
    { op: 'add', text: '＋<b>新</b>', children: 0 },
  ]);
});

test('5. 応答が届く前に別のカードへ移ると、届いた応答を描かない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  const first = latest(h);
  h.openCard('PBI-002');
  // 別の対象へ移ると、節は閉じた状態に戻る。
  assert.equal(h.historyStateOf('panel-history').expanded, 'false');
  assert.equal(h.historyStateOf('panel-history').bodyHidden, true);
  first.handlers.success({ ok: true, entries: ENTRIES });
  assert.deepEqual(h.historyGroupsIn('panel-history'), [], '前のカードの履歴が描かれた');
  // 同じカードを開き直した場合も、開き直す前の応答は描かない。
  h.historyToggle('panel-history');
  const second = latest(h);
  h.openCard('PBI-002');
  second.handlers.success({ ok: true, entries: ENTRIES });
  assert.deepEqual(h.historyGroupsIn('panel-history'), []);
});

test('6. 閉じて開き直すと取り直す。閉じている間に届いた応答は描かない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  const first = latest(h);
  h.historyToggle('panel-history');   // 閉じる
  assert.equal(h.historyStateOf('panel-history').expanded, 'false');
  first.handlers.success({ ok: true, entries: ENTRIES });
  h.historyToggle('panel-history');   // 開き直す
  const again = callsOf(h, 'apiGetHistory');
  assert.equal(again.length, 1, '開き直しても取り直していない');
  assert.equal(h.historyStateOf('panel-history').status, '読み込んでいます…', '閉じている間の応答が描かれた');
  again[0].handlers.success({ ok: true, entries: ENTRIES.slice(2) });
  assert.equal(h.historyGroupsIn('panel-history').length, 1);
});

test('7. 0件で「まだ履歴がありません」、失敗で「履歴を読み込めませんでした: …」', () => {
  const h = ready();
  h.openCard('PBI-001');
  openHistory(h, 'panel-history', []);
  assert.equal(h.historyStateOf('panel-history').status, 'まだ履歴がありません');
  h.historyToggle('panel-history');
  h.historyToggle('panel-history');
  latest(h).handlers.success({ ok: false, reason: 'invalid', message: '履歴の対象が不正です: x' });
  assert.equal(h.historyStateOf('panel-history').status, '履歴を読み込めませんでした: 履歴の対象が不正です: x');
  h.historyToggle('panel-history');
  h.historyToggle('panel-history');
  latest(h).handlers.failure(new Error('通信できません'));
  assert.equal(h.historyStateOf('panel-history').status, '履歴を読み込めませんでした: 通信できません');
  assert.deepEqual(h.historyGroupsIn('panel-history'), []);
});

const WARN = '変更履歴を記録できませんでした';

test('8a. PBI の保存の応答の historyWarning が全体メッセージに出る（保存の文言で消えない）', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.setValue('f-title', 'A2');
  h.click('panel-save');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL), historyWarning: WARN });
  assert.equal(h.textOf('message'), 'PBI-001 を保存しました。 ' + WARN, '保存の文言が消えた');
  assert.ok(h.classOf('message').indexOf('error') !== -1);
});

test('8b. ドラッグ・削除・削除の取り消しの historyWarning も全体メッセージに出る', () => {
  const h = ready();
  h.drag('PBI-002', 'Ready');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL), historyWarning: WARN });
  assert.equal(h.textOf('message'), 'PBI-002 を Ready に移しました。 ' + WARN, '移した旨の文言が消えた');

  h.openCard('PBI-001');
  h.click('panel-delete');
  const removed = { id: 'PBI-001', title: 'A' };
  latest(h).handlers.success({ ok: true, board: h.boardOf(WITHOUT_1), removed: removed,
    historyWarning: WARN + '（削除）' });
  // 削除の成功は通知で伝える。前の操作の文言（ドラッグ）に足さない。
  assert.equal(h.textOf('message'), WARN + '（削除）');
  assert.equal(h.textOf('toast-text'), 'PBI-001「A」を削除しました。', '削除の通知が消えた');
  h.click('toast-undo');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL), historyWarning: WARN + '（戻す）' });
  assert.equal(h.textOf('message'), 'PBI-001 を戻しました。 ' + WARN + '（戻す）');
});

test('8g. 成功の文言を出さない応答（削除は通知で伝える）では、前の操作の古い文言に警告を足さない', () => {
  const h = ready();
  h.drag('PBI-002', 'Ready');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  assert.equal(h.textOf('message'), 'PBI-002 を Ready に移しました。');
  h.openCard('PBI-001');
  h.click('panel-delete');
  latest(h).handlers.success({ ok: true, board: h.boardOf(WITHOUT_1), removed: { id: 'PBI-001', title: 'A' },
    historyWarning: WARN });
  assert.equal(h.textOf('message'), WARN, '前の操作の文言に足した');
});

// --- 障害物 -----------------------------------------------------------------
const ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const COLUMNS = [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }];
const CHOICES = [{ value: '', label: '（未割り当て）' }, { value: 'sprint001', label: 'sprint001' }];

function impResponse(open, extra) {
  return Object.assign({ ok: true, name: 'impediment',
    view: { columns: COLUMNS, open: open, resolved: [], pending: [] },
    summary: { open: open.length, resolved: 0, pending: 0 }, sprintChoices: CHOICES }, extra || {});
}

function onImpediment() {
  const h = ready();
  h.clickTab('障害物');
  latest(h).handlers.success(impResponse([ROW]));
  return h;
}

test('8c. 障害物の保存の historyWarning が全体メッセージに出る（保存の文言で消えない）', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setValue('i-title', '新しい題');
  h.click('imp-panel-save');
  latest(h).handlers.success(impResponse([Object.assign({}, ROW, { title: '新しい題' })], { historyWarning: WARN }));
  assert.equal(h.textOf('message'), 'IMP-002 を保存しました。 ' + WARN, '保存の文言が消えた');
  assert.ok(h.classOf('message').indexOf('error') !== -1);
});

test('8d. 解決が途中で止まった応答の historyWarning は、止まった旨の文言を消さずに足す', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '直した');
  h.click('imp-panel-resolve');
  latest(h).handlers.success(impResponse([], { ok: false, reason: 'partial', message: '途中で止まりました。',
    historyWarning: WARN }));
  assert.equal(h.textOf('message'), '途中で止まりました。 ' + WARN);
});

test('8f. 解決の取り消しの historyWarning も、戻した旨の文言を残して足す', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '直した');
  h.click('imp-panel-resolve');
  const resolvedRow = Object.assign({}, ROW, { status: 'Resolved', resolved_at: '2026-10-06', resolution: '直した' });
  latest(h).handlers.success(impResponse([], { moved: ROW, resolvedRow: resolvedRow }));
  h.click('toast-undo');
  latest(h).handlers.success(impResponse([ROW], { historyWarning: WARN }));
  assert.equal(h.textOf('message'), 'IMP-002 を未解決に戻しました。 ' + WARN);
  assert.ok(h.classOf('message').indexOf('error') !== -1);
});

test('8e. コメント追加の historyWarning が全体メッセージに出る', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.setCommentInput('panel-comments', '確認しました');
  h.clickCommentSend('panel-comments');
  const added = { id: 'CMT-00000001', target_id: 'PBI-001', author: 'me@example.com',
    created_at: '2026-10-06 11:00:00', body: '確認しました', mine: true };
  latest(h).handlers.success({ ok: true, comment: added, comments: { 'PBI-001': [added] }, historyWarning: WARN });
  assert.equal(h.textOf('message'), WARN);
  assert.ok(h.classOf('message').indexOf('error') !== -1);
});

test('9. 履歴を開いたまま同じ対象に書き込むと取り直す。別の対象・閉じた節では取り直さない', () => {
  const h = ready();
  h.openCard('PBI-001');
  openHistory(h, 'panel-history', ENTRIES);
  // 別の対象への書き込み（パネルは PBI-001 のまま）。
  h.drag('PBI-002', 'Ready');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  assert.equal(callsOf(h, 'apiGetHistory').length, 0, '別の対象の書き込みで取り直した');
  // 同じ対象（ドラッグ）。
  h.drag('PBI-001', 'Ready');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  let again = callsOf(h, 'apiGetHistory');
  assert.equal(again.length, 1, '同じ対象のドラッグの後に取り直していない');
  assert.deepEqual(again[0].args, ['PBI-001']);
  again[0].handlers.success({ ok: true, entries: ENTRIES });
  // 同じ対象（コメント追加。パネルは開いたまま）。
  h.setCommentInput('panel-comments', 'メモ');
  h.clickCommentSend('panel-comments');
  const added = { id: 'CMT-00000001', target_id: 'PBI-001', author: 'me@example.com',
    created_at: '2026-10-06 11:00:00', body: 'メモ', mine: true };
  latest(h).handlers.success({ ok: true, comment: added, comments: { 'PBI-001': [added] } });
  again = callsOf(h, 'apiGetHistory');
  assert.equal(again.length, 1, 'コメント追加の後に取り直していない');
  again[0].handlers.success({ ok: true, entries: ENTRIES });
  // 節を閉じていれば取り直さない。
  h.historyToggle('panel-history');
  h.drag('PBI-001', 'Review');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  assert.equal(callsOf(h, 'apiGetHistory').length, 0, '閉じた節で取り直した');
  // 保存は成功するとパネルを閉じるので、取り直す節が残らない。
  h.historyToggle('panel-history');
  latest(h).handlers.success({ ok: true, entries: ENTRIES });
  h.setValue('f-title', 'A2');
  h.click('panel-save');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  assert.equal(h.hiddenOf('panel'), true);
  assert.equal(callsOf(h, 'apiGetHistory').length, 0, '閉じたパネルの履歴を取りに行った');
});

test('10. 障害物のパネルにも同じ節があり、IMP の履歴を出す。新規作成中は隠れる', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel-history'), false);
  assert.equal(h.historyStateOf('imp-panel-history').bodyHidden, true);
  h.historyToggle('imp-panel-history');
  const c = latest(h);
  assert.equal(c.method, 'apiGetHistory');
  assert.deepEqual(c.args, ['IMP-002']);
  c.handlers.success({ ok: true, entries: [
    e('2026-10-06 12:00:00', 'maya@example.com', 'update', 'resolution', '', '手順を直した'),
    e('2026-10-06 12:00:00', 'maya@example.com', 'update', 'reported_by', 'マヤ', ''),
    e('2026-10-06 09:00:00', 'maya@example.com', 'resolve'),
  ] });
  const groups = h.historyGroupsIn('imp-panel-history');
  assert.deepEqual(groups.map(function (g) { return g.head; }),
    ['2026-10-06 12:00:00 · maya · 変更', '2026-10-06 09:00:00 · maya · 解決']);
  assert.deepEqual(groups[0].items, ['解決策:', '報告者: マヤ → （空）']);
  assert.deepEqual(h.historyLinesIn('imp-panel-history'), [{ op: 'add', text: '＋手順を直した', children: 0 }]);
  h.clickImpAdd();
  assert.equal(h.hiddenOf('imp-panel-history'), true, '新規作成中に履歴の節が出ている');
});

test('12. 上限で切った応答（truncated）なら、一覧の最後に省略した旨を出す。そうでなければ出さない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.historyToggle('panel-history');
  latest(h).handlers.success({ ok: true, entries: ENTRIES, truncated: true });
  assert.equal(h.historyGroupsIn('panel-history').length, 2);
  const body = h.historyStateOf('panel-history');
  assert.equal(body.status, 'これより前の履歴は省略しています');
  assert.equal(h.historyTailOf('panel-history'), 'これより前の履歴は省略しています', '一覧の最後に出ていない');
  // 取り直して truncated が無ければ消える。
  h.drag('PBI-001', 'Ready');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  latest(h).handlers.success({ ok: true, entries: ENTRIES });
  assert.equal(h.historyStateOf('panel-history').status, null);
});

// --- 規則が1つであること -----------------------------------------------------
// 画面の写し（historyLineDiff / historyGroups）を、実際に読み込んだ <script> から取り出して比べる。
function pageFns() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  return h.sandbox;
}
const plain = (v) => JSON.parse(JSON.stringify(v));

test('11a. 画面の行差分は pure_history.js の lineDiff と同じ結果になる', () => {
  const page = pageFns();
  assert.equal(typeof page.historyLineDiff, 'function');
  assert.equal(page.HISTORY_LINE_DIFF_MAX, LINE_DIFF_MAX);
  const many = Array.from({ length: LINE_DIFF_MAX + 1 }, function (_, i) { return 'l' + i; }).join('\n');
  const atMax = Array.from({ length: LINE_DIFF_MAX }, function (_, i) { return 'l' + i; }).join('\n');
  const fixtures = [
    ['', ''], ['', 'a'], ['a', ''], ['a', 'a'], ['a\nb\nc', 'a\nc'], ['a\nc', 'a\nb\nc'],
    ['a\nb', 'b\na'], ['x', 'y'], ['a\nb\nc', 'c\nb\na'], ['a\n', 'a'], ['\n\n', '\n'],
    [many, 'l0'], ['l0', many], [atMax, atMax.replace('l3', 'L3')], [null, undefined], [3, '3\n4'],
    ['a\r\nb', 'a\nb'], ['a\r\nb\r\n', 'a\r\nc'],
  ];
  fixtures.forEach(function (f) {
    assert.deepEqual(plain(page.historyLineDiff(f[0], f[1])), plain(lineDiff(f[0], f[1])),
      'lineDiff(' + JSON.stringify(f).slice(0, 60) + ') が食い違う');
  });
});

test('11b. 画面のまとまりは pure_history.js の groupHistory と同じ結果になる', () => {
  const page = pageFns();
  assert.equal(typeof page.historyGroups, 'function');
  const fixtures = [
    [], ENTRIES,
    [e('T1', 'a', 'update', 'title'), e('T1', 'b', 'update', 'title'), e('T1', 'a', 'update', 'size')],
    [e('T2', '', 'create'), e('T2', '', 'update', 'title'), e('T1', '', 'delete')],
  ];
  fixtures.forEach(function (f) {
    assert.deepEqual(plain(page.historyGroups(f)), plain(groupHistory(f)));
  });
  assert.deepEqual(plain(page.historyGroups(undefined)), plain(groupHistory(undefined)));
});

test('11c. 画面の項目名は、一覧・障害物の表の列見出しと同じ言葉', () => {
  const page = pageFns();
  const labels = page.HISTORY_FIELD_LABELS;
  const fromColumns = {};
  LIST_COLUMNS.concat(IMPEDIMENT_COLUMNS).forEach(function (c) { fromColumns[c.field] = c.label; });
  const expected = ['title', 'description', 'acceptance_criteria', 'status', 'priority', 'size', 'sprint',
    'reported_by', 'reported_at', 'resolved_at', 'resolution'];
  assert.deepEqual(Object.keys(labels).sort(), expected.slice().sort());
  expected.forEach(function (f) {
    assert.equal(labels[f], fromColumns[f], f + ' の項目名が表の列見出しと違う');
  });
  // 操作名の表は、記録する操作の一覧と過不足なく対応する。
  assert.deepEqual(Object.keys(page.HISTORY_ACTION_LABELS).sort(), HISTORY_ACTIONS.slice().sort());
  // 写しであることを、ソースの中でも明示している（直すときに両方を直させるため）。
  assert.match(scriptSource(), /pure_history\.js/);
});

test('12. 取り直しの間は前の一覧を残し、パネルのスクロール位置を保つ。開き直しは読み込み中から', () => {
  const h = ready();
  h.openCard('PBI-001');
  openHistory(h, 'panel-history', ENTRIES);
  const panel = h.sandbox.document.getElementById('panel');
  panel.scrollTop = 120;
  h.drag('PBI-001', 'Ready');
  latest(h).handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  const again = callsOf(h, 'apiGetHistory');
  assert.equal(again.length, 1);
  assert.equal(h.historyStateOf('panel-history').status, null, '取り直しの間に読み込み中へ置き換えた');
  assert.equal(h.historyGroupsIn('panel-history').length, 2, '取り直しの間に前の一覧が消えた');
  again[0].handlers.success({ ok: true, entries: ENTRIES.slice(2) });
  assert.equal(h.historyGroupsIn('panel-history').length, 1);
  assert.equal(panel.scrollTop, 120, '描き直しでスクロール位置が変わった');
  // 閉じて開き直すと、前の一覧は出さず読み込み中から始める。
  h.historyToggle('panel-history');
  h.historyToggle('panel-history');
  assert.equal(h.historyStateOf('panel-history').status, '読み込んでいます…');
  assert.deepEqual(h.historyGroupsIn('panel-history'), []);
});
