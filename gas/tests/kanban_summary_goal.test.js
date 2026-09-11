'use strict';
// スプリントゴールの表示（Task 8 追加分）の検査。
//
// summarizeSprint は sprint_backlog.md の「スプリントゴール」節を summary.goal で
// 届けているのに、画面に出ていなかった。ゴールはそのスプリントが在る理由そのもの。
// データは既に届いているので、表示する。

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness, styleRules, declarations } = require('./kanban_harness.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const INITIAL = STATUSES.map(function (s) { return { status: s, cards: [] }; });

const GOAL = 'ログインまわりを一通り使える状態にする';

/** スプリントタブ（バーンダウン）を開き、summary を届けたハーネスを返す。 */
function withSprintSummary(summary) {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL) });
  h.clickTab('スプリント');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'burndown', view: null, summary: summary
  });
  return h;
}

const sprintSummary = (goal) => ({
  sprint: 'sprint002', goal: goal, planned: 13, completed: 8, carriedOver: 5
});

test('スプリントゴールが要約に出る', () => {
  const h = withSprintSummary(sprintSummary(GOAL));
  assert.ok(h.textTreeOf('summary').indexOf(GOAL) !== -1,
    'スプリントゴールが画面に出ていない: ' + h.textTreeOf('summary'));
});

test('ゴールが空なら「ゴール」の行そのものを出さない', () => {
  // sprint_backlog.md にゴール節が無い・読めないときは空文字で届く。
  // 「ゴール: 」だけが出ると、無いのか壊れているのか分からない。
  const h = withSprintSummary(sprintSummary(''));
  assert.equal(h.textTreeOf('summary').indexOf('ゴール'), -1,
    'ゴールが空なのに「ゴール」の行が出ている: ' + h.textTreeOf('summary'));
  assert.ok(h.textTreeOf('summary').indexOf('sprint002') !== -1, '前提: 要約が出ていない');
});

test('ゴールを運ばない古い応答でも例外にならない', () => {
  const s = sprintSummary(GOAL);
  delete s.goal;
  const h = withSprintSummary(s);
  assert.ok(h.textTreeOf('summary').indexOf('sprint002') !== -1);
  assert.equal(h.textTreeOf('summary').indexOf('ゴール'), -1);
});

test('ゴールは数値の統計と同じ並びに埋めない', () => {
  // 文章を「計画: 13pt」と同じ見た目にすると読み飛ばされる。#summary は
  // flex なので、ゴールだけ行を分ける（.goal に flex-basis がある）。
  const h = withSprintSummary(sprintSummary(GOAL));
  assert.ok(h.textTreeOf('summary').indexOf('ゴール') !== -1, '前提: ゴールが出ていない');

  const rule = styleRules().find(function (r) { return r.selector === '#summary .goal'; });
  assert.ok(rule, 'ゴールを統計と区別する規則（#summary .goal）が無い');
  const props = declarations(rule.body).map(function (d) { return d.property; });
  assert.ok(props.indexOf('flex-basis') !== -1, 'ゴールが統計と同じ行に並んでしまう');
  // 長いゴールで横スクロールを出さない（.card .title と同じ手）。
  assert.ok(props.indexOf('overflow-wrap') !== -1, '長いゴールで横スクロールが出る');
});

test('やることの要約にはゴールを出さない', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({
    ok: true, view: h.boardOf(INITIAL), summary: { byStatus: [], total: { count: 3, points: 8 } }
  });
  assert.equal(h.textTreeOf('summary').indexOf('ゴール'), -1);
  assert.ok(h.textTreeOf('summary').indexOf('合計') !== -1, '前提: 要約が出ていない');
});

test('障害物の要約にはゴールを出さない', () => {
  // 障害物の枝（summary.open）も通しておく。やること（total）だけを通していると、
  // 後からこちらの枝にゴールが足されても気づけない。
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, view: h.boardOf(INITIAL) });
  h.clickTab('障害物');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'impediment', view: { open: [], resolved: [] },
    summary: { open: 1, resolved: 0 }
  });
  assert.equal(h.textTreeOf('summary').indexOf('ゴール'), -1,
    '障害物の要約にゴールが出ている: ' + h.textTreeOf('summary'));
  assert.ok(h.textTreeOf('summary').indexOf('未解決') !== -1, '前提: 要約が出ていない');
});
