/**
 * スクリプトプロパティに保存する設定。フォルダ ID はコードに埋め込まない。
 */

const FOLDER_ID_KEY = 'SCRUM_FOLDER_ID';

/** 設定不備を表す例外を作る。 */
function configError(message) {
  const e = new Error(message);
  e.name = 'ConfigError';
  return e;
}

/** 設定済みのフォルダ ID を返す。未設定なら空文字。 */
function getFolderId() {
  return PropertiesService.getScriptProperties().getProperty(FOLDER_ID_KEY) || '';
}

/** フォルダ ID を保存する。 */
function setFolderId(id) {
  const value = String(id || '').trim();
  if (!value) throw configError('フォルダ ID が空です。');
  PropertiesService.getScriptProperties().setProperty(FOLDER_ID_KEY, value);
}
