'use strict';
// 2巡目 S: ブラウザから呼べる面（google.script.run）の認可・悪用の検査。
// google.script.run は末尾が `_` でない全グローバル関数を呼べる（pure_*.js も gas_*.js も）。
// ここでは (1) 公開面の棚卸し (2) 付随的に公開される関数の副作用の有無
// (3) api* への敵対的な引数（ロック解放・書かないこと・内部情報を漏らさないこと）
// (4) 取り消しの鍵・コメントの作者の認可 を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const H = require('./bughunt2_S_harness.js');

const plain = H.plain;

// ---------------------------------------------------------------------------
// (1) 公開面の棚卸し
// ---------------------------------------------------------------------------

// 意図して公開している入口（Web アプリ）。
const INTENDED_WEB = ['doGet', 'apiGetView', 'apiUpdateStatus', 'apiCreatePbi', 'apiUpdatePbi', 'apiDeletePbi',
  'apiRestorePbi', 'apiCreateImpediment', 'apiUpdateImpediment', 'apiResolveImpediment', 'apiUnresolveImpediment',
  'apiAddComment', 'apiDeleteComment', 'apiRestoreComment', 'apiGetHistory', 'apiGetComments'];
// メニュー / トリガーのハンドラ（文字列で解決されるため `_` を付けられない。仕様: 副作用より前に getUi を置く）。
const MENU_HANDLERS = ['onOpen', 'menuSyncNow', 'menuConfigure', 'menuInstallTrigger', 'menuRemoveTrigger'];
const TRIGGER_HANDLERS = ['scheduledSync'];

function publicByFile() {
  const all = H.topLevelFunctions();
  const out = {};
  Object.keys(all).forEach((f) => { out[f] = all[f].filter((n) => !/_$/.test(n)); });
  return out;
}

test('S-1: pure_* 以外で公開されている関数は、意図した入口とメニュー/トリガーのハンドラだけ', () => {
  const pub = publicByFile();
  const nonPure = [];
  Object.keys(pub).forEach((f) => { if (!/^pure_/.test(f)) pub[f].forEach((n) => nonPure.push(n)); });
  assert.deepEqual(nonPure.slice().sort(), INTENDED_WEB.concat(MENU_HANDLERS, TRIGGER_HANDLERS).sort(),
    '新しい公開関数が増えた（ブラウザから呼ばれてよいか判断し、そうでなければ末尾に _ を付ける）');
  // web_app.js の公開関数は doGet と api* だけ。
  pub['web_app.js'].forEach((n) => assert.ok(n === 'doGet' || /^api[A-Z]/.test(n), 'web_app.js の付随的な公開関数: ' + n));
  // gas_config / gas_drive / gas_drive_write / gas_sheets / gas_sync は全て非公開（設定・書き込み・同期の本体）。
  ['gas_config.js', 'gas_drive.js', 'gas_drive_write.js', 'gas_sheets.js', 'gas_sync.js'].forEach((f) => {
    assert.deepEqual(pub[f], [], f + ' に公開関数がある: ' + pub[f].join(', '));
  });
});

test('S-2: 静的な列挙と実行時のグローバルが一致する（列挙の漏れが無い）', () => {
  const h = H.createCtx(H.baseFiles());
  const runtime = Object.keys(h.ctx).filter((k) => typeof h.ctx[k] === 'function' && !/_$/.test(k))
    .filter((k) => !/^(DriveApp|LockService|PropertiesService|CacheService|Session|Utilities|SpreadsheetApp|ScriptApp|console)$/.test(k));
  const pub = publicByFile();
  const statics = [].concat.apply([], Object.keys(pub).map((f) => pub[f]));
  assert.deepEqual(runtime.slice().sort(), statics.slice().sort());
});

// ---------------------------------------------------------------------------
// (2) 付随的に公開される関数
// ---------------------------------------------------------------------------

/** 全サービスへのアクセスを記録する Proxy を置いた文脈。pure 関数が何にも触れないことを見る。 */
function trapCtx() {
  const touched = [];
  const trap = (name) => new Proxy(function () {}, {
    get: (t, k) => { touched.push(name + '.' + String(k)); return trap(name + '.' + String(k)); },
    apply: () => { touched.push(name + '()'); return trap(name + '()'); },
  });
  const ctx = { console: { log() {}, error() {}, warn() {} } };
  ['DriveApp', 'LockService', 'PropertiesService', 'CacheService', 'Session', 'Utilities', 'SpreadsheetApp',
    'ScriptApp', 'HtmlService', 'UrlFetchApp', 'MailApp', 'GmailApp'].forEach((s) => { ctx[s] = trap(s); });
  vm.createContext(ctx);
  H.gasFileNames().forEach((n) => vm.runInContext(fs.readFileSync(path.join(H.GAS_DIR, n), 'utf8'), ctx, { filename: n }));
  return { ctx, touched };
}

function globalsSnapshot(ctx) {
  const out = {};
  Object.keys(ctx).forEach((k) => {
    const v = ctx[k];
    if (typeof v === 'function') return;
    try { out[k] = JSON.stringify(v, (key, x) => (x instanceof RegExp ? String(x) : x)); } catch (e) { out[k] = '<unserializable>'; }
  });
  return out;
}

test('S-3: pure_*.js の公開関数は、ブラウザから任意の引数で呼んでも GAS のサービスに触れず、グローバルも変えない', () => {
  const { ctx, touched } = trapCtx();
  const before = globalsSnapshot(ctx);
  const pub = publicByFile();
  const big = 'x'.repeat(5000);
  const argSets = [
    [], [null], [undefined, undefined, undefined], ['', '', ''], [big, big],
    [[], [], []], [[{ id: 'PBI-001', title: 'a', status: 'New', sprint: 's1' }], ['New']],
    [{}, {}, {}], [JSON.parse('{"__proto__":{"polluted":"yes"},"id":"PBI-1"}')],
    ['id,title\nPBI-1,a\n', ['id', 'title']], [123, -1, 1e308], [true, false],
    [[[1, 2], [3]], [['a']]], [['__proto__', 'constructor'], 'constructor'],
  ];
  const names = [];
  Object.keys(pub).filter((f) => /^pure_/.test(f)).forEach((f) => pub[f].forEach((n) => names.push(n)));
  assert.ok(names.length >= 60, '列挙が少なすぎる: ' + names.length);
  names.forEach((n) => {
    argSets.forEach((args) => {
      try { ctx[n].apply(null, args); } catch (e) { /* 例外は呼んだ本人の失敗で終わる。副作用だけを見る */ }
    });
  });
  assert.deepEqual(touched, [], 'pure 関数が GAS のサービスに触れた');
  assert.deepEqual(globalsSnapshot(ctx), before, 'pure 関数がグローバルの値（定数配列など）を書き換えた');
  assert.equal(({}).polluted, undefined, 'プロトタイプ汚染');
  assert.equal(vm.runInContext('({}).polluted', ctx), undefined, 'vm 内のプロトタイプ汚染');
});

test('S-4: メニューのハンドラは Web アプリから呼ぶと getUi で止まり、副作用より前に例外になる', () => {
  MENU_HANDLERS.forEach((name) => {
    const h = H.createCtx(H.baseFiles());
    const filesBefore = JSON.stringify(h.files);
    assert.throws(() => h.ctx[name](), /getUi/, name + ' が例外にならなかった');
    assert.equal(h.log[0], 'SpreadsheetApp.getUi', name + ': getUi より前に何かへ触れた: ' + h.log.join(', '));
    assert.deepEqual(h.log, ['SpreadsheetApp.getUi'], name + ' の副作用: ' + h.log.join(', '));
    assert.equal(JSON.stringify(h.files), filesBefore);
    assert.equal(h.props.SCRUM_FOLDER_ID, 'fake-folder-id', name + ' がフォルダ ID を書き換えた');
    assert.equal(h.triggers.length, 0);
  });
});

test('S-5: doGet は副作用を持たない（HtmlService を呼ぶだけ）', () => {
  const h = H.createCtx(H.baseFiles());
  let called = 0;
  h.ctx.HtmlService = { createHtmlOutputFromFile: () => { called++; const o = { setTitle: () => o, addMetaTag: () => o }; return o; } };
  h.ctx.doGet({ parameter: { x: '<script>' } });
  assert.equal(called, 1);
  assert.deepEqual(h.log, []);
});

// ---------------------------------------------------------------------------
// (3) api* への敵対的な引数
// ---------------------------------------------------------------------------

// google.script.run で送れる値（プリミティブ・配列・素のオブジェクト）。関数・Proxy・Date は送れない。
// ただし「toString という名の文字列キーを持つ素のオブジェクト」は送れ、String() が TypeError を投げる。
function valuePool(rand) {
  const huge = '9'.repeat(3000) + 'x';
  return [
    undefined, null, true, false, 0, -1, 1e308, 0.5, '', ' ', '\u0000', '=HYPERLINK("x")', huge,
    'PBI-001', 'PBI-002', ' PBI-001 ', 'PBI-999', 'PBI-' + '9'.repeat(40), 'IMP-002', 'CMT-aaaaaaaa', 'CMT-bbbbbbbb',
    '__proto__', 'constructor', 'toString', 'New', 'Done', 'Bogus',
    '2026-10-01 00:00:00', '2026-10-01 00:00:01',
    [], ['PBI-001'], [['x']], {}, { toString: 'x' }, { valueOf: 'x', toString: 'y' },
    JSON.parse('{"__proto__":{"polluted":"yes"},"title":"p"}'),
    { title: 'T', status: 'Done', priority: 'High', size: '3', id: 'PBI-777', created_at: '1999', updated_at: 'z' },
    { title: { toString: 'x' } }, { title: ['a', 'b'] }, { title: 'x'.repeat(3000) },
    { id: 'IMP-002', title: '回線が遅い', description: 'd', reported_by: 'alice', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: '' },
    { id: 'CMT-cccccccc', target_id: 'PBI-001', author: 'me@example.com', created_at: 'x', body: 'b' },
    { id: 'CMT-dddddddd', target_id: 'PBI-001', author: 'other@example.com', created_at: 'x', body: 'b' },
    { author: ['me@example.com'], id: 'CMT-eeeeeeee', target_id: 'PBI-001', created_at: 'x', body: 'b' },
    (function deep() { let o = {}; const r = o; for (let i = 0; i < 60; i++) { o.a = {}; o = o.a; } return r; })(),
    String(Math.floor(rand() * 1e9)),
  ];
}

const API_ARITY = {
  apiGetView: 1, apiUpdateStatus: 3, apiCreatePbi: 1, apiUpdatePbi: 3, apiDeletePbi: 2, apiRestorePbi: 1,
  apiCreateImpediment: 1, apiUpdateImpediment: 3, apiResolveImpediment: 3, apiUnresolveImpediment: 2,
  apiAddComment: 2, apiDeleteComment: 1, apiRestoreComment: 1, apiGetHistory: 1,
};

function resetFiles(h) {
  const base = H.baseFiles();
  Object.keys(h.files).forEach((k) => delete h.files[k]);
  Object.assign(h.files, base);
  Object.keys(h.cache).forEach((k) => delete h.cache[k]);
  h.props.LAST_PBI_ID = 'PBI-002';
}

function describe(v) {
  try { return JSON.stringify(v, (k, x) => (typeof x === 'string' && x.length > 40 ? x.slice(0, 40) + '…(' + x.length + ')' : x)); } catch (e) { return String(e); }
}

test('S-6: api* に敵対的な引数を送っても、ロックは必ず解放され、失敗時は何も書かず、内部情報を漏らさない', () => {
  const SEED = 0x5eed5;
  const rand = H.mulberry32(SEED);
  const failures = [];
  Object.keys(API_ARITY).forEach((name) => {
    const h = H.createCtx(H.baseFiles());
    const pool = valuePool(rand);
    for (let iter = 0; iter < 80; iter++) {
      resetFiles(h);
      const args = [];
      for (let i = 0; i < API_ARITY[name]; i++) args.push(pool[Math.floor(rand() * pool.length)]);
      const filesBefore = JSON.stringify(h.files);
      const propsBefore = JSON.stringify(h.props);
      const cacheBefore = JSON.stringify(h.cache);
      const lockBefore = Object.assign({}, h.lockState);
      let res;
      let threw = null;
      try { res = plain(h.ctx[name].apply(null, args)); } catch (e) { threw = e; }
      const where = name + '(' + args.map(describe).join(', ') + ') seed=' + SEED + ' iter=' + iter;
      if (h.lockState.held !== 0 || h.lockState.acquired - lockBefore.acquired !== h.lockState.released - lockBefore.released) {
        failures.push('ロックが解放されていない: ' + where);
      }
      if (threw) {
        // 例外が許されるのは、ロックの外で String() が TypeError を投げる apiGetView / apiGetHistory だけ
        // （呼んだ本人の失敗で終わり、何も書かない）。
        if (!/^apiGet(View|History)$/.test(name)) failures.push('例外が漏れた: ' + where + ' -> ' + threw.message);
        if (JSON.stringify(h.files) !== filesBefore) failures.push('例外なのに書いた: ' + where);
        continue;
      }
      if (!res || typeof res.ok !== 'boolean') { failures.push('応答の形が不正: ' + where + ' -> ' + describe(res)); continue; }
      if (!res.ok) {
        if (JSON.stringify(h.files) !== filesBefore) failures.push('失敗なのに書いた: ' + where + ' -> ' + res.reason);
        if (JSON.stringify(h.props) !== propsBefore) failures.push('失敗なのにプロパティを書いた: ' + where);
        if (JSON.stringify(h.cache) !== cacheBefore) failures.push('失敗なのにキャッシュを書いた: ' + where);
        if (typeof res.message !== 'string') failures.push('message が文字列でない: ' + where);
        else if (/\n\s+at |gas\/|\.js:\d|node:|vm\./.test(res.message)) failures.push('スタック/パスが漏れた: ' + where + ' -> ' + res.message);
      } else {
        // 成功したなら、書いた CSV は全て見出しを保っている。
        Object.keys(h.files).forEach((f) => {
          if (h.files[f] === JSON.parse(filesBefore)[f]) return;
          const first = h.files[f].split('\n', 1)[0];
          const expectHeader = JSON.parse(filesBefore)[f].split('\n', 1)[0];
          if (first !== expectHeader) failures.push('見出しが変わった: ' + f + ' ' + where);
        });
      }
      if (({}).polluted !== undefined || vm.runInContext('({}).polluted', h.ctx) !== undefined) failures.push('プロトタイプ汚染: ' + where);
    }
  });
  assert.deepEqual(failures, [], failures.slice(0, 10).join('\n'));
});

test('S-7: 作成・編集で id / created_at / updated_at / status 以外の申告を信じない（サーバが決める列）', () => {
  const h = H.createCtx(H.baseFiles());
  h.props.LAST_PBI_ID = 'PBI-002';
  const c = plain(h.ctx.apiCreatePbi({ title: 'T', id: 'PBI-777', created_at: '1999-01-01', updated_at: 'zzz', status: 'New' }));
  assert.equal(c.ok, true, describe(c));
  assert.equal(c.id, 'PBI-003');
  assert.ok(h.files['product_backlog.csv'].indexOf('PBI-777') === -1);
  assert.ok(h.files['product_backlog.csv'].indexOf('1999-01-01') === -1);
  const u = plain(h.ctx.apiUpdatePbi('PBI-001', { title: 'A2', id: 'PBI-888', created_at: 'x', updated_at: 'y' }, '2026-10-01 00:00:00'));
  assert.equal(u.ok, true, describe(u));
  assert.ok(h.files['product_backlog.csv'].indexOf('PBI-888') === -1);
  const i = plain(h.ctx.apiCreateImpediment({ title: 'X', reported_by: 'r', id: 'IMP-900', status: 'Resolved', reported_at: '1999', resolution: 'r', resolved_at: '1999' }));
  assert.equal(i.ok, true, describe(i));
  assert.equal(i.id, 'IMP-003');
  const line = h.files['impediment_log.csv'].split('\n').filter((l) => /^IMP-003,/.test(l))[0];
  assert.match(line, /^IMP-003,X,,r,\d{4}-\d{2}-\d{2},Open,,,$/);
});

test('S-8: 閲覧者（Drive に書けない人）が書き込み API を呼んでも、書けず、取り消しの鍵・高水位も残らない', () => {
  const h = H.createCtx(H.baseFiles(), { readOnly: true });
  h.props.LAST_PBI_ID = 'PBI-002';
  const d = plain(h.ctx.apiDeletePbi('PBI-001', '2026-10-01 00:00:00'));
  assert.equal(d.ok, false);
  assert.equal(d.undoToken, undefined);
  assert.deepEqual(Object.keys(h.cache), [], '書けなかった削除の鍵が残った');
  const c = plain(h.ctx.apiCreatePbi({ title: 'x' }));
  assert.equal(c.ok, false);
  assert.equal(h.props.LAST_PBI_ID, 'PBI-002', '書けなかった作成で高水位が進んだ');
  assert.equal(h.lockState.held, 0);
});

test('S-9: ロックが取れないとき、書き込み API は何も読まず何も書かない', () => {
  const h = H.createCtx(H.baseFiles(), { lockBusy: true });
  const before = JSON.stringify(h.files);
  ['apiUpdateStatus', 'apiCreatePbi', 'apiDeletePbi', 'apiRestorePbi', 'apiCreateImpediment', 'apiAddComment', 'apiDeleteComment', 'apiRestoreComment']
    .forEach((n) => assert.equal(plain(h.ctx[n]('PBI-001', 'x', 'y')).reason, 'busy', n));
  assert.equal(JSON.stringify(h.files), before);
  assert.ok(h.log.every((x) => x === 'Lock.tryLock'), h.log.join(','));
});

// ---------------------------------------------------------------------------
// (4) 認可: コメントの作者・取り消しの鍵
// ---------------------------------------------------------------------------

test('S-10: 他人のコメントは消せず、他人の名前でコメントを戻せず、ログインが無ければ何もできない', () => {
  const h = H.createCtx(H.baseFiles());
  const before = h.files['comments.csv'];
  assert.equal(plain(h.ctx.apiDeleteComment('CMT-aaaaaaaa')).reason, 'forbidden');
  assert.equal(plain(h.ctx.apiDeleteComment(' CMT-aaaaaaaa ')).reason, 'forbidden');
  assert.equal(plain(h.ctx.apiRestoreComment({ id: 'CMT-zzzzzzzz', target_id: 'PBI-001', author: 'other@example.com', created_at: 'x', body: 'なりすまし' })).reason, 'forbidden');
  assert.equal(plain(h.ctx.apiRestoreComment({ id: 'CMT-zzzzzzzz', target_id: 'PBI-001', author: 'me@example.com ', created_at: 'x', body: 'b' })).reason, 'forbidden');
  // 他人の既存コメントと同じ id で「戻す」と、上書きはせず何もしない
  const same = plain(h.ctx.apiRestoreComment({ id: 'CMT-aaaaaaaa', target_id: 'PBI-001', author: 'me@example.com', created_at: 'x', body: 'すり替え' }));
  assert.equal(same.ok, true);
  assert.equal(h.files['comments.csv'], before);
  // 本文の上限は戻すときも効く
  assert.equal(plain(h.ctx.apiRestoreComment({ id: 'CMT-yyyyyyyy', target_id: 'PBI-001', author: 'me@example.com', created_at: 'x', body: 'あ'.repeat(2001) })).reason, 'invalid');
  assert.equal(h.files['comments.csv'], before);

  const anon = H.createCtx(H.baseFiles(), { user: '' });
  const anonBefore = anon.files['comments.csv'];
  assert.equal(plain(anon.ctx.apiAddComment('PBI-001', 'x')).reason, 'forbidden');
  assert.equal(plain(anon.ctx.apiDeleteComment('CMT-aaaaaaaa')).reason, 'forbidden');
  assert.equal(plain(anon.ctx.apiRestoreComment({ id: 'CMT-q', target_id: 'PBI-001', author: '', created_at: 'x', body: 'b' })).reason, 'forbidden');
  assert.equal(anon.files['comments.csv'], anonBefore);
});

test('S-11: コメントの作者・時刻・ID はサーバが決める（追加の引数で装えない）', () => {
  const h = H.createCtx(H.baseFiles());
  const r = plain(h.ctx.apiAddComment('PBI-001', 'こんにちは'));
  assert.equal(r.ok, true);
  assert.equal(r.comment.author, 'me@example.com');
  assert.match(r.comment.id, /^CMT-[0-9a-f]{8}$/);
  const hist = h.files['change_log.csv'].trim().split('\n');
  assert.match(hist[hist.length - 1], /,me@example\.com,PBI-001,comment_add,/);
});

function deleteForUndo(h) {
  const d = plain(h.ctx.apiDeletePbi('PBI-001', '2026-10-01 00:00:00'));
  assert.equal(d.ok, true, describe(d));
  return d;
}

test('S-12: 取り消しの鍵は Utilities.getUuid の値そのもの（ID や時刻から作らない）で、鍵だけを受け取る', () => {
  const h = H.createCtx(H.baseFiles());
  const d = deleteForUndo(h);
  assert.match(d.undoToken, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, '鍵が UUID の形でない（推測できる値の恐れ）');
  assert.ok(d.undoToken.indexOf('PBI') === -1);
  // 預かりのキーは undo: + 鍵。行の中身はサーバ側にだけある。
  assert.deepEqual(Object.keys(h.cache), ['undo:' + d.undoToken]);
});

test('S-13: 取り消しの鍵は一度しか使えず、期限が切れたら使えず、形の違う値では何も書かない', () => {
  const h = H.createCtx(H.baseFiles());
  const d = deleteForUndo(h);
  // 形の違う値: 配列に包む・オブジェクト・前後に空白・大文字
  [[d.undoToken], { token: d.undoToken }, ' ' + d.undoToken, d.undoToken.toUpperCase(), null, 123, '', 'undo:' + d.undoToken]
    .forEach((bad) => {
      const before = h.files['product_backlog.csv'];
      const r = plain(h.ctx.apiRestorePbi(bad));
      assert.equal(r.ok, false, describe(bad));
      assert.equal(r.reason, 'expired', describe(bad));
      assert.equal(h.files['product_backlog.csv'], before);
    });
  const r1 = plain(h.ctx.apiRestorePbi(d.undoToken));
  assert.equal(r1.ok, true, describe(r1));
  const after = h.files['product_backlog.csv'];
  const r2 = plain(h.ctx.apiRestorePbi(d.undoToken));
  assert.equal(r2.reason, 'expired', '同じ鍵の2回目が通った');
  assert.equal(h.files['product_backlog.csv'], after);

  const h2 = H.createCtx(H.baseFiles());
  const d2 = deleteForUndo(h2);
  h2.clock.now = 600;   // PBI_UNDO_TTL_SECONDS
  const before = h2.files['product_backlog.csv'];
  assert.equal(plain(h2.ctx.apiRestorePbi(d2.undoToken)).reason, 'expired');
  assert.equal(h2.files['product_backlog.csv'], before);
});

test('S-14: 取り消しの鍵は持参人方式（別の人でも鍵を持っていれば戻せる）。戻るのは預けた行だけで、履歴の記録者は戻した人', () => {
  // 鍵は削除した人のブラウザにしか返らず、UUID で推測できない。戻す内容はサーバが預かった行に限るため、
  // 別の人が使っても「消える前の行が戻る」以上のことは起きない（意図した設計と判断）。
  const files = H.baseFiles();
  const a = H.createCtx(files, { user: 'a@example.com' });
  const d = deleteForUndo(a);
  const b = H.createCtx(files, { user: 'b@example.com' });
  Object.assign(b.cache, a.cache);   // ScriptCache はスクリプト全体で共有
  const r = plain(b.ctx.apiRestorePbi(d.undoToken));
  assert.equal(r.ok, true, describe(r));
  assert.match(files['product_backlog.csv'], /\nPBI-001,A,,,High,,New,,2026-10-01 00:00:00,/);
  const hist = files['change_log.csv'].trim().split('\n');
  assert.match(hist[hist.length - 1], /,b@example\.com,PBI-001,restore,/);
});

test('S-15: 預かった行が改ざんされていても（範囲外の ID・形の違う ID・空タイトル）戻さない', () => {
  const h = H.createCtx(H.baseFiles());
  h.props.LAST_PBI_ID = 'PBI-002';
  const put = (row) => { const t = 'tok-' + Math.random(); h.cache['undo:' + t] = { value: JSON.stringify({ row: row, shared: false }), expiresAt: Infinity }; return t; };
  const before = h.files['product_backlog.csv'];
  [{ id: 'PBI-999', title: 'x' }, { id: 'X-1', title: 'x' }, { id: 'PBI-003', title: '  ' }, { id: '', title: 'x' }]
    .forEach((row) => {
      const r = plain(h.ctx.apiRestorePbi(put(row)));
      assert.equal(r.ok, false, describe(row));
      assert.equal(h.files['product_backlog.csv'], before);
    });
});
