/**
 * 1行の更新を行集合へ適用する。GAS API に依存しない純関数。
 *
 * 競合の検出には CSV に既にある updated_at を使う。呼び出し側が画面を描いた
 * 時点の値を expectedUpdatedAt として渡し、その間に他の誰か（またはローカルの
 * Claude Code）が変更していれば拒否する。黙って上書きしないことが目的である。
 */

/**
 * rows の中の id を持つ行へ changes を適用した新しい配列を返す。
 * 成功: { ok: true, rows }
 * 失敗: { ok: false, reason: 'not_found' | 'conflict', current }
 */
function applyRowUpdate(rows, id, changes, expectedUpdatedAt, nowText) {
  const list = rows || [];
  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === String(id || '').trim()) { index = i; break; }
  }
  if (index === -1) return { ok: false, reason: 'not_found', current: null };

  const current = list[index];
  if (String(current.updated_at || '') !== String(expectedUpdatedAt || '')) {
    return { ok: false, reason: 'conflict', current: current };
  }

  // 元の配列は書き換えない。呼び出し側が失敗時に元の状態を保てるようにする。
  const next = list.map(function (row) {
    const copy = {};
    Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
    return copy;
  });
  Object.keys(changes || {}).forEach(function (k) { next[index][k] = changes[k]; });
  // updated_at は常にサーバ側の時刻で上書きする（クライアントの申告を信じない）
  next[index].updated_at = nowText;
  return { ok: true, rows: next };
}

if (typeof module !== 'undefined') { module.exports = { applyRowUpdate }; }
