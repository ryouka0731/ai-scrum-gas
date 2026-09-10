/**
 * Web アプリのサーバ側。人はこの画面だけを見る。
 *
 * 生のスプレッドシートは DB であり、人の作業面ではない。ここでの更新は
 * Drive の scrum/product_backlog.csv へ書き戻され、ローカルの Claude Code
 * からも同じファイルとして見える。
 */

const WEB_APP_TITLE = 'AI Scrum ボード';
const BACKLOG_CSV_NAME = 'product_backlog.csv';
const DONE_BACKLOG_CSV_NAME = 'product_backlog_done.csv';
// PBI_ID_RE は pure_filter.js で定義済み（GAS は単一グローバルスコープなので
// ここでは再宣言しない。再宣言するとプロジェクト全体の読み込みが失敗する）。

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

/**
 * scrum/product_backlog_done.csv の行を返す。採番の高水位を補うためだけに使う
 * 補助情報であり、無い・解析できない場合は空配列にする（完了バックログが読めない
 * ことを理由に新規 PBI の作成そのものを止めない）。
 *
 * 完了へ移した PBI の ID は product_backlog.csv からは見えなくなるため、これを
 * 見ないと「完了へ移した後に highWater が記録されていない古い ID」を新規作成が
 * 再利用しうる（削除の場合と同じ、参照の食い違いを生む）。
 */
function readDoneBacklogRowsBestEffort_() {
  try {
    const text = readTextFile_(getScrumFolder_(), DONE_BACKLOG_CSV_NAME);
    if (text === null) return [];
    return csvToObjects(text);
  } catch (e) {
    return [];
  }
}

/**
 * rows（+ 完了バックログ）の最大 ID が記録済みの高水位を上回っていれば、
 * 記録をその値まで進める。
 *
 * withBacklogWrite_ が書き戻しのたびに（読み直した rows で）呼ぶ。ローカルの
 * Claude Code が直接 CSV に書いた ID（記録より大きい）は、その行が delete 等で
 * rows から消える前に一度でも書き戻しが起きれば、ここで必ず捕捉される。
 * 記録は一方向にしか進めない（大きい方を採るだけ）ので、逆行はしない。
 *
 * 高水位はあくまで best-effort の記帳であり、CSV 本体の書き戻しを止める理由には
 * ならない。readDoneBacklogRowsBestEffort_ と同様、失敗しても例外を投げず黙って
 * 諦める（最悪でも「記録が古いままで、でっち上げ ID の復元が1回誤って拒否される」
 * だけで済み、ドラッグ・編集・削除まで巻き添えにしない）。
 */
function advanceLastPbiIdWatermark_(rows) {
  try {
    const scanRows = rows.concat(readDoneBacklogRowsBestEffort_());
    const recorded = getLastPbiId_();
    const scannedMax = highWaterPbiId(scanRows, '');
    if (scannedMax === null) return;
    const recordedN = recorded ? pbiIdNumber(recorded) : null;
    if (recordedN === null || pbiIdNumber(scannedMax) > recordedN) setLastPbiId_(scannedMax);
  } catch (e) {
    // best-effort: 記録できなくても書き戻し本体は続行する。
  }
}

const VELOCITY_CSV_NAME = 'velocity.csv';
const IMPEDIMENT_CSV_NAME = 'impediment_log.csv';
const IMPEDIMENT_RESOLVED_CSV_NAME = 'impediment_log_resolved.csv';

/** scrum 直下の CSV を読む。無い・壊れているときは空配列（ビューごとに独立して失敗させる）。 */
function readCsvRowsBestEffort_(name) {
  try {
    const text = readTextFile_(getScrumFolder_(), name);
    if (text === null) return [];
    return csvToObjects(text);
  } catch (e) {
    return [];
  }
}

/** 最新のスプリントフォルダの sprint_backlog.md を読む。無ければ空文字。 */
function readSprintBacklogMdBestEffort_() {
  try {
    const folder = findLatestSprintFolder_(getScrumFolder_());
    if (!folder) return '';
    return readTextFile_(folder, 'sprint_backlog.md') || '';
  } catch (e) {
    return '';
  }
}

/**
 * ビューの内容を返す。読み取りのみ。
 *
 * タブごとに API を増やすと公開関数が増える。google.script.run は全グローバル関数を
 * ブラウザへ公開するため、公開面は小さいほどよい。
 *
 * 読み取りの失敗はビューごとに独立させる。どれも他のタブを巻き添えにしない。
 */
function apiGetView(name) {
  const key = String(name || 'board');
  try {
    if (key === 'board' || key === 'list') {
      // 読み込み時点でヘッダーを検査する。ここで気づかないと、ヘッダーが
      // BACKLOG_FIELDS と違っていても盤面は正常に描画され、ドラッグして
      // 初めてエラーが出る（原因が分からないまま操作を繰り返させてしまう）。
      const text = readBacklogText_();
      assertHeaderMatches(text, BACKLOG_FIELDS);
      const rows = csvToObjects(text);
      const summary = summarizeBacklog(rows, KANBAN_STATUSES);
      const view = key === 'board' ? buildBoardData(rows) : buildListView(rows);
      const out = { ok: true, name: key, view: view, summary: summary };
      // パネルのスプリント欄は velocity.csv から選ばせる。パネルは盤面でしか開かない
      // ので、盤面の応答に載せて渡す（パネルを開くたびに往復させない）。
      // velocity.csv が無くても盤面は読める（空配列＝未割り当てだけが選べる）。
      if (key === 'board') out.velocityRows = readCsvRowsBestEffort_(VELOCITY_CSV_NAME);
      return out;
    }
    if (key === 'done') {
      const rows = readDoneBacklogRowsBestEffort_();
      return { ok: true, name: key, view: buildDoneView(rows), summary: null };
    }
    if (key === 'burndown') {
      const md = readSprintBacklogMdBestEffort_();
      const vel = readCsvRowsBestEffort_(VELOCITY_CSV_NAME);
      return {
        ok: true, name: key,
        view: buildBurndownView(md),   // 元データが無ければ null
        summary: summarizeSprint(vel, md),
      };
    }
    if (key === 'velocity' || key === 'roadmap') {
      const vel = readCsvRowsBestEffort_(VELOCITY_CSV_NAME);
      const md = readSprintBacklogMdBestEffort_();
      let view;
      if (key === 'velocity') {
        view = buildVelocityView(vel);
      } else {
        // board/list と同じくヘッダーを検査する。ここを飛ばすと、ヘッダーが壊れた
        // CSV でも roadmap だけ黙って誤った表を返し、board との非対称が生まれる。
        const text = readBacklogText_();
        assertHeaderMatches(text, BACKLOG_FIELDS);
        view = buildRoadmapView(csvToObjects(text), vel);
      }
      return { ok: true, name: key, view: view, summary: summarizeSprint(vel, md) };
    }
    if (key === 'impediment') {
      const open = readCsvRowsBestEffort_(IMPEDIMENT_CSV_NAME);
      const done = readCsvRowsBestEffort_(IMPEDIMENT_RESOLVED_CSV_NAME);
      return {
        ok: true, name: key,
        view: buildImpedimentView(open, done),
        summary: summarizeImpediment(open, done),
      };
    }
    return { ok: false, name: key, message: '不明なビューです: ' + key };
  } catch (e) {
    return { ok: false, name: key, message: e.message };
  }
}

/**
 * 書き戻しを伴う API の共通手順。
 *
 * mutate(rows) は { ok:true, rows, id?, removed? } か { ok:false, reason, message } を返すこと。
 * ロックを取ってから読み直すのは、画面を描いた時点のデータを信じないため
 * （Drive 同期には数秒から数分のラグがある）。
 */
function withBacklogWrite_(mutate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。', board: null };
  }
  try {
    const text = readBacklogText_();
    // 未知の列を持つ CSV へ書き戻すと列が消えるため、読み直した直後・
    // 書き戻しより前に必ずヘッダーを検査する。
    assertHeaderMatches(text, BACKLOG_FIELDS);
    const rows = csvToObjects(text);
    // mutate の前に必ず高水位を進める。今の pure 層（pure_merge.js）は rows を
    // 直接書き換えず新しい配列を返すので mutate の後でも安全なはずだが、
    // pure 層が将来 rows を破壊的に書き換えるようになっても取り逃さないよう、
    // 安全側として mutate の前に置いている。
    advanceLastPbiIdWatermark_(rows);

    const result = mutate(rows);
    if (!result.ok) {
      return {
        ok: false,
        reason: result.reason,
        message: result.message,
        // mutate が board を明示したときはそれに従う（bad_status は null を返す）。
        board: Object.prototype.hasOwnProperty.call(result, 'board') ? result.board : buildBoardData(rows)
      };
    }
    writeScrumFile_(BACKLOG_CSV_NAME, toCsv(result.rows, BACKLOG_FIELDS));
    return {
      ok: true,
      board: buildBoardData(result.rows),
      id: result.id || null,
      removed: result.removed || null
    };
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message, board: null };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 競合・不在の定型文。文面を1か所に集める。
 *
 * 競合のあと何をすれば通るかは操作ごとに違うため、retryHint で出し分ける。
 * ドラッグは操作をやり直せば通る（move() が毎回その時点の updated_at を読み直す）。
 * パネルは書きかけの内容を保ったまま、もう一度押すと上書きになる。
 * 「やり直してください」とだけ書くと、実際には効かない手順を案内することになる。
 */
function conflictMessage_(reason, retryHint) {
  if (reason === 'conflict') {
    return '他の変更が先に入っています。' + (retryHint || '最新の内容に更新しました。');
  }
  return 'この PBI が見つかりません。最新の内容に更新しました。';
}

/** 編集を許した項目だけを取り出す。それ以外は捨てる。 */
function pickEditableFields_(fields) {
  const src = fields || {};
  const out = {};
  PBI_EDITABLE_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(src, f)) out[f] = String(src[f] === null || src[f] === undefined ? '' : src[f]);
  });
  return out;
}

/**
 * PBI の状態を変えて CSV へ書き戻す。
 * expectedUpdatedAt は画面を描いた時点の updated_at。他の誰か（またはローカルの
 * Claude Code）が先に変更していれば conflict として拒否し、黙って上書きしない。
 */
function apiUpdateStatus(id, newStatus, expectedUpdatedAt) {
  return withBacklogWrite_(function (rows) {
    if (KANBAN_STATUSES.indexOf(newStatus) === -1) {
      return { ok: false, reason: 'bad_status', message: '不明なステータスです: ' + newStatus, board: null };
    }
    const r = applyRowUpdate(rows, id, { status: newStatus }, expectedUpdatedAt, nowText_());
    if (!r.ok) return { ok: false, reason: r.reason, message: conflictMessage_(r.reason) };
    return { ok: true, rows: r.rows };
  });
}

/**
 * PBI を新しく作る。ID はサーバ側で採番する。
 *
 * 作成では競合判定を行わない。照合する既存の行が無いためである。
 * ID はロックを取ったあと読み直した CSV から採番するので、アプリ内で重複しない。
 *
 * 採番は「今の rows（+ 完了バックログ）の最大値」と「記録済みの高水位
 * （getLastPbiId_）」の両方を見て、大きい方の次を使う。rows だけを見ると、
 * 最大の PBI を削除した直後の作成がその ID を再利用してしまう。採番したら
 * 高水位を更新する（ロック内、成功したときだけ）。
 */
function apiCreatePbi(fields) {
  return withBacklogWrite_(function (rows) {
    const picked = pickEditableFields_(fields);
    if (picked.status === undefined) picked.status = KANBAN_STATUSES[0];
    const v = validatePbiFields(picked, KANBAN_STATUSES);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };

    const scanRows = rows.concat(readDoneBacklogRowsBestEffort_());
    const id = nextPbiId(scanRows, getLastPbiId_());
    const r = appendRow(rows, id, picked, BACKLOG_FIELDS, nowText_());
    if (!r.ok) {
      return { ok: false, reason: r.reason, message: 'ID が重複しました。もう一度お試しください。' };
    }
    setLastPbiId_(id);
    return { ok: true, rows: r.rows, id: id };
  });
}

/** PBI の項目を書き換える。 */
function apiUpdatePbi(id, fields, expectedUpdatedAt) {
  return withBacklogWrite_(function (rows) {
    const picked = pickEditableFields_(fields);
    const v = validatePbiFields(picked, KANBAN_STATUSES);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };

    const r = applyRowUpdate(rows, id, picked, expectedUpdatedAt, nowText_());
    if (!r.ok) {
      return {
        ok: false, reason: r.reason,
        message: conflictMessage_(r.reason, '内容を確認し、もう一度保存すると上書きします。')
      };
    }
    return { ok: true, rows: r.rows };
  });
}

/**
 * PBI を消す。確認ダイアログは置かず、実行後に取り消せる通知で受ける
 * （apiRestorePbi）。「完了」は Done 列への移動で表すので、これは
 * 「間違って作った」場合の操作である。
 */
function apiDeletePbi(id, expectedUpdatedAt) {
  return withBacklogWrite_(function (rows) {
    const r = deleteRow(rows, id, expectedUpdatedAt);
    if (!r.ok) {
      return {
        ok: false, reason: r.reason,
        message: conflictMessage_(r.reason, '内容を確認し、もう一度削除すると更新後の内容ごと消します。')
      };
    }
    // 取り消しに使うため、消した行そのものを返す。
    let removed = null;
    rows.forEach(function (row) {
      if (String(row.id || '').trim() === String(id || '').trim()) removed = row;
    });
    return { ok: true, rows: r.rows, removed: removed };
  });
}

/**
 * 削除した PBI を戻す。通知の「取り消す」から呼ばれる。
 * apiCreatePbi ではなくこちらを使うのは、元の id と created_at を保つため。
 *
 * 復元は「今そこに表示・編集・削除できていた行を、そのまま戻す」操作である。
 * status / priority / size が語彙外の行（ローカルの Claude Code が直接 CSV に
 * 書いた行など）も表示・削除はできるため、復元だけをその語彙で拒否すると、
 * 取り消し操作が名目だけになる（changedFields のコメントにある「常に検証する
 * と保存そのものが塞がれる」と同じ理由）。そのため語彙は検証しない。
 *
 * google.script.run はブラウザから任意の値で呼べるため、次の3点だけを検証する。
 * - title が空でないこと（空タイトルの行は isPlaceholderRow で盤面に出ないため、
 *   戻しても見えない）
 * - id が PBI-\d+ の形であること
 * - id の番号が「今までに採番された最大値」を超えていないこと
 *   （isPbiIdWithinHighWater。復元は既存の行を戻す操作であり、最大値を超える
 *   ことは原理的にありえない。超えていれば、でっち上げ ID や改ざんとみなし、
 *   以後の採番を汚染させない。ただし上限が一つも立たないとき＝記帳が
 *   best-effort ゆえ一度も成功していないときは、判定をあきらめて通す。
 *   詳しくは isPbiIdWithinHighWater のコメント参照）
 */
function apiRestorePbi(row) {
  return withBacklogWrite_(function (rows) {
    const id = String((row || {}).id || '').trim();
    if (!PBI_ID_RE.test(id)) {
      return { ok: false, reason: 'invalid', message: 'PBI ID の形式が不正です: ' + id };
    }
    const scanRows = rows.concat(readDoneBacklogRowsBestEffort_());
    if (!isPbiIdWithinHighWater(id, scanRows, getLastPbiId_())) {
      return { ok: false, reason: 'invalid', message: 'PBI ID が採番済みの範囲を超えています: ' + id };
    }
    const title = String((row || {}).title || '').trim();
    if (!title) {
      return { ok: false, reason: 'invalid', message: 'タイトルを入力してください。' };
    }

    const r = restoreRow(rows, row, BACKLOG_FIELDS, nowText_());
    if (!r.ok) {
      const message = r.reason === 'invalid'
        ? 'PBI ID が指定されていません。'
        : 'この PBI は既に存在します。取り消しは要りません。';
      return { ok: false, reason: r.reason, message: message };
    }
    return { ok: true, rows: r.rows };
  });
}
