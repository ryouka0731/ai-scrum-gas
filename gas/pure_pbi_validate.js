/**
 * PBI の入力検証。GAS API に依存しない純関数。
 *
 * ステータスの語彙は引数で受け取る。KANBAN_STATUSES はトップレベルの const なので、
 * var で受けると GAS の単一グローバルスコープで衝突しプロジェクト全体が起動しない。
 */

const PBI_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// id / created_at / updated_at は含めない。書き換えさせると競合判定と採番の前提が崩れる。
const PBI_EDITABLE_FIELDS = [
  'title', 'description', 'acceptance_criteria', 'priority', 'size', 'sprint', 'status',
];

const PBI_SIZE_RE = /^\d+$/;

/**
 * 入力を検証する。指定されなかった項目は検証しない（部分更新に使うため）。
 * 誤りは全部返す。1つずつ直させると往復が増える。
 */
function validatePbiFields(fields, statuses) {
  const f = fields || {};
  const errors = [];

  const title = String(f.title === undefined || f.title === null ? '' : f.title).trim();
  if (!title) errors.push('タイトルを入力してください。');

  if (f.priority !== undefined && PBI_PRIORITIES.indexOf(String(f.priority)) === -1) {
    errors.push('優先度が不正です: ' + f.priority);
  }
  if (f.status !== undefined && (statuses || []).indexOf(String(f.status)) === -1) {
    errors.push('ステータスが不正です: ' + f.status);
  }
  const size = String(f.size === undefined || f.size === null ? '' : f.size).trim();
  if (f.size !== undefined && size !== '' && !PBI_SIZE_RE.test(size)) {
    errors.push('サイズは0以上の整数で入力してください。');
  }

  return { ok: errors.length === 0, errors: errors };
}

if (typeof module !== 'undefined') {
  module.exports = { PBI_PRIORITIES, PBI_EDITABLE_FIELDS, validatePbiFields };
}
