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
    return { ctx, files, props, fault, setCalls: () => setCalls };
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
