/**
 * 障害物の入力検証。GAS API に依存しない純関数。
 *
 * パネルは編集でも常に全項目を送る（競合判定を行の全列で行うため、差分送信の利点が無い）。
 * そのため部分更新を考えず、毎回全項目を検証する。
 */

// id / reported_at / status / resolved_at / resolution はサーバが決める。
const IMPEDIMENT_EDITABLE_FIELDS = ['title', 'description', 'reported_by', 'sprint'];

function impBlank_(v) {
  return String(v === undefined || v === null ? '' : v).trim() === '';
}

function validateImpedimentFields(fields) {
  const f = fields || {};
  const errors = [];
  const title = String(f.title === undefined || f.title === null ? '' : f.title).trim();
  if (!title) errors.push('タイトルを入力してください。');
  // 雛形の行（（障害物タイトル））と同じ形は、一覧から隠れてしまうため受け付けない。
  else if (title.charAt(0) === '（' && title.charAt(title.length - 1) === '）') {
    errors.push('タイトルを（）だけで囲まないでください。雛形の行と見分けられなくなります。');
  }
  if (impBlank_(f.reported_by)) errors.push('報告者を入力してください。');
  return { ok: errors.length === 0, errors: errors };
}

function validateResolution(text) {
  return impBlank_(text)
    ? { ok: false, errors: ['解決策を入力してください。'] }
    : { ok: true, errors: [] };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_EDITABLE_FIELDS, validateImpedimentFields, validateResolution };
}
