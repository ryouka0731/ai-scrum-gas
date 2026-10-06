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
// 履歴の before / after に持つ値1つの上限（文字数）。PBI の説明・受入基準には長さの上限が無く、
// 編集のたびに前後の全文を残すと change_log.csv と履歴の応答が際限なく大きくなる。
const HISTORY_VALUE_MAX = 4000;
const HISTORY_CAPPED_RE = /…（以下省略・全 \d+ 字）$/;

function histText_(v) { return v === undefined || v === null ? '' : String(v); }

/**
 * 履歴に持つ値を HISTORY_VALUE_MAX 字（コードポイント）までに切り詰め、「…（以下省略・全 N 字）」を付ける。
 * 上限以下はそのまま。切り詰め済みの値（読み出しで再び通したとき）は変えない。サロゲートペアは割らない。
 */
function capHistoryValue(v) {
  const t = histText_(v);
  if (t.length <= HISTORY_VALUE_MAX) return t;
  if (HISTORY_CAPPED_RE.test(t) && t.length <= HISTORY_VALUE_MAX * 2 + 40) return t;
  let count = 0;
  let cut = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < t.length) {
      const d = t.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    count++;
    if (count === HISTORY_VALUE_MAX) cut = i + 1;
  }
  if (count <= HISTORY_VALUE_MAX) return t;
  return t.slice(0, cut) + '…（以下省略・全 ' + count + ' 字）';
}

/** 比べる列の値を、取り違えの起きない1つの文字列にする（索引の鍵）。 */
function histContentKey_(row, cols) {
  return JSON.stringify(cols.map(function (f) { return histText_(row[f]); }));
}

/**
 * 前後の行から変更を作る。fields のうち ignore に無い列だけ比べる。
 * 並びは after の行順、消えた行はその後に before の行順。
 *
 * 同じ id の行が複数あってもよい（配布の雛形と本物の行が同じ ID を持つ、ローカルで
 * 重複した ID が書かれた、など）。id ごとに、まず中身の変わらない行どうしを対応づけ、
 * 残りを並び順に対応づける。対応のつかない after の行は create、before の行は delete。
 * id の最初の行だけを見ると、雛形の陰にある本物の行の編集が記録されず、重複の片方の
 * 削除が「存在しない update」として記録される。
 *
 * 対応づけは id → 行、(id, 中身) → 行 の索引で行う（同じ id の行が多くても行数に線形）。
 * どちらも before の並び順で「まだ対応のついていない最初の行」を選ぶ。
 */
function diffRows(beforeRows, afterRows, fields, ignore) {
  const skip = ignore || [];
  const cols = (fields || []).filter(function (f) { return f !== 'id' && skip.indexOf(f) === -1; });
  // id ごとの候補（before の並び順）と、次に見る位置。'__proto__' のような id でも壊れないように。
  const byId = Object.create(null);
  const byContent = Object.create(null);
  // 同じ行（同じオブジェクト）が before に2回以上あるときも、消えた行は「その行のまだ使っていない候補」で数える。
  const byRow = new Map();
  (beforeRows || []).forEach(function (row) {
    const id = histText_((row || {}).id).trim();
    if (!id) return;
    const cand = { row: row, used: false };
    const same = byRow.get(row) || { list: [], next: 0 };
    same.list.push(cand);
    byRow.set(row, same);
    const g = byId[id] || (byId[id] = { list: [], next: 0 });
    g.list.push(cand);
    const ck = byContent[id] || (byContent[id] = Object.create(null));
    const key = histContentKey_(row, cols);
    const q = ck[key] || (ck[key] = { list: [], next: 0 });
    q.list.push(cand);
  });
  const afterList = [];
  (afterRows || []).forEach(function (row) {
    const id = histText_((row || {}).id).trim();
    if (id) afterList.push({ id: id, row: row, pair: null });
  });
  // 1巡目: 中身の変わらない行どうし
  afterList.forEach(function (x) {
    const q = byContent[x.id] && byContent[x.id][histContentKey_(x.row, cols)];
    if (!q) return;
    while (q.next < q.list.length && q.list[q.next].used) q.next++;
    if (q.next < q.list.length) { const c = q.list[q.next++]; c.used = true; x.pair = c.row; x.same = true; }
  });
  // 2巡目: 残りを並び順に
  afterList.forEach(function (x) {
    if (x.pair) return;
    const g = byId[x.id];
    if (!g) return;
    while (g.next < g.list.length && g.list[g.next].used) g.next++;
    if (g.next < g.list.length) { const c = g.list[g.next++]; c.used = true; x.pair = c.row; }
  });
  const out = [];
  afterList.forEach(function (x) {
    if (!x.pair) { out.push({ target_id: x.id, action: 'create' }); return; }
    if (x.same) return;
    cols.forEach(function (f) {
      const v0 = histText_(x.pair[f]);
      const v1 = histText_(x.row[f]);
      if (v0 !== v1) out.push({ target_id: x.id, action: 'update', field: f, before: v0, after: v1 });
    });
  });
  (beforeRows || []).forEach(function (row) {
    const id = histText_((row || {}).id).trim();
    if (!id) return;
    const same = byRow.get(row);
    while (same.next < same.list.length && same.list[same.next].used) same.next++;
    if (same.next < same.list.length) { same.list[same.next++].used = true; out.push({ target_id: id, action: 'delete' }); }
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
      before: capHistoryValue(e.before),
      after: capHistoryValue(e.after),
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
      // 上限より前に書かれた全文の行も、応答では同じく切り詰める。
      field: histText_(h.row.field), before: capHistoryValue(h.row.before), after: capHistoryValue(h.row.after),
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
  module.exports = { HISTORY_FIELDS, HISTORY_ACTIONS, HISTORY_TARGET_RE, HISTORY_LIMIT, LINE_DIFF_MAX, HISTORY_VALUE_MAX,
    capHistoryValue, diffRows, historyRows, historyFor, groupHistory, lineDiff };
}
