/**
 * 障害物のビューのデータ。GAS API に依存しない純関数。
 *
 * 未解決と解決済は status 列ではなくファイルで分かれている
 * （impediment_log.csv / impediment_log_resolved.csv）。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof isImpedimentPlaceholder === 'undefined') {
  var { isImpedimentPlaceholder } = require('./pure_grid_report.js');
}

const IMPEDIMENT_COLUMNS = [
  { field: 'id', label: 'ID' },
  { field: 'title', label: 'タイトル' },
  { field: 'description', label: '説明' },
  { field: 'reported_by', label: '報告者' },
  { field: 'reported_at', label: '報告日' },
  { field: 'sprint', label: 'スプリント' },
  { field: 'resolved_at', label: '解決日' },
  { field: 'resolution', label: '解決策' },
];

function impedimentRows_(rows) {
  return (rows || []).filter(function (r) {
    return !isImpedimentPlaceholder(r);
  }).map(function (row) {
    const out = {};
    IMPEDIMENT_COLUMNS.forEach(function (c) {
      const v = row[c.field];
      out[c.field] = (v === undefined || v === null) ? '' : String(v);
    });
    return out;
  });
}

/** 障害物の一覧。未解決と解決済を分けて返す。 */
function buildImpedimentView(openRows, resolvedRows) {
  return {
    columns: IMPEDIMENT_COLUMNS,
    open: impedimentRows_(openRows),
    resolved: impedimentRows_(resolvedRows),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_COLUMNS, buildImpedimentView };
}
