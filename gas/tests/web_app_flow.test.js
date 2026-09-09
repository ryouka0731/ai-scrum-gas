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
      setContent: function (content) { files[name] = content; },
    };
  }
  const scrumFolder = {
    getFilesByName: function (name) {
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
  ctx.apiGetBoard().board.columns.forEach(function (c) {
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
  const { ctx } = createTestContext({ 'product_backlog.csv': csv });
  const del = ctx.apiDeletePbi('PBI-007', '2026-09-05 10:00:00');
  assert.equal(del.ok, true, JSON.stringify(del));

  const res = ctx.apiRestorePbi(del.removed);
  assert.equal(res.ok, true, JSON.stringify(res));
  const card = findCardInBoard(res.board, 'PBI-007');
  assert.ok(card, 'PBI-007 が board に無い');
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
  const board1 = ctx.apiGetBoard().board;
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
