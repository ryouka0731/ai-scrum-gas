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
  file.setContent(content);
}
