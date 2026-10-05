'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// web_app.js（と、それが依存する gas_*.js / pure_*.js 全て）を GAS の単一グローバル
// スコープと同じ形で1つの vm コンテキストへ読み込み、DriveApp / LockService /
// PropertiesService / Utilities / Session を最小限のフェイクで差し替えて、
// apiCreatePbi / apiDeletePbi / apiRestorePbi を実際に呼び出して検査する。
//
// gas_load.test.js は「全体がロードできるか」だけを見る。ここでは実際に
// API を呼び、Drive 上の CSV（に見立てたインメモリの文字列）が期待どおり
// 書き換わることまで確かめる。GAS 層の中で唯一、実際の挙動を検査できる場所。

const GAS_DIR = path.join(__dirname, '..');

function gasFileNames() {
  return fs.readdirSync(GAS_DIR)
    .filter(function (name) { return name.slice(-3) === '.js'; })
    .sort();
}

const BACKLOG_FIELDS_FOR_TEST = [
  'id', 'title', 'description', 'acceptance_criteria', 'priority',
  'size', 'status', 'sprint', 'created_at', 'updated_at',
];

function headerOnlyCsv() {
  return BACKLOG_FIELDS_FOR_TEST.join(',') + '\n';
}

/** BACKLOG_FIELDS_FOR_TEST の順で CSV の1行を組み立てる（欠けた列は空文字）。 */
function csvRow(fields) {
  return BACKLOG_FIELDS_FOR_TEST.map(function (f) {
    return fields[f] !== undefined ? String(fields[f]) : '';
  }).join(',');
}

/** [{status,cards}] の board から id のカードを探す。無ければ null。 */
function findCardInBoard(board, id) {
  for (const col of board.columns) {
    for (const card of col.cards) {
      if (card.id === id) return card;
    }
  }
  return null;
}

/**
 * DriveApp / LockService / PropertiesService / Utilities / Session を
 * 差し替えた vm コンテキストを作り、gas/*.js を全部読み込んで返す。
 * files はフォルダ直下のファイル名→本文（可変）。product_backlog.csv 以外は
 * 読み取り専用（assertWritableFileName が絞っているので書けないのが正しい）。
 */
/**
 * opts.failSetProperty: true にすると PropertiesService.setProperty が常に例外を
 * 投げる（高水位の記帳が失敗する状況を再現するため）。
 * opts.failReadFile: 指定した名前で getFilesByName を呼ぶと例外を投げる（Drive 側が
 * エラーを返す状況を再現するため。ファイル不在＝readTextFile_ が null を返す、とは別の経路）。
 */
function createTestContext(files, opts) {
  opts = opts || {};
  function makeIterator(arr) {
    let i = 0;
    return { hasNext: function () { return i < arr.length; }, next: function () { return arr[i++]; } };
  }
  function makeFile(name) {
    return {
      getBlob: function () {
        return { getDataAsString: function () { return files[name]; } };
      },
      // opts.failWriteFile: その名前の setContent だけ例外にする（2ファイル目の書き込み失敗を再現する）。
      setContent: function (content) {
        if (opts.failWriteFile && name === opts.failWriteFile) {
          throw new Error('setContent はテストで意図的に失敗させています: ' + name);
        }
        files[name] = content;
      },
    };
  }
  const scrumFolder = {
    getFilesByName: function (name) {
      if (opts.failReadFile && name === opts.failReadFile) {
        throw new Error('getFilesByName はテストで意図的に失敗させています: ' + name);
      }
      return Object.prototype.hasOwnProperty.call(files, name) ? makeIterator([makeFile(name)]) : makeIterator([]);
    },
  };
  const rootFolder = {
    getFoldersByName: function (name) {
      return name === 'scrum' ? makeIterator([scrumFolder]) : makeIterator([]);
    },
  };

  const props = { SCRUM_FOLDER_ID: 'fake-folder-id' };
  const context = {
    console: console,
    DriveApp: {
      getFolderById: function () { return rootFolder; },
    },
    LockService: {
      getScriptLock: function () {
        return { tryLock: function () { return true; }, releaseLock: function () {} };
      },
    },
    PropertiesService: {
      getScriptProperties: function () {
        return {
          getProperty: function (key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
          setProperty: function (key, value) {
            if (opts.failSetProperty) throw new Error('setProperty はテストで意図的に失敗させています');
            props[key] = value;
          },
        };
      },
    },
    Session: { getScriptTimeZone: function () { return 'UTC'; } },
    Utilities: {
      // テスト用の簡易実装。yyyy-MM-dd HH:mm:ss を返せれば十分。
      formatDate: function (date) {
        function pad(n) { return n < 10 ? '0' + n : String(n); }
        return date.getUTCFullYear() + '-' + pad(date.getUTCMonth() + 1) + '-' + pad(date.getUTCDate()) + ' ' +
          pad(date.getUTCHours()) + ':' + pad(date.getUTCMinutes()) + ':' + pad(date.getUTCSeconds());
      },
    },
  };
  vm.createContext(context);
  gasFileNames().forEach(function (name) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, name), 'utf8'), context, { filename: name });
  });
  return { ctx: context, files: files, props: props };
}

// kanban.html の readForm() が実際に送る形（作成は常に全項目）に合わせる。
function fullFields(title) {
  return { title: title, description: '', acceptance_criteria: '', status: 'New', priority: 'Medium', size: '', sprint: '' };
}

test('最大の PBI を削除→作成→取り消し、が成功する（削除した ID を再利用しない）', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });

  const c1 = ctx.apiCreatePbi(fullFields('A'));
  const c2 = ctx.apiCreatePbi(fullFields('B'));
  const c3 = ctx.apiCreatePbi(fullFields('C'));
  assert.equal(c1.id, 'PBI-001');
  assert.equal(c2.id, 'PBI-002');
  assert.equal(c3.id, 'PBI-003');

  // PBI-003（最大）を削除する。
  const card3 = findCardInBoard(c3.board, 'PBI-003');
  assert.ok(card3, 'PBI-003 が board に無い');
  const del = ctx.apiDeletePbi('PBI-003', card3.updated_at);
  assert.equal(del.ok, true, JSON.stringify(del));
  assert.ok(del.removed, '削除した行（取り消し用）が返っていない');
  assert.equal(del.removed.id, 'PBI-003');

  // 削除の間に新規作成すると、PBI-003 を再利用せず PBI-004 になる。
  const c4 = ctx.apiCreatePbi(fullFields('D'));
  assert.equal(c4.ok, true, JSON.stringify(c4));
  assert.equal(c4.id, 'PBI-004', 'PBI-003 が再利用された（最大 ID 削除後のバグ）');

  // 「取り消す」を押す。PBI-004 が既に存在していても PBI-003 は空いているので復元できる。
  const restore = ctx.apiRestorePbi(del.removed);
  assert.equal(restore.ok, true, '取り消しが duplicate_id 等で失敗した: ' + JSON.stringify(restore));

  // vm コンテキストの配列は別レルムのオブジェクトのため、.map 等の連鎖は
  // deepStrictEqual が「構造は同じだが参照が別」で弾く foreign array を返しうる。
  // ここでは native な配列へ手動で詰め直す。
  const finalIds = [];
  ctx.apiGetView('board').view.columns.forEach(function (c) {
    c.cards.forEach(function (card) { finalIds.push(card.id); });
  });
  finalIds.sort();
  assert.deepEqual(finalIds, ['PBI-001', 'PBI-002', 'PBI-003', 'PBI-004']);
});

test('途中の欠番（最大ではない）を削除しても引き続き埋めない', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const c1 = ctx.apiCreatePbi(fullFields('A'));
  const c2 = ctx.apiCreatePbi(fullFields('B'));
  ctx.apiCreatePbi(fullFields('C'));

  const card2 = findCardInBoard(c2.board, 'PBI-002');
  ctx.apiDeletePbi('PBI-002', card2.updated_at);

  const c4 = ctx.apiCreatePbi(fullFields('D'));
  assert.equal(c4.id, 'PBI-004');
  void c1;
});

test('完了バックログ（product_backlog_done.csv）にある最大 ID も採番の高水位として拾う', () => {
  // このリポジトリでは、product_backlog.csv からは見えなくなった「完了へ移した」
  // PBI の ID を新規作成が再利用しないよう、完了バックログも走査対象に含めている
  // （report に判断理由あり）。
  const doneCsv = headerOnlyCsv() +
    'PBI-050,終わったやつ,,,,,Done,,2026-09-01 00:00:00,2026-09-01 00:00:00\n';
  const { ctx } = createTestContext({
    'product_backlog.csv': headerOnlyCsv(),
    'product_backlog_done.csv': doneCsv,
  });
  const created = ctx.apiCreatePbi(fullFields('新規'));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.id, 'PBI-051', '完了バックログの最大 ID より後ろから採番されていない');
});

test('apiRestorePbi は PBI-\\d+ 形式でない id を拒否する', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const forms = ['', 'PBI-999999abc', 'DROP TABLE', '  ', 'PBI-'];
  forms.forEach(function (id) {
    const res = ctx.apiRestorePbi({ id: id, title: 'x', status: 'New' });
    assert.equal(res.ok, false, 'id=' + JSON.stringify(id) + ' が通ってしまった');
    assert.equal(res.reason, 'invalid', 'id=' + JSON.stringify(id));
  });
});

test('apiRestorePbi はタイトルが空の行を拒否する', () => {
  // 空 CSV・記録なしのまま id だけで呼ぶと、title に到達する前に
  // isPbiIdWithinHighWater（採番の上限判定）で reason:'invalid' として拒否され、
  // title ガードを検査したことにならない（両者は reason が同じで区別できない）。
  // 上限を通過させるため、まず1件作って削除し、その removed の title だけを
  // 空にして復元する。
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const created = ctx.apiCreatePbi(fullFields('あとで消す'));
  assert.equal(created.ok, true, JSON.stringify(created));
  const card = findCardInBoard(created.board, created.id);
  const del = ctx.apiDeletePbi(created.id, card.updated_at);
  assert.equal(del.ok, true, JSON.stringify(del));

  const removedWithoutTitle = Object.assign({}, del.removed, { title: '' });
  const res = ctx.apiRestorePbi(removedWithoutTitle);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid');
  // reason だけでは上限判定との区別がつかないため、メッセージの内容まで検査する。
  assert.equal(res.message, 'タイトルを入力してください。',
    'title ガードではない別の経路で拒否された: ' + JSON.stringify(res));
});

test('apiRestorePbi は検証を通った行を、元の id / created_at のまま復元する', () => {
  // 復元は「削除の直前にそこにあった行」を戻す操作なので、まず削除して
  // del.removed を復元する（PBI-007 がいきなり最大値を超えないようにする）。
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-007', title: 'もどす', priority: 'High', size: '3', status: 'Ready',
    created_at: '2026-09-01 09:00:00', updated_at: '2026-09-05 10:00:00',
  }) + '\n';
  const { ctx, files } = createTestContext({ 'product_backlog.csv': csv });
  const del = ctx.apiDeletePbi('PBI-007', '2026-09-05 10:00:00');
  assert.equal(del.ok, true, JSON.stringify(del));

  const res = ctx.apiRestorePbi(del.removed);
  assert.equal(res.ok, true, JSON.stringify(res));
  const card = findCardInBoard(res.board, 'PBI-007');
  assert.ok(card, 'PBI-007 が board に無い');

  // buildBoardData はカードに created_at を載せないため、盤面ではなく
  // 書き戻された CSV 本体を読んで、created_at が元のままであることを検査する。
  const restored = ctx.csvToObjects(files['product_backlog.csv']).find(function (r) {
    return String(r.id).trim() === 'PBI-007';
  });
  assert.ok(restored, 'PBI-007 が CSV に無い');
  assert.equal(restored.created_at, '2026-09-01 09:00:00', 'created_at が元のまま復元されていない');
});

test('apiRestorePbi は語彙外の status / priority / 非整数の size を持つ行も、表示→削除→取り消しまで通す', () => {
  // 復元は「今そこに表示・編集・削除できていた行を、そのまま戻す」操作である。
  // 語彙外の値（ローカルの Claude Code が直接 CSV に書いた行を想定）を持つ行も
  // 表示・削除はできるため、復元だけを拒否すると取り消し操作が名目だけになる。
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-050', title: '曖昧な行', priority: '重要', size: 'M', status: 'Backlog',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  }) + '\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': csv });

  // 表示: buildBoardData は語彙外の status を New 列へフォールバックして描く。
  const board1 = ctx.apiGetView('board').view;
  assert.ok(findCardInBoard(board1, 'PBI-050'), '語彙外の行が盤面に出ない');

  // 削除はできる。
  const del = ctx.apiDeletePbi('PBI-050', '2026-09-01 00:00:00');
  assert.equal(del.ok, true, JSON.stringify(del));
  assert.ok(del.removed, '削除した行が返っていない');

  // 取り消し: 語彙外の priority / status、非整数の size があっても復元できる。
  const restore = ctx.apiRestorePbi(del.removed);
  assert.equal(restore.ok, true, '語彙外の値を理由に正当な取り消しが拒否された: ' + JSON.stringify(restore));
  assert.ok(findCardInBoard(restore.board, 'PBI-050'));
});

test('apiRestorePbi は今の最大値より大きい ID を拒否する（でっち上げによる採番汚染の防止）', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const created = ctx.apiCreatePbi(fullFields('普通'));
  assert.equal(created.id, 'PBI-001');

  const fake = {
    id: 'PBI-999999', title: 'でっちあげ', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  };
  const res = ctx.apiRestorePbi(fake);
  assert.equal(res.ok, false, 'でっち上げ ID の復元が通ってしまった');
  assert.equal(res.reason, 'invalid');

  // 汚染していないので、次の採番は PBI-002 のまま。
  const next = ctx.apiCreatePbi(fullFields('つぎ'));
  assert.equal(next.id, 'PBI-002', '拒否されたはずの復元が採番を汚染した: ' + next.id);
});

test('apiRestorePbi は PBI-000 を拒否する（採番は PBI-001 から始まる）', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const fake = {
    id: 'PBI-000', title: 'ゼロ', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  };
  const res = ctx.apiRestorePbi(fake);
  assert.equal(res.ok, false, 'PBI-000 の復元が通ってしまった');
  assert.equal(res.reason, 'invalid');
});

test('高水位の記帳が一度も成功していない状態で最後の1行を削除しても、その取り消しが通る（記録が失われない）', () => {
  // 記帳（PropertiesService.setProperty）が常に失敗する状況を再現する。
  // 記帳は best-effort なので、CSV への書き戻し（削除の成功）自体は妨げられない。
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-001', title: '最後の1行', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  }) + '\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': csv }, { failSetProperty: true });

  const del = ctx.apiDeletePbi('PBI-001', '2026-09-01 00:00:00');
  assert.equal(del.ok, true, JSON.stringify(del));

  // 削除後、CSV の行も記録（記帳が一度も成功していない）も空になり、上限が
  // 一つも立たない。ここで拒否すると、削除した行を戻す先が無く失われる。
  const restore = ctx.apiRestorePbi(del.removed);
  assert.equal(restore.ok, true,
    '記録も CSV も空で上限が立たないため、削除の取り消しが拒否され行が失われた: ' + JSON.stringify(restore));
});

test('ローカルの Claude Code が書いた大きい ID をアプリで削除しても、その取り消しが通る', () => {
  // withBacklogWrite_ が書き戻しのたびに高水位を rows の最大値まで進めるため、
  // 削除の書き戻し時点で PBI-100 の存在が高水位へ反映され、行が消えたあとの
  // 復元でも「最大値を超えている」と誤判定されない。
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-100', title: '外で作られた', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  }) + '\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': csv });

  const del = ctx.apiDeletePbi('PBI-100', '2026-09-01 00:00:00');
  assert.equal(del.ok, true, JSON.stringify(del));

  const restore = ctx.apiRestorePbi(del.removed);
  assert.equal(restore.ok, true, '外で作られた大きい ID の取り消しが拒否された: ' + JSON.stringify(restore));
});

test('高水位の記帳（setProperty）が失敗しても、ドラッグ・削除は成功する', () => {
  // advanceLastPbiIdWatermark_ は best-effort の記帳であり、ここが失敗しても
  // withBacklogWrite_ 本体（CSV への書き戻し）まで巻き添えにしてはいけない。
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-001', title: '対象', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  }) + '\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': csv }, { failSetProperty: true });

  // ドラッグ（ステータス変更）。
  const moved = ctx.apiUpdateStatus('PBI-001', 'In Progress', '2026-09-01 00:00:00');
  assert.equal(moved.ok, true, 'setProperty の失敗でドラッグまで失敗した: ' + JSON.stringify(moved));

  // 削除。
  const card = findCardInBoard(moved.board, 'PBI-001');
  assert.ok(card, 'PBI-001 が board に無い');
  const del = ctx.apiDeletePbi('PBI-001', card.updated_at);
  assert.equal(del.ok, true, 'setProperty の失敗で削除まで失敗した: ' + JSON.stringify(del));
});

test('advanceLastPbiIdWatermark_ は mutate より前に呼ばれる（mutate が rows を破壊的に変更しても高水位を取り逃さない）', () => {
  // 今の pure 層（deleteRow 等）は rows を書き換えず新しい配列を返すが、将来
  // 破壊的に書き換えるようになっても取り逃さないよう、advance は mutate の
  // 前に呼ぶ実装になっている（web_app.js のコメント参照）。この順序を誰も
  // 検査していないと、入れ替えられても気づけない。ここでは pure 層が破壊的で
  // ある状況を模した mutate を直接渡し、順序を固定する。
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-042', title: '破壊的テスト', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  }) + '\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': csv });

  // advance が mutate の後に呼ばれる実装だと、ここで空にされた rows しか
  // 見えず、PBI-042 の高水位が記録されないまま終わる。
  const result = ctx.withBacklogWrite_(function (rows) {
    rows.length = 0;
    return { ok: true, rows: rows };
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  assert.equal(ctx.getLastPbiId_(), 'PBI-042',
    'mutate による破壊的変更の後に高水位を計算しており、PBI-042 を取り逃した');
});

test('外で作られた大きい ID を削除した後、採番が下から歩き直して衝突しない', () => {
  const csv = headerOnlyCsv() + csvRow({
    id: 'PBI-100', title: '外で作られた', status: 'New',
    created_at: '2026-09-01 00:00:00', updated_at: '2026-09-01 00:00:00',
  }) + '\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': csv });

  const del = ctx.apiDeletePbi('PBI-100', '2026-09-01 00:00:00');
  assert.equal(del.ok, true, JSON.stringify(del));

  const created = ctx.apiCreatePbi(fullFields('つぎ'));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.id, 'PBI-101',
    '削除後の採番が下から歩き直し、外で作られた ID と衝突する経路に戻った: ' + created.id);
});

test('apiGetView は不明な名前を拒否する', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const res = ctx.apiGetView('しらないビュー');
  assert.equal(res.ok, false);
  assert.ok(res.message.indexOf('不明なビュー') !== -1);
});

test('apiGetView は読み取りに失敗したビューが他を巻き添えにしない', () => {
  // velocity.csv が無くても board は読める。
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const board = ctx.apiGetView('board');
  assert.equal(board.ok, true);
  const velocity = ctx.apiGetView('velocity');
  assert.equal(velocity.ok, true);
  // velocity.view.table.rows は vm コンテキストの別レルム配列のため、deepEqual([]) は
  // 「構造は同じだが参照が別」で弾かれる（本ファイル冒頭のコメント参照）。長さで見る。
  assert.ok(Array.isArray(velocity.view.table.rows), 'rows が配列でない');
  assert.equal(velocity.view.table.rows.length, 0);
});

test('apiGetView(board) は完成した選択肢を返す（パネルのスプリント欄）', () => {
  // パネルは盤面でしか開かない。開くたびにサーバへ往復させないよう、盤面の応答に載せる。
  // 組み立ての規則を画面へ写さないため、「完成した形」で渡す。
  const { ctx } = createTestContext({
    'product_backlog.csv': headerOnlyCsv() +
      csvRow({ id: 'PBI-001', title: 'A', status: 'New', sprint: 'sprint001' }) + '\n' +
      csvRow({ id: 'PBI-002', title: 'B', status: 'New', sprint: 'ゆうれい' }) + '\n',
    'velocity.csv': 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n' +
      'sprint001,10,8,2,2026-01-01,2026-01-14,\n',
  });
  const board = ctx.apiGetView('board');
  assert.equal(board.ok, true, JSON.stringify(board));
  assert.ok(Array.isArray(board.sprintChoices), 'sprintChoices が配列で返っていない');
  const values = [];
  board.sprintChoices.forEach(function (o) { values.push(o.value); });
  assert.deepEqual(values, ['', 'sprint001', 'ゆうれい'],
    'velocity.csv に無い PBI 側のスプリントが選択肢に入っていない: ' + JSON.stringify(values));
  assert.equal(board.sprintChoices[2].unknown, true);
});

test('velocity.csv が無くても盤面は読め、選択肢は未割り当てだけになる', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const board = ctx.apiGetView('board');
  assert.equal(board.ok, true);
  assert.ok(Array.isArray(board.sprintChoices), 'sprintChoices が配列で返っていない');
  assert.equal(board.sprintChoices.length, 1);
  assert.equal(board.sprintChoices[0].value, '');
});

test('readCsvRowsBestEffort_ は Drive が例外を投げても空配列にする（ファイル不在とは別の経路）', () => {
  // 「見つからない」（readTextFile_ が null を返す）ときは catch まで届かない。
  // ここでは getFilesByName 自体が例外を投げる状況を再現し、catch が効くことを確かめる。
  // 中身を空にすると csvToObjects('') が空配列を返すため、例外経路を通らなくても
  // 同じ結論（rows が空）に着いてしまい、throw が効いているかを検証できない。
  // 有効な1行を入れ、例外を無視すればこの行が rows に出てしまう状態にしておく。
  const { ctx } = createTestContext(
    {
      'product_backlog.csv': headerOnlyCsv(),
      'velocity.csv': 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n' +
        'sprint001,10,8,2,2026-01-01,2026-01-14,\n',
    },
    { failReadFile: 'velocity.csv' }
  );
  const velocity = ctx.apiGetView('velocity');
  assert.equal(velocity.ok, true, 'Drive の例外で velocity タブ全体が失敗した: ' + JSON.stringify(velocity));
  assert.ok(Array.isArray(velocity.view.table.rows), 'rows が配列でない');
  assert.equal(velocity.view.table.rows.length, 0);
});

test('apiGetView はバーンダウンの元データが無ければ view を null で返す', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const res = ctx.apiGetView('burndown');
  assert.equal(res.ok, true);
  assert.equal(res.view, null);
});

test('apiGetView(roadmap) は board と同じくヘッダーが壊れた CSV を拒否する', () => {
  // 列が欠けた壊れたヘッダー。board はこれを ok:false で拒否する。
  const brokenCsv = 'id,title,status\n';
  const { ctx } = createTestContext({ 'product_backlog.csv': brokenCsv });

  const board = ctx.apiGetView('board');
  assert.equal(board.ok, false, '前提: board がヘッダー検査で拒否していない');

  const roadmap = ctx.apiGetView('roadmap');
  assert.equal(roadmap.ok, false,
    'roadmap がヘッダー検査を通っておらず、壊れた CSV から誤った表を返している');
});

test('apiGetView(board) は要約を一緒に返す', () => {
  // タブを開いた時点で1往復で済ませるため。
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const res = ctx.apiGetView('board');
  assert.equal(res.ok, true);
  assert.ok(res.summary);
  assert.ok(Array.isArray(res.summary.byStatus));
});

test('apiGetView(done) は完了バックログ自身の要約を返す', () => {
  // 要約はタブ単位。ここだけ null にすると、やることタブの中で盤面→一覧→完了と
  // 切り替えたときに要約の行が現れて消える。
  const { ctx } = createTestContext({
    'product_backlog.csv': headerOnlyCsv() +
      csvRow({ id: 'PBI-010', title: '未完了', status: 'New', size: '3' }) + '\n',
    'product_backlog_done.csv': headerOnlyCsv() +
      csvRow({ id: 'PBI-001', title: '済み1', status: 'Done', size: '5' }) + '\n' +
      csvRow({ id: 'PBI-002', title: '済み2', status: 'Done', size: '8' }) + '\n',
  });

  const backlog = ctx.apiGetView('list');
  assert.equal(backlog.summary.total.count, 1, '前提: バックログ側の合計と区別できる見本になっていない');

  const done = ctx.apiGetView('done');
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.ok(done.summary, '完了だけ要約が無い（同じタブの中で要約の行が消える）');
  // バックログの合計（1件 / 3pt）をそのまま載せていないこと。
  assert.equal(done.summary.total.count, 2, '完了バックログ自身の件数になっていない');
  assert.equal(done.summary.total.points, 13, '完了バックログ自身のポイントになっていない');
});

test('apiGetView(roadmap) は velocity.csv にスプリントが無い理由を応答に載せる', () => {
  // 帯が出ない理由がどこにも出ない、という設計書が名指しした状態を防ぐ。
  const { ctx } = createTestContext({
    'product_backlog.csv': headerOnlyCsv() +
      csvRow({ id: 'PBI-001', title: 'A', status: 'New', sprint: 'sprint001' }) + '\n',
  });
  const res = ctx.apiGetView('roadmap');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.view.notice, 'velocity.csv にスプリントが登録されていません。');
});

test('apiGetView(roadmap) は実在スプリントがあれば理由を載せない', () => {
  const { ctx } = createTestContext({
    'product_backlog.csv': headerOnlyCsv() +
      csvRow({ id: 'PBI-001', title: 'A', status: 'New', sprint: 'sprint001' }) + '\n',
    'velocity.csv': 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n' +
      'sprint001,10,8,2,2026-01-01,2026-01-14,\n',
  });
  const res = ctx.apiGetView('roadmap');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.view.notice, undefined);
});

const IMP_HEADER = 'id,title,description,reported_by,reported_at,status,resolved_at,resolution,sprint\n';
const IMP_TEMPLATE = 'IMP-001,（障害物タイトル）,（詳細説明）,（報告者）,YYYY-MM-DD,Open,,（解決策）,sprint001\n';
function impFiles(openBody, resolvedBody) {
  return {
    'product_backlog.csv': headerOnlyCsv(),
    'velocity.csv': 'sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes\n' +
      'sprint001,10,8,2,2026-09-01,2026-09-14,\n',
    'impediment_log.csv': IMP_HEADER + IMP_TEMPLATE + (openBody || ''),
    'impediment_log_resolved.csv': IMP_HEADER + IMP_TEMPLATE + (resolvedBody || ''),
  };
}
const IMP2 = 'IMP-002,止まっている,,マヤ,2026-10-01,Open,,,sprint001\n';
const IMP2_ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const plain = (v) => JSON.parse(JSON.stringify(v));   // vm の別レルム配列を deepEqual できる形へ

test('apiGetView(impediment) はスプリントの選択肢を載せる', () => {
  const { ctx } = createTestContext(impFiles(IMP2));
  const res = ctx.apiGetView('impediment');
  assert.equal(res.ok, true);
  assert.ok(plain(res.sprintChoices).some((c) => c.value === 'sprint001'));
});

test('作成: 雛形の次の IMP-002 を採番し、今日の日付と Open で未解決へ追記する', () => {
  const { ctx, files } = createTestContext(impFiles());
  const res = ctx.apiCreateImpediment({ title: '回線が遅い', reported_by: 'マヤ', sprint: 'sprint001', status: 'Resolved' });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.id, 'IMP-002');
  const line = files['impediment_log.csv'].trim().split('\n').pop();
  assert.match(line, /^IMP-002,回線が遅い,,マヤ,\d{4}-\d{2}-\d{2},Open,,,sprint001$/);
  assert.deepEqual(plain(res.view.open).map((r) => r.id), ['IMP-002']);
  assert.equal(files['impediment_log_resolved.csv'], IMP_HEADER + IMP_TEMPLATE, '解決済を書いた');
});

test('作成: 解決済にある最大 ID も数える', () => {
  const { ctx } = createTestContext(impFiles('', 'IMP-005,済,,マヤ,2026-09-01,Resolved,2026-09-02,直した,\n'));
  assert.equal(ctx.apiCreateImpediment({ title: 'A', reported_by: 'B' }).id, 'IMP-006');
});

test('作成: 検証に落ちたら書かない', () => {
  const { ctx, files } = createTestContext(impFiles());
  const before = files['impediment_log.csv'];
  const res = ctx.apiCreateImpediment({ title: '', reported_by: '' });
  assert.equal(res.reason, 'invalid');
  assert.equal(files['impediment_log.csv'], before);
});

test('ヘッダーが違う CSV には書かない', () => {
  const f = impFiles();
  f['impediment_log_resolved.csv'] = 'id,title\n';
  const { ctx, files } = createTestContext(f);
  const before = files['impediment_log.csv'];
  const res = ctx.apiCreateImpediment({ title: 'A', reported_by: 'B' });
  assert.equal(res.ok, false);
  assert.equal(files['impediment_log.csv'], before);
});

test('編集: 見た行と同じなら書き、違えば conflict で書かない', () => {
  const { ctx, files } = createTestContext(impFiles(IMP2));
  const ok = ctx.apiUpdateImpediment('IMP-002', { title: '新しい題', description: 'd', reported_by: 'マヤ', sprint: '' }, IMP2_ROW);
  assert.equal(ok.ok, true, ok.message);
  assert.ok(files['impediment_log.csv'].indexOf('IMP-002,新しい題,d,マヤ,2026-10-01,Open,,,') !== -1);
  const before = files['impediment_log.csv'];
  const ng = ctx.apiUpdateImpediment('IMP-002', { title: 'X', reported_by: 'マヤ' }, IMP2_ROW);
  assert.equal(ng.reason, 'conflict');
  assert.equal(files['impediment_log.csv'], before);
  assert.ok(ng.view, '競合でも最新のビューを返す');
});

test('解決: 解決済へ足してから未解決から消す。取り消しで元に戻る', () => {
  const { ctx, files } = createTestContext(impFiles(IMP2));
  const res = ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(res.ok, true, res.message);
  assert.equal(files['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE);
  assert.match(files['impediment_log_resolved.csv'], /IMP-002,止まっている,,マヤ,2026-10-01,Resolved,\d{4}-\d{2}-\d{2},再起動した,sprint001/);
  assert.deepEqual(plain(res.moved), IMP2_ROW);

  const back = ctx.apiUnresolveImpediment(plain(res.moved), plain(res.resolvedRow));
  assert.equal(back.ok, true, back.message);
  assert.equal(files['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE + IMP2);
  assert.equal(files['impediment_log_resolved.csv'], IMP_HEADER + IMP_TEMPLATE);
});

test('解決: 2つ目（未解決から消す）で失敗すると partial。「完了する」で送り直すと完了する', () => {
  const f = impFiles(IMP2);
  const first = createTestContext(f, { failWriteFile: 'impediment_log.csv' });
  const res = first.ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(res.reason, 'partial');
  assert.ok(res.message.indexOf('「完了する」') !== -1, res.message);
  assert.ok(res.message.indexOf('impediment_log.csv') !== -1, res.message);
  assert.equal(res.message.split('（').length, 2, '括弧が二重になっている: ' + res.message);
  assert.ok(f['impediment_log.csv'].indexOf('IMP-002') !== -1, '未解決に残っている前提');
  assert.ok(f['impediment_log_resolved.csv'].indexOf('IMP-002') !== -1, '解決済に足された前提');
  assert.deepEqual(plain(res.view.open).map((r) => r.id), [], '両方にある間は未解決に出さない');

  const retry = createTestContext(f).ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(retry.ok, true, retry.message);
  assert.equal(f['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE);
  assert.equal(f['impediment_log_resolved.csv'].split('IMP-002').length - 1, 1, '解決済に二重に足した');
});

test('取り消し: 2つ目（解決済から消す）で失敗すると partial。「完了する」で送り直すと完了する', () => {
  const f = impFiles(IMP2);
  const done = createTestContext(f).ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(done.ok, true, done.message);
  const moved = plain(done.moved);
  const resolvedRow = plain(done.resolvedRow);

  const res = createTestContext(f, { failWriteFile: 'impediment_log_resolved.csv' }).ctx
    .apiUnresolveImpediment(moved, resolvedRow);
  assert.equal(res.reason, 'partial');
  assert.ok(res.message.indexOf('「完了する」') !== -1, res.message);
  assert.ok(f['impediment_log.csv'].indexOf('IMP-002') !== -1, '未解決に戻した前提');
  assert.ok(f['impediment_log_resolved.csv'].indexOf('IMP-002') !== -1, '解決済に残っている前提');

  const retry = createTestContext(f).ctx.apiUnresolveImpediment(moved, resolvedRow);
  assert.equal(retry.ok, true, retry.message);
  assert.equal(f['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE + IMP2, '未解決に二重に足した');
  assert.equal(f['impediment_log_resolved.csv'], IMP_HEADER + IMP_TEMPLATE);
});

test('解決: 1つ目（解決済へ足す）で失敗すれば error で、どちらも変わらない', () => {
  const f = impFiles(IMP2);
  const before = Object.assign({}, f);
  const res = createTestContext(f, { failWriteFile: 'impediment_log_resolved.csv' }).ctx
    .apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(res.reason, 'error');
  assert.equal(f['impediment_log.csv'], before['impediment_log.csv']);
  assert.equal(f['impediment_log_resolved.csv'], before['impediment_log_resolved.csv']);
});

test('解決: 解決策が空なら invalid で書かない', () => {
  const { ctx, files } = createTestContext(impFiles(IMP2));
  assert.equal(ctx.apiResolveImpediment('IMP-002', '  ', IMP2_ROW).reason, 'invalid');
  assert.ok(files['impediment_log.csv'].indexOf('IMP-002') !== -1);
});

const DUP_MSG = '未解決と解決済に、同じ ID の別の障害物があります（IMP-002）。CSV の ID を直してから操作してください。';

test('解決: 同じ ID で中身の違う行が解決済にあれば duplicate_id の文言で、書かない', () => {
  const f = impFiles(IMP2, 'IMP-002,別の障害物,,マヤ,2026-09-01,Resolved,2026-09-02,直した,sprint001\n');
  const { ctx, files } = createTestContext(f);
  const before = [files['impediment_log.csv'], files['impediment_log_resolved.csv']];
  const res = ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(res.reason, 'duplicate_id');
  assert.equal(res.message, DUP_MSG);
  assert.deepEqual([files['impediment_log.csv'], files['impediment_log_resolved.csv']], before);
});

test('取り消し: 同じ ID で中身の違う行が未解決にあれば duplicate_id の文言', () => {
  const f = impFiles('IMP-002,別の障害物,,マヤ,2026-09-01,Open,,,sprint001\n',
    'IMP-002,止まっている,,マヤ,2026-10-01,Resolved,2026-10-02,直した,sprint001\n');
  const { ctx } = createTestContext(f);
  const resolvedRow = Object.assign({}, IMP2_ROW, { status: 'Resolved', resolved_at: '2026-10-02', resolution: '直した' });
  const res = ctx.apiUnresolveImpediment(IMP2_ROW, resolvedRow);
  assert.equal(res.reason, 'duplicate_id');
  assert.equal(res.message, DUP_MSG);
});

test('解決: conflict の文言に「もう一度押すと解決します」を含めない', () => {
  const { ctx } = createTestContext(impFiles(IMP2));
  const res = ctx.apiResolveImpediment('IMP-002', '再起動した', Object.assign({}, IMP2_ROW, { title: '古い題' }));
  assert.equal(res.reason, 'conflict');
  assert.ok(res.message.indexOf('既に解決済み') === -1, res.message);
  assert.ok(res.message.indexOf('もう一度押すと解決します') === -1, res.message);
  assert.ok(res.message.indexOf('もう一度「解決を確定」を押してください。') !== -1, res.message);
});

test('解決: 未解決側に雛形 IMP-001 しか無く、解決済に本物の IMP-001 があれば「既に解決済み」（雛形を未解決の行と取り違えない）', () => {
  const real = 'IMP-001,本物,,マヤ,2026-09-01,Resolved,2026-09-02,直した,sprint001\n';
  const f = impFiles('', real);
  const before = [f['impediment_log.csv'], f['impediment_log_resolved.csv']];
  const { ctx } = createTestContext(f);
  const res = ctx.apiResolveImpediment('IMP-001', 'x', { id: 'IMP-001', title: '本物' });
  assert.equal(res.reason, 'conflict');
  assert.equal(res.message, 'この障害物は既に解決済みです。最新の内容に更新しました。');
  assert.deepEqual([f['impediment_log.csv'], f['impediment_log_resolved.csv']], before);
});

/** 解決が2つ目で止まった状態（IMP-002 が両方のファイルにある）の CSV を作る。 */
function halfResolvedFiles() {
  const f = impFiles(IMP2);
  const res = createTestContext(f, { failWriteFile: 'impediment_log.csv' }).ctx
    .apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(res.reason, 'partial');
  return f;
}

test('途中で止まった解決: apiGetView が pending を返し、「解決済として完了」で解決済だけに揃う', () => {
  const f = halfResolvedFiles();
  const view = createTestContext(f).ctx.apiGetView('impediment');
  const pending = plain(view.view.pending);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, 'IMP-002');
  assert.equal(view.summary.pending, 1);
  const res = createTestContext(f).ctx.apiResolveImpediment(pending[0].id, pending[0].resolved.resolution, pending[0].open);
  assert.equal(res.ok, true, res.message);
  assert.equal(f['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE);
  assert.equal(f['impediment_log_resolved.csv'].split('IMP-002').length - 1, 1);
  assert.deepEqual(plain(res.view.pending), []);
});

test('途中で止まった解決: 「未解決に戻す」で未解決だけに揃う', () => {
  const f = halfResolvedFiles();
  const pending = plain(createTestContext(f).ctx.apiGetView('impediment').view.pending)[0];
  const res = createTestContext(f).ctx.apiUnresolveImpediment(pending.open, pending.resolved);
  assert.equal(res.ok, true, res.message);
  assert.equal(f['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE + IMP2);
  assert.equal(f['impediment_log_resolved.csv'], IMP_HEADER + IMP_TEMPLATE);
  assert.deepEqual(plain(res.view.pending), []);
});
