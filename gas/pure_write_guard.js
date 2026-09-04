/**
 * Drive への書き込み先を絞る。GAS API に依存しない純関数。
 *
 * oauthScopes を drive.readonly から drive（読み書き）へ広げるため、
 * コード側で書き込めるファイルを許可リストで限定する。増やすときは
 * 明示的にこの配列へ足すこと。
 */

const WRITABLE_FILES = ['product_backlog.csv'];

/** 書き込みを許さない名前なら例外を投げる。scrum/ 直下のファイル名のみ許す。 */
function assertWritableFileName(name) {
  const n = name === undefined || name === null ? '' : String(name);
  if (n !== n.trim() || n === '') {
    throw new Error('ファイル名が不正です: ' + JSON.stringify(name));
  }
  if (n.indexOf('/') !== -1 || n.indexOf('\\') !== -1 || n.indexOf('..') !== -1) {
    throw new Error('ファイル名にパスを含められません: ' + n);
  }
  if (WRITABLE_FILES.indexOf(n) === -1) {
    throw new Error(n + ' への書き込みが許可されていません。');
  }
}

if (typeof module !== 'undefined') {
  module.exports = { WRITABLE_FILES, assertWritableFileName };
}
