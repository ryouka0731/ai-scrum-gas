'use strict';
// バグ探し C: モデルベースのランダム操作列 + 障害注入。
// web_app.js の公開 API を、実物のコード（vm に全 gas/*.js を読み込む）に対して呼ぶ。
// web_app_flow.test.js の createTestContext を写し、障害注入を足した版を使う（元は触らない）。
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

const { createCtx, baseFiles, plain, rng, parse, rowsOf, PBI_FIELDS, IMP_FIELDS, CMT_FIELDS, CHG_FIELDS } = H;
const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const REASONS = ['busy', 'invalid', 'forbidden', 'not_found', 'conflict', 'error', 'bad_status', 'duplicate_id', 'partial', 'expired'];

// ---------------------------------------------------------------------------
// 共通の検査
// ---------------------------------------------------------------------------

function checkShape(res, label) {
  assert.equal(typeof res, 'object', label + ': 応答がオブジェクトでない');
  assert.ok(res !== null, label + ': 応答が null');
  assert.equal(typeof res.ok, 'boolean', label + ': ok が boolean でない ' + JSON.stringify(res));
  if (!res.ok) {
    assert.ok(REASONS.indexOf(res.reason) !== -1, label + ': 未知の reason ' + JSON.stringify(res));
    assert.equal(typeof res.message, 'string', label + ': message が無い');
    assert.ok(res.message.length > 0, label + ': message が空');
  }
}

/** 6ファイルが全部、正しい見出しで読めること。 */
function checkFilesParse(files, label) {
  const want = {
    'product_backlog.csv': PBI_FIELDS, 'impediment_log.csv': IMP_FIELDS, 'impediment_log_resolved.csv': IMP_FIELDS,
    'comments.csv': CMT_FIELDS, 'change_log.csv': CHG_FIELDS,
  };
  Object.keys(want).forEach((name) => {
    if (files[name] === undefined) return;
    const rows = parse(files[name]);
    assert.deepEqual(rows[0], want[name], label + ': ' + name + ' の見出しが壊れた');
    rows.slice(1).forEach((r, i) => assert.equal(r.length, want[name].length, label + ': ' + name + ' の ' + (i + 2) + ' 行目の列数'));
  });
}

/** change_log の追記分（既存の文字列はバイト単位で残ること）。 */
function newHistoryRows(before, after, label) {
  if (before === after) return [];
  const prefix = before === undefined ? '' : before;
  const base = prefix === '' || /\n$/.test(prefix) ? prefix : prefix + '\n';
  if (prefix.trim() === '') return rowsOf(after, CHG_FIELDS);
  assert.ok(after.startsWith(base), label + ': change_log の既存部分が書き換わった');
  return rowsOf(H.CHG_H + '\n' + after.slice(base.length), CHG_FIELDS);
}

function checkHistoryRowsShape(rows, actor, label) {
  const ats = {};
  rows.forEach((r) => {
    assert.match(r.id, /^CHG-[0-9a-f]{8}$/, label + ': 履歴 id の形');
    assert.match(r.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, label + ': 履歴 at の形');
    assert.equal(r.actor, actor, label + ': actor');
    assert.match(r.target_id, /^(PBI|IMP)-\d+$/, label + ': target_id の形 ' + JSON.stringify(r));
    assert.notEqual(r.field, 'updated_at', label + ': updated_at を記録した');
    assert.notEqual(r.field, 'created_at', label + ': created_at を記録した');
    if (r.action !== 'update') assert.deepEqual([r.field, r.before, r.after], ['', '', ''], label + ': update 以外に項目が付いた');
    ats[r.at] = true;
  });
  assert.ok(Object.keys(ats).length <= 1, label + ': 1回の書き込みの at が揃っていない');
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, label + ': 履歴 id が重複');
}

/** 自前の差分（行は id で一意な前提）。 */
function myDiff(before, after, fields, ignore) {
  const out = [];
  const b = new Map(before.map((r) => [r.id.trim(), r]));
  const a = new Map(after.map((r) => [r.id.trim(), r]));
  after.forEach((r) => {
    const id = r.id.trim();
    if (!b.has(id)) { out.push({ target_id: id, action: 'create', field: '', before: '', after: '' }); return; }
    fields.forEach((f) => {
      if (f === 'id' || ignore.indexOf(f) !== -1) return;
      if (b.get(id)[f] !== r[f]) out.push({ target_id: id, action: 'update', field: f, before: b.get(id)[f], after: r[f] });
    });
  });
  before.forEach((r) => { if (!a.has(r.id.trim())) out.push({ target_id: r.id.trim(), action: 'delete', field: '', before: '', after: '' }); });
  return out;
}
function evKey(e) { return [e.target_id, e.action, e.field, e.before, e.after].join('|'); }

// ---------------------------------------------------------------------------
// 1. PBI のモデルベース・ランダム試験
// ---------------------------------------------------------------------------

function validPbi(f) {
  if (String(f.title == null ? '' : f.title).trim() === '') return false;
  if (f.priority !== undefined && PRIORITIES.indexOf(String(f.priority)) === -1) return false;
  if (f.status !== undefined && STATUSES.indexOf(String(f.status)) === -1) return false;
  const s = String(f.size == null ? '' : f.size).trim();
  if (f.size !== undefined && s !== '' && !/^\d+$/.test(s)) return false;
  return true;
}

function randText(r) {
  return r.pick(['', 'a', 'カンマ,入り', '改行\nあり', '"引用"', ' 前後空白 ', 'CRLF\r\nあり', '=SUM(1)', 'x'.repeat(r.int(300) + 1), '🙂絵文字']);
}

function randPbiFields(r) {
  const f = {
    title: r.chance(0.85) ? r.pick(['タイトル', 'T' + r.int(1000), 'カンマ,題', '改行\n題']) : r.pick(['', '  ', null]),
    description: randText(r), acceptance_criteria: randText(r),
    priority: r.chance(0.9) ? r.pick(PRIORITIES) : r.pick(['high', 'Urgent', '']),
    size: r.chance(0.9) ? r.pick(['', '0', '3', '13']) : r.pick(['1.5', '-1', 'abc']),
    status: r.chance(0.9) ? r.pick(STATUSES) : r.pick(['Doing', 'new']),
    sprint: r.pick(['', 'sprint001', 'Sprint 2']),
  };
  if (r.chance(0.1)) f.id = 'PBI-999';          // 編集不可の列は捨てられるべき
  if (r.chance(0.1)) f.updated_at = 'x';
  if (r.chance(0.1)) f.unknown_col = 'y';
  return f;
}

/** モデルの行（全列）。 */
function pbiModelRows(files) { return rowsOf(files['product_backlog.csv'], PBI_FIELDS); }

function runPbiSeed(seed, steps) {
  const r = rng(seed);
  const files = baseFiles();
  const fault = {};
  const h = createCtx(files, fault);
  const model = new Map();        // id -> row（全列、文字列）
  const deleted = [];             // 取り消し候補（removed）
  let maxEverId = 0;              // アプリがこれまでに見た最大の番号（再利用の検査）
  const maxIdOf = (list) => list.reduce((m, x) => Math.max(m, Number((/^PBI-(\d+)$/.exec(x.id) || [])[1] || 0)), 0);
  const trace = [];

  const modelRows = () => Array.from(model.values());
  const assertModel = (label) => {
    const fileRows = pbiModelRows(files);
    const norm = (x) => JSON.stringify(PBI_FIELDS.map((f) => x[f]));
    const got = fileRows.map(norm).sort();
    const want = modelRows().map(norm).sort();
    assert.deepEqual(got, want, label + ': ファイルとモデルが食い違う');
    const ids = fileRows.map((x) => x.id.trim());
    assert.equal(new Set(ids).size, ids.length, label + ': ID が重複した');
  };

  for (let step = 0; step < steps; step++) {
    // 障害を決める
    Object.keys(fault).forEach((k) => delete fault[k]);
    const fk = r.int(10);
    let mainFault = false;
    let histFault = false;
    if (fk === 0) fault.lockBusy = true;
    else if (fk === 1) { fault.setContentFailNames = ['product_backlog.csv']; mainFault = true; }
    else if (fk === 2) { fault.setContentFailNames = ['change_log.csv']; histFault = true; }
    else if (fk === 3) { fault.readThrowNames = ['change_log.csv']; histFault = true; }
    else if (fk === 4) { fault.readThrowNames = ['product_backlog_done.csv']; }   // best-effort の読み取り
    if (r.chance(0.15)) fault.user = r.pick(['', 'you@example.com']);
    const actor = fault.user === undefined ? 'me@example.com' : fault.user;

    // ローカルの Claude Code の直接編集（Web アプリの外）
    if (r.chance(0.2)) {
      const kind = r.int(4);
      const rows = modelRows();
      if (kind === 0) {
        // BOM + CRLF で書き直す（内容は同じ）
        files['product_backlog.csv'] = '\uFEFF' + H.toCsvText(rows, PBI_FIELDS).replace(/\n/g, '\r\n');
        trace.push('ext:bom-crlf');
      } else if (kind === 1 && rows.length) {
        const row = r.pick(rows);
        row.description = 'ローカルで,書いた\n2行目';
        row.updated_at = '2026-10-0' + (1 + r.int(9));   // 日付だけで書く
        files['product_backlog.csv'] = H.toCsvText(modelRows(), PBI_FIELDS);
        trace.push('ext:edit ' + row.id);
      } else if (kind === 2) {
        // アプリがまだ見ていない ID は maxEverId に入れない（見る前に外で消されたら、アプリは知りようがなく
        // 再利用しうる。web_app.js の advanceLastPbiIdWatermark_ の仕様）。見たかどうかは各操作の後で数える。
        const n = Math.max(maxEverId, maxIdOf(rows)) + 1 + r.int(3);
        const id = 'PBI-' + String(n).padStart(3, '0');
        model.set(id, { id, title: '外で作った', description: '', acceptance_criteria: '', priority: 'Low', size: '', status: 'New', sprint: '', created_at: '2026-10-01', updated_at: '2026-10-01' });
        files['product_backlog.csv'] = H.toCsvText(modelRows(), PBI_FIELDS).replace(/\n$/, '');   // 末尾改行なし
        trace.push('ext:add ' + id);
      } else if (rows.length) {
        const row = r.pick(rows);
        model.delete(row.id);
        files['product_backlog.csv'] = H.toCsvText(modelRows(), PBI_FIELDS);
        trace.push('ext:remove ' + row.id);
      }
    }

    const snapshot = Object.assign({}, files);
    const rows = modelRows();
    const op = r.int(7);
    let res;
    let expect;            // { ok, reason } の予測
    let label;
    let apply = null;      // 成功時にモデルへ反映する
    let histAction = null;

    if (op === 0) {
      const f = randPbiFields(r);
      label = 'create ' + JSON.stringify(f);
      expect = validPbi(Object.assign({ status: 'New' }, f)) ? { ok: true } : { ok: false, reason: 'invalid' };
      res = h.ctx.apiCreatePbi(f);
      apply = () => {
        const n = Number(/^PBI-(\d+)$/.exec(res.id)[1]);
        assert.ok(n > maxEverId, label + ': 採番が既存/過去の ID を再利用した ' + res.id + ' <= ' + maxEverId);
        maxEverId = n;
        const fileRow = pbiModelRows(files).find((x) => x.id === res.id);
        assert.ok(fileRow, label + ': 作った行がファイルに無い');
        const want = { id: res.id, created_at: fileRow.created_at, updated_at: fileRow.updated_at };
        ['title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint'].forEach((k) => {
          want[k] = f[k] === undefined || f[k] === null ? '' : String(f[k]).replace(/\r\n/g, '\n');
        });
        if (f.status === undefined) want.status = 'New';
        assert.equal(fileRow.created_at, fileRow.updated_at, label + ': 作成時の created_at と updated_at');
        model.set(res.id, want);
      };
      histAction = 'create';
    } else if (op === 1 || op === 2) {
      const target = rows.length && r.chance(0.85) ? r.pick(rows) : null;
      const id = target ? (r.chance(0.1) ? ' ' + target.id + ' ' : target.id) : r.pick(['PBI-998', 'IMP-002', '', null, 123]);
      const stale = r.chance(0.15);
      const exp = target ? (stale ? '2000-01-01 00:00:00' : target.updated_at) : 'x';
      if (op === 1) {
        const st = r.chance(0.9) ? r.pick(STATUSES) : r.pick(['Doing', null, ['New']]);
        label = 'status ' + JSON.stringify([id, st, exp]);
        if (STATUSES.indexOf(st) === -1) expect = { ok: false, reason: 'bad_status' };
        else if (!target) expect = { ok: false, reason: 'not_found' };
        else if (stale && exp !== target.updated_at) expect = { ok: false, reason: 'conflict' };
        else expect = { ok: true };
        res = h.ctx.apiUpdateStatus(id, st, exp);
        apply = () => {
          const fileRow = pbiModelRows(files).find((x) => x.id === target.id);
          assert.ok(fileRow.updated_at > target.updated_at, label + ': updated_at が進んでいない');
          model.set(target.id, Object.assign({}, target, { status: st, updated_at: fileRow.updated_at }));
        };
      } else {
        const f = randPbiFields(r);
        label = 'update ' + JSON.stringify([id, f, exp]);
        if (!validPbi(f)) expect = { ok: false, reason: 'invalid' };
        else if (!target) expect = { ok: false, reason: 'not_found' };
        else if (stale && exp !== target.updated_at) expect = { ok: false, reason: 'conflict' };
        else expect = { ok: true };
        res = h.ctx.apiUpdatePbi(id, f, exp);
        apply = () => {
          const fileRow = pbiModelRows(files).find((x) => x.id === target.id);
          assert.ok(fileRow.updated_at > target.updated_at, label + ': updated_at が進んでいない');
          const next = Object.assign({}, target, { updated_at: fileRow.updated_at });
          ['title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint'].forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(f, k)) next[k] = f[k] === null ? '' : String(f[k]).replace(/\r\n/g, '\n');
          });
          model.set(target.id, next);
        };
      }
      histAction = 'update';
    } else if (op === 3 || op === 4) {
      const target = rows.length && r.chance(0.85) ? r.pick(rows) : null;
      const id = target ? target.id : r.pick(['PBI-998', '', null, {}]);
      const stale = r.chance(0.15);
      const exp = target ? (stale ? 'old' : target.updated_at) : 'x';
      label = 'delete ' + JSON.stringify([id, exp]);
      if (!target) expect = { ok: false, reason: 'not_found' };
      else if (stale) expect = { ok: false, reason: 'conflict' };
      else expect = { ok: true };
      res = h.ctx.apiDeletePbi(id, exp);
      apply = () => {
        assert.deepEqual(plain(res.removed), target, label + ': removed が消した行と違う');
        model.delete(target.id);
        // 取り消しは鍵（undoToken）で行う。サーバが預かった行だけが戻る。
        assert.equal(typeof res.undoToken, 'string', label + ': undoToken が無い');
        deleted.push({ row: plain(res.removed), token: res.undoToken, used: false });
      };
      histAction = 'delete';
    } else if (op === 5 && deleted.length) {
      const held = r.pick(deleted);
      const row = held.row;
      label = 'restore ' + row.id + (held.used ? ' [used]' : '');
      const exists = model.has(row.id);
      // 鍵は一度しか使えない。使った鍵は expired、まだなら同じ ID が今あれば重複。
      expect = held.used ? { ok: false, reason: 'expired' } : exists ? { ok: false, reason: 'duplicate_id' } : { ok: true };
      res = h.ctx.apiRestorePbi(held.token);
      apply = () => {
        const fileRow = pbiModelRows(files).find((x) => x.id === row.id);
        assert.ok(fileRow, label + ': 戻した行が無い');
        assert.equal(fileRow.created_at, row.created_at, label + ': created_at が保たれない');
        model.set(row.id, Object.assign({}, row, { updated_at: fileRow.updated_at }));
        held.used = true;
      };
      histAction = 'restore';
    } else {
      // 不正な引数での取り消し（行の中身・知らない鍵・型の違う値）。どれも預かった行が無いので expired。
      const bad = r.pick([null, 'PBI-001', [], { id: 'PBI-99999', title: 'でっち上げ' }, { id: 'IMP-002', title: 'x' },
        { id: 'PBI-000', title: 'x' }, { title: 'id なし' }, { id: 'PBI-001' }, 'undo:x', 'ffffffff-0000-4000-8000-000000000000', 123]);
      label = 'restore-bad ' + JSON.stringify(bad);
      expect = { ok: false, reason: 'expired' };
      res = h.ctx.apiRestorePbi(bad);
      apply = () => { throw new Error(label + ': 預かっていない取り消しが通った'); };
      histAction = 'restore';
    }

    trace.push(label + (fault.lockBusy ? ' [busy]' : '') + (mainFault ? ' [main-fail]' : '') + (histFault ? ' [hist-fail]' : ''));
    const ctxLabel = 'seed=' + seed + ' step=' + step + ' ' + label + '\n  trace: ' + trace.slice(-6).join('\n         ');
    // ロックが取れた書き込みは、その時点のファイルを読んで高水位を進める（ここで外の ID を見たことになる）。
    if (!fault.lockBusy) maxEverId = Math.max(maxEverId, maxIdOf(rows));
    res = plain(res);
    checkShape(res, ctxLabel);
    checkFilesParse(files, ctxLabel);

    if (fault.lockBusy) {
      assert.equal(res.reason, 'busy', ctxLabel);
      assert.deepEqual(files, snapshot, ctxLabel + ': busy なのにファイルが変わった');
      continue;
    }
    if (!expect.ok || mainFault) {
      assert.equal(res.ok, false, ctxLabel + ': 失敗するはずが成功 ' + JSON.stringify(res).slice(0, 300));
      if (expect.reason && !mainFault) assert.equal(res.reason, expect.reason, ctxLabel);
      if (mainFault && expect.ok) assert.equal(res.reason, 'error', ctxLabel);
      assert.deepEqual(files, snapshot, ctxLabel + ': 失敗なのにファイルが変わった');
      assert.equal(res.historyWarning, undefined, ctxLabel);
      continue;
    }
    assert.equal(res.ok, true, ctxLabel + ': 成功するはずが失敗 ' + JSON.stringify(res).slice(0, 300));
    const beforeRows = rowsOf(snapshot['product_backlog.csv'], PBI_FIELDS);
    apply();
    assertModel(ctxLabel);
    const afterRows = pbiModelRows(files);
    let events = myDiff(beforeRows, afterRows, PBI_FIELDS, ['updated_at', 'created_at']);
    if (histAction === 'restore') events = events.map((e) => Object.assign({}, e, { action: e.action === 'create' ? 'restore' : e.action }));
    const added = newHistoryRows(snapshot['change_log.csv'], files['change_log.csv'], ctxLabel);
    if (histFault && events.length) {
      assert.equal(files['change_log.csv'], snapshot['change_log.csv'], ctxLabel + ': 履歴の障害なのに書けている');
      assert.ok(res.historyWarning && res.historyWarning.indexOf('変更履歴を記録できませんでした') === 0, ctxLabel + ': historyWarning が無い');
    } else {
      assert.equal(res.historyWarning, undefined, ctxLabel + ': 余計な historyWarning ' + res.historyWarning);
      assert.deepEqual(added.map(evKey), events.map(evKey), ctxLabel + ': 履歴がファイルの差分と合わない');
      checkHistoryRowsShape(added, actor, ctxLabel);
    }
    // 盤面は書いた行から作られている（placeholder を除く全行）
    const boardIds = [];
    res.board.columns.forEach((c) => c.cards.forEach((card) => boardIds.push(card.id)));
    assert.deepEqual(boardIds.sort(), afterRows.filter((x) => x.title.trim()).map((x) => x.id).sort(), ctxLabel + ': 応答の盤面がファイルと違う');
  }
}

// 乱択の量。既定は npm test を速く保つ少なさにし、多く回すのは npm run test:stress（BUGHUNT_STRESS=1）だけ。
const STRESS = process.env.BUGHUNT_STRESS === '1';
const SEEDS = STRESS ? { pbi: 600, comment: 600, imp: 400 } : { pbi: 20, comment: 20, imp: 15 };

test('C: PBI のランダム操作列（外部編集・障害注入あり）でモデル・ファイル・履歴が一致する', () => {
  for (let seed = 1; seed <= SEEDS.pbi; seed++) runPbiSeed(seed, 60);
});

// ---------------------------------------------------------------------------
// 2. コメントのモデルベース・ランダム試験（複数の利用者・ログイン無し）
// ---------------------------------------------------------------------------

function runCommentSeed(seed, steps) {
  const r = rng(seed);
  const files = baseFiles();
  const fault = {};
  const h = createCtx(files, fault);
  let model = [];            // comments.csv の行
  const removedPool = [];    // 削除で返った行（誰が消したかも持つ）
  const bodies = [];
  const trace = [];

  for (let step = 0; step < steps; step++) {
    Object.keys(fault).forEach((k) => delete fault[k]);
    const users = ['me@example.com', 'you@example.com', ''];
    fault.user = r.pick(users);
    const me = fault.user;
    const fk = r.int(10);
    let mainFault = false;
    let histFault = false;
    if (fk === 0) fault.lockBusy = true;
    else if (fk === 1) { fault.setContentFailNames = ['comments.csv']; mainFault = true; }
    else if (fk === 2) { fault.setContentFailNames = ['change_log.csv']; histFault = true; }

    // エージェントの追記（CRLF、author はエージェント名）
    if (r.chance(0.15)) {
      const row = { id: 'CMT-' + (0xa0000000 + step).toString(16), target_id: 'PBI-00' + (1 + r.int(3)), author: 'scrum-master-kenji', created_at: '2026-10-06 08:00:00', body: 'エージェント,の\n返答' };
      model.push(row);
      files['comments.csv'] = H.toCsvText(model, CMT_FIELDS).replace(/\n/g, '\r\n');
      trace.push('ext:agent-comment');
    }

    const snapshot = Object.assign({}, files);
    const op = r.int(5);
    let res;
    let expect;
    let label;
    let apply = () => {};
    let histEvent = null;
    let restoreTarget = '';
    if (op === 0 || op === 1) {
      const target = r.chance(0.85) ? r.pick(['PBI-001', 'PBI-002', ' IMP-003 ']) : r.pick(['CMT-00000001', 'PBI-', '', null, 7, ['PBI-001']]);
      const body = r.chance(0.85) ? 'BODY-' + seed + '-' + step + r.pick(['', ',カンマ', '\r\n改行', '"引用"']) : r.pick(['', '   ', 'あ'.repeat(2001), null]);
      label = 'add ' + JSON.stringify([target, String(body).slice(0, 40), me]);
      const tOk = /^(PBI|IMP)-\d+$/.test(String(target == null ? '' : target).trim());
      const b = body == null ? '' : String(body);
      const bOk = b.trim() !== '' && Array.from(b).length <= 2000;
      if (!me) expect = { ok: false, reason: 'forbidden' };
      else if (!tOk || !bOk) expect = { ok: false, reason: 'invalid' };
      else expect = { ok: true };
      res = h.ctx.apiAddComment(target, body);
      apply = () => {
        const c = plain(res.comment);
        assert.match(c.id, /^CMT-[0-9a-f]{8}$/);
        assert.equal(c.author, me);
        assert.equal(c.target_id, String(target).trim());
        model.push({ id: c.id, target_id: c.target_id, author: me, created_at: c.created_at, body: b.replace(/\r\n/g, '\n') });
        bodies.push(b.replace(/\r\n/g, '\n'));
        histEvent = { target_id: c.target_id, action: 'comment_add', field: '', before: '', after: '' };
      };
    } else if (op === 2 || op === 3) {
      const target = model.length && r.chance(0.85) ? r.pick(model) : null;
      const id = target ? target.id : r.pick(['CMT-ffffffff', '', null, {}]);
      label = 'delete ' + JSON.stringify([id, me]);
      if (!target) expect = { ok: false, reason: 'not_found' };
      else if (!me || target.author !== me) expect = { ok: false, reason: 'forbidden' };
      else expect = { ok: true };
      res = h.ctx.apiDeleteComment(id);
      apply = () => {
        assert.deepEqual(plain(res.removed), target, label + ': removed');
        model = model.filter((x) => x !== target);
        removedPool.push(target);
        histEvent = { target_id: target.target_id.trim(), action: 'comment_delete', field: '', before: '', after: '' };
      };
    } else {
      // 取り消し: 消した行そのもの、または他人名義・改ざん
      let row = removedPool.length ? Object.assign({}, r.pick(removedPool)) : { id: 'CMT-00000abc', target_id: 'PBI-001', author: me, created_at: '2026-10-06 10:00:00', body: 'x' };
      if (r.chance(0.2)) row.author = r.pick(['you@example.com', 'me@example.com', '']);
      if (r.chance(0.1)) row.created_at = 'yesterday';
      label = 'restore ' + JSON.stringify([row.id, row.author, me]);
      restoreTarget = String(row.target_id).trim();
      const exists = model.some((x) => x.id === row.id);
      if (!me || row.author !== me) expect = { ok: false, reason: 'forbidden' };
      // 日時は形を問わず、空だけを拒む（削除できた行は戻せる。G1 C-5 の修正）
      else if (!String(row.created_at).trim()) expect = { ok: false, reason: 'invalid' };
      else expect = { ok: true, unchanged: exists };
      res = h.ctx.apiRestoreComment(row);
      apply = () => {
        if (expect.unchanged) return;
        // target_id は appendComment と同じく前後の空白を落として保存される（G1 B2 の修正）
        model.push(Object.assign({}, row, { target_id: String(row.target_id).trim() }));
        histEvent = { target_id: row.target_id.trim(), action: 'comment_restore', field: '', before: '', after: '' };
      };
    }
    trace.push(label + (fault.lockBusy ? ' [busy]' : '') + (mainFault ? ' [main-fail]' : '') + (histFault ? ' [hist-fail]' : ''));
    const ctxLabel = 'seed=' + seed + ' step=' + step + ' ' + label + '\n  trace: ' + trace.slice(-6).join('\n         ');
    res = plain(res);
    checkShape(res, ctxLabel);
    checkFilesParse(files, ctxLabel);
    if (fault.lockBusy) {
      assert.equal(res.reason, 'busy', ctxLabel);
      assert.deepEqual(files, snapshot, ctxLabel);
      continue;
    }
    if (expect.unchanged) mainFault = false;   // 既にある行の取り消しは何も書かない
    if (!expect.ok || mainFault) {
      assert.equal(res.ok, false, ctxLabel + ' ' + JSON.stringify(res).slice(0, 200));
      if (!mainFault || !expect.ok) assert.equal(res.reason, expect.reason, ctxLabel);
      assert.deepEqual(files, snapshot, ctxLabel + ': 失敗なのにファイルが変わった');
      continue;
    }
    assert.equal(res.ok, true, ctxLabel + ' ' + JSON.stringify(res).slice(0, 300));
    apply();
    assert.deepEqual(rowsOf(files['comments.csv'], CMT_FIELDS).map((x) => JSON.stringify(x)).sort(),
      model.map((x) => JSON.stringify(x)).sort(), ctxLabel + ': comments.csv とモデルが違う');
    // 応答の comments はその対象の一覧（2巡目 H2 の P2 から）。件数は count、mine は本人のものだけ
    const opTarget = op <= 1 ? String(res.comment.target_id) : op <= 3 ? String(res.removed.target_id).trim() : restoreTarget;
    const inTarget = model.filter((x) => String(x.target_id).trim() === opTarget);
    assert.equal(res.targetId, opTarget, ctxLabel + ': 応答の targetId');
    assert.equal(res.comments.length, inTarget.length, ctxLabel + ': 応答の comments の件数');
    assert.equal(res.count, inTarget.length, ctxLabel + ': 応答の count');
    res.comments.forEach((c) => assert.equal(c.mine, !!me && c.author === me, ctxLabel + ': mine'));
    res.comments.forEach((c) => assert.equal(c.target_id, opTarget, ctxLabel + ': 他の対象のコメント'));
    const added = newHistoryRows(snapshot['change_log.csv'], files['change_log.csv'], ctxLabel);
    if (!histEvent) {
      assert.deepEqual(added, [], ctxLabel + ': 何も書かないのに履歴が増えた');
    } else if (histFault) {
      assert.deepEqual(added, [], ctxLabel);
      assert.ok(res.historyWarning, ctxLabel + ': historyWarning が無い');
    } else {
      assert.equal(res.historyWarning, undefined, ctxLabel);
      assert.deepEqual(added.map(evKey), [evKey(histEvent)], ctxLabel + ': コメントの履歴');
      checkHistoryRowsShape(added, me, ctxLabel);
    }
    bodies.forEach((b) => { if (b.length > 6) assert.equal(files['change_log.csv'].indexOf(b), -1, ctxLabel + ': 本文が履歴に残った'); });
  }
}

test('C: コメントのランダム操作列（3人・ログイン無し・障害注入）で権限・ファイル・履歴が一致する', () => {
  for (let seed = 1; seed <= SEEDS.comment; seed++) runCommentSeed(seed, 50);
});

// ---------------------------------------------------------------------------
// 3. 障害物のランダム試験（部分書き込みは「完了する」で回復できること）
// ---------------------------------------------------------------------------

function runImpedimentSeed(seed, steps) {
  const r = rng(seed);
  const files = baseFiles();
  files['impediment_log.csv'] += 'IMP-001,（障害物タイトル）,（詳細説明）,（報告者）,YYYY-MM-DD,Open,,（解決策）,sprint001\n';
  files['impediment_log_resolved.csv'] += 'IMP-001,（障害物タイトル）,（詳細説明）,（報告者）,YYYY-MM-DD,Open,,（解決策）,sprint001\n';
  const fault = {};
  const h = createCtx(files, fault);
  const undo = [];
  const everIds = new Set();
  const trace = [];
  const realIds = (name) => rowsOf(files[name], IMP_FIELDS).filter((x) => x.title.charAt(0) !== '（').map((x) => x.id);

  for (let step = 0; step < steps; step++) {
    Object.keys(fault).forEach((k) => delete fault[k]);
    const fk = r.int(10);
    if (fk === 0) fault.lockBusy = true;
    else if (fk === 1) fault.setContentFailAt = [h.setCalls() + 1];          // 1つ目の書き込み
    else if (fk === 2) fault.setContentFailAt = [h.setCalls() + 2];          // 2つ目（障害物の2ファイル目か履歴）
    else if (fk === 3) fault.setContentFailNames = ['change_log.csv'];

    const view = plain(h.ctx.apiGetView('impediment'));
    assert.equal(view.ok, true);
    const snapshot = Object.assign({}, files);
    const op = r.int(5);
    let res;
    let label;
    let usedUndo = null;   // 未解決に戻すときに送った組（「完了する」は同じ組で送り直す）
    if (op === 0) {
      const f = { title: r.chance(0.9) ? '障害' + step : r.pick(['', '（括弧）']), description: randText(r), reported_by: r.chance(0.9) ? 'マヤ' : ' ', sprint: r.pick(['', 'sprint001']) };
      label = 'create ' + JSON.stringify(f).slice(0, 80);
      res = plain(h.ctx.apiCreateImpediment(f));
      if (res.ok) {
        assert.ok(!everIds.has(res.id), label + ': 障害物 ID を再利用した ' + res.id);
        everIds.add(res.id);
      }
    } else if (op === 1 && view.view.open.length) {
      const row = r.pick(view.view.open);
      const exp = r.chance(0.15) ? Object.assign({}, row, { title: '古い' }) : row;
      label = 'update ' + row.id;
      res = plain(h.ctx.apiUpdateImpediment(row.id, { title: row.title + '!', description: 'x,y\nz', reported_by: row.reported_by, sprint: row.sprint }, exp));
    } else if (op === 2 && view.view.open.length) {
      const row = r.pick(view.view.open);
      label = 'resolve ' + row.id;
      res = plain(h.ctx.apiResolveImpediment(row.id, r.chance(0.9) ? '直した,\n2行' : '  ', row));
      // 2巡目 H1（S1）: 取り消しは鍵（成功）か、途中で止まった障害物の id（partial）で送る。行の中身は送らない。
      if (res.ok && res.undoToken) undo.push({ undoToken: res.undoToken });
      if (res.reason === 'partial') undo.push({ pendingId: row.id });
    } else if (op === 3 && undo.length) {
      const u = r.pick(undo);
      usedUndo = u;
      label = 'unresolve ' + JSON.stringify(u);
      res = plain(h.ctx.apiUnresolveImpediment(u));
    } else {
      label = 'bad ' + step;
      res = plain(h.ctx.apiUpdateImpediment(r.pick(['IMP-001', 'PBI-002', null, 'IMP-999']), { title: 't', reported_by: 'r' }, {}));
    }
    trace.push(label + ' ' + JSON.stringify(fault));
    const ctxLabel = 'seed=' + seed + ' step=' + step + ' ' + label + '\n  trace: ' + trace.slice(-6).join('\n         ');
    checkShape(res, ctxLabel);
    checkFilesParse(files, ctxLabel);
    if (fault.lockBusy) { assert.deepEqual(files, snapshot, ctxLabel); continue; }

    // 行は消えない（障害物には削除が無い）。未解決∪解決済の ID の集合は減らない。
    const beforeIds = new Set(realIds.call(null, 'impediment_log.csv').concat(realIds('impediment_log_resolved.csv')));
    void beforeIds;
    const all = new Set(rowsOf(files['impediment_log.csv'], IMP_FIELDS).concat(rowsOf(files['impediment_log_resolved.csv'], IMP_FIELDS)).map((x) => x.id));
    const prev = new Set(rowsOf(snapshot['impediment_log.csv'], IMP_FIELDS).concat(rowsOf(snapshot['impediment_log_resolved.csv'], IMP_FIELDS)).map((x) => x.id));
    prev.forEach((id) => assert.ok(all.has(id), ctxLabel + ': 障害物 ' + id + ' が両ファイルから消えた'));

    if (!res.ok && res.reason !== 'partial') {
      assert.deepEqual(files, snapshot, ctxLabel + ': 失敗なのにファイルが変わった');
      continue;
    }
    if (res.reason === 'partial') {
      // 画面の「完了する」= 同じ操作をもう一度。障害を外せば揃う。
      Object.keys(fault).forEach((k) => delete fault[k]);
      const again = label.indexOf('resolve ') === 0
        ? plain(h.ctx.apiResolveImpediment(label.slice(8), '直した,\n2行', rowsOf(files['impediment_log.csv'], IMP_FIELDS).find((x) => x.id === label.slice(8))))
        : plain(h.ctx.apiUnresolveImpediment(usedUndo));   // 同じ ID の古い鍵ではなく、送った鍵（partial なら預け直されている）
      assert.equal(again.ok, true, ctxLabel + ': 「完了する」で揃わない ' + JSON.stringify(again).slice(0, 200));
      assert.deepEqual(plain(h.ctx.apiGetView('impediment')).view.pending, [], ctxLabel + ': pending が残った');
    }
    // 各ファイル内で ID は一意
    ['impediment_log.csv', 'impediment_log_resolved.csv'].forEach((n) => {
      const ids = realIds(n);
      assert.equal(new Set(ids).size, ids.length, ctxLabel + ': ' + n + ' に同じ ID が2つ');
    });
    // 履歴の行の形
    const added = newHistoryRows(snapshot['change_log.csv'], files['change_log.csv'], ctxLabel);
    if (res.historyWarning) {
      assert.deepEqual(added, [], ctxLabel + ': historyWarning なのに履歴が書けている');
    } else if (fault.setContentFailNames && res.ok && (files['impediment_log.csv'] !== snapshot['impediment_log.csv'] ||
        files['impediment_log_resolved.csv'] !== snapshot['impediment_log_resolved.csv']) && label.indexOf('update') !== 0) {
      assert.fail(ctxLabel + ': 履歴の書き込みが失敗したのに historyWarning が無い');
    } else {
      added.forEach((x) => assert.match(x.target_id, /^IMP-\d+$/, ctxLabel));
      if (res.ok && label.indexOf('create') === 0) assert.deepEqual(added.map((x) => x.action), ['create'], ctxLabel);
    }
  }
}

test('C: 障害物のランダム操作列（障害注入・部分書き込みの回復）で行が失われない', () => {
  for (let seed = 1; seed <= SEEDS.imp; seed++) runImpedimentSeed(seed, 40);
});

// ---------------------------------------------------------------------------
// 4. 決定的な障害注入の行列
// ---------------------------------------------------------------------------

function seeded() {
  const f = baseFiles();
  f['product_backlog.csv'] += 'PBI-002,既存,説明,,High,3,New,,2026-10-01 00:00:00,2026-10-01 00:00:00\n';
  f['impediment_log.csv'] += 'IMP-002,止まっている,,マヤ,2026-10-01,Open,,,sprint001\n';
  f['comments.csv'] += 'CMT-0000aaaa,PBI-002,me@example.com,2026-10-06 10:00:00,本文\n';
  return f;
}
const IMP2_ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ', reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const WRITE_CALLS = {
  apiUpdateStatus: (c) => c.apiUpdateStatus('PBI-002', 'Ready', '2026-10-01 00:00:00'),
  apiCreatePbi: (c) => c.apiCreatePbi({ title: '新', status: 'New', priority: 'Low', size: '', sprint: '', description: '', acceptance_criteria: '' }),
  apiUpdatePbi: (c) => c.apiUpdatePbi('PBI-002', { title: '既存2', description: '説明', acceptance_criteria: '', priority: 'High', size: '3', status: 'New', sprint: '' }, '2026-10-01 00:00:00'),
  apiDeletePbi: (c) => c.apiDeletePbi('PBI-002', '2026-10-01 00:00:00'),
  apiCreateImpediment: (c) => c.apiCreateImpediment({ title: '新', description: '', reported_by: 'ケン', sprint: '' }),
  apiUpdateImpediment: (c) => c.apiUpdateImpediment('IMP-002', { title: '止まった', description: '', reported_by: 'マヤ', sprint: 'sprint001' }, IMP2_ROW),
  apiResolveImpediment: (c) => c.apiResolveImpediment('IMP-002', '直した', IMP2_ROW),
  apiAddComment: (c) => c.apiAddComment('PBI-002', 'こんにちは'),
  apiDeleteComment: (c) => c.apiDeleteComment('CMT-0000aaaa'),
};
// 本体の書き込み回数（履歴を除く）
const MAIN_WRITES = { apiResolveImpediment: 2 };

test('C: 各書き込み API で n 回目の setContent を失敗させると、全か無か（または partial）になり、履歴失敗は historyWarning になる', () => {
  Object.keys(WRITE_CALLS).forEach((name) => {
    const mainN = MAIN_WRITES[name] || 1;
    for (let k = 1; k <= mainN + 1; k++) {
      const files = seeded();
      const before = Object.assign({}, files);
      const h = createCtx(files, { setContentFailAt: [k] });
      const res = plain(WRITE_CALLS[name](h.ctx));
      const label = name + ' fail#' + k;
      checkShape(res, label);
      checkFilesParse(files, label);
      if (k === 1) {
        assert.equal(res.ok, false, label);
        assert.equal(res.reason, 'error', label);
        assert.deepEqual(files, before, label + ': 1回目で失敗したのに何か書けている');
      } else if (k <= mainN) {
        assert.equal(res.reason, 'partial', label);
        assert.equal(files['change_log.csv'].split('\n').filter(Boolean).length, 2, label + ': partial で書けた側の履歴が1行');
      } else {
        assert.equal(res.ok, true, label + ' ' + JSON.stringify(res).slice(0, 200));
        assert.ok(res.historyWarning, label + ': historyWarning が無い');
        assert.equal(files['change_log.csv'], before['change_log.csv'], label);
      }
    }
  });
});

test('C: ロックが取れないと、どの書き込み API も busy でファイルを変えず、読み取りは通る', () => {
  const files = seeded();
  const before = Object.assign({}, files);
  const h = createCtx(files, { lockBusy: true });
  Object.keys(WRITE_CALLS).concat(['apiRestorePbi', 'apiRestoreComment', 'apiUnresolveImpediment']).forEach((name) => {
    const res = plain(WRITE_CALLS[name] ? WRITE_CALLS[name](h.ctx) : h.ctx[name]({ id: 'x' }, {}));
    assert.equal(res.ok, false, name);
    assert.equal(res.reason, 'busy', name);
  });
  assert.deepEqual(files, before);
  assert.equal(plain(h.ctx.apiGetView('board')).ok, true);
  assert.equal(plain(h.ctx.apiGetHistory('PBI-002')).ok, true);
});

test('C: ファイルの読み取りが例外を投げても、書き込みは error で止まり何も書かない（履歴だけは historyWarning）', () => {
  [['product_backlog.csv', 'apiUpdateStatus'], ['impediment_log.csv', 'apiResolveImpediment'], ['impediment_log_resolved.csv', 'apiResolveImpediment'], ['comments.csv', 'apiAddComment']].forEach(([n, api]) => {
    const files = seeded();
    const before = Object.assign({}, files);
    const res = plain(WRITE_CALLS[api](createCtx(files, { readThrowNames: [n] }).ctx));
    assert.equal(res.reason, 'error', n);
    assert.deepEqual(files, before, n);
  });
  const files = seeded();
  const res = plain(WRITE_CALLS.apiUpdateStatus(createCtx(files, { readThrowNames: ['change_log.csv'] }).ctx));
  assert.equal(res.ok, true);
  assert.ok(res.historyWarning.indexOf('injected read failure') !== -1, res.historyWarning);
});

test('C: 空・欠落・壊れた見出しのファイルでは書かない（change_log の空だけは自己修復）', () => {
  const cases = [
    ['product_backlog.csv', '', 'apiUpdateStatus'], ['product_backlog.csv', undefined, 'apiCreatePbi'],
    ['product_backlog.csv', 'id;title\n', 'apiCreatePbi'], ['impediment_log.csv', '', 'apiCreateImpediment'],
    ['impediment_log_resolved.csv', undefined, 'apiResolveImpediment'], ['comments.csv', '', 'apiAddComment'],
    ['comments.csv', 'id,target_id,author,body\n', 'apiAddComment'],
  ];
  cases.forEach(([n, content, api]) => {
    const files = seeded();
    if (content === undefined) delete files[n]; else files[n] = content;
    const before = Object.assign({}, files);
    const res = plain(WRITE_CALLS[api](createCtx(files).ctx));
    assert.equal(res.ok, false, n + ' ' + JSON.stringify(content));
    assert.equal(res.reason, 'error', n);
    assert.deepEqual(files, before, n + ': 書いてしまった');
  });
  const files = seeded();
  files['change_log.csv'] = '\uFEFF';
  const res = plain(WRITE_CALLS.apiUpdateStatus(createCtx(files).ctx));
  assert.equal(res.ok, true);
  assert.equal(res.historyWarning, undefined);
  assert.deepEqual(rowsOf(files['change_log.csv'], CHG_FIELDS).map((x) => x.field), ['status']);
});

test('C: ローカルの Claude Code が BOM + CRLF で書いたファイルにも、全 API が書き込め、余計な履歴を出さない', () => {
  const want = {
    apiUpdateStatus: ['PBI-002:update:status'], apiCreatePbi: ['PBI-003:create:'], apiUpdatePbi: ['PBI-002:update:title'],
    apiDeletePbi: ['PBI-002:delete:'], apiCreateImpediment: ['IMP-003:create:'], apiUpdateImpediment: ['IMP-002:update:title'],
    apiResolveImpediment: ['IMP-002:resolve:'], apiAddComment: ['PBI-002:comment_add:'], apiDeleteComment: ['PBI-002:comment_delete:'],
  };
  Object.keys(WRITE_CALLS).forEach((name) => {
    const files = seeded();
    Object.keys(files).forEach((n) => { files[n] = '\uFEFF' + files[n].replace(/\n/g, '\r\n'); });
    const oldLog = files['change_log.csv'];
    const res = plain(WRITE_CALLS[name](createCtx(files).ctx));
    assert.equal(res.ok, true, name + ' ' + JSON.stringify(res).slice(0, 200));
    assert.equal(res.historyWarning, undefined, name);
    checkFilesParse(files, name);
    assert.ok(files['change_log.csv'].startsWith(oldLog), name + ': 既存の履歴（BOM・CRLF）を書き換えた');
    const hist = rowsOf(files['change_log.csv'], CHG_FIELDS).map((x) => [x.target_id, x.action, x.field].join(':'));
    assert.deepEqual(hist, want[name], name);
  });
});

// ---------------------------------------------------------------------------
// 5. 権限
// ---------------------------------------------------------------------------

test('C: 他人のコメントは消せず戻せない。ログインが空なら誰のものも消せず、空の author の行も戻せない', () => {
  const files = seeded();
  files['comments.csv'] += 'CMT-0000bbbb,PBI-002,,2026-10-06 10:00:00,作者なし\n';
  const before = Object.assign({}, files);
  const you = createCtx(files, { user: 'you@example.com' }).ctx;
  assert.equal(plain(you.apiDeleteComment('CMT-0000aaaa')).reason, 'forbidden');
  assert.equal(plain(you.apiDeleteComment(' CMT-0000aaaa ')).reason, 'forbidden');
  const anon = createCtx(files, { user: '' }).ctx;
  assert.equal(plain(anon.apiDeleteComment('CMT-0000bbbb')).reason, 'forbidden');
  assert.equal(plain(anon.apiRestoreComment({ id: 'CMT-0000cccc', target_id: 'PBI-002', author: '', created_at: '2026-10-06 10:00:00', body: 'x' })).reason, 'forbidden');
  assert.equal(plain(anon.apiAddComment('PBI-002', 'x')).reason, 'forbidden');
  assert.equal(plain(you.apiRestoreComment({ id: 'CMT-0000cccc', target_id: 'PBI-002', author: 'me@example.com', created_at: '2026-10-06 10:00:00', body: '装う' })).reason, 'forbidden');
  // author を省いた行・配列・文字列を送っても通らない
  assert.equal(plain(you.apiRestoreComment({ id: 'CMT-0000cccc', target_id: 'PBI-002', created_at: '2026-10-06 10:00:00', body: 'x' })).reason, 'forbidden');
  assert.equal(plain(you.apiRestoreComment(['CMT-0000cccc'])).reason, 'forbidden');
  assert.equal(plain(you.apiRestoreComment('CMT-0000cccc')).reason, 'forbidden');
  assert.deepEqual(files, before);
});

test('C: apiGetHistory は不正な引数を invalid にし、他の種類の ID や巨大な文字列でも例外を出さない', () => {
  const h = createCtx(seeded());
  [null, undefined, {}, [], 'CMT-0000aaaa', 'x'.repeat(100000), 'PBI-', ' PBI-1x'].forEach((v) => {
    const res = plain(h.ctx.apiGetHistory(v));
    assert.equal(res.ok, false, JSON.stringify(v));
    assert.equal(res.reason, 'invalid');
  });
  assert.deepEqual(plain(h.ctx.apiGetHistory(' PBI-002 ')), { ok: true, entries: [] });
  assert.deepEqual(plain(h.ctx.apiGetHistory(['PBI-002'])).ok, true);
});

test('C: apiGetView は不正な名前・型でも ok:false の形で返し例外を出さない', () => {
  const h = createCtx(seeded());
  [{}, [], 123, 'constructor', '__proto__', 'x'.repeat(10000)].forEach((v) => {
    const res = plain(h.ctx.apiGetView(v));
    checkShape(Object.assign({ reason: 'error' }, res), JSON.stringify(v).slice(0, 30));
    assert.equal(res.ok, false);
  });
});

test('C: 同じ秒に続けて書いても updated_at は単調に増え、古い expected の書き込みは conflict になる', () => {
  const files = seeded();
  const h = createCtx(files, { freezeClock: true });
  let exp = '2026-10-01 00:00:00';
  const seen = [exp];
  for (let i = 0; i < 5; i++) {
    const res = plain(h.ctx.apiUpdateStatus('PBI-002', STATUSES[i % 5], exp));
    assert.equal(res.ok, true, JSON.stringify(res));
    const now = rowsOf(files['product_backlog.csv'], PBI_FIELDS)[0].updated_at;
    assert.ok(now > seen[seen.length - 1], now);
    seen.push(now);
    exp = now;
  }
  seen.slice(0, -1).forEach((old) => assert.equal(plain(h.ctx.apiUpdateStatus('PBI-002', 'Done', old)).reason, 'conflict', old));
});
