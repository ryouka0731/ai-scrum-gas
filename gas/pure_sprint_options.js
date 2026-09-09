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

const SPRINT_UNASSIGNED_LABEL = '（未割り当て）';

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
    options.push({ value: current, label: current + '（velocity.csv に無い）', unknown: true });
  }
  return options;
}

if (typeof module !== 'undefined') { module.exports = { SPRINT_UNASSIGNED_LABEL, sprintOptions }; }
