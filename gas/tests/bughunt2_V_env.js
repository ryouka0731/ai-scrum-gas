'use strict';
// bughunt2 V 用のフェイク環境（Drive / Spreadsheet / Cache など）。テストではない。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const GAS_DIR = path.join(__dirname, '..');
const J = (v) => JSON.parse(JSON.stringify(v));   // vm の別レルムの値を普通の値にする

const BACKLOG_HEADER = 'id,title,description,acceptance_criteria,priority,size,status,sprint,created_at,updated_at\n';
const IMP_HEADER = 'id,title,description,reported_by,reported_at,status,resolved_at,resolution,sprint\n';
const VEL_HEADER = 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n';

// ---- フェイク Drive -------------------------------------------------------
function makeFolder(spec) {
  // spec = { files: {name: text}, folders: {name: spec} }
  const it = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };
  const folder = {
    spec,
    getFilesByName(name) {
      if (spec.failRead === name) throw new Error('drive boom ' + name);
      const dup = spec.dups && spec.dups[name] ? spec.dups[name] : 1;
      const out = [];
      if (Object.prototype.hasOwnProperty.call(spec.files || {}, name)) {
        for (let k = 0; k < dup; k++) {
          out.push({
            getBlob: () => ({ getDataAsString: () => spec.files[name] }),
            setContent: (c) => {
              if (spec.failWrite === name) throw new Error(spec.failWriteMessage || 'write boom');
              spec.files[name] = c;
            },
          });
        }
      }
      return it(out);
    },
    getFoldersByName(name) {
      const f = (spec.folders || {})[name];
      return it(f ? [makeFolder(f)] : []);
    },
    getFolders() {
      return it(Object.keys(spec.folders || {}).map((n) => { const f = makeFolder(spec.folders[n]); f.getName = () => n; return f; }));
    },
  };
  return folder;
}

// ---- フェイク Spreadsheet --------------------------------------------------
function makeSheet(name, opts) {
  const s = {
    name, cells: {}, bg: {}, maxRows: 1000, maxCols: 26, frozen: 0, clears: 0,
    calls: { setValues: 0, setBackgrounds: 0 },
    clear() { s.cells = {}; s.bg = {}; s.clears++; return s; },
    getMaxRows: () => s.maxRows,
    getMaxColumns: () => s.maxCols,
    insertRowsAfter(_pos, n) { s.maxRows += n; },
    insertColumnsAfter(_pos, n) { s.maxCols += n; },
    setFrozenRows(n) { s.frozen = n; },
    getLastRow() { let m = 0; Object.keys(s.cells).forEach((k) => { m = Math.max(m, Number(k.split(',')[0])); }); return m; },
    getLastColumn() { let m = 0; Object.keys(s.cells).forEach((k) => { m = Math.max(m, Number(k.split(',')[1])); }); return m; },
    getRange(r, c, nr, nc) {
      nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
      if (r < 1 || c < 1 || r + nr - 1 > s.maxRows || c + nc - 1 > s.maxCols) {
        throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
      }
      const range = {
        setValues(vals) {
          if (opts && opts.failSetValues) throw new Error('setValues boom ' + name);
          s.calls.setValues++;
          assert.equal(vals.length, nr, 'setValues 行数');
          vals.forEach((row, i) => {
            assert.equal(row.length, nc, 'setValues 列数が揃っていない');
            row.forEach((v, j) => {
              let stored = v;
              if (typeof v === 'string') {
                if (v.charAt(0) === "'") stored = v.slice(1);          // シートは ' を表示しない
                else if (v.charAt(0) === '=') stored = { formula: v };  // 数式として評価される
              }
              s.cells[(r + i) + ',' + (c + j)] = stored;
            });
          });
          return range;
        },
        getValues() {
          const out = [];
          for (let i = 0; i < nr; i++) {
            const row = [];
            for (let j = 0; j < nc; j++) {
              const v = s.cells[(r + i) + ',' + (c + j)];
              row.push(v === undefined ? '' : v);
            }
            out.push(row);
          }
          return out;
        },
        setBackground() { return range; }, setFontColor() { return range; }, setFontWeight() { return range; },
        setBackgrounds(m) {
          s.calls.setBackgrounds++;
          assert.equal(m.length, nr);
          m.forEach((row, i) => row.forEach((v, j) => { if (v !== null) s.bg[(r + i) + ',' + (c + j)] = v; }));
          return range;
        },
      };
      return range;
    },
    // テスト用: 行列で読む
    grid() {
      const R = s.getLastRow(), C = s.getLastColumn();
      const out = [];
      for (let i = 1; i <= R; i++) { const row = []; for (let j = 1; j <= C; j++) { const v = s.cells[i + ',' + j]; row.push(v === undefined ? '' : v); } out.push(row); }
      return out;
    },
  };
  return s;
}

function makeEnv(scrumSpec, opts) {
  opts = opts || {};
  const sheets = {};
  const ssObj = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => { sheets[n] = makeSheet(n, opts.sheetOpts && opts.sheetOpts[n]); return sheets[n]; },
    toasts: [],
    toast(m, t, s) { ssObj.toasts.push([m, t, s]); },
  };
  const root = { getFoldersByName: (n) => (n === 'scrum' ? { hasNext: () => true, next: () => makeFolder(scrumSpec) } : { hasNext: () => false }) };
  const cache = {};
  let uuidN = 0;
  const props = Object.assign({ SCRUM_FOLDER_ID: 'fid' }, opts.props || {});
  const lockState = { tries: 0, releases: 0, available: opts.lockAvailable !== false, waits: [] };
  const triggers = opts.triggers || [];
  const created = [];
  const alerts = [];
  const prompts = opts.prompts || [];
  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
    Button: { OK: 'BTN_OK', CANCEL: 'BTN_CANCEL' },
    alert(t, m) { alerts.push([t, m]); },
    prompt(t, m) {
      const p = prompts.shift() || { button: 'BTN_CANCEL', text: '' };
      ui.lastPrompt = [t, m];
      return { getSelectedButton: () => p.button, getResponseText: () => p.text };
    },
    createMenu(title) {
      const items = [];
      const menu = { title, items, addItem(l, f) { items.push([l, f]); return menu; }, addSeparator() { items.push('--'); return menu; }, addToUi() { ui.menu = menu; } };
      return menu;
    },
  };
  const ctx = {
    console: { error(m) { ctx.__errors.push(String(m)); }, log() {} },
    __errors: [],
    SpreadsheetApp: { getActiveSpreadsheet: () => ssObj, getUi: () => { if (opts.uiThrows) throw new Error('auth'); return ui; } },
    // 設定したフォルダ ID 以外を引いたら失敗させる（フォルダの取り違えを見逃さない）
    DriveApp: { getFolderById: (id) => { if (opts.badFolder || id !== props.SCRUM_FOLDER_ID) throw new Error('no access ' + id); return root; } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock(ms) { lockState.tries++; lockState.waits.push(ms); return lockState.available; }, releaseLock() { lockState.releases++; } }) },
    Session: { getScriptTimeZone: () => 'UTC', getActiveUser: () => ({ getEmail: () => { if (opts.userThrows) throw new Error('no user'); return opts.user === undefined ? 'me@example.com' : opts.user; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { if (opts.cachePutThrows) throw new Error('cache boom'); cache[k] = String(v); }, remove: (k) => { if (opts.cacheRemoveThrows) throw new Error('cache rm boom'); delete cache[k]; } }) },
    HtmlService: { createHtmlOutputFromFile: (n) => { const o = { file: n, meta: [], setTitle(t) { o.title = t; return o; }, addMetaTag(a, b) { o.meta.push([a, b]); return o; } }; return o; } },
    Utilities: { getUuid: () => { if (opts.uuids) return opts.uuids[Math.min(uuidN++, opts.uuids.length - 1)]; uuidN++; return ('0000000' + uuidN.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; }, formatDate: (d) => d.toISOString().slice(0, 19).replace('T', ' ') },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); t.deleted = true; },
      // 作ったトリガーは一覧にも入れる（消す側が本当に消したかを一覧で確かめられるように）
      newTrigger: (h) => ({ timeBased: () => ({ everyMinutes: (m) => ({ create: () => { created.push([h, m]); triggers.push({ getHandlerFunction: () => h, minutes: m }); } }) }) }),
    },
  };
  vm.createContext(ctx);
  fs.readdirSync(GAS_DIR).filter((n) => n.slice(-3) === '.js').sort().forEach((n) => {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), ctx, { filename: n });
  });
  return { ctx, cache, scrumSpec, sheets, ss: ssObj, props, lockState, triggers, created, alerts, ui, root };
}
module.exports = { makeEnv, makeFolder, makeSheet, J, BACKLOG_HEADER, IMP_HEADER, VEL_HEADER, GAS_DIR };
