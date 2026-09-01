/**
 * スプレッドシートのカスタムメニューと時間主導トリガー。
 */

const TRIGGER_HANDLER = 'scheduledSync';
const TRIGGER_MINUTES = 30;

/** スプレッドシートを開いたときにメニューを登録する。 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('AI Scrum')
    .addItem('今すぐ同期', 'menuSyncNow')
    .addSeparator()
    .addItem('設定（Drive フォルダ ID）', 'menuConfigure')
    .addItem('自動同期を有効にする（30分毎）', 'menuInstallTrigger')
    .addItem('自動同期を止める', 'menuRemoveTrigger')
    .addToUi();
}

/** メニューから同期する。結果はトーストで知らせる。 */
function menuSyncNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = syncAll();
    const message = result.warnings.length === 0
      ? '同期しました（' + result.syncedAt + '）'
      : '同期しました。警告 ' + result.warnings.length + ' 件は「同期ログ」を確認してください。';
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'AI Scrum', 10);
  } catch (e) {
    ui.alert('同期できませんでした', e.message, ui.ButtonSet.OK);
  }
}

/** フォルダ ID を入力して保存する。 */
function menuConfigure() {
  const ui = SpreadsheetApp.getUi();
  const current = getFolderId();
  const response = ui.prompt(
    'Drive フォルダ ID',
    'scrum フォルダを含むプロジェクトフォルダの ID を入力してください。\n'
      + '現在の設定: ' + (current || '(未設定)'),
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  try {
    setFolderId(response.getResponseText());
    ui.alert('保存しました', 'メニューから「今すぐ同期」を実行してください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('保存できませんでした', e.message, ui.ButtonSet.OK);
  }
}

/** 既存の同期トリガーを全て削除する。 */
function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

/** 30分毎のトリガーを作り直す。 */
function menuInstallTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyMinutes(TRIGGER_MINUTES).create();
  SpreadsheetApp.getUi().alert(
    '自動同期を有効にしました', TRIGGER_MINUTES + '分毎に同期します。', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** トリガーを削除する。 */
function menuRemoveTrigger() {
  removeSyncTriggers();
  SpreadsheetApp.getUi().alert(
    '自動同期を止めました', 'メニューの「今すぐ同期」は引き続き使えます。', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** トリガーから呼ばれる。UI を触らないため toast も alert も使わない。 */
function scheduledSync() {
  syncAll();
}
