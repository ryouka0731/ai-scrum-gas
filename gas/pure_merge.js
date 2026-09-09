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
 * updated_at は常に直前の値より大きくする（単調増加の担保）。
 */

/**
 * yyyy-MM-dd HH:mm:ss 形式の文字列を1秒進める。解析できなければ null を返す。
 * タイムゾーンには依存しない（文字列の各要素を UTC 基準の Date として計算し、
 * 同じ書式へ戻すだけの文字列操作）。
 *
 * 日付のみの yyyy-MM-dd も受け取る。ローカルの Claude Code はこの書式で書き、
 * 時差で未来日になることがある。受け取らないと `2026-09-05#1#1#1…` と
 * マーカーが際限なく伸び、列が解析できない値で埋まる。
 */
function addOneSecondToTimeText_(text) {
  const raw = String(text || '');
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  const m = dateOnly
    ? [raw, dateOnly[1], dateOnly[2], dateOnly[3], '00', '00', '00']
    : /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(raw);
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
 * 直前の値より必ず大きい updated_at を返す。
 *
 * 「同じ値にならない」だけでは足りない。同じ秒に3回書き込むと
 * `T → T+1秒 → T` と値が戻り、T を見て画面を開いた利用者の古い更新が
 * 再び通ってしまう。そのため単調増加（strictly increasing）を保証する。
 *
 * この書式は文字列の辞書順と時刻順が一致するため、比較は文字列のままでよい。
 * 解析できない値（このチームはローカルの AI と列を共同所有しており、
 * 日付のみの `YYYY-MM-DD` 等が実在する）に対しては、時刻としての正確さより
 * 「必ず前より大きい値になる」ことを優先し、末尾にマーカーを付ける。
 */
function advanceUpdatedAt_(nowText, previousUpdatedAt) {
  const prev = String(previousUpdatedAt || '');
  const now = String(nowText);
  if (now > prev) return now;
  // now が prev 以下（＝同じ秒に複数回、または prev が未来日）のときは prev を進める。
  const advanced = addOneSecondToTimeText_(prev);
  if (advanced !== null && advanced > prev) return advanced;
  return prev + '#1';
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
  const next = list.map(copyRow_);
  Object.keys(changes || {}).forEach(function (k) { next[index][k] = changes[k]; });
  // updated_at は常にサーバ側の時刻で上書きする（クライアントの申告を信じない）。
  // 直前の値と同じになる場合は advanceUpdatedAt_ が異なる値へ進める。
  next[index].updated_at = advanceUpdatedAt_(nowText, current.updated_at);
  return { ok: true, rows: next };
}

/** 行を浅くコピーする。元の配列を書き換えないため。 */
function copyRow_(row) {
  const copy = {};
  Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
  return copy;
}

/**
 * 新しい行を末尾に足す。
 *
 * allFields の列を全て空文字で用意してから fields を重ねる。埋め忘れた列があると
 * toCsv の出力で列がずれる。allFields に無いキーは捨てる（toCsv が拾わないため
 * 混ぜても黙って消えるだけで、混入に気づけない）。
 * id / created_at / updated_at はクライアントの申告を信じず、必ず引数の値を使う。
 */
function appendRow(rows, id, fields, allFields, nowText) {
  const list = rows || [];
  const key = String(id || '').trim();
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === key) {
      return { ok: false, reason: 'duplicate_id', current: list[i] };
    }
  }
  const row = {};
  (allFields || []).forEach(function (f) { row[f] = ''; });
  Object.keys(fields || {}).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(row, k)) row[k] = fields[k];
  });
  row.id = key;
  row.created_at = nowText;
  row.updated_at = nowText;
  return { ok: true, rows: list.map(copyRow_).concat([row]) };
}

/**
 * 行を1つ消す。updated_at を照合し、見ていない変更がある行は消させない。
 */
function deleteRow(rows, id, expectedUpdatedAt) {
  const list = rows || [];
  const key = String(id || '').trim();
  if (!key) return { ok: false, reason: 'not_found', current: null };

  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === key) { index = i; break; }
  }
  if (index === -1) return { ok: false, reason: 'not_found', current: null };

  const current = list[index];
  if (String(current.updated_at || '') !== String(expectedUpdatedAt || '')) {
    return { ok: false, reason: 'conflict', current: current };
  }
  const next = [];
  list.forEach(function (row, i) { if (i !== index) next.push(copyRow_(row)); });
  return { ok: true, rows: next };
}

/**
 * 削除した行を元の id / created_at のまま戻す。
 *
 * 取り消しで新規作成を使うと ID が変わり、ローカルの Claude Code が残した参照が
 * 切れる。updated_at だけは戻した時刻にする（戻したことも変更であり、他の人の
 * 画面から見れば「見ていない変更」になる必要があるため）。
 */
function restoreRow(rows, row, allFields, nowText) {
  const list = rows || [];
  const src = row || {};
  const key = String(src.id || '').trim();
  // id が無いのは「既に存在する」のではなく不正な入力である。duplicate_id を
  // 返すと「この PBI は既に存在します」と出てしまい、実際の原因と食い違う。
  if (!key) return { ok: false, reason: 'invalid', current: null };
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === key) {
      return { ok: false, reason: 'duplicate_id', current: list[i] };
    }
  }
  const back = {};
  (allFields || []).forEach(function (f) { back[f] = ''; });
  Object.keys(src).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(back, k)) back[k] = src[k];
  });
  back.id = key;
  back.updated_at = nowText;
  return { ok: true, rows: list.map(copyRow_).concat([back]) };
}

if (typeof module !== 'undefined') {
  module.exports = { applyRowUpdate, appendRow, deleteRow, restoreRow, advanceUpdatedAt_, addOneSecondToTimeText_ };
}
