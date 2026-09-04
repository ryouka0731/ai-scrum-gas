/**
 * 1行の更新を行集合へ適用する。GAS API に依存しない純関数。
 *
 * 競合の検出には CSV に既にある updated_at を使う。呼び出し側が画面を描いた
 * 時点の値を expectedUpdatedAt として渡し、その間に他の誰か（またはローカルの
 * Claude Code）が変更していれば拒否する。黙って上書きしないことが目的である。
 *
 * updated_at は秒精度（`nowText_()` は `yyyy-MM-dd HH:mm:ss`）のため、同じ秒に
 * 2回書き込むと2回目の updated_at が1回目と同じ値になり得る。その場合、
 * 1回目の書き込み後に画面を開いた別の利用者が古い expectedUpdatedAt のまま
 * 2回目を通してしまい、1回目の変更が黙って消える。これを防ぐため、書き込む
 * updated_at が直前の値と同じになるときは必ず異なる値へ進める（単調性の担保）。
 */

/**
 * yyyy-MM-dd HH:mm:ss 形式の文字列を1秒進める。解析できなければ null を返す。
 * タイムゾーンには依存しない（文字列の各要素を UTC 基準の Date として計算し、
 * 同じ書式へ戻すだけの文字列操作）。
 */
function addOneSecondToTimeText_(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(text || ''));
  if (!m) return null;
  const dt = new Date(Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6])
  ) + 1000);
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate()) + ' ' +
    pad(dt.getUTCHours()) + ':' + pad(dt.getUTCMinutes()) + ':' + pad(dt.getUTCSeconds());
}

/**
 * nowText が previousUpdatedAt と同じ値になる場合、必ず異なる値を返す。
 *
 * yyyy-MM-dd HH:mm:ss として解析できれば1秒進めた値を使う。解析できない場合
 * （このチームはローカルの AI と列を共同所有しており、日付のみの値
 * `YYYY-MM-DD` 等が実在する）は、時刻としての正確さより「必ず異なる値になる」
 * ことを優先し、末尾に区別用のマーカーを付けて返す。元の値をそのまま返すと
 * 単調性が壊れ、末尾に無条件で何かを足すと形式次第で衝突しうるため、
 * どちらでもなく「解析失敗時は安全側のマーカー付与」を選んだ。
 */
function advanceUpdatedAt_(nowText, previousUpdatedAt) {
  if (String(nowText) !== String(previousUpdatedAt)) return nowText;
  const advanced = addOneSecondToTimeText_(nowText);
  if (advanced !== null && advanced !== String(previousUpdatedAt)) return advanced;
  return String(nowText) + '#1';
}

/**
 * rows の中の id を持つ行へ changes を適用した新しい配列を返す。
 * 成功: { ok: true, rows }
 * 失敗: { ok: false, reason: 'not_found' | 'conflict', current }
 */
function applyRowUpdate(rows, id, changes, expectedUpdatedAt, nowText) {
  if (!String(id || '').trim()) return { ok: false, reason: 'not_found', current: null };

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
  // updated_at は常にサーバ側の時刻で上書きする（クライアントの申告を信じない）。
  // 直前の値と同じになる場合は advanceUpdatedAt_ が異なる値へ進める。
  next[index].updated_at = advanceUpdatedAt_(nowText, current.updated_at);
  return { ok: true, rows: next };
}

if (typeof module !== 'undefined') { module.exports = { applyRowUpdate, advanceUpdatedAt_, addOneSecondToTimeText_ }; }
