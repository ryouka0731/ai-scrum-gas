'use strict';
// 2巡目 V: カバレッジ主導。既存テストが一切通っていない GAS 層（gas_sync / gas_sheets /
// gas_drive / gas_drive_write / gas_config / gas_menu）を、スプレッドシートと Drive の
// フェイクで実際に動かして検査する。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { makeEnv, makeFolder, makeSheet, J, BACKLOG_HEADER, IMP_HEADER, VEL_HEADER } = require('./bughunt2_V_env.js');

const SPRINT_MD = [
  '# スプリントバックログ - Sprint 002', '',
  '## スプリント情報', '', '| 項目 | 内容 |', '|---|---|', '| スプリント番号 | Sprint 002 |', '',
  '## スプリントゴール', '', 'ゴール文', '',
  '## バーンダウン', '', '| 日 | 残 |', '|---|---|', '| 1 | 10 |', '| 2 | 7 |', '',
].join('\n');

function baseScrum() {
  return {
    files: {
      'product_backlog.csv': BACKLOG_HEADER +
        'PBI-001,A,,,High,3,Done,Sprint 001,2026-01-01,2026-01-02\n' +
        'PBI-002,B,,,Low,5,In Progress,Sprint 002,2026-01-01,2026-01-02\n' +
        'PBI-003,=IMPORTXML("http://evil"),,,Low,2,New,,2026-01-01,2026-01-02\n',
      'product_backlog_done.csv': BACKLOG_HEADER,
      'velocity.csv': VEL_HEADER + 'Sprint 001,5,3,2,2026-01-01,2026-01-14,\n' + 'Sprint 002,8,0,0,2026-01-15,2026-01-28,\n',
      'impediment_log.csv': IMP_HEADER + 'IMP-001,詰まり,説明,me,2026-01-03,Open,,,Sprint 001\n',
      'impediment_log_resolved.csv': IMP_HEADER,
      '.published.json': JSON.stringify({ publishedAt: '2026-02-01 00:00:00', commit: 'abc', branch: 'main' }),
    },
    folders: {
      sprint9: { files: { 'sprint_backlog.md': '# old' } },
      sprint10: { files: { 'sprint_backlog.md': SPRINT_MD } },
      sprintSAMPLE: { files: { 'sprint_backlog.md': '# sample' } },
    },
  };
}

test('syncAll_: 全シートが書かれ、最新のスプリントフォルダ（sprint10 > sprint9）から読み、警告は無い', () => {
  const e = makeEnv(baseScrum());
  const r = e.ctx.syncAll_();
  assert.equal(r.skipped, false);
  assert.deepEqual(J(r.warnings), []);
  ['ダッシュボード', 'バックログ', '完了バックログ', 'カンバン', 'ロードマップ', 'ベロシティ', 'バーンダウン', '障害物', '同期ログ']
    .forEach((n) => assert.ok(e.sheets[n], n + ' が無い'));
  assert.deepEqual(J(e.sheets['バーンダウン'].grid()), [['日', '残'], ['1', '10'], ['2', '7']]);
  const log = e.sheets['同期ログ'].grid();
  assert.match(String(log[1][1]), /sprint10\/sprint_backlog\.md/);
  assert.equal(e.lockState.releases, 1);
});

test('syncAll_: CSV の値が = で始まっても、シートには数式でなく文字列として入る（数式注入の防止）', () => {
  const e = makeEnv(baseScrum());
  e.ctx.syncAll_();
  for (const name of Object.keys(e.sheets)) {
    Object.keys(e.sheets[name].cells).forEach((k) => {
      assert.ok(typeof e.sheets[name].cells[k] !== 'object', name + ' の ' + k + ' が数式になった');
    });
  }
  const bl = e.sheets['バックログ'].grid();
  assert.equal(bl[3][1], '=IMPORTXML("http://evil")');   // 文字列のまま
});

test('syncAll_: 2回目の同期でメモ列（ID キー）を引き継ぎ、消えた行のメモは落とす', () => {
  const scrum = baseScrum();
  const e = makeEnv(scrum);
  e.ctx.syncAll_();
  const sh = e.sheets['バックログ'];
  // 利用者が PBI-002 と PBI-003 にメモを書く（11列目）
  sh.cells['3,11'] = 'メモB';
  sh.cells['4,11'] = '=x';   // 数式っぽいメモ
  // PBI-003 を CSV から消す
  scrum.files['product_backlog.csv'] = BACKLOG_HEADER +
    'PBI-001,A,,,High,3,Done,Sprint 001,2026-01-01,2026-01-02\n' +
    'PBI-002,B,,,Low,5,In Progress,Sprint 002,2026-01-01,2026-01-02\n';
  e.ctx.syncAll_();
  const g = e.sheets['バックログ'].grid();
  assert.equal(g.length, 3);
  assert.equal(g[2][10], 'メモB');
  assert.ok(!JSON.stringify(g).includes('=x'), '消えた行のメモが残った');
});

test('syncAll_: 障害物のメモも ID をキーに引き継ぐ', () => {
  const e = makeEnv(baseScrum());
  e.ctx.syncAll_();
  e.sheets['障害物'].cells['2,10'] = '対応中';
  e.ctx.syncAll_();
  assert.equal(e.sheets['障害物'].grid()[1][9], '対応中');
});

test('syncAll_: ロードマップは帯を塗り、塗らないセルには色が付かない', () => {
  const e = makeEnv(baseScrum());
  e.ctx.syncAll_();
  const rm = e.sheets['ロードマップ'];
  const g = rm.grid();
  // 見出し: ID, タイトル, Sprint 001.., Sprint 002..
  assert.equal(g[0][0], 'ID');
  assert.equal(g[1][2], '■');   // PBI-001 は Sprint 001
  assert.equal(g[2][3], '■');   // PBI-002 は Sprint 002
  assert.equal(rm.bg['2,3'], '#a8c7fa');
  assert.equal(rm.bg['3,4'], '#a8c7fa');
  assert.equal(rm.bg['2,4'], undefined);
  assert.equal(rm.bg['3,3'], undefined);
  assert.equal(rm.calls.setBackgrounds, 1);
});

test('syncAll_: スプリントが26列を超えても setValues が範囲外にならない（ensureSheetSize_）', () => {
  const scrum = baseScrum();
  let vel = VEL_HEADER;
  for (let i = 1; i <= 40; i++) {
    const n = ('00' + i).slice(-3);
    const d = ('0' + ((i % 28) + 1)).slice(-2);
    vel += 'Sprint ' + n + ',1,1,0,2026-01-' + d + ',2026-02-' + d + ',\n';
  }
  scrum.files['velocity.csv'] = vel;
  const e = makeEnv(scrum);
  const r = e.ctx.syncAll_();
  assert.deepEqual(J(r.warnings), [], '書き込みに失敗した: ' + JSON.stringify(r.warnings));
  assert.ok(e.sheets['ロードマップ'].maxCols >= 42);
});

test('syncAll_: 行が1000を超えても書ける', () => {
  const scrum = baseScrum();
  let csv = BACKLOG_HEADER;
  for (let i = 1; i <= 1200; i++) csv += 'PBI-' + ('000' + i).slice(-4) + ',T' + i + ',,,Low,1,New,,2026-01-01,2026-01-01\n';
  scrum.files['product_backlog.csv'] = csv;
  const e = makeEnv(scrum);
  const r = e.ctx.syncAll_();
  assert.deepEqual(J(r.warnings), []);
  assert.equal(e.sheets['バックログ'].getLastRow(), 1201);
});

test('syncAll_: velocity.csv が無ければ、ロードマップは書き直さず警告する（前回の内容を残す）', () => {
  const scrum = baseScrum();
  const e = makeEnv(scrum);
  e.ctx.syncAll_();
  const before = JSON.stringify(e.sheets['ロードマップ'].grid());
  delete scrum.files['velocity.csv'];
  const r = e.ctx.syncAll_();
  assert.equal(JSON.stringify(e.sheets['ロードマップ'].grid()), before);
  assert.ok(J(r.warnings).some((w) => /velocity\.csv が見つかりません/.test(w)));
  assert.ok(J(r.warnings).some((w) => /ロードマップは更新できませんでした/.test(w)));
  // 同期ログにも載る
  assert.match(String(e.sheets['同期ログ'].grid()[1][2]), /ロードマップは更新できませんでした/);
});

test('syncAll_: 障害物の片方のファイルが無ければ障害物シートを書き直さない（メモを失わない）', () => {
  const scrum = baseScrum();
  const e = makeEnv(scrum);
  e.ctx.syncAll_();
  e.sheets['障害物'].cells['2,10'] = '大事なメモ';
  delete scrum.files['impediment_log_resolved.csv'];
  const r = e.ctx.syncAll_();
  assert.equal(e.sheets['障害物'].grid()[1][9], '大事なメモ');
  assert.ok(J(r.warnings).some((w) => /障害物 は更新できませんでした/.test(w)));
});

test('syncAll_: product_backlog.csv が無いとき、バックログ・カンバンは触らず、ダッシュボードは警告を載せる', () => {
  const scrum = baseScrum();
  delete scrum.files['product_backlog.csv'];
  const e = makeEnv(scrum);
  const r = e.ctx.syncAll_();
  assert.ok(!e.sheets['バックログ'], 'バックログを空で作ってしまった');
  assert.ok(J(r.warnings).some((w) => /product_backlog\.csv が見つかりません/.test(w)));
  const dash = e.sheets['ダッシュボード'].grid();
  assert.ok(JSON.stringify(dash).includes('product_backlog.csv が見つかりません'));
});

test('syncAll_: 1枚の書き込み失敗で他のシートは止まらず、同期ログに警告が載る', () => {
  const e = makeEnv(baseScrum(), { sheetOpts: { 'ベロシティ': { failSetValues: true } } });
  const r = e.ctx.syncAll_();
  assert.ok(J(r.warnings).some((w) => /ベロシティ の書き込みに失敗/.test(w)));
  assert.ok(e.sheets['バックログ'].getLastRow() > 1);
  assert.ok(e.sheets['同期ログ'].getLastRow() === 2);
  assert.match(String(e.sheets['同期ログ'].grid()[1][2]), /ベロシティ の書き込みに失敗/);
});

test('syncAll_: 同期ログへの書き込みが失敗しても例外にせず、警告として返す', () => {
  const e = makeEnv(baseScrum(), { sheetOpts: { '同期ログ': { failSetValues: true } } });
  const r = e.ctx.syncAll_();
  assert.equal(r.skipped, false);
  assert.ok(J(r.warnings).some((w) => /同期ログ の書き込みに失敗/.test(w)));
});

test('syncAll_: ダッシュボードの書き込み失敗も警告に残る', () => {
  const e = makeEnv(baseScrum(), { sheetOpts: { 'ダッシュボード': { failSetValues: true } } });
  const r = e.ctx.syncAll_();
  assert.ok(J(r.warnings).some((w) => /ダッシュボード の書き込みに失敗/.test(w)));
});

test('syncAll_: ロードマップ・障害物・バーンダウン・完了バックログの書き込み失敗も警告になり、他は進む', () => {
  ['ロードマップ', '障害物', 'バーンダウン', '完了バックログ', 'バックログ'].forEach((name) => {
    const e = makeEnv(baseScrum(), { sheetOpts: { [name]: { failSetValues: true } } });
    const r = e.ctx.syncAll_();
    assert.ok(J(r.warnings).some((w) => w.indexOf(name) !== -1 && /書き込みに失敗/.test(w)), name + ': ' + JSON.stringify(r.warnings));
    assert.ok(e.sheets['同期ログ'].getLastRow() === 2, name + ' で同期ログまで届かなかった');
  });
});

test('syncAll_: .published.json の読み取りが例外でも（Drive の一時エラー）ダッシュボードは書かれる', () => {
  const scrum = baseScrum();
  scrum.failRead = '.published.json';
  const e = makeEnv(scrum);
  const r = e.ctx.syncAll_();
  assert.deepEqual(J(r.warnings), []);
  assert.ok(JSON.stringify(e.sheets['ダッシュボード'].grid()).includes('（記録なし）'));
});

test('syncAll_: スプリントフォルダが無い・sprint_backlog.md が無い・バーンダウンの表が無い、はそれぞれ警告', () => {
  let s = baseScrum(); s.folders = {};
  let r = makeEnv(s).ctx.syncAll_();
  assert.ok(J(r.warnings).some((w) => /フォルダ（例: sprint001）が見つかりません/.test(w)));

  s = baseScrum(); s.folders = { sprint001: { files: {} } };
  r = makeEnv(s).ctx.syncAll_();
  assert.ok(J(r.warnings).some((w) => /sprint001\/sprint_backlog\.md が見つかりません/.test(w)));

  s = baseScrum(); s.folders = { sprint001: { files: { 'sprint_backlog.md': '# 表なし' } } };
  r = makeEnv(s).ctx.syncAll_();
  assert.ok(J(r.warnings).some((w) => /バーンダウン」の表がありません/.test(w)));
});

test('syncAll_: ロックが取れなければ何も書かず skipped（解放もしない）', () => {
  const e = makeEnv(baseScrum(), { lockAvailable: false });
  const r = e.ctx.syncAll_();
  assert.equal(r.skipped, true);
  assert.equal(Object.keys(e.sheets).length, 0);
  assert.equal(e.lockState.releases, 0);
  assert.deepEqual(e.lockState.waits, [1000]);
});

test('syncAll_: フォルダ ID 未設定は ConfigError で中断し、ロックは必ず解放される', () => {
  const e = makeEnv(baseScrum(), { props: { SCRUM_FOLDER_ID: '' } });
  assert.throws(() => e.ctx.syncAll_(), (err) => err.name === 'ConfigError' && /未設定/.test(err.message));
  assert.equal(e.lockState.releases, 1);
});

test('getScrumFolder_: アクセスできない ID・scrum フォルダが無い、はそれぞれ設定エラー', () => {
  let e = makeEnv(baseScrum(), { badFolder: true });
  assert.throws(() => e.ctx.getScrumFolder_(), (err) => err.name === 'ConfigError' && /fid にアクセスできません/.test(err.message));
  e = makeEnv(baseScrum());
  e.root.getFoldersByName = () => ({ hasNext: () => false });
  assert.throws(() => e.ctx.getScrumFolder_(), (err) => err.name === 'ConfigError' && /scrum フォルダがありません/.test(err.message));
});

test('setFolderId_: 空・空白だけは拒否し、前後の空白は落として保存する', () => {
  const e = makeEnv(baseScrum());
  assert.throws(() => e.ctx.setFolderId_('   '), (err) => err.name === 'ConfigError');
  assert.throws(() => e.ctx.setFolderId_(undefined), (err) => err.name === 'ConfigError');
  e.ctx.setFolderId_('  abc  ');
  assert.equal(e.props.SCRUM_FOLDER_ID, 'abc');
  assert.equal(e.ctx.getFolderId_(), 'abc');
});

test('setLastPbiId_ / getLastPbiId_: 未設定は空文字、null は空文字で保存される', () => {
  const e = makeEnv(baseScrum());
  assert.equal(e.ctx.getLastPbiId_(), '');
  e.ctx.setLastPbiId_('PBI-007');
  assert.equal(e.ctx.getLastPbiId_(), 'PBI-007');
  e.ctx.setLastPbiId_(null);
  assert.equal(e.ctx.getLastPbiId_(), '');
});

test('writeScrumFile_: 許可外の名前・無いファイル・複数あるファイル・書き込み失敗（元メッセージを残す）', () => {
  const scrum = baseScrum();
  scrum.files['comments.csv'] = 'x';
  scrum.dups = { 'change_log.csv': 2 }; scrum.files['change_log.csv'] = 'y';
  const e = makeEnv(scrum);
  assert.throws(() => e.ctx.writeScrumFile_('velocity.csv', 'z'), /許可されていません/);
  e.ctx.writeScrumFile_('comments.csv', 'new');
  assert.equal(scrum.files['comments.csv'], 'new');
  const s2 = baseScrum(); delete s2.files['product_backlog.csv'];
  assert.throws(() => makeEnv(s2).ctx.writeScrumFile_('product_backlog.csv', 'z'), /見つかりません/);
  assert.throws(() => e.ctx.writeScrumFile_('change_log.csv', 'z'), /複数あります/);
  const s3 = baseScrum(); s3.failWrite = 'product_backlog.csv'; s3.failWriteMessage = 'Access denied';
  assert.throws(() => makeEnv(s3).ctx.writeScrumFile_('product_backlog.csv', 'z'), /Access denied.*編集権限/);
});

test('findLatestSprintFolder_: 数値で最新を選び、sprintSAMPLE は選ばない。無ければ null', () => {
  const e = makeEnv(baseScrum());
  const f = e.ctx.findLatestSprintFolder_(makeFolderInCtx(e, baseScrum()));
  assert.equal(f.getName(), 'sprint10');
  const none = e.ctx.findLatestSprintFolder_(makeFolderInCtx(e, { files: {}, folders: { sprintSAMPLE: { files: {} }, docs: { files: {} } } }));
  assert.equal(none, null);
});
function makeFolderInCtx(_e, spec) { return makeFolder(spec); }

// ---- メニュー -------------------------------------------------------------
test('onOpen: メニューを登録する（同期・設定・自動同期の開始/停止）', () => {
  const e = makeEnv(baseScrum());
  e.ctx.onOpen();
  const labels = e.ui.menu.items.filter((i) => i !== '--').map((i) => i[1]);
  assert.deepEqual(labels, ['menuSyncNow', 'menuConfigure', 'menuInstallTrigger', 'menuRemoveTrigger']);
  labels.forEach((fn) => assert.equal(typeof e.ctx[fn], 'function', fn + ' が定義されていない'));
});

test('menuSyncNow: 成功・警告あり・見送り・例外でそれぞれ違う案内を出す', () => {
  let e = makeEnv(baseScrum());
  e.ctx.menuSyncNow();
  assert.match(e.ss.toasts[0][0], /^同期しました（\d{4}-/);

  const s = baseScrum(); delete s.files['velocity.csv'];
  e = makeEnv(s);
  e.ctx.menuSyncNow();
  assert.match(e.ss.toasts[0][0], /警告 \d+ 件は「同期ログ」/);

  e = makeEnv(baseScrum(), { lockAvailable: false });
  e.ctx.menuSyncNow();
  assert.match(e.ss.toasts[0][0], /見送りました/);

  e = makeEnv(baseScrum(), { props: { SCRUM_FOLDER_ID: '' } });
  e.ctx.menuSyncNow();
  assert.equal(e.alerts[0][0], '同期できませんでした');
  assert.match(e.alerts[0][1], /未設定/);
});

test('menuConfigure: キャンセルは保存しない、OK で保存、空は保存できませんでした', () => {
  let e = makeEnv(baseScrum(), { props: { SCRUM_FOLDER_ID: 'old' }, prompts: [{ button: 'BTN_CANCEL', text: 'new' }] });
  e.ctx.menuConfigure();
  assert.equal(e.props.SCRUM_FOLDER_ID, 'old');
  assert.match(e.ui.lastPrompt[1], /現在の設定: old/);
  assert.equal(e.alerts.length, 0);

  e = makeEnv(baseScrum(), { props: { SCRUM_FOLDER_ID: '' }, prompts: [{ button: 'BTN_OK', text: ' new ' }] });
  e.ctx.menuConfigure();
  assert.equal(e.props.SCRUM_FOLDER_ID, 'new');
  assert.match(e.ui.lastPrompt[1], /\(未設定\)/);
  assert.equal(e.alerts[0][0], '保存しました');

  e = makeEnv(baseScrum(), { props: { SCRUM_FOLDER_ID: 'old' }, prompts: [{ button: 'BTN_OK', text: '  ' }] });
  e.ctx.menuConfigure();
  assert.equal(e.props.SCRUM_FOLDER_ID, 'old');
  assert.equal(e.alerts[0][0], '保存できませんでした');
});

test('menuInstallTrigger / menuRemoveTrigger: scheduledSync のトリガーだけを消し、30分毎を1つだけ作る', () => {
  const mk = (h) => ({ getHandlerFunction: () => h });
  const triggers = [mk('scheduledSync'), mk('other'), mk('scheduledSync')];
  const e = makeEnv(baseScrum(), { triggers });
  e.ctx.menuInstallTrigger();
  assert.deepEqual(triggers.map((t) => t.getHandlerFunction()), ['other', 'scheduledSync']);
  assert.deepEqual(J(e.created), [['scheduledSync', 30]]);
  e.ctx.menuRemoveTrigger();
  assert.deepEqual(triggers.map((t) => t.getHandlerFunction()), ['other'], '作った scheduledSync のトリガーが消えていない');
  assert.equal(e.alerts.length, 2);
});

test('menuInstallTrigger: UI を取れない（未認可）なら、トリガーを消さず作らない', () => {
  const mk = (h) => ({ getHandlerFunction: () => h });
  const triggers = [mk('scheduledSync')];
  const e = makeEnv(baseScrum(), { triggers, uiThrows: true });
  assert.throws(() => e.ctx.menuInstallTrigger());
  assert.equal(triggers.length, 1);
  assert.equal(e.created.length, 0);
});

test('scheduledSync: 例外（フォルダ未設定）は投げず、ログに残す。UI は触らない', () => {
  const e = makeEnv(baseScrum(), { props: { SCRUM_FOLDER_ID: '' }, uiThrows: true });
  assert.doesNotThrow(() => e.ctx.scheduledSync());
  assert.match(e.ctx.__errors[0], /自動同期に失敗しました/);
  const ok = makeEnv(baseScrum(), { uiThrows: true });
  ok.ctx.scheduledSync();
  assert.ok(ok.sheets['同期ログ']);
});

// ---- gas_sheets の直接検査 ---------------------------------------------------
test('paintMarks_: 空・未指定は何もしない。離れた2点は外接矩形を1回で塗り、間は塗らない', () => {
  const e = makeEnv(baseScrum());
  const sh = makeSheet('x');
  e.ctx.paintMarks_(sh, [], '#fff');
  e.ctx.paintMarks_(sh, null, '#fff');
  assert.equal(sh.calls.setBackgrounds, 0);
  e.ctx.paintMarks_(sh, [{ row: 1, col: 2 }, { row: 4, col: 5 }], '#123456');
  assert.equal(sh.calls.setBackgrounds, 1);
  assert.deepEqual(Object.keys(sh.bg).sort(), ['2,3', '5,6']);
  e.ctx.paintMarks_(sh, [{ row: 0, col: 0 }]);   // 色の既定
  assert.equal(sh.bg['1,1'], '#a8c7fa');
});

test('readNotes_: シートが無い・見出しだけ・メモ列が無い、は空。空キー・空メモの行は無視する', () => {
  const e = makeEnv(baseScrum());
  const ss = e.ss;
  assert.deepEqual(J(e.ctx.readNotes_(ss, '無い', 0, 10)), {});
  const sh = ss.insertSheet('N');
  sh.cells['1,1'] = 'ID';
  assert.deepEqual(J(e.ctx.readNotes_(ss, 'N', 0, 10)), {});
  sh.cells['2,1'] = ' PBI-1 '; sh.cells['2,3'] = ' メモ ';
  sh.cells['3,1'] = ''; sh.cells['3,3'] = 'キー無し';
  sh.cells['4,1'] = 'PBI-4'; sh.cells['4,3'] = '';
  assert.deepEqual(J(e.ctx.readNotes_(ss, 'N', 0, 2)), { 'PBI-1': 'メモ' });
  assert.deepEqual(J(e.ctx.readNotes_(ss, 'N', 0, 5)), {});   // 列が足りない
});

test('writeGrid_: 空グリッド・幅0はシートをクリアして返すだけ。不揃いな行は空文字で埋める', () => {
  const e = makeEnv(baseScrum());
  let sh = e.ctx.writeGrid_(e.ss, 'G', []);
  assert.equal(sh.getLastRow(), 0);
  sh = e.ctx.writeGrid_(e.ss, 'G', [[], []]);
  assert.equal(sh.getLastRow(), 0);
  sh = e.ctx.writeGrid_(e.ss, 'G', [['a', 'b', 'c'], ['x']]);
  assert.deepEqual(J(sh.grid()), [['a', 'b', 'c'], ['x', '', '']]);
  assert.equal(sh.frozen, 1);
  // 再書き込みで前回の内容は消える
  sh = e.ctx.writeGrid_(e.ss, 'G', [['z']]);
  assert.deepEqual(J(sh.grid()), [['z']]);
});
