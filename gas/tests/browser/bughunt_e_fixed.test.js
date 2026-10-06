'use strict';
/**
 * bughunt E（G3: キーボード・アクセシビリティ）: 直した実バグの再発防止。
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { chromePath, launch } = require('./chrome_session.js');
const { buildPage, row, imp, JS } = require('./bughunt_e_support.js');

const CHROME = chromePath();
const SKIP = CHROME ? false : 'Chrome が見つからないので飛ばします';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ACTIVE = 'var a=document.activeElement; return {tag:a.tagName, id:a.id, isBody:a===document.body||a===document.documentElement,'
  + ' visible: a.getClientRects().length>0};';
// 焦点のある要素が属するカードの ID（カードの外なら空文字）。カードで焦点を受けるのは開く入口のタイトル。
const ACTIVE_CARD = 'var a=document.activeElement; var c=a&&a.closest?a.closest("#board .card"):null; return c?c.dataset.id:"";';
const TITLE = function (i) { return 'document.querySelectorAll("#board .card .title")[' + i + ']'; };

describe('bughunt E: 直した実バグ（G3）', { skip: SKIP }, () => {
  let session = null;
  before(async () => { session = await launch(); });
  after(async () => { if (session) await session.close(); });

  async function openPage(html, width, scheme) {
    await session.open({ html: html, width: width, height: 800, scheme: scheme || 'light' });
    await session.waitFor(JS.boardReady, '盤面の初回読み込み');
  }

  // BUG-E1 -----------------------------------------------------------------------------
  test('BUG-E1: 盤面のカードはキーボードで焦点を取れ、Enter / Space で開ける（Tab 順に居る）', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' }), row({ id: 'PBI-002', status: 'Ready' })],
      comments: [], impOpen: [imp()], impResolved: [] });
    await openPage(html, 1024, 'light');
    // Tab で止まるのはカードの開く入口（タイトル）。
    const cards = await session.evaluate(
      'return Array.from(document.querySelectorAll("#board .card")).map(function (c) { var t = c.querySelector(".title");'
      + ' return { tabIndex: t ? t.tabIndex : -1, role: t ? t.getAttribute("role") : null }; });');
    assert.equal(cards.length, 2);
    cards.forEach(function (c) {
      assert.ok(c.tabIndex >= 0, 'カードが Tab で止まらない（tabIndex=' + c.tabIndex + '、role=' + c.role + '）。'
        + 'キーボードだけでは PBI を開けない（障害物の表の行は tabindex=0 で Enter / Space に応える）');
    });
  });

  // BUG-E2 -----------------------------------------------------------------------------
  ['Escape', '閉じるボタン'].forEach(function (how) {
    test('BUG-E2: PBI パネルを ' + how + ' で閉じたあと、焦点が body へ落ちない', async () => {
      const html = buildPage({ rows: [row({ id: 'PBI-001' })], comments: [], impOpen: [imp()], impResolved: [] });
      await openPage(html, 1024, 'light');
      await session.evaluate(JS.click('#board .card'));
      await sleep(100);
      assert.equal((await session.evaluate(ACTIVE)).id, 'f-title', '前提: パネルを開くと標題欄に焦点が行く');
      if (how === 'Escape') await session.evaluate(JS.escape);
      else await session.evaluate('document.getElementById("panel-close").focus(); document.getElementById("panel-close").click(); return 1;');
      await sleep(100);
      assert.equal(await session.evaluate('return document.getElementById("panel").hidden;'), true, '前提: パネルが閉じた');
      const a = await session.evaluate(ACTIVE);
      assert.equal(a.isBody, false,
        'パネルを閉じたら焦点が body に落ちた（開いた元のカード等へ戻らない）。キーボード・スクリーンリーダー利用者は文書の先頭からやり直しになる');
      // 見えている別の部品でもなく、開いた元のカードへ戻る。
      assert.equal(await session.evaluate(ACTIVE_CARD), 'PBI-001', 'パネルを開いた元のカードとは別の所へ焦点が戻った');
    });
  });

  test('BUG-E2: 障害物パネルを Escape で閉じたあとも、焦点が body へ落ちない', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' })], comments: [], impOpen: [imp()], impResolved: [] });
    await openPage(html, 1024, 'light');
    await session.evaluate(JS.clickText('#tabs', '障害物'));
    await session.waitFor('return document.querySelector("#table-view tr.clickable") ? 1 : 0', '障害物の行');
    await session.evaluate('var r=document.querySelector("#table-view tr.clickable"); r.focus(); r.click(); return 1;');
    await sleep(100);
    assert.equal(await session.evaluate('return !document.getElementById("imp-panel").hidden;'), true);
    await session.evaluate(JS.escape);
    await sleep(100);
    assert.equal(await session.evaluate('return document.getElementById("imp-panel").hidden;'), true);
    assert.equal((await session.evaluate(ACTIVE)).isBody, false, '障害物パネルを閉じたら焦点が body に落ちた');
  });

  // BUG-E3 -----------------------------------------------------------------------------
  test('BUG-E3: 自分のコメントを削除したあと、焦点が body へ落ちない', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' })], me: 'me', impOpen: [imp()], impResolved: [],
      comments: [{ id: 'CMT-00000001', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:00:00', body: 'a' },
        { id: 'CMT-00000002', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:01:00', body: 'b' }] });
    await openPage(html, 1024, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    await session.evaluate('var d=document.querySelector("#panel-comments .comment-delete"); d.focus(); d.click(); return 1;');
    await sleep(150);
    assert.equal(await session.evaluate('return document.querySelectorAll("#panel-comments .comment-body").length;'), 1,
      '前提: コメントが1件消えた');
    assert.equal((await session.evaluate(ACTIVE)).isBody, false,
      '削除ボタンごと要素が消え、焦点が body に落ちた（次のコメントの削除や入力欄へ移らない）');
  });

  // BUG-E4 -----------------------------------------------------------------------------
  [[375, 1000], [1440, 3000]].forEach(function (c) {
    const width = c[0], n = c[1];
    test('BUG-E4: 長いタイトルの PBI を削除しても、通知の「取り消す」が画面内に残る (' + width + 'px, ' + n + '字)', async () => {
      const html = buildPage({ rows: [row({ id: 'PBI-001', title: 'あ'.repeat(n) }), row({ id: 'PBI-002', status: 'Ready' })],
        comments: [], impOpen: [imp()], impResolved: [] });
      await openPage(html, width, 'light');
      await session.evaluate(JS.click('#board .card'));
      await sleep(100);
      await session.evaluate(JS.click('#panel-delete'));
      await session.waitFor('return document.getElementById("toast").hidden ? 0 : 1', '削除の通知');
      const r = await session.evaluate(
        'var b=document.getElementById("toast-undo").getBoundingClientRect();'
        + 'return {top:b.top,bottom:b.bottom,vh:innerHeight,vw:innerWidth};');
      assert.ok(r.top >= 0 && r.bottom <= r.vh,
        '「取り消す」が画面の外にある（top=' + Math.round(r.top) + ' bottom=' + Math.round(r.bottom) + ' / 画面の高さ ' + r.vh
        + '）。通知は固定位置で画面より高くなり、スクロールもできない');
    });
  });

  // BUG-E5 -----------------------------------------------------------------------------
  test('BUG-E5: 1つのパネルの中で、押せるボタンの名前が重複しない（PBI の「削除」とコメントの「削除」）', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' })], me: 'me', impOpen: [imp()], impResolved: [],
      comments: [{ id: 'CMT-00000001', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:00:00', body: 'a' },
        { id: 'CMT-00000002', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:01:00', body: 'b' }] });
    await openPage(html, 1024, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    const names = await session.evaluate(
      'return Array.from(document.querySelectorAll("#panel button")).filter(function (b) { return b.getClientRects().length > 0; })'
      + '.map(function (b) { return (b.getAttribute("aria-label") || b.textContent).trim(); });');
    const dup = names.filter(function (n, i) { return names.indexOf(n) !== i; });
    assert.deepEqual(dup, [],
      '同じ名前のボタンが複数ある: ' + JSON.stringify(names) + '（スクリーンリーダーでは、どの「削除」がPBIでどれがコメントか区別できない）');
  });

  // 追加: 振る舞いの確認 ------------------------------------------------------------------
  test('BUG-E1: カードの開く入口（タイトル）に role=button と ID+タイトルの名前があり、Enter / Space で開く。role=button の中に操作部品は無い', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001', title: '題名', priority: 'High' })], comments: [], impOpen: [imp()], impResolved: [] });
    await openPage(html, 1024, 'light');
    const c = await session.evaluate('var c=document.querySelector("#board .card .title"); return {role:c.getAttribute("role"), name:c.getAttribute("aria-label")};');
    assert.equal(c.role, 'button');
    assert.ok(c.name.indexOf('PBI-001') >= 0 && c.name.indexOf('題名') >= 0, c.name);
    // role=button の子孫は支援技術から見えなくなる。カード自身も含め、中に操作部品を持つ role=button は無い。
    const nested = await session.evaluate('return Array.from(document.querySelectorAll("#board [role=button]")).filter(function (b) {'
      + ' return b.querySelector("button,a[href],input,select,textarea,[tabindex]"); }).length;');
    assert.equal(nested, 0, '操作部品を中に持つ role=button がある');
    assert.equal(await session.evaluate('return document.querySelector("#board .card .help > button") ? 1 : 0;'), 1,
      '前提: カードに優先度の補足（? ボタン）がある');
    for (const key of ['Enter', ' ']) {
      await session.evaluate('var c=document.querySelector("#board .card .title"); c.focus();'
        + 'c.dispatchEvent(new KeyboardEvent("keydown",{key:' + JSON.stringify(key) + ',bubbles:true,cancelable:true})); return 1;');
      await sleep(100);
      assert.equal(await session.evaluate('return document.getElementById("panel").hidden;'), false, key + ' でパネルが開く');
      await session.evaluate(JS.escape);
      await sleep(100);
    }
  });

  test('BUG-E2: パネルを閉じると、開いた元のカードへ焦点が戻る', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' }), row({ id: 'PBI-002', status: 'Ready' })], comments: [], impOpen: [imp()], impResolved: [] });
    await openPage(html, 1024, 'light');
    await session.evaluate('var c=' + TITLE(1) + '; c.focus(); c.click(); return 1;');
    await sleep(100);
    const id = await session.evaluate('return document.querySelectorAll("#board .card")[1].dataset.id;');
    await session.evaluate(JS.escape);
    await sleep(100);
    assert.equal(await session.evaluate(ACTIVE_CARD), id);
  });

  test('M3: カードに焦点がある間に盤面を描き直しても（最新にする）、同じ ID のカードに焦点が残る', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' }), row({ id: 'PBI-002', status: 'Ready' })], comments: [], impOpen: [imp()], impResolved: [] });
    await openPage(html, 1024, 'light');
    await session.evaluate('var c=' + TITLE(1) + '; c.focus(); return 1;');
    const before = await session.evaluate(ACTIVE_CARD);
    assert.equal(before, 'PBI-002', '前提: 2枚目のカードに焦点がある');
    await session.evaluate('var c=document.activeElement; window.__oldCard=c; document.getElementById("reload").click(); return 1;');
    await sleep(200);
    const r = await session.evaluate('var a=document.activeElement; var c=a.closest?a.closest("#board .card"):null;'
      + ' return {id: c ? c.dataset.id : "", rebuilt: a !== window.__oldCard, isBody: a === document.body};');
    assert.equal(r.rebuilt, true, '盤面が描き直されていない（検査の前提）');
    assert.equal(r.isBody, false, '描き直しで焦点が body へ落ちた');
    assert.equal(r.id, before);
  });

  test('BUG-E3: コメントを消すと、次のコメントの削除ボタンへ焦点が移る', async () => {
    const html = buildPage({ rows: [row({ id: 'PBI-001' })], me: 'me', impOpen: [imp()], impResolved: [],
      comments: [{ id: 'CMT-00000001', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:00:00', body: 'a' },
        { id: 'CMT-00000002', target_id: 'PBI-001', author: 'me', created_at: '2026-09-10 10:01:00', body: 'b' }] });
    await openPage(html, 1024, 'light');
    await session.evaluate(JS.click('#board .card'));
    await sleep(100);
    await session.evaluate('var d=document.querySelector("#panel-comments .comment-delete"); d.focus(); d.click(); return 1;');
    await sleep(150);
    const r = await session.evaluate('var a=document.activeElement; return {cls:a.className, id:a.closest("li")&&a.closest("li").dataset.id};');
    assert.match(r.cls, /comment-delete/);
    assert.equal(r.id, 'CMT-00000002');
  });
});
