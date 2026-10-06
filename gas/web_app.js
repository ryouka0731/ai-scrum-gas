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
      // 選択肢は「完成した形」で渡す — 組み立ての規則を画面側に写すと、サーバ側だけを
      // 直したときに黙ってずれる（ロードマップには出るのに選択肢には出ないスプリント等）。
      // velocity.csv が無くても盤面は読める（未割り当て＋PBI に付いている名前だけになる）。
      if (key === 'board') {
        out.sprintChoices = sprintChoices(readCsvRowsBestEffort_(VELOCITY_CSV_NAME), rows);
      }
      out.comments = commentsPayload_();
      return out;
    }
    if (key === 'done') {
      const rows = readDoneBacklogRowsBestEffort_();
      // 要約は「やること」タブ単位のもの。ここだけ summary を落とすと、同じタブの中で
      // 盤面 → 一覧 → 完了 と切り替えたときに要約の行が現れて消える。
      // 集計元は完了バックログ自身にする。product_backlog.csv の合計をそのまま載せると、
      // すぐ下に並ぶ完了の表と数字が食い違い、どちらの合計なのか読み手に分からない。
      return { ok: true, name: key, view: buildDoneView(rows), summary: summarizeBacklog(rows, KANBAN_STATUSES) };
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
      return Object.assign({ ok: true, name: key }, impedimentPayload_(open, done));
    }
    return { ok: false, name: key, message: '不明なビューです: ' + key };
  } catch (e) {
    return { ok: false, name: key, message: e.message };
  }
}

const HISTORY_CSV_NAME = 'change_log.csv';
/** これを超えたら、書けたうえで切り替え（docs/setup.md）を案内する。 */
const HISTORY_SIZE_WARN_CHARS = 1000000;

/** CHG- + UUID の先頭8桁。 */
function newHistoryId_() {
  return 'CHG-' + String(Utilities.getUuid()).replace(/-/g, '').slice(0, 8).toLowerCase();
}

/**
 * 履歴を追記する。events は配列か、配列を返す関数。呼び出し側のロックの中で呼ぶこと。失敗しても例外を投げず、
 * 画面に出す警告の文字列を返す（成功・記録なしは null）。本体の書き込みは既に済んでいる。
 */
function appendHistory_(eventsOrThunk) {
  try {
    // 組み立ての失敗も本体を巻き込まないよう、関数で渡された場合はここ（try の中）で呼ぶ。
    const events = typeof eventsOrThunk === 'function' ? eventsOrThunk() : eventsOrThunk;
    if (!events || events.length === 0) return null;
    const text = readTextFile_(getScrumFolder_(), HISTORY_CSV_NAME);
    if (text === null) return '変更履歴を記録できませんでした（scrum/' + HISTORY_CSV_NAME + ' が見つかりません。配布し直してください）';
    // 空・空白だけのファイル（Drive 上で中身が消えた等）は、見出し行から書き直して自己修復する。
    const blank = text.trim() === '';
    // 既存の行は解釈し直さない。ファイルが大きくなってもロック中の処理が増えないよう、
    // 見出し行だけを検査し、新しい行を文字列のまま末尾へ足す。
    if (!blank) assertHeaderMatches(text.split(/\r?\n/, 1)[0], HISTORY_FIELDS);
    const added = toCsv(historyRows(events, { at: nowText_(), actor: currentUserEmail_(), newId: newHistoryId_ }), HISTORY_FIELDS);
    const next = blank ? added : (/\n$/.test(text) ? text : text + '\n') + added.slice(added.indexOf('\n') + 1);
    writeScrumFile_(HISTORY_CSV_NAME, next);
    if (next.length > HISTORY_SIZE_WARN_CHARS) {
      return '変更履歴のファイルが大きくなっています（約 ' + Math.round(next.length / 1000) + ' KB）。docs/setup.md の手順で切り替えてください';
    }
    return null;
  } catch (e) {
    return '変更履歴を記録できませんでした（' + e.message + '）';
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
    // 本体は書けた。履歴は後追いで、失敗しても本体を失敗にしない。
    const warning = appendHistory_(function () {
      return diffRows(rows, result.rows, BACKLOG_FIELDS, ['updated_at', 'created_at']).map(function (e) {
        return (e.action === 'create' && result.historyAction) ? Object.assign({}, e, { action: result.historyAction }) : e;
      });
    });
    const out = {
      ok: true,
      board: buildBoardData(result.rows),
      id: result.id || null,
      removed: result.removed || null
    };
    if (warning) out.historyWarning = warning;
    return out;
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
    return { ok: true, rows: r.rows, historyAction: 'restore' };
  });
}

/** 今日の日付（YYYY-MM-DD）。報告日・解決日に使う。 */
function todayText_() {
  return nowText_().slice(0, 10);
}

/** 障害物の応答の共通部分。パネルのスプリント欄の選択肢も載せる（盤面と同じ作り）。 */
function impedimentPayload_(openRows, resolvedRows) {
  return {
    view: buildImpedimentView(openRows, resolvedRows),
    summary: summarizeImpediment(openRows, resolvedRows),
    sprintChoices: sprintChoices(readCsvRowsBestEffort_(VELOCITY_CSV_NAME), openRows.concat(resolvedRows)),
    comments: commentsPayload_(),
  };
}

function readImpedimentRows_(name) {
  const text = readTextFile_(getScrumFolder_(), name);
  if (text === null) {
    throw new Error('scrum/' + name + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  // 未知の列を持つ CSV へ書き戻すと列が消えるため、書く前に必ず検査する。
  assertHeaderMatches(text, IMPEDIMENT_FIELDS);
  return csvToObjects(text);
}

/**
 * 障害物の書き込みの共通手順。withBacklogWrite_ と同じく、ロックを取ってから2ファイルを
 * 読み直す。mutate(open, resolved) は { ok:true, open, resolved, extra? } を返す。
 * open / resolved は書くべき新しい配列か null（書かない）。
 *
 * Drive に複数ファイルのトランザクションは無い。書く順は呼び出し側が first で決める
 * （'resolved' か 'open'）。「足す側 → 消す側」にしておけば、途中で止まっても行は失われず、
 * 同じ ID が両方に残るだけになる（画面は解決済を正として出し、通知の「完了する」で揃う）。
 */
function withImpedimentWrite_(first, mutate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。' };
  }
  let open = null;
  let resolved = null;
  try {
    open = readImpedimentRows_(IMPEDIMENT_CSV_NAME);
    resolved = readImpedimentRows_(IMPEDIMENT_RESOLVED_CSV_NAME);
    const result = mutate(open, resolved);
    if (!result.ok) {
      return Object.assign({ ok: false, reason: result.reason, message: result.message }, impedimentPayload_(open, resolved));
    }
    const writes = [
      { name: IMPEDIMENT_CSV_NAME, key: 'open', rows: result.open },
      { name: IMPEDIMENT_RESOLVED_CSV_NAME, key: 'resolved', rows: result.resolved },
    ].filter(function (w) { return w.rows; });
    writes.sort(function (a, b) { return (a.key === first ? 0 : 1) - (b.key === first ? 0 : 1); });
    const openBefore = open;
    const written = {};
    // この呼び出しで書けたものだけを履歴にする。完了の再送で書かなかった側は記録しない。
    const historyEvents = function () {
      if (result.historyKind === 'diff') {
        return written.open ? diffRows(openBefore, result.open, IMPEDIMENT_FIELDS, []) : [];
      }
      if (result.historyKind === 'resolve') return written.resolved ? [{ target_id: result.historyId, action: 'resolve' }] : [];
      if (result.historyKind === 'unresolve') return written.open ? [{ target_id: result.historyId, action: 'unresolve' }] : [];
      return [];
    };
    for (let i = 0; i < writes.length; i++) {
      try {
        writeScrumFile_(writes[i].name, toCsv(writes[i].rows, IMPEDIMENT_FIELDS));
        written[writes[i].key] = true;
      } catch (e) {
        if (i === 0) throw e;
        // 1つ目は書けている。画面には書けた側を反映して返す。
        if (writes[0].key === 'open') open = writes[0].rows; else resolved = writes[0].rows;
        const partialWarning = appendHistory_(historyEvents);
        return Object.assign({
          ok: false, reason: 'partial',
          message: '途中で止まりました（scrum/' + writes[i].name + ' に書けませんでした）。通知の「完了する」を押すと完了します。',
        }, impedimentPayload_(open, resolved), partialWarning ? { historyWarning: partialWarning } : {});
      }
    }
    if (result.open) open = result.open;
    if (result.resolved) resolved = result.resolved;
    const warning = appendHistory_(historyEvents);
    return Object.assign({ ok: true }, impedimentPayload_(open, resolved), result.extra || {}, warning ? { historyWarning: warning } : {});
  } catch (e) {
    const out = { ok: false, reason: 'error', message: e.message };
    if (open && resolved) Object.assign(out, impedimentPayload_(open, resolved));
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** 障害物の競合・不在の定型文。 */
function impedimentMessage_(reason, retryHint, id) {
  if (reason === 'conflict') return '他の変更が先に入っています。最新の内容に更新しました。' + (retryHint || '');
  if (reason === 'not_found') return 'この障害物が見つかりません。最新の内容に更新しました。';
  if (reason === 'duplicate_id') {
    return '未解決と解決済に、同じ ID の別の障害物があります（' + String(id || '').trim() + '）。CSV の ID を直してから操作してください。';
  }
  return '入力が不正です。';
}

/** 編集を許した項目だけを取り出す。 */
function pickImpedimentFields_(fields) {
  const src = fields || {};
  const out = {};
  IMPEDIMENT_EDITABLE_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(src, f)) out[f] = String(src[f] === null || src[f] === undefined ? '' : src[f]);
  });
  return out;
}

/** 障害物を作る。ID・報告日・status はサーバが決める。 */
function apiCreateImpediment(fields) {
  return withImpedimentWrite_('open', function (open, resolved) {
    const picked = pickImpedimentFields_(fields);
    const v = validateImpedimentFields(picked);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const id = nextImpedimentId(open.concat(resolved));
    const r = appendImpediment(open, id, picked, todayText_());
    if (!r.ok) return { ok: false, reason: r.reason, message: 'ID が重複しました。もう一度お試しください。' };
    return { ok: true, open: r.rows, resolved: null, extra: { id: id }, historyKind: 'diff' };
  });
}

/** 未解決の障害物を書き換える。expected は画面が描いた時点の行（全列）。 */
function apiUpdateImpediment(id, fields, expected) {
  return withImpedimentWrite_('open', function (open) {
    const picked = pickImpedimentFields_(fields);
    const v = validateImpedimentFields(picked);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const r = updateImpediment(open, id, picked, expected);
    if (!r.ok) return { ok: false, reason: r.reason, message: impedimentMessage_(r.reason, '内容を確認し、もう一度保存すると上書きします。') };
    return { ok: true, open: r.rows, resolved: null, historyKind: 'diff' };
  });
}

/** 解決する。解決済へ足してから、未解決から消す。 */
function apiResolveImpediment(id, resolution, expected) {
  return withImpedimentWrite_('resolved', function (open, resolved) {
    const v = validateResolution(resolution);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const r = planResolve(open, resolved, id, String(resolution), expected, todayText_());
    if (!r.ok) {
      const inOpen = open.some(function (x) {
        return !isImpedimentPlaceholder(x) && String(x.id || '').trim() === String(id || '').trim();
      });
      const message = (r.reason === 'conflict' && !inOpen)
        ? 'この障害物は既に解決済みです。最新の内容に更新しました。'
        : r.reason === 'conflict'
          ? '他の変更が先に入っています。最新の内容に更新しました。内容を確認してから、もう一度「解決を確定」を押してください。'
          : impedimentMessage_(r.reason, '', id);
      return { ok: false, reason: r.reason, message: message };
    }
    return { ok: true, open: r.open, resolved: r.resolved, extra: { moved: r.moved, resolvedRow: r.resolvedRow },
      historyKind: 'resolve', historyId: String(id || '').trim() };
  });
}

/** 解決を取り消す。未解決へ戻してから、解決済から消す。通知の「取り消す」から呼ばれる。 */
function apiUnresolveImpediment(moved, resolvedRow) {
  return withImpedimentWrite_('open', function (open, resolved) {
    const r = planUnresolve(open, resolved, moved, resolvedRow);
    if (!r.ok) {
      const message = r.reason === 'invalid' ? '取り消す内容が不正です。'
        : r.reason === 'conflict' ? '解決したあとに他の変更が入っています。取り消しはしません。'
        : impedimentMessage_(r.reason, '', (moved || {}).id);
      return { ok: false, reason: r.reason, message: message };
    }
    return { ok: true, open: r.open, resolved: r.resolved, historyKind: 'unresolve', historyId: String((moved || {}).id || '').trim() };
  });
}

// ---------------------------------------------------------------------------
// コメント（第5段階）
// ---------------------------------------------------------------------------

const COMMENT_CSV_NAME = 'comments.csv';

/** ログイン中のメール。取れなければ空文字（誰のコメントも消せない側に倒す）。 */
function currentUserEmail_() {
  try { return String(Session.getActiveUser().getEmail() || ''); } catch (e) { return ''; }
}

/** 全対象のコメント。ファイルが無い・壊れていても空にする（他の表示を巻き添えにしない）。 */
function commentsPayload_() {
  return groupComments(readCsvRowsBestEffort_(COMMENT_CSV_NAME), currentUserEmail_());
}

/** CMT- + UUID の先頭8桁。 */
function newCommentId_() {
  return 'CMT-' + String(Utilities.getUuid()).replace(/-/g, '').slice(0, 8).toLowerCase();
}

/**
 * コメントの書き込みの共通手順。ロックを取り、読み直し、ヘッダーを検査してから mutate(rows) を呼ぶ。
 * mutate は { ok:true, rows, extra? } か { ok:false, reason, message } を返す。rows が null なら書かない。
 */
function withCommentWrite_(mutate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。' };
  }
  try {
    const text = readTextFile_(getScrumFolder_(), COMMENT_CSV_NAME);
    if (text === null) {
      return { ok: false, reason: 'error', message: 'scrum/' + COMMENT_CSV_NAME + ' が見つかりません。配布し直してください。' };
    }
    assertHeaderMatches(text, COMMENT_FIELDS);
    const rows = csvToObjects(text);
    const me = currentUserEmail_();
    const result = mutate(rows, me);
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message, comments: groupComments(rows, me) };
    let warning = null;
    if (result.rows) {
      writeScrumFile_(COMMENT_CSV_NAME, toCsv(result.rows, COMMENT_FIELDS));
      warning = appendHistory_(result.history);
    }
    return Object.assign({ ok: true, comments: groupComments(result.rows || rows, me) }, result.extra || {},
      warning ? { historyWarning: warning } : {});
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** コメントを足す。ID・書いた人・時刻はサーバが決める。 */
function apiAddComment(targetId, body) {
  return withCommentWrite_(function (rows, me) {
    if (!me) return { ok: false, reason: 'forbidden', message: 'ログイン情報を取得できないためコメントできません。' };
    const v = validateComment(targetId, body);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const taken = function (id) { return rows.some(function (r) { return String(r.id || '').trim() === id; }); };
    let id = newCommentId_();
    for (let i = 0; i < 4 && taken(id); i++) id = newCommentId_();
    if (taken(id)) return { ok: false, reason: 'error', message: 'ID が重複しました。もう一度お試しください。' };
    const r = appendComment(rows, id, targetId, me, String(body), nowText_());
    return { ok: true, rows: r.rows, extra: { comment: r.comment },
      history: [{ target_id: r.comment.target_id, action: 'comment_add' }] };
  });
}

/** 自分のコメントを消す。取り消しに使うため、消した行を返す。 */
function apiDeleteComment(commentId) {
  return withCommentWrite_(function (rows, me) {
    const r = deleteComment(rows, commentId, me);
    if (!r.ok) {
      return { ok: false, reason: r.reason,
        message: r.reason === 'forbidden' ? '自分のコメントだけ削除できます。' : 'このコメントが見つかりません。' };
    }
    return { ok: true, rows: r.rows, extra: { removed: r.removed },
      history: [{ target_id: String((r.removed || {}).target_id || '').trim(), action: 'comment_delete' }] };
  });
}

/**
 * 削除したコメントを戻す。通知の「取り消す」から呼ばれる。
 * 戻せるのは自分のコメントだけ（他人の名前で行を作らせない）。
 */
function apiRestoreComment(row) {
  return withCommentWrite_(function (rows, me) {
    const picked = Object.assign({}, row || {}, { author: String((row || {}).author || '') });
    if (!me || picked.author !== me) {
      return { ok: false, reason: 'forbidden', message: '自分のコメントだけ戻せます。' };
    }
    const r = restoreComment(rows, picked);
    if (!r.ok) return { ok: false, reason: 'invalid', message: '戻す内容が不正です。' };
    return { ok: true, rows: r.unchanged ? null : r.rows,
      history: [{ target_id: String(picked.target_id || '').trim(), action: 'comment_restore' }] };
  });
}

// ---------------------------------------------------------------------------
// 変更履歴の読み取り（第6段階）
// ---------------------------------------------------------------------------

/**
 * 対象（PBI / 障害物）の変更履歴を新しい順に返す。パネルの「履歴」を開いたときだけ呼ばれる。
 * 読み取りのみなのでロックは取らない。ファイルが無い・壊れているときは空の一覧。
 */
function apiGetHistory(targetId) {
  const id = String(targetId || '').trim();
  if (!HISTORY_TARGET_RE.test(id)) {
    return { ok: false, reason: 'invalid', message: '履歴の対象が不正です: ' + id };
  }
  // 上限より1件多く取り、超えたときだけ「切り捨てがある」とする（ちょうど上限件なら省略は無い）。
  const found = historyFor(readCsvRowsBestEffort_(HISTORY_CSV_NAME), id, HISTORY_LIMIT + 1);
  const entries = found.slice(0, HISTORY_LIMIT);
  return found.length > HISTORY_LIMIT ? { ok: true, entries: entries, truncated: true } : { ok: true, entries: entries };
}
