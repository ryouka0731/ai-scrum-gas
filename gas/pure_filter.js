/**
 * ひな形行の判定とスプリント名の正規化。GAS API に依存しない純関数。
 * 判定条件は現行の scripts/github_project/sync_backlog.py から移植したもの。
 */

const PBI_ID_RE = /^PBI-\d+$/;
// scrum/ 直下のスプリントフォルダ。ひな形の sprintSAMPLE を除くため連番までを必須にする。
const SPRINT_FOLDER_RE = /^sprint(\d+)$/;

/** テンプレートのままの行かどうかを判定する。 */
function isPlaceholderRow(row) {
  const r = row || {};
  const id = String(r.id || '').trim();
  if (!PBI_ID_RE.test(id)) return true;

  const title = String(r.title || '').trim();
  if (!title) return true;
  // 全角括弧で囲まれたひな形テキスト
  if (title.charAt(0) === '（' && title.charAt(title.length - 1) === '）') return true;

  if (String(r.created_at || '').trim() === 'YYYY-MM-DD') return true;
  if (String(r.priority || '').indexOf('/') !== -1) return true;  // "Critical/High/Medium/Low"
  return false;
}

/**
 * スプリント名を照合用に正規化する。
 * product_backlog.csv は "Sprint 001"、velocity.csv は "sprint001" と表記が揺れるため、
 * 区切り文字を落として小文字化し、末尾の連番を3桁ゼロ埋めに揃える。
 */
function normalizeSprint(name) {
  const key = String(name || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
  if (!key) return '';
  const m = key.match(/^(.*?)(\d+)$/);
  if (!m) return key;
  const num = String(parseInt(m[2], 10));
  const padded = num.length >= 3 ? num : ('00' + num).slice(-3);
  return m[1] + padded;
}

/**
 * フォルダ名の配列から最新のスプリントフォルダ名を返す。該当が無ければ null。
 * - `sprintSAMPLE` のようなひな形フォルダは連番を持たないため対象外にする
 * - 文字列比較では sprint9 が sprint10 より後ろに並ぶため、連番を数値として比較する
 * 戻り値は引数に含まれていた文字列そのものなので、呼び出し側で元の要素と対応づけられる。
 */
function pickLatestSprintName(names) {
  let latest = null;
  let latestNumber = -1;
  (names || []).forEach(function (name) {
    const m = SPRINT_FOLDER_RE.exec(String(name === undefined || name === null ? '' : name));
    if (!m) return;
    const num = parseInt(m[1], 10);
    if (num > latestNumber) { latestNumber = num; latest = name; }
  });
  return latest;
}

/** ひな形行を除いた配列を返す。 */
function filterRealRows(rows) {
  return (rows || []).filter(function (r) { return !isPlaceholderRow(r); });
}

if (typeof module !== 'undefined') {
  module.exports = { isPlaceholderRow, normalizeSprint, filterRealRows, pickLatestSprintName };
}
