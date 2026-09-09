/**
 * 各タブの要約。GAS API に依存しない純関数。
 *
 * buildDashboardGrid は使わない。あれが集計するのはスプリントゴールと PBI の
 * ステータス別件数・ポイントと警告だけで、スプリントの計画/完了/持ち越しも
 * 障害物の件数も集計していない。あちらはシートの同期が使い続ける。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}
if (typeof require !== 'undefined' && typeof realSprints === 'undefined') {
  var { realSprints } = require('./pure_grid_board.js');
}
if (typeof require !== 'undefined' && typeof extractSection === 'undefined') {
  var { extractSection } = require('./pure_markdown.js');
}

/** やることの要約。ステータスの語彙は引数で受け取る（KANBAN_STATUSES は const のため）。 */
function summarizeBacklog(rows, statuses) {
  const order = statuses || [];
  const counts = {};
  const points = {};
  order.forEach(function (s) { counts[s] = 0; points[s] = 0; });

  const real = filterRealRows(rows || []);
  real.forEach(function (r) {
    const raw = String(r.status || '').trim();
    const s = order.indexOf(raw) === -1 ? order[0] : raw;
    if (s === undefined) return;
    counts[s] += 1;
    const n = parseFloat(r.size);
    points[s] += isNaN(n) ? 0 : n;
  });

  const byStatus = order.map(function (s) {
    return { status: s, count: counts[s], points: points[s] };
  });
  const total = byStatus.reduce(function (a, x) {
    return { count: a.count + x.count, points: a.points + x.points };
  }, { count: 0, points: 0 });
  return { byStatus: byStatus, total: total };
}

/**
 * スプリントの要約。velocity.csv の最新行（realSprints の最後）と、
 * sprint_backlog.md のゴールから作る。
 * buildDashboardGrid はこれらを集計していないので、ここで作る。
 */
function summarizeSprint(velocityRows, sprintBacklogMd) {
  const real = realSprints(velocityRows || []);
  if (real.length === 0) return null;
  const v = real[real.length - 1];
  const num = function (x) { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
  return {
    sprint: String(v.sprint || '').trim(),
    goal: extractSection(sprintBacklogMd || '', 'スプリントゴール') || '',
    planned: num(v.planned_points),
    completed: num(v.completed_points),
    carriedOver: num(v.carried_over_points),
  };
}

if (typeof module !== 'undefined') { module.exports = { summarizeBacklog, summarizeSprint }; }
