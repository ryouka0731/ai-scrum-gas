/**
 * スプリントの選択肢。GAS API に依存しない純関数。
 *
 * 自由入力だと打ち間違いが幽霊スプリントを作り、velocity.csv に無い名前を書くと
 * その PBI はロードマップから消える（しかもエラーは出ない）。真実の源泉は
 * velocity.csv なので、そこから選ばせる。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof realSprints === 'undefined') {
  var { realSprints } = require('./pure_grid_board.js');
}
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

const SPRINT_UNASSIGNED_LABEL = '（未割り当て）';

/** velocity.csv に無いスプリントの選択肢。見分けが付くようラベルに書く。 */
function unknownSprintOption(name) {
  return { value: name, label: name + '（velocity.csv に無い）', unknown: true };
}

/**
 * 選択肢を返す。並び順は velocity.csv の行順に従う（realSprints は絞り込むだけで
 * 並べ替えない。行順はスプリントの時系列そのものなので、そのほうが読みやすい）。
 *
 * 今の値が velocity.csv に無い場合は末尾に足す。既存値を黙って失わせないため。
 */
function sprintOptions(velocityRows, currentValue) {
  const options = [{ value: '', label: SPRINT_UNASSIGNED_LABEL, unknown: false }];
  const seen = {};
  realSprints(velocityRows || []).forEach(function (v) {
    const name = String(v.sprint || '').trim();
    if (!name || Object.prototype.hasOwnProperty.call(seen, name)) return;
    seen[name] = true;
    options.push({ value: name, label: name, unknown: false });
  });

  const current = String(currentValue === null || currentValue === undefined ? '' : currentValue).trim();
  if (current && !Object.prototype.hasOwnProperty.call(seen, current)) {
    options.push(unknownSprintOption(current));
  }
  return options;
}

/**
 * パネルが出す選択肢を、サーバ側で完成させたもの。
 *
 * velocity.csv に無いスプリントが PBI 側に付いていることがある（ローカルの Claude Code が
 * 直接 CSV に書いた等）。それも unknown 付きで含めておく。
 *
 * 「今の値が選択肢に無ければ足す」規則を画面側に残すと、その分だけ規則の写しが
 * ブラウザに残る。写しはサーバ側だけを直したときに黙ってずれる（例: ROADMAP_DATE_RE を
 * 緩めると、ロードマップには出るのに選択肢には出ないスプリントが生まれ、プルダウンに
 * した目的が裏返る）。ここで完成させ、画面は並べて選ぶだけにする。
 *
 * value は trim 済み。CSV 側は前後の空白を落とさないため、画面はこの値に揃える。
 */
function sprintChoices(velocityRows, backlogRows) {
  const options = sprintOptions(velocityRows, '');
  const seen = {};
  options.forEach(function (o) { seen[o.value] = true; });

  filterRealRows(backlogRows || []).forEach(function (row) {
    const name = String(row.sprint || '').trim();
    if (!name || Object.prototype.hasOwnProperty.call(seen, name)) return;
    seen[name] = true;
    options.push(unknownSprintOption(name));
  });
  return options;
}

if (typeof module !== 'undefined') {
  module.exports = { SPRINT_UNASSIGNED_LABEL, sprintOptions, sprintChoices };
}
