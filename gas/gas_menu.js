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
    const result = syncAll_();
    let message;
    if (result.skipped) {
      message = '別の同期が実行中のため、今回は見送りました。少し待ってからもう一度お試しください。';
    } else if (result.warnings.length === 0) {
      message = '同期しました（' + result.syncedAt + '）';
    } else {
      message = '同期しました。警告 ' + result.warnings.length + ' 件は「同期ログ」を確認してください。';
    }
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'AI Scrum', 10);
  } catch (e) {
    ui.alert('同期できませんでした', e.message, ui.ButtonSet.OK);
  }
}

/** フォルダ ID を入力して保存する。 */
function menuConfigure() {
  const ui = SpreadsheetApp.getUi();
  const current = getFolderId_();
  const response = ui.prompt(
    'Drive フォルダ ID',
    'scrum フォルダを含む共有フォルダの ID を入力してください（scrum フォルダ自身の ID ではありません）。\n'
      + '現在の設定: ' + (current || '(未設定)'),
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  try {
    setFolderId_(response.getResponseText());
    ui.alert('保存しました', 'メニューから「今すぐ同期」を実行してください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('保存できませんでした', e.message, ui.ButtonSet.OK);
  }
}

/** 既存の同期トリガーを全て削除する。 */
function removeSyncTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

/** 30分毎のトリガーを作り直す。 */
function menuInstallTrigger() {
  const ui = SpreadsheetApp.getUi();   // 副作用より前に置く（認可ゲート）
  removeSyncTriggers_();
  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyMinutes(TRIGGER_MINUTES).create();
  ui.alert('自動同期を有効にしました', TRIGGER_MINUTES + '分毎に同期します。', ui.ButtonSet.OK);
}

/** トリガーを削除する。 */
function menuRemoveTrigger() {
  const ui = SpreadsheetApp.getUi();   // 副作用より前に置く（認可ゲート）
  removeSyncTriggers_();
  ui.alert('自動同期を止めました', 'メニューの「今すぐ同期」は引き続き使えます。', ui.ButtonSet.OK);
}

// 自動同期が最後に成功した時刻（Date.now() の文字列）。頻度の上限（pure_sync_rate.js）に使う。
const LAST_SCHEDULED_SYNC_KEY = 'LAST_SCHEDULED_SYNC_MS';

/**
 * トリガーから呼ばれる。UI を触らないため toast も alert も使わない。
 *
 * google.script.run からも呼べるため、前回の成功から60秒以内なら何もしない（ロックも取らない）。
 * 30分毎のトリガーには影響しない。
 */
function scheduledSync() {
  try {
    const props = PropertiesService.getScriptProperties();
    if (isSyncTooSoon(props.getProperty(LAST_SCHEDULED_SYNC_KEY), Date.now())) {
      console.log('前回の自動同期から間もないため、今回は見送りました。');
      return;
    }
    const result = syncAll_();
    if (!result.skipped) props.setProperty(LAST_SCHEDULED_SYNC_KEY, String(Date.now()));
  } catch (e) {
    // 例外をそのまま投げると30分毎に実行失敗メールが届く（フォルダ未設定なら鳴り止まない）。
    // 原因は Apps Script の実行ログに残す。
    console.error('自動同期に失敗しました: ' + e.message);
  }
}
