'use strict';
// バグ探し D の共通部品（テストファイルではない。bughunt_d_*.test.js から require する）。
//
// 本物のサーバ（gas/*.js を vm に載せ、Drive 等をインメモリのフェイクに差し替えたもの。
// web_app_flow.test.js の createTestContext の写し）と、kanban.html の DOM シム
// （kanban_harness.js）をつなぐ。google.script.run の呼び出しごとに
//   - サーバでの処理（process: その時点のサーバの状態で応答を作り、CSV を書き換える）
//   - ブラウザへの到達（deliver: handlers.success / failure を呼ぶ）
// を別々に、任意の順で起こせる。応答は JSON で往復させる（google.script.run も直列化する）。

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHarness } = require('./kanban_harness.js');

const GAS_DIR = path.join(__dirname, '..');

function gasFileNames() {
  return fs.readdirSync(GAS_DIR).filter(function (n) { return n.slice(-3) === '.js'; }).sort();
}

const BACKLOG_FIELDS = ['id', 'title', 'description', 'acceptance_criteria', 'priority', 'size', 'status', 'sprint', 'created_at', 'updated_at'];
const IMP_FIELDS = ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'];
const ME = 'me@example.com';

function csv(fields, rows) {
  return fields.join(',') + '\n' + rows.map(function (r) {
    return fields.map(function (f) { return r[f] === undefined ? '' : String(r[f]); }).join(',');
  }).join('\n') + (rows.length ? '\n' : '');
}

function initialFiles() {
  return {
    'product_backlog.csv': csv(BACKLOG_FIELDS, [
      { id: 'PBI-001', title: 'A', priority: 'High', size: '3', status: 'New', created_at: '2026-10-01', updated_at: '2026-10-01 00:00:00' },
      { id: 'PBI-002', title: 'B', priority: 'Medium', size: '2', status: 'Ready', created_at: '2026-10-01', updated_at: '2026-10-01 00:00:00' },
      { id: 'PBI-003', title: 'C', priority: 'Low', size: '1', status: 'In Progress', created_at: '2026-10-01', updated_at: '2026-10-01 00:00:00' },
      { id: 'PBI-004', title: 'D', priority: 'High', size: '5', status: 'Review', created_at: '2026-10-01', updated_at: '2026-10-01 00:00:00' },
    ]),
    'impediment_log.csv': csv(IMP_FIELDS, [
      { id: 'IMP-001', title: 'X', description: 'x', reported_by: 'maya', reported_at: '2026-10-01', status: 'Open', sprint: 'sprint001' },
      { id: 'IMP-002', title: 'Y', description: 'y', reported_by: 'maya', reported_at: '2026-10-01', status: 'Open', sprint: 'sprint001' },
      { id: 'IMP-003', title: 'Z', description: 'z', reported_by: 'maya', reported_at: '2026-10-01', status: 'Open', sprint: 'sprint001' },
    ]),
    'impediment_log_resolved.csv': csv(IMP_FIELDS, [
      { id: 'IMP-004', title: 'W', description: 'w', reported_by: 'maya', reported_at: '2026-09-01', status: 'Resolved', resolved_at: '2026-09-02', resolution: 'done', sprint: 'sprint001' },
    ]),
    'comments.csv': csv(['id', 'target_id', 'author', 'created_at', 'body'], [
      { id: 'CMT-0000000a', target_id: 'PBI-001', author: 'maya@example.com', created_at: '2026-10-01 00:00:00', body: 'hello' },
      { id: 'CMT-0000000b', target_id: 'PBI-001', author: ME, created_at: '2026-10-01 00:00:01', body: 'mine1' },
      { id: 'CMT-0000000c', target_id: 'IMP-001', author: ME, created_at: '2026-10-01 00:00:02', body: 'mine2' },
    ]),
    'change_log.csv': 'id,at,actor,target_id,action,field,before,after\n',
    'velocity.csv': 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n'
      + 'sprint001,10,5,0,2026-10-01,2026-10-14,\n',
  };
}

/** 本物のサーバ。opts.failWriteFile は処理の途中で入れ替えられる（partial の再現）。 */
function createServer(files) {
  const opts = { failWriteFile: null };
  let tick = 0;
  function iter(arr) { let i = 0; return { hasNext: function () { return i < arr.length; }, next: function () { return arr[i++]; } }; }
  function file(name) {
    return {
      getBlob: function () { return { getDataAsString: function () { return files[name]; } }; },
      setContent: function (c) {
        if (opts.failWriteFile && name === opts.failWriteFile) throw new Error('書けませんでした: ' + name);
        files[name] = c;
      },
    };
  }
  const scrum = { getFilesByName: function (n) { return Object.prototype.hasOwnProperty.call(files, n) ? iter([file(n)]) : iter([]); } };
  const root = { getFoldersByName: function (n) { return n === 'scrum' ? iter([scrum]) : iter([]); } };
  const props = { SCRUM_FOLDER_ID: 'f' };
  const cache = {};   // CacheService（取り消しの鍵の預け先）
  let uuid = 0x100;
  const ctx = {
    console: console,
    DriveApp: { getFolderById: function () { return root; } },
    LockService: { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } },
    PropertiesService: { getScriptProperties: function () { return {
      getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
      setProperty: function (k, v) { props[k] = v; },
    }; } },
    Session: { getScriptTimeZone: function () { return 'UTC'; }, getActiveUser: function () { return { getEmail: function () { return ME; } }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { return Object.prototype.hasOwnProperty.call(cache, k) ? cache[k] : null; },
      put: function (k, v) { cache[k] = String(v); },
      remove: function (k) { delete cache[k]; },
    }; } },
    Utilities: {
      getUuid: function () { uuid++; return ('0000000' + uuid.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; },
      // 時刻は呼ぶたびに1秒進める（決定的にする）。
      formatDate: function () {
        tick++;
        const s = tick % 60, m = Math.floor(tick / 60) % 60, hh = Math.floor(tick / 3600);
        const p = function (n) { return n < 10 ? '0' + n : String(n); };
        return '2026-10-06 ' + p(hh) + ':' + p(m) + ':' + p(s);
      },
    },
  };
  vm.createContext(ctx);
  gasFileNames().forEach(function (n) { vm.runInContext(fs.readFileSync(path.join(GAS_DIR, n), 'utf8'), ctx, { filename: n }); });
  return {
    files: files,
    opts: opts,
    call: function (method, args) {
      const a = JSON.parse(JSON.stringify(args));
      return JSON.parse(JSON.stringify(ctx[method].apply(null, a)));
    },
  };
}

/** 盤面の真の値 [{status, cards:[id]}]。 */
function trueBoard(server) {
  const v = server.call('apiGetView', ['board']);
  return v.view.columns.map(function (c) { return { status: c.status, cards: c.cards.map(function (x) { return x.id; }) }; });
}
/** コメントの真の値 { <target_id>: [comment] }。ビューは件数だけを運ぶので、件数のある対象を1つずつ取る。 */
function trueComments(server) {
  const counts = server.call('apiGetView', ['board']).commentCounts || {};
  const out = {};
  Object.keys(counts).forEach(function (t) { out[t] = server.call('apiGetComments', [t]).comments; });
  return out;
}
function trueImp(server) {
  const v = server.call('apiGetView', ['impediment']).view;
  return {
    // 画面は ID が重なっている行のタイトルに印を足す（押せない行）。サーバのビューの印もその文言で比べる。
    open: v.open.map(function (r) { return r.id + ':' + r.title + (r.duplicate === 'true' ? '（ID が重複しています。CSV を直してください）' : ''); }),
    resolved: v.resolved.map(function (r) { return r.id + ':' + r.title; }),
    pending: v.pending.map(function (p) { return p.id; }),
  };
}

function collect(el, pred, out) {
  out = out || [];
  el.children.forEach(function (c) { if (pred(c)) out.push(c); collect(c, pred, out); });
  return out;
}
function allText(el) {
  const t = [];
  (function w(e) { if (e.textContent) t.push(e.textContent); e.children.forEach(w); })(el);
  return t.join(' ');
}

/**
 * 世界: サーバ + 画面。calls は番号（発行順）で指す。
 */
function createWorld(opts) {
  opts = opts || {};
  const server = createServer(initialFiles());
  const h = createHarness([]);
  const meta = new Map();   // call -> { n, res|null }
  let nextN = 0;
  const log = [];
  const tag = function () {
    h.calls.forEach(function (c) { if (!meta.has(c)) meta.set(c, { n: nextN++, res: null, processed: false }); });
  };
  const byN = function (n) { tag(); return h.calls.filter(function (c) { return meta.get(c).n === n; })[0] || null; };

  const world = {
    server: server, h: h, log: log,
    pendingNs: function () { tag(); return h.calls.map(function (c) { return meta.get(c).n; }); },
    methodOf: function (n) { const c = byN(n); return c ? c.method : null; },
    unprocessedNs: function () { tag(); return h.calls.filter(function (c) { return !meta.get(c).processed; }).map(function (c) { return meta.get(c).n; }); },
    processedNs: function () { tag(); return h.calls.filter(function (c) { return meta.get(c).processed; }).map(function (c) { return meta.get(c).n; }); },
    /** サーバで処理する。kind: 'ok'（普通）/ 'busy'（ロックを取れない）/ 'partial'（2つ目の書き込みが失敗） */
    process: function (n, kind) {
      const c = byN(n);
      if (!c) throw new Error('呼び出し ' + n + ' がありません');
      const m = meta.get(c);
      if (m.processed) throw new Error('呼び出し ' + n + ' は処理済み');
      kind = kind || 'ok';
      if (kind === 'busy') {
        const busy = { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。' };
        if (/Pbi|Status/.test(c.method)) busy.board = null;
        m.res = busy;
      } else if (kind === 'partial') {
        server.opts.failWriteFile = c.method === 'apiResolveImpediment' ? 'impediment_log.csv' : 'impediment_log_resolved.csv';
        try { m.res = server.call(c.method, c.args); } finally { server.opts.failWriteFile = null; }
      } else {
        m.res = server.call(c.method, c.args);
      }
      m.processed = true;
      log.push({ op: 'process', n: n, kind: kind, method: c.method });
    },
    /** 届ける。処理済みなら success、未処理なら failure（サーバに届かなかった）。 */
    deliver: function (n) {
      const c = byN(n);
      if (!c) throw new Error('呼び出し ' + n + ' がありません');
      const m = meta.get(c);
      log.push({ op: 'deliver', n: n, method: c.method, failure: !m.processed });
      if (m.processed) c.handlers.success(m.res);
      else c.handlers.failure({ message: '通信に失敗しました' });
    },
    /** 全部処理して全部届ける（発行順）。 */
    drain: function () {
      let guard = 0;
      while (h.calls.length) {
        if (++guard > 200) throw new Error('drain が終わりません');
        const n = world.pendingNs()[0];
        if (world.unprocessedNs().indexOf(n) !== -1) world.process(n);
        world.deliver(n);
      }
    },
    /**
     * パネルを開いたときのコメントの取得（apiGetComments）だけを、今のサーバで処理して届ける。
     * 他の未応答の呼び出しには触らない（狙った順序のテストで、開くたびの取得を片付けるため）。
     */
    answerCommentReads: function () {
      world.pendingNs().filter(function (n) { return world.methodOf(n) === 'apiGetComments'; })
        .forEach(function (n) { world.process(n); world.deliver(n); });
    },
    /** 最初の読み込みを済ませる。 */
    boot: function () {
      h.sandbox.load();
      world.drain();
    },
    // --- 画面の読み取り ---
    doc: function () { return h.sandbox.document; },
    el: function (id) { return h.sandbox.document.getElementById(id); },
    activeTable: function () { return h.sandbox.document.getElementById('table-view'); },
    /** 障害物の表を DOM から読む { open, resolved, pending }（見出しで区切る）。 */
    impTable: function () {
      const host = world.activeTable();
      const out = { open: [], resolved: [], pending: [] };
      host.children.forEach(function (sec) {
        const h3 = sec.children.filter(function (x) { return x.tagName === 'h3'; })[0];
        if (!h3) return;
        const key = h3.textContent === '未解決' ? 'open' : h3.textContent === '解決済' ? 'resolved' : h3.textContent === '途中で止まった操作' ? 'pending' : null;
        if (!key) return;
        const trs = collect(sec, function (e) { return e.tagName === 'tr' && e.parentNode && e.parentNode.tagName === 'tbody'; });
        trs.forEach(function (tr) {
          const tds = tr.children;
          if (key === 'pending') out.pending.push(tds[0].textContent);
          else out[key].push(tds[0].textContent + ':' + tds[1].textContent);
        });
      });
      return out;
    },
    /** 障害物の表のコメント件数 {id: 'コメント n'} */
    impCounts: function () {
      const out = {};
      collect(world.activeTable(), function (e) { return e.tagName === 'tr'; }).forEach(function (tr) {
        const cnt = collect(tr, function (e) { return e.classList.contains('comment-count'); })[0];
        const id = tr.children[0] && tr.children[0].textContent;
        if (cnt && id) out[id] = (out[id] ? out[id] + '|' : '') + cnt.textContent;
      });
      return out;
    },
    allText: allText,
    collect: collect,
  };
  return world;
}

/** 決まった種から 0〜1 の乱数を返す関数（mulberry32）。 */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

module.exports = { createWorld, createServer, initialFiles, trueBoard, trueComments, trueImp, mulberry32, ME, collect, allText };
