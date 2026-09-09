/**
 * スクリプトプロパティに保存する設定。フォルダ ID はコードに埋め込まない。
 */

const FOLDER_ID_KEY = 'SCRUM_FOLDER_ID';
// これまでに採番した最大の PBI ID（例: 'PBI-006'）。product_backlog.csv から
// 最大値の行が削除されても、次の採番がその ID を再利用しないための高水位。
const LAST_PBI_ID_KEY = 'LAST_PBI_ID';

/** 設定不備を表す例外を作る。 */
function configError_(message) {
  const e = new Error(message);
  e.name = 'ConfigError';
  return e;
}

/** 設定済みのフォルダ ID を返す。未設定なら空文字。 */
function getFolderId_() {
  return PropertiesService.getScriptProperties().getProperty(FOLDER_ID_KEY) || '';
}

/** フォルダ ID を保存する。 */
function setFolderId_(id) {
  const value = String(id || '').trim();
  if (!value) throw configError_('フォルダ ID が空です。');
  PropertiesService.getScriptProperties().setProperty(FOLDER_ID_KEY, value);
}

/** 記録済みの高水位 PBI ID を返す。未設定なら空文字。 */
function getLastPbiId_() {
  return PropertiesService.getScriptProperties().getProperty(LAST_PBI_ID_KEY) || '';
}

/** 採番した PBI ID を高水位として記録する。 */
function setLastPbiId_(id) {
  PropertiesService.getScriptProperties().setProperty(LAST_PBI_ID_KEY, String(id || ''));
}
