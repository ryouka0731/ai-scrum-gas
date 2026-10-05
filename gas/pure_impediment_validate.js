/**
 * 障害物の入力検証。GAS API に依存しない純関数。
 *
 * パネルは編集でも常に全項目を送る（競合判定を行の全列で行うため、差分送信の利点が無い）。
 * そのため部分更新を考えず、毎回全項目を検証する。
 */

// id / reported_at / status / resolved_at / resolution はサーバが決める。
const IMPEDIMENT_EDITABLE_FIELDS = ['title', 'description', 'reported_by', 'sprint'];

function blank_(v) {
  return String(v === undefined || v === null ? '' : v).trim() === '';
}

function validateImpedimentFields(fields) {
  const f = fields || {};
  const errors = [];
  if (blank_(f.title)) errors.push('タイトルを入力してください。');
  if (blank_(f.reported_by)) errors.push('報告者を入力してください。');
  return { ok: errors.length === 0, errors: errors };
}

function validateResolution(text) {
  return blank_(text)
    ? { ok: false, errors: ['解決策を入力してください。'] }
    : { ok: true, errors: [] };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_EDITABLE_FIELDS, validateImpedimentFields, validateResolution };
}
