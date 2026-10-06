'use strict';
// 2巡目 V: web_app.js の、既存テストが通っていない分岐（エラー経路・ガード・フォールバック）を
// 実際に呼んで、仕様どおりに振る舞うことを確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeEnv, J, BACKLOG_HEADER, IMP_HEADER, VEL_HEADER } = require('./bughunt2_V_env.js');

const CMT_HEADER = 'id,target_id,author,created_at,body\n';
const CHG_HEADER = 'id,at,actor,target_id,action,field,before,after\n';
const T = '2026-01-01 00:00:00';

function pbi(id, title, extra) {
  const f = Object.assign({ id, title, description: '', acceptance_criteria: '', priority: 'Medium', size: '1', status: 'New', sprint: '', created_at: T, updated_at: T }, extra || {});
  return ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint', 'created_at', 'updated_at'].map((k) => f[k]).join(',') + '\n';
}
function imp(id, title, extra) {
  const f = Object.assign({ id, title, description: 'd', reported_by: 'me', reported_at: '2026-01-02', status: 'Open', resolved_at: '', resolution: '', sprint: '' }, extra || {});
  return ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'].map((k) => f[k]).join(',') + '\n';
}
function scrum(over) {
  return { files: Object.assign({
    'product_backlog.csv': BACKLOG_HEADER + pbi('PBI-001', 'A') + pbi('PBI-002', 'B'),
    'product_backlog_done.csv': BACKLOG_HEADER,
    'velocity.csv': VEL_HEADER,
    'impediment_log.csv': IMP_HEADER + imp('IMP-001', '詰まり'),
    'impediment_log_resolved.csv': IMP_HEADER,
    'comments.csv': CMT_HEADER,
    'change_log.csv': CHG_HEADER,
  }, over || {}), folders: {} };
}
const impRow = (id, title, extra) => Object.assign({ id, title, description: 'd', reported_by: 'me', reported_at: '2026-01-02', status: 'Open', resolved_at: '', resolution: '', sprint: '' }, extra || {});

// ---- 入口・ビュー ---------------------------------------------------------
test('doGet: kanban を返し、タイトルと viewport を付ける', () => {
  const e = makeEnv(scrum());
  const out = e.ctx.doGet({});
  assert.equal(out.file, 'kanban');
  assert.equal(out.title, 'AI Scrum ボード');
  assert.deepEqual(J(out.meta), [['viewport', 'width=device-width, initial-scale=1']]);
});

test('apiGetView: 引数なしは board。不明なビューは ok:false と名前入りのメッセージ', () => {
  const e = makeEnv(scrum());
  assert.equal(e.ctx.apiGetView().name, 'board');
  assert.equal(e.ctx.apiGetView(undefined).ok, true);
  const bad = e.ctx.apiGetView('nope');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /不明なビューです: nope/);
  assert.equal(e.ctx.apiGetView('').name, 'board');   // 空文字も board 扱い
});

test('apiGetView: 配布が済んでいない（product_backlog.csv が無い）ときは ok:false で理由を返す', () => {
  const s = scrum(); delete s.files['product_backlog.csv'];
  const e = makeEnv(s);
  ['board', 'list', 'roadmap'].forEach((k) => {
    const r = e.ctx.apiGetView(k);
    assert.equal(r.ok, false, k);
    assert.match(r.message, /product_backlog\.csv が見つかりません/);
  });
  // 他のタブは巻き添えにならない
  assert.equal(e.ctx.apiGetView('done').ok, true);
  assert.equal(e.ctx.apiGetView('velocity').ok, true);
  assert.equal(e.ctx.apiGetView('impediment').ok, true);
});

test('apiGetView: スプリントフォルダが無くても burndown は view:null で成功する', () => {
  const e = makeEnv(scrum());
  const r = e.ctx.apiGetView('burndown');
  assert.equal(r.ok, true);
  assert.equal(r.view, null);
});

test('apiGetView: Drive の読み取りが例外でも velocity / impediment は空で成功する（ビューごとに独立）', () => {
  const s = scrum(); s.failRead = 'velocity.csv';
  const e = makeEnv(s);
  const r = e.ctx.apiGetView('velocity');
  assert.equal(r.ok, true);
  assert.equal(r.summary, null);
});

test('apiGetView(board): velocity.csv が壊れて読めなくても盤面は読める（sprintChoices は未割り当てのみ）', () => {
  const s = scrum(); s.failRead = 'velocity.csv';
  const e = makeEnv(s);
  const r = e.ctx.apiGetView('board');
  assert.equal(r.ok, true);
  assert.deepEqual(J(r.sprintChoices).map((o) => o.value), ['']);
});

test('apiGetView(board): ヘッダーが違う CSV は盤面を出さず列構成の誤りを知らせる', () => {
  const s = scrum({ 'product_backlog.csv': 'id,title,extra\nPBI-001,A,x\n' });
  const r = makeEnv(s).ctx.apiGetView('board');
  assert.equal(r.ok, false);
  assert.match(r.message, /列構成が想定と異なります/);
});

// ---- 書き込みの共通手順 ---------------------------------------------------
test('withBacklogWrite_: ロックが取れなければ busy（何も書かない）', () => {
  const e = makeEnv(scrum(), { lockAvailable: false });
  const before = e.scrumSpec.files['product_backlog.csv'];
  const r = e.ctx.apiCreatePbi({ title: 'x', priority: 'Low' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'busy');
  assert.equal(r.board, null);
  assert.equal(e.scrumSpec.files['product_backlog.csv'], before);
  assert.equal(e.lockState.releases, 0);
});

test('withBacklogWrite_: 見出しより多いセルがある行（id 無し）はその行番号で拒否し、何も書かない', () => {
  const csv = BACKLOG_HEADER + pbi('PBI-001', 'A') + ',もう一つ,,,,,,,,,余り\n';
  const e = makeEnv(scrum({ 'product_backlog.csv': csv }));
  const r = e.ctx.apiCreatePbi({ title: 'x', priority: 'Low' });
  assert.equal(r.ok, false);
  assert.match(r.message, /3行目に列が多すぎます/);
  assert.equal(e.scrumSpec.files['product_backlog.csv'], csv);
});

test('withBacklogWrite_: id のある行の列あふれは id を名指しする', () => {
  const csv = BACKLOG_HEADER + pbi('PBI-001', 'A').trim() + ',余り\n';
  const e = makeEnv(scrum({ 'product_backlog.csv': csv }));
  const r = e.ctx.apiUpdateStatus('PBI-001', 'Done', T);
  assert.equal(r.ok, false);
  assert.match(r.message, /PBI-001 の行（2行目）に列が多すぎます/);
});

test('apiCreatePbi: status を省略すると New で作る。ID・日時はサーバが決める', () => {
  const e = makeEnv(scrum());
  const r = e.ctx.apiCreatePbi({ title: ' 新規 ', priority: 'High' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.id, 'PBI-003');
  const row = J(r.board).columns[0].cards.find((c) => c.id === 'PBI-003');
  assert.equal(row.title, ' 新規 '.replace(/\r/g, ''));   // タイトルは検証だけで trim 保存はしない（CSV と一致）
});

test('apiCreatePbi: 不正な入力（空タイトル・不正な優先度・小数サイズ）は全部まとめて返し、CSV は変えない', () => {
  const e = makeEnv(scrum());
  const before = e.scrumSpec.files['product_backlog.csv'];
  const r = e.ctx.apiCreatePbi({ title: '  ', priority: 'Urgent', size: '1.5' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message.split('\n').length, 3, r.message);
  assert.equal(e.scrumSpec.files['product_backlog.csv'], before);
});

test('apiCreatePbi: 採番の記帳（高水位）が失敗しても作成自体は成功し、次の作成は ID を再利用しない', () => {
  const e = makeEnv(scrum());
  e.ctx.setLastPbiId_ = function () { throw new Error('props boom'); };
  const r = e.ctx.apiCreatePbi({ title: 'x', priority: 'Low' });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'PBI-003');
  assert.equal(e.ctx.apiCreatePbi({ title: 'y', priority: 'Low' }).id, 'PBI-004');
});

test('apiUpdatePbi: fields が null でも例外にならず、タイトル必須の検証で断る', () => {
  const e = makeEnv(scrum());
  const r = e.ctx.apiUpdatePbi('PBI-001', null, T);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
});

test('apiUpdatePbi: CRLF で送った同じ文面は「変更なし」として履歴を増やさない', () => {
  const s = scrum({ 'product_backlog.csv': BACKLOG_HEADER + pbi('PBI-001', 'A', { description: '"a\nb"' }) });
  const e = makeEnv(s);
  const r = e.ctx.apiUpdatePbi('PBI-001', { title: 'A', description: 'a\r\nb', priority: 'Medium', size: '1', status: 'New', sprint: '', acceptance_criteria: '' }, T);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(e.scrumSpec.files['change_log.csv'], CHG_HEADER, '見た目の同じ変更が履歴に残った');
});

// ---- 削除と取り消し ---------------------------------------------------------
test('apiDeletePbi: 同じ ID の本物の行が残るとき、取り消しは削除前の状態（2行）に戻す', () => {
  const csv = BACKLOG_HEADER + pbi('PBI-001', 'first') + pbi('PBI-001', 'second');
  const e = makeEnv(scrum({ 'product_backlog.csv': csv }));
  const del = e.ctx.apiDeletePbi('PBI-001', T);
  assert.equal(del.ok, true, JSON.stringify(del));
  assert.equal(del.removed.title, 'first');
  const held = JSON.parse(e.cache['undo:' + del.undoToken]);
  assert.equal(held.shared, true);
  const back = e.ctx.apiRestorePbi(del.undoToken);
  assert.equal(back.ok, true, JSON.stringify(back));
  const titles = J(back.board).columns[0].cards.map((c) => c.title).sort();
  assert.deepEqual(titles, ['first', 'second']);
  // 鍵は一度しか使えない
  assert.equal(e.ctx.apiRestorePbi(del.undoToken).reason, 'expired');
});

test('apiDeletePbi: 雛形と同じ ID の本物の行を消した後は shared でない（雛形は数えない）', () => {
  const csv = BACKLOG_HEADER + pbi('PBI-001', '（雛形）') + pbi('PBI-001', '本物');
  const e = makeEnv(scrum({ 'product_backlog.csv': csv }));
  const del = e.ctx.apiDeletePbi('PBI-001', T);
  assert.equal(del.ok, true);
  assert.equal(del.removed.title, '本物');
  assert.equal(JSON.parse(e.cache['undo:' + del.undoToken]).shared, false);
});

test('apiDeletePbi: Cache に預けられなくても削除は成功し undoToken は null', () => {
  const e = makeEnv(scrum(), { cachePutThrows: true });
  const del = e.ctx.apiDeletePbi('PBI-002', T);
  assert.equal(del.ok, true);
  assert.equal(del.undoToken, null);
  assert.ok(!/PBI-002/.test(e.scrumSpec.files['product_backlog.csv']));
});

test('apiRestorePbi: 壊れた預かり（不正な JSON・row 無し・null・文字列でない鍵）は expired', () => {
  const e = makeEnv(scrum());
  e.cache['undo:bad'] = '{not json';
  e.cache['undo:norow'] = JSON.stringify({ shared: false });
  e.cache['undo:null'] = 'null';
  e.cache['undo:rownull'] = JSON.stringify({ row: null });
  ['bad', 'norow', 'null', 'rownull', '', undefined, null, 123, {}].forEach((tok) => {
    const r = e.ctx.apiRestorePbi(tok);
    assert.equal(r.reason, 'expired', 'token=' + JSON.stringify(tok));
  });
});

test('apiRestorePbi: 同じ ID が既にあれば既存と案内し、鍵は消費しない（もう一度試せる）', () => {
  const e = makeEnv(scrum());
  const del = e.ctx.apiDeletePbi('PBI-002', T);
  e.ctx.apiCreatePbi({ title: 'z', priority: 'Low' });   // PBI-003（002 は再利用されない）
  // 手で同じ ID の行を CSV に足す（ローカルの Claude Code が書いた想定）
  e.scrumSpec.files['product_backlog.csv'] += pbi('PBI-002', '別物');
  const r = e.ctx.apiRestorePbi(del.undoToken);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duplicate_id');
  assert.match(r.message, /既に存在します/);
  assert.ok(('undo:' + del.undoToken) in e.cache, '失敗したのに鍵を捨てた');
});

test('apiRestorePbi: 鍵の削除が失敗しても復元は成功する', () => {
  const e = makeEnv(scrum(), { cacheRemoveThrows: true });
  const del = e.ctx.apiDeletePbi('PBI-002', T);
  const r = e.ctx.apiRestorePbi(del.undoToken);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('apiRestorePbi: 預かりの ID が形式違い・採番範囲外・タイトル空なら拒否する', () => {
  const e = makeEnv(scrum());
  const hold = (row) => { const k = 'k' + Object.keys(e.cache).length; e.cache['undo:' + k] = JSON.stringify({ row, shared: false }); return k; };
  let r = e.ctx.apiRestorePbi(hold({ id: 'ABC-1', title: 'x' }));
  assert.equal(r.reason, 'invalid'); assert.match(r.message, /形式が不正/);
  r = e.ctx.apiRestorePbi(hold({ id: 'PBI-999', title: 'x' }));
  assert.equal(r.reason, 'invalid'); assert.match(r.message, /採番済みの範囲/);
  r = e.ctx.apiRestorePbi(hold({ id: 'PBI-005', title: '   ' }));   // 範囲外が先に効く
  assert.equal(r.ok, false);
  e.ctx.setLastPbiId_('PBI-009');
  r = e.ctx.apiRestorePbi(hold({ id: 'PBI-005', title: '   ' }));
  assert.equal(r.reason, 'invalid'); assert.match(r.message, /タイトルを入力/);
});

// ---- 変更履歴の追記 -------------------------------------------------------
function updateOnce(e) { return e.ctx.apiUpdateStatus('PBI-001', 'Done', T); }

test('履歴: change_log.csv が無ければ本体は成功し、画面に警告を返す', () => {
  const s = scrum(); delete s.files['change_log.csv'];
  const r = updateOnce(makeEnv(s));
  assert.equal(r.ok, true);
  assert.match(r.historyWarning, /change_log\.csv が見つかりません/);
});

test('履歴: 空のファイルは見出しから書き直して自己修復する', () => {
  const e = makeEnv(scrum({ 'change_log.csv': '  \n' }));
  const r = updateOnce(e);
  assert.equal(r.ok, true);
  assert.equal(r.historyWarning, undefined);
  const lines = e.scrumSpec.files['change_log.csv'].trim().split('\n');
  assert.equal(lines[0], 'id,at,actor,target_id,action,field,before,after');
  assert.equal(lines.length, 2);
});

test('履歴: 見出しが違うファイルには足さず警告する', () => {
  const e = makeEnv(scrum({ 'change_log.csv': 'a,b\n1,2\n' }));
  const r = updateOnce(e);
  assert.equal(r.ok, true);
  assert.match(r.historyWarning, /列構成が想定と異なります/);
  assert.equal(e.scrumSpec.files['change_log.csv'], 'a,b\n1,2\n');
});

test('履歴: 末尾が閉じていない引用符なら足さずに警告する', () => {
  const broken = CHG_HEADER + 'CHG-1,t,a,PBI-001,update,title,"途中';
  const e = makeEnv(scrum({ 'change_log.csv': broken }));
  const r = updateOnce(e);
  assert.match(r.historyWarning, /引用符が閉じていません/);
  assert.equal(e.scrumSpec.files['change_log.csv'], broken);
});

test('履歴: 末尾に改行が無いファイルでも、行が前の行に連結されない', () => {
  const e = makeEnv(scrum({ 'change_log.csv': CHG_HEADER + 'CHG-1,t,a,PBI-001,update,title,x,y' }));
  const r = updateOnce(e);
  assert.equal(r.ok, true);
  const lines = e.scrumSpec.files['change_log.csv'].trim().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[1].startsWith('CHG-1,'));
  assert.ok(lines[2].startsWith('CHG-'));
});

test('履歴: 100万文字を超えたら書けたうえで切り替えを案内する', () => {
  const big = CHG_HEADER + ('CHG-0,t,a,PBI-001,update,title,' + 'x'.repeat(990) + ',y\n').repeat(1010);
  const e = makeEnv(scrum({ 'change_log.csv': big }));
  const r = updateOnce(e);
  assert.equal(r.ok, true);
  assert.match(r.historyWarning, /大きくなっています/);
  assert.ok(e.scrumSpec.files['change_log.csv'].length > big.length);
});

test('履歴: 書き込みが失敗しても本体は成功（元のエラーを警告に含める）', () => {
  const s = scrum(); s.failWrite = 'change_log.csv'; s.failWriteMessage = 'quota';
  const e = makeEnv(s);
  const r = updateOnce(e);
  assert.equal(r.ok, true);
  assert.match(r.historyWarning, /変更履歴を記録できませんでした（quota/);
  assert.match(e.scrumSpec.files['product_backlog.csv'], /PBI-001,A,,,Medium,1,Done/);
});

// ---- 障害物 ---------------------------------------------------------------
test('apiCreateImpediment: 検証エラーは全部まとめて返し、何も書かない', () => {
  const e = makeEnv(scrum());
  const before = e.scrumSpec.files['impediment_log.csv'];
  const r = e.ctx.apiCreateImpediment({ title: '（雛形）', reported_by: '' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message.split('\n').length, 2);
  assert.equal(e.scrumSpec.files['impediment_log.csv'], before);
  assert.ok(r.view, '失敗でも最新のビューを返す');
});

test('apiCreateImpediment: 解決済の最大 ID の次を採番する（ID を再利用しない）', () => {
  const e = makeEnv(scrum({ 'impediment_log_resolved.csv': IMP_HEADER + imp('IMP-007', '済', { status: 'Resolved', resolved_at: '2026-01-05', resolution: 'x' }) }));
  const r = e.ctx.apiCreateImpediment({ title: '新', reported_by: 'me' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.id, 'IMP-008');
});

test('apiUpdateImpediment: 不正な入力は invalid、雛形の行は編集できず not_found', () => {
  const e = makeEnv(scrum());
  let r = e.ctx.apiUpdateImpediment('IMP-001', { title: '', reported_by: 'me' }, impRow('IMP-001', '詰まり'));
  assert.equal(r.reason, 'invalid');
  r = e.ctx.apiUpdateImpediment('IMP-099', { title: 'x', reported_by: 'me' }, impRow('IMP-099', 'x'));
  assert.equal(r.reason, 'not_found');
  assert.match(r.message, /この障害物が見つかりません/);
  r = e.ctx.apiUpdateImpediment('IMP-001', { title: 'x', reported_by: 'me' }, impRow('IMP-001', '違う'));
  assert.equal(r.reason, 'conflict');
  assert.match(r.message, /もう一度保存すると上書き/);
});

test('apiResolveImpediment: 解決策が空は invalid。見ていない変更があれば conflict（再押下の案内）', () => {
  const e = makeEnv(scrum());
  let r = e.ctx.apiResolveImpediment('IMP-001', '  ', impRow('IMP-001', '詰まり'));
  assert.equal(r.reason, 'invalid');
  r = e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '古い題'));
  assert.equal(r.reason, 'conflict');
  assert.match(r.message, /「解決を確定」を押してください/);
  r = e.ctx.apiResolveImpediment('IMP-404', '直した', impRow('IMP-404', 'x'));
  assert.equal(r.reason, 'not_found');
});

test('apiResolveImpediment: 解決済の ID に再度送ると「既に解決済み」と案内する', () => {
  const e = makeEnv(scrum());
  assert.equal(e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり')).ok, true);
  const r = e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  assert.equal(r.ok, false);
  assert.match(r.message, /既に解決済み/);
});

test('apiResolveImpediment: 同じ ID で中身が違う行が両方にあれば duplicate_id（ID を名指し）', () => {
  const e = makeEnv(scrum({
    'impediment_log_resolved.csv': IMP_HEADER + imp('IMP-001', '別の障害物', { status: 'Resolved', resolved_at: '2026-01-05', resolution: 'x' }),
  }));
  const r = e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  assert.equal(r.reason, 'duplicate_id');
  assert.match(r.message, /（IMP-001）/);
  // どちらのファイルも書き換えていない
  assert.match(e.scrumSpec.files['impediment_log.csv'], /IMP-001,詰まり/);
});

test('apiUnresolveImpediment: 解決→取り消しで元に戻る。不正な入力・競合・不在はそれぞれの案内', () => {
  const e = makeEnv(scrum());
  const res = e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  assert.equal(res.ok, true, JSON.stringify(res));
  const moved = J(res.moved), resolvedRow = J(res.resolvedRow);
  let r = e.ctx.apiUnresolveImpediment(null, null);
  assert.equal(r.reason, 'invalid'); assert.match(r.message, /取り消す内容が不正/);
  r = e.ctx.apiUnresolveImpediment(moved, Object.assign({}, resolvedRow, { resolution: '書き換えられた' }));
  assert.equal(r.reason, 'conflict'); assert.match(r.message, /取り消しはしません/);
  r = e.ctx.apiUnresolveImpediment(Object.assign({}, moved, { id: 'IMP-050' }), Object.assign({}, resolvedRow, { id: 'IMP-050' }));
  assert.equal(r.reason, 'not_found'); assert.match(r.message, /見つかりません/);
  r = e.ctx.apiUnresolveImpediment(moved, resolvedRow);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(e.scrumSpec.files['impediment_log.csv'], /IMP-001,詰まり/);
  assert.ok(!/IMP-001/.test(e.scrumSpec.files['impediment_log_resolved.csv']));
});

test('障害物の書き込み: ロックが取れなければ busy', () => {
  const e = makeEnv(scrum(), { lockAvailable: false });
  const r = e.ctx.apiCreateImpediment({ title: 'x', reported_by: 'me' });
  assert.equal(r.reason, 'busy');
});

test('障害物の書き込み: 見出しが違う・列あふれ・ファイル無しは書かずに error（ビューは付かない）', () => {
  let e = makeEnv(scrum({ 'impediment_log.csv': 'id,title\nIMP-001,x\n' }));
  let r = e.ctx.apiCreateImpediment({ title: 'x', reported_by: 'me' });
  assert.equal(r.reason, 'error'); assert.match(r.message, /列構成が想定と異なります/);
  assert.equal(r.view, undefined);
  e = makeEnv(scrum({ 'impediment_log_resolved.csv': IMP_HEADER + imp('IMP-002', 'x', { status: 'Resolved' }).trim() + ',余り\n' }));
  r = e.ctx.apiCreateImpediment({ title: 'x', reported_by: 'me' });
  assert.match(r.message, /IMP-002 の行（2行目）に列が多すぎます/);
  const s = scrum(); delete s.files['impediment_log_resolved.csv'];
  r = makeEnv(s).ctx.apiCreateImpediment({ title: 'x', reported_by: 'me' });
  assert.match(r.message, /impediment_log_resolved\.csv が見つかりません/);
});

test('解決の2ファイル目が書けなかったら partial。書けた側だけ画面に反映し、履歴には「resolve」を残す', () => {
  const s = scrum();
  const e = makeEnv(s);
  s.failWrite = 'impediment_log.csv';   // 先に resolved へ足し、open からの削除で失敗させる
  const r = e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'partial');
  assert.match(r.message, /impediment_log\.csv に書けませんでした/);
  assert.match(s.files['impediment_log_resolved.csv'], /IMP-001/);
  assert.match(s.files['impediment_log.csv'], /IMP-001/);
  assert.equal(J(r.view.pending).length, 1, '途中で止まった操作として pending に出る');
  assert.match(s.files['change_log.csv'], /IMP-001,resolve/);
});

test('途中で止まった解決を「完了」で揃えるとき、履歴の resolve を二重に残さない', () => {
  const s = scrum();
  const e = makeEnv(s);
  s.failWrite = 'impediment_log.csv';
  e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  delete s.failWrite;
  const pending = J(e.ctx.apiGetView('impediment').view.pending)[0];
  const r = e.ctx.apiResolveImpediment('IMP-001', '直した', pending.open);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!/IMP-001/.test(s.files['impediment_log.csv']));
  const resolveCount = (s.files['change_log.csv'].match(/IMP-001,resolve/g) || []).length;
  assert.equal(resolveCount, 1);
});

test('途中で止まった解決を「未解決に戻す」で揃えたら、最終状態と合うよう unresolve を記録する', () => {
  const s = scrum();
  const e = makeEnv(s);
  s.failWrite = 'impediment_log.csv';
  e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  delete s.failWrite;
  const pending = J(e.ctx.apiGetView('impediment').view.pending)[0];
  const r = e.ctx.apiUnresolveImpediment(pending.open, pending.resolved);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!/IMP-001/.test(s.files['impediment_log_resolved.csv']));
  assert.match(s.files['impediment_log.csv'], /IMP-001/);
  assert.match(s.files['change_log.csv'], /IMP-001,unresolve/, '最新の履歴が resolve のままで最終状態と食い違う');
});

test('解決が途中で止まっている間の編集は、先に揃えるよう案内して拒否する', () => {
  const s = scrum();
  const e = makeEnv(s);
  s.failWrite = 'impediment_log.csv';
  e.ctx.apiResolveImpediment('IMP-001', '直した', impRow('IMP-001', '詰まり'));
  delete s.failWrite;
  const r = e.ctx.apiUpdateImpediment('IMP-001', { title: '直す', reported_by: 'me' }, impRow('IMP-001', '詰まり'));
  assert.equal(r.ok, false);
  assert.match(r.message, /途中で止まっています/);
});

// ---- コメント -------------------------------------------------------------
test('apiAddComment: ログインが取れなければ forbidden。対象・本文の検証エラーは invalid', () => {
  let e = makeEnv(scrum(), { user: '' });
  assert.equal(e.ctx.apiAddComment('PBI-001', 'こんにちは').reason, 'forbidden');
  e = makeEnv(scrum(), { userThrows: true });
  assert.equal(e.ctx.apiAddComment('PBI-001', 'こんにちは').reason, 'forbidden');
  e = makeEnv(scrum());
  let r = e.ctx.apiAddComment('X-1', '  ');
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message.split('\n').length, 2);
  r = e.ctx.apiAddComment('PBI-001', 'あ'.repeat(2001));
  assert.equal(r.reason, 'invalid');
  assert.equal(e.ctx.apiAddComment('PBI-001', 'あ'.repeat(2000)).ok, true);
  assert.equal(e.ctx.apiAddComment('PBI-001', '😀'.repeat(2000)).ok, true, 'サロゲートペアは1字と数える');
});

test('apiAddComment: ID が4回続けて衝突したら error（上書きも重複もしない）', () => {
  const uuid = 'abcdef12-0000-4000-8000-000000000000';
  const e = makeEnv(scrum({ 'comments.csv': CMT_HEADER + 'CMT-abcdef12,PBI-001,me@example.com,' + T + ',既存\n' }), { uuids: [uuid] });
  const before = e.scrumSpec.files['comments.csv'];
  const r = e.ctx.apiAddComment('PBI-001', 'x');
  assert.equal(r.ok, false);
  assert.match(r.message, /ID が重複しました/);
  assert.equal(e.scrumSpec.files['comments.csv'], before);
});

test('apiAddComment: 衝突しても再抽選で成功する', () => {
  const e = makeEnv(scrum({ 'comments.csv': CMT_HEADER + 'CMT-abcdef12,PBI-001,me@example.com,' + T + ',既存\n' }),
    { uuids: ['abcdef12-0', 'abcdef12-1', '99999999-0'] });
  const r = e.ctx.apiAddComment('PBI-001', 'x');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.comment.id, 'CMT-99999999');
});

test('コメント: comments.csv が無ければ error。ロックが取れなければ busy。見出し違いは error', () => {
  const s = scrum(); delete s.files['comments.csv'];
  assert.match(makeEnv(s).ctx.apiAddComment('PBI-001', 'x').message, /comments\.csv が見つかりません/);
  assert.equal(makeEnv(scrum(), { lockAvailable: false }).ctx.apiAddComment('PBI-001', 'x').reason, 'busy');
  const bad = makeEnv(scrum({ 'comments.csv': 'a,b\n' })).ctx.apiAddComment('PBI-001', 'x');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /列構成が想定と異なります/);
});

test('apiDeleteComment: 他人のコメントは消せない・無い ID は not_found・自分のは消えて履歴が残る', () => {
  const csv = CMT_HEADER + 'CMT-00000001,PBI-001,other@example.com,' + T + ',他人\n' + 'CMT-00000002,PBI-001,me@example.com,' + T + ',自分\n';
  const e = makeEnv(scrum({ 'comments.csv': csv }));
  let r = e.ctx.apiDeleteComment('CMT-00000001');
  assert.equal(r.reason, 'forbidden'); assert.match(r.message, /自分のコメントだけ/);
  assert.equal(J(r.comments['PBI-001']).length, 2, '失敗でも最新のコメントを返す');
  r = e.ctx.apiDeleteComment('CMT-99999999');
  assert.equal(r.reason, 'not_found');
  r = e.ctx.apiDeleteComment('CMT-00000002');
  assert.equal(r.ok, true);
  assert.equal(r.removed.body, '自分');
  assert.match(e.scrumSpec.files['change_log.csv'], /PBI-001,comment_delete/);
});

test('apiRestoreComment: 自分のコメントだけ戻せる。不正な行は invalid。二重に戻しても増えない', () => {
  const e = makeEnv(scrum());
  const row = { id: ' CMT-0000000a ', target_id: ' PBI-001 ', author: 'me@example.com', created_at: T, body: '復元' };
  let r = e.ctx.apiRestoreComment(Object.assign({}, row, { author: 'other@example.com' }));
  assert.equal(r.reason, 'forbidden');
  r = e.ctx.apiRestoreComment(null);
  assert.equal(r.reason, 'forbidden');
  r = e.ctx.apiRestoreComment(Object.assign({}, row, { body: '' }));
  assert.equal(r.reason, 'invalid');
  r = e.ctx.apiRestoreComment(row);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.restored.id, 'CMT-0000000a');
  assert.equal(r.restored.target_id, 'PBI-001');
  const after = e.scrumSpec.files['comments.csv'];
  const again = e.ctx.apiRestoreComment(row);
  assert.equal(again.ok, true);
  assert.equal(e.scrumSpec.files['comments.csv'], after, '二重に戻して行が増えた');
  assert.equal((e.scrumSpec.files['change_log.csv'].match(/comment_restore/g) || []).length, 1, '何も変わらない再送は履歴を増やさない');
});

// ---- 履歴の読み取り ---------------------------------------------------------
test('apiGetHistory: 対象の形が不正なら invalid。上限ちょうどは省略なし、超えたら truncated', () => {
  const e = makeEnv(scrum());
  assert.equal(e.ctx.apiGetHistory('pbi-1').ok, false);
  assert.equal(e.ctx.apiGetHistory('').reason, 'invalid');
  assert.equal(e.ctx.apiGetHistory(' PBI-001 ').ok, true);
  const rows = (n) => CHG_HEADER + Array.from({ length: n }, (_, i) => 'CHG-' + i + ',2026-01-01 00:00:' + ('0' + (i % 60)).slice(-2) + ',a,PBI-001,update,title,x,y\n').join('');
  let r = makeEnv(scrum({ 'change_log.csv': rows(200) })).ctx.apiGetHistory('PBI-001');
  assert.equal(r.entries.length, 200);
  assert.equal(r.truncated, undefined);
  r = makeEnv(scrum({ 'change_log.csv': rows(201) })).ctx.apiGetHistory('PBI-001');
  assert.equal(r.entries.length, 200);
  assert.equal(r.truncated, true);
});
