# AI Scrum Web アプリ 第1段階 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 人が GAS の Web アプリからカンバンをドラッグして PBI の状態を変え、その結果を Drive の `product_backlog.csv` へ書き戻せるようにする。

**Architecture:** 判断を伴うロジック（CSV 生成、行のマージ、競合判定、書き込み先の検証）は GAS API 非依存の `pure_*.js` に置き、`node --test` で検証する。`gas_*.js` は Drive への読み書きだけの薄い層に保つ。Web アプリは HTML Service で作り、`google.script.run` でサーバ関数を呼ぶ。

**Tech Stack:** Google Apps Script (V8), HTML Service, clasp 3.x, Node.js の `node --test`（追加依存なし）

**Spec:** `docs/superpowers/specs/2026-09-04-web-app-design.md`

## Global Constraints

- 全てのコメント・ドキュメント・UI 文言は **日本語** で記述する
- 外部 npm 依存を追加しない。テストは Node 標準の `node:test` と `node:assert/strict` のみ使う
- **外部 CDN を読み込まない。** カンバンのドラッグは HTML5 のドラッグ&ドロップだけで実装する
- 純関数ファイル（`pure_*.js`）は末尾に `if (typeof module !== 'undefined') { module.exports = { ... } }` を付ける
- GAS ファイルは `const` / `let` と関数宣言のみ使う。`import` / `export` は使わない。例外は Node/GAS 相互運用ガードの `var` のみ
- **トップレベルの定数名を他の `gas/*.js` と衝突させない。** GAS は全ファイルが単一のグローバル字句スコープを共有し、衝突するとプロジェクト全体がロードに失敗する。`gas/tests/gas_load.test.js` がこれを検査する
- CSV の列順を変更しない。`product_backlog.csv` は `id,title,description,acceptance_criteria,priority,size,status,sprint,created_at,updated_at`
- **Drive への書き込みは `SCRUM_FOLDER_ID` 配下の `scrum/` 直下に限定する。** コード上で親フォルダを検証する
- テナント固有の値（スプレッドシート ID / スクリプト ID / Drive フォルダ ID / ドメイン名）をコミットしない
- **Web アプリの公開範囲は組織内に限定する**（`webapp.access` を `DOMAIN`）。実行者はアクセスしているユーザー自身（`executeAs` を `USER_ACCESSING`）
- 既存の81件のテストを壊さない

## 既存の資産（再利用する）

| 名前 | 場所 | 用途 |
|---|---|---|
| `parseCsv(text)` / `csvToObjects(text)` | `gas/pure_csv.js` | CSV の読み取り |
| `filterRealRows(rows)` | `gas/pure_filter.js` | ひな形行の除外 |
| `KANBAN_STATUSES` | `gas/pure_grid_board.js` | `['New', 'Ready', 'In Progress', 'Review', 'Done']` |
| `BACKLOG_FIELDS` | `gas/pure_grid_backlog.js` | CSV の列順 |
| `getScrumFolder()` / `readTextFile(folder, name)` | `gas/gas_drive.js` | Drive の読み取り |
| `syncAll()` | `gas/gas_sync.js` | ファイル → シートの再構築 |

---

### Task 1: CSV の書き出し

**Files:**
- Create: `gas/pure_csv_write.js`
- Test: `gas/tests/pure_csv_write.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `escapeCsvCell(value): string` — 必要なときだけ引用符で囲む
  - `toCsv(rows: Object[], fields: string[]): string` — 見出し行を含む CSV 文字列。行末は `\n`

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_csv_write.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { escapeCsvCell, toCsv } = require('../pure_csv_write.js');
const { csvToObjects } = require('../pure_csv.js');

test('特殊文字が無ければ引用しない', () => {
  assert.equal(escapeCsvCell('ログイン'), 'ログイン');
});

test('カンマを含む値を引用する', () => {
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
});

test('改行を含む値を引用する', () => {
  assert.equal(escapeCsvCell('a\nb'), '"a\nb"');
});

test('引用符を二重にして囲む', () => {
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
});

test('undefined と null は空文字にする', () => {
  assert.equal(escapeCsvCell(undefined), '');
  assert.equal(escapeCsvCell(null), '');
});

test('数値を文字列にする', () => {
  assert.equal(escapeCsvCell(5), '5');
});

test('見出し行と値の行を出す', () => {
  const rows = [{ id: 'PBI-001', title: 'ログイン' }];
  assert.equal(toCsv(rows, ['id', 'title']), 'id,title\nPBI-001,ログイン\n');
});

test('fields の順に列を並べる', () => {
  const rows = [{ b: '2', a: '1' }];
  assert.equal(toCsv(rows, ['a', 'b']), 'a,b\n1,2\n');
});

test('fields に無いキーを出さない', () => {
  const rows = [{ a: '1', extra: 'x' }];
  assert.equal(toCsv(rows, ['a']), 'a\n1\n');
});

test('行が無ければ見出し行だけ出す', () => {
  assert.equal(toCsv([], ['a', 'b']), 'a,b\n');
});

test('書き出して読み直すと同じ値になる', () => {
  const rows = [
    { id: 'PBI-001', title: 'a,b', note: 'say "hi"' },
    { id: 'PBI-002', title: '1\n2', note: '' },
  ];
  const fields = ['id', 'title', 'note'];
  assert.deepEqual(csvToObjects(toCsv(rows, fields)), rows);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_csv_write.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_csv_write.js`:

```javascript
/**
 * オブジェクト配列を CSV 文字列に直す。GAS API に依存しない純関数。
 * pure_csv.js の parseCsv と往復できることをテストで担保している。
 */

/** CSV の1セルを表す。カンマ・改行・引用符を含むときだけ引用符で囲む。 */
function escapeCsvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (s.indexOf(',') === -1 && s.indexOf('\n') === -1 && s.indexOf('"') === -1) {
    return s;
  }
  return '"' + s.split('"').join('""') + '"';
}

/** 見出し行を含む CSV 文字列を返す。列は fields の順に並べる。 */
function toCsv(rows, fields) {
  const lines = [fields.map(escapeCsvCell).join(',')];
  (rows || []).forEach(function (row) {
    lines.push(fields.map(function (f) { return escapeCsvCell(row[f]); }).join(','));
  });
  return lines.join('\n') + '\n';
}

if (typeof module !== 'undefined') { module.exports = { escapeCsvCell, toCsv }; }
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 既存81件 + 今回11件 = 92件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_csv_write.js gas/tests/pure_csv_write.test.js
git commit -m "feat: CSV の書き出しを追加する"
```

---

### Task 2: 行の更新と競合判定

**Files:**
- Create: `gas/pure_merge.js`
- Test: `gas/tests/pure_merge.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `applyRowUpdate(rows: Object[], id: string, changes: Object, expectedUpdatedAt: string, nowText: string): Object` — 戻り値は次のいずれか
    - 成功: `{ ok: true, rows: Object[] }`
    - 失敗: `{ ok: false, reason: 'not_found' | 'conflict', current: Object | null }`

**設計上の判断:** `nowText` を引数で受け取るのは、純関数から時刻を排除してテストを決定的にするためである。呼び出し側（GAS 層）が `Utilities.formatDate` の結果を渡す。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_merge.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyRowUpdate } = require('../pure_merge.js');

function rows() {
  return [
    { id: 'PBI-001', title: 'A', status: 'New', updated_at: '2026-09-01' },
    { id: 'PBI-002', title: 'B', status: 'Ready', updated_at: '2026-09-02' },
  ];
}

test('状態を書き換えて updated_at を更新する', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].status, 'Ready');
  assert.equal(r.rows[0].updated_at, '2026-09-04');
});

test('他の行に影響しない', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.deepEqual(r.rows[1], rows()[1]);
});

test('変更しない列を保つ', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].title, 'A');
});

test('元の配列を書き換えない', () => {
  const original = rows();
  applyRowUpdate(original, 'PBI-001', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(original[0].status, 'New');
});

test('行の順序を保つ', () => {
  const r = applyRowUpdate(rows(), 'PBI-002', { status: 'Done' }, '2026-09-02', '2026-09-04');
  assert.deepEqual(r.rows.map(function (x) { return x.id; }), ['PBI-001', 'PBI-002']);
});

test('id が無ければ not_found を返す', () => {
  const r = applyRowUpdate(rows(), 'PBI-999', { status: 'Ready' }, '2026-09-01', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_found');
  assert.equal(r.current, null);
});

test('updated_at が違えば conflict を返す', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready' }, '2026-08-31', '2026-09-04');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(r.current.status, 'New');
  assert.equal(r.current.updated_at, '2026-09-01');
});

test('conflict のとき元の配列を書き換えない', () => {
  const original = rows();
  applyRowUpdate(original, 'PBI-001', { status: 'Ready' }, '2026-08-31', '2026-09-04');
  assert.equal(original[0].status, 'New');
});

test('複数の列を同時に変えられる', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Done', size: '5' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].status, 'Done');
  assert.equal(r.rows[0].size, '5');
});

test('changes に updated_at があっても nowText で上書きする', () => {
  const r = applyRowUpdate(rows(), 'PBI-001', { status: 'Ready', updated_at: '1999-01-01' }, '2026-09-01', '2026-09-04');
  assert.equal(r.rows[0].updated_at, '2026-09-04');
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_merge.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_merge.js`:

```javascript
/**
 * 1行の更新を行集合へ適用する。GAS API に依存しない純関数。
 *
 * 競合の検出には CSV に既にある updated_at を使う。呼び出し側が画面を描いた
 * 時点の値を expectedUpdatedAt として渡し、その間に他の誰か（またはローカルの
 * Claude Code）が変更していれば拒否する。黙って上書きしないことが目的である。
 */

/**
 * rows の中の id を持つ行へ changes を適用した新しい配列を返す。
 * 成功: { ok: true, rows }
 * 失敗: { ok: false, reason: 'not_found' | 'conflict', current }
 */
function applyRowUpdate(rows, id, changes, expectedUpdatedAt, nowText) {
  const list = rows || [];
  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === String(id || '').trim()) { index = i; break; }
  }
  if (index === -1) return { ok: false, reason: 'not_found', current: null };

  const current = list[index];
  if (String(current.updated_at || '') !== String(expectedUpdatedAt || '')) {
    return { ok: false, reason: 'conflict', current: current };
  }

  // 元の配列は書き換えない。呼び出し側が失敗時に元の状態を保てるようにする。
  const next = list.map(function (row) {
    const copy = {};
    Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
    return copy;
  });
  Object.keys(changes || {}).forEach(function (k) { next[index][k] = changes[k]; });
  // updated_at は常にサーバ側の時刻で上書きする（クライアントの申告を信じない）
  next[index].updated_at = nowText;
  return { ok: true, rows: next };
}

if (typeof module !== 'undefined') { module.exports = { applyRowUpdate }; }
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計107件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_merge.js gas/tests/pure_merge.test.js
git commit -m "feat: 行の更新と競合判定を追加する"
```

---

### Task 3: カンバン用のデータ整形

**Files:**
- Create: `gas/pure_board_view.js`
- Test: `gas/tests/pure_board_view.test.js`

**Interfaces:**
- Consumes: `filterRealRows` (`gas/pure_filter.js`)、`KANBAN_STATUSES` (`gas/pure_grid_board.js`)
- Produces:
  - `buildBoardData(rows: Object[]): Object` — `{ columns: [{ status: string, cards: Object[] }] }`。カードは `{ id, title, priority, size, sprint, updated_at }`

**設計上の判断:** カンバン画面へ渡す形をここで作り、`web_app.js` は受け渡しだけにする。画面の形が変わってもテストで守れるようにするためである。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_board_view.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBoardData } = require('../pure_board_view.js');
const { KANBAN_STATUSES } = require('../pure_grid_board.js');

function pbi(id, title, status) {
  return {
    id: id, title: title, status: status, priority: 'High', size: '3',
    sprint: 'Sprint 001', created_at: '2026-08-14', updated_at: '2026-09-01',
    description: '説明', acceptance_criteria: 'A; B',
  };
}

test('5つの列を status の順に返す', () => {
  const d = buildBoardData([]);
  assert.deepEqual(d.columns.map(function (c) { return c.status; }), KANBAN_STATUSES);
});

test('PBI を該当する列に入れる', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', 'Ready')]);
  const ready = d.columns.filter(function (c) { return c.status === 'Ready'; })[0];
  assert.equal(ready.cards.length, 1);
  assert.equal(ready.cards[0].id, 'PBI-001');
});

test('カードに必要な項目だけを載せる', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', 'Ready')]);
  const card = d.columns.filter(function (c) { return c.status === 'Ready'; })[0].cards[0];
  assert.deepEqual(Object.keys(card).sort(),
    ['id', 'priority', 'size', 'sprint', 'title', 'updated_at'].sort());
});

test('未知のステータスを New に寄せる', () => {
  const d = buildBoardData([pbi('PBI-001', 'A', '謎')]);
  const nw = d.columns.filter(function (c) { return c.status === 'New'; })[0];
  assert.equal(nw.cards.length, 1);
});

test('ひな形行を除外する', () => {
  const tpl = { id: 'PBI-001', title: '（PBIタイトル）', status: 'New', created_at: 'YYYY-MM-DD' };
  assert.equal(buildBoardData([tpl]).columns.reduce(function (n, c) { return n + c.cards.length; }, 0), 0);
});

test('同じ列の中で元の順序を保つ', () => {
  const d = buildBoardData([pbi('PBI-002', 'B', 'Ready'), pbi('PBI-001', 'A', 'Ready')]);
  const ready = d.columns.filter(function (c) { return c.status === 'Ready'; })[0];
  assert.deepEqual(ready.cards.map(function (x) { return x.id; }), ['PBI-002', 'PBI-001']);
});

test('行が無ければ空の列を5つ返す', () => {
  const d = buildBoardData([]);
  assert.equal(d.columns.length, 5);
  d.columns.forEach(function (c) { assert.deepEqual(c.cards, []); });
});

test('null を渡しても壊れない', () => {
  assert.equal(buildBoardData(null).columns.length, 5);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_board_view.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_board_view.js`:

```javascript
/**
 * カンバン画面へ渡すデータを組み立てる。GAS API に依存しない純関数。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
  var { KANBAN_STATUSES } = require('./pure_grid_board.js');
}

const BOARD_CARD_FIELDS = ['id', 'title', 'priority', 'size', 'sprint', 'updated_at'];

/** カンバン用に { columns: [{ status, cards }] } を返す。 */
function buildBoardData(rows) {
  const columns = KANBAN_STATUSES.map(function (s) { return { status: s, cards: [] }; });
  filterRealRows(rows || []).forEach(function (row) {
    const s = String(row.status || '').trim();
    const idx = KANBAN_STATUSES.indexOf(s) === -1 ? 0 : KANBAN_STATUSES.indexOf(s);
    const card = {};
    BOARD_CARD_FIELDS.forEach(function (f) { card[f] = String(row[f] === undefined ? '' : row[f]); });
    columns[idx].cards.push(card);
  });
  return { columns: columns };
}

if (typeof module !== 'undefined') {
  module.exports = { BOARD_CARD_FIELDS, buildBoardData };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計115件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_board_view.js gas/tests/pure_board_view.test.js
git commit -m "feat: カンバン用のデータ整形を追加する"
```

---

### Task 4: 書き込み先の検証

**Files:**
- Create: `gas/pure_write_guard.js`
- Test: `gas/tests/pure_write_guard.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `WRITABLE_FILES: string[]` — 書き込みを許すファイル名
  - `assertWritableFileName(name: string): void` — 許さない名前なら例外を投げる

**設計上の判断:** Drive の権限を `drive`（読み書き）へ広げるため、コード側で書き込み先を絞る。許可リスト方式にして、増やすときは明示的に足させる。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_write_guard.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { WRITABLE_FILES, assertWritableFileName } = require('../pure_write_guard.js');

test('許可リストに product_backlog.csv がある', () => {
  assert.ok(WRITABLE_FILES.indexOf('product_backlog.csv') !== -1);
});

test('許可されたファイル名は通る', () => {
  assert.doesNotThrow(function () { assertWritableFileName('product_backlog.csv'); });
});

test('許可されていないファイル名は拒否する', () => {
  assert.throws(function () { assertWritableFileName('velocity.csv'); }, /書き込みが許可されていません/);
});

test('パス区切りを含む名前を拒否する', () => {
  assert.throws(function () { assertWritableFileName('sub/product_backlog.csv'); });
  assert.throws(function () { assertWritableFileName('sub\\product_backlog.csv'); });
});

test('親ディレクトリへの参照を拒否する', () => {
  assert.throws(function () { assertWritableFileName('../product_backlog.csv'); });
});

test('空の名前を拒否する', () => {
  assert.throws(function () { assertWritableFileName(''); });
  assert.throws(function () { assertWritableFileName(null); });
  assert.throws(function () { assertWritableFileName(undefined); });
});

test('前後の空白がある名前を拒否する', () => {
  assert.throws(function () { assertWritableFileName(' product_backlog.csv'); });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_write_guard.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_write_guard.js`:

```javascript
/**
 * Drive への書き込み先を絞る。GAS API に依存しない純関数。
 *
 * oauthScopes を drive.readonly から drive（読み書き）へ広げるため、
 * コード側で書き込めるファイルを許可リストで限定する。増やすときは
 * 明示的にこの配列へ足すこと。
 */

const WRITABLE_FILES = ['product_backlog.csv'];

/** 書き込みを許さない名前なら例外を投げる。scrum/ 直下のファイル名のみ許す。 */
function assertWritableFileName(name) {
  const n = name === undefined || name === null ? '' : String(name);
  if (n !== n.trim() || n === '') {
    throw new Error('ファイル名が不正です: ' + JSON.stringify(name));
  }
  if (n.indexOf('/') !== -1 || n.indexOf('\\') !== -1 || n.indexOf('..') !== -1) {
    throw new Error('ファイル名にパスを含められません: ' + n);
  }
  if (WRITABLE_FILES.indexOf(n) === -1) {
    throw new Error(n + ' への書き込みが許可されていません。');
  }
}

if (typeof module !== 'undefined') {
  module.exports = { WRITABLE_FILES, assertWritableFileName };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計124件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_write_guard.js gas/tests/pure_write_guard.test.js
git commit -m "feat: Drive への書き込み先を許可リストで限定する"
```

---

### Task 5: Drive への書き込み層とマニフェスト

**Files:**
- Create: `gas/gas_drive_write.js`
- Modify: `gas/appsscript.json`

**Interfaces:**
- Consumes: `getScrumFolder()` (`gas/gas_drive.js`)、`assertWritableFileName(name)` (`gas/pure_write_guard.js`)
- Produces:
  - `writeScrumFile(name: string, content: string): void` — `scrum/` 直下のファイルを書き換える。存在しなければ例外

**このタスクに自動テストはありません。** `DriveApp` に依存するため `node --test` では検証できない。`node --check` による構文検査と、Task 9 の実環境確認で担保する。

- [ ] **Step 1: `gas_drive_write.js` を書く**

```javascript
/**
 * Drive のファイルを書き換える。scrum/ 直下の許可されたファイルだけを対象にする。
 *
 * oauthScopes は drive（読み書き）だが、書き込み先はここで
 * assertWritableFileName により限定している。範囲を広げるときは
 * pure_write_guard.js の WRITABLE_FILES を明示的に増やすこと。
 */

/** scrum/ 直下のファイルを上書きする。無ければ例外を投げる。 */
function writeScrumFile(name, content) {
  assertWritableFileName(name);
  const scrum = getScrumFolder();
  const it = scrum.getFilesByName(name);
  if (!it.hasNext()) {
    throw new Error('scrum/' + name + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  const file = it.next();
  if (it.hasNext()) {
    throw new Error('scrum/' + name + ' が複数あります。Drive の競合コピーを解消してください。');
  }
  file.setContent(content);
}
```

- [ ] **Step 2: `appsscript.json` を書き換える**

`oauthScopes` の `drive.readonly` を `drive` に変え、`webapp` の設定を足す。

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "webapp": {
    "executeAs": "USER_ACCESSING",
    "access": "DOMAIN"
  },
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.container.ui"
  ]
}
```

**`access` を `DOMAIN` にする理由:** Web アプリは Drive の CSV を書き換えられるため、URL を知っていれば誰でも触れる `ANYONE` にはしない。組織内に限定する。

**`executeAs` を `USER_ACCESSING` にする理由:** 誰が変更したかを `Session.getActiveUser()` で取れるようにする。第4段階の変更履歴で使う。副作用として、各利用者が自分の権限で承認することになる。

**個人の Google アカウント（Workspace ではない）では `DOMAIN` を選べない。** その場合 `clasp push` かデプロイ時にエラーになる。検証用に個人アカウントを使うときは、一時的に `MYSELF` へ変えること（コミットはしない）。Task 8 でこの点をドキュメントに残す。

- [ ] **Step 3: 構文と JSON を確認する**

Run: `node --check gas/gas_drive_write.js && node -e "JSON.parse(require('fs').readFileSync('gas/appsscript.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 4: 定数名の衝突が無いことを確認する**

Run: `npm test`
Expected: PASS — 累計124件（`gas_load.test.js` が単一グローバルスコープでの衝突を検査する）

- [ ] **Step 5: コミット**

```bash
git add gas/gas_drive_write.js gas/appsscript.json
git commit -m "feat: Drive への書き込み層と Web アプリのマニフェストを追加する"
```

---

### Task 6: Web アプリのサーバ側

**Files:**
- Create: `gas/web_app.js`

**Interfaces:**
- Consumes: `getScrumFolder()` / `readTextFile()` (`gas/gas_drive.js`)、`writeScrumFile()` (`gas/gas_drive_write.js`)、`csvToObjects()` (`gas/pure_csv.js`)、`toCsv()` (`gas/pure_csv_write.js`)、`applyRowUpdate()` (`gas/pure_merge.js`)、`buildBoardData()` (`gas/pure_board_view.js`)、`BACKLOG_FIELDS` (`gas/pure_grid_backlog.js`)、`nowText()` (`gas/gas_sync.js`)
- Produces:
  - `doGet(e): HtmlOutput` — Web アプリの入口
  - `apiGetBoard(): Object` — `{ ok: true, board }` または `{ ok: false, message }`
  - `apiUpdateStatus(id, newStatus, expectedUpdatedAt): Object` — `{ ok: true, board }` または `{ ok: false, reason, message, board }`

**このタスクに自動テストはありません。** GAS API に依存する。`node --check` と Task 9 の実環境確認で担保する。

- [ ] **Step 1: `web_app.js` を書く**

```javascript
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

/** scrum/product_backlog.csv を読んでオブジェクト配列にする。 */
function readBacklogRows() {
  const text = readTextFile(getScrumFolder(), BACKLOG_CSV_NAME);
  if (text === null) {
    throw new Error('scrum/' + BACKLOG_CSV_NAME + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  return csvToObjects(text);
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
    const rows = readBacklogRows();
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
```

- [ ] **Step 2: 構文を確認する**

Run: `node --check gas/web_app.js`
Expected: 出力なし（終了コード 0）

- [ ] **Step 3: 参照する名前がすべて実在することを確認する**

Run:
```bash
for n in getScrumFolder readTextFile writeScrumFile csvToObjects toCsv applyRowUpdate buildBoardData BACKLOG_FIELDS nowText KANBAN_STATUSES; do
  grep -qE "(function ${n}\(|const ${n} =)" gas/*.js || echo "未定義: $n"
done; echo "確認完了"
```
Expected: `確認完了` のみ（`未定義:` が出ないこと）

- [ ] **Step 4: 定数名の衝突が無いことを確認する**

Run: `npm test`
Expected: PASS — 累計124件

- [ ] **Step 5: コミット**

```bash
git add gas/web_app.js
git commit -m "feat: Web アプリのサーバ側を追加する"
```

---

### Task 7: カンバン画面

**Files:**
- Create: `gas/kanban.html`

**Interfaces:**
- Consumes: `apiGetBoard()` / `apiUpdateStatus()`（`google.script.run` 経由）
- Produces: なし

**このタスクに自動テストはありません。** ブラウザで動く画面のため、Task 9 の実環境確認で担保する。

- [ ] **Step 1: `kanban.html` を書く**

外部 CDN を読み込まず、HTML5 のドラッグ&ドロップだけで実装する。

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<base target="_top">
<meta charset="utf-8">
<style>
  :root {
    --line: #dadce0; --ink: #202124; --ink-2: #5f6368;
    --accent: #1a73e8; --bg: #f8f9fa; --card: #ffffff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--ink);
    font-family: "Helvetica Neue", Arial, "Hiragino Sans", "Noto Sans JP", sans-serif;
  }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; }
  button {
    font: inherit; padding: 6px 12px; border: 1px solid var(--line);
    background: var(--card); border-radius: 4px; cursor: pointer;
  }
  button:hover { background: var(--bg); }
  #message { min-height: 20px; margin-bottom: 12px; font-size: 13px; }
  #message.error { color: #c5221f; }
  #message.info { color: var(--ink-2); }
  #board { display: flex; gap: 12px; align-items: flex-start; overflow-x: auto; }
  .column {
    flex: 1 0 200px; background: var(--card); border: 1px solid var(--line);
    border-radius: 8px; padding: 8px; min-height: 120px;
  }
  .column.over { border-color: var(--accent); background: #e8f0fe; }
  .column h2 { font-size: 13px; margin: 0 0 8px; color: var(--ink-2); }
  .count { font-weight: normal; }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 6px;
    padding: 8px; margin-bottom: 8px; cursor: grab; font-size: 13px;
  }
  .card:active { cursor: grabbing; }
  .card.dragging { opacity: 0.4; }
  .card .id { color: var(--ink-2); font-size: 11px; }
  .card .title { margin: 2px 0 4px; }
  .card .meta { color: var(--ink-2); font-size: 11px; }
  .empty { color: var(--ink-2); font-size: 12px; padding: 8px 0; }
</style>
</head>
<body>
<header>
  <h1>AI Scrum ボード</h1>
  <button id="reload" type="button">最新にする</button>
</header>
<div id="message" class="info">読み込んでいます…</div>
<div id="board"></div>

<script>
var dragging = null;

function setMessage(text, kind) {
  var el = document.getElementById('message');
  el.textContent = text;
  el.className = kind || 'info';
}

function render(board) {
  var root = document.getElementById('board');
  root.innerHTML = '';
  board.columns.forEach(function (col) {
    var div = document.createElement('div');
    div.className = 'column';
    div.dataset.status = col.status;

    var h = document.createElement('h2');
    h.textContent = col.status + ' ';
    var c = document.createElement('span');
    c.className = 'count';
    c.textContent = '(' + col.cards.length + ')';
    h.appendChild(c);
    div.appendChild(h);

    if (col.cards.length === 0) {
      var e = document.createElement('div');
      e.className = 'empty';
      e.textContent = 'なし';
      div.appendChild(e);
    }

    col.cards.forEach(function (card) { div.appendChild(renderCard(card)); });

    div.addEventListener('dragover', function (ev) {
      ev.preventDefault();
      div.classList.add('over');
    });
    div.addEventListener('dragleave', function () { div.classList.remove('over'); });
    div.addEventListener('drop', function (ev) {
      ev.preventDefault();
      div.classList.remove('over');
      if (dragging && dragging.status !== col.status) {
        move(dragging.id, col.status, dragging.updatedAt);
      }
    });

    root.appendChild(div);
  });
}

function renderCard(card) {
  var el = document.createElement('div');
  el.className = 'card';
  el.draggable = true;

  var id = document.createElement('div');
  id.className = 'id';
  id.textContent = card.id;
  el.appendChild(id);

  var t = document.createElement('div');
  t.className = 'title';
  t.textContent = card.title;
  el.appendChild(t);

  var m = document.createElement('div');
  m.className = 'meta';
  var parts = [];
  if (card.priority) parts.push(card.priority);
  if (card.size) parts.push(card.size + ' pt');
  if (card.sprint) parts.push(card.sprint);
  m.textContent = parts.join(' · ');
  el.appendChild(m);

  el.addEventListener('dragstart', function () {
    dragging = {
      id: card.id,
      status: el.parentNode.dataset.status,
      updatedAt: card.updated_at
    };
    el.classList.add('dragging');
  });
  el.addEventListener('dragend', function () {
    dragging = null;
    el.classList.remove('dragging');
  });
  return el;
}

function load() {
  setMessage('読み込んでいます…', 'info');
  google.script.run
    .withSuccessHandler(function (res) {
      if (res.ok) { render(res.board); setMessage('', 'info'); }
      else { setMessage(res.message, 'error'); }
    })
    .withFailureHandler(function (err) { setMessage('読み込みに失敗しました: ' + err.message, 'error'); })
    .apiGetBoard();
}

function move(id, newStatus, expectedUpdatedAt) {
  setMessage(id + ' を ' + newStatus + ' に移しています…', 'info');
  google.script.run
    .withSuccessHandler(function (res) {
      if (res.ok) {
        render(res.board);
        setMessage(id + ' を ' + newStatus + ' に移しました。', 'info');
      } else {
        if (res.board) { render(res.board); }
        setMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) { setMessage('更新に失敗しました: ' + err.message, 'error'); })
    .apiUpdateStatus(id, newStatus, expectedUpdatedAt);
}

document.getElementById('reload').addEventListener('click', load);
load();
</script>
</body>
</html>
```

- [ ] **Step 2: HTML が壊れていないことを確認する**

Run:
```bash
node -e "
const s = require('fs').readFileSync('gas/kanban.html','utf8');
const open = (s.match(/<div/g) || []).length, close = (s.match(/<\/div>/g) || []).length;
if (open !== close) { console.error('div の開閉が不一致: ' + open + ' vs ' + close); process.exit(1); }
['apiGetBoard', 'apiUpdateStatus', 'dragstart', 'drop'].forEach(function (k) {
  if (s.indexOf(k) === -1) { console.error('必要な記述がない: ' + k); process.exit(1); }
});
console.log('HTML OK');
"
```
Expected: `HTML OK`

- [ ] **Step 3: 外部 CDN を読み込んでいないことを確認する**

Run: `grep -cE "https?://" gas/kanban.html`
Expected: `0`

- [ ] **Step 4: コミット**

```bash
git add gas/kanban.html
git commit -m "feat: カンバン画面を追加する"
```

---

### Task 8: セットアップとドキュメント

**Files:**
- Modify: `scripts/setup.js`
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: `setup.js` に Web アプリのデプロイを足す**

`clasp push` の後に、Web アプリとしてデプロイする処理を足す。`clasp create-deployment` を使う。

デプロイに失敗しても致命的ではない（管理者が Apps Script の画面から手動でデプロイできる）ため、失敗しても止めず、手動手順を案内すること。

完了メッセージに、Web アプリの URL を確認する方法（Apps Script の画面 →「デプロイ」→「デプロイを管理」）を足すこと。

`.clasp.json` を退避・復元する既存の仕組み（`clasp create` がマニフェストを上書きする対策）を壊さないこと。

- [ ] **Step 2: `README.md` を更新する**

読者は**普段 Claude を使わない非エンジニア**である。次を守ること。

- 「スプレッドシートを開く」ではなく「**Web アプリを開く**」が基本の導線になる
- スプレッドシートは DB であり、直接触らないことを書く
- カンバンでカードをドラッグすると状態が変わり、その結果がファイルにも反映されることを書く
- 他の人が先に変更していた場合に「他の変更が先に入っています」と出ることと、そのときは画面が最新になるので操作をやり直せばよいことを書く
- 初回に承認画面が出ること、**今回から Drive への書き込み権限も求められる**ことを、驚かせない書き方で説明する

- [ ] **Step 3: `docs/setup.md` を更新する**

読者は管理者である。次を足すこと。

- Web アプリのデプロイ手順（`setup.js` が自動で行う場合と、手動で行う場合の両方）
- Web アプリの URL をメンバーに共有すること
- **`oauthScopes` が `drive.readonly` から `drive` に変わった**こと。理由（CSV への書き戻しに必要）と、書き込み先が `scrum/product_backlog.csv` に限定されていること（`pure_write_guard.js` の許可リスト）
- 既存のテナントで更新する場合、スコープが変わるため**利用者に再承認が求められる**こと
- **Web アプリの公開範囲が組織内（`DOMAIN`）であること。** URL を知っていれば誰でも触れる設定にはしていない
- **個人の Google アカウントでは `DOMAIN` を選べない**ため、その環境ではデプロイ時にエラーになること。検証目的なら一時的に `MYSELF` へ変える

- [ ] **Step 4: `CLAUDE.md` を更新する**

- 人は Web アプリを見る。スプレッドシートは DB であり直接触らない
- ローカルの Claude Code は従来どおり `scrum/` のファイルを読み書きする
- Web アプリからの変更も同じファイルに入るため、エージェントは何もしなくても人の操作結果を見られる

- [ ] **Step 5: 検証する**

Run:
```bash
node --check scripts/setup.js
npm test 2>&1 | grep -E "^# (tests|pass|fail)"
grep -c "drive.readonly" docs/setup.md README.md 2>/dev/null || echo "旧スコープの記述なし"
```
Expected: 構文 OK、124件 PASS、旧スコープの記述が残っていないこと

- [ ] **Step 6: コミット**

```bash
git add scripts/setup.js README.md docs/setup.md CLAUDE.md
git commit -m "docs: Web アプリの導線と Drive 書き込み権限の変更を反映する"
```

---

### Task 9: 実環境での確認

**Files:**
- Modify: なし（検証のみ）

**Interfaces:**
- Consumes: Task 1〜8 の全成果
- Produces: なし

- [ ] **Step 1: 全テストと構文検査を通す**

```bash
npm test
for f in gas/*.js scripts/*.js; do node --check "$f" || echo "NG: $f"; done
```
Expected: 124件 PASS、`NG:` の出力なし

- [ ] **Step 2: テナント固有の値が含まれていないことを確認する**

```bash
git ls-files | grep -vE "^docs/superpowers/" | xargs grep -lE "docs\.google\.com/spreadsheets/d/|AKfyc|script\.google\.com/macros" 2>/dev/null || echo "なし"
git ls-files | grep -E "\.clasp\.json$|\.clasprc" || echo "clasp 認証ファイルなし"
```
Expected: `なし` と `clasp 認証ファイルなし`

- [ ] **Step 3: 検証用のテナントで一から作る**

```bash
node scripts/setup.js "AI Scrum Web 検証"
node scripts/publish.js "<Drive共有フォルダのパス>"
```

**このタスクは実リソースを作る。** 検証後に削除すること。

- [ ] **Step 4: スコープが意図どおりか確認する**

Apps Script の画面で、要求されるスコープが次の4つであることを確認する。

- `spreadsheets.currentonly`
- `drive`（**読み書き**。今回広げたもの）
- `script.scriptapp`
- `script.container.ui`

- [ ] **Step 5: Web アプリを開いて動作を確認する**

1. Web アプリの URL を開く
2. 承認ダイアログを許可する
3. カンバンに5列（New / Ready / In Progress / Review / Done）が出る
4. `scrum/product_backlog.csv` がひな形のままなら、カードは0枚で各列に「なし」と出る

- [ ] **Step 6: 実データで書き戻しを確認する**

`scrum/product_backlog.csv` に実際の PBI を入れ、`publish.js` で配布してから次を確認する。

1. カードが表示される
2. カードを別の列へドラッグすると、その列へ移る
3. **`scrum/product_backlog.csv` の該当行の `status` が変わっている**
4. **`updated_at` が更新されている**
5. 他の行が変わっていない
6. スプレッドシートのカンバンシートも、次の同期後に一致する

- [ ] **Step 7: 競合の検出を確認する**

1. Web アプリを2つのタブで開く
2. 一方でカードを動かす
3. **もう一方（古い状態を持っている）で同じカードを動かす**
4. 「他の変更が先に入っています」と表示され、画面が最新になること
5. `product_backlog.csv` が壊れていないこと

- [ ] **Step 8: 書き込み先の限定を確認する**

Apps Script のエディタから次を実行し、例外になることを確認する。

```javascript
function testWriteGuard() {
  try {
    writeScrumFile('velocity.csv', 'x');
    Logger.log('★ 拒否されなかった（問題）');
  } catch (e) {
    Logger.log('正しく拒否: ' + e.message);
  }
}
```
Expected: `正しく拒否: velocity.csv への書き込みが許可されていません。`

- [ ] **Step 9: 公開範囲を確認する**

Apps Script の「デプロイを管理」で、Web アプリの設定が次であることを確認する。

- 次のユーザーとして実行: **アクセスしているユーザー**
- アクセスできるユーザー: **同じ組織内のユーザー**（個人アカウントで検証している場合は「自分のみ」）

`全員` になっていないことを必ず確かめる。Web アプリは Drive の CSV を書き換えられるため。

- [ ] **Step 10: 検証用リソースを削除する**

作成したスプレッドシート、Apps Script プロジェクト、Drive フォルダを削除する。

- [ ] **Step 11: 結果を報告する**

Step 4〜9 の各項目について、確認できたか・できなかったかを報告する。動かない項目があれば修正し、Step 1 からやり直す。
