'use strict';
// バグ探しで見つかった応答の順序・途中で止まった操作の回復のバグ（G2）の再現テスト。直したので緑で守る。
const test = require('node:test');
const assert = require('node:assert/strict');
// ---------------------------------------------------------------------------
// テスト用の GAS フェイク（web_app_flow.test.js の createTestContext を写し、障害注入を足したもの）
// fault は可変オブジェクトで、呼び出しの合間に書き換えられる:
//   setContentFailAt: [n, ...]   n 回目（通算、1始まり）の setContent を失敗させる
//   setContentFailNames: [name]  その名前の setContent を失敗させる
//   readThrowNames: [name]       その名前の getFilesByName を例外にする
//   lockBusy: true               tryLock が false を返す
//   user: 'x'                    getActiveUser().getEmail() の値（既定 me@example.com、'' でログイン無し）
//   freezeClock: true            時刻を進めない（同じ秒の書き込み）
// ---------------------------------------------------------------------------
const H = (function () {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const GAS_DIR = path.join(__dirname, '..');
  const PBI_FIELDS = ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint', 'created_at', 'updated_at'];
  const IMP_FIELDS = ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'];
  const CMT_FIELDS = ['id', 'target_id', 'author', 'created_at', 'body'];
  const CHG_FIELDS = ['id', 'at', 'actor', 'target_id', 'action', 'field', 'before', 'after'];
  const PBI_H = PBI_FIELDS.join(',');
  const IMP_H = IMP_FIELDS.join(',');
  const CMT_H = CMT_FIELDS.join(',');
  const CHG_H = CHG_FIELDS.join(',');

  function createCtx(files, fault) {
    fault = fault || {};
    let setCalls = 0;
    let uuidN = 0;
    let clock = Date.UTC(2026, 9, 6, 9, 0, 0);
    function it(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
    function makeFile(name) {
      return {
        getBlob: () => ({ getDataAsString: () => files[name] }),
        setContent: function (content) {
          setCalls++;
          if ((fault.setContentFailAt || []).indexOf(setCalls) !== -1 || (fault.setContentFailNames || []).indexOf(name) !== -1) {
            throw new Error('injected setContent failure #' + setCalls + ' ' + name);
          }
          files[name] = content;
        },
      };
    }
    const scrum = {
      getFilesByName: function (name) {
        if ((fault.readThrowNames || []).indexOf(name) !== -1) throw new Error('injected read failure ' + name);
        return Object.prototype.hasOwnProperty.call(files, name) ? it([makeFile(name)]) : it([]);
      },
      getFolders: () => it([]),
    };
    const root = { getFoldersByName: (n) => (n === 'scrum' ? it([scrum]) : it([])) };
    const props = { SCRUM_FOLDER_ID: 'fake' };
    const cache = {};   // CacheService（取り消しの鍵の預け先）
    const ctx = {
      console,
      DriveApp: { getFolderById: () => root },
      LockService: { getScriptLock: () => ({ tryLock: () => !fault.lockBusy, releaseLock: () => {} }) },
      PropertiesService: { getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null),
        setProperty: (k, v) => { if (fault.setPropFail) throw new Error('injected setProperty failure'); props[k] = v; },
      }) },
      Session: {
        getScriptTimeZone: () => 'UTC',
        getActiveUser: () => ({ getEmail: () => (fault.user === undefined ? 'me@example.com' : fault.user) }),
      },
      CacheService: { getScriptCache: () => ({
        get: (k) => (Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null),
        put: (k, v) => { cache[k] = String(v); },
        remove: (k) => { delete cache[k]; },
      }) },
      Utilities: {
        getUuid: () => { uuidN++; return ('0000000' + uuidN.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
        formatDate: (d) => {
          const p = (n) => (n < 10 ? '0' + n : String(n));
          return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
        },
      },
    };
    vm.createContext(ctx);
    // new Date() は呼ぶたびに1秒進む決定的な時計にする（引数付きはそのまま）。
    const RealDate = Date;
    ctx.Date = function (...a) { if (a.length) return new RealDate(...a); if (!fault.freezeClock) clock += 1000; return new RealDate(clock); };
    ctx.Date.UTC = RealDate.UTC;
    ctx.Date.now = () => clock;
    ctx.Date.prototype = RealDate.prototype;
    fs.readdirSync(GAS_DIR).filter((n) => n.slice(-3) === '.js').sort().forEach((n) => {
      vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), ctx, { filename: n });
    });
    return { ctx, files, props, cache, fault, setCalls: () => setCalls };
  }

  function baseFiles() {
    return {
      'product_backlog.csv': PBI_H + '\n', 'product_backlog_done.csv': PBI_H + '\n',
      'impediment_log.csv': IMP_H + '\n', 'impediment_log_resolved.csv': IMP_H + '\n',
      'comments.csv': CMT_H + '\n', 'change_log.csv': CHG_H + '\n',
    };
  }

  /** vm の値を native に直す（別レルムの配列・オブジェクトを deepEqual で比べるため）。 */
  function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  /** テスト側の独立した RFC4180 パーサ（製品の parseCsv は使わない）。 */
  function parse(text) {
    const src = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let q = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (q) {
        if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch;
        continue;
      }
      if (ch === '"') q = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r' && src[i + 1] === '\n') { /* CRLF は次の \n で区切る */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((c) => c.replace(/\r\n/g, '\n')));
  }
  function rowsOf(text, fields) {
    return parse(text).slice(1).map((r) => { const o = {}; fields.forEach((f, i) => { o[f] = i < r.length ? r[i] : ''; }); return o; });
  }
  function cell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsvText(rows, fields) {
    return [fields.join(',')].concat(rows.map((r) => fields.map((f) => cell(r[f])).join(','))).join('\n') + '\n';
  }

  /** mulberry32 */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return { next, int: (n) => Math.floor(next() * n), pick: (arr) => arr[Math.floor(next() * arr.length)], chance: (p) => next() < p };
  }

  return { createCtx, baseFiles, plain, parse, rowsOf, toCsvText, rng, PBI_FIELDS, IMP_FIELDS, CMT_FIELDS, CHG_FIELDS, PBI_H, IMP_H, CMT_H, CHG_H };
})();

// ---- C-1: 途中で止まった解決・取り消しを逆向きに揃えたときの履歴 ----
const { createCtx, baseFiles, plain, rowsOf, PBI_FIELDS, IMP_FIELDS, CMT_FIELDS, CHG_FIELDS } = H;
const IMP2 = 'IMP-002,止まっている,,マヤ,2026-10-01,Open,,,sprint001\n';
const IMP2_ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const full = (t) => ({ title: t, description: '', acceptance_criteria: '', status: 'New', priority: 'Medium', size: '', sprint: '' });

test('C-1a: 解決が途中で止まり「未解決に戻す」で揃えると、最新の履歴は unresolve になる', () => {
  const f = baseFiles();
  f['impediment_log.csv'] += IMP2;
  const h = createCtx(f, { setContentFailNames: ['impediment_log.csv'] });
  assert.equal(plain(h.ctx.apiResolveImpediment('IMP-002', '直した', IMP2_ROW)).reason, 'partial');
  h.fault.setContentFailNames = [];
  const p = plain(h.ctx.apiGetView('impediment')).view.pending[0];
  const res = plain(h.ctx.apiUnresolveImpediment(p.open, p.resolved));
  assert.equal(res.ok, true);
  assert.ok(f['impediment_log.csv'].indexOf('IMP-002') !== -1, '前提: 未解決に戻った');
  assert.equal(f['impediment_log_resolved.csv'].indexOf('IMP-002'), -1, '前提: 解決済から消えた');
  const last = plain(h.ctx.apiGetHistory('IMP-002')).entries[0];
  assert.equal(last.action, 'unresolve', '最新の履歴が今の状態（未解決）と食い違う: ' + JSON.stringify(last));
});

test('C-1b: 取り消しが途中で止まり「解決済として完了」で揃えると、最新の履歴は resolve になる', () => {
  const f = baseFiles();
  f['impediment_log.csv'] += IMP2;
  const h = createCtx(f);
  const r = plain(h.ctx.apiResolveImpediment('IMP-002', '直した', IMP2_ROW));
  h.fault.setContentFailNames = ['impediment_log_resolved.csv'];
  assert.equal(plain(h.ctx.apiUnresolveImpediment(r.moved, r.resolvedRow)).reason, 'partial');
  h.fault.setContentFailNames = [];
  const p = plain(h.ctx.apiGetView('impediment')).view.pending[0];
  assert.equal(plain(h.ctx.apiResolveImpediment(p.id, p.resolved.resolution, p.open)).ok, true);
  assert.equal(f['impediment_log.csv'].indexOf('IMP-002'), -1, '前提: 未解決から消えた');
  const last = plain(h.ctx.apiGetHistory('IMP-002')).entries[0];
  assert.equal(last.action, 'resolve', '最新の履歴が今の状態（解決済）と食い違う: ' + JSON.stringify(last));
});


test('C-1: 解決が途中で止まり、そのまま「解決済として完了」で揃えたときは resolve を二重に記録しない', () => {
  const f = baseFiles();
  f['impediment_log.csv'] += IMP2;
  const h = createCtx(f, { setContentFailNames: ['impediment_log.csv'] });
  assert.equal(plain(h.ctx.apiResolveImpediment('IMP-002', '直した', IMP2_ROW)).reason, 'partial');
  h.fault.setContentFailNames = [];
  const p = plain(h.ctx.apiGetView('impediment')).view.pending[0];
  assert.equal(plain(h.ctx.apiResolveImpediment(p.id, p.resolved.resolution, p.open)).ok, true);
  const entries = plain(h.ctx.apiGetHistory('IMP-002')).entries;
  assert.deepEqual(entries.map((e) => e.action), ['resolve']);
});

// ---- D: 応答の順序・後始末（実サーバ ＋ 実クライアントの世界で再現する） ----
const W = require('./bughunt_d_world.js');
const F = require('./bughunt_d_fuzzer.js');
function boot() { const w = W.createWorld(); w.boot(); return w; }
const statusOf = (screen, id) => { const c = screen.find((x) => x.cards.includes(id)); return c ? c.status : null; };

test('[D-2] パネルの保存が busy（board: null）で返っても、カードの送信中の印が外れ、ドラッグできる', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-004');
  h.setValue('f-title', 'renamed');
  h.click('panel-save');
  const n = w.pendingNs()[0];
  w.process(n, 'busy');
  w.deliver(n);
  const card = W.collect(w.el('board'), (e) => e.dataset && e.dataset.id === 'PBI-004')[0];
  assert.doesNotMatch(h.cardClassOf('PBI-004'), /\bpending\b/, '送信が終わったのに送信中の印が残っている');
  assert.equal(card.draggable, true, '送信が終わったのにドラッグできない');
});

test('[D-3] パネルを開いたままカードを移し、続けて削除し、両方が通信の失敗で（移動→削除の順に）返ると、カードは移す前の列に戻る', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-003');                   // In Progress
  h.drag('PBI-003', 'New');
  const move = w.pendingNs()[0];
  h.click('panel-delete');
  const del = w.pendingNs()[1];
  w.deliver(move);                         // 未処理のまま失敗
  w.deliver(del);
  assert.equal(statusOf(W.trueBoard(w.server), 'PBI-003'), 'In Progress');
  assert.equal(statusOf(h.screen(), 'PBI-003'), 'In Progress', '両方失敗したのに、移動先の列に出ている');
});

// --- D-1: 発行順で新しいが、サーバでは先に処理された（古い写しの）応答が、先に出した自分の書き込みを消さない ---

test('[D-1] コメント: 2つの PBI へ続けて追加し、サーバが後の方を先に処理しても、先に追加したコメントは消えない', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-001');
  h.setCommentInput('panel-comments', 'first');
  h.clickCommentSend('panel-comments');
  h.openCard('PBI-002');
  h.setCommentInput('panel-comments', 'second');
  h.clickCommentSend('panel-comments');
  const [a, b] = w.pendingNs();
  w.process(b);   // サーバは後の追加を先に処理（ロックを先に取った）
  w.process(a);
  w.deliver(a);   // 発行順に届く
  w.deliver(b);   // b の写しは a を含まない
  assert.equal(W.trueComments(w.server)['PBI-001'].length, 3);
  assert.equal(h.cardCommentCountOf('PBI-001'), 'コメント 3', '自分が追加して成功したコメントが件数から消えた');
});

test('[D-1] コメント: 追加の送信中に自分の古いコメントを消し、サーバが削除を先に処理しても、追加したコメントは一覧に残る', () => {
  const w = boot();
  const h = w.h;
  h.openCard('PBI-001');
  h.setCommentInput('panel-comments', 'new one');
  h.clickCommentSend('panel-comments');
  h.clickCommentDelete('panel-comments', 'CMT-0000000b');   // 送信中でも削除ボタンは押せる
  const [add, del] = w.pendingNs();
  w.process(del);
  w.process(add);
  w.deliver(add);
  w.deliver(del);
  const truth = W.trueComments(w.server)['PBI-001'].map((c) => c.id);
  assert.equal(truth.length, 2);
  assert.deepEqual(h.commentsIn('panel-comments').map((c) => c.id), truth, '追加したコメントが一覧から消えた');
});

test('[D-1] 障害物: IMP-002 を解決した直後に IMP-001 を保存し、サーバが保存を先に処理しても、解決した IMP-002 は未解決に戻らない', () => {
  const w = boot();
  const h = w.h;
  h.clickTab('障害物'); w.drain();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', 'fixed');
  h.click('imp-panel-resolve');            // 解決を確定（送信中）
  h.click('imp-panel-close');
  h.clickImpRow('IMP-001');
  h.setValue('i-title', 'renamed');
  h.click('imp-panel-save');
  const [resolve, save] = w.pendingNs();
  w.process(save);
  w.process(resolve);
  w.deliver(resolve);                      // 「解決しました」と通知が出る
  w.deliver(save);                         // 保存の写しは解決を含まない
  assert.deepEqual(w.impTable(), W.trueImp(w.server), '解決した障害物が未解決の表に戻った');
});

test('[D-1] 盤面: 作成の応答が遅れて届いても、その後に移して確定したカードは作成時の列へ戻らない', () => {
  const w = boot();
  const h = w.h;
  h.clickAdd('New');
  h.setValue('f-title', 'new card');
  h.click('panel-save');
  const create = w.pendingNs()[0];
  w.process(create);                       // サーバでは作成済み（応答は遅れている）
  h.click('panel-close');
  h.click('reload');
  const load = w.pendingNs()[1];
  w.process(load);
  w.deliver(load);                         // 新しいカード PBI-005 が盤面に出る
  h.drag('PBI-005', 'Review');
  const move = w.pendingNs()[1];
  w.process(move);
  w.deliver(move);                         // 「PBI-005 を Review に移しました。」
  w.deliver(create);                       // 遅れた作成の応答（New の写し）
  assert.equal(statusOf(W.trueBoard(w.server), 'PBI-005'), 'Review');
  assert.equal(statusOf(h.screen(), 'PBI-005'), 'Review', '確定した移動が、遅れて届いた作成の応答で巻き戻った');
});

// --- D-4: 「完了する」の通知は、別の経路で完了したら消える ------------------------------------

function partialResolve(w, id) {
  const h = w.h;
  h.clickTab('障害物'); w.drain();
  h.clickImpRow(id);
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', 'fixed');
  h.click('imp-panel-resolve');
  const n = w.pendingNs()[0];
  w.process(n, 'partial');
  w.deliver(n);
}

test('[D-4] 途中で止まった解決を「未解決に戻す」で揃えたら、「完了する」の通知は消える', () => {
  const w = boot();
  const h = w.h;
  partialResolve(w, 'IMP-002');
  assert.equal(h.labelOf('toast-undo'), '完了する');
  h.clickPending('IMP-002', 'unresolve');
  w.drain();
  h.flushTimers();
  assert.deepEqual(W.trueImp(w.server).pending, []);
  assert.ok(W.trueImp(w.server).open.includes('IMP-002:Y'));
  // 通知は Escape でも時間でも消えない。消す手段は「完了する」を押すことだけ。
  assert.ok(h.hiddenOf('toast') || h.labelOf('toast-undo') !== '完了する',
    '未解決に戻したのに「IMP-002 の解決が途中で止まりました。」の通知が残っている');
});

test('[D-4] 途中で止まった解決を「解決済として完了」で揃えたら、「解決しました」の通知が消えた後に「完了する」の通知が戻ってこない', () => {
  const w = boot();
  const h = w.h;
  partialResolve(w, 'IMP-002');
  h.clickPending('IMP-002', 'resolve');
  w.drain();
  h.flushTimers();                          // 「解決しました」の通知が時間で消える
  assert.deepEqual(W.trueImp(w.server).pending, []);
  assert.ok(h.hiddenOf('toast') || h.labelOf('toast-undo') !== '完了する',
    '完了済みなのに「完了する」の通知が戻ってきた（押すと「既に解決済みです」のエラーになる）');
});

// --- 乱択で見つけた失敗の再現（種を固定） --------------------------------------------

const CFG = { steps: 60, busy: 0.1, partial: 0.15, fail: 0.1, strictBoard: true, strictComments: true, strictImp: true };

test('[乱択] コメント（サーバの処理順も乱す）: 種 692 で静止時の件数・一覧がサーバと一致する', () => {
  const r = F.runSeed(692, Object.assign({}, CFG, { ops: ['openCard', 'commentAdd', 'commentAdd', 'commentDelete', 'toastAction', 'historyToggle'] }));
  assert.deepEqual(r.violations || [String(r.error)], []);
});

test('[乱択] 障害物（サーバの処理順も乱す）: 種 498 で静止時の表がサーバと一致する', () => {
  const r = F.runSeed(498, Object.assign({}, CFG, { startTab: '障害物',
    ops: ['impOpen', 'impOpen', 'impAdd', 'impSave', 'impSave', 'impResolve', 'impResolve', 'impCancelResolve', 'impClose',
      'toastAction', 'toastAction', 'timers', 'pending', 'pending'] }));
  assert.deepEqual(r.violations || [String(r.error)], []);
});

test('[乱択] 「完了する」の通知（発行順に処理）: 種 483 で完了済みの操作に通知が残らない', () => {
  const r = F.runSeed(483, Object.assign({}, CFG, { fifoServer: true, checkSticky: true, startTab: '障害物',
    ops: ['impOpen', 'impResolve', 'impResolve', 'impResolve', 'impClose', 'toastAction', 'toastAction', 'timers', 'pending', 'pending', 'pending', 'reload'] }));
  assert.deepEqual(r.violations || [String(r.error)], []);
});

// --- 直したあとの乱択（種 1〜12000）で見つけ、あわせて直したもの ---------------------------

test('[D-1] 盤面: 作成の応答が遅れて届いても、その後に削除して確定したカードは戻らない', () => {
  const w = boot();
  const h = w.h;
  h.clickAdd('In Progress');
  h.setValue('f-title', 'new card');
  h.click('panel-save');
  const create = w.pendingNs()[0];
  w.process(create);                       // サーバでは作成済み（応答は遅れている）
  h.click('panel-close');
  h.click('reload');
  const load = w.pendingNs()[1];
  w.process(load);
  w.deliver(load);                         // PBI-005 が盤面に出る
  h.openCard('PBI-005');
  h.click('panel-delete');
  const del = w.pendingNs()[1];
  w.process(del);
  w.deliver(del);
  w.deliver(create);                       // 遅れた作成の応答（PBI-005 がある写し）
  assert.equal(statusOf(W.trueBoard(w.server), 'PBI-005'), null);
  assert.equal(statusOf(h.screen(), 'PBI-005'), null, '削除が確定したカードが、遅れて届いた作成の応答で戻った');
});

test('[D-1] 障害物: 途中で止まった解決を「完了する」と「途中で止まった操作」から重ねて送らない（どちらが後に処理されたか画面では分からない）', () => {
  const w = boot();
  const h = w.h;
  partialResolve(w, 'IMP-002');
  h.clickPending('IMP-002', 'resolve');    // 送信中
  const n = w.pendingNs().length;
  assert.equal(h.disabledOf('toast-undo'), true, '送信中の障害物の「完了する」を押せる');
  h.click('toast-undo');                   // 「完了する」も押す（塞がっているので何も起きない）
  assert.equal(w.pendingNs().length, n, '同じ障害物の完了を重ねて送った');
  h.clickPending('IMP-002', 'unresolve');  // 塞いだボタンを押せたとしても、送らずに知らせる
  assert.equal(w.pendingNs().length, n, '同じ障害物の取り消しを重ねて送った');
  assert.match(h.textOf('message'), /IMP-002 の操作を送っています/);
  w.drain();
  h.flushTimers();
  assert.deepEqual(w.impTable(), W.trueImp(w.server));
});
