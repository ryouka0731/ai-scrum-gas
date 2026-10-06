'use strict';
/**
 * bughunt E 専用の道具。既存の browser 基盤（chrome_session / fixtures / standalone_page）は
 * require で使い、変更しない。ここで足すのは
 *  - 敵対的な値を載せた見本データ（PBI / 障害物 / コメント / 履歴）から組んだ応答
 *  - 書き込み API（コメント追加など）にも応える google.script.run の代役
 */
const fs = require('node:fs');
const { responses, VELOCITY } = require('./fixtures.js');
const { viewportContentFromDoGet, KANBAN_PATH } = require('./standalone_page.js');
const { buildBoardData } = require('../../pure_board_view.js');
const { buildListView, buildDoneView } = require('../../pure_view_backlog.js');
const { buildBurndownView, buildVelocityView, buildRoadmapView } = require('../../pure_view_sprint.js');
const { summarizeSprint } = require('../../pure_summary.js');
const { buildImpedimentView } = require('../../pure_view_impediment.js');
const { summarizeBacklog, summarizeImpediment } = require('../../pure_summary.js');
const { KANBAN_STATUSES } = require('../../pure_grid_board.js');
const { sprintChoices } = require('../../pure_sprint_options.js');
const { countComments } = require('../../pure_comment.js');
const { historyFor, HISTORY_LIMIT } = require('../../pure_history.js');

/** 実行されたら立つ旗の名前。 */
const XSS_FLAG = '__xss';

/** 文字列として画面に出ても、実行されてはならない値。 */
const PAYLOADS = [
  '<img src=x onerror="window.' + XSS_FLAG + '=1">',
  '</script><script>window.' + XSS_FLAG + '=2</script>',
  '<svg onload="window.' + XSS_FLAG + '=3"></svg>',
  '"><b onmouseover="window.' + XSS_FLAG + '=4">x</b>',
  "' onfocus='window." + XSS_FLAG + "=5' autofocus='",
  'javascript:window.' + XSS_FLAG + '=6',
  '<a href="javascript:window.' + XSS_FLAG + '=7">link</a>',
  '<iframe srcdoc="<script>parent.' + XSS_FLAG + '=8</script>"></iframe>',
  '<style>body{display:none}</style>',
  '‮evil‬ RTL ​​zero‍width⁠ é́́́',
];

function buildResponses(data) {
  const base = responses();
  const rows = data.rows;
  const open = data.impOpen || [];
  const resolved = data.impResolved || [];
  const counts = countComments(data.comments || []);
  const out = {};
  Object.keys(base).forEach(function (k) {
    out[k] = Object.assign({}, base[k]);
    if (Object.prototype.hasOwnProperty.call(out[k], 'commentCounts')) out[k].commentCounts = counts;
  });
  const sum = summarizeBacklog(rows, KANBAN_STATUSES);
  out.board = Object.assign({}, out.board, { view: buildBoardData(rows), summary: sum, sprintChoices: sprintChoices(VELOCITY, rows) });
  out.list = Object.assign({}, out.list, { view: buildListView(rows), summary: sum });
  out.done = Object.assign({}, out.done, { view: buildDoneView(rows), summary: sum });
  out.impediment = Object.assign({}, out.impediment, {
    view: buildImpedimentView(open, resolved),
    summary: summarizeImpediment(open, resolved),
    sprintChoices: sprintChoices(VELOCITY, open.concat(resolved)),
  });
  // スプリント系のビューも、敵対的な値を載せた入力から組む。
  const velocity = data.velocity || VELOCITY;
  const md = data.sprintMd || [
    '# スプリントバックログ', '', '## スプリントゴール', '', 'ゴール', '', '## バーンダウン', '',
    '| 日付 | 残タスク数 | 残ポイント |', '|------|------------|------------|',
    '| 2026-08-29 | 12 | 14 |', '| 2026-09-01 | 9 | 11 |', '', '## PBI', ''].join('\n');
  const sprintSummary = summarizeSprint(velocity, md);
  out.burndown = Object.assign({}, out.burndown, { view: buildBurndownView(md), summary: sprintSummary });
  out.velocity = Object.assign({}, out.velocity, { view: buildVelocityView(velocity), summary: sprintSummary });
  out.roadmap = Object.assign({}, out.roadmap, { view: buildRoadmapView(rows, velocity), summary: sprintSummary });
  return out;
}

function stubScript(data) {
  const cfg = {
    responses: buildResponses(data),
    history: { ok: true, entries: historyFor(data.history || [], data.historyTarget || 'PBI-001', HISTORY_LIMIT) },
    historyTarget: data.historyTarget || 'PBI-001',
    commentRows: data.comments || [],
    me: data.me || 'me',
    afterDelete: (function () {
      const o = {};
      data.rows.forEach(function (r) { o[r.id] = buildBoardData(data.rows.filter(function (x) { return x.id !== r.id; })); });
      return o;
    })(),
    rows: data.rows,
  };
  return '<script>\n(function () {\n'
    + 'window.__pageToken = "__PAGE_TOKEN__";\n'
    + 'var CFG = ' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ';\n'
    + 'window.__calls = []; window.__errors = [];\n'
    + 'window.addEventListener("error", function (e) { window.__errors.push(String(e.message)); });\n'
    + 'var seq = 100;\n'
    + 'function listOf(t) { return CFG.commentRows.filter(function (c) { return c.target_id === t; }).map(function (c) { return Object.assign({}, c, { mine: c.author === CFG.me }); }); }\n'
    + 'function forTarget(t) { var l = listOf(t); return { targetId: t, comments: l, count: l.length }; }\n'
    + 'function makeRunner() {\n'
    + '  var ok = null, ng = null;\n'
    + '  var r = { withSuccessHandler: function (f) { ok = f; return r; }, withFailureHandler: function (f) { ng = f; return r; } };\n'
    + '  function reply(fn) { setTimeout(function () { if (ok) ok(fn()); }, 0); }\n'
    + '  r.apiGetView = function (name) { window.__calls.push({ method: "apiGetView", args: [name] }); reply(function () { return CFG.responses[name] || { ok: false, message: "none" }; }); };\n'
    + '  r.apiGetComments = function (id) { window.__calls.push({ method: "apiGetComments", args: [id] }); reply(function () { return { ok: true, comments: listOf(id) }; }); };\n'
    + '  r.apiGetHistory = function (id) { window.__calls.push({ method: "apiGetHistory", args: [id] }); reply(function () { return id === CFG.historyTarget ? CFG.history : { ok: true, entries: [] }; }); };\n'
    + '  r.apiAddComment = function (id, body) { window.__calls.push({ method: "apiAddComment", args: [id, body] }); reply(function () {\n'
    + '    var c = { id: "CMT-" + ("0000000" + (seq++).toString(16)).slice(-8), target_id: id, author: CFG.me, created_at: "2026-10-01 12:00:00", body: body };\n'
    + '    CFG.commentRows.push(c); return Object.assign({ ok: true, comment: Object.assign({}, c) }, forTarget(id)); }); };\n'
    + '  r.apiDeleteComment = function (id) { window.__calls.push({ method: "apiDeleteComment", args: [id] }); reply(function () {\n'
    + '    var i = CFG.commentRows.findIndex(function (c) { return c.id === id; }); var rem = CFG.commentRows.splice(i, 1)[0];\n'
    + '    return Object.assign({ ok: true, removed: rem }, forTarget(rem.target_id)); }); };\n'
    + '  r.apiDeletePbi = function (id) { window.__calls.push({ method: "apiDeletePbi", args: [id] }); reply(function () {\n'
    + '    var row = CFG.rows.filter(function (x) { return x.id === id; })[0] || null;\n'
    + '    return { ok: true, board: CFG.afterDelete[id], id: null, undoToken: "tok-del", removed: row }; }); };\n'
    + '  ["apiUpdateStatus", "apiCreatePbi", "apiUpdatePbi", "apiRestorePbi", "apiRestoreComment", "apiResolveImpediment", "apiUnresolveImpediment", "apiCreateImpediment", "apiUpdateImpediment"].forEach(function (m) {\n'
    + '    r[m] = function () { window.__calls.push({ method: m, args: Array.prototype.slice.call(arguments) });\n'
    + '      reply(function () { return { ok: false, message: "stub: " + m }; }); };\n'
    + '  });\n'
    + '  return r;\n'
    + '}\n'
    + 'window.google = { script: { host: { close: function () {} } } };\n'
    + 'Object.defineProperty(window.google.script, "run", { get: makeRunner });\n'
    + '})();\n</script>\n';
}

function buildPage(data) {
  let src = fs.readFileSync(KANBAN_PATH, 'utf8');
  const charset = '<meta charset="utf-8">';
  src = src.replace(charset, charset + '\n<meta name="viewport" content="' + viewportContentFromDoGet() + '">');
  const at = src.indexOf('<script>');
  return src.slice(0, at) + stubScript(data) + src.slice(at);
}

function row(over) {
  return Object.assign({ id: 'PBI-001', title: 'タイトル', status: 'New', priority: 'Medium', size: '3',
    sprint: 'sprint003', acceptance_criteria: '基準', description: '', updated_at: '2026-09-01 10:00:00' }, over);
}
function imp(over) {
  return Object.assign({ id: 'IMP-001', title: '障害', description: '説明', reported_by: 'マヤ',
    reported_at: '2026-09-01', status: 'open', resolved_at: '', resolution: '', sprint: 'sprint003' }, over);
}

/** ページ内で評価する式の小さな道具。 */
const JS = {
  boardReady: 'return document.querySelectorAll("#board .card").length > 0 ? 1 : 0',
  click: function (sel) {
    return 'var e=document.querySelector(' + JSON.stringify(sel) + '); if(!e) return false; e.click(); return true;';
  },
  clickText: function (rootSel, text) {
    return 'var bs=document.querySelectorAll(' + JSON.stringify(rootSel + ' button') + ');'
      + 'for (var i=0;i<bs.length;i++){ if (bs[i].textContent.trim()===' + JSON.stringify(text) + '){ bs[i].click(); return true; } } return false;';
  },
  escape: 'var t=document.activeElement||document.body; t.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true})); return true;',
};

module.exports = { PAYLOADS, XSS_FLAG, buildPage, row, imp, JS, buildResponses };
