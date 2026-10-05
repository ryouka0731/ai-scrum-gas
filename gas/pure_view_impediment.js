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
if (typeof require !== 'undefined' && typeof impedimentSameIdentity === 'undefined') {
  var { impedimentSameIdentity } = require('./pure_impediment_merge.js');
}
if (typeof require !== 'undefined' && typeof IMPEDIMENT_FIELDS === 'undefined') {
  globalThis.IMPEDIMENT_FIELDS = require('./pure_grid_report.js').IMPEDIMENT_FIELDS;
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
    // 表に出す列だけでなく全列を持たせる。画面はこの行をそのまま「見た行」として
    // 送り返し、サーバは全列で競合を判定する（障害物の CSV には updated_at が無い）。
    const out = {};
    IMPEDIMENT_FIELDS.forEach(function (f) {
      const v = row[f];
      out[f] = (v === undefined || v === null) ? '' : String(v);
    });
    return out;
  });
}

/**
 * 画面に出す未解決。雛形と、解決済にも在る同じ行（ID と中身が同じ）を除く。
 * 解決は「resolved に足す → open から消す」の順で書くため、途中で止まると両方に残る。
 * そのときは解決済を正とする（もう一度「解決」を押すと open から消えて揃う）。
 */
function openImpedimentsShown(openRows, resolvedRows) {
  const done = (resolvedRows || []).filter(function (r) { return !isImpedimentPlaceholder(r); });
  return (openRows || []).filter(function (r) {
    if (isImpedimentPlaceholder(r)) return false;
    // 同じ ID でも中身が違えば別の行。隠すと画面から触れなくなるため未解決に出す。
    return !done.some(function (d) {
      return String(d.id || '').trim() === String(r.id || '').trim() && impedimentSameIdentity(d, r);
    });
  });
}

/** 障害物の一覧。未解決と解決済を分けて返す。 */
function buildImpedimentView(openRows, resolvedRows) {
  return {
    columns: IMPEDIMENT_COLUMNS,
    open: impedimentRows_(openImpedimentsShown(openRows, resolvedRows)),
    resolved: impedimentRows_(resolvedRows),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_COLUMNS, buildImpedimentView, openImpedimentsShown };
}
