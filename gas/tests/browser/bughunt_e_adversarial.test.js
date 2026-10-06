'use strict';
/**
 * bughunt E: 敵対的な入力とキーボード/アクセシビリティの検査（実ブラウザ）。
 *
 * 通る検査だけをここに置く。実バグを突く検査は
 * gas/tests/browser/bughunt_e_failing.test.js.txt に分けてある（`.txt` を外せば走る）。
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { chromePath, launch } = require('./chrome_session.js');
const { PAYLOADS, XSS_FLAG, buildPage, row, imp, JS } = require('./bughunt_e_support.js');

const CHROME = chromePath();
const SKIP = CHROME ? false : 'Chrome が見つからないので飛ばします（CHROME_PATH で指定できます）';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const P = PAYLOADS;

/** 全項目に敵対的な値を載せた見本。 */
function hostileData() {
  const rows = [
    row({ id: 'PBI-001', title: P[0], sprint: P[1], acceptance_criteria: P[2], description: P[3], status: 'New' }),
    row({ id: 'PBI-002', title: P[4], sprint: P[5], status: 'Ready', priority: 'High' }),
    row({ id: 'PBI-003', title: P[6] + P[7], status: 'In Progress', acceptance_criteria: P[8] + ';' + P[9] }),
    row({ id: 'PBI-004', title: P[9], status: 'Done', sprint: P[7] }),
  ];
  const comments = [
    { id: 'CMT-00000001', target_id: 'PBI-001', author: P[5] + '@example.com', created_at: '2026-09-10 10:00:00',
      body: P[6] + '\n' + P[7] + '\n' + P[0] },
    { id: 'CMT-00000002', target_id: 'PBI-001', author: P[0], created_at: '2026-09-10 10:01:00', body: P[1] },
    { id: 'CMT-00000003', target_id: 'IMP-001', author: P[2], created_at: '2026-09-10 10:02:00', body: P[3] },
  ];
  const history = [
    { id: 'LOG-01', at: '2026-09-01 09:00:00', actor: P[2], target_id: 'PBI-001', action: 'update',
      field: 'description', before: P[0] + '\n' + P[1], after: P[1] + '\n' + P[2] },
    { id: 'LOG-02', at: '2026-09-01 09:00:00', actor: P[2], target_id: 'PBI-001', action: 'update',
      field: 'title', before: P[3], after: P[4] },
  ];
  const velocity = [
    { sprint: P[0], planned_points: '10', completed_points: '8', carried_over_points: '2',
      sprint_start: '2026-08-01', sprint_end: '2026-08-14', notes: P[1] },
    { sprint: 'sprint003', planned_points: '14', completed_points: '', carried_over_points: '',
      sprint_start: '2026-08-29', sprint_end: '2026-09-11', notes: P[2] },
  ];
  const sprintMd = ['# スプリントバックログ', '', '## スプリントゴール', '', P[0] + ' ' + P[1], '',
    '## バーンダウン', '', '| 日付 | 残タスク数 | 残ポイント |', '|------|------------|------------|',
    '| 2026-08-29 | 12 | 14 |', '| 2026-09-01 | 9 | 11 |', '', '## PBI', ''].join('\n');
  return {
    rows: rows, comments: comments, history: history, historyTarget: 'PBI-001', me: 'me',
    velocity: velocity, sprintMd: sprintMd,
    impOpen: [imp({ id: 'IMP-001', title: P[0], description: P[1], reported_by: P[2], sprint: P[3] }),
      imp({ id: 'IMP-002', title: P[4], description: P[5], reported_by: P[6], sprint: 'sprint003' })],
    impResolved: [imp({ id: 'IMP-000', title: P[7], description: P[8], reported_by: P[9], status: 'resolved',
      resolved_at: '2026-09-02', resolution: P[0] + P[1], sprint: 'sprint002' })],
  };
}

/** ページ内で評価する。実行された形跡を数える。 */
const INJECTION_AUDIT = [
  'var sel = "[onerror],[onload],[onmouseover],[onfocus],[onclick],iframe,img[src=\\"x\\"],a[href^=\\"javascript\\"],svg[onload],object,embed";',
  'return {',
  '  flag: window.' + XSS_FLAG + ' === undefined ? null : window.' + XSS_FLAG + ',',
  '  injected: document.querySelectorAll(sel).length,',
  '  scripts: document.scripts.length,',
  '  styles: document.querySelectorAll("style").length,',
  '  bodyDisplay: getComputedStyle(document.body).display,',
  '  errors: window.__errors.slice()',
  '};',
].join('\n');

/** 名前を持つべき操作部品の「アクセシブルな名前」を一覧にする。 */
const NAME_AUDIT = [
  'function nameOf(e) {',
  '  var a = e.getAttribute("aria-label"); if (a && a.trim()) return a.trim();',
  '  var lb = e.getAttribute("aria-labelledby");',
  '  if (lb) { var t = lb.split(/\\s+/).map(function (i) { var x = document.getElementById(i); return x ? x.textContent : ""; }).join(" ").trim(); if (t) return t; }',
  '  if (e.labels && e.labels.length) { var l = Array.from(e.labels).map(function (x) { return x.textContent; }).join(" ").trim(); if (l) return l; }',
  '  if (e.tagName === "BUTTON") return e.textContent.trim();',
  '  return (e.getAttribute("title") || "").trim();',
  '}',
  'return Array.from(document.querySelectorAll("button,input,select,textarea")).filter(function (e) {',
  '  return e.getClientRects().length > 0 && !e.closest("[hidden]") && e.type !== "hidden"; })',
  '  .map(function (e) { return { tag: e.tagName, id: e.id, cls: String(e.className), name: nameOf(e) }; });',
].join('\n');

describe('bughunt E: 実ブラウザの敵対的入力・キーボード・アクセシビリティ', { skip: SKIP }, () => {
  let session = null;
  before(async () => { session = await launch(); });

  /** 本物の Tab（Shift+Tab）を押す。ページの JS ではなくブラウザが焦点を動かす。 */
  async function pressTab(shift) {
    const key = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
    await session.send('Input.dispatchKeyEvent', Object.assign({ type: 'rawKeyDown' }, key));
    await session.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, key));
  }
  after(async () => { if (session) await session.close(); });

  async function openPage(html, width, scheme) {
    await session.open({ html: html, width: width, height: 800, scheme: scheme || 'light' });
    await session.waitFor(JS.boardReady, '盤面の初回読み込み');
  }

  async function gotoView(tabLabel, viewLabel) {
    assert.equal(await session.evaluate(JS.clickText('#tabs', tabLabel)), true, 'タブ ' + tabLabel + ' が押せない');
    if (viewLabel) {
      assert.equal(await session.evaluate(JS.clickText('#views', viewLabel)), true, 'ビュー ' + viewLabel + ' が押せない');
    }
    await sleep(120);
    await session.waitFor('return document.getElementById("message").textContent.indexOf("読み込んでいます") === -1 ? 1 : 0',
      tabLabel + '/' + viewLabel + ' の読み込み');
  }

  // ---- XSS -------------------------------------------------------------------------
  const CONDITIONS = [[375, 'dark'], [1440, 'light'], [600, 'dark']];

  CONDITIONS.forEach(function (cond) {
    const width = cond[0], scheme = cond[1];
    const where = width + 'px / ' + scheme;

    test('XSS: 全7ビューで、どの欄のペイロードも実行されず文字のまま出る (' + where + ')', async () => {
      const html = buildPage(hostileData());
      await openPage(html, width, scheme);
      const base = await session.evaluate(INJECTION_AUDIT);
      const views = [['やること', '盤面'], ['やること', '一覧'], ['やること', '完了'],
        ['スプリント', 'バーンダウン'], ['スプリント', 'ベロシティ'], ['スプリント', 'ロードマップ'], ['障害物', null]];
      for (const v of views) {
        await gotoView(v[0], v[1]);
        const a = await session.evaluate(INJECTION_AUDIT);
        const at = where + ' ' + v.join('/');
        assert.equal(a.flag, null, at + ': ペイロードが実行された（window.' + XSS_FLAG + '=' + a.flag + '）');
        assert.equal(a.injected, 0, at + ': 実行可能な要素・属性が DOM に入った');
        assert.equal(a.scripts, base.scripts, at + ': script 要素が増えた');
        assert.equal(a.styles, base.styles, at + ': style 要素が増えた（<style> ペイロードが効いた）');
        assert.notEqual(a.bodyDisplay, 'none', at + ': <style> ペイロードで画面が消えた');
        assert.deepEqual(a.errors, [], at + ': JS 例外');
      }
      // 盤面に戻り、カードのタイトルが文字のまま出ていること（解釈されていない証拠）。
      await gotoView('やること', '盤面');
      const titles = await session.evaluate(
        'return Array.from(document.querySelectorAll("#board .card .title")).map(function (e) { return e.textContent; });');
      [P[0], P[4], P[9]].forEach(function (p) {
        assert.ok(titles.indexOf(p) !== -1, where + ': タイトル ' + JSON.stringify(p) + ' が文字のまま出ていない');
      });
    });
  });

  test('XSS: PBI パネルの入力欄・コメント・履歴・障害物パネルも文字のまま（実行されない）', async () => {
    const html = buildPage(hostileData());
    await openPage(html, 1440, 'light');
    // PBI-001 のカードを開く。
    assert.equal(await session.evaluate(
      'var c=document.querySelector("#board .card[data-id=\\"PBI-001\\"]"); if(!c) return false; c.click(); return true;'), true);
    await sleep(100);
    const form = await session.evaluate(
      'return { title: document.getElementById("f-title").value, desc: document.getElementById("f-description").value,'
      + ' acc: document.getElementById("f-acceptance").value, sprint: document.getElementById("f-sprint").value };');
    assert.equal(form.title, P[0], 'タイトル欄に載る値が壊れている');
    assert.equal(form.desc, P[3], '説明欄に載る値が壊れている');
    assert.equal(form.acc, P[2], '受入基準欄に載る値が壊れている');
    assert.equal(form.sprint, P[1].trim(), 'スプリント欄に載る値が壊れている');

    const comments = await session.evaluate(
      'return Array.from(document.querySelectorAll("#panel-comments .comment-body")).map(function (e) { return e.textContent; });');
    assert.deepEqual(comments, [P[6] + '\n' + P[7] + '\n' + P[0], P[1]], 'コメント本文が文字のまま出ていない');

    assert.equal(await session.evaluate(JS.clickText('#panel-history', '履歴')), true);
    await session.waitFor('return document.querySelector("#panel-history .history-group") ? 1 : 0', '履歴の描画');
    const hist = await session.evaluate(
      'return document.getElementById("panel-history").textContent;');
    assert.ok(hist.indexOf(P[0].split('\n')[0]) !== -1, '履歴の差分に before の値が文字として出ていない');
    const a = await session.evaluate(INJECTION_AUDIT);
    assert.equal(a.flag, null);
    assert.equal(a.injected, 0);
    assert.deepEqual(a.errors, []);

    // 障害物パネル
    await gotoView('障害物', null);
    await session.waitFor('return document.querySelector("#table-view tr.clickable") ? 1 : 0', '障害物の行');
    await session.evaluate('document.querySelector("#table-view tr.clickable").click(); return 1;');
    await sleep(100);
    const iv = await session.evaluate(
      'return { t: document.getElementById("i-title").value, d: document.getElementById("i-description").value,'
      + ' r: document.getElementById("i-reported-by").value };');
    assert.equal(iv.t, P[0]);
    assert.equal(iv.d, P[1]);
    assert.equal(iv.r, P[2]);
    const a2 = await session.evaluate(INJECTION_AUDIT);
    assert.equal(a2.flag, null);
    assert.equal(a2.injected, 0);
    assert.deepEqual(a2.errors, []);
  });

  test('XSS: 入力したコメントは一字も変わらずサーバへ渡り、返ってきても文字のまま出る', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' })], comments: [], me: 'me', impOpen: [imp()], impResolved: [] });
    await openPage(html, 1024, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    const payload = P.join('\n');
    await session.evaluate('var i=document.querySelector("#panel-comments .comment-input"); i.value=' + JSON.stringify(payload)
      + '; i.dispatchEvent(new Event("input",{bubbles:true})); document.querySelector("#panel-comments .comment-send").click(); return 1;');
    await session.waitFor('return document.querySelector("#panel-comments .comment-body") ? 1 : 0', 'コメントの反映');
    const r = await session.evaluate(
      'return { sent: window.__calls.filter(function (c) { return c.method === "apiAddComment"; })[0].args[1],'
      + ' shown: document.querySelector("#panel-comments .comment-body").textContent };');
    assert.equal(r.sent, payload, 'サーバへ渡る本文が入力と違う');
    assert.equal(r.shown, payload, '表示される本文が入力と違う');
    const a = await session.evaluate(INJECTION_AUDIT);
    assert.equal(a.flag, null);
    assert.equal(a.injected, 0);
  });

  // ---- 巨大な値・制御文字 ------------------------------------------------------------
  [[375, 'light'], [1440, 'dark']].forEach(function (cond) {
    const width = cond[0], scheme = cond[1];
    test('巨大な値: 2000字のタイトル150件でも盤面・一覧が固まらず、ページが横に伸びない (' + width + 'px / ' + scheme + ')', async () => {
      const statuses = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
      const rows = [];
      for (let i = 1; i <= 150; i++) {
        const id = 'PBI-' + ('000' + i).slice(-3);
        rows.push(row({ id: id, status: statuses[i % 5],
          title: (i % 2 ? 'あ'.repeat(2000) : 'W'.repeat(2000)), sprint: 'sprint003',
          acceptance_criteria: 'x'.repeat(2000) }));
      }
      const html = buildPage({ rows: rows, comments: [], impOpen: [imp()], impResolved: [] });
      const t0 = Date.now();
      await openPage(html, width, scheme);
      const ms = Date.now() - t0;
      assert.ok(ms < 8000, '盤面の描画に ' + ms + 'ms かかった');
      const board = await session.evaluate('return { cards: document.querySelectorAll("#board .card").length,'
        + ' sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };');
      assert.equal(board.cards, 150);
      assert.ok(board.sw <= board.cw, '盤面でページが横に伸びた（' + board.sw + ' > ' + board.cw + '）');
      await gotoView('やること', '一覧');
      const list = await session.evaluate('return { rows: document.querySelectorAll("#table-view tbody tr").length,'
        + ' sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };');
      assert.equal(list.rows, 150);
      assert.ok(list.sw <= list.cw, '一覧でページが横に伸びた（' + list.sw + ' > ' + list.cw + '）');
      assert.deepEqual(await session.evaluate('return window.__errors;'), []);
    });
  });

  [375, 1440].forEach(function (width) {
    test('巨大な値: 500行の説明・2000字のコメント・500行のコメントでも、パネルの操作部へ届く (' + width + 'px)', async () => {
      const html = buildPage({
        rows: [row({ id: 'PBI-001', title: 'W'.repeat(3000), description: 'line\n'.repeat(500), acceptance_criteria: 'a;'.repeat(500) })],
        comments: [
          { id: 'CMT-00000001', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:00:00', body: 'Z'.repeat(2000) },
          { id: 'CMT-00000002', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:01:00', body: 'l\n'.repeat(500) },
        ],
        impOpen: [imp({ title: 'T'.repeat(5000), description: 'D'.repeat(5000) })], impResolved: [],
      });
      await openPage(html, width, 'dark');
      await session.evaluate(JS.click('#board .card'));
      await sleep(100);
      const m = await session.evaluate(
        'var p=document.getElementById("panel");'
        + 'var ids=["panel-save","panel-delete","panel-close"]; var out={};'
        + 'ids.forEach(function(id){ var b=document.getElementById(id); b.scrollIntoView({block:"center"});'
        + '  var r=b.getBoundingClientRect(); var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);'
        + '  out[id]={inView:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth, hit: !!(hit&&(hit===b||b.contains(hit)))}; });'
        + 'var send=document.querySelector("#panel-comments .comment-send"); send.scrollIntoView({block:"center"});'
        + 'var sr=send.getBoundingClientRect(); var sh=document.elementFromPoint(sr.left+sr.width/2, sr.top+sr.height/2);'
        + 'out.send={inView:sr.top>=0&&sr.bottom<=innerHeight, hit: !!(sh&&(sh===send||send.contains(sh)))};'
        + 'out.panelOverflow=[p.scrollWidth,p.clientWidth]; out.page=[document.documentElement.scrollWidth, document.documentElement.clientWidth];'
        + 'return out;');
      ['panel-save', 'panel-delete', 'panel-close', 'send'].forEach(function (k) {
        assert.equal(m[k].inView, true, width + 'px: ' + k + ' が画面に入らない');
        assert.equal(m[k].hit, true, width + 'px: ' + k + ' が他の要素に覆われて押せない');
      });
      assert.ok(m.panelOverflow[0] <= m.panelOverflow[1], width + 'px: パネルが横に溢れた ' + m.panelOverflow);
      assert.ok(m.page[0] <= m.page[1], width + 'px: ページが横に伸びた ' + m.page);

      // 障害物パネルも同じ。
      await session.evaluate(JS.escape);
      await gotoView('障害物', null);
      await session.waitFor('return document.querySelector("#table-view tr.clickable") ? 1 : 0', '障害物の行');
      await session.evaluate('document.querySelector("#table-view tr.clickable").click(); return 1;');
      await sleep(100);
      const im = await session.evaluate(
        'var out={}; ["imp-panel-save","imp-panel-resolve","imp-panel-close"].forEach(function(id){ var b=document.getElementById(id);'
        + ' b.scrollIntoView({block:"center"}); var r=b.getBoundingClientRect();'
        + ' var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);'
        + ' out[id]={inView:r.top>=0&&r.bottom<=innerHeight, hit:!!(hit&&(hit===b||b.contains(hit)))}; });'
        + 'out.page=[document.documentElement.scrollWidth, document.documentElement.clientWidth]; return out;');
      ['imp-panel-save', 'imp-panel-resolve', 'imp-panel-close'].forEach(function (k) {
        assert.equal(im[k].inView, true, width + 'px: ' + k + ' が画面に入らない');
        assert.equal(im[k].hit, true, width + 'px: ' + k + ' が覆われて押せない');
      });
      assert.ok(im.page[0] <= im.page[1], width + 'px: 障害物パネルでページが横に伸びた');
      assert.deepEqual(await session.evaluate('return window.__errors;'), []);
    });
  });

  test('巨大な値: 3000行ずつの説明の差分の履歴でも、数秒以内に描き終わり固まらない', async () => {
    const before = Array.from({ length: 3000 }, (_, i) => 'before line ' + i).join('\n');
    const after = Array.from({ length: 3000 }, (_, i) => 'after line ' + i).join('\n');
    const html = buildPage({
      rows: [row({ id: 'PBI-001' })], comments: [], impOpen: [imp()], impResolved: [], historyTarget: 'PBI-001',
      history: [{ id: 'LOG-01', at: '2026-09-01 09:00:00', actor: 'a', target_id: 'PBI-001', action: 'update',
        field: 'description', before: before, after: after }],
    });
    await openPage(html, 1024, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    const t0 = Date.now();
    await session.evaluate(JS.clickText('#panel-history', '履歴'));
    await session.waitFor('return document.querySelector("#panel-history .history-line") ? 1 : 0', '履歴の描画', 15000);
    const ms = Date.now() - t0;
    assert.ok(ms < 5000, '履歴の描画に ' + ms + 'ms かかった');
    const w = await session.evaluate('return [document.documentElement.scrollWidth, document.documentElement.clientWidth];');
    assert.ok(w[0] <= w[1], '履歴でページが横に伸びた');
  });

  test('制御文字・絵文字・結合文字・サロゲートの崩れたタイトルでも例外にならず、カードが描かれる', async () => {
    const weird = [
      'a\u0000b\u0007c\u001b[31m\r\n   end',
      '🧑‍🧑‍🧒‍🧒🇯🇵👍🏽 é́́́́́ ก้้้้',
      'lone \ud800 surrogate \udfff',
      '‮abc‬ ⁦x⁩ ​​​',
    ];
    const rows = weird.map(function (t, i) { return row({ id: 'PBI-00' + (i + 1), title: t, status: 'New' }); });
    const html = buildPage({ rows: rows, comments: [], impOpen: [imp({ title: weird[0] })], impResolved: [] });
    await openPage(html, 375, 'dark');
    const n = await session.evaluate('return document.querySelectorAll("#board .card").length;');
    assert.equal(n, 4);
    await session.evaluate(JS.click('#board .card'));
    await sleep(80);
    await session.evaluate(JS.escape);
    await gotoView('やること', '一覧');
    await gotoView('障害物', null);
    assert.deepEqual(await session.evaluate('return window.__errors;'), []);
    const w = await session.evaluate('return [document.documentElement.scrollWidth, document.documentElement.clientWidth];');
    assert.ok(w[0] <= w[1]);
  });

  // ---- アクセシビリティ ---------------------------------------------------------------
  test('a11y: 見えている button / input / select / textarea は全部、空でない名前を持つ（盤面・パネル・コメント・履歴・障害物・通知）', async () => {
    const data = hostileData();
    data.rows[0] = row({ id: 'PBI-001', title: 'ふつう', description: '説明' });
    data.comments[0].author = 'me';   // 削除ボタンを出す
    const html = buildPage(data);
    await openPage(html, 1440, 'light');
    const states = [];
    states.push(['盤面', await session.evaluate(NAME_AUDIT)]);
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    await session.evaluate(JS.clickText('#panel-history', '履歴'));
    await sleep(100);
    states.push(['PBI パネル+コメント+履歴', await session.evaluate(NAME_AUDIT)]);
    await session.evaluate(JS.click('#panel-comments .comment-delete'));
    await sleep(100);
    states.push(['コメント削除の通知', await session.evaluate(NAME_AUDIT)]);
    await gotoView('やること', '一覧');
    states.push(['一覧', await session.evaluate(NAME_AUDIT)]);
    await gotoView('障害物', null);
    await session.waitFor('return document.querySelector("#table-view tr.clickable") ? 1 : 0', '障害物の行');
    await session.evaluate('document.querySelector("#table-view tr.clickable").click(); return 1;');
    await sleep(100);
    states.push(['障害物パネル', await session.evaluate(NAME_AUDIT)]);
    await session.evaluate(JS.click('#imp-panel-resolve'));
    await sleep(50);
    states.push(['障害物パネル(解決中)', await session.evaluate(NAME_AUDIT)]);
    let checked = 0;
    states.forEach(function (s) {
      s[1].forEach(function (e) {
        checked++;
        assert.ok(e.name !== '', s[0] + ': 名前の無い ' + e.tag + '#' + e.id + '.' + e.cls);
      });
    });
    assert.ok(checked > 40, '検査した部品が ' + checked + ' 個しか無い（空振り）');
  });

  test('a11y: label の for は実在する入力欄を指し、入力欄は label を持つ', async () => {
    const html = buildPage(hostileData());
    await openPage(html, 1024, 'light');
    const r = await session.evaluate(
      'var bad=[]; document.querySelectorAll("label[for]").forEach(function(l){ var t=document.getElementById(l.getAttribute("for"));'
      + ' if(!t) bad.push("label->" + l.getAttribute("for")); });'
      + 'var unl=[]; document.querySelectorAll("input,select,textarea").forEach(function(e){ if(!(e.labels&&e.labels.length) && !e.getAttribute("aria-label")) unl.push(e.id||e.className); });'
      + 'return {bad:bad, unl:unl, n:document.querySelectorAll("label[for]").length};');
    assert.deepEqual(r.bad, [], 'label の指す先が無い');
    assert.deepEqual(r.unl, [], '名前の無い入力欄');
    assert.ok(r.n >= 11, 'label が ' + r.n + ' 個しか見つからない');
  });

  test('a11y: 履歴の開閉と ? の補足は aria-expanded が実際の開閉と一致して切り替わる', async () => {
    const html = buildPage(hostileData());
    await openPage(html, 1440, 'light');
    // 補足（列見出しの ?）
    const help = await session.evaluate(
      'var b=document.querySelector("#board .column > h2 .help > button"); var body=document.getElementById(b.getAttribute("aria-describedby"));'
      + 'var out=[]; function snap(){ out.push([b.getAttribute("aria-expanded"), body.hidden]); }'
      + 'snap(); b.dispatchEvent(new Event("mouseenter")); snap(); b.parentNode.dispatchEvent(new Event("mouseleave")); snap(); return out;');
    assert.deepEqual(help, [['false', true], ['true', false], ['false', true]], '補足の aria-expanded が開閉と食い違う');
    // 履歴
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    const states = [];
    for (let i = 0; i < 4; i++) {
      await session.evaluate('document.querySelector("#panel-history .history-toggle").click(); return 1;');
      states.push(await session.evaluate(
        'var t=document.querySelector("#panel-history .history-toggle"); var b=document.getElementById(t.getAttribute("aria-controls"));'
        + 'return [t.getAttribute("aria-expanded"), b.hidden];'));
    }
    assert.deepEqual(states, [['true', false], ['false', true], ['true', false], ['false', true]],
      '履歴の aria-expanded が開閉と食い違う');
  });

  test('a11y: 焦点が当たる全種類の部品に、輪郭を出す :focus / :focus-visible の規則が当たっている（ライト/ダーク）', async () => {
    // headless では programmatic focus が :focus-visible に当たらないため、計算値ではなく
    // 「その部品に当たる焦点の規則が outline を出す宣言を持つか」を CSSOM から見る。
    // 輪郭として数えるのは、幅が 0 でなく色が透明でない outline か、影の輪（box-shadow）だけ。
    // 宣言は var() を含むと CSSOM の個別のプロパティが空になるので、規則の宣言をそのまま
    // 試し用の要素へ当て、計算値（--accent 等を解決した後）で確かめる。
    const AUDIT = [
      'function visibleRing(rule) {',
      '  var d = document.createElement("div"); d.style.cssText = rule.style.cssText; document.body.appendChild(d);',
      '  var cs = getComputedStyle(d);',
      '  var shadow = cs.boxShadow && cs.boxShadow !== "none";',
      '  var c = cs.outlineColor; var clear = c === "transparent" || /^rgba\\(.*,\\s*0\\)$/.test(c);',
      '  var line = cs.outlineStyle !== "none" && cs.outlineStyle !== "hidden" && parseFloat(cs.outlineWidth) > 0 && !clear;',
      '  d.remove();',
      '  return shadow || line;',
      '}',
      'function covered(el) {',
      '  var ok = false;',
      '  Array.from(document.styleSheets).forEach(function (sh) { Array.from(sh.cssRules).forEach(function (r) {',
      '    if (!r.selectorText || r.selectorText.indexOf(":focus") === -1) return;',
      '    if (!visibleRing(r)) return;',
      '    r.selectorText.split(",").forEach(function (sel) {',
      '      if (sel.indexOf(":focus") === -1) return;',
      '      var base = sel.replace(/:focus-visible|:focus/g, "").trim() || "*";',
      '      try { if (el.matches(base)) ok = true; } catch (e) {}',
      '    });',
      '  }); });',
      '  return ok;',
      '}',
      'var missing = []; var n = 0;',
      'document.querySelectorAll("button,input,select,textarea,[tabindex]").forEach(function (e) {',
      '  if (e.getClientRects().length === 0) return; n++;',
      '  if (!covered(e)) missing.push(e.tagName + "#" + e.id + "." + e.className);',
      '});',
      'return { n: n, missing: missing };',
    ].join('\n');
    for (const scheme of ['light', 'dark']) {
      const html = buildPage(hostileData());
      await openPage(html, 1024, scheme);
      await session.evaluate(JS.click('#board .card'));
      await sleep(100);
      await session.evaluate(JS.clickText('#panel-history', '履歴'));
      const a = await session.evaluate(AUDIT);
      assert.ok(a.n > 25, scheme + ': 検査した部品が ' + a.n + ' 個しか無い');
      assert.deepEqual(a.missing, [], scheme + ': 焦点の輪郭の規則が当たらない部品');
      // 検査そのものの確認: 幅 0・透明の outline は輪郭に数えず、色付きの outline と影の輪は数える。
      const self = await session.evaluate(
        'var st = document.createElement("style"); st.id = "zz-style";'
        + ' st.textContent = ".zz-w0:focus{outline:0 solid red} .zz-tr:focus{outline:2px solid transparent}'
        + ' .zz-ok:focus{outline:2px solid var(--accent)} .zz-sh:focus{box-shadow:0 0 0 2px red}";'
        + ' document.head.appendChild(st);'
        + ' ["zz-w0","zz-tr","zz-ok","zz-sh"].forEach(function (c) { var e = document.createElement("span");'
        + ' e.tabIndex = 0; e.className = c; e.textContent = c; document.body.appendChild(e); });'
        + ' var r = (function () {' + AUDIT + '})();'
        + ' document.querySelectorAll("[class^=zz-]").forEach(function (e) { e.remove(); }); st.remove();'
        + ' return r.missing.filter(function (m) { return m.indexOf(".zz-") !== -1; }).map(function (m) { return m.split(".").pop(); });');
      assert.deepEqual(self, ['zz-w0', 'zz-tr'], scheme + ': 見えない輪郭を数えている（または見える輪郭を数えない）');
      await gotoView('障害物', null);
      await session.waitFor('return document.querySelector("#table-view tr.clickable") ? 1 : 0', '障害物の行');
      const b2 = await session.evaluate(AUDIT);
      assert.deepEqual(b2.missing, [], scheme + ': 障害物の表で焦点の輪郭の規則が当たらない部品');
    }
  });

  // ---- キーボード ---------------------------------------------------------------------
  test('キーボード: PBI パネルの Tab 順は 閉じる→各欄→保存→削除→履歴→コメント欄 の順で、閉じた障害物パネルは含まれない', async () => {
    const html = buildPage(hostileData());
    await openPage(html, 1440, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    // DOM の並びではなく、本物の Tab（CDP の Input.dispatchKeyEvent）で焦点が移る順を見る。
    // tabindex で順番が変わっても、ブラウザが実際に辿る順で検査できる。
    await session.evaluate('document.getElementById("panel-close").focus(); return 1;');
    const WHO = 'var e = document.activeElement; return e ? (e.id || String(e.className) || e.tagName) : null;';
    const order = [await session.evaluate(WHO)];
    for (let k = 0; k < 40 && order[order.length - 1] !== 'comment-input'
      && String(order[order.length - 1]).split(' ').indexOf('comment-input') === -1; k++) {
      await pressTab(false);
      order.push(await session.evaluate(WHO));
    }
    const want = ['panel-close', 'f-title', 'f-description', 'f-acceptance', 'f-status', 'f-priority', 'f-size', 'f-sprint',
      'panel-save', 'panel-delete', 'history-toggle', 'comment-input'];   // 送信は欄が空の間は disabled（Tab の対象外）
    let at = -1;
    want.forEach(function (w) {
      const i = order.findIndex(function (o, k) { return k > at && String(o).split(' ').indexOf(w) !== -1; });
      assert.ok(i !== -1, 'Tab で ' + w + ' に（前の部品より後に）届かない: ' + JSON.stringify(order));
      at = i;
    });
    // 閉じているパネルの部品には Tab で届かない。
    assert.equal(order.indexOf('i-title'), -1, '障害物パネル（hidden）の部品に Tab で届いた: ' + JSON.stringify(order));
    // Shift+Tab で1つ戻る（コメント欄 → 履歴）。
    await pressTab(true);
    const back = await session.evaluate(WHO);
    assert.equal(order[order.length - 2], back, 'Shift+Tab で1つ前の部品へ戻らない');
  });

  test('キーボード: Escape は 補足 → 通知 → パネル の順に1枚ずつ閉じる', async () => {
    const data = hostileData();
    data.comments[0].author = 'me';
    const html = buildPage(data);
    await openPage(html, 1440, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    await session.evaluate(JS.click('#panel-comments .comment-delete'));   // 通知を出す
    await sleep(100);
    await session.evaluate(
      'var b=document.querySelector("#board .column > h2 .help > button"); b.dispatchEvent(new Event("mouseenter")); return 1;');
    const state = 'return { help: !!document.querySelector(".help-body:not([hidden])"), toast: !document.getElementById("toast").hidden,'
      + ' panel: !document.getElementById("panel").hidden };';
    assert.deepEqual(await session.evaluate(state), { help: true, toast: true, panel: true }, '前提が崩れた');
    await session.evaluate(JS.escape);
    assert.deepEqual(await session.evaluate(state), { help: false, toast: true, panel: true }, '1回目は補足だけ閉じる');
    await session.evaluate(JS.escape);
    assert.deepEqual(await session.evaluate(state), { help: false, toast: false, panel: true }, '2回目は通知だけ閉じる');
    await session.evaluate(JS.escape);
    assert.deepEqual(await session.evaluate(state), { help: false, toast: false, panel: false }, '3回目でパネルが閉じる');
    await session.evaluate(JS.escape);   // 何も開いていなくても例外にしない
    assert.deepEqual(await session.evaluate('return window.__errors;'), []);
  });

  test('キーボード: 障害物の行は Tab で止まり、Enter でも Space でもパネルが開く', async () => {
    const html = buildPage(hostileData());
    await openPage(html, 1024, 'light');
    await gotoView('障害物', null);
    await session.waitFor('return document.querySelector("#table-view tr.clickable") ? 1 : 0', '障害物の行');
    const rows = await session.evaluate('return Array.from(document.querySelectorAll("#table-view tr.clickable")).map(function (r) { return r.tabIndex; });');
    assert.ok(rows.length >= 2);
    rows.forEach(function (t) { assert.ok(t >= 0, '未解決の行が Tab で止まらない'); });
    for (const key of ['Enter', ' ']) {
      await session.evaluate('document.getElementById("imp-panel").hidden || document.getElementById("imp-panel-close").click(); return 1;');
      await session.evaluate(
        'var r=document.querySelector("#table-view tr.clickable"); r.focus();'
        + 'r.dispatchEvent(new KeyboardEvent("keydown",{key:' + JSON.stringify(key) + ',bubbles:true,cancelable:true})); return 1;');
      await sleep(80);
      assert.equal(await session.evaluate('return !document.getElementById("imp-panel").hidden;'), true,
        JSON.stringify(key) + ' で障害物パネルが開かない');
    }
  });
});
