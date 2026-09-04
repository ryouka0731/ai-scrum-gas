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
function readBacklogText() {
  const text = readTextFile(getScrumFolder(), BACKLOG_CSV_NAME);
  if (text === null) {
    throw new Error('scrum/' + BACKLOG_CSV_NAME + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  return text;
}

/**
 * CSV のヘッダーが BACKLOG_FIELDS と一致するかを検査する。書き戻しの直前に必ず呼ぶこと。
 *
 * toCsv(rows, BACKLOG_FIELDS) は BACKLOG_FIELDS の列だけを固定の順序で書き出す。
 * ヘッダーがそれと食い違ったまま書き戻すと、CSV 側にしかない列（この CSV は
 * ローカルの Claude Code と共同所有のため、将来列が増える可能性がある）が
 * 気づかないまま消える。列の集合が一致していても順序がずれていれば
 * toCsv の出力は既存ファイルと食い違うため、順序まで含めた完全一致を要求する。
 */
function assertBacklogHeaderMatches(text) {
  const header = parseCsv(text)[0] || [];
  const matches = header.length === BACKLOG_FIELDS.length &&
    header.every(function (name, i) { return name === BACKLOG_FIELDS[i]; });
  if (!matches) {
    throw new Error(
      'CSV の列構成が想定と異なります。管理者に連絡してください。' +
      '（想定: ' + BACKLOG_FIELDS.join(',') + ' / 実際: ' + header.join(',') + '）'
    );
  }
}

/** scrum/product_backlog.csv を読んでオブジェクト配列にする。 */
function readBacklogRows() {
  return csvToObjects(readBacklogText());
}

/** カンバンの内容を返す。 */
function apiGetBoard() {
  try {
    return { ok: true, board: buildBoardData(readBacklogRows()) };
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
    const text = readBacklogText();
    // 未知の列を持つ CSV へ書き戻すと列が消えるため、読み直した直後・
    // 書き戻しより前に必ずヘッダーを検査する。
    assertBacklogHeaderMatches(text);
    const rows = csvToObjects(text);
    const result = applyRowUpdate(rows, id, { status: newStatus }, expectedUpdatedAt, nowText());

    if (!result.ok) {
      const message = result.reason === 'conflict'
        ? '他の変更が先に入っています。最新の内容に更新しました。'
        : 'この PBI が見つかりません。最新の内容に更新しました。';
      return { ok: false, reason: result.reason, message: message, board: buildBoardData(rows) };
    }

    writeScrumFile(BACKLOG_CSV_NAME, toCsv(result.rows, BACKLOG_FIELDS));
    return { ok: true, board: buildBoardData(result.rows) };
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message, board: null };
  } finally {
    lock.releaseLock();
  }
}
