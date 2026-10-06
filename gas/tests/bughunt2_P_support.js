'use strict';
// バグ探し 2巡目 P（規模・性能・計算量）の共通部品。テストファイルではない。
//
// web_app_flow.test.js の createTestContext の写し（Drive 等をインメモリのフェイクにした vm）に、
// 「機械に依らない」測り方を足したもの:
//   - stats.reads[name] / stats.writes[name] / stats.readChars[name] / stats.writeChars[name]
//     Drive から何回・何文字読み書きしたか（実時間ではなく操作量。GAS の Drive は遅いので、
//     ここの量が実行時間・6分上限・ロック待ち10秒に効く）
//   - stats.parsedChars / stats.parseCalls: CSV を解釈した文字数（parseCsvWithLines_ を包む）
// 実時間は bestOf() で最小値を取る（GC・ウォームアップの揺れを避ける。比は大きな余裕を持たせて使う）。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const GAS_DIR = path.join(__dirname, '..');

const BACKLOG_FIELDS = ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint', 'created_at', 'updated_at'];
const COMMENT_HEADER = 'id,target_id,author,created_at,body';
const HISTORY_HEADER = 'id,at,actor,target_id,action,field,before,after';
const IMP_HEADER = 'id,title,description,reported_by,reported_at,status,resolved_at,resolution,sprint';
const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const T0 = '2026-01-01 00:00:00';

function gasFileNames() {
  return fs.readdirSync(GAS_DIR).filter(function (n) { return n.slice(-3) === '.js'; }).sort();
}

function pid(i) { return 'PBI-' + String(i).padStart(5, '0'); }

/** n 件の PBI の CSV（説明・受入基準は引用符つき複数行。実データの形に近づける）。 */
function pbiCsv(n, opt) {
  const o = opt || {};
  const lines = [BACKLOG_FIELDS.join(',')];
  for (let i = 1; i <= n; i++) {
    const desc = o.desc ? o.desc(i) : '"説明, ' + i + '\n2行目"';
    lines.push([pid(i), 'タイトル ' + i, desc, '"基準1\n基準2"', 'Medium', '3', STATUSES[i % 5],
      i % 4 ? '' : 'Sprint-1', T0, T0].join(','));
  }
  return lines.join('\n') + '\n';
}

/** n 件のコメント。targets 個の対象に散らす。id は偽 UUID（0000000n）と衝突しない 'f' 始まり。 */
function commentCsv(n, targets, bodyChars) {
  const lines = [COMMENT_HEADER];
  const body = 'あ'.repeat(bodyChars === undefined ? 100 : bodyChars);
  for (let i = 0; i < n; i++) {
    lines.push(['CMT-f' + i.toString(16).padStart(7, '0'), pid(1 + (i % targets)), 'a@example.com',
      '2026-01-01 00:' + String(i % 60).padStart(2, '0') + ':00', '"コメント ' + i + ' ' + body + '"'].join(','));
  }
  return lines.join('\n') + '\n';
}

/** 少なくとも bytes 文字になる変更履歴 CSV（1行 約100文字）。 */
function historyCsv(chars) {
  const lines = [HISTORY_HEADER];
  let size = HISTORY_HEADER.length + 1;
  let i = 0;
  while (size < chars) {
    const r = 'CHG-f' + i.toString(16).padStart(7, '0') + ',2026-01-01 00:00:00,a@example.com,' + pid(1 + (i % 50))
      + ',update,title,古いタイトル,新しいタイトル';
    lines.push(r);
    size += r.length + 1;
    i++;
  }
  return lines.join('\n') + '\n';
}

function createCtx(files, opts) {
  opts = opts || {};
  const stats = { reads: {}, writes: {}, readChars: {}, writeChars: {}, parsedChars: 0, parseCalls: 0, lockCalls: 0 };
  function bump(map, k, v) { map[k] = (map[k] || 0) + v; }
  function makeIterator(arr) {
    let i = 0;
    return { hasNext: function () { return i < arr.length; }, next: function () { return arr[i++]; } };
  }
  function makeFile(name) {
    return {
      getBlob: function () {
        return { getDataAsString: function () { bump(stats.reads, name, 1); bump(stats.readChars, name, files[name].length); return files[name]; } };
      },
      setContent: function (content) { bump(stats.writes, name, 1); bump(stats.writeChars, name, content.length); files[name] = content; },
    };
  }
  const scrumFolder = {
    getFilesByName: function (name) {
      return Object.prototype.hasOwnProperty.call(files, name) ? makeIterator([makeFile(name)]) : makeIterator([]);
    },
  };
  const rootFolder = { getFoldersByName: function (name) { return name === 'scrum' ? makeIterator([scrumFolder]) : makeIterator([]); } };
  const props = { SCRUM_FOLDER_ID: 'fake-folder-id' };
  const cache = {};
  let uuidN = 0;
  const context = {
    console: console,
    DriveApp: { getFolderById: function () { return rootFolder; } },
    LockService: { getScriptLock: function () { return { tryLock: function () { stats.lockCalls++; return true; }, releaseLock: function () {} }; } },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
          setProperty: function (key, value) { props[key] = value; },
        };
      },
    },
    CacheService: {
      getScriptCache: function () {
        return {
          get: function (k) { return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null; },
          put: function (k, v) { cache[k] = String(v); },
          remove: function (k) { delete cache[k]; },
        };
      },
    },
    Session: {
      getScriptTimeZone: function () { return 'UTC'; },
      getActiveUser: function () { return { getEmail: function () { return opts.user === undefined ? 'a@example.com' : opts.user; } }; },
    },
    Utilities: {
      getUuid: function () { uuidN++; return ('0000000' + uuidN.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
      formatDate: function (d) {
        function pad(n) { return n < 10 ? '0' + n : String(n); }
        return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + ' ' +
          pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
      },
    },
  };
  vm.createContext(context);
  gasFileNames().forEach(function (name) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, name), 'utf8'), context, { filename: name });
  });
  // parseCsv / csvToObjects / findOverlongCsvRow はすべて parseCsvWithLines_ を通る。包んで文字数を数える。
  const orig = context.parseCsvWithLines_;
  context.parseCsvWithLines_ = function (text) {
    stats.parseCalls++;
    stats.parsedChars += String(text || '').length;
    return orig(text);
  };
  return { ctx: context, files: files, stats: stats, props: props, vm: vm,
    global: function (name) { return vm.runInContext(name, context); },
    resetStats: function () {
      stats.reads = {}; stats.writes = {}; stats.readChars = {}; stats.writeChars = {};
      stats.parsedChars = 0; stats.parseCalls = 0; stats.lockCalls = 0;
    } };
}

/** 標準の4ファイル。 */
function standardFiles(nPbi, nComments, opt) {
  const o = opt || {};
  return {
    'product_backlog.csv': pbiCsv(nPbi, o),
    'comments.csv': nComments === null ? COMMENT_HEADER + '\n' : commentCsv(nComments, Math.min(nPbi, 50), o.bodyChars),
    'change_log.csv': o.logChars ? historyCsv(o.logChars) : HISTORY_HEADER + '\n',
    'velocity.csv': 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n',
    'impediment_log.csv': IMP_HEADER + '\n',
    'impediment_log_resolved.csv': IMP_HEADER + '\n',
  };
}

function hr() { return Number(process.hrtime.bigint()) / 1e6; }

/** fn を k 回測って最小の ms を返す（初回は捨てる）。 */
function bestOf(fn, k) {
  fn();
  let best = Infinity;
  for (let i = 0; i < (k || 3); i++) {
    const s = hr();
    fn();
    best = Math.min(best, hr() - s);
  }
  return best;
}

/** JSON.stringify の文字数（google.script.run が直列化する応答の大きさの目安）。 */
function payloadChars(v) { return JSON.stringify(v).length; }
/** UTF-8 のバイト数（実際に網を通る大きさ）。 */
function payloadBytes(v) { return Buffer.byteLength(JSON.stringify(v), 'utf8'); }

/** 固定シードの乱数。 */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

module.exports = { BACKLOG_FIELDS, COMMENT_HEADER, HISTORY_HEADER, IMP_HEADER, STATUSES, T0, pid, pbiCsv, commentCsv,
  historyCsv, createCtx, standardFiles, bestOf, payloadChars, payloadBytes, mulberry32, hr };
