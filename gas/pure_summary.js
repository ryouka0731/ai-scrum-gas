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
if (typeof require !== 'undefined' && typeof extractMarkdownTable === 'undefined') {
  var { extractMarkdownTable } = require('./pure_markdown.js');
}
if (typeof require !== 'undefined' && typeof normalizeSprint === 'undefined') {
  var { normalizeSprint } = require('./pure_filter.js');
}
if (typeof require !== 'undefined' && typeof isImpedimentPlaceholder === 'undefined') {
  var { isImpedimentPlaceholder } = require('./pure_grid_report.js');
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
 * sprint_backlog.md が自分で名乗っているスプリント名。名乗っていなければ null。
 *
 * 成果物のひな形は「スプリント情報」の表に「スプリント番号」の行を持つ。
 * 見出しの `# スプリントバックログ - Sprint 001` は後ろに補足を書き足されることが
 * あるため、名乗りとしては表の1行だけを見る（取り違えるくらいなら「分からない」）。
 */
function sprintNameInBacklogMd_(md) {
  const t = extractMarkdownTable(md || '', 'スプリント情報');
  if (!t) return null;
  for (let i = 0; i < t.rows.length; i++) {
    if (String(t.rows[i][0] || '').trim() === 'スプリント番号') {
      const name = String(t.rows[i][1] || '').trim();
      return name === '' ? null : name;
    }
  }
  return null;
}

/**
 * スプリントの要約。velocity.csv の最新行（realSprints の最後）と、
 * sprint_backlog.md のゴールから作る。
 * buildDashboardGrid はこれらを集計していないので、ここで作る。
 *
 * velocity.csv は追記順＝時系列順である前提。行を並べ替えると、
 * 「最新スプリント」のつもりが古い行になる。
 *
 * **数字とゴールは出所が違う**。数字は velocity.csv の最新行、ゴールは
 * 「最新のスプリントフォルダ」の sprint_backlog.md（gas_drive.js）。この2つは
 * ずれることがある（次のスプリントのフォルダだけ先にできている、velocity.csv に
 * 期間を書き忘れている等）。ずれたまま並べると、別のスプリントの数字と目的が
 * 1行に混ざって出る。**どちらが正しいかは決められないので、混ぜずにゴールを落とす**
 * （数字は必ず velocity.csv の1行から来ており、sprint 名もその行のもの＝自己矛盾しない）。
 * md が自分の名前を名乗っていないときは突き合わせようがないので、そのまま載せる。
 */
function summarizeSprint(velocityRows, sprintBacklogMd) {
  const real = realSprints(velocityRows || []);
  if (real.length === 0) return null;
  const v = real[real.length - 1];
  const num = function (x) { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
  const sprint = String(v.sprint || '').trim();
  const mdSprint = sprintNameInBacklogMd_(sprintBacklogMd);
  // 表記の揺れ（"Sprint 001" と "sprint001"）は同じものとして扱う。ロードマップと同じ鍵。
  const sameSprint = mdSprint === null || normalizeSprint(mdSprint) === normalizeSprint(sprint);
  return {
    sprint: sprint,
    goal: sameSprint ? (extractSection(sprintBacklogMd || '', 'スプリントゴール') || '') : '',
    planned: num(v.planned_points),
    completed: num(v.completed_points),
    carriedOver: num(v.carried_over_points),
  };
}

/** 障害物の要約。件数はファイル別に数える（status 列では分かれていない）。 */
function summarizeImpediment(openRows, resolvedRows) {
  const count = function (rows) {
    return (rows || []).filter(function (r) { return !isImpedimentPlaceholder(r); }).length;
  };
  return { open: count(openRows), resolved: count(resolvedRows) };
}

if (typeof module !== 'undefined') { module.exports = { summarizeBacklog, summarizeSprint, summarizeImpediment }; }
