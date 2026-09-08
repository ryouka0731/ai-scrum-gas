# Web アプリ第2段階（PBI の作成・編集・削除 + UI 刷新）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 人がスプレッドシートを開かずに、Web アプリだけで PBI を作成・編集・削除できるようにする。

**Architecture:** 判断ロジックは `pure_*.js`（GAS API 非依存・node でテスト可能）に置き、`web_app.js` は
ロック取得・読み直し・ヘッダー検査・書き戻しの薄い層に留める。UI はボードと右スライドの詳細パネルの
2層構成で、作成と編集は同じパネルを使い回す。

**Tech Stack:** Google Apps Script (V8), HTML Service, 素の JavaScript（ES5 相当の書き方）, `node --test`

**Spec:** `docs/superpowers/specs/2026-09-08-web-app-phase2-design.md`

## Global Constraints

- **GAS は全 `.js` を単一のグローバル字句スコープで評価する。** トップレベルの `const` を2ファイルで
  同名宣言するとプロジェクト全体がロードに失敗する。`gas/tests/gas_load.test.js` が検出する。
- **既存の `const`（`BACKLOG_FIELDS` / `KANBAN_STATUSES` / `BOARD_CARD_FIELDS` など）を
  `var { X } = require(...)` で受けてはならない。** `var` 再宣言が `const` と衝突する。
  新しい純関数は、必要な定数を**引数で受け取る**（既存の `toCsv(rows, fields)` /
  `assertHeaderMatches(text, fields)` と同じ形）。
- **`google.script.run` はプロジェクト内の全グローバル関数をブラウザへ公開する。** 末尾 `_` の関数だけが
  呼べない。新しく足す GAS 層の内部関数には必ず `_` を付ける。公開してよいのは
  `doGet` / `apiGetBoard` / `apiUpdateStatus` / `apiCreatePbi` / `apiUpdatePbi` / `apiDeletePbi` /
  `onOpen` / `menuSyncNow` / `menuConfigure` / `menuInstallTrigger` / `menuRemoveTrigger` /
  `scheduledSync` のみ。純関数層（副作用なし）は対象外。
- **`function f(){}` を `const f = function(){}` に書き換えない。** トップレベル `const` はグローバル
  解決に乗らず、名前で呼ばれる関数（`doGet` / `api*` / `menu*` / `scheduledSync`）が動かなくなる。
- **書き戻しの直前に必ず読み直し、`assertHeaderMatches(text, BACKLOG_FIELDS)` を通す。**
  CSV はローカルの Claude Code と共同所有で、将来列が増えうる。
- **外部 CDN を読み込まない。** アイコンはインライン SVG を自前で持つ。
- **`innerHTML` にユーザー由来の文字列を入れない。** テキストは `textContent`、要素は
  `createElement` / `createElementNS` で組み立てる。
- ドキュメントとコメントは日本語。簡潔に、短く。
- テストは `node --test "gas/tests/*.test.js"`（**クォート必須**。外すと Node 22 で MODULE_NOT_FOUND）。
- 着手時点で 142 件 PASS。

## File Structure

| ファイル | 責務 |
|---|---|
| `gas/pure_pbi_id.js`（新規） | 既存の行から次の PBI ID を決める |
| `gas/pure_pbi_validate.js`（新規） | 入力項目の検証。優先度の語彙を持つ |
| `gas/pure_merge.js`（変更） | 行集合への追加・削除を足す（既存の更新・競合判定に隣接するため同居させる） |
| `gas/web_app.js`（変更） | 作成・編集・削除の API。ロック内の共通手順を1つにまとめる |
| `gas/kanban.html`（変更） | デザイントークン、アイコン、詳細パネル、フォーム |
| `gas/tests/pure_pbi_id.test.js`（新規） | ID 採番 |
| `gas/tests/pure_pbi_validate.test.js`（新規） | 入力検証 |
| `gas/tests/pure_merge.test.js`（変更） | 追加・削除 |
| `gas/tests/kanban_flow.test.js`（新規） | DOM シムで応答の到達順を検査 |

---

### Task 1: PBI ID の採番

**Files:**
- Create: `gas/pure_pbi_id.js`
- Test: `gas/tests/pure_pbi_id.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `nextPbiId(rows)` → `string`（例 `'PBI-011'`）。`rows` は `{id: string}` を持つ配列。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_pbi_id.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextPbiId } = require('../pure_pbi_id.js');

test('空の行集合では PBI-001 になる', () => {
  assert.equal(nextPbiId([]), 'PBI-001');
  assert.equal(nextPbiId(null), 'PBI-001');
});

test('既存の最大値 + 1 になる', () => {
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-010' }, { id: 'PBI-003' }];
  assert.equal(nextPbiId(rows), 'PBI-011');
});

test('欠番があっても最大値 + 1 で、埋め戻さない', () => {
  // 欠番を埋めると、削除された PBI の ID が別物に再利用される。
  // ローカルの Claude Code が残した参照が別の PBI を指すようになる。
  const rows = [{ id: 'PBI-001' }, { id: 'PBI-005' }];
  assert.equal(nextPbiId(rows), 'PBI-006');
});

test('PBI 形式でない id は無視する', () => {
  const rows = [{ id: 'PBI-002' }, { id: '' }, { id: 'メモ' }, { id: 'PBI-abc' }, {}];
  assert.equal(nextPbiId(rows), 'PBI-003');
});

test('桁が繰り上がったらゼロ埋めせずに伸ばす', () => {
  assert.equal(nextPbiId([{ id: 'PBI-999' }]), 'PBI-1000');
});

test('4桁の id があればその桁数を保つ', () => {
  assert.equal(nextPbiId([{ id: 'PBI-1200' }]), 'PBI-1201');
});

test('前後に空白がある id も読む', () => {
  assert.equal(nextPbiId([{ id: '  PBI-007  ' }]), 'PBI-008');
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_pbi_id.test.js"`
Expected: FAIL（`Cannot find module '../pure_pbi_id.js'`）

- [ ] **Step 3: 実装する**

`gas/pure_pbi_id.js`:

```javascript
/**
 * PBI ID の採番。GAS API に依存しない純関数。
 *
 * 欠番は埋めない。埋めると削除された PBI の ID が別物に再利用され、
 * ローカルの Claude Code が残した参照が別の PBI を指すようになる。
 */

const PBI_ID_NUM_RE = /^PBI-(\d+)$/;

/** 既存の行集合から次の PBI ID を返す。 */
function nextPbiId(rows) {
  let max = 0;
  let width = 3;
  (rows || []).forEach(function (row) {
    const m = PBI_ID_NUM_RE.exec(String((row || {}).id || '').trim());
    if (!m) return;
    const n = parseInt(m[1], 10);
    if (n > max) { max = n; width = m[1].length; }
  });
  const s = String(max + 1);
  let padded = s;
  while (padded.length < width) padded = '0' + padded;
  return 'PBI-' + padded;
}

if (typeof module !== 'undefined') { module.exports = { nextPbiId }; }
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（142 + 7 = 149 件）

- [ ] **Step 5: コミット**

```bash
git add gas/pure_pbi_id.js gas/tests/pure_pbi_id.test.js
git commit -m "feat: PBI ID の採番を純関数として足す"
```

---

### Task 2: 入力項目の検証

**Files:**
- Create: `gas/pure_pbi_validate.js`
- Test: `gas/tests/pure_pbi_validate.test.js`

**Interfaces:**
- Consumes: なし（`statuses` は引数で受け取る）
- Produces:
  - `PBI_PRIORITIES` = `['Critical', 'High', 'Medium', 'Low']`
  - `validatePbiFields(fields, statuses)` → `{ ok: boolean, errors: string[] }`
  - `PBI_EDITABLE_FIELDS` = `['title', 'description', 'acceptance_criteria', 'priority', 'size', 'sprint', 'status']`

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_pbi_validate.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePbiFields, PBI_PRIORITIES, PBI_EDITABLE_FIELDS } = require('../pure_pbi_validate.js');

const STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];

test('正しい入力は通る', () => {
  const r = validatePbiFields(
    { title: 'カンバンを作る', priority: 'High', size: '5', status: 'Ready' }, STATUSES);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('タイトルが空なら拒否する', () => {
  assert.equal(validatePbiFields({ title: '' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({ title: '   ' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({}, STATUSES).ok, false);
});

test('未知の優先度を拒否する', () => {
  const r = validatePbiFields({ title: 'a', priority: 'Urgent' }, STATUSES);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(m => m.indexOf('優先度') !== -1));
});

test('未知のステータスを拒否する', () => {
  const r = validatePbiFields({ title: 'a', status: 'Blocked' }, STATUSES);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(m => m.indexOf('ステータス') !== -1));
});

test('サイズは空でもよいが、数値以外は拒否する', () => {
  assert.equal(validatePbiFields({ title: 'a', size: '' }, STATUSES).ok, true);
  assert.equal(validatePbiFields({ title: 'a', size: '0' }, STATUSES).ok, true);
  assert.equal(validatePbiFields({ title: 'a', size: '13' }, STATUSES).ok, true);
  assert.equal(validatePbiFields({ title: 'a', size: 'おおきい' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({ title: 'a', size: '-1' }, STATUSES).ok, false);
  assert.equal(validatePbiFields({ title: 'a', size: '1.5' }, STATUSES).ok, false);
});

test('指定しなかった項目は検証しない（部分更新のため）', () => {
  const r = validatePbiFields({ title: 'a' }, STATUSES);
  assert.equal(r.ok, true);
});

test('誤りが複数あれば全部返す', () => {
  const r = validatePbiFields({ title: '', priority: 'X', status: 'Y' }, STATUSES);
  assert.equal(r.errors.length, 3);
});

test('編集できる項目に id / created_at / updated_at を含めない', () => {
  // これらを書き換えさせると、競合判定と採番の前提が崩れる。
  ['id', 'created_at', 'updated_at'].forEach(f => {
    assert.equal(PBI_EDITABLE_FIELDS.indexOf(f), -1, f + ' が編集可能になっている');
  });
});

test('優先度の語彙が4つある', () => {
  assert.deepEqual(PBI_PRIORITIES, ['Critical', 'High', 'Medium', 'Low']);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_pbi_validate.test.js"`
Expected: FAIL（`Cannot find module '../pure_pbi_validate.js'`）

- [ ] **Step 3: 実装する**

`gas/pure_pbi_validate.js`:

```javascript
/**
 * PBI の入力検証。GAS API に依存しない純関数。
 *
 * ステータスの語彙は引数で受け取る。KANBAN_STATUSES はトップレベルの const なので、
 * var で受けると GAS の単一グローバルスコープで衝突しプロジェクト全体が起動しない。
 */

const PBI_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];

// id / created_at / updated_at は含めない。書き換えさせると競合判定と採番の前提が崩れる。
const PBI_EDITABLE_FIELDS = [
  'title', 'description', 'acceptance_criteria', 'priority', 'size', 'sprint', 'status',
];

const PBI_SIZE_RE = /^\d+$/;

/**
 * 入力を検証する。指定されなかった項目は検証しない（部分更新に使うため）。
 * 誤りは全部返す。1つずつ直させると往復が増える。
 */
function validatePbiFields(fields, statuses) {
  const f = fields || {};
  const errors = [];

  const title = String(f.title === undefined || f.title === null ? '' : f.title).trim();
  if (!title) errors.push('タイトルを入力してください。');

  if (f.priority !== undefined && PBI_PRIORITIES.indexOf(String(f.priority)) === -1) {
    errors.push('優先度が不正です: ' + f.priority);
  }
  if (f.status !== undefined && (statuses || []).indexOf(String(f.status)) === -1) {
    errors.push('ステータスが不正です: ' + f.status);
  }
  const size = String(f.size === undefined || f.size === null ? '' : f.size).trim();
  if (f.size !== undefined && size !== '' && !PBI_SIZE_RE.test(size)) {
    errors.push('サイズは0以上の整数で入力してください。');
  }

  return { ok: errors.length === 0, errors: errors };
}

if (typeof module !== 'undefined') {
  module.exports = { PBI_PRIORITIES, PBI_EDITABLE_FIELDS, validatePbiFields };
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（149 + 9 = 158 件）

- [ ] **Step 5: コミット**

```bash
git add gas/pure_pbi_validate.js gas/tests/pure_pbi_validate.test.js
git commit -m "feat: PBI の入力検証を純関数として足す"
```

---

### Task 3: 行の追加と削除

**Files:**
- Modify: `gas/pure_merge.js`（末尾の `module.exports` の直前に追加）
- Test: `gas/tests/pure_merge.test.js`（末尾に追加）

**Interfaces:**
- Consumes: `gas/pure_merge.js` 内の既存 `applyRowUpdate(rows, id, changes, expectedUpdatedAt, nowText)`
- Produces:
  - `appendRow(rows, id, fields, allFields, nowText)` → `{ok:true, rows}` | `{ok:false, reason:'duplicate_id', current}`
  - `deleteRow(rows, id, expectedUpdatedAt)` → `{ok:true, rows}` | `{ok:false, reason:'not_found'|'conflict', current}`

**注意:** `applyRowUpdate` は既に `changes` オブジェクトを受け取るため、**編集用の新しい関数は作らない。**
複数項目の編集は `applyRowUpdate(rows, id, {title:..., priority:...}, expected, now)` で足りる。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_merge.test.js` の末尾に追加（先頭の require 行に `appendRow` と `deleteRow` を足すこと）:

```javascript
const FIELDS = ['id', 'title', 'description', 'priority', 'size', 'status', 'created_at', 'updated_at'];

test('appendRow は全ての列を埋める', () => {
  // 埋め忘れた列があると toCsv の出力で列がずれる。
  const r = appendRow([], 'PBI-001', { title: 'あたらしい' }, FIELDS, '2026-09-08 10:00:00');
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.rows[0]).sort(), FIELDS.slice().sort());
  assert.equal(r.rows[0].title, 'あたらしい');
  assert.equal(r.rows[0].description, '');
  assert.equal(r.rows[0].id, 'PBI-001');
  assert.equal(r.rows[0].created_at, '2026-09-08 10:00:00');
  assert.equal(r.rows[0].updated_at, '2026-09-08 10:00:00');
});

test('appendRow は allFields に無いキーを捨てる', () => {
  // 未知の列を混ぜると、toCsv が拾わないので黙って消える。混ぜさせない。
  const r = appendRow([], 'PBI-001', { title: 'a', 勝手な列: 'x' }, FIELDS, '2026-09-08 10:00:00');
  assert.equal(r.rows[0]['勝手な列'], undefined);
});

test('appendRow は id / created_at / updated_at の指定を無視してサーバの値を使う', () => {
  const r = appendRow([], 'PBI-001',
    { title: 'a', id: 'PBI-999', created_at: 'うそ', updated_at: 'うそ' },
    FIELDS, '2026-09-08 10:00:00');
  assert.equal(r.rows[0].id, 'PBI-001');
  assert.equal(r.rows[0].created_at, '2026-09-08 10:00:00');
  assert.equal(r.rows[0].updated_at, '2026-09-08 10:00:00');
});

test('appendRow は既存行を変えず、元の配列も変えない', () => {
  const list = [{ id: 'PBI-001', title: 'もとから', updated_at: 'T0' }];
  const r = appendRow(list, 'PBI-002', { title: 'b' }, FIELDS, '2026-09-08 10:00:00');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].title, 'もとから');
  assert.equal(list.length, 1, '元の配列が書き換わっている');
});

test('appendRow は id が重複したら拒否する', () => {
  const list = [{ id: 'PBI-001', title: 'a', updated_at: 'T0' }];
  const r = appendRow(list, 'PBI-001', { title: 'b' }, FIELDS, '2026-09-08 10:00:00');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duplicate_id');
});

test('deleteRow は対象だけを消す', () => {
  const list = [
    { id: 'PBI-001', updated_at: 'T1' },
    { id: 'PBI-002', updated_at: 'T2' },
    { id: 'PBI-003', updated_at: 'T3' },
  ];
  const r = deleteRow(list, 'PBI-002', 'T2');
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map(x => x.id), ['PBI-001', 'PBI-003']);
  assert.equal(list.length, 3, '元の配列が書き換わっている');
});

test('deleteRow は updated_at が不一致なら拒否する', () => {
  // 見ていない変更がある行を消させない。
  const list = [{ id: 'PBI-001', updated_at: 'T2' }];
  const r = deleteRow(list, 'PBI-001', 'T1');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conflict');
  assert.equal(r.current.id, 'PBI-001');
});

test('deleteRow は無い id を not_found で返す', () => {
  assert.equal(deleteRow([{ id: 'PBI-001', updated_at: 'T1' }], 'PBI-999', 'T1').reason, 'not_found');
});

test('deleteRow は空の id を not_found で返す', () => {
  // 中間の空行にマッチさせない。
  const list = [{ id: 'PBI-001', updated_at: 'T1' }, { id: '', updated_at: '' }];
  assert.equal(deleteRow(list, '', '').reason, 'not_found');
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_merge.test.js"`
Expected: FAIL（`appendRow is not a function`）

- [ ] **Step 3: 実装する**

`gas/pure_merge.js` の `applyRowUpdate` の直後、`module.exports` の直前に追加:

```javascript
/** 行を浅くコピーする。元の配列を書き換えないため。 */
function copyRow_(row) {
  const copy = {};
  Object.keys(row).forEach(function (k) { copy[k] = row[k]; });
  return copy;
}

/**
 * 新しい行を末尾に足す。
 *
 * allFields の列を全て空文字で用意してから fields を重ねる。埋め忘れた列があると
 * toCsv の出力で列がずれる。allFields に無いキーは捨てる（toCsv が拾わないため
 * 混ぜても黙って消えるだけで、混入に気づけない）。
 * id / created_at / updated_at はクライアントの申告を信じず、必ず引数の値を使う。
 */
function appendRow(rows, id, fields, allFields, nowText) {
  const list = rows || [];
  const key = String(id || '').trim();
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === key) {
      return { ok: false, reason: 'duplicate_id', current: list[i] };
    }
  }
  const row = {};
  (allFields || []).forEach(function (f) { row[f] = ''; });
  Object.keys(fields || {}).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(row, k)) row[k] = fields[k];
  });
  row.id = key;
  row.created_at = nowText;
  row.updated_at = nowText;
  return { ok: true, rows: list.map(copyRow_).concat([row]) };
}

/**
 * 行を1つ消す。updated_at を照合し、見ていない変更がある行は消させない。
 */
function deleteRow(rows, id, expectedUpdatedAt) {
  const list = rows || [];
  const key = String(id || '').trim();
  if (!key) return { ok: false, reason: 'not_found', current: null };

  let index = -1;
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === key) { index = i; break; }
  }
  if (index === -1) return { ok: false, reason: 'not_found', current: null };

  const current = list[index];
  if (String(current.updated_at || '') !== String(expectedUpdatedAt || '')) {
    return { ok: false, reason: 'conflict', current: current };
  }
  const next = [];
  list.forEach(function (row, i) { if (i !== index) next.push(copyRow_(row)); });
  return { ok: true, rows: next };
}
```

既存の `applyRowUpdate` 内にある行コピーの処理も `copyRow_` を使う形へ置き換えること（重複を残さない）。
`module.exports` を次に更新:

```javascript
if (typeof module !== 'undefined') {
  module.exports = { applyRowUpdate, appendRow, deleteRow, advanceUpdatedAt_, addOneSecondToTimeText_ };
}
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（158 + 9 = 167 件）

- [ ] **Step 5: コミット**

```bash
git add gas/pure_merge.js gas/tests/pure_merge.test.js
git commit -m "feat: 行の追加と削除を純関数として足す"
```

---

### Task 4: 作成・編集・削除の API

**Files:**
- Modify: `gas/web_app.js`

**Interfaces:**
- Consumes: `nextPbiId(rows)`, `validatePbiFields(fields, statuses)`, `PBI_EDITABLE_FIELDS`,
  `appendRow(rows, id, fields, allFields, nowText)`, `deleteRow(rows, id, expectedUpdatedAt)`,
  既存の `applyRowUpdate` / `readBacklogText_` / `assertHeaderMatches` / `csvToObjects` /
  `writeScrumFile_` / `toCsv` / `nowText_` / `buildBoardData` / `BACKLOG_FIELDS` / `KANBAN_STATUSES`
- Produces（クライアントが呼ぶ）:
  - `apiCreatePbi(fields)` → `{ok:true, board, id}` | `{ok:false, reason, message, board}`
  - `apiUpdatePbi(id, fields, expectedUpdatedAt)` → `{ok:true, board}` | `{ok:false, reason, message, board}`
  - `apiDeletePbi(id, expectedUpdatedAt)` → `{ok:true, board}` | `{ok:false, reason, message, board}`

- [ ] **Step 1: ロック内の共通手順を1つにまとめる**

`gas/web_app.js` の `apiUpdateStatus` の直前に追加する。作成・編集・削除・状態変更は
「ロック→読み直し→ヘッダー検査→変更→書き戻し→board 返却」が全く同じで、4回書くと
どれか1つで検査を落としても気づけない。

```javascript
/**
 * 書き戻しを伴う API の共通手順。
 *
 * mutate(rows) は { ok:true, rows, id? } か { ok:false, reason, message } を返すこと。
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

    const result = mutate(rows);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message, board: buildBoardData(rows) };
    }
    writeScrumFile_(BACKLOG_CSV_NAME, toCsv(result.rows, BACKLOG_FIELDS));
    return { ok: true, board: buildBoardData(result.rows), id: result.id || null };
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message, board: null };
  } finally {
    lock.releaseLock();
  }
}

/** 競合・不在の定型文。文面を1か所に集める。 */
function conflictMessage_(reason) {
  if (reason === 'conflict') return '他の変更が先に入っています。最新の内容に更新しました。';
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
```

- [ ] **Step 2: `apiUpdateStatus` を共通手順に載せ替える**

既存の `apiUpdateStatus` の本体を次に置き換える。振る舞いは変えない
（`bad_status` / `conflict` / `not_found` / `busy` の各 reason と文面をそのまま保つ）。

```javascript
function apiUpdateStatus(id, newStatus, expectedUpdatedAt) {
  return withBacklogWrite_(function (rows) {
    if (KANBAN_STATUSES.indexOf(newStatus) === -1) {
      return { ok: false, reason: 'bad_status', message: '不明なステータスです: ' + newStatus };
    }
    const r = applyRowUpdate(rows, id, { status: newStatus }, expectedUpdatedAt, nowText_());
    if (!r.ok) return { ok: false, reason: r.reason, message: conflictMessage_(r.reason) };
    return { ok: true, rows: r.rows };
  });
}
```

- [ ] **Step 3: テストが引き続き通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（167 件のまま。GAS 層は自動テストできないが、`gas_load.test.js` が
グローバル名の衝突と構文エラーを検出する）

- [ ] **Step 4: 3つの API を足す**

`apiUpdateStatus` の直後に追加:

```javascript
/**
 * PBI を新しく作る。ID はサーバ側で採番する。
 *
 * 作成では競合判定を行わない。照合する既存の行が無いためである。
 * ID はロックを取ったあと読み直した CSV から採番するので、アプリ内で重複しない。
 */
function apiCreatePbi(fields) {
  return withBacklogWrite_(function (rows) {
    const picked = pickEditableFields_(fields);
    if (picked.status === undefined) picked.status = KANBAN_STATUSES[0];
    const v = validatePbiFields(picked, KANBAN_STATUSES);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };

    const id = nextPbiId(rows);
    const r = appendRow(rows, id, picked, BACKLOG_FIELDS, nowText_());
    if (!r.ok) {
      return { ok: false, reason: r.reason, message: 'ID が重複しました。もう一度お試しください。' };
    }
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
    if (!r.ok) return { ok: false, reason: r.reason, message: conflictMessage_(r.reason) };
    return { ok: true, rows: r.rows };
  });
}

/**
 * PBI を消す。取り消せないため、クライアント側で確認を挟むこと。
 * 「完了」は Done 列への移動で表すので、これは「間違って作った」場合の操作である。
 */
function apiDeletePbi(id, expectedUpdatedAt) {
  return withBacklogWrite_(function (rows) {
    const r = deleteRow(rows, id, expectedUpdatedAt);
    if (!r.ok) return { ok: false, reason: r.reason, message: conflictMessage_(r.reason) };
    return { ok: true, rows: r.rows };
  });
}
```

- [ ] **Step 5: 公開範囲を確認する**

Run:
```bash
grep -n '^function ' gas/web_app.js
```
Expected: `_` が付かないのは `doGet` / `apiGetBoard` / `apiUpdateStatus` / `apiCreatePbi` /
`apiUpdatePbi` / `apiDeletePbi` の6つだけ。`withBacklogWrite_` / `conflictMessage_` /
`pickEditableFields_` / `readBacklogText_` には `_` が付いていること。

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（167 件）

- [ ] **Step 6: コミット**

```bash
git add gas/web_app.js
git commit -m "feat: PBI の作成・編集・削除の API を足す"
```

---

### Task 5: デザイントークンとカードの刷新

**Files:**
- Modify: `gas/kanban.html`（`<style>` と `renderCard` / `render`）

**Interfaces:**
- Consumes: 既存の `render(b)` / `renderCard(card)` / `board` / `pendingIds`
- Produces: `makeIcon(name)` → `SVGElement`（Task 6-8 がボタンで使う）、
  `ICON_PATHS` に `plus` / `save` / `trash` / `close` / `reload` を持つ

- [ ] **Step 1: トークンを差し替える**

`<style>` の `:root` を次に置き換える。既存の `--bg` / `--card` / `--line` / `--ink` /
`--ink-2` / `--accent` は**名前を保つ**（他の規則が参照しているため）。

```css
  :root {
    --bg: #f5f6f8; --card: #ffffff; --card-2: #fafbfc;
    --line: #e4e7eb; --ink: #1b1f24; --ink-2: #5b626b; --ink-3: #878e96;
    --accent: #2563eb; --accent-ink: #ffffff; --danger: #c0392b;
    --prio-Critical: #d93025; --prio-High: #e8710a;
    --prio-Medium: #1a73e8; --prio-Low: #7a838c;
    --shadow-1: 0 1px 2px rgba(16,24,40,.06), 0 1px 3px rgba(16,24,40,.08);
    --shadow-2: 0 8px 24px rgba(16,24,40,.12), 0 2px 6px rgba(16,24,40,.06);
    --radius: 10px;
    --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #131619; --card: #1b1f23; --card-2: #21262b;
      --line: #2b3137; --ink: #e6e9ec; --ink-2: #a3abb3; --ink-3: #79818a;
      --accent: #5b9bff; --accent-ink: #10141a; --danger: #ff6b5e;
      --prio-Critical: #ff6b5e; --prio-High: #ffa657;
      --prio-Medium: #79b8ff; --prio-Low: #99a1a9;
      --shadow-1: 0 1px 2px rgba(0,0,0,.5);
      --shadow-2: 0 10px 28px rgba(0,0,0,.6);
    }
  }
```

- [ ] **Step 2: 本文と部品の規則を差し替える**

`body` 以下を次に置き換える。和文は英字前提の行間だと詰まって読みづらいため、
`line-height` を 1.7 にし、わずかに字間を空ける。

```css
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: var(--sp-5); background: var(--bg); color: var(--ink);
    font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP",
                 "Yu Gothic UI", Meiryo, sans-serif;
    line-height: 1.7; letter-spacing: .01em;
  }
  header { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }
  h1 { font-size: 17px; margin: 0; letter-spacing: .02em; }
  .spacer { flex: 1; }
  button {
    font: inherit; line-height: 1.4; display: inline-flex; align-items: center; gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3); border: 1px solid var(--line);
    background: var(--card); color: var(--ink);
    border-radius: 8px; cursor: pointer;
  }
  button:hover { background: var(--card-2); }
  button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button[disabled] { opacity: .5; cursor: default; }
  button.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
  button.primary:hover { filter: brightness(1.08); }
  button.danger { color: var(--danger); }
  button.icon-only {
    padding: var(--sp-1); border-color: transparent; background: transparent;
  }
  #message { min-height: 22px; margin-bottom: var(--sp-3); font-size: 13px; white-space: pre-line; }
  #message.error { color: var(--danger); }
  #message.info { color: var(--ink-2); }

  #board { display: flex; gap: var(--sp-4); align-items: flex-start; overflow-x: auto; padding-bottom: var(--sp-3); }
  .column { flex: 1 0 240px; min-width: 240px; }
  .column > h2 {
    font-size: 12px; margin: 0 0 var(--sp-3); color: var(--ink-2);
    letter-spacing: .06em; display: flex; align-items: center; gap: var(--sp-2);
  }
  .count {
    font-weight: normal; color: var(--ink-3); background: var(--card);
    border: 1px solid var(--line); border-radius: 999px; padding: 0 var(--sp-2); font-size: 11px;
  }
  .dropzone {
    background: transparent; border: 1px dashed transparent; border-radius: var(--radius);
    padding: var(--sp-1); min-height: 96px;
  }
  .dropzone.over { border-color: var(--accent); background: var(--card-2); }

  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow-1);
    padding: var(--sp-3) var(--sp-4); margin-bottom: var(--sp-3);
    cursor: grab; font-size: 13px;
  }
  .card:hover { box-shadow: var(--shadow-2); }
  .card:active { cursor: grabbing; }
  .card.dragging { opacity: .4; }
  .card.pending { opacity: .55; cursor: default; }
  .card .prio { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: 11px; color: var(--ink-2); }
  .card .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }
  .card .title { margin: var(--sp-2) 0 var(--sp-3); color: var(--ink); }
  .card .meta {
    color: var(--ink-3); font-size: 11px; display: flex; gap: var(--sp-3);
    border-top: 1px solid var(--line); padding-top: var(--sp-2);
  }
  .empty { color: var(--ink-3); font-size: 12px; padding: var(--sp-3) var(--sp-2); }
```

- [ ] **Step 3: アイコンを足す**

`<script>` の先頭（`var dragging = null;` の直前）に追加。
`innerHTML` を使わず `createElementNS` で組み立てる。ユーザー由来の文字列を
`innerHTML` に入れない方針を、アイコンでも崩さないため。

```javascript
var SVG_NS = 'http://www.w3.org/2000/svg';
var ICON_PATHS = {
  plus:   ['M8 3.2v9.6', 'M3.2 8h9.6'],
  save:   ['M3 3.8A.8.8 0 0 1 3.8 3H10l3 3v6.2a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8Z',
           'M5.5 3v3.2h4.2V3', 'M5.5 13V9.6h5V13'],
  trash:  ['M2.8 4.4h10.4', 'M6.4 4.4V2.9h3.2v1.5', 'M4.2 4.4 4.8 13.2h6.4l.6-8.8'],
  close:  ['M4 4l8 8', 'M12 4l-8 8'],
  reload: ['M13 8a5 5 0 1 1-1.7-3.75', 'M13.2 2v3.1h-3.1']
};

/** 16px のインライン SVG アイコンを作る。色は文字色に追従する。 */
function makeIcon(name) {
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // 意味はラベル側が持つ。読み上げで二重にしない。
  svg.setAttribute('aria-hidden', 'true');
  (ICON_PATHS[name] || []).forEach(function (d) {
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  });
  return svg;
}

/** アイコンとラベルを持つボタンの中身を作る。 */
function fillButton(btn, iconName, label) {
  btn.appendChild(makeIcon(iconName));
  var span = document.createElement('span');
  span.textContent = label;
  btn.appendChild(span);
}
```

- [ ] **Step 4: ヘッダーとカードの組み立てを差し替える**

`<body>` の `<header>` を次に置き換える:

```html
<header>
  <h1>AI Scrum ボード</h1>
  <span class="spacer"></span>
  <button id="create" class="primary" type="button"></button>
  <button id="reload" type="button"></button>
</header>
```

`<script>` の末尾（`document.getElementById('reload').addEventListener(...)` の付近）に:

```javascript
fillButton(document.getElementById('reload'), 'reload', '最新にする');
fillButton(document.getElementById('create'), 'plus', '新規');
```

`renderCard(card)` を次に置き換える。優先度は色だけに意味を持たせず、必ず文字を併記する
（色覚特性により色の差が読み取れない場合がある）:

```javascript
function renderCard(card) {
  var el = document.createElement('div');
  el.className = 'card' + (pendingIds[card.id] ? ' pending' : '');
  el.draggable = !pendingIds[card.id];
  el.dataset.id = card.id;

  var prio = document.createElement('div');
  prio.className = 'prio';
  var dot = document.createElement('span');
  dot.className = 'dot';
  if (card.priority) dot.style.background = 'var(--prio-' + card.priority + ')';
  prio.appendChild(dot);
  var prioText = document.createElement('span');
  prioText.textContent = card.priority || '未設定';
  prio.appendChild(prioText);
  var idText = document.createElement('span');
  idText.style.marginLeft = 'auto';
  idText.textContent = card.id;
  prio.appendChild(idText);
  prio.style.display = 'flex';
  el.appendChild(prio);

  var title = document.createElement('div');
  title.className = 'title';
  title.textContent = card.title;
  el.appendChild(title);

  var meta = document.createElement('div');
  meta.className = 'meta';
  [card.size ? 'サイズ ' + card.size : '', card.sprint || '', card.updated_at || '']
    .filter(function (t) { return t; })
    .forEach(function (t) {
      var s = document.createElement('span');
      s.textContent = t;
      meta.appendChild(s);
    });
  el.appendChild(meta);

  el.addEventListener('dragstart', function (ev) {
    if (pendingIds[card.id]) { ev.preventDefault(); return; }
    dragging = { id: card.id, status: columnStatusOf(board, card.id) };
    el.classList.add('dragging');
    ev.dataTransfer.setData('text/plain', card.id);
  });
  el.addEventListener('dragend', function () {
    dragging = null;
    el.classList.remove('dragging');
  });
  return el;
}
```

**注意:** 既存の `renderCard` の `dragstart` / `dragend` の中身と、`dragging` に入れる形を
今のコードから正確に引き継ぐこと。上は現行と同じ意味になるよう書いてあるが、
差異があれば**現行の実装を正とする**（第1段階で応答の到達順の不具合を直した際の作りが入っている）。

`render(b)` の列の組み立てで、カードを入れる箇所を `.dropzone` の `div` で包み、
`over` クラスの付け外しをその要素に移すこと（列の見出しにドロップ枠がかからないようにする）。

- [ ] **Step 5: 見た目と回帰を確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（167 件）

Run:
```bash
grep -c 'innerHTML' gas/kanban.html
```
Expected: `1`（`root.innerHTML = ''` のクリアのみ）

- [ ] **Step 6: コミット**

```bash
git add gas/kanban.html
git commit -m "feat: デザイントークンとアイコンを入れ、カードを作り直す"
```

---

### Task 6: 詳細パネル（表示と編集）

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `makeIcon(name)`, `fillButton(btn, iconName, label)`, `board`, `pendingIds`,
  `columnStatusOf(b, id)`, `findCard(b, id)`, `render(b)`, `setMessage(text, kind)`
- Produces: `openPanel(id)` / `closePanel()` / `panelState`（`{ id, expectedUpdatedAt }`。
  `id` が `null` なら新規作成モード。Task 7 が使う）

**設計上の要点（ここを外すと第1段階で直した不具合が再発する）:**

パネルの保存・作成・削除は、応答が返ったら `render(res.board)` でサーバの board を
そのまま描く。**これはドラッグの送信中だと壊れる。** 応答が運ぶ board はサーバが
その要求を処理した時点のもので、後から確定したドラッグの移動を含まないためである。

第1段階では、送信が重なった batch で board 全体を信じない仕組み
（`settleOverlap` / `applyServerBoard`）を入れてこれを塞いだ。しかしパネルの操作は
1枚のカードの位置だけでは表せない（作成は行が増え、削除は行が減り、編集はタイトル等も変わる）
ため、同じ仕組みには載らない。

**そこで、送信中の要求が1つでもあればパネルを開かせない。** ドラッグ中はオーバーレイが
無いので、ドラッグの応答を待っている間に「＋新規」やカードのクリックが起こりうる。
逆にパネルが開いている間はオーバーレイが盤面を覆うので、新しいドラッグは始められない。
この2つが揃うと、**パネルの操作とドラッグは決して重ならない**ため、`render(res.board)`
をそのまま使ってよくなる。待ち時間は1秒前後で、利用者への影響は小さい。

**注意:** カードの `card` オブジェクトは `BOARD_CARD_FIELDS`（`id` / `title` / `priority` /
`size` / `sprint` / `updated_at`）しか持たない。**説明と受入基準は board に入っていない。**
パネルで編集するにはこの2項目が要るので、`gas/pure_board_view.js` の `BOARD_CARD_FIELDS` に
`description` と `acceptance_criteria` を足すこと。あわせて
`gas/tests/pure_board_view.test.js` の期待値を更新する。

- [ ] **Step 1: board が説明と受入基準を運ぶようにする（失敗するテストから）**

`gas/tests/pure_board_view.test.js` に追加:

```javascript
test('カードは説明と受入基準も運ぶ（詳細パネルで編集するため）', () => {
  const rows = [{
    id: 'PBI-001', title: 'a', description: 'せつめい',
    acceptance_criteria: 'きじゅん', priority: 'High', size: '3',
    status: 'New', sprint: 'sprint001', created_at: '2026-09-01', updated_at: '2026-09-01',
  }];
  const card = buildBoardData(rows).columns[0].cards[0];
  assert.equal(card.description, 'せつめい');
  assert.equal(card.acceptance_criteria, 'きじゅん');
});
```

Run: `node --test "gas/tests/pure_board_view.test.js"` → FAIL

`gas/pure_board_view.js` の定数を更新:

```javascript
const BOARD_CARD_FIELDS = [
  'id', 'title', 'description', 'acceptance_criteria',
  'priority', 'size', 'sprint', 'updated_at',
];
```

Run: `node --test "gas/tests/*.test.js"` → PASS（168 件）

- [ ] **Step 2: パネルの CSS を足す**

`<style>` の末尾に追加:

```css
  #overlay {
    position: fixed; inset: 0; background: rgba(16,24,40,.35);
  }
  #panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 92vw);
    background: var(--card); border-left: 1px solid var(--line);
    box-shadow: var(--shadow-2); padding: var(--sp-5);
    overflow-y: auto; display: flex; flex-direction: column; gap: var(--sp-4);
  }
  #panel h2 { font-size: 15px; margin: 0; }
  .panel-head { display: flex; align-items: center; gap: var(--sp-3); }
  .field { display: flex; flex-direction: column; gap: var(--sp-2); }
  .field label { font-size: 12px; color: var(--ink-2); }
  .field input, .field textarea, .field select {
    font: inherit; line-height: 1.7; color: var(--ink); background: var(--card-2);
    border: 1px solid var(--line); border-radius: 8px; padding: var(--sp-2) var(--sp-3);
  }
  .field input:focus, .field textarea:focus, .field select:focus {
    outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent;
  }
  .field textarea { min-height: 80px; resize: vertical; }
  .field .hint { font-size: 11px; color: var(--ink-3); }
  .row { display: flex; gap: var(--sp-3); }
  .row > .field { flex: 1; }
  .panel-foot { display: flex; gap: var(--sp-3); align-items: center; margin-top: auto; padding-top: var(--sp-4); }
  .panel-foot .spacer { flex: 1; }
  #panel-message { font-size: 12px; min-height: 18px; white-space: pre-line; }
  #panel-message.error { color: var(--danger); }
```

- [ ] **Step 3: パネルの骨組みを足す**

`<body>` の `<div id="board"></div>` の直後に追加。`hidden` で隠しておく:

```html
<div id="overlay" hidden></div>
<aside id="panel" hidden aria-label="PBI の詳細">
  <div class="panel-head">
    <h2 id="panel-title">PBI</h2>
    <span class="spacer"></span>
    <button id="panel-close" class="icon-only" type="button" aria-label="閉じる"></button>
  </div>
  <div class="field">
    <label for="f-title">タイトル</label>
    <input id="f-title" type="text">
  </div>
  <div class="field">
    <label for="f-description">説明</label>
    <textarea id="f-description"></textarea>
  </div>
  <div class="field">
    <label for="f-acceptance">受入基準</label>
    <textarea id="f-acceptance"></textarea>
    <span class="hint">セミコロン（;）で区切ります</span>
  </div>
  <div class="row">
    <div class="field">
      <label for="f-status">ステータス</label>
      <select id="f-status"></select>
    </div>
    <div class="field">
      <label for="f-priority">優先度</label>
      <select id="f-priority"></select>
    </div>
  </div>
  <div class="row">
    <div class="field">
      <label for="f-size">サイズ</label>
      <input id="f-size" type="text" inputmode="numeric">
    </div>
    <div class="field">
      <label for="f-sprint">スプリント</label>
      <input id="f-sprint" type="text">
    </div>
  </div>
  <div id="panel-message" class="info"></div>
  <div class="panel-foot">
    <button id="panel-save" class="primary" type="button"></button>
    <span class="spacer"></span>
    <button id="panel-delete" class="danger" type="button"></button>
  </div>
</aside>
```

- [ ] **Step 4: パネルの開閉と保存を実装する**

`<script>` の `load()` の直前に追加:

```javascript
var STATUS_OPTIONS = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
var PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

// id が null なら新規作成モード。
var panelState = { id: null, expectedUpdatedAt: '' };

function fillSelect(el, values, includeBlank) {
  el.innerHTML = '';
  if (includeBlank) el.appendChild(document.createElement('option'));
  values.forEach(function (v) {
    var o = document.createElement('option');
    o.value = v;
    o.textContent = v;
    el.appendChild(o);
  });
}

function setPanelMessage(text, kind) {
  var el = document.getElementById('panel-message');
  el.textContent = text;
  el.className = kind || 'info';
}

function readForm() {
  return {
    title: document.getElementById('f-title').value,
    description: document.getElementById('f-description').value,
    acceptance_criteria: document.getElementById('f-acceptance').value,
    status: document.getElementById('f-status').value,
    priority: document.getElementById('f-priority').value,
    size: document.getElementById('f-size').value,
    sprint: document.getElementById('f-sprint').value
  };
}

function writeForm(card, status) {
  document.getElementById('f-title').value = (card && card.title) || '';
  document.getElementById('f-description').value = (card && card.description) || '';
  document.getElementById('f-acceptance').value = (card && card.acceptance_criteria) || '';
  document.getElementById('f-status').value = status || STATUS_OPTIONS[0];
  document.getElementById('f-priority').value = (card && card.priority) || 'Medium';
  document.getElementById('f-size').value = (card && card.size) || '';
  document.getElementById('f-sprint').value = (card && card.sprint) || '';
}

function openPanel(id) {
  // 送信中のドラッグがあるうちは開かせない。パネルの応答は board 全体を
  // 差し替えるため、後から返るドラッグの結果と食い違う。
  if (Object.keys(pendingIds).length > 0) {
    setMessage('カードの移動を反映しています。少し待ってからもう一度お試しください。', 'info');
    return;
  }
  var card = id ? findCard(board, id) : null;
  if (id && !card) return;
  panelState = { id: id, expectedUpdatedAt: card ? card.updated_at : '' };
  document.getElementById('panel-title').textContent = id ? id : '新しい PBI';
  document.getElementById('panel-delete').hidden = !id;
  writeForm(card, id ? columnStatusOf(board, id) : STATUS_OPTIONS[0]);
  setPanelMessage('', 'info');
  document.getElementById('overlay').hidden = false;
  document.getElementById('panel').hidden = false;
  document.getElementById('f-title').focus();
}

function closePanel() {
  document.getElementById('panel').hidden = true;
  document.getElementById('overlay').hidden = true;
  panelState = { id: null, expectedUpdatedAt: '' };
}

function setPanelBusy(busy) {
  document.getElementById('panel-save').disabled = busy;
  document.getElementById('panel-delete').disabled = busy;
}

/** 保存する。新規作成は Task 7 で足す。 */
function savePanel() {
  var id = panelState.id;
  if (!id) return;
  setPanelBusy(true);
  setPanelMessage('保存しています…', 'info');
  google.script.run
    .withSuccessHandler(function (res) {
      setPanelBusy(false);
      if (res.ok) {
        render(res.board);
        closePanel();
        setMessage(id + ' を保存しました。', 'info');
      } else {
        if (res.board) render(res.board);
        setPanelMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      setPanelBusy(false);
      setPanelMessage('保存に失敗しました: ' + err.message, 'error');
    })
    .apiUpdatePbi(id, readForm(), panelState.expectedUpdatedAt);
}
```

**注意:** `fillSelect` は `el.innerHTML = ''` を使う（クリアのみ）。選択肢は
`createElement('option')` と `textContent` で作ること。

- [ ] **Step 5: 配線する**

`<script>` の末尾（`fillButton(...)` の付近）に追加:

```javascript
fillSelect(document.getElementById('f-status'), STATUS_OPTIONS, false);
fillSelect(document.getElementById('f-priority'), PRIORITY_OPTIONS, false);
document.getElementById('panel-close').appendChild(makeIcon('close'));
fillButton(document.getElementById('panel-save'), 'save', '保存');
fillButton(document.getElementById('panel-delete'), 'trash', '削除');
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('overlay').addEventListener('click', closePanel);
document.getElementById('panel-save').addEventListener('click', savePanel);
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && !document.getElementById('panel').hidden) closePanel();
});
```

`renderCard` の末尾（`return el;` の直前）にカードのクリックを足す:

```javascript
  el.addEventListener('click', function () {
    if (pendingIds[card.id]) return;
    openPanel(card.id);
  });
```

- [ ] **Step 6: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（168 件）

```bash
git add gas/kanban.html gas/pure_board_view.js gas/tests/pure_board_view.test.js
git commit -m "feat: 詳細パネルで PBI を編集できるようにする"
```

---

### Task 7: 新規作成

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `openPanel(id)`（`null` で新規モード）, `readForm()`, `setPanelBusy(busy)`,
  `setPanelMessage(text, kind)`, `closePanel()`, `render(b)`, `setMessage(text, kind)`
- Produces: なし

- [ ] **Step 1: 保存を作成にも対応させる**

`savePanel()` を次に置き換える:

```javascript
/** 保存する。panelState.id が null なら新規作成。 */
function savePanel() {
  var id = panelState.id;
  var fields = readForm();
  setPanelBusy(true);
  setPanelMessage(id ? '保存しています…' : '作成しています…', 'info');

  var runner = google.script.run
    .withSuccessHandler(function (res) {
      setPanelBusy(false);
      if (res.ok) {
        render(res.board);
        closePanel();
        setMessage(id ? id + ' を保存しました。' : res.id + ' を作成しました。', 'info');
      } else {
        // 検証エラーはパネルに出す。画面を閉じると入力が消えてしまう。
        if (res.board) render(res.board);
        setPanelMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      setPanelBusy(false);
      setPanelMessage((id ? '保存' : '作成') + 'に失敗しました: ' + err.message, 'error');
    });

  if (id) runner.apiUpdatePbi(id, fields, panelState.expectedUpdatedAt);
  else runner.apiCreatePbi(fields);
}
```

- [ ] **Step 2: 新規ボタンを配線する**

`<script>` の末尾に追加:

```javascript
document.getElementById('create').addEventListener('click', function () { openPanel(null); });
```

- [ ] **Step 3: 検証エラーの見え方を確認する**

タイトルを空にして保存すると、パネルが閉じずに
`タイトルを入力してください。` が赤字で出ること。**入力が消えないこと。**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（168 件）

- [ ] **Step 4: コミット**

```bash
git add gas/kanban.html
git commit -m "feat: アプリから PBI を新規作成できるようにする"
```

---

### Task 8: 削除と確認

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `panelState`, `setPanelBusy(busy)`, `setPanelMessage(text, kind)`, `closePanel()`,
  `render(b)`, `setMessage(text, kind)`, `makeIcon(name)`, `fillButton(btn, iconName, label)`
- Produces: なし

- [ ] **Step 1: 確認ダイアログの CSS と骨組みを足す**

`<style>` の末尾に追加:

```css
  #confirm {
    position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: min(400px, 92vw); background: var(--card); border: 1px solid var(--line);
    border-radius: var(--radius); box-shadow: var(--shadow-2); padding: var(--sp-5);
    display: flex; flex-direction: column; gap: var(--sp-3);
  }
  #confirm h2 { font-size: 15px; margin: 0; }
  #confirm .body { font-size: 13px; color: var(--ink-2); }
  #confirm .foot { display: flex; gap: var(--sp-3); justify-content: flex-end; margin-top: var(--sp-2); }
  #confirm button.primary { background: var(--danger); border-color: transparent; color: #fff; }
```

`<body>` の `</aside>` の直後に追加:

```html
<div id="confirm-overlay" hidden></div>
<div id="confirm" hidden role="dialog" aria-modal="true" aria-labelledby="confirm-title">
  <h2 id="confirm-title">PBI を削除しますか？</h2>
  <div class="body" id="confirm-body"></div>
  <div class="foot">
    <button id="confirm-cancel" type="button">やめる</button>
    <button id="confirm-ok" class="primary" type="button"></button>
  </div>
</div>
```

`#confirm-overlay` は `#overlay` と同じ見た目にするため、`<style>` の
`#overlay` のセレクタを `#overlay, #confirm-overlay` に変えること。

- [ ] **Step 2: 削除を実装する**

`<script>` の `savePanel()` の直後に追加:

```javascript
function openConfirm(id, title) {
  document.getElementById('confirm-body').textContent =
    id + '「' + title + '」を削除します。元に戻せません。\n' +
    '終わった PBI は削除ではなく Done へ移してください。';
  document.getElementById('confirm-overlay').hidden = false;
  document.getElementById('confirm').hidden = false;
  document.getElementById('confirm-cancel').focus();
}

function closeConfirm() {
  document.getElementById('confirm').hidden = true;
  document.getElementById('confirm-overlay').hidden = true;
}

function deletePbi() {
  var id = panelState.id;
  if (!id) return;
  closeConfirm();
  setPanelBusy(true);
  setPanelMessage('削除しています…', 'info');
  // 削除は楽観的更新をしない。消えたものを戻す見せ方が分かりにくいため、
  // 送信中はカードを薄くするだけにして、応答が返ってから消す。
  pendingIds[id] = true;
  render(board);
  google.script.run
    .withSuccessHandler(function (res) {
      setPanelBusy(false);
      delete pendingIds[id];
      if (res.ok) {
        render(res.board);
        closePanel();
        setMessage(id + ' を削除しました。', 'info');
      } else {
        if (res.board) render(res.board); else render(board);
        setPanelMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      setPanelBusy(false);
      delete pendingIds[id];
      render(board);
      setPanelMessage('削除に失敗しました: ' + err.message, 'error');
    })
    .apiDeletePbi(id, panelState.expectedUpdatedAt);
}
```

- [ ] **Step 3: 配線する**

`<script>` の末尾に追加:

```javascript
fillButton(document.getElementById('confirm-ok'), 'trash', '削除する');
document.getElementById('panel-delete').addEventListener('click', function () {
  if (!panelState.id) return;
  openConfirm(panelState.id, document.getElementById('f-title').value);
});
document.getElementById('confirm-cancel').addEventListener('click', closeConfirm);
document.getElementById('confirm-overlay').addEventListener('click', closeConfirm);
document.getElementById('confirm-ok').addEventListener('click', deletePbi);
```

Task 6 で足した `keydown` の処理に、確認ダイアログを先に閉じる分岐を足す:

```javascript
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape') return;
  if (!document.getElementById('confirm').hidden) { closeConfirm(); return; }
  if (!document.getElementById('panel').hidden) closePanel();
});
```

- [ ] **Step 4: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（168 件）

Run:
```bash
grep -c 'innerHTML' gas/kanban.html
```
Expected: `2`（`root.innerHTML = ''` と `fillSelect` のクリアのみ）

```bash
git add gas/kanban.html
git commit -m "feat: PBI を削除できるようにする（確認つき）"
```

---

### Task 9: DOM シムで応答の到達順を検査する

**Files:**
- Create: `gas/tests/kanban_flow.test.js`

**Interfaces:**
- Consumes: `gas/kanban.html` の `<script>`
- Produces: なし

第1段階で、応答の到達順により画面がサーバと食い違う不具合が見つかった。
**コードを読むだけでは見えず、実行して初めて分かった。** 作成・編集・削除でも同じ検査を行う。

- [ ] **Step 1: シムを、次の契約ちょうどに作る**

`gas/tests/kanban_flow.test.js` の中で、`kanban.html` の `<script>` を取り出し、
最小の DOM シムを載せた `vm` コンテキストで走らせる。**判定は内部変数ではなく、
描画された DOM から読む。**

シムが備える DOM: `document.getElementById` / `createElement` / `createElementNS` /
`addEventListener`、要素の `appendChild` / `textContent` / `className` / `classList` /
`dataset` / `hidden` / `disabled` / `value` / `focus` / `style` / `draggable`、
`innerHTML = ''`（空文字の代入のみ許し、非空文字が来たら例外を投げること)。

`createHarness()` が返すものの契約:

| 名前 | 意味 |
|---|---|
| `sandbox` | `vm` のコンテキスト。`sandbox.load()` で初期読み込みを起こす |
| `screen()` | 描画済み DOM から `[{status, cards:[id]}]` を読む |
| `drag(id, toStatus)` | 実ハンドラ経由で `dragstart` → `drop` を起こす |
| `click(elementId)` | 要素の `click` ハンドラを呼ぶ |
| `setValue(fieldId, value)` | `input` / `textarea` / `select` に値を入れる |
| `valueOf(fieldId)` | その値を読む |
| `hiddenOf(elementId)` | `hidden` 属性 |
| `disabledOf(elementId)` | `disabled` 属性 |
| `textOf(elementId)` | `textContent` |
| `calls` | 未応答の呼び出し `[{method, args, handlers}]`。テスト側が任意の順で `handlers.success(res)` を呼ぶ |

`google.script.run` は呼び出しをキューに積むだけにする。**サーバでの処理順とブラウザへの
到達順を別々に制御できることが要点**で、これが無いと今回の検査は成立しない。

**シムを書いたら、意図的に壊して FAIL することを一度確認すること。**
失敗を検出できない検査は無いのと同じ。

- [ ] **Step 2: 検査を書く**

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] },
  { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] },
  { status: 'Done', cards: [] },
];
const fmt = (cols) => cols.map(c => c.status + ':' + c.cards.join(',')).join(' | ');

test('ドラッグの送信中はパネルを開かせない', () => {
  // パネルの応答は board 全体を差し替えるため、後から返るドラッグの結果と食い違う。
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.drag('PBI-001', 'Ready');
  assert.equal(h.calls.length, 1, 'ドラッグが送信されていない');

  h.click('create');
  assert.equal(h.hiddenOf('panel'), true, '送信中なのにパネルが開いた');
  assert.ok(h.textOf('message').indexOf('少し待って') !== -1);
});

test('検証エラーではパネルが閉じず、入力が残る', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.click('create');
  h.setValue('f-title', '');
  h.setValue('f-description', '書きかけの説明');
  h.click('panel-save');

  const call = h.calls[h.calls.length - 1];
  call.handlers.success({ ok: false, reason: 'invalid', message: 'タイトルを入力してください。', board: null });

  assert.equal(h.hiddenOf('panel'), false, 'パネルが閉じてしまった');
  assert.equal(h.valueOf('f-description'), '書きかけの説明', '入力が消えた');
  assert.ok(h.textOf('panel-message').indexOf('タイトル') !== -1);
});

test('削除は確認を挟まないと実行されない', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.click('create');   // 一度閉じてから既存カードを開く
  h.click('panel-close');

  h.openCard('PBI-001');
  const before = h.calls.length;
  h.click('panel-delete');
  assert.equal(h.calls.length, before, '確認前に削除が送信された');
  assert.equal(h.hiddenOf('confirm'), false, '確認が出ていない');
  assert.ok(h.textOf('confirm-body').indexOf('PBI-001') !== -1, '何を消すか示していない');

  h.click('confirm-ok');
  assert.equal(h.calls.length, before + 1);
  assert.equal(h.calls[before].method, 'apiDeletePbi');
});

test('確認でやめると削除されない', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.openCard('PBI-001');
  h.click('panel-delete');
  const before = h.calls.length;
  h.click('confirm-cancel');
  assert.equal(h.hiddenOf('confirm'), true);
  assert.equal(h.calls.length, before, 'やめたのに削除が送信された');
});

test('送信中は保存と削除が押せない', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.openCard('PBI-001');
  h.click('panel-save');
  assert.equal(h.disabledOf('panel-save'), true, '二重送信できてしまう');
  assert.equal(h.disabledOf('panel-delete'), true);
});

test('作成が成功するとパネルが閉じ、サーバの board で描き直す', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.click('create');
  h.setValue('f-title', 'あたらしい PBI');
  h.click('panel-save');

  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiCreatePbi');
  assert.equal(call.args[0].title, 'あたらしい PBI');

  const after = [
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                             { id: 'PBI-002', title: 'あたらしい PBI', updated_at: 'T2' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ];
  call.handlers.success({ ok: true, board: h.boardOf(after), id: 'PBI-002' });

  assert.equal(h.hiddenOf('panel'), true, 'パネルが閉じていない');
  assert.equal(fmt(h.screen()), fmt(h.columnsOf(after)), '画面がサーバと食い違う');
  assert.ok(h.textOf('message').indexOf('PBI-002') !== -1);
});

test('編集で状態を変えるとカードが別の列へ移る', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.serverBoard() });
  h.openCard('PBI-001');
  h.setValue('f-status', 'Review');
  h.click('panel-save');

  const call = h.calls[h.calls.length - 1];
  assert.equal(call.method, 'apiUpdatePbi');
  assert.equal(call.args[1].status, 'Review');
  assert.equal(call.args[2], 'T1', '画面を描いた時点の updated_at を送っていない');

  const after = [
    { status: 'New', cards: [] }, { status: 'Ready', cards: [] },
    { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T2' }] },
    { status: 'Done', cards: [] },
  ];
  call.handlers.success({ ok: true, board: h.boardOf(after) });
  assert.equal(fmt(h.screen()), fmt(h.columnsOf(after)));
});
```

シムは `gas/tests/kanban_harness.js` に切り出す（テスト本体と混ぜると読めなくなる）。
`serverBoard()` は `INITIAL` から、`boardOf(cols)` は任意の列定義から
`{ columns: [{status, cards}] }` を作るヘルパー、`columnsOf(cols)` は
`[{status, cards:[id]}]` に潰すヘルパー、`openCard(id)` は描画済みカードの
`click` を起こすヘルパーとする。

- [ ] **Step 3: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（168 + 7 = 175 件）

不一致が出たら、それは実装の不具合である。`applyServerBoard` / `settleOverlap` の
仕組みに作成・編集・削除を載せ切れていない可能性が高い。

- [ ] **Step 4: コミット**

```bash
git add gas/tests/kanban_flow.test.js gas/tests/kanban_harness.js
git commit -m "test: 作成・編集・削除でも応答の到達順を検査する"
```

---

### Task 10: ドキュメントを実態に合わせる

**Files:**
- Modify: `README.md`, `docs/setup.md`, `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-04-web-app-design.md`

**Interfaces:**
- Consumes: なし
- Produces: なし

- [ ] **Step 1: できることを書き直す**

`README.md` は第1段階の時点で「カンバンでドラッグして状態を変えられる」までしか
書いていない。**アプリで PBI を作成・編集・削除できる**ことを反映する。
あわせて次を明記する。

- 終わった PBI は削除ではなく Done へ移すこと（削除は取り消せない）
- 状態はドラッグでもプルダウンでも変えられること（タッチ端末ではプルダウンを使う）

- [ ] **Step 2: 第1段階の設計書の制約を消す**

`docs/superpowers/specs/2026-09-04-web-app-design.md` に「タッチ端末では操作できない」
という趣旨の既知の制約が残っていれば、**第2段階で解消したことを追記する**
（記述そのものは当時の判断として残し、解消済みである旨を添える）。

- [ ] **Step 3: 運用ガイドを更新する**

`CLAUDE.md` に、人がアプリで何をできるかの記述があれば実態に合わせる。
図がある場合、Web アプリが `product_backlog.csv` を読み書きすることが正しく描かれているか確認する。

- [ ] **Step 4: 配布の必要性を確認する**

Run:
```bash
git diff --name-only main..HEAD | grep -E '^(\.claude/|scrum/|CLAUDE\.md|README\.md)' || echo '(配布不要)'
```

`CLAUDE.md` / `README.md` が変わっていれば、マージ後に
`node scripts/publish.js <配布先>` での再配布が必要。README にその旨がある場合は最新にしておく。

- [ ] **Step 5: コミット**

```bash
git add README.md docs/setup.md CLAUDE.md docs/superpowers/specs/2026-09-04-web-app-design.md
git commit -m "docs: 第2段階でできるようになったことを反映する"
```

---

## 実装後に人が確かめること

自動テストが届かない。**実装の完了条件ではなく、リリース前の確認項目**である。

- 詳細パネルの開閉、作成・編集・削除の一連の流れ
- 削除の確認ダイアログに ID とタイトルが出ること
- ダークモードでの表示（OS の外観設定を切り替える）
- タッチ端末で、プルダウンから状態を変えられること
- ブラウザのコンソールで `google.script.run.withBacklogWrite_(function(){})` が
  **呼べない**こと（`_` 付きの内部関数がブラウザから届かないことの確認）
- 閲覧者権限のアカウントで作成・削除を試し、日本語の案内が出ること
- 画面の拡大（ブラウザのズーム 200%）でパネルが破綻しないこと
