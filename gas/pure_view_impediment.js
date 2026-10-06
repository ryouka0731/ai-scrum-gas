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

/** 解決済の本物の行（雛形を除く）を ID（trim）ごとに並べた索引。各 ID の中は元の並び順。 */
function impResolvedById_(resolvedRows) {
  const byId = Object.create(null);
  (resolvedRows || []).forEach(function (r) {
    if (isImpedimentPlaceholder(r)) return;
    const key = impIdKey_(r);
    (byId[key] = byId[key] || []).push(r);
  });
  return byId;
}

/**
 * 画面に出す未解決。雛形と、解決済にも在る同じ行（ID と中身が同じ）を除く。
 * 解決は「resolved に足す → open から消す」の順で書くため、途中で止まると両方に残る。
 * そのときは解決済を正とする（もう一度「解決」を押すと open から消えて揃う）。
 * 解決済は ID の索引で引く（解決済は増える一方なので、未解決 × 解決済 の2乗にしない）。
 */
function openImpedimentsShown(openRows, resolvedRows) {
  return impShown_(openRows, impResolvedById_(resolvedRows), impOpenIdCount_(openRows));
}

function impShown_(openRows, resolvedById, count) {
  return (openRows || []).filter(function (r) {
    if (isImpedimentPlaceholder(r)) return false;
    // 同じ ID が未解決か解決済に複数あれば、どれが対か決められない。隠さず、重複として全部出す。
    if (count[impIdKey_(r)] > 1 || (resolvedById[impIdKey_(r)] || []).length > 1) return true;
    // 同じ ID でも中身が違えば別の行。隠すと画面から触れなくなるため未解決に出す。
    return !(resolvedById[impIdKey_(r)] || []).some(function (d) { return impedimentSameIdentity(d, r); });
  });
}

function impOpenIdCount_(openRows) {
  const count = Object.create(null);
  (openRows || []).forEach(function (r) {
    if (!isImpedimentPlaceholder(r)) count[impIdKey_(r)] = (count[impIdKey_(r)] || 0) + 1;
  });
  return count;
}

function impedimentPendingEntries(openRows, resolvedRows) {
  return impPendingList_(openRows, impResolvedById_(resolvedRows), impOpenIdCount_(openRows));
}

function impIdKey_(r) { return String((r || {}).id || '').trim(); }

/**
 * 途中で止まった操作。同じ ID の行が未解決と解決済の両方にあり、中身も同じもの。
 * 画面はここから「解決済として完了」「未解決に戻す」を選ばせる。
 */
function impPendingList_(openRows, resolvedById, count) {
  const seen = Object.create(null);
  const out = [];
  (openRows || []).forEach(function (o) {
    if (isImpedimentPlaceholder(o)) return;
    const key = impIdKey_(o);
    const same = resolvedById[key] || [];
    // 未解決か解決済に複数ある ID は重複として扱い、pending にしない（planUnresolvePending と同じ条件）
    if (seen[key] || count[key] > 1 || same.length > 1) return;
    for (let i = 0; i < same.length; i++) {
      if (impedimentSameIdentity(same[i], o)) {
        seen[key] = true;
        out.push({ id: key, open: o, resolved: same[i] });
        return;
      }
    }
  });
  return out;
}

/** 未解決の行のうち、ID が他の行と重なっているもの（押せない行として出す）。 */
function impDuplicateOpenRows_(openRows, resolvedById, count) {
  return (openRows || []).filter(function (r) {
    if (isImpedimentPlaceholder(r)) return false;
    const key = impIdKey_(r);
    const same = resolvedById[key] || [];
    if (count[key] > 1 || same.length > 1) return true;
    return same.length > 0 && !same.some(function (d) { return impedimentSameIdentity(d, r); });
  });
}

/** 障害物の一覧。未解決と解決済を分けて返す。 */
function buildImpedimentView(openRows, resolvedRows) {
  const resolvedById = impResolvedById_(resolvedRows);
  const count = impOpenIdCount_(openRows);
  const dups = new Set(impDuplicateOpenRows_(openRows, resolvedById, count));
  const shown = impShown_(openRows, resolvedById, count);
  const open = impedimentRows_(shown);   // shown は雛形を含まないので、添字が揃う
  shown.forEach(function (r, i) { if (dups.has(r)) open[i].duplicate = 'true'; });
  const pending = impPendingList_(openRows, resolvedById, count).map(function (p) {
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
