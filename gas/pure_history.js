/**
 * 変更履歴（scrum/change_log.csv）。GAS API に依存しない純関数。
 *
 * Web アプリからの書き込みを、書く前後の行の差分から項目単位で記録する。
 * ID と時刻はサーバが渡す（ここでは作らない。テストで固定できるように）。
 */

const HISTORY_FIELDS = ['id', 'at', 'actor', 'target_id', 'action', 'field', 'before', 'after'];
const HISTORY_ACTIONS = ['create', 'update', 'delete', 'restore', 'resolve', 'unresolve',
  'comment_add', 'comment_delete', 'comment_restore'];
const HISTORY_TARGET_RE = /^(PBI|IMP)-\d+$/;
const HISTORY_LIMIT = 200;
const LINE_DIFF_MAX = 500;

function histText_(v) { return v === undefined || v === null ? '' : String(v); }

/** 行配列を id（trim）で引ける形にする。id が空の行は無視する。 */
function histIndex_(rows) {
  const map = {};
  const order = [];
  (rows || []).forEach(function (row) {
    const id = histText_((row || {}).id).trim();
    if (!id || Object.prototype.hasOwnProperty.call(map, id)) return;
    map[id] = row;
    order.push(id);
  });
  return { map: map, order: order };
}

/**
 * 前後の行から変更を作る。fields のうち ignore に無い列だけ比べる。
 * 並びは after の行順、消えた行はその後に before の行順。
 */
function diffRows(beforeRows, afterRows, fields, ignore) {
  const skip = ignore || [];
  const cols = (fields || []).filter(function (f) { return f !== 'id' && skip.indexOf(f) === -1; });
  const b = histIndex_(beforeRows);
  const a = histIndex_(afterRows);
  const out = [];
  a.order.forEach(function (id) {
    if (!Object.prototype.hasOwnProperty.call(b.map, id)) {
      out.push({ target_id: id, action: 'create' });
      return;
    }
    cols.forEach(function (f) {
      const x = histText_(b.map[id][f]);
      const y = histText_(a.map[id][f]);
      if (x !== y) out.push({ target_id: id, action: 'update', field: f, before: x, after: y });
    });
  });
  b.order.forEach(function (id) {
    if (!Object.prototype.hasOwnProperty.call(a.map, id)) out.push({ target_id: id, action: 'delete' });
  });
  return out;
}

/** 変更を CSV の行にする。meta = { at, actor, newId }。 */
function historyRows(events, meta) {
  return (events || []).map(function (e) {
    return {
      id: meta.newId(),
      at: histText_(meta.at),
      actor: histText_(meta.actor),
      target_id: histText_(e.target_id),
      action: histText_(e.action),
      field: histText_(e.field),
      before: histText_(e.before),
      after: histText_(e.after),
    };
  });
}

/** 対象の履歴を新しい順に返す（同じ at は元の並びを保つ）。 */
function historyFor(rows, targetId, limit) {
  const key = histText_(targetId).trim();
  const hits = [];
  (rows || []).forEach(function (row, i) {
    if (histText_(row.target_id).trim() === key) hits.push({ row: row, i: i });
  });
  hits.sort(function (p, q) {
    const x = histText_(p.row.at);
    const y = histText_(q.row.at);
    if (x === y) return p.i - q.i;
    return x < y ? 1 : -1;
  });
  return hits.slice(0, limit === undefined ? HISTORY_LIMIT : limit).map(function (h) {
    return {
      at: histText_(h.row.at), actor: histText_(h.row.actor), action: histText_(h.row.action),
      field: histText_(h.row.field), before: histText_(h.row.before), after: histText_(h.row.after),
    };
  });
}

/** 連続する同じ at + actor をまとめる。 */
function groupHistory(entries) {
  const out = [];
  (entries || []).forEach(function (e) {
    const last = out[out.length - 1];
    if (last && last.at === e.at && last.actor === e.actor) last.items.push(e);
    else out.push({ at: e.at, actor: e.actor, items: [e] });
  });
  return out;
}

function histLines_(s) {
  const t = histText_(s);
  return t === '' ? [] : t.split(/\r?\n/);
}

/** 行単位の差分（LCS）。どちらかが LINE_DIFF_MAX 行を超えたら丸ごと del / add。 */
function lineDiff(before, after) {
  const a = histLines_(before);
  const b = histLines_(after);
  if (a.length > LINE_DIFF_MAX || b.length > LINE_DIFF_MAX) {
    return a.map(function (t) { return { op: 'del', text: t }; })
      .concat(b.map(function (t) { return { op: 'add', text: t }; }));
  }
  const n = a.length;
  const m = b.length;
  const L = [];
  for (let i = 0; i <= n; i++) L.push(new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      L[i][j] = a[i - 1] === b[j - 1] ? L[i - 1][j - 1] + 1 : Math.max(L[i - 1][j], L[i][j - 1]);
    }
  }
  const rev = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      rev.push({ op: 'same', text: a[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || L[i][j - 1] >= L[i - 1][j])) {
      // 逆順に辿るので、add を先に積むと正順では del が先に出る
      rev.push({ op: 'add', text: b[j - 1] });
      j--;
    } else {
      rev.push({ op: 'del', text: a[i - 1] });
      i--;
    }
  }
  return rev.reverse();
}

if (typeof module !== 'undefined') {
  module.exports = { HISTORY_FIELDS, HISTORY_ACTIONS, HISTORY_TARGET_RE, HISTORY_LIMIT, LINE_DIFF_MAX,
    diffRows, historyRows, historyFor, groupHistory, lineDiff };
}
