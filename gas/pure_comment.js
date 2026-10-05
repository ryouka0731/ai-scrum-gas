/**
 * コメント（scrum/comments.csv）。GAS API に依存しない純関数。
 *
 * PBI・障害物に紐づく（target_id）。追記が主で、競合判定は要らない。削除は本人だけ。
 * ID はサーバが UUID から作って渡す（ここでは作らない。テストで固定できるように）。
 */

const COMMENT_FIELDS = ['id', 'target_id', 'author', 'created_at', 'body'];
const COMMENT_TARGET_RE = /^(PBI|IMP)-\d+$/;
const COMMENT_ID_RE = /^CMT-[0-9a-f]{8}$/;
const COMMENT_BODY_MAX = 2000;
const COMMENT_TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function cmtText_(v) { return v === undefined || v === null ? '' : String(v); }

function cmtPick_(row) {
  const out = {};
  COMMENT_FIELDS.forEach(function (f) { out[f] = cmtText_((row || {})[f]); });
  return out;
}

function validateComment(targetId, body) {
  const errors = [];
  const t = cmtText_(targetId).trim();
  const b = cmtText_(body);
  if (!COMMENT_TARGET_RE.test(t)) errors.push('コメントの対象が不正です: ' + t);
  if (!b.trim()) errors.push('コメントを入力してください。');
  else if (b.length > COMMENT_BODY_MAX) errors.push('コメントは' + COMMENT_BODY_MAX + '字以内で入力してください。');
  return { ok: errors.length === 0, errors: errors };
}

function cmtIndex_(rows, id) {
  const key = cmtText_(id).trim();
  for (let i = 0; i < rows.length; i++) if (cmtText_(rows[i].id).trim() === key) return i;
  return -1;
}

function appendComment(rows, id, targetId, author, body, nowText) {
  const comment = { id: id, target_id: cmtText_(targetId).trim(), author: cmtText_(author), created_at: nowText, body: cmtText_(body) };
  return { ok: true, rows: (rows || []).map(cmtPick_).concat([comment]), comment: comment };
}

function deleteComment(rows, id, me) {
  const list = rows || [];
  const i = cmtIndex_(list, id);
  if (i === -1) return { ok: false, reason: 'not_found' };
  // ログインが取れない（空）ときは誰のものでもない。空どうしを一致とみなさない。
  if (!cmtText_(me) || cmtText_(list[i].author) !== cmtText_(me)) return { ok: false, reason: 'forbidden' };
  const removed = cmtPick_(list[i]);
  return { ok: true, rows: list.filter(function (_, k) { return k !== i; }).map(cmtPick_), removed: removed };
}

function restoreComment(rows, row) {
  const src = cmtPick_(row);
  if (!row || !COMMENT_ID_RE.test(src.id) || !validateComment(src.target_id, src.body).ok || !COMMENT_TIME_RE.test(src.created_at)) {
    return { ok: false, reason: 'invalid' };
  }
  const list = (rows || []).map(cmtPick_);
  if (cmtIndex_(list, src.id) !== -1) return { ok: true, rows: list, unchanged: true };
  return { ok: true, rows: list.concat([src]) };
}

function groupComments(rows, me) {
  const out = {};
  const who = cmtText_(me);
  (rows || []).map(cmtPick_).forEach(function (r, i) {
    const t = r.target_id.trim();
    if (!COMMENT_TARGET_RE.test(t)) return;
    (out[t] = out[t] || []).push({ row: r, i: i });
  });
  Object.keys(out).forEach(function (t) {
    out[t] = out[t].sort(function (a, b) {
      if (a.row.created_at < b.row.created_at) return -1;
      if (a.row.created_at > b.row.created_at) return 1;
      return a.i - b.i;
    }).map(function (x) {
      const c = x.row;
      return { id: c.id, target_id: c.target_id, author: c.author, created_at: c.created_at, body: c.body,
        mine: !!who && c.author === who };
    });
  });
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { COMMENT_FIELDS, COMMENT_TARGET_RE, COMMENT_ID_RE, COMMENT_BODY_MAX,
    validateComment, appendComment, deleteComment, restoreComment, groupComments };
}
