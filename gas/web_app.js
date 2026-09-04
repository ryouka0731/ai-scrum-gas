/**
 * Web アプリのサーバ側。人はこの画面だけを見る。
 *
 * 生のスプレッドシートは DB であり、人の作業面ではない。ここでの更新は
 * Drive の scrum/product_backlog.csv へ書き戻され、ローカルの Claude Code
 * からも同じファイルとして見える。
 */

const WEB_APP_TITLE = 'AI Scrum ボード';
const BACKLOG_CSV_NAME = 'product_backlog.csv';

/** Web アプリの入口。 */
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('kanban')
    .setTitle(WEB_APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** scrum/product_backlog.csv の生テキストを返す。無ければ例外。 */
function readBacklogText_() {
  const text = readTextFile_(getScrumFolder_(), BACKLOG_CSV_NAME);
  if (text === null) {
    throw new Error('scrum/' + BACKLOG_CSV_NAME + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  return text;
}

/** カンバンの内容を返す。 */
function apiGetBoard() {
  try {
    // 読み込み時点でヘッダーを検査する。ここで気づかないと、ヘッダーが
    // BACKLOG_FIELDS と違っていても board は正常に描画され、ドラッグして
    // 初めてエラーが出る（原因が分からないまま操作を繰り返させてしまう）。
    const text = readBacklogText_();
    assertHeaderMatches(text, BACKLOG_FIELDS);
    return { ok: true, board: buildBoardData(csvToObjects(text)) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

/**
 * PBI の状態を変えて CSV へ書き戻す。
 * expectedUpdatedAt は画面を描いた時点の updated_at。他の誰か（またはローカルの
 * Claude Code）が先に変更していれば conflict として拒否し、黙って上書きしない。
 */
function apiUpdateStatus(id, newStatus, expectedUpdatedAt) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。', board: null };
  }
  try {
    if (KANBAN_STATUSES.indexOf(newStatus) === -1) {
      return { ok: false, reason: 'bad_status', message: '不明なステータスです: ' + newStatus, board: null };
    }
    // 書き戻しの直前に必ず読み直す。Drive 同期のラグがあるため、
    // 画面を描いた時点のデータをそのまま信じない。
    const text = readBacklogText_();
    // 未知の列を持つ CSV へ書き戻すと列が消えるため、読み直した直後・
    // 書き戻しより前に必ずヘッダーを検査する。
    assertHeaderMatches(text, BACKLOG_FIELDS);
    const rows = csvToObjects(text);
    const result = applyRowUpdate(rows, id, { status: newStatus }, expectedUpdatedAt, nowText_());

    if (!result.ok) {
      const message = result.reason === 'conflict'
        ? '他の変更が先に入っています。最新の内容に更新しました。'
        : 'この PBI が見つかりません。最新の内容に更新しました。';
      return { ok: false, reason: result.reason, message: message, board: buildBoardData(rows) };
    }

    writeScrumFile_(BACKLOG_CSV_NAME, toCsv(result.rows, BACKLOG_FIELDS));
    return { ok: true, board: buildBoardData(result.rows) };
  } catch (e) {
    // 権限エラーの案内は writeScrumFile_ が付ける。ここで一律に付けると、
    // ヘッダー不一致やファイル未検出まで「権限が原因」と誤誘導してしまう。
    return { ok: false, reason: 'error', message: e.message, board: null };
  } finally {
    lock.releaseLock();
  }
}
