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

function impedimentPendingEntries(openRows, resolvedRows) { return impPendingList_(openRows, resolvedRows); }

function impIdKey_(r) { return String((r || {}).id || '').trim(); }

/**
 * 途中で止まった操作。同じ ID の行が未解決と解決済の両方にあり、中身も同じもの。
 * 画面はここから「解決済として完了」「未解決に戻す」を選ばせる。
 */
function impPendingList_(openRows, resolvedRows) {
  const resolved = (resolvedRows || []).filter(function (r) { return !isImpedimentPlaceholder(r); });
  const seen = Object.create(null);
  const out = [];
  (openRows || []).forEach(function (o) {
    if (isImpedimentPlaceholder(o)) return;
    const key = impIdKey_(o);
    if (seen[key]) return;
    for (let i = 0; i < resolved.length; i++) {
      if (impIdKey_(resolved[i]) === key && impedimentSameIdentity(resolved[i], o)) {
        seen[key] = true;
        out.push({ id: key, open: o, resolved: resolved[i] });
        return;
      }
    }
  });
  return out;
}

/** 未解決の行のうち、ID が他の行と重なっているもの（押せない行として出す）。 */
function impDuplicateOpenRows_(openRows, resolvedRows) {
  const real = (openRows || []).filter(function (r) { return !isImpedimentPlaceholder(r); });
  const resolved = (resolvedRows || []).filter(function (r) { return !isImpedimentPlaceholder(r); });
  const count = Object.create(null);
  real.forEach(function (r) { count[impIdKey_(r)] = (count[impIdKey_(r)] || 0) + 1; });
  return real.filter(function (r) {
    const key = impIdKey_(r);
    if (count[key] > 1) return true;
    const same = resolved.filter(function (d) { return impIdKey_(d) === key; });
    return same.length > 0 && !same.some(function (d) { return impedimentSameIdentity(d, r); });
  });
}

/** 障害物の一覧。未解決と解決済を分けて返す。 */
function buildImpedimentView(openRows, resolvedRows) {
  const dups = impDuplicateOpenRows_(openRows, resolvedRows);
  const shown = openImpedimentsShown(openRows, resolvedRows);
  const open = impedimentRows_(shown);   // shown は雛形を含まないので、添字が揃う
  shown.forEach(function (r, i) { if (dups.indexOf(r) !== -1) open[i].duplicate = 'true'; });
  const pending = impPendingList_(openRows, resolvedRows).map(function (p) {
    return { id: p.id, open: impedimentRows_([p.open])[0], resolved: impedimentRows_([p.resolved])[0] };
  });
  return {
    columns: IMPEDIMENT_COLUMNS,
    open: open,
    resolved: impedimentRows_(resolvedRows),
    pending: pending,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_COLUMNS, buildImpedimentView, openImpedimentsShown, impedimentPendingEntries };
}
