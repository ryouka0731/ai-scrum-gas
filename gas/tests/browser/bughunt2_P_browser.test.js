'use strict';
/**
 * bughunt 2巡目 P: 規模・性能（実ブラウザ）。
 *
 * 1,000 枚のカード・500 件のコメント・履歴 200 件（100 行 / 500 行の説明の差分）を実ブラウザで描かせ、
 * 時間と DOM ノード数を測る。時間は機械で揺れるので上限は大きく取る（固まり・数十秒を落とすための網）。
 * 測った数字は diagnostic に出す（`node --test` の出力で見える）。
 * 実バグ（履歴が 20 万ノードになる）は gas/tests/bughunt2_P_failing.test.js.txt の BUG-P4。
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { chromePath, launch } = require('./chrome_session.js');
const { buildPage, row, JS } = require('./bughunt_e_support.js');

const CHROME = chromePath();
const SKIP = CHROME ? false : 'Chrome が見つからないので飛ばします（CHROME_PATH で指定できます）';

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
function pbi(i) { return 'PBI-' + String(i).padStart(3, '0'); }

function bigData(nCards, nComments, history) {
  const rows = [];
  for (let i = 1; i <= nCards; i++) {
    rows.push(row({ id: pbi(i), title: 'タイトル ' + i + ' ' + 'あ'.repeat(i % 30), status: STATUSES[i % 5],
      sprint: 'sprint00' + (1 + (i % 3)), size: String(1 + (i % 8)) }));
  }
  const comments = [];
  for (let i = 0; i < nComments; i++) {
    comments.push({ id: 'CMT-' + i.toString(16).padStart(8, 'f'), target_id: pbi(1), author: i % 2 ? 'other@example.com' : 'me',
      created_at: '2026-09-10 10:' + String(Math.floor(i / 60) % 60).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0'),
      body: 'コメント ' + i + '\n2行目 ' + 'い'.repeat(40) });
  }
  return { rows: rows, comments: comments, history: history || [], historyTarget: pbi(1), me: 'me' };
}

function historyRows(n, lines) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = []; const b = [];
    for (let k = 0; k < lines; k++) { a.push('行' + k + ' v' + i); b.push('行' + k + ' v' + (i + 1)); }
    out.push({ id: 'CHG-' + i, at: '2026-09-01 ' + String(Math.floor(i / 60)).padStart(2, '0') + ':' + String(i % 60).padStart(2, '0') + ':00',
      actor: 'a@example.com', target_id: pbi(1), action: 'update', field: 'description', before: a.join('\n'), after: b.join('\n') });
  }
  return out;
}

describe('bughunt2 P: 実ブラウザの規模（1,000 枚・500 コメント・履歴 200 件）', { skip: SKIP }, () => {
  let session = null;
  before(async () => { session = await launch(); });
  after(async () => { if (session) await session.close(); });

  async function openPage(data) {
    const html = buildPage(data);
    const t0 = Date.now();
    await session.open({ html: html, width: 1440, height: 900, scheme: 'light' });
    await session.waitFor(JS.boardReady, '盤面の初回読み込み', 30000);
    return Date.now() - t0;
  }

  test('1,000 枚の盤面: 読み込みから初回描画まで 15秒未満、再描画（レイアウト込み）3秒未満、カード1枚あたり 20 ノード以内', async (t) => {
    const loadMs = await openPage(bigData(1000, 0));
    const m = await session.evaluate(
      'var cards = document.querySelectorAll("#board .card").length;'
      + 'var nodes = document.querySelectorAll("#board *").length;'
      + 'var t = performance.now(); render(board); document.body.offsetHeight; var re = performance.now() - t;'
      + 'return { cards: cards, nodes: nodes, rerender: re };');
    t.diagnostic('1,000 枚: 読み込み〜初回描画 ' + loadMs + 'ms / 再描画 ' + m.rerender.toFixed(0) + 'ms / ノード ' + m.nodes);
    assert.equal(m.cards, 1000);
    assert.ok(loadMs < 15000, '読み込み〜初回描画 ' + loadMs + 'ms');
    assert.ok(m.rerender < 3000, '再描画 ' + m.rerender + 'ms');
    assert.ok(m.nodes / m.cards <= 20, 'カード1枚あたり ' + m.nodes / m.cards + ' ノード');
    const errors = await session.evaluate('return window.__errors.slice();');
    assert.deepEqual(errors, []);
  });

  test('500 件のコメント: カードを開いてコメント節が 3秒未満で出て、1件あたり 12 ノード以内', async (t) => {
    await openPage(bigData(200, 500));
    // 2巡目 H2（P2）から、本文はパネルを開いたときに apiGetComments で取る（応答は非同期）。
    await session.evaluate('window.__t0 = performance.now();'
      + 'document.querySelector("#board .card[data-id=\\"PBI-001\\"] .title").click(); return true;');
    await session.waitFor('return document.querySelectorAll("#panel-comments li").length === 500 ? 1 : 0', 'コメントの描画', 10000);
    const m = await session.evaluate(
      'document.body.offsetHeight; var open = performance.now() - window.__t0;'
      + 'var host = document.getElementById("panel-comments");'
      + 'return { open: open, items: host.querySelectorAll("li").length, nodes: host.querySelectorAll("*").length };');
    t.diagnostic('500 コメント: パネルを開く ' + m.open.toFixed(0) + 'ms / ノード ' + m.nodes);
    assert.equal(m.items, 500);
    assert.ok(m.open < 3000, 'パネルを開く ' + m.open + 'ms');
    assert.ok(m.nodes / 500 <= 12, '1件あたり ' + m.nodes / 500);
  });

  [[100, 'description 100 行'], [500, 'description 500 行（予算超過後は丸ごと del/add。2巡目 H2 から最初は 50 件だけ描く）']].forEach(([lines, label]) => {
    test('履歴 200 件 × ' + label + ': 開いてから描き終わるまで 20秒未満（固まり・例外なし）', async (t) => {
      await openPage(bigData(50, 0, historyRows(200, lines)));
      await session.evaluate('document.querySelector("#board .card[data-id=\\"PBI-001\\"] .title").click(); return true;');
      const m = await session.evaluate(
        'window.__t0 = performance.now(); document.querySelector("#panel-history .history-toggle").click(); return true;');
      assert.equal(m, true);
      await session.waitFor('return document.querySelectorAll("#panel-history .history-group").length > 0 ? 1 : 0', '履歴の描画', 30000);
      const r = await session.evaluate(
        'document.body.offsetHeight; var el = performance.now() - window.__t0;'
        + 'return { elapsed: el, groups: document.querySelectorAll("#panel-history .history-group").length,'
        + ' nodes: document.querySelectorAll("#panel-history *").length, errors: window.__errors.slice(),'
        + ' more: (document.querySelector("#panel-history .history-more") || {}).textContent || "" };');
      t.diagnostic('履歴 200 × ' + lines + ' 行: ' + r.elapsed.toFixed(0) + 'ms / グループ ' + r.groups + ' / ノード ' + r.nodes);
      // 2巡目 H2（P4）: 最初は 50 件だけ描き、残りは「さらに表示」で足す。
      assert.equal(r.groups, 50);
      assert.equal(r.more, 'さらに表示（残り 150 件）');
      assert.ok(r.nodes <= 50 * (2 * lines + 20), 'ノード ' + r.nodes);
      assert.ok(r.elapsed < 20000, '描画まで ' + r.elapsed + 'ms');
      assert.deepEqual(r.errors, []);
    });
  });
});
