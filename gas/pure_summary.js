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

if (typeof module !== 'undefined') { module.exports = { summarizeBacklog }; }
