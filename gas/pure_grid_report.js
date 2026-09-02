/**
 * ベロシティ・バーンダウン・障害物・ダッシュボードの2次元配列を組み立てる。
 * GAS API に依存しない純関数。
 */

// GAS 上では pure_filter.js / pure_markdown.js が同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
  var { extractMarkdownTable, extractSection } = require('./pure_markdown.js');
}

const VELOCITY_HEADERS = ['スプリント', '計画', '完了', '持ち越し', '開始日', '終了日', '備考'];
const IMPEDIMENT_LABELS = ['ID', 'タイトル', '説明', '報告者', '報告日', 'ステータス', '解決日', '解決策', 'スプリント'];
const IMPEDIMENT_FIELDS = ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'];
const IMPEDIMENT_HEADERS = IMPEDIMENT_LABELS.concat(['メモ']);
const IMPEDIMENT_KEY_COL = 0;
const IMPEDIMENT_NOTE_COL = IMPEDIMENT_HEADERS.length - 1;
const IMP_ID_RE = /^IMP-\d+$/;
// トップレベルの const は GAS 上で全ファイル共通のスコープに入るため、固有の名前にする。
const VELOCITY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ベロシティシート用の2次元配列を返す。期間が埋まった行だけを出す。 */
function buildVelocityGrid(velocityRows) {
  const grid = [VELOCITY_HEADERS];
  (velocityRows || []).forEach(function (v) {
    if (!VELOCITY_DATE_RE.test(String(v.sprint_start || '').trim())) return;
    if (!VELOCITY_DATE_RE.test(String(v.sprint_end || '').trim())) return;
    grid.push([
      String(v.sprint || ''), String(v.planned_points || ''), String(v.completed_points || ''),
      String(v.carried_over_points || ''), String(v.sprint_start || ''),
      String(v.sprint_end || ''), String(v.notes || ''),
    ]);
  });
  return grid;
}

/** バーンダウンシート用の2次元配列を返す。表が無ければ null。 */
function buildBurndownGrid(sprintBacklogMd) {
  const table = extractMarkdownTable(sprintBacklogMd, 'バーンダウン');
  if (!table) return null;
  return [table.headers].concat(table.rows);
}

/** 障害物のひな形行かどうか。 */
function isImpedimentPlaceholder(row) {
  const r = row || {};
  if (!IMP_ID_RE.test(String(r.id || '').trim())) return true;
  const title = String(r.title || '').trim();
  if (!title) return true;
  if (title.charAt(0) === '（' && title.charAt(title.length - 1) === '）') return true;
  if (String(r.reported_at || '').trim() === 'YYYY-MM-DD') return true;
  return false;
}

/**
 * scrum/.published.json の内容を配布情報オブジェクトへ変換する。
 * 読めない・壊れている・publishedAt を欠く場合は null（呼び出し側はそのまま「記録なし」として扱う）。
 */
function parsePublished(text) {
  if (!text) return null;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const publishedAt = String(obj.publishedAt || '').trim();
  if (!publishedAt) return null;
  return {
    publishedAt: publishedAt,
    commit: String(obj.commit || 'unknown').trim() || 'unknown',
    branch: String(obj.branch || 'unknown').trim() || 'unknown',
  };
}

/** 障害物シート用の2次元配列を返す。未解決を先に並べる。 */
function buildImpedimentGrid(openRows, resolvedRows, notesByKey) {
  const notes = notesByKey || {};
  const grid = [IMPEDIMENT_HEADERS];
  const push = function (rows) {
    (rows || []).forEach(function (row) {
      if (isImpedimentPlaceholder(row)) return;
      const values = IMPEDIMENT_FIELDS.map(function (f) {
        return String(row[f] === undefined ? '' : row[f]);
      });
      grid.push(values.concat([String(notes[String(row.id).trim()] || '')]));
    });
  };
  push(openRows);
  push(resolvedRows);
  return grid;
}

/** ダッシュボードシート用の2次元配列を返す。 */
function buildDashboardGrid(ctx) {
  const c = ctx || {};
  const goal = extractSection(c.sprintBacklogMd || '', 'スプリントゴール');
  const rows = filterRealRows(c.backlogRows || []);

  const order = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
  const counts = {};
  const points = {};
  order.forEach(function (s) { counts[s] = 0; points[s] = 0; });
  rows.forEach(function (r) {
    const s = order.indexOf(String(r.status || '').trim()) === -1 ? 'New' : String(r.status).trim();
    counts[s] += 1;
    const size = parseFloat(r.size);
    points[s] += isNaN(size) ? 0 : size;
  });

  const grid = [
    ['AI Scrum ダッシュボード'],
    [''],
    ['最終同期', String(c.syncedAt || '')],
  ];
  if (c.published) {
    grid.push(['配布日時', String(c.published.publishedAt || '')]);
    grid.push(['コミット', String(c.published.commit || '')]);
  } else {
    grid.push(['配布日時', '（記録なし）']);
  }
  grid.push(
    [''],
    ['スプリントゴール'],
    [goal || '（未設定）'],
    [''],
    ['ステータス', '件数', 'ポイント'],
  );
  order.forEach(function (s) { grid.push([s, String(counts[s]), String(points[s])]); });
  grid.push(['合計', String(rows.length), String(order.reduce(function (a, s) { return a + points[s]; }, 0))]);

  const warnings = c.warnings || [];
  grid.push(['']);
  grid.push(['警告']);
  if (warnings.length === 0) {
    grid.push(['なし']);
  } else {
    warnings.forEach(function (w) { grid.push([String(w)]); });
  }

  // setValues は全行の列数が揃っている必要があるため、最大列数に合わせて空文字で埋める
  const width = grid.reduce(function (max, r) { return Math.max(max, r.length); }, 0);
  return grid.map(function (r) {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}

/** 同期ログシート用の2次元配列を返す。 */
function buildSyncLogGrid(syncedAt, readFiles, warnings) {
  const files = readFiles || [];
  const warns = warnings || [];
  return [
    ['同期時刻', '読み取ったファイル', '警告'],
    [
      String(syncedAt || ''),
      files.length === 0 ? 'なし' : files.join('\n'),
      warns.length === 0 ? 'なし' : warns.join('\n'),
    ],
  ];
}

if (typeof module !== 'undefined') {
  module.exports = {
    VELOCITY_HEADERS, IMPEDIMENT_HEADERS, IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL,
    buildVelocityGrid, buildBurndownGrid, buildImpedimentGrid, buildDashboardGrid,
    buildSyncLogGrid, parsePublished,
  };
}
