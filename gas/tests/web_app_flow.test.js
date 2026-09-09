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
function createTestContext(files) {
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
          setProperty: function (key, value) { props[key] = value; },
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
