'use strict';
// 2巡目 S（ブラウザから呼べる面の認可・悪用）の共通フェイク。
// web_app_flow.test.js の createTestContext を写し、次を足したもの:
// - ロックの取得・解放を数える（解放漏れの検出）
// - 各 GAS サービスへのアクセス（読み出しも）を記録する（副作用・ロック前の読み出しの検出）
// - SpreadsheetApp / ScriptApp のフェイク（getUi は Web アプリ文脈と同じく例外）
// - opts.failCacheRemove: CacheService.remove を失敗させる
// - opts.onTryLock / opts.onRelease: ロックの取得直前・解放直後に1回だけ呼ぶ（別の実行が割り込む再現）
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAS_DIR = path.join(__dirname, '..');
const PBI_FIELDS = ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint', 'created_at', 'updated_at'];
const IMP_FIELDS = ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'];
const CMT_FIELDS = ['id', 'target_id', 'author', 'created_at', 'body'];
const CHG_FIELDS = ['id', 'at', 'actor', 'target_id', 'action', 'field', 'before', 'after'];

function gasFileNames() {
  return fs.readdirSync(GAS_DIR).filter((n) => n.slice(-3) === '.js').sort();
}

function csvLine(fields, row) {
  return fields.map((f) => {
    const v = row[f] === undefined ? '' : String(row[f]);
    return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }).join(',');
}

function baseFiles() {
  return {
    'product_backlog.csv': PBI_FIELDS.join(',') + '\n' +
      csvLine(PBI_FIELDS, { id: 'PBI-001', title: 'A', priority: 'High', status: 'New', created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00' }) + '\n' +
      csvLine(PBI_FIELDS, { id: 'PBI-002', title: 'B', priority: 'Low', status: 'Ready', created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:01' }) + '\n',
    'product_backlog_done.csv': PBI_FIELDS.join(',') + '\n',
    'impediment_log.csv': IMP_FIELDS.join(',') + '\n' +
      csvLine(IMP_FIELDS, { id: 'IMP-002', title: '回線が遅い', description: 'd', reported_by: 'alice', reported_at: '2026-10-01', status: 'Open', sprint: '' }) + '\n',
    'impediment_log_resolved.csv': IMP_FIELDS.join(',') + '\n',
    'comments.csv': CMT_FIELDS.join(',') + '\n' +
      csvLine(CMT_FIELDS, { id: 'CMT-aaaaaaaa', target_id: 'PBI-001', author: 'other@example.com', created_at: '2026-10-01 00:00:00', body: '他人のコメント' }) + '\n' +
      csvLine(CMT_FIELDS, { id: 'CMT-bbbbbbbb', target_id: 'PBI-001', author: 'me@example.com', created_at: '2026-10-01 00:00:01', body: '自分のコメント' }) + '\n',
    'change_log.csv': CHG_FIELDS.join(',') + '\n',
    'velocity.csv': 'sprint,sprint_start,sprint_end,planned,completed\n',
  };
}

function createCtx(files, opts) {
  opts = opts || {};
  const log = [];          // サービスへのアクセス記録 'Service.method'
  const lockState = { acquired: 0, released: 0, held: 0 };
  function it(arr) { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; }
  function makeFile(name) {
    return {
      getBlob: () => { log.push('Drive.read:' + name); return { getDataAsString: () => files[name] }; },
      setContent: function (content) {
        log.push('Drive.setContent:' + name);
        if (opts.readOnly) throw new Error('Access denied: DriveApp.');
        files[name] = content;
      },
    };
  }
  const scrum = {
    getFilesByName: (name) => { log.push('Drive.find:' + name); return Object.prototype.hasOwnProperty.call(files, name) ? it([makeFile(name)]) : it([]); },
    getFolders: () => it([]),
    getName: () => 'scrum',
  };
  const root = { getFoldersByName: (n) => (n === 'scrum' ? it([scrum]) : it([])) };
  const props = { SCRUM_FOLDER_ID: 'fake-folder-id' };
  const cache = {};
  const clock = { now: 0 };
  let uuidN = 0;
  const triggers = [];
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    DriveApp: { getFolderById: () => { log.push('DriveApp.getFolderById'); return root; } },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          log.push('Lock.tryLock');
          if (opts.lockBusy) return false;
          const hook = opts.onTryLock;
          if (hook) { opts.onTryLock = null; hook(); }   // ロックを待つ間に別の実行が先に終わる
          lockState.acquired++; lockState.held++; return true;
        },
        releaseLock: () => {
          lockState.released++; if (lockState.held > 0) lockState.held--;
          const hook = opts.onRelease;
          if (hook) { opts.onRelease = null; hook(); }   // 解放した直後に別の実行が入る
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => { log.push('Props.get:' + k); return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
        setProperty: (k, v) => { log.push('Props.set:' + k); props[k] = v; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => {
          log.push('Cache.get');
          if (!Object.prototype.hasOwnProperty.call(cache, k)) return null;
          if (clock.now >= cache[k].expiresAt) { delete cache[k]; return null; }
          return cache[k].value;
        },
        put: (k, v, ttl) => {
          log.push('Cache.put');
          if (k.length > 250) throw new Error('Argument too large: key');
          cache[k] = { value: String(v), expiresAt: clock.now + (ttl === undefined ? 600 : Number(ttl)) };
        },
        remove: (k) => {
          log.push('Cache.remove');
          if (opts.failCacheRemove) throw new Error('Service invoked too many times: cache');
          delete cache[k];
        },
      }),
    },
    Session: {
      getScriptTimeZone: () => 'UTC',
      getActiveUser: () => ({ getEmail: () => (opts.user === undefined ? 'me@example.com' : opts.user) }),
    },
    Utilities: {
      // 本物の GAS と同じく v4 UUID の形（テストでは決まった並び）。
      getUuid: () => { uuidN++; return ('0000000' + uuidN.toString(16)).slice(-8) + '-1234-4abc-8def-' + ('00000000000' + uuidN).slice(-12); },
      formatDate: (date) => {
        const p = (n) => (n < 10 ? '0' + n : String(n));
        return date.getUTCFullYear() + '-' + p(date.getUTCMonth() + 1) + '-' + p(date.getUTCDate()) + ' ' +
          p(date.getUTCHours()) + ':' + p(date.getUTCMinutes()) + ':' + p(date.getUTCSeconds());
      },
    },
    // Web アプリ（google.script.run）の文脈: getUi は例外。シートの書き込みは記録する。
    SpreadsheetApp: {
      getUi: () => { log.push('SpreadsheetApp.getUi'); throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); },
      getActiveSpreadsheet: () => {
        log.push('SpreadsheetApp.getActiveSpreadsheet');
        const sheet = {
          clearContents() { log.push('Sheet.clear'); return sheet; },
          clear() { log.push('Sheet.clear'); return sheet; },
          getLastRow: () => 0, getLastColumn: () => 0, getMaxRows: () => 1, getMaxColumns: () => 1,
          getRange() {
            // 設定系は本物と同じく自分を返す（連鎖して呼ばれるため）
            const range = { setValues() { log.push('Sheet.setValues'); return range; }, getValues: () => [[]] };
            ['setBackground', 'setBackgrounds', 'setFontWeight', 'setFontColor', 'setWrap', 'setNumberFormat', 'clearContent', 'clearFormat', 'setWrapStrategy']
              .forEach((m) => { range[m] = () => range; });
            return range;
          },
          setFrozenRows() {}, autoResizeColumns() {}, getName: () => 's', clearFormats() {}, getDataRange() { return this.getRange(); },
          insertRowsAfter() {}, insertColumnsAfter() {},   // 書き込みが途中で例外にならないように（失敗した同期と見分けるため）
        };
        return { getSheetByName: () => sheet, insertSheet: () => sheet, toast() { log.push('toast'); } };
      },
    },
    ScriptApp: {
      getProjectTriggers: () => { log.push('ScriptApp.getProjectTriggers'); return triggers.slice(); },
      deleteTrigger: (t) => { log.push('ScriptApp.deleteTrigger'); triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: (h) => { log.push('ScriptApp.newTrigger'); const b = { timeBased: () => b, everyMinutes: () => b, create: () => { triggers.push({ getHandlerFunction: () => h }); } }; return b; },
    },
  };
  vm.createContext(ctx);
  gasFileNames().forEach((name) => {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, name), 'utf8'), ctx, { filename: name });
  });
  return { ctx, files, props, cache, clock, log, lockState, triggers };
}

/** vm の値を本体のレルムへ写す（deepEqual のため）。 */
function plain(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

/** シード付き乱数。 */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** gas/*.js のトップレベル関数宣言の名前（ファイルごと）。 */
function topLevelFunctions() {
  const out = {};
  gasFileNames().forEach((name) => {
    const src = fs.readFileSync(path.join(GAS_DIR, name), 'utf8');
    const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    let m;
    out[name] = [];
    while ((m = re.exec(src))) out[name].push(m[1]);
  });
  return out;
}

module.exports = { GAS_DIR, PBI_FIELDS, IMP_FIELDS, CMT_FIELDS, CHG_FIELDS, gasFileNames, csvLine, baseFiles, createCtx, plain, mulberry32, topLevelFunctions };
