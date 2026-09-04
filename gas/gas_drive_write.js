/**
 * Drive のファイルを書き換える。scrum/ 直下の許可されたファイルだけを対象にする。
 *
 * oauthScopes は drive（読み書き）だが、書き込み先はここで
 * assertWritableFileName により限定している。範囲を広げるときは
 * pure_write_guard.js の WRITABLE_FILES を明示的に増やすこと。
 */

/** scrum/ 直下のファイルを上書きする。無ければ例外を投げる。 */
function writeScrumFile_(name, content) {
  assertWritableFileName(name);
  const scrum = getScrumFolder_();
  const it = scrum.getFilesByName(name);
  if (!it.hasNext()) {
    throw new Error('scrum/' + name + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  const file = it.next();
  if (it.hasNext()) {
    throw new Error('scrum/' + name + ' が複数あります。Drive の競合コピーを解消してください。');
  }
  try {
    file.setContent(content);
  } catch (e) {
    // GAS の例外からは種別を判別できず、閲覧者権限しか無い場合だけでなく
    // Drive の一時障害や容量超過でも同様の例外になり得る。原因調査に使うため
    // 元のメッセージは残しつつ、権限が原因と断定しない書き方にする。
    // 権限エラーが出るのはこの1行だけなので、呼び出し側の catch でまとめて
    // 案内を付けると他のエラーまで誤誘導する。
    throw new Error(e.message + '（共有フォルダの編集権限・Drive の空き容量・一時的な障害の可能性があります。解消しなければ管理者に連絡してください）');
  }
}
