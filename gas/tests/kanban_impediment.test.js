const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const INITIAL = [
  { status: 'New', cards: [] }, { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
const ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const COLUMNS = [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }];
const CHOICES = [{ value: '', label: '（未割り当て）' }, { value: 'sprint001', label: 'sprint001' }];

function impResponse(open, resolved) {
  return { ok: true, name: 'impediment',
    view: { columns: COLUMNS, open: open, resolved: resolved || [] },
    summary: { open: open.length, resolved: (resolved || []).length }, sprintChoices: CHOICES };
}

const latest = (h) => h.calls[h.calls.length - 1];

/** 障害物タブを開き、ROW が1件ある状態にする。 */
function onImpediment() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 0, points: 0 } }, sprintChoices: CHOICES });
  h.clickTab('障害物');
  latest(h).handlers.success(impResponse([ROW]));
  return h;
}

test('未解決の行を押すとパネルが開き、値が入る', () => {
  const h = onImpediment();
  assert.equal(h.hiddenOf('imp-panel'), true);
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel'), false);
  assert.equal(h.textOf('imp-panel-title'), 'IMP-002');
  assert.equal(h.valueOf('i-title'), '止まっている');
  assert.equal(h.valueOf('i-reported-by'), 'マヤ');
  assert.equal(h.valueOf('i-sprint'), 'sprint001');
  assert.equal(h.hiddenOf('i-resolution-field'), true, '解決策は「解決する」を押すまで出さない');
});

test('保存は、見た行（全列）を expected として送る', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setValue('i-title', '新しい題');
  h.click('imp-panel-save');
  const c = latest(h);
  assert.equal(c.method, 'apiUpdateImpediment');
  assert.equal(c.args[0], 'IMP-002');
  assert.equal(c.args[1].title, '新しい題');
  assert.deepEqual(c.args[2], ROW);
  c.handlers.success(impResponse([Object.assign({}, ROW, { title: '新しい題' })]));
  assert.equal(h.hiddenOf('imp-panel'), true, '成功したら閉じる');
  assert.equal(h.tableRowsOf('table-view')[0][1].text, '新しい題');
});

test('競合したらパネルは開いたまま、次の保存は最新の行を基準にする', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const changed = Object.assign({}, ROW, { description: '誰かが追記' });
  latest(h).handlers.success(Object.assign(impResponse([changed]), { ok: false, reason: 'conflict', message: '他の変更が先に入っています。' }));
  assert.equal(h.hiddenOf('imp-panel'), false);
  assert.ok(h.classOf('imp-panel-message').indexOf('error') !== -1);
  h.click('imp-panel-save');
  assert.deepEqual(latest(h).args[2], changed);
});

test('「障害物を追加」で空のパネルが開き、作成を呼ぶ。解決するボタンは出さない', () => {
  const h = onImpediment();
  h.clickImpAdd();
  assert.equal(h.textOf('imp-panel-title'), '新しい障害物');
  assert.equal(h.valueOf('i-title'), '');
  assert.equal(h.hiddenOf('imp-panel-resolve'), true);
  h.setValue('i-title', 'A');
  h.setValue('i-reported-by', 'B');
  h.click('imp-panel-save');
  assert.equal(latest(h).method, 'apiCreateImpediment');
  assert.equal(latest(h).args[0].title, 'A');
});

test('解決は2段階。1回目で解決策の欄が出て、2回目で確定する', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  const before = h.calls.length;
  h.click('imp-panel-resolve');
  assert.equal(h.calls.length, before, '1回目で送ってしまった');
  assert.equal(h.hiddenOf('i-resolution-field'), false);
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  const c = latest(h);
  assert.equal(c.method, 'apiResolveImpediment');
  assert.deepEqual(c.args, ['IMP-002', '再起動した', ROW]);
});

test('解決したら通知が出て、取り消すと apiUnresolveImpediment を呼ぶ', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  const resolvedRow = Object.assign({}, ROW, { status: 'Resolved', resolution: '再起動した' });
  latest(h).handlers.success(Object.assign(impResponse([], [resolvedRow]), { moved: ROW, resolvedRow: resolvedRow }));
  assert.equal(h.hiddenOf('imp-panel'), true);
  assert.equal(h.hiddenOf('toast'), false);
  h.click('toast-undo');
  const c = latest(h);
  assert.equal(c.method, 'apiUnresolveImpediment');
  assert.deepEqual(c.args, [ROW, resolvedRow]);
});

test('解決済の行は押せない（data-id を持たない）', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  h.clickTab('障害物');
  latest(h).handlers.success(impResponse([], [Object.assign({}, ROW, { status: 'Resolved' })]));
  assert.throws(() => h.clickImpRow('IMP-002'), /0 件/);
});

test('応答待ちの間に別タブへ移ったら、障害物の応答で表を描き直さない', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const pending = latest(h);
  h.clickTab('やること');
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 0, points: 0 } } });
  pending.handlers.success(impResponse([ROW]));
  assert.equal(h.hiddenOf('table-view'), true, '盤面のタブなのに表が出た');
  assert.ok(h.textTreeOf('summary').indexOf('未解決') === -1, '盤面の要約が障害物のものに置き換わった');
});

test('Escape で障害物パネルが閉じる。タブを移っても閉じる', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.pressKey('Escape');
  assert.equal(h.hiddenOf('imp-panel'), true);
  h.clickImpRow('IMP-002');
  h.clickTab('やること');
  assert.equal(h.hiddenOf('imp-panel'), true);
});

test('解決策の入力中は他の4欄を塞ぎ、通知の題は編集欄ではなく moved.title を使う', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setValue('i-title', '書きかけの題');
  h.click('imp-panel-resolve');
  ['i-title', 'i-description', 'i-reported-by', 'i-sprint'].forEach((id) => {
    assert.equal(h.disabledOf(id), true, id + ' が塞がれていない');
  });
  assert.equal(h.disabledOf('i-resolution'), false);
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  const resolvedRow = Object.assign({}, ROW, { status: 'Resolved', resolution: '再起動した' });
  latest(h).handlers.success(Object.assign(impResponse([], [resolvedRow]), { moved: ROW, resolvedRow: resolvedRow }));
  assert.ok(h.textOf('toast-text').indexOf('止まっている') !== -1);
  assert.ok(h.textOf('toast-text').indexOf('書きかけの題') === -1);
});

test('新規の既定スプリントは、unknown でない最後のもの', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  h.clickTab('障害物');
  latest(h).handlers.success(Object.assign(impResponse([ROW]), { sprintChoices: [
    { value: '', label: '（未割り当て）' },
    { value: 'sprint001', label: 'sprint001', unknown: false },
    { value: '旧', label: '旧', unknown: true },
  ] }));
  h.clickImpAdd();
  assert.equal(h.valueOf('i-sprint'), 'sprint001');
});

test('書き込みが2つ飛んでいて古い応答が後から届いても、表は新しい方のまま', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const first = latest(h);
  h.pressKey('Escape');
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const second = h.calls[h.calls.length - 1];
  assert.notEqual(first, second);
  second.handlers.success(impResponse([Object.assign({}, ROW, { title: '新' })]));
  first.handlers.success(impResponse([Object.assign({}, ROW, { title: '旧' })]));
  assert.equal(h.tableRowsOf('table-view')[0][1].text, '新');
});

test('障害物の応答は PBI パネルのスプリント選択肢を書き換えない', () => {
  const CARD = { id: 'PBI-001', title: 'a', description: '', acceptance: '', priority: 'Medium', size: '', sprint: '', updated_at: 'x' };
  const cols = INITIAL.map((c) => c.status === 'New' ? { status: 'New', cards: [CARD] } : c);
  const h = createHarness(cols);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(cols), summary: null, sprintChoices: CHOICES });
  h.clickTab('障害物');
  latest(h).handlers.success(Object.assign(impResponse([ROW]), { sprintChoices: [{ value: 'other', label: 'other' }] }));
  h.clickTab('やること');
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(cols), summary: null });
  h.openCard('PBI-001');
  assert.deepEqual(h.optionsOf('f-sprint').map((o) => o.value), ['', 'sprint001']);
});

const RESOLVED_ROW = Object.assign({}, ROW, { status: 'Resolved', resolution: '再起動した' });
const partial = (open, resolved, message) => Object.assign(impResponse(open, resolved || []),
  { ok: false, reason: 'partial', message: message || '途中で止まりました。通知の「完了する」を押すと完了します。（x）' });

/** パネルから解決を送り、応答待ちの呼び出しを返す。 */
function sendResolve(h) {
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  return latest(h);
}

test('取り消しが途中で止まったら、「完了する」の通知を出し、押すと同じ引数で取り消しを送り直す', () => {
  const h = onImpediment();
  sendResolve(h).handlers.success(Object.assign(impResponse([], [RESOLVED_ROW]), { moved: ROW, resolvedRow: RESOLVED_ROW }));
  h.click('toast-undo');
  const undo = latest(h);
  assert.equal(undo.method, 'apiUnresolveImpediment');
  undo.handlers.success(partial([ROW], [RESOLVED_ROW]));
  assert.equal(h.hiddenOf('toast'), false, '押せる通知が無い');
  assert.ok(h.textOf('toast-text').indexOf('IMP-002 の取り消しが途中で止まりました。') !== -1, h.textOf('toast-text'));
  assert.ok(h.textTreeOf('toast-undo').indexOf('完了する') !== -1, h.textTreeOf('toast-undo'));
  h.click('toast-undo');
  const retry = latest(h);
  assert.notEqual(retry, undo);
  assert.equal(retry.method, 'apiUnresolveImpediment');
  assert.deepEqual(retry.args, [ROW, RESOLVED_ROW]);
});

test('解決が途中で止まったら、パネルを閉じても「完了する」の通知から同じ引数で解決を送り直せる', () => {
  const h = onImpediment();
  const sent = sendResolve(h);
  h.pressKey('Escape');   // 応答の前にパネルを閉じる（もう同じパネルではない）
  sent.handlers.success(partial([], [RESOLVED_ROW]));
  assert.equal(h.hiddenOf('toast'), false, '押せる通知が無い');
  assert.ok(h.textOf('toast-text').indexOf('IMP-002 の解決が途中で止まりました。') !== -1, h.textOf('toast-text'));
  assert.ok(h.textTreeOf('toast-undo').indexOf('完了する') !== -1);
  h.click('toast-undo');
  const retry = latest(h);
  assert.notEqual(retry, sent);
  assert.equal(retry.method, 'apiResolveImpediment');
  assert.deepEqual(retry.args, ['IMP-002', '再起動した', ROW]);
});

test('解決が途中で止まったとき、まだ同じパネルなら閉じて「完了する」の通知を出す', () => {
  const h = onImpediment();
  sendResolve(h).handlers.success(partial([], [RESOLVED_ROW]));
  assert.equal(h.hiddenOf('imp-panel'), true, '未解決に出ない行のパネルが開いたまま');
  assert.equal(h.hiddenOf('toast'), false);
  h.click('toast-undo');
  assert.equal(latest(h).method, 'apiResolveImpediment');
  assert.deepEqual(latest(h).args, ['IMP-002', '再起動した', ROW]);
});

test('通常の通知のボタンは「取り消す」のまま', () => {
  const h = onImpediment();
  sendResolve(h).handlers.success(Object.assign(impResponse([], [RESOLVED_ROW]), { moved: ROW, resolvedRow: RESOLVED_ROW }));
  assert.ok(h.textTreeOf('toast-undo').indexOf('取り消す') !== -1);
  assert.ok(h.textTreeOf('toast-undo').indexOf('完了する') === -1);
});

test('新しい書き込みがビュー無しで先に返り、古い成功が後から届いたら、表は古い成功の内容にする', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const first = latest(h);
  h.pressKey('Escape');
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const second = latest(h);
  assert.notEqual(first, second);
  second.handlers.success({ ok: false, reason: 'busy', message: '他の更新が実行中です。' });
  first.handlers.success(impResponse([Object.assign({}, ROW, { title: '保存できた題' })]));
  assert.equal(h.tableRowsOf('table-view')[0][1].text, '保存できた題');
});

test('解決ボタンの文言は積み重ならない。1回目で「解決を確定」、開き直すと「解決する」', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  assert.equal(h.labelOf('imp-panel-resolve'), '解決する');
  h.click('imp-panel-resolve');
  assert.equal(h.labelOf('imp-panel-resolve'), '解決を確定');
  h.pressKey('Escape');
  h.clickImpRow('IMP-002');
  assert.equal(h.labelOf('imp-panel-resolve'), '解決する');
});

test('解決策の入力中は「保存」を押せない。開き直すと戻る', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  assert.equal(h.disabledOf('imp-panel-save'), false);
  h.click('imp-panel-resolve');
  assert.equal(h.disabledOf('imp-panel-save'), true, '解決策を黙って捨てて保存できてしまう');
  h.pressKey('Escape');
  h.clickImpRow('IMP-002');
  assert.equal(h.disabledOf('imp-panel-save'), false);
});

test('書き込みの発行後に読み直した表は、後から届く古い書き込みの応答で戻されない', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const write = latest(h);
  h.click('reload');
  const load = latest(h);
  assert.notEqual(write, load);
  load.handlers.success(impResponse([Object.assign({}, ROW, { title: '読み直した題' })]));
  write.handlers.success(impResponse([Object.assign({}, ROW, { title: '古い応答' })]));
  assert.equal(h.tableRowsOf('table-view')[0][1].text, '読み直した題');
});

test('「完了する」の通知はチェックのアイコン、「取り消す」は元のアイコン', () => {
  const h = onImpediment();
  sendResolve(h).handlers.success(Object.assign(impResponse([], [RESOLVED_ROW]), { moved: ROW, resolvedRow: RESOLVED_ROW }));
  const undoIcon = h.iconPathOf('toast-undo');
  h.click('toast-undo');
  latest(h).handlers.success(partial([ROW], [RESOLVED_ROW]));
  assert.equal(h.labelOf('toast-undo'), '完了する');
  assert.notEqual(h.iconPathOf('toast-undo'), undoIcon);
  assert.equal(h.iconPathOf('toast-undo'), 'M3 8.4 6.4 11.6 13 4.8');
});
