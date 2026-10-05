/**
 * 障害物の行の操作。GAS API に依存しない純関数。
 *
 * 障害物の CSV には updated_at が無く、列は足せない。競合は「画面が見た行」と
 * 「今の行」を全列で比べて判定する。
 *
 * 未解決と解決済はファイルで分かれる。解決・取り消しは2ファイルにまたがるため、
 * ここでは「どのファイルに何を書くか」だけを決め、書く順序は呼び出し側
 * （足す側 → 消す側）に任せる。書かなくてよいファイルは null で返す。
 */

// Node テスト用: グローバルに参照を置く（GAS は const で宣言済みなのでここでは何もしない）。
// var で同名の定数を宣言すると GAS のグローバルスコープで再宣言エラーになるため、
// 1文字の仲介変数を使わずに globalThis に直接代入する。
if (typeof require !== 'undefined' && typeof IMPEDIMENT_FIELDS === 'undefined') {
  globalThis.IMPEDIMENT_FIELDS = require('./pure_grid_report.js').IMPEDIMENT_FIELDS;
}
if (typeof require !== 'undefined' && typeof IMPEDIMENT_EDITABLE_FIELDS === 'undefined') {
  globalThis.IMPEDIMENT_EDITABLE_FIELDS = require('./pure_impediment_validate.js').IMPEDIMENT_EDITABLE_FIELDS;
}
if (typeof require !== 'undefined' && typeof IMPEDIMENT_ID_NUM_RE === 'undefined') {
  globalThis.IMPEDIMENT_ID_NUM_RE = require('./pure_impediment_id.js').IMPEDIMENT_ID_NUM_RE;
}
if (typeof require !== 'undefined' && typeof isImpedimentPlaceholder === 'undefined') {
  var { isImpedimentPlaceholder } = require('./pure_grid_report.js');
}

function impText_(v) { return v === undefined || v === null ? '' : String(v); }

function impedimentRowsEqual(a, b) {
  const x = a || {};
  const y = b || {};
  return IMPEDIMENT_FIELDS.every(function (f) { return impText_(x[f]) === impText_(y[f]); });
}

function impIndex_(rows, id) {
  const key = String(id || '').trim();
  if (!key) return -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].id || '').trim() === key) return i;
  }
  return -1;
}

/** 雛形の行を飛ばして ID を探す。配布の雛形 IMP-001 を本物の行と取り違えないため。 */
function impRealIndex_(rows, id) {
  const key = String(id || '').trim();
  if (!key) return -1;
  for (let i = 0; i < rows.length; i++) {
    if (!isImpedimentPlaceholder(rows[i]) && String(rows[i].id || '').trim() === key) return i;
  }
  return -1;
}

/**
 * 解決・取り消しで変わらない列（status / resolved_at / resolution 以外）が同じか。
 * 同じなら「同じ障害物が途中まで移った」とみなす。違えば別の行なので触らない。
 */
function impSameIdentity_(a, b) {
  const x = a || {};
  const y = b || {};
  return ['id', 'title', 'description', 'reported_by', 'reported_at', 'sprint'].every(function (f) {
    return impText_(x[f]) === impText_(y[f]);
  });
}

function impCopy_(row) {
  const out = {};
  Object.keys(row || {}).forEach(function (k) { out[k] = row[k]; });
  return out;
}

/** IMPEDIMENT_FIELDS の列だけを持つ行を作る。それ以外のキーは捨てる。 */
function impPick_(row) {
  const out = {};
  IMPEDIMENT_FIELDS.forEach(function (f) { out[f] = impText_((row || {})[f]); });
  return out;
}

function impWithout_(rows, index) {
  const out = [];
  rows.forEach(function (r, i) { if (i !== index) out.push(impCopy_(r)); });
  return out;
}

function appendImpediment(rows, id, fields, todayText) {
  const list = rows || [];
  if (impIndex_(list, id) !== -1) return { ok: false, reason: 'duplicate_id' };
  const row = impPick_({});
  IMPEDIMENT_EDITABLE_FIELDS.forEach(function (f) { row[f] = impText_((fields || {})[f]); });
  row.id = String(id).trim();
  row.reported_at = todayText;
  row.status = 'Open';
  return { ok: true, rows: list.map(impCopy_).concat([row]), row: row };
}

function updateImpediment(rows, id, fields, expected) {
  const list = rows || [];
  const i = impIndex_(list, id);
  if (i === -1) return { ok: false, reason: 'not_found' };
  if (!impedimentRowsEqual(list[i], expected)) return { ok: false, reason: 'conflict' };
  const next = list.map(impCopy_);
  IMPEDIMENT_EDITABLE_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, f)) next[i][f] = impText_(fields[f]);
  });
  return { ok: true, rows: next };
}

function planResolve(openRows, resolvedRows, id, resolution, expected, todayText) {
  const open = openRows || [];
  const resolved = resolvedRows || [];
  const oi = impRealIndex_(open, id);
  const ri = impRealIndex_(resolved, id);
  if (oi === -1) return { ok: false, reason: ri === -1 ? 'not_found' : 'conflict' };
  if (!impedimentRowsEqual(open[oi], expected)) return { ok: false, reason: 'conflict' };
  const moved = impPick_(open[oi]);
  if (ri !== -1) {
    // 同じ ID でも中身が違えば別の行。消すと解決策ごと失われるため触らない。
    if (!impSameIdentity_(resolved[ri], open[oi])) return { ok: false, reason: 'conflict' };
    // 前回の解決が「resolved に足した」ところで止まっている。足し直さず、消すだけで完了させる。
    return { ok: true, open: impWithout_(open, oi), resolved: null, moved: moved, resolvedRow: impPick_(resolved[ri]) };
  }
  const resolvedRow = impPick_(open[oi]);
  resolvedRow.status = 'Resolved';
  resolvedRow.resolved_at = todayText;
  resolvedRow.resolution = impText_(resolution);
  return {
    ok: true,
    open: impWithout_(open, oi),
    resolved: resolved.map(impCopy_).concat([resolvedRow]),
    moved: moved,
    resolvedRow: resolvedRow,
  };
}

function planUnresolve(openRows, resolvedRows, moved, resolvedRow) {
  const open = openRows || [];
  const resolved = resolvedRows || [];
  const src = moved || {};
  const id = String(src.id || '').trim();
  if (!IMPEDIMENT_ID_NUM_RE.test(id) || !impText_(src.title).trim() ||
      id !== String((resolvedRow || {}).id || '').trim()) {
    return { ok: false, reason: 'invalid' };
  }
  const oi = impRealIndex_(open, id);
  const ri = impRealIndex_(resolved, id);
  // open に同じ ID でも中身の違う行があれば、取り消しの途中とはみなさない。
  if (oi !== -1 && !impSameIdentity_(open[oi], src)) return { ok: false, reason: 'conflict' };
  if (ri === -1) {
    // 既に戻っている（前回の取り消しが完了済み）なら、何も書かずに成功とする。
    if (oi !== -1) return { ok: true, open: null, resolved: null };
    return { ok: false, reason: 'not_found' };
  }
  if (!impedimentRowsEqual(resolved[ri], resolvedRow)) return { ok: false, reason: 'conflict' };
  return {
    ok: true,
    // 前回の取り消しが「open に足した」ところで止まっていれば、足し直さない。
    open: oi !== -1 ? null : open.map(impCopy_).concat([impPick_(src)]),
    resolved: impWithout_(resolved, ri),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { impedimentRowsEqual, appendImpediment, updateImpediment, planResolve, planUnresolve };
}
