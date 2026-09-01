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

/** 現在時刻を YYYY-MM-DD HH:mm:ss で返す。 */
function nowText() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/** scrum 直下の CSV を読んでオブジェクト配列にする。読めなければ警告を積んで空配列。 */
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

/** 全シートを再構築する。 */
function syncAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const warnings = [];
  const readFiles = [];
  const scrum = getScrumFolder();   // 設定不備はここで例外を投げて中断する
  const syncedAt = nowText();

  // --- バックログ ---
  let backlogRows = [];
  const backlog = readCsvRows(scrum, 'product_backlog.csv', warnings);
  if (backlog !== null) {
    readFiles.push('product_backlog.csv');
    backlogRows = backlog;
    const notes = readNotes(ss, SHEET_NAMES.backlog, BACKLOG_KEY_COL, BACKLOG_NOTE_COL);
    writeGrid(ss, SHEET_NAMES.backlog, buildBacklogGrid(backlogRows, notes));
    writeGrid(ss, SHEET_NAMES.kanban, buildKanbanGrid(backlogRows));
  }

  // --- 完了バックログ ---
  const done = readCsvRows(scrum, 'product_backlog_done.csv', warnings);
  if (done !== null) {
    readFiles.push('product_backlog_done.csv');
    writeGrid(ss, SHEET_NAMES.done, buildDoneBacklogGrid(done));
  }

  // --- ベロシティとロードマップ ---
  let velocityRows = [];
  const velocity = readCsvRows(scrum, 'velocity.csv', warnings);
  if (velocity !== null) {
    readFiles.push('velocity.csv');
    velocityRows = velocity;
    writeGrid(ss, SHEET_NAMES.velocity, buildVelocityGrid(velocityRows));
  }
  const roadmap = buildRoadmapGrid(backlogRows, velocityRows);
  const roadmapSheet = writeGrid(ss, SHEET_NAMES.roadmap, roadmap.grid);
  paintMarks(roadmapSheet, roadmap.marks, ROADMAP_BAND_COLOR);

  // --- 障害物 ---
  const impOpen = readCsvRows(scrum, 'impediment_log.csv', warnings);
  const impDone = readCsvRows(scrum, 'impediment_log_resolved.csv', warnings);
  if (impOpen !== null || impDone !== null) {
    if (impOpen !== null) readFiles.push('impediment_log.csv');
    if (impDone !== null) readFiles.push('impediment_log_resolved.csv');
    const notes = readNotes(ss, SHEET_NAMES.impediment, IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL);
    writeGrid(ss, SHEET_NAMES.impediment, buildImpedimentGrid(impOpen || [], impDone || [], notes));
  }

  // --- バーンダウン（最新スプリントの sprint_backlog.md から） ---
  let sprintMd = '';
  const sprintFolder = findLatestSprintFolder(scrum);
  if (!sprintFolder) {
    warnings.push('sprint で始まるフォルダが見つかりません。バーンダウンはスキップしました。');
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

  // --- ダッシュボードと同期ログ ---
  writeGrid(ss, SHEET_NAMES.dashboard, buildDashboardGrid({
    syncedAt: syncedAt, sprintBacklogMd: sprintMd,
    backlogRows: backlogRows, warnings: warnings,
  }));

  const logGrid = [['同期時刻', '読み取ったファイル', '警告']];
  logGrid.push([syncedAt, readFiles.join('\n'), warnings.length ? warnings.join('\n') : 'なし']);
  writeGrid(ss, SHEET_NAMES.log, logGrid);

  return { syncedAt: syncedAt, warnings: warnings };
}
