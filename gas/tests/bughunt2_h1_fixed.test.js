'use strict';
// 2巡目のバグ探し H1（サーバー・pure 側）の修正確認。各テストは bughunt2_{S,V,P}_failing.test.js.txt の再現を移したもの。
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./bughunt2_S_harness.js');
const plain = H.plain;

// --- S2: 利用者が書ける値に効く正規表現が、長い入力で二乗時間にならない ---------------------------------

function timeIt(fn) {
  const t = Date.now();
  fn();
  return Date.now() - t;
}

test('S-BUG-2a: シートへの無害化（escapeSheetCell）が、- と長い数字の並びで二乗時間にならない', () => {
  const E = require('../pure_sheet_escape.js');
  const shapes = [
    '-' + '1'.repeat(40000) + 'x',
    '-' + '1'.repeat(20000) + '.' + '1'.repeat(20000) + 'x',
    '-1e' + '1'.repeat(40000) + 'x',
    '-1' + ' '.repeat(40000) + 'x',
    ' '.repeat(40000) + '-x',
  ];
  shapes.forEach((s) => {
    const ms = timeIt(() => E.escapeSheetCell(s));
    assert.ok(ms < 100, 'escapeSheetCell が ' + ms + 'ms かかった（長さ ' + s.length + '）');
    assert.equal(E.escapeSheetCell(s), "'" + s, '数値でない値は無害化する');
  });
});

test('S-BUG-2a: 数値だけの文字列の扱いは変わらない', () => {
  const E = require('../pure_sheet_escape.js');
  ['-3', '+1.5', '-1e3', '-.5', ' -2 ', '-1.', '+1.5E-3', '-' + '9'.repeat(40000)].forEach((s) => assert.equal(E.escapeSheetCell(s), s, s));
  ['-', '-.', '-e3', '-1e', '-1.2.3', '=1', '+1x', '- 1', '@1'].forEach((s) => assert.equal(E.escapeSheetCell(s), "'" + s, s));
});

test('S-BUG-2b: スプリント名の正規化（normalizeSprint）が、長い数字の並び＋末尾の非数字で二乗時間にならない', () => {
  const F = require('../pure_filter.js');
  const s = '1'.repeat(40000) + 'x';
  const ms = timeIt(() => F.normalizeSprint(s));
  assert.ok(ms < 100, 'normalizeSprint が ' + ms + 'ms かかった（/^(.*?)(\\d+)$/ のバックトラック）');
  assert.equal(F.normalizeSprint(s), s);
});

test('S-BUG-2b: normalizeSprint の結果は変わらない', () => {
  const F = require('../pure_filter.js');
  assert.equal(F.normalizeSprint('Sprint 001'), 'sprint001');
  assert.equal(F.normalizeSprint('sprint1'), 'sprint001');
  assert.equal(F.normalizeSprint('Sprint-12'), 'sprint012');
  assert.equal(F.normalizeSprint('sprint1234'), 'sprint1234');
  assert.equal(F.normalizeSprint('7'), '007');
  assert.equal(F.normalizeSprint('a1b22'), 'a1b022');
  assert.equal(F.normalizeSprint('abc'), 'abc');
  assert.equal(F.normalizeSprint(''), '');
  assert.equal(F.normalizeSprint(null), '');
});

test('S-BUG-2c: 1回の apiUpdatePbi で入れたスプリント値で、全員の盤面の読み込み（apiGetView board）が遅くならない', () => {
  const h = H.createCtx(H.baseFiles());
  const u = plain(h.ctx.apiUpdatePbi('PBI-001', { title: 'A', sprint: '1'.repeat(40000) + 'x' }, '2026-10-01 00:00:00'));
  assert.equal(u.ok, true, '前提: 長いスプリント値が受け付けられる');
  let v;
  const ms = timeIt(() => { v = plain(h.ctx.apiGetView('board')); });
  assert.equal(v.ok, true);
  assert.ok(ms < 200, '盤面の読み込みに ' + ms + 'ms（sprintChoices → normalizeSprint）');
});

// --- V1: 全角括弧だけで囲んだ PBI のタイトルは、雛形の行と見分けられないので拒否する --------------------

const V = require('./bughunt2_V_env.js');
const VT = '2026-01-01 00:00:00';
function vEnv() {
  return V.makeEnv({ files: { 'product_backlog.csv': V.BACKLOG_HEADER + 'PBI-001,A,,,Low,1,New,,' + VT + ',' + VT + '\n', 'product_backlog_done.csv': V.BACKLOG_HEADER }, folders: {} });
}
const boardIds = (board) => [].concat.apply([], V.J(board).columns.map((c) => c.cards.map((x) => x.id)));
const V1_MSG = 'タイトルを（）だけで囲まないでください。雛形の行と見分けられなくなります。';

test('BUG-V1: 全角括弧だけで囲んだタイトルで PBI を作ると invalid で断る（成功と返して盤面から消さない）', () => {
  const e = vEnv();
  const before = e.scrumSpec.files['product_backlog.csv'];
  const r = V.J(e.ctx.apiCreatePbi({ title: ' （仮） ', priority: 'Low' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message, V1_MSG);
  assert.equal(e.scrumSpec.files['product_backlog.csv'], before, '書いていない');
});

test('BUG-V1b: 既存の PBI のタイトルを（…）だけで囲む保存は invalid で断る。PBI は盤面に残る', () => {
  const e = vEnv();
  const r = V.J(e.ctx.apiUpdatePbi('PBI-001', { title: '（旧）', priority: 'Low', status: 'New', size: '1' }, VT));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.ok(boardIds(e.ctx.apiGetView('board').view).indexOf('PBI-001') !== -1);
});

test('BUG-V1: 括弧が途中にあるだけのタイトル・片側だけのタイトルは通す', () => {
  const pv = require('../pure_pbi_validate.js');
  ['（仮）の件', '件（仮）', '（', '）', 'A（B）C'].forEach((t) => assert.equal(pv.validatePbiFields({ title: t }, ['New']).ok, true, t));
  assert.deepEqual(pv.validatePbiFields({ title: '（）' }, ['New']).errors, [V1_MSG]);
});

// --- V2: 配布（scripts/publish.js）は、配布記録 .published.json をリンク越しに書かない ---------------------------

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish.js');
function vTmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-V-publish-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function runPublish(arg) {
  const r = spawnSync(process.execPath, [SCRIPT, arg], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

test('BUG-V2: 配布先の scrum/ がリンクのとき、配布記録（.published.json）をリンク先（配布フォルダの外）へ書かない', () => {
  const t = vTmp();
  const outside = vTmp();
  try {
    fs.symlinkSync(outside.dir, path.join(t.dir, 'scrum'));
    const r = runPublish(t.dir);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(fs.readdirSync(outside.dir), [], 'リンク先に書き込んだ');
    assert.match(r.err, /通常のフォルダではないため/);
    assert.match(r.out, /リンク・通常でないファイルをスキップ/);
    assert.match(r.err, /配布記録（\.published\.json）を書きませんでした/);
    assert.doesNotMatch(r.out, /配布記録: /);
  } finally { t.cleanup(); outside.cleanup(); }
});

test('BUG-V2b: 配布先の scrum/.published.json がリンクのとき、リンク先の既存ファイル（配布フォルダの外）を上書きしない', () => {
  const t = vTmp();
  const outside = vTmp();
  try {
    fs.mkdirSync(path.join(t.dir, 'scrum'));
    const victim = path.join(outside.dir, 'victim.txt');
    fs.writeFileSync(victim, '大事な内容');
    fs.symlinkSync(victim, path.join(t.dir, 'scrum', '.published.json'));
    const r = runPublish(t.dir);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(victim, 'utf8'), '大事な内容', 'リンク先の外部ファイルが上書きされた');
    assert.ok(fs.lstatSync(path.join(t.dir, 'scrum', '.published.json')).isSymbolicLink(), 'リンク自体も触らない');
    assert.match(r.err, /配布記録（\.published\.json）を書きませんでした/);
  } finally { t.cleanup(); outside.cleanup(); }
});

// --- S3: トリガーのハンドラ scheduledSync は、直前（60秒以内）に同期できていれば何もしない ---------------------
// google.script.run からも呼べてしまうため、連打で全シートの再構築とロックの占有を繰り返させない。
// 正規のトリガーは30分毎なので影響しない（裁定: 呼び出し元の判定ではなく頻度の上限で塞ぐ）。

const syncEffects = (h) => h.log.filter((x) => /^(Lock|SpreadsheetApp\.getActiveSpreadsheet|Sheet\.)/.test(x));

test('S-BUG-3: scheduledSync を続けて呼んでも、2回目（60秒以内）は同期（ロック・シートの全消去と再構築）が走らない', () => {
  const h = H.createCtx(H.baseFiles());
  h.ctx.scheduledSync();
  assert.ok(syncEffects(h).length > 0, '前提: 1回目は同期する');
  assert.ok(h.props.LAST_SCHEDULED_SYNC_MS, '成功した時刻を記録する');
  h.log.length = 0;
  h.ctx.scheduledSync();
  assert.deepEqual(syncEffects(h), [], '2回目も同期が走った: ' + syncEffects(h).slice(0, 6).join(', '));
});

test('S-BUG-3: 前回の同期から60秒以上たっていれば同期する。記録が未来・壊れた値なら同期する', () => {
  const h = H.createCtx(H.baseFiles());
  [String(Date.now() - 61000), String(Date.now() + 3600000), 'abc', ''].forEach((v) => {
    h.props.LAST_SCHEDULED_SYNC_MS = v;
    h.log.length = 0;
    h.ctx.scheduledSync();
    assert.ok(syncEffects(h).length > 0, '記録 ' + JSON.stringify(v) + ' で同期しなかった');
  });
});

test('S-BUG-3: 同期に失敗したとき・ロックが取れず見送ったときは時刻を記録しない（次の呼び出しで同期する）', () => {
  const f = H.createCtx(H.baseFiles());
  f.props.SCRUM_FOLDER_ID = '';
  f.ctx.scheduledSync();
  assert.equal(f.props.LAST_SCHEDULED_SYNC_MS, undefined);
  const b = H.createCtx(H.baseFiles(), { lockBusy: true });
  b.ctx.scheduledSync();
  assert.equal(b.props.LAST_SCHEDULED_SYNC_MS, undefined);
});

test('S-BUG-3: 頻度の判定（pure）', () => {
  const R = require('../pure_sync_rate.js');
  const now = 1000000;
  assert.equal(R.isSyncTooSoon(String(now - 59999), now), true);
  assert.equal(R.isSyncTooSoon(String(now), now), true);
  assert.equal(R.isSyncTooSoon(String(now - 60000), now), false);
  assert.equal(R.isSyncTooSoon(String(now + 1), now), false, '未来の記録は信じない（時計のずれで止まり続けない）');
  [null, undefined, '', 'x', '12abc', 'NaN', 'Infinity'].forEach((v) => assert.equal(R.isSyncTooSoon(v, now), false, String(v)));
});

// --- S4: PBI の削除の取り消しは、鍵を捨ててから戻す（捨てられなければ戻さない） ------------------------------

function sharedPbi002Files() {
  const f = H.baseFiles();
  f['product_backlog.csv'] += H.csvLine(H.PBI_FIELDS, { id: 'PBI-002', title: 'B2', status: 'New', created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:05' }) + '\n';
  return f;
}
const pbi002Lines = (h) => h.files['product_backlog.csv'].split('\n').filter((l) => /^PBI-002,/.test(l)).length;

test('S-BUG-4: 同じ ID の行が2つある PBI の削除を取り消すとき、鍵の破棄（CacheService.remove）が失敗したら戻さない（同じ鍵で2回戻らない）', () => {
  const opts = {};
  const h = H.createCtx(sharedPbi002Files(), opts);
  const d = plain(h.ctx.apiDeletePbi('PBI-002', '2026-10-01 00:00:01'));
  assert.equal(d.ok, true);
  assert.equal(pbi002Lines(h), 1);
  opts.failCacheRemove = true;
  const before = h.files['product_backlog.csv'];
  const r1 = plain(h.ctx.apiRestorePbi(d.undoToken));
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'error');
  assert.equal(h.files['product_backlog.csv'], before, '鍵を捨てられないのに戻した');
  const r2 = plain(h.ctx.apiRestorePbi(d.undoToken));
  assert.equal(r2.ok, false);
  assert.equal(pbi002Lines(h), 1, '取り消しが効いて PBI-002 が ' + pbi002Lines(h) + ' 行になった');
  // 破棄が直れば、同じ鍵で1回だけ戻せる。
  opts.failCacheRemove = false;
  assert.equal(plain(h.ctx.apiRestorePbi(d.undoToken)).ok, true);
  assert.equal(pbi002Lines(h), 2);
  assert.equal(plain(h.ctx.apiRestorePbi(d.undoToken)).reason, 'expired');
  assert.equal(pbi002Lines(h), 2);
});

test('S-BUG-4: 鍵は本体を書く前に捨てる。本体を書けなかったときは鍵を預け直す（取り消しをやり直せる）', () => {
  const opts = {};
  const h = H.createCtx(sharedPbi002Files(), opts);
  const d = plain(h.ctx.apiDeletePbi('PBI-002', '2026-10-01 00:00:01'));
  h.log.length = 0;
  opts.readOnly = true;
  const r1 = plain(h.ctx.apiRestorePbi(d.undoToken));
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'error');
  const rm = h.log.indexOf('Cache.remove');
  const write = h.log.indexOf('Drive.setContent:product_backlog.csv');
  assert.ok(rm !== -1 && write !== -1 && rm < write, '順序: ' + h.log.join(', '));
  assert.equal(pbi002Lines(h), 1);
  opts.readOnly = false;
  assert.equal(plain(h.ctx.apiRestorePbi(d.undoToken)).ok, true, '預け直した鍵で戻せる');
  assert.equal(pbi002Lines(h), 2);
  assert.equal(plain(h.ctx.apiRestorePbi(d.undoToken)).reason, 'expired');
});

test('S-BUG-4: 戻さなかったとき（既に存在する等）は鍵を捨てない', () => {
  const h = H.createCtx(H.baseFiles());
  const d = plain(h.ctx.apiDeletePbi('PBI-002', '2026-10-01 00:00:01'));
  h.log.length = 0;
  assert.equal(plain(h.ctx.apiRestorePbi('no-such-token')).reason, 'expired');
  assert.equal(h.log.indexOf('Cache.remove'), -1);
  assert.equal(plain(h.ctx.apiRestorePbi(d.undoToken)).ok, true);
});

// --- S1（サーバー側）: 解決の取り消しはブラウザが送る行の中身を信じない ----------------------------------------
// 契約: apiResolveImpediment の成功応答は undoToken（サーバが CacheService に預けた解決前の行の鍵。'impundo:' + UUID、
// 600 秒）を持つ（預けられなければ null）。apiUnresolveImpediment は { undoToken } か { pendingId } の1つだけを受け取る。

const IMP2_OPEN_LINE = 'IMP-002,回線が遅い,d,alice,2026-10-01,Open,,,';
const impLines = (h, name) => h.files[name].split('\n').filter((l) => /^IMP-002,/.test(l));

function resolveImp002(h) {
  const v = plain(h.ctx.apiGetView('impediment'));
  const r = plain(h.ctx.apiResolveImpediment('IMP-002', '直した', v.view.open[0]));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

/** name のファイルへの書き込みを失敗させる（読み取りはできる）。戻り値を呼ぶと元に戻る。 */
function failWritesTo(h, name) {
  let value = h.files[name];
  Object.defineProperty(h.files, name, { configurable: true, enumerable: true, get: () => value, set: () => { throw new Error('write boom ' + name); } });
  return () => { Object.defineProperty(h.files, name, { configurable: true, enumerable: true, writable: true, value: value }); };
}

test('S-BUG-1a: 解決の取り消しで、ブラウザが送った moved の中身（タイトル・報告者・報告日・状態）に障害物をすり替えられない', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  const forged = Object.assign({}, r.moved, { title: '別の件', reported_by: 'ceo@example.com', description: 'すり替え', reported_at: '1999-01-01', status: 'Resolved', resolution: 'x' });
  const before = JSON.stringify(h.files);
  const u = plain(h.ctx.apiUnresolveImpediment(forged, r.resolvedRow));
  assert.equal(u.ok, false);
  assert.equal(u.reason, 'invalid');
  assert.equal(JSON.stringify(h.files), before, '書いた');
  // 鍵と一緒に行を送っても、行の中身は使わない（形が違うので断る）。
  const u2 = plain(h.ctx.apiUnresolveImpediment(Object.assign({ undoToken: r.undoToken }, forged)));
  assert.equal(u2.reason, 'invalid');
  assert.equal(JSON.stringify(h.files), before, '書いた');
  // 正しい鍵なら、戻すのは解決前の行そのもの。
  const u3 = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(u3.ok, true, JSON.stringify(u3));
  assert.deepEqual(impLines(h, 'impediment_log.csv'), [IMP2_OPEN_LINE]);
  assert.deepEqual(impLines(h, 'impediment_log_resolved.csv'), []);
});

test('S-BUG-1b: 解決の取り消しで、障害物を雛形の形（（…））に書き換えて一覧から消せない（作成・編集の検証を迂回できない）', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  const forged = Object.assign({}, r.moved, { title: '（隠す）', reported_by: '' });
  plain(h.ctx.apiUnresolveImpediment(forged, r.resolvedRow));
  plain(h.ctx.apiUnresolveImpediment({ pendingId: 'IMP-002', moved: forged }));
  const view = plain(h.ctx.apiGetView('impediment')).view;
  const visible = view.open.concat(view.resolved).some((x) => String(x.id).trim() === 'IMP-002');
  assert.ok(visible, 'IMP-002 が未解決・解決済のどちらからも見えなくなった（削除の無い障害物を実質的に消せる）');
});

test('S1: 解決の応答は undoToken を持ち、解決前の行を impundo:<鍵> に 600 秒預ける。moved / resolvedRow は表示用に残る', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  assert.equal(typeof r.undoToken, 'string');
  assert.ok(r.undoToken.length >= 32);
  const held = h.cache['impundo:' + r.undoToken];
  assert.ok(held, '預けていない');
  assert.equal(held.expiresAt, 600);
  assert.equal(r.moved.title, '回線が遅い');
  assert.equal(r.resolvedRow.status, 'Resolved');
});

test('S1: 預けられなかったとき（CacheService の失敗）は undoToken を null にする。解決そのものは成功', () => {
  const h = H.createCtx(H.baseFiles());
  h.ctx.CacheService.getScriptCache = () => ({ put() { throw new Error('cache boom'); }, get: () => null, remove() {} });
  const r = resolveImp002(h);
  assert.equal(r.undoToken, null);
  assert.deepEqual(impLines(h, 'impediment_log.csv'), []);
});

test('S1: 鍵は一度だけ使える。2回目は expired で何も書かない。期限切れも expired', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  assert.equal(plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken })).ok, true);
  const snap = JSON.stringify(h.files);
  const again = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'expired');
  assert.equal(again.message, '取り消しの期限が切れました。');
  assert.equal(JSON.stringify(h.files), snap);
  const h2 = H.createCtx(H.baseFiles());
  const r2 = resolveImp002(h2);
  h2.clock.now = 600;
  assert.equal(plain(h2.ctx.apiUnresolveImpediment({ undoToken: r2.undoToken })).reason, 'expired');
  assert.equal(impLines(h2, 'impediment_log.csv').length, 0);
});

test('S1: 鍵の破棄（CacheService.remove）が失敗したら取り消さない（reason error、何も書かない）。鍵は残る', () => {
  const opts = {};
  const h = H.createCtx(H.baseFiles(), opts);
  const r = resolveImp002(h);
  opts.failCacheRemove = true;
  const snap = JSON.stringify(h.files);
  const u = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(u.ok, false);
  assert.equal(u.reason, 'error');
  assert.equal(JSON.stringify(h.files), snap);
  opts.failCacheRemove = false;
  assert.equal(plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken })).ok, true);
  assert.deepEqual(impLines(h, 'impediment_log.csv'), [IMP2_OPEN_LINE]);
});

test('S1: 鍵は書く前に捨てる。1つ目の書き込みが失敗したら預け直し、同じ鍵でやり直せる', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  h.log.length = 0;
  const restore = failWritesTo(h, 'impediment_log.csv');
  const u = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(u.reason, 'error');
  assert.ok(h.log.indexOf('Cache.remove') !== -1 && h.log.indexOf('Cache.remove') < h.log.indexOf('Drive.setContent:impediment_log.csv'), h.log.join(', '));
  restore();
  assert.equal(plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken })).ok, true);
  assert.deepEqual(impLines(h, 'impediment_log.csv'), [IMP2_OPEN_LINE]);
  assert.deepEqual(impLines(h, 'impediment_log_resolved.csv'), []);
});

test('S1: 取り消しが途中で止まったら（partial）同じ鍵で送り直して完了できる（冪等）', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  const restore = failWritesTo(h, 'impediment_log_resolved.csv');
  const u = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(u.reason, 'partial');
  assert.deepEqual(impLines(h, 'impediment_log.csv'), [IMP2_OPEN_LINE]);
  assert.equal(impLines(h, 'impediment_log_resolved.csv').length, 1);
  restore();
  const again = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.deepEqual(impLines(h, 'impediment_log.csv'), [IMP2_OPEN_LINE]);
  assert.deepEqual(impLines(h, 'impediment_log_resolved.csv'), []);
  assert.equal(plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken })).reason, 'expired');
});

test('S1: 解決したあとに解決済の行が変わっていれば conflict（鍵は捨てない）', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  h.files['impediment_log_resolved.csv'] = h.files['impediment_log_resolved.csv'].replace('直した', '別の解決策');
  const u = plain(h.ctx.apiUnresolveImpediment({ undoToken: r.undoToken }));
  assert.equal(u.reason, 'conflict');
  assert.equal(u.message, '解決したあとに他の変更が入っています。取り消しはしません。');
  assert.ok(h.cache['impundo:' + r.undoToken]);
});

test('S1: { pendingId } は途中で止まった状態（同じ障害物が両方のファイルにある）のときだけ戻す。行はファイルの未解決側から作る', () => {
  const h = H.createCtx(H.baseFiles());
  // 解決が途中で止まった状態: 未解決にも解決済にも同じ IMP-002。
  const restore = failWritesTo(h, 'impediment_log.csv');
  const v = plain(h.ctx.apiGetView('impediment'));
  const p = plain(h.ctx.apiResolveImpediment('IMP-002', '直した', v.view.open[0]));
  assert.equal(p.reason, 'partial');
  restore();
  assert.equal(impLines(h, 'impediment_log.csv').length, 1);
  assert.equal(impLines(h, 'impediment_log_resolved.csv').length, 1);
  const u = plain(h.ctx.apiUnresolveImpediment({ pendingId: ' IMP-002 ' }));
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.deepEqual(impLines(h, 'impediment_log.csv'), [IMP2_OPEN_LINE]);
  assert.deepEqual(impLines(h, 'impediment_log_resolved.csv'), []);
  // 送り直し（既に揃っている）は何も書かずに成功する。
  const snap = JSON.stringify(h.files);
  assert.equal(plain(h.ctx.apiUnresolveImpediment({ pendingId: 'IMP-002' })).ok, true);
  assert.equal(JSON.stringify(h.files), snap);
});

test('S1: { pendingId } は、解決済だけにある障害物を戻さない（conflict）。どこにも無ければ not_found', () => {
  const h = H.createCtx(H.baseFiles());
  resolveImp002(h);
  const snap = JSON.stringify(h.files);
  const u = plain(h.ctx.apiUnresolveImpediment({ pendingId: 'IMP-002' }));
  assert.equal(u.ok, false);
  assert.equal(u.reason, 'conflict');
  assert.equal(u.message, '途中で止まった操作ではありません。最新の内容に更新しました。');
  assert.equal(JSON.stringify(h.files), snap);
  assert.equal(plain(h.ctx.apiUnresolveImpediment({ pendingId: 'IMP-050' })).reason, 'not_found');
  assert.equal(JSON.stringify(h.files), snap);
});

test('S1: 形の違う引数（行・空・配列・余分なキー・両方・文字列以外）は invalid で何も書かない', () => {
  const h = H.createCtx(H.baseFiles());
  const r = resolveImp002(h);
  const snap = JSON.stringify(h.files);
  [undefined, null, 'IMP-002', r.undoToken, [r.undoToken], {}, { undoToken: '' }, { pendingId: '' }, { undoToken: 1 }, { pendingId: ['IMP-002'] },
    { undoToken: r.undoToken, pendingId: 'IMP-002' }, { undoToken: r.undoToken, extra: 1 }, { pendingId: 'IMP-002', resolvedRow: r.resolvedRow },
    { pendingId: 'PBI-001' }].forEach((arg) => {
    const u = plain(h.ctx.apiUnresolveImpediment(arg));
    assert.equal(u.ok, false, JSON.stringify(arg));
    assert.equal(u.reason, 'invalid', JSON.stringify(arg) + ' → ' + JSON.stringify(u));
    assert.equal(u.message, '取り消す内容が不正です。');
  });
  assert.equal(JSON.stringify(h.files), snap);
  assert.ok(h.cache['impundo:' + r.undoToken], '不正な呼び出しで鍵を捨てた');
});

test('S1: 計画（pure）: planUnresolvePending は途中で止まった状態だけを戻す', () => {
  const M = require('../pure_impediment_merge.js');
  const row = { id: 'IMP-002', title: 't', description: '', reported_by: 'a', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' };
  const done = Object.assign({}, row, { status: 'Resolved', resolved_at: '2026-10-02', resolution: 'r' });
  const p = M.planUnresolvePending([row], [done], 'IMP-002');
  assert.equal(p.ok, true);
  assert.equal(p.open, null, '未解決側は既にある');
  assert.deepEqual(p.resolved, []);
  assert.deepEqual(M.planUnresolvePending([row], [], 'IMP-002'), { ok: true, open: null, resolved: null });
  assert.equal(M.planUnresolvePending([], [done], 'IMP-002').reason, 'not_pending');
  assert.equal(M.planUnresolvePending([], [], 'IMP-002').reason, 'not_found');
  assert.equal(M.planUnresolvePending([row, row], [done], 'IMP-002').reason, 'not_pending', '未解決に重複があれば対を決められない');
  assert.equal(M.planUnresolvePending([Object.assign({}, row, { title: '別物' })], [done], 'IMP-002').reason, 'not_pending');
  assert.equal(M.planUnresolvePending([row], [done], 'bad').reason, 'invalid');
});

test('S1（画面の最小の追随）: 解決の応答に undoToken が無ければ、取り消しの通知は出さず文言だけ出す', () => {
  const { createHarness } = require('./kanban_harness.js');
  const ROW = { id: 'IMP-002', title: '回線が遅い', description: '', reported_by: 'a', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' };
  const DONE = Object.assign({}, ROW, { status: 'Resolved', resolved_at: '2026-10-02', resolution: '直した' });
  const resp = (open, resolved) => ({ ok: true, name: 'impediment', view: { columns: [], open: open, resolved: resolved, pending: [] }, summary: null, sprintChoices: [], comments: {} });
  const h = createHarness([{ status: 'New', cards: [] }, { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] }, { status: 'Review', cards: [] }, { status: 'Done', cards: [] }]);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf([]), summary: null });
  h.clickTab('障害物');
  h.calls[h.calls.length - 1].handlers.success(resp([ROW], []));
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '直した');
  h.click('imp-panel-resolve');
  h.calls[h.calls.length - 1].handlers.success(Object.assign(resp([], [DONE]), { moved: ROW, resolvedRow: DONE, undoToken: null }));
  assert.equal(h.hiddenOf('toast'), true, '押しても断られる取り消しを出した');
  assert.ok(h.textOf('message').indexOf('IMP-002「回線が遅い」を解決しました。') !== -1, h.textOf('message'));
});

// --- P1: ID を発番・復元しない書き込みは、完了バックログ（product_backlog_done.csv）を読まない ----------------

const P = require('./bughunt2_P_support.js');
const csvPure = require('../pure_csv.js');

test('BUG-P1. 状態変更・編集・削除のたびに product_backlog_done.csv（20,000件・約2MB）を読まない', () => {
  const files = P.standardFiles(100, null);
  files['product_backlog_done.csv'] = P.pbiCsv(20000).replace(/PBI-0/g, 'PBI-1');
  const c = P.createCtx(files);
  [
    () => c.ctx.apiUpdateStatus(P.pid(1), 'Done', P.T0),
    () => c.ctx.apiUpdatePbi(P.pid(2), { title: '変えた' }, P.T0),
    () => c.ctx.apiDeletePbi(P.pid(3), P.T0),
  ].forEach((call, i) => {
    c.resetStats();
    const r = call();
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    const read = c.stats.readChars['product_backlog_done.csv'] || 0;
    assert.equal(read, 0, '操作 ' + i + ' で完了バックログを ' + read + ' 文字読んだ');
    assert.ok(c.stats.parsedChars < 4 * files['product_backlog.csv'].length, '解釈量 ' + c.stats.parsedChars);
  });
});

test('BUG-P1. 作成と削除の取り消しは、今までどおり完了バックログの ID を見て採番・判定する', () => {
  const files = P.standardFiles(3, null);
  files['product_backlog_done.csv'] = P.pbiCsv(1).replace('PBI-00001', 'PBI-00050');
  const c = P.createCtx(files);
  const r = c.ctx.apiCreatePbi({ title: '新しい', priority: 'Low' });
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
  assert.equal(r.id, 'PBI-00051', '完了バックログの最大より大きい ID を採番する');
  // 削除の取り消し: 預かった ID が完了バックログの最大以下なら（記録が無くても）戻せる。
  const c2 = P.createCtx(Object.assign(P.standardFiles(3, null), { 'product_backlog_done.csv': files['product_backlog_done.csv'] }));
  const d = c2.ctx.apiDeletePbi(P.pid(3), P.T0);
  assert.equal(d.ok, true);
  delete c2.props.LAST_PBI_ID;
  c2.resetStats();
  assert.equal(c2.ctx.apiRestorePbi(d.undoToken).ok, true);
  assert.ok((c2.stats.readChars['product_backlog_done.csv'] || 0) > 0, '復元は完了バックログを見る');
  assert.equal(c2.props.LAST_PBI_ID, 'PBI-00050', '復元で読んだ完了バックログの最大まで記録を進める');
});

// --- P3: 変更履歴の before / after は1つ 4000 字まで。長い値は切り詰めて「…（以下省略・全 N 字）」を付ける ----------
// 裁定により、上限は「全体の大きさ」ではなく「値1つの長さ」で持つ（元の再現の 2MB 以内は、全角だけの値では
// 200 件 × 2 × 4000 字 × 3 バイト ≒ 4.8MB になりうるため、値の長さの上限で確かめる）。

const HIST = require('../pure_history.js');
const capSuffix = (n) => '…（以下省略・全 ' + n + ' 字）';
const longDesc = (tag) => Array.from({ length: 400 }, (_, i) => '行' + i + ' ' + tag + ' ' + 'あ'.repeat(60)).join('\n');

test('BUG-P3. 編集の履歴は、前後の値を 4000 字で切り詰めて保存する（全文を持たない）', () => {
  const files = P.standardFiles(5, null);
  const c = P.createCtx(files);
  const at = () => csvPure.csvToObjects(files['product_backlog.csv'])[0].updated_at;
  const v1 = longDesc('v1');
  const v2 = longDesc('v2');
  assert.equal(c.ctx.apiUpdatePbi(P.pid(1), { title: 'タイトル 1', description: v1 }, at()).ok, true);
  assert.equal(c.ctx.apiUpdatePbi(P.pid(1), { title: 'タイトル 1', description: v2 }, at()).ok, true);
  assert.ok(csvPure.csvToObjects(files['product_backlog.csv'])[0].description === v2, '本体は全文のまま');
  const stored = csvPure.csvToObjects(files['change_log.csv']).filter((r) => r.field === 'description');
  assert.equal(stored.length, 2);
  const last = stored[1];
  assert.equal(last.before, v1.slice(0, 4000) + capSuffix(v1.length));
  assert.equal(last.after, v2.slice(0, 4000) + capSuffix(v2.length));
  assert.equal(stored[0].before, '説明, 1\n2行目', '短い値はそのまま');
  const h = c.ctx.apiGetHistory(P.pid(1));
  // 同じ秒の2件の並びは問わない（2回目の編集の行を前の値で探す）。
  const upd = h.entries.filter((e) => e.field === 'description' && e.before === last.before)[0];
  assert.ok(upd, '読み出しで二重に切り詰めない（before）');
  assert.equal(upd.after, last.after, '読み出しで二重に切り詰めない（after）');
});

test('BUG-P3. 既に全文を持つ古い履歴 200 件も、応答では値1つ 4000 字に切り詰める', () => {
  const rows = [P.HISTORY_HEADER];
  const q = (s) => '"' + s.replace(/"/g, '""') + '"';
  for (let i = 0; i < 200; i++) {
    rows.push(['CHG-f' + i.toString(16).padStart(7, '0'), '2026-02-' + String(1 + (i % 28)).padStart(2, '0') + ' 10:' + String(i % 60).padStart(2, '0') + ':00', 'a@example.com', P.pid(1), 'update', 'description', q(longDesc('v' + i)), q(longDesc('v' + (i + 1)))].join(','));
  }
  const files = P.standardFiles(5, null);
  files['change_log.csv'] = rows.join('\n') + '\n';
  const c = P.createCtx(files);
  const res = c.ctx.apiGetHistory(P.pid(1));
  assert.equal(res.ok, true);
  assert.equal(res.entries.length, 200);
  const max = 4000 + capSuffix(longDesc('v1').length).length;
  res.entries.forEach((e) => {
    assert.ok(e.before.length <= max && e.after.length <= max, e.before.length + ' / ' + e.after.length);
    assert.ok(e.after.endsWith(capSuffix(longDesc('v1').length)) || e.after.endsWith(capSuffix(longDesc('v10').length)) || e.after.endsWith(capSuffix(longDesc('v100').length)));
  });
  assert.ok(JSON.stringify(res).length < 200 * 2 * max + 100000, '応答 ' + JSON.stringify(res).length + ' 字');
});

test('BUG-P3. 切り詰め（pure）: 4000 字ちょうどはそのまま。サロゲートペアを割らない。字数は文字（コードポイント）で数える', () => {
  assert.equal(HIST.capHistoryValue('a'.repeat(4000)), 'a'.repeat(4000));
  assert.equal(HIST.capHistoryValue('a'.repeat(4001)), 'a'.repeat(4000) + capSuffix(4001));
  const emoji = 'a'.repeat(3999) + '😀' + 'b';   // 4001 文字（コードポイント）
  assert.equal(HIST.capHistoryValue(emoji), 'a'.repeat(3999) + '😀' + capSuffix(4001));
  const capped = HIST.capHistoryValue('x'.repeat(10000));
  assert.equal(HIST.capHistoryValue(capped), capped, '切り詰め済みの値は変えない');
  assert.equal(HIST.capHistoryValue(null), '');
  const rows = HIST.historyRows([{ target_id: 'PBI-1', action: 'update', field: 'description', before: 'y'.repeat(5000), after: 'z' }], { at: 't', actor: 'a', newId: () => 'CHG-1' });
  assert.equal(rows[0].before, 'y'.repeat(4000) + capSuffix(5000));
  assert.equal(rows[0].after, 'z');
});

// --- P5: 見出しの検査は先頭の1行（レコード）だけを解釈する。1回の呼び出しで本体を全文解釈するのは1回だけ ----------

test('BUG-P5a. 盤面の読み取りも書き込みも、本体を全文解釈するのは1回だけ（1.1 倍以内）', () => {
  const files = P.standardFiles(2000, null);
  const backlog = files['product_backlog.csv'].length;
  const c = P.createCtx(files);
  c.resetStats();
  assert.equal(c.ctx.apiGetView('board').ok, true);
  const view = c.stats.parsedChars;
  c.resetStats();
  assert.equal(c.ctx.apiUpdateStatus(P.pid(1), 'Done', P.T0).ok, true);
  const write = c.stats.parsedChars;
  assert.ok(view <= 1.1 * backlog && write <= 1.1 * backlog,
    '本体 ' + backlog + ' 文字に対し、盤面で ' + view + '（' + (view / backlog).toFixed(1) + ' 倍）、書き込みで ' + write + '（' + (write / backlog).toFixed(1) + ' 倍）解釈した');
});

test('BUG-P5a. 障害物・コメントの書き込みも、各ファイルを全文解釈するのは1回だけ', () => {
  const files = P.standardFiles(5, 3000);
  const c = P.createCtx(files);
  c.resetStats();
  assert.equal(c.ctx.apiAddComment(P.pid(1), 'こんにちは').ok, true);
  const comments = files['comments.csv'].length;
  // 書き込みの応答の組み立て（全コメントの写し）は P2（H2）で変わるので、ここでは書き込み前の解釈だけを数える。
  assert.ok(c.stats.parsedChars <= 1.1 * comments, 'コメント ' + comments + ' 文字に対し ' + c.stats.parsedChars);
});

test('BUG-P5. 見出しの取り出し（pure）は先頭のレコードだけを読む。引用・BOM・CRLF も本体の解釈と同じ', () => {
  const C = require('../pure_csv.js');
  const BH = require('../pure_backlog_header.js');
  assert.deepEqual(C.csvHeaderRow('a,b,c\n1,2,3\n'), ['a', 'b', 'c']);
  assert.deepEqual(C.csvHeaderRow('﻿a,b\r\n1,2'), ['a', 'b']);
  assert.deepEqual(C.csvHeaderRow('"a,x","b\nc",d\n1'), ['a,x', 'b\nc', 'd']);
  assert.deepEqual(C.csvHeaderRow('a"b,c\n'), ['a"b', 'c']);
  assert.deepEqual(C.csvHeaderRow('a,b'), ['a', 'b']);
  assert.deepEqual(C.csvHeaderRow(''), []);
  assert.deepEqual(C.csvHeaderRow('\n\na,b'), [], '先頭が空行なら見出しは空（どの列構成とも一致しない）');
  const seeds = ['x,y\n"1\n2",3', '"q""w",e\r\nz', 'only'];
  seeds.forEach((t) => assert.deepEqual(C.csvHeaderRow(t), C.parseCsv(t)[0] || [], t));
  assert.doesNotThrow(() => BH.assertHeaderMatches('a,b\n' + '"'.repeat(1), ['a', 'b']));
  assert.throws(() => BH.assertHeaderMatches('a,c\n1,2', ['a', 'b']), /列構成が想定と異なります/);
});

test('BUG-P5. 書き込み前の解釈（pure）: 1回の解釈で行と、列が多すぎる行の両方を返す', () => {
  const C = require('../pure_csv.js');
  const t = 'id,b\nX,1\nY,2,3\n';
  const r = C.csvToObjectsChecked(t);
  assert.deepEqual(JSON.parse(JSON.stringify(r.rows)), C.csvToObjects(t));
  assert.deepEqual(r.overlong, C.findOverlongCsvRow(t));
  assert.equal(C.csvToObjectsChecked('id,b\nX,1\n').overlong, null);
});
