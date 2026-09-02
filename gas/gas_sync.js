/**
 * 同期の全体制御。部分的な失敗で全体を止めず、警告として同期ログに残す。
 */

const SHEET_NAMES = {
  dashboard: 'ダッシュボード',
  backlog: 'バックログ',
  done: '完了バックログ',
  kanban: 'カンバン',
  roadmap: 'ロードマップ',
  velocity: 'ベロシティ',
  burndown: 'バーンダウン',
  impediment: '障害物',
  log: '同期ログ',
};

// 手動同期と時間主導トリガーが重なったときに待つ上限。
const SYNC_LOCK_WAIT_MS = 1000;

/** 現在時刻を YYYY-MM-DD HH:mm:ss で返す。 */
function nowText() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/** scrum 直下の CSV を読んでオブジェクト配列にする。読めなければ警告を積んで null。 */
function readCsvRows(folder, name, warnings) {
  const text = readTextFile(folder, name);
  if (text === null) {
    warnings.push(name + ' が見つかりません。該当シートはスキップしました。');
    return null;
  }
  try {
    return csvToObjects(text);
  } catch (e) {
    warnings.push(name + ' の解析に失敗しました: ' + e.message);
    return null;
  }
}

/**
 * 全シートを再構築する。
 * 30分トリガーと手動の「今すぐ同期」が重なると、メモの読み出しとシートのクリアが
 * 交差してメモを失う恐れがあるため、スクリプトロックで多重実行を防ぐ。
 */
function syncAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    return { syncedAt: '', warnings: [], skipped: true };
  }
  try {
    return rebuildAllSheets();
  } finally {
    lock.releaseLock();
  }
}

/**
 * ロックを取得した状態で全シートを再構築する。
 * シートごとに try/catch で囲み、1枚の失敗で残りが書けなくなることを避ける。
 * 書き込めなかったシートは前回の内容が残るため、必ず警告として同期ログに残す。
 */
function rebuildAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const warnings = [];
  const readFiles = [];
  const scrum = getScrumFolder();   // 設定不備はここで例外を投げて中断する
  const syncedAt = nowText();

  // --- バックログとカンバン ---
  let backlogRows = null;
  const backlog = readCsvRows(scrum, 'product_backlog.csv', warnings);
  if (backlog !== null) {
    readFiles.push('product_backlog.csv');
    backlogRows = backlog;
    try {
      const notes = readNotes(ss, SHEET_NAMES.backlog, BACKLOG_KEY_COL, BACKLOG_NOTE_COL);
      writeGrid(ss, SHEET_NAMES.backlog, buildBacklogGrid(backlogRows, notes));
      writeGrid(ss, SHEET_NAMES.kanban, buildKanbanGrid(backlogRows));
    } catch (e) {
      warnings.push(SHEET_NAMES.backlog + ' / ' + SHEET_NAMES.kanban + ' の書き込みに失敗: ' + e.message);
    }
  }

  // --- 完了バックログ ---
  const done = readCsvRows(scrum, 'product_backlog_done.csv', warnings);
  if (done !== null) {
    readFiles.push('product_backlog_done.csv');
    try {
      writeGrid(ss, SHEET_NAMES.done, buildDoneBacklogGrid(done));
    } catch (e) {
      warnings.push(SHEET_NAMES.done + ' の書き込みに失敗: ' + e.message);
    }
  }

  // --- ベロシティ ---
  let velocityRows = null;
  const velocity = readCsvRows(scrum, 'velocity.csv', warnings);
  if (velocity !== null) {
    readFiles.push('velocity.csv');
    velocityRows = velocity;
    try {
      writeGrid(ss, SHEET_NAMES.velocity, buildVelocityGrid(velocityRows));
    } catch (e) {
      warnings.push(SHEET_NAMES.velocity + ' の書き込みに失敗: ' + e.message);
    }
  }

  // --- ロードマップ（バックログとベロシティの両方が読めたときだけ再構築する） ---
  // 片方でも欠けた状態で作り直すと、スプリント列や PBI 行が消えた表になってしまう。
  if (backlogRows !== null && velocityRows !== null) {
    try {
      const roadmap = buildRoadmapGrid(backlogRows, velocityRows);
      const roadmapSheet = writeGrid(ss, SHEET_NAMES.roadmap, roadmap.grid);
      paintMarks(roadmapSheet, roadmap.marks, ROADMAP_BAND_COLOR);
    } catch (e) {
      warnings.push(SHEET_NAMES.roadmap + ' の書き込みに失敗: ' + e.message);
    }
  } else {
    warnings.push('ロードマップは更新できませんでした。前回の内容が残っています。');
  }

  // --- 障害物（未解決と解決済みの両方が読めたときだけ再構築する） ---
  // 片方だけで作り直すと、欠けた側の行とそのメモが恒久的に失われる。
  const impOpen = readCsvRows(scrum, 'impediment_log.csv', warnings);
  const impDone = readCsvRows(scrum, 'impediment_log_resolved.csv', warnings);
  if (impOpen !== null && impDone !== null) {
    readFiles.push('impediment_log.csv');
    readFiles.push('impediment_log_resolved.csv');
    try {
      const notes = readNotes(ss, SHEET_NAMES.impediment, IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL);
      writeGrid(ss, SHEET_NAMES.impediment, buildImpedimentGrid(impOpen, impDone, notes));
    } catch (e) {
      warnings.push(SHEET_NAMES.impediment + ' の書き込みに失敗: ' + e.message);
    }
  } else {
    warnings.push(SHEET_NAMES.impediment + ' は更新できませんでした。前回の内容が残っています。');
  }

  // --- バーンダウン（最新スプリントの sprint_backlog.md から） ---
  let sprintMd = '';
  try {
    const sprintFolder = findLatestSprintFolder(scrum);
    if (!sprintFolder) {
      warnings.push('sprint と連番のフォルダ（例: sprint001）が見つかりません。バーンダウンはスキップしました。');
    } else {
      const md = readTextFile(sprintFolder, 'sprint_backlog.md');
      if (md === null) {
        warnings.push(sprintFolder.getName() + '/sprint_backlog.md が見つかりません。');
      } else {
        readFiles.push(sprintFolder.getName() + '/sprint_backlog.md');
        sprintMd = md;
        const burndown = buildBurndownGrid(md);
        if (burndown === null) {
          warnings.push('sprint_backlog.md に「## バーンダウン」の表がありません。');
        } else {
          writeGrid(ss, SHEET_NAMES.burndown, burndown);
        }
      }
    }
  } catch (e) {
    warnings.push(SHEET_NAMES.burndown + ' の書き込みに失敗: ' + e.message);
  }

  // --- ダッシュボードと同期ログ（他シートの結果をまとめるため最後に書く） ---
  try {
    writeGrid(ss, SHEET_NAMES.dashboard, buildDashboardGrid({
      syncedAt: syncedAt, sprintBacklogMd: sprintMd,
      backlogRows: backlogRows || [], warnings: warnings,
    }));
  } catch (e) {
    warnings.push(SHEET_NAMES.dashboard + ' の書き込みに失敗: ' + e.message);
  }

  try {
    writeGrid(ss, SHEET_NAMES.log, buildSyncLogGrid(syncedAt, readFiles, warnings));
  } catch (e) {
    // 同期ログにも書けないときは記録先が無いため、呼び出し元へ返す警告に積むだけにする
    warnings.push(SHEET_NAMES.log + ' の書き込みに失敗: ' + e.message);
  }

  return { syncedAt: syncedAt, warnings: warnings, skipped: false };
}
