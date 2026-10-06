'use strict';
/**
 * 2巡目 M: ミューテーションテスト（gas/tests/bughunt2_M_mutate.js）で生き残った変異を殺すテスト。
 * 各テストは仕様どおりの振る舞いを確かめる。見出しの末尾に、殺す変異の場所（ファイル:行）を書く。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAS_DIR = path.join(__dirname, '..');

/** web_app_flow.test.js の createTestContext を必要な分だけ写したもの。 */
function createCtx(files, opts) {
  opts = opts || {};
  const writes = [];
  const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const makeFile = (name) => ({
    getBlob: () => ({ getDataAsString: () => files[name] }),
    setContent: (c) => {
      if (opts.failWriteFile && name === opts.failWriteFile) throw new Error('write fail ' + name);
      writes.push(name);
      files[name] = c;
    },
  });
  const scrum = {
    getFilesByName: (n) => (Object.prototype.hasOwnProperty.call(files, n) ? iter([makeFile(n)]) : iter([])),
    // opts.sprintFolders: { フォルダ名: { ファイル名: 本文 } }
    getFolders: () => iter(Object.keys(opts.sprintFolders || {}).map((name) => {
      const inner = opts.sprintFolders[name];
      return {
        getName: () => name,
        getFilesByName: (n) => (Object.prototype.hasOwnProperty.call(inner, n)
          ? iter([{ getBlob: () => ({ getDataAsString: () => inner[n] }) }]) : iter([])),
      };
    })),
  };
  const root = { getFoldersByName: (n) => (n === 'scrum' ? iter([scrum]) : iter([])) };
  const props = { SCRUM_FOLDER_ID: 'x' };
  const cache = {};
  const clock = { now: opts.now || Date.UTC(2026, 9, 6, 1, 2, 3) };
  let uuidN = 0;
  const context = {
    console,
    DriveApp: { getFolderById: () => root },
    LockService: { getScriptLock: () => ({ tryLock: () => opts.lockFails !== true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; },
    }) },
    CacheService: { getScriptCache: () => ({
      get: (k) => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null),
      put: (k, v) => { cache[k] = String(v); },
      remove: (k) => { delete cache[k]; },
    }) },
    Session: {
      getScriptTimeZone: () => 'UTC',
      getActiveUser: () => ({ getEmail: () => (opts.user === undefined ? 'me@example.com' : opts.user) }),
    },
    Utilities: {
      getUuid: () => { uuidN++; return ('0000000' + uuidN.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
      formatDate: (d) => {
        const p = (n) => (n < 10 ? '0' + n : String(n));
        return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
          p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
      },
    },
  };
  // new Date() を固定する（nowText_ を決まった値にするため）
  const RealDate = Date;
  context.Date = class extends RealDate {
    constructor(...a) { if (a.length === 0) super(clock.now); else super(...a); }
    static now() { return clock.now; }
  };
  vm.createContext(context);
  fs.readdirSync(GAS_DIR).filter((n) => n.endsWith('.js')).sort().forEach((n) => {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), context, { filename: n });
  });
  return { ctx: context, files, props, cache, writes, clock };
}

const BACKLOG_HEADER = 'id,title,description,acceptance_criteria,priority,size,status,sprint,created_at,updated_at';
const IMP_HEADER = 'id,title,description,reported_by,reported_at,status,resolved_at,resolution,sprint';
const HIST_HEADER = 'id,at,actor,target_id,action,field,before,after';
const CMT_HEADER = 'id,target_id,author,created_at,body';

function backlogCsv(rows) {
  return BACKLOG_HEADER + '\n' + rows.map((r) => BACKLOG_HEADER.split(',').map((f) => r[f] || '').join(',')).join('\n') + '\n';
}
const T0 = '2026-01-01 00:00:00';
const pbi = (id, extra) => Object.assign({ id, title: 'T' + id, status: 'New', priority: 'Medium', created_at: T0, updated_at: T0 }, extra || {});

// web_app.js appendHistory_: `next.length > HISTORY_SIZE_WARN_CHARS`（ちょうど上限は警告しない）
test('変更履歴: 書いた後の長さがちょうど上限（1000000字）なら警告しない、1字超えたら警告する', () => {
  const base = () => ({ 'product_backlog.csv': backlogCsv([pbi('PBI-001')]) });
  const filler = (n) => HIST_HEADER + '\nCHG-00000000,' + T0 + ',x,PBI-001,update,title,a,' + 'z'.repeat(n) + '\n';
  const probe = createCtx(Object.assign(base(), { 'change_log.csv': filler(10) }));
  const r0 = probe.ctx.apiUpdateStatus('PBI-001', 'Ready', T0);
  assert.equal(r0.ok, true, JSON.stringify(r0));
  const added = probe.files['change_log.csv'].length - filler(10).length;
  assert.ok(added > 0);
  const LIMIT = 1000000;
  const padFor = (total) => total - added - filler(0).length;
  const exact = createCtx(Object.assign(base(), { 'change_log.csv': filler(padFor(LIMIT)) }));
  const r1 = exact.ctx.apiUpdateStatus('PBI-001', 'Ready', T0);
  assert.equal(exact.files['change_log.csv'].length, LIMIT);
  assert.equal(r1.ok, true);
  assert.equal(r1.historyWarning, undefined, 'ちょうど上限では警告しない');
  const over = createCtx(Object.assign(base(), { 'change_log.csv': filler(padFor(LIMIT + 1)) }));
  const r2 = over.ctx.apiUpdateStatus('PBI-001', 'Ready', T0);
  assert.equal(over.files['change_log.csv'].length, LIMIT + 1);
  assert.match(String(r2.historyWarning), /大きくなっています/);
});

// pure_merge.js restoreRow: `back.id = key;`（id は前後の空白を落として戻す）
test('restoreRow: 前後に空白のある id の行は、空白を落とした id で戻す', () => {
  const { restoreRow } = require('../pure_merge.js');
  const fields = BACKLOG_HEADER.split(',');
  const r = restoreRow([], { id: '  PBI-007 ', title: 'X', created_at: T0, updated_at: T0 }, fields, '2026-02-02 00:00:00');
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].id, 'PBI-007');
  assert.equal(r.rows[0].created_at, T0);
  assert.equal(r.rows[0].updated_at, '2026-02-02 00:00:00');
});

// web_app.js readSprintBacklogMdBestEffort_: `if (!folder) return '';` と `|| ''`
test('バーンダウン: 最新のスプリントフォルダの sprint_backlog.md の表を返す（無いときは null）', () => {
  const md = '# x\n\n## バーンダウン\n\n| 日付 | 残タスク数 | 残ポイント |\n|---|---|---|\n| Day 1 | 5 | 8 |\n';
  const { ctx } = createCtx({ 'velocity.csv': 'sprint,planned,actual\n' }, {
    sprintFolders: { sprint001: { 'sprint_backlog.md': '## バーンダウン\n\n| 日付 | 残タスク数 | 残ポイント |\n|---|---|---|\n| Day 1 | 1 | 1 |\n' },
      sprint002: { 'sprint_backlog.md': md } },
  });
  const v = ctx.apiGetView('burndown');
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.ok(v.view, 'バーンダウンの表が返らない');
  assert.deepEqual(JSON.parse(JSON.stringify(v.view.table)).rows, [['Day 1', '5', '8']]);
  // ファイルが無いスプリントフォルダなら表は null
  const none = createCtx({}, { sprintFolders: { sprint003: {} } }).ctx.apiGetView('burndown');
  assert.equal(none.ok, true);
  assert.equal(none.view, null);
});

// web_app.js apiGetView: `if (key === 'velocity')`（ベロシティはバックログを読まない）
test('apiGetView(velocity): product_backlog.csv が無くてもベロシティの表を返し、ロードマップにはならない', () => {
  const { ctx } = createCtx({ 'velocity.csv': 'sprint,planned,actual\nSprint 1,10,8\n' });
  const v = ctx.apiGetView('velocity');
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.name, 'velocity');
  assert.ok(v.view && v.view.table);
  assert.equal(v.view.marks, undefined, 'ロードマップの帯（marks）がある');
  const road = ctx.apiGetView('roadmap');
  assert.equal(road.ok, false, 'ロードマップはバックログが無ければ失敗する（対照）');
});

// web_app.js takeHeldPbi_: `typeof token !== 'string'`（文字列でない鍵は使わせない）
test('apiRestorePbi: 鍵を配列などの文字列でない値で送っても戻さない（expired）', () => {
  const { ctx, files } = createCtx({ 'product_backlog.csv': backlogCsv([pbi('PBI-001'), pbi('PBI-002')]) });
  const del = ctx.apiDeletePbi('PBI-002', T0);
  assert.equal(del.ok, true, JSON.stringify(del));
  assert.ok(del.undoToken);
  const bad = ctx.apiRestorePbi([del.undoToken]);
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'expired');
  assert.doesNotMatch(files['product_backlog.csv'], /PBI-002/);
  // 正しい鍵なら戻る（対照）
  const good = ctx.apiRestorePbi(del.undoToken);
  assert.equal(good.ok, true, JSON.stringify(good));
});

const IMP_ROW = 'IMP-001,詰まり,説明,alice,2026-01-01,Open,,,';
const impFiles = (extra) => Object.assign({
  'impediment_log.csv': IMP_HEADER + '\n' + IMP_ROW + '\n',
  'impediment_log_resolved.csv': IMP_HEADER + '\n',
}, extra || {});
const impExpected = () => ({ id: 'IMP-001', title: '詰まり', description: '説明', reported_by: 'alice', reported_at: '2026-01-01',
  status: 'Open', resolved_at: '', resolution: '', sprint: '' });
const impFields = (title) => ({ title, description: '説明', reported_by: 'alice', sprint: '' });

// web_app.js withImpedimentWrite_ の catch: `if (open && resolved) Object.assign(out, impedimentPayload_(...))`
test('障害物: 書き込みが失敗した（reason error）ときも、読めた一覧を応答に載せる', () => {
  const { ctx } = createCtx(impFiles(), { failWriteFile: 'impediment_log.csv' });
  const r = ctx.apiCreateImpediment(impFields('新しい'));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'error');
  assert.ok(r.view, '一覧が載っていない');
  assert.deepEqual(JSON.parse(JSON.stringify(r.view.open.map((x) => x.id))), ['IMP-001']);
});

// web_app.js impedimentMessage_ の conflict / not_found（632・633行）
test('障害物の更新: 競合と不在で、それぞれの文面を返す', () => {
  const { ctx } = createCtx(impFiles());
  const stale = Object.assign(impExpected(), { title: '古い題' });
  const c = ctx.apiUpdateImpediment('IMP-001', impFields('直した'), stale);
  assert.equal(c.reason, 'conflict');
  assert.equal(c.message, '他の変更が先に入っています。最新の内容に更新しました。内容を確認し、もう一度保存すると上書きします。');
  const n = ctx.apiUpdateImpediment('IMP-009', impFields('直した'), impExpected());
  assert.equal(n.reason, 'not_found');
  assert.equal(n.message, 'この障害物が見つかりません。最新の内容に更新しました。');
});

// web_app.js apiUpdateImpediment: `if (!v.ok) return { ... reason: 'invalid' ... }`
test('障害物の更新: タイトルが空なら invalid で断り、ファイルを書き換えない', () => {
  const { ctx, files } = createCtx(impFiles());
  const before = files['impediment_log.csv'];
  const r = ctx.apiUpdateImpediment('IMP-001', impFields('  '), impExpected());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.match(r.message, /タイトルを入力してください/);
  assert.equal(files['impediment_log.csv'], before);
});

// web_app.js apiUnresolveImpediment の文面（709・710行）
test('解決の取り消し: 不正な内容と、解決後に変わった行で、それぞれの文面を返す', () => {
  const { ctx } = createCtx(impFiles());
  const res = ctx.apiResolveImpediment('IMP-001', '直した', impExpected());
  assert.equal(res.ok, true, JSON.stringify(res));
  const inv = ctx.apiUnresolveImpediment({ id: 'bad', title: 'x' }, { id: 'bad' });
  assert.equal(inv.reason, 'invalid');
  assert.equal(inv.message, '取り消す内容が不正です。');
  const changed = Object.assign({}, res.resolvedRow, { resolution: '別の解決策' });
  const con = ctx.apiUnresolveImpediment(res.moved, changed);
  assert.equal(con.reason, 'conflict');
  assert.equal(con.message, '解決したあとに他の変更が入っています。取り消しはしません。');
});

// pure_impediment_merge.js appendImpediment: duplicate_id は ok:false
test('appendImpediment: 同じ ID が既にあれば ok:false で断り、行を足さない', () => {
  const { appendImpediment } = require('../pure_impediment_merge.js');
  const r = appendImpediment([{ id: 'IMP-001', title: 'a' }], ' IMP-001 ', { title: 'b', reported_by: 'x' }, '2026-01-01');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duplicate_id');
  assert.equal(r.rows, undefined);
});

// pure_comment.js restoreComment: invalid は ok:false
test('restoreComment: 不正な行は ok:false（invalid）で、rows を返さない', () => {
  const c = require('../pure_comment.js');
  for (const bad of [null, { id: '', target_id: 'PBI-001', body: 'a', created_at: T0 },
    { id: 'CMT-00000001', target_id: 'X-1', body: 'a', created_at: T0 },
    { id: 'CMT-00000001', target_id: 'PBI-001', body: 'a', created_at: ' ' }]) {
    const r = c.restoreComment([], bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    assert.equal(r.reason, 'invalid');
    assert.equal(r.rows, undefined);
  }
});

// pure_comment.js groupComments の並べ替え: 同じ created_at は元の並び順
test('groupComments: 同じ時刻のコメントは CSV の並び順を保つ', () => {
  const c = require('../pure_comment.js');
  const rows = ['CMT-0000000a', 'CMT-0000000b', 'CMT-0000000c'].map((id) => ({ id, target_id: 'PBI-001', author: 'a', created_at: T0, body: id }));
  const g = c.groupComments(rows, 'a');
  assert.deepEqual(g['PBI-001'].map((x) => x.id), ['CMT-0000000a', 'CMT-0000000b', 'CMT-0000000c']);
  assert.deepEqual(c.groupComments(rows.slice(0, 2), 'a')['PBI-001'].map((x) => x.id), ['CMT-0000000a', 'CMT-0000000b']);
});

// pure_csv.js parseCsvWithLines_: `let atFieldStart = true;`（ファイル先頭のセルも引用できる）
test('parseCsv: ファイルの最初のセルが引用されていても読める（BOM 付きでも）', () => {
  const { parseCsv } = require('../pure_csv.js');
  assert.deepEqual(parseCsv('"a,1",b\nc,d\n'), [['a,1', 'b'], ['c', 'd']]);
  assert.deepEqual(parseCsv('﻿"a,1",b\n'), [['a,1', 'b']]);
});

// pure_csv.js csvEndsInsideQuotes: 引用中の `continue` と、先頭の BOM の扱い（`i === 0`）
test('csvEndsInsideQuotes: 引用の中のカンマで状態を崩さない／先頭 BOM の後の引用を引用として数える', () => {
  const { csvEndsInsideQuotes } = require('../pure_csv.js');
  assert.equal(csvEndsInsideQuotes('h\n"a,b"\n'), false);
  assert.equal(csvEndsInsideQuotes('h,i\nx,"a,"\n'), false);
  assert.equal(csvEndsInsideQuotes('﻿"open\n'), true, 'BOM の直後の " は引用の始まり');
  assert.equal(csvEndsInsideQuotes('﻿"closed"\n'), false);
  assert.equal(csvEndsInsideQuotes('h\n"open,\n'), true);
});

// pure_pbi_id.js comparePbiIds: PBI-\d+ 形式でない方を小さいとみなす（66行）
test('comparePbiIds: 形式でない ID は形式の ID より小さく、どちらも形式でなければ等しい', () => {
  const { comparePbiIds } = require('../pure_pbi_id.js');
  assert.equal(comparePbiIds('foo', 'PBI-001'), -1);
  assert.equal(comparePbiIds('PBI-001', 'foo'), 1);
  assert.equal(comparePbiIds('', 'PBI-000'), -1);
  assert.equal(comparePbiIds('foo', 'bar'), 0);
  assert.equal(comparePbiIds(null, undefined), 0);
  assert.equal(comparePbiIds('PBI-010', 'PBI-9'), 1);
});

// ---- scripts/publish.js ----
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function makePubRepo(setup) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-m-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(GAS_DIR, '..', 'scripts', 'publish.js'), path.join(root, 'scripts', 'publish.js'));
  fs.mkdirSync(path.join(root, 'scrum'));
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, 'scrum', 'a.md'), 'a');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'c');
  fs.writeFileSync(path.join(root, 'README.md'), 'r');
  if (setup) setup(root);
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q']);
  git(['add', '-A', '-f', '--', '.']);
  return root;
}
const runPub = (root, args) => spawnSync(process.execPath, [path.join(root, 'scripts', 'publish.js')].concat(args), { encoding: 'utf8' });
const rmAll = (...d) => d.forEach((x) => fs.rmSync(x, { recursive: true, force: true }));

// publish.js main: 引数なし（170行）、配布先なし（176〜178行）
test('publish: 引数なし・存在しない配布先は、使い方／理由を出して終了コード1で止まり、配布先を作らない', () => {
  const root = makePubRepo();
  const missing = path.join(os.tmpdir(), 'bughunt2-m-missing-' + process.pid);
  try {
    const a = runPub(root, []);
    assert.equal(a.status, 1);
    assert.match(a.stderr, /使い方: node scripts\/publish\.js/);
    const b = runPub(root, [missing]);
    assert.equal(b.status, 1);
    assert.match(b.stderr, /配布先フォルダが見つかりません/);
    assert.match(b.stderr, /Drive の共有フォルダを作ってから/);
    assert.equal(fs.existsSync(missing), false, '存在しない配布先を作ってはいけない');
  } finally { rmAll(root, missing); }
});

// publish.js main: 開始と配布記録のログ（192・227行）、スキップ0件なら件数を出さない（225行）
test('publish: 成功時は開始・完了・配布記録を出し、スキップが無ければスキップ件数を書かない', () => {
  const root = makePubRepo();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-m-dest-'));
  try {
    const r = runPub(root, [dest]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /==> 配布します: /);
    assert.match(r.stdout, /==> 完了しました（3 ファイルをコピー）/);
    assert.doesNotMatch(r.stdout, /スキップ/);
    assert.match(r.stdout, /配布記録: .*\.published\.json（/);
  } finally { rmAll(root, dest); }
});

// publish.js main: 追跡されたシンボリックリンクの件数を集計に足す（205行）と警告（114行）
test('publish: 追跡されたシンボリックリンクは配らず、警告し、完了の集計に件数を出す', () => {
  const root = makePubRepo((r) => fs.symlinkSync('a.md', path.join(r, 'scrum', 'link.md')));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-m-dest-'));
  try {
    const r = runPub(root, [dest]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(dest, 'scrum', 'link.md')), false);
    assert.match(r.stderr, /シンボリックリンクのためコピーをスキップしました: .*link\.md/);
    assert.match(r.stdout, /1 件のリンク・通常でないファイルをスキップ/);
  } finally { rmAll(root, dest); }
});

// publish.js main: 配布物の欠け（200行）とコピー失敗（210行）の案内
test('publish: リポジトリに無い配布物はスキップを知らせ、コピーに失敗したら未完了を知らせて終了コード1', () => {
  const root = makePubRepo((r) => fs.rmSync(path.join(r, 'README.md')));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-m-dest-'));
  try {
    const ok = runPub(root, [dest]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stderr, /リポジトリに README\.md が見つかりません。スキップします。/);
    // 配布先の CLAUDE.md がフォルダだと copyFileSync が失敗する
    const dest2 = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-m-dest-'));
    fs.mkdirSync(path.join(dest2, 'CLAUDE.md'));
    const ng = runPub(root, [dest2]);
    rmAll(dest2);
    assert.equal(ng.status, 1);
    assert.match(ng.stderr, /コピー中にエラーが発生しました/);
    assert.match(ng.stderr, /配布は完了していません/);
  } finally { rmAll(root, dest); }
});

// publish.js copyRecursive: 通常でない配布先の警告の文面（145行 `relPath || dest`）
test('copyRecursive: relPath を渡さないとき、通常でない配布先の警告は配布先のパスで始まる', () => {
  const { copyRecursive } = require('../../scripts/publish.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-m-cr-'));
  const src = path.join(dir, 'src.txt');
  const dest = path.join(dir, 'dest.txt');
  fs.writeFileSync(src, 's');
  fs.symlinkSync(src, dest);
  const warns = [];
  const orig = console.warn;
  console.warn = (m) => warns.push(String(m));
  try {
    const r = copyRecursive(src, dest);
    assert.deepEqual(r, { copiedCount: 0, skippedLinkCount: 1 });
  } finally { console.warn = orig; rmAll(dir); }
  assert.equal(warns.length, 1);
  assert.ok(warns[0].startsWith(dest + ' は配布先が通常のファイルではないため'), warns[0]);
});

// web_app.js apiRestoreComment: `if (!r.ok) return { ok: false, reason: 'invalid', ... }`
test('コメントの取り消し: 自分の行でも中身が不正なら invalid で断る（error にしない）', () => {
  const { ctx, files } = createCtx({ 'comments.csv': CMT_HEADER + '\n' });
  const r = ctx.apiRestoreComment({ id: 'CMT-0000000a', target_id: 'XYZ-1', author: 'me@example.com', created_at: T0, body: 'hi' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid');
  assert.equal(r.message, '戻す内容が不正です。');
  assert.equal(files['comments.csv'], CMT_HEADER + '\n');
});
