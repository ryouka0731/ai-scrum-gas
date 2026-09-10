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
 * velocity.csv から作る選択肢。並び順は velocity.csv の行順に従う（realSprints は
 * 絞り込むだけで並べ替えない。行順はスプリントの時系列そのものなので、そのほうが読みやすい）。
 *
 * 「今の値が無ければ足す」規則はここには持たない。今の値を知っているのは画面だけで、
 * ここで足せるのは「サーバが読んだ時点の値」に限られる（読み込みの後に別の書き手が
 * 付けたスプリントには届かない）。今そこに在る値を足すのは画面側の仕事とし、
 * サーバは「PBI 側に付いている値も含めて完成させる」責任だけを持つ（sprintChoices）。
 */
function sprintOptions(velocityRows) {
  const options = [{ value: '', label: SPRINT_UNASSIGNED_LABEL, unknown: false }];
  const seen = {};
  realSprints(velocityRows || []).forEach(function (v) {
    const name = String(v.sprint || '').trim();
    if (!name || Object.prototype.hasOwnProperty.call(seen, name)) return;
    seen[name] = true;
    options.push({ value: name, label: name, unknown: false });
  });
  return options;
}

/**
 * パネルが出す選択肢を、サーバ側で完成させたもの。
 *
 * velocity.csv に無いスプリントが PBI 側に付いていることがある（ローカルの Claude Code が
 * 直接 CSV に書いた等）。それも unknown 付きで含めておく。unknown は
 * 「velocity.csv に無い ＝ ロードマップに出ない」というデータの質の話で、恒常的な情報。
 *
 * **組み立ての規則はサーバ側に置く。** 画面へ写すと、サーバ側だけを直したときに黙って
 * ずれる（例: ROADMAP_DATE_RE を緩めると、ロードマップには出るのに選択肢には出ない
 * スプリントが生まれ、プルダウンにした目的が裏返る）。内訳は
 * 絞り込みと日付の判定が realSprints（gas/pure_grid_board.js。ROADMAP_DATE_RE もそこ）、
 * 並び順と重複排除が sprintOptions、unknown の判定がこの関数。
 *
 * ただし「今そこに在る値が選択肢に無ければ足す」だけは画面側にある。ここで足せるのは
 * サーバが読んだ時点の値までで、読み込みの後に別の書き手が付けたスプリントには届かない。
 * 画面が足すほうは「この画面がまだ知らない」という一時的な状態で、意味が違うため
 * ラベルも分けてある（画面側は「（選択肢に無い値）」）。
 *
 * value は trim 済み。CSV 側は前後の空白を落とさないため、画面はこの値に揃える。
 */
function sprintChoices(velocityRows, backlogRows) {
  const options = sprintOptions(velocityRows);
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
