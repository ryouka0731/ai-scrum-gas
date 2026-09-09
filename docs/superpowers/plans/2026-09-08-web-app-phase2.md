# Web アプリ第2段階（PBI の作成・編集・削除 + UI 刷新）実装計画

> **実行済みの記録:** この計画は実行済みであり、当時の計画内容の記録として残している。
> 実行後のレビューで、`savePanel` / `deletePbi` は競合時に `expectedUpdatedAt` を更新する
> ようになった（`syncPanelExpectedUpdatedAt`。無いと同じ古い値を送り続け、パネルから
> 抜け出せなくなる）。編集は `readForm()` の全項目送信ではなく、触っていない項目を送らない
> 差分送信（`changedFields`）にした。`load()` は書き込みの会計（`writeSeq`）に載せ、
> 発行後に確定した書き込みを見分けられるようにした。`[hidden]` は CSS で
> `[hidden] { display: none !important; }` と明示した（作成者オリジンの display 指定が
> 優先されるため）。**下のコードブロックは計画当時のまま更新していない。**
> 現行仕様の真実の源泉は `docs/superpowers/specs/`（この計画ではない）。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 人がスプレッドシートを開かずに、Web アプリだけで PBI を作成・編集・削除できるようにする。

**Architecture:** 判断ロジックは `pure_*.js`（GAS API 非依存・node でテスト可能）に置き、`web_app.js` は
ロック取得・読み直し・ヘッダー検査・書き戻しの薄い層に留める。UI はボードと詳細パネルの2ペインで、
**パネルはオーバーレイを持たずモードレス**。作成と編集は同じパネルを使い回す。
応答の反映は、ドラッグ・作成・編集・削除・取り消しのすべてを
**「そのカード1枚だけを今の画面に反映する」**に統一する。

**設計の拠りどころ:** UI の判断は社内の登壇資料「SCM 店舗在庫管理領域 UI 改善 設計意図説明資料」の
設計論に従う。オブジェクト指向 UI（名詞優先）、モードレス、フェイルセーフ（実行確認ではなく
実行後に取り消せる）、横スクロールを避ける、無関係操作のリスク無化。

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
  `apiRestorePbi` / `onOpen` / `menuSyncNow` / `menuConfigure` / `menuInstallTrigger` /
  `menuRemoveTrigger` / `scheduledSync` のみ。純関数層（副作用なし）は対象外。
- **モーダルを使わない。** 確認ダイアログではなく、実行後に取り消せる通知で受ける。
- **利用者の操作を止めて競合を避けない。** 競合は「1枚だけ反映する」で技術的に解く。
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
| `gas/pure_merge.js`（変更） | 行集合への追加・削除・復元を足す（既存の更新・競合判定に隣接するため同居させる） |
| `gas/pure_board_view.js`（変更） | カードが説明と受入基準も運ぶようにする |
| `gas/web_app.js`（変更） | 作成・編集・削除・復元の API。ロック内の共通手順を1つにまとめる |
| `gas/kanban.html`（変更） | デザイントークン、アイコン、モードレスな詳細パネル、列の追加ボタン、取り消せる通知 |
| `gas/tests/pure_pbi_id.test.js`（新規） | ID 採番 |
| `gas/tests/pure_pbi_validate.test.js`（新規） | 入力検証 |
| `gas/tests/pure_merge.test.js`（変更） | 追加・削除・復元 |
| `gas/tests/kanban_harness.js`（新規） | DOM シム本体 |
| `gas/tests/kanban_flow.test.js`（新規） | 応答の到達順を検査 |

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

### Task 4b: 削除の取り消しを支える純関数と API

**Files:**
- Modify: `gas/pure_merge.js`（`deleteRow` の直後）
- Modify: `gas/web_app.js`（`apiDeletePbi` の直後）
- Test: `gas/tests/pure_merge.test.js`（末尾に追加）

**Interfaces:**
- Consumes: `copyRow_(row)`（Task 3 で新設済み）, `appendRow` と同じ考え方
- Produces:
  - `restoreRow(rows, row, allFields, nowText)` → `{ok:true, rows}` | `{ok:false, reason:'duplicate_id'}`
  - `apiDeletePbi` の成功応答に `removed`（消した行そのもの）を足す
  - `apiRestorePbi(row)` → `{ok:true, board}` | `{ok:false, reason, message, board}`

**なぜ要るか:** 削除に確認ダイアログを置かず、実行後に取り消せる通知を出す方針にした
（モーダルは操作を制限し順序を固定するため避ける）。取り消しで `apiCreatePbi` を使うと
**ID が変わり**、ローカルの Claude Code が残した参照が切れる。元の `id` と `created_at` を
保ったまま戻す経路が要る。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_merge.test.js` の末尾に追加（先頭の require に `restoreRow` を足すこと）:

```javascript
test('restoreRow は id と created_at を元のまま戻す', () => {
  // apiCreatePbi で作り直すと ID が変わり、ローカルの Claude Code が残した参照が切れる。
  const removed = {
    id: 'PBI-007', title: 'もどす', description: 'せつめい', priority: 'High',
    size: '3', status: 'Ready', created_at: '2026-09-01 09:00:00', updated_at: '2026-09-05 10:00:00',
  };
  const r = restoreRow([{ id: 'PBI-001', updated_at: 'T1' }], removed, FIELDS, '2026-09-08 12:00:00');
  assert.equal(r.ok, true);
  const back = r.rows[r.rows.length - 1];
  assert.equal(back.id, 'PBI-007');
  assert.equal(back.created_at, '2026-09-01 09:00:00', 'created_at が書き換わった');
  assert.equal(back.title, 'もどす');
  assert.equal(back.description, 'せつめい');
});

test('restoreRow は updated_at を戻した時刻にする', () => {
  // 戻したことも変更なので、他の人の画面から見て「見ていない変更」になる必要がある。
  const removed = { id: 'PBI-007', title: 'a', created_at: '2026-09-01', updated_at: '2026-09-05' };
  const r = restoreRow([], removed, FIELDS, '2026-09-08 12:00:00');
  assert.equal(r.rows[0].updated_at, '2026-09-08 12:00:00');
});

test('restoreRow は全ての列を埋め、未知のキーを捨てる', () => {
  const removed = { id: 'PBI-007', title: 'a', 勝手な列: 'x' };
  const r = restoreRow([], removed, FIELDS, '2026-09-08 12:00:00');
  assert.deepEqual(Object.keys(r.rows[0]).sort(), FIELDS.slice().sort());
  assert.equal(r.rows[0]['勝手な列'], undefined);
});

test('restoreRow は既に同じ id があれば拒否する', () => {
  // 通知を2回押した、他の人が同じ ID を起票した、などで二重に増やさない。
  const list = [{ id: 'PBI-007', updated_at: 'T1' }];
  const r = restoreRow(list, { id: 'PBI-007', title: 'a' }, FIELDS, '2026-09-08 12:00:00');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duplicate_id');
});

test('restoreRow は元の配列を書き換えない', () => {
  const list = [{ id: 'PBI-001', updated_at: 'T1' }];
  restoreRow(list, { id: 'PBI-007', title: 'a' }, FIELDS, '2026-09-08 12:00:00');
  assert.equal(list.length, 1);
});

test('restoreRow は id が空なら拒否する', () => {
  const r = restoreRow([], { title: 'a' }, FIELDS, '2026-09-08 12:00:00');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'duplicate_id');
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_merge.test.js"`
Expected: FAIL（`restoreRow is not a function`）

- [ ] **Step 3: 実装する**

`gas/pure_merge.js` の `deleteRow` の直後に追加:

```javascript
/**
 * 削除した行を元の id / created_at のまま戻す。
 *
 * 取り消しで新規作成を使うと ID が変わり、ローカルの Claude Code が残した参照が
 * 切れる。updated_at だけは戻した時刻にする（戻したことも変更であり、他の人の
 * 画面から見れば「見ていない変更」になる必要があるため）。
 */
function restoreRow(rows, row, allFields, nowText) {
  const list = rows || [];
  const src = row || {};
  const key = String(src.id || '').trim();
  if (!key) return { ok: false, reason: 'duplicate_id', current: null };
  for (let i = 0; i < list.length; i++) {
    if (String(list[i].id || '').trim() === key) {
      return { ok: false, reason: 'duplicate_id', current: list[i] };
    }
  }
  const back = {};
  (allFields || []).forEach(function (f) { back[f] = ''; });
  Object.keys(src).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(back, k)) back[k] = src[k];
  });
  back.id = key;
  back.updated_at = nowText;
  return { ok: true, rows: list.map(copyRow_).concat([back]) };
}
```

`module.exports` に `restoreRow` を足すこと。

- [ ] **Step 4: `apiDeletePbi` が消した行を返すようにする**

`gas/web_app.js` の `apiDeletePbi` を次に置き換える。`withBacklogWrite_` は
`result.id` を拾って応答に載せるので、消した行を運ぶには**その仕組みを一般化する**。
`withBacklogWrite_` の成功時の返り値を次に変える:

```javascript
    writeScrumFile_(BACKLOG_CSV_NAME, toCsv(result.rows, BACKLOG_FIELDS));
    return {
      ok: true,
      board: buildBoardData(result.rows),
      id: result.id || null,
      removed: result.removed || null
    };
```

`apiDeletePbi`:

```javascript
function apiDeletePbi(id, expectedUpdatedAt) {
  return withBacklogWrite_(function (rows) {
    const target = null;
    const r = deleteRow(rows, id, expectedUpdatedAt);
    if (!r.ok) return { ok: false, reason: r.reason, message: conflictMessage_(r.reason) };
    // 取り消しに使うため、消した行そのものを返す。
    let removed = null;
    rows.forEach(function (row) {
      if (String(row.id || '').trim() === String(id || '').trim()) removed = row;
    });
    return { ok: true, rows: r.rows, removed: removed };
  });
}
```

**注意:** 上の `const target = null;` は書かないこと（使わない変数を残さない）。
`removed` は `deleteRow` を呼ぶ**前**の `rows` から取ること（`r.rows` には既に無い）。

- [ ] **Step 5: `apiRestorePbi` を足す**

`apiDeletePbi` の直後に追加:

```javascript
/**
 * 削除した PBI を戻す。通知の「取り消す」から呼ばれる。
 * apiCreatePbi ではなくこちらを使うのは、元の id と created_at を保つため。
 */
function apiRestorePbi(row) {
  return withBacklogWrite_(function (rows) {
    const r = restoreRow(rows, row, BACKLOG_FIELDS, nowText_());
    if (!r.ok) {
      return { ok: false, reason: r.reason, message: 'この PBI は既に存在します。取り消しは要りません。' };
    }
    return { ok: true, rows: r.rows };
  });
}
```

- [ ] **Step 6: 公開範囲を確認する**

Run: `grep -n '^function ' gas/web_app.js`
Expected: `_` が付かないのは `doGet` / `apiGetBoard` / `apiUpdateStatus` / `apiCreatePbi` /
`apiUpdatePbi` / `apiDeletePbi` / `apiRestorePbi` の**7つだけ**。

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（167 + 6 = 173 件）

- [ ] **Step 7: コミット**

```bash
git add gas/pure_merge.js gas/web_app.js gas/tests/pure_merge.test.js
git commit -m "feat: 削除した PBI を元の ID のまま戻せるようにする"
```

---

### Task 5: デザイントークン、アイコン、レイアウト

**Files:**
- Modify: `gas/kanban.html`（`<style>`、`<header>`、`render` / `renderCard`）

**Interfaces:**
- Consumes: 既存の `render(b)` / `renderCard(card)` / `board` / `pendingIds` / `columnStatusOf(b, id)`
- Produces: `makeIcon(name)` → `SVGElement`、`fillButton(btn, iconName, label)`、
  `ICON_PATHS` に `plus` / `save` / `trash` / `close` / `reload` / `undo` を持つ

**設計の拠りどころ:** 横スクロールは一覧性を下げ、操作ステップを増やし、タッチ端末で
扱いにくい。**幅 900px 未満では列を縦に積む。** 列見出しは残すのでステータスは失われない。

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

`body` 以下を次に置き換える。和文は英字前提の行間だと詰まって読みづらいため
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
  button.icon-only { padding: var(--sp-1); border-color: transparent; background: transparent; }
  button.add {
    width: 100%; justify-content: center; color: var(--ink-2);
    border-style: dashed; background: transparent;
  }
  button.add:hover { color: var(--accent); border-color: var(--accent); }

  #message { min-height: 22px; margin-bottom: var(--sp-3); font-size: 13px; white-space: pre-line; }
  #message.error { color: var(--danger); }
  #message.info { color: var(--ink-2); }

  /* 盤面とパネルを横に並べる。パネルは覆いかぶさらない（モードレス） */
  #main { display: flex; gap: var(--sp-4); align-items: flex-start; }
  #board { display: flex; gap: var(--sp-4); align-items: flex-start; flex: 1; min-width: 0; }
  .column { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: var(--sp-3); }
  .column > h2 {
    font-size: 12px; margin: 0; color: var(--ink-2);
    letter-spacing: .06em; display: flex; align-items: center; gap: var(--sp-2);
  }
  .count {
    font-weight: normal; color: var(--ink-3); background: var(--card);
    border: 1px solid var(--line); border-radius: 999px; padding: 0 var(--sp-2); font-size: 11px;
  }
  .dropzone {
    border: 1px dashed transparent; border-radius: var(--radius);
    padding: var(--sp-1); min-height: 72px;
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
  .card.selected { border-color: var(--accent); box-shadow: var(--shadow-2); }
  .card .prio { display: flex; align-items: center; gap: var(--sp-2); font-size: 11px; color: var(--ink-2); }
  .card .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ink-3); }
  .card .title { margin: var(--sp-2) 0 var(--sp-3); color: var(--ink); }
  .card .meta {
    color: var(--ink-3); font-size: 11px; display: flex; gap: var(--sp-3);
    border-top: 1px solid var(--line); padding-top: var(--sp-2);
  }
  .empty { color: var(--ink-3); font-size: 12px; padding: var(--sp-3) var(--sp-2); }

  /* 狭い画面では列を縦に積む。横スクロールは一覧性を下げ、タッチで扱いにくい */
  @media (max-width: 900px) {
    body { padding: var(--sp-3); }
    #main { flex-direction: column; }
    #board { flex-direction: column; width: 100%; }
    .column { width: 100%; }
  }
```

- [ ] **Step 3: アイコンを足す**

`<script>` の先頭（`var dragging = null;` の直前）に追加。`innerHTML` を使わず
`createElementNS` で組み立てる（ユーザー由来の文字列を `innerHTML` に入れない方針を
アイコンでも崩さないため）。

```javascript
var SVG_NS = 'http://www.w3.org/2000/svg';
var ICON_PATHS = {
  plus:   ['M8 3.2v9.6', 'M3.2 8h9.6'],
  save:   ['M3 3.8A.8.8 0 0 1 3.8 3H10l3 3v6.2a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8Z',
           'M5.5 3v3.2h4.2V3', 'M5.5 13V9.6h5V13'],
  trash:  ['M2.8 4.4h10.4', 'M6.4 4.4V2.9h3.2v1.5', 'M4.2 4.4 4.8 13.2h6.4l.6-8.8'],
  close:  ['M4 4l8 8', 'M12 4l-8 8'],
  reload: ['M13 8a5 5 0 1 1-1.7-3.75', 'M13.2 2v3.1h-3.1'],
  undo:   ['M3.2 7.2h7a3 3 0 0 1 0 6H7', 'M6 4.4 3.2 7.2 6 10']
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

- [ ] **Step 4: 骨組みを差し替える**

`<body>` の `<header>` と `<div id="board"></div>` を次に置き換える。
**ヘッダーに「＋新規」は置かない**（作成は列から生む）。

```html
<header>
  <h1>AI Scrum ボード</h1>
  <span class="spacer"></span>
  <button id="reload" type="button"></button>
</header>
<div id="message" class="info">読み込んでいます…</div>
<div id="main">
  <div id="board"></div>
</div>
```

（既存の `<div id="message">` が `<header>` の直後にある場合は、上の並びに合わせること。）

`<script>` の末尾に:

```javascript
fillButton(document.getElementById('reload'), 'reload', '最新にする');
```

- [ ] **Step 5: 列とカードの組み立てを差し替える**

`render(b)` の列を組み立てる部分を次の形にする。**各列の下端に「＋」を置く**
（`onAddClick` は Task 7 で実装する。ここでは何もしない関数を置く）。

```javascript
function renderColumn(col) {
  var div = document.createElement('div');
  div.className = 'column';
  div.dataset.status = col.status;

  var h = document.createElement('h2');
  var name = document.createElement('span');
  name.textContent = col.status;
  h.appendChild(name);
  var count = document.createElement('span');
  count.className = 'count';
  count.textContent = String(col.cards.length);
  h.appendChild(count);
  div.appendChild(h);

  var zone = document.createElement('div');
  zone.className = 'dropzone';
  zone.dataset.status = col.status;
  if (col.cards.length === 0) {
    var empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'なし';
    zone.appendChild(empty);
  }
  col.cards.forEach(function (card) { zone.appendChild(renderCard(card)); });
  // ドロップ枠の付け外しはこの要素で行う（列見出しにはかけない）
  wireDropzone(zone, col.status);
  div.appendChild(zone);

  var add = document.createElement('button');
  add.className = 'add';
  add.type = 'button';
  fillButton(add, 'plus', '追加');
  add.addEventListener('click', function () { onAddClick(col.status); });
  div.appendChild(add);
  return div;
}

/** Task 7 で中身を入れる。 */
function onAddClick(status) {}
```

`wireDropzone(zone, status)` は、現行の `render` にある `dragover` / `dragleave` / `drop` の
処理をそのまま移したもの。**現行の実装を正とし、意味を変えないこと**
（第1段階で応答の到達順の不具合を直した際の作りが入っている）。

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

**注意:** `dragstart` / `dragend` の中身と `dragging` に入れる形は、**現行の実装から
正確に引き継ぐこと**。上は現行と同じ意味になるよう書いてあるが、差異があれば現行を正とする。

- [ ] **Step 6: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（173 件）

Run: `grep -c 'innerHTML' gas/kanban.html`
Expected: `1`（`root.innerHTML = ''` のクリアのみ）

```bash
git add gas/kanban.html
git commit -m "feat: デザイントークンとアイコンを入れ、狭い画面で列を畳む"
```

---

### Task 6: 詳細パネル（モードレス）と1枚単位の反映

**Files:**
- Modify: `gas/pure_board_view.js`, `gas/tests/pure_board_view.test.js`, `gas/kanban.html`

**Interfaces:**
- Consumes: `makeIcon` / `fillButton` / `board` / `pendingIds` / `columnStatusOf(b, id)` /
  `findCard(b, id)` / `render(b)` / `setMessage(text, kind)` / 既存の `settleOverlap()` /
  `boardWithCardMoved(b, id, newStatus)` / `boardWithCardRemoved(b, id)`
- Produces:
  - `openPanel(id, presetStatus)` / `closePanel()` / `panelState`（`{ id, expectedUpdatedAt, status }`。
    `id` が `null` なら新規作成モード）
  - `mergeOneCard(current, serverBoard, id)` → 新しい board（Task 7・8 が使う）
  - `boardWithCardUpserted(b, card, status)` → 新しい board

**設計の拠りどころ（ここを外すと第1段階で直した不具合が再発する）:**

当初、パネルの操作は「1枚のカードの位置」では表せないと考え、オーバーレイを敷いて
送信中はパネルを開かせない設計にしていた。**これは誤りだった。** 作成・編集・削除は
いずれも**ちょうど1枚のカードだけ**を変える。応答の board に写る他のカードは、
サーバがその要求を処理した時点の古い文脈であり、無視してよい。

**すべての操作を「そのカードだけを今の画面に反映する」に統一する。** これにより
オーバーレイも開閉の制限も要らなくなり、モードレスにできる。

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

Run: `node --test "gas/tests/*.test.js"` → PASS（174 件）

- [ ] **Step 2: 1枚単位の反映を実装する**

`gas/kanban.html` の `boardWithCardRemoved` の直後に追加:

```javascript
/** board を複製し、card を status の列に置いた新しい board を返す（同じ id が居れば置き換える）。 */
function boardWithCardUpserted(b, card, status) {
  var removed = boardWithCardRemoved(b, card.id);
  var next = { columns: removed.columns.map(function (col) {
    return { status: col.status, cards: col.cards.slice() };
  }) };
  for (var i = 0; i < next.columns.length; i++) {
    if (next.columns[i].status === status) { next.columns[i].cards.push(card); return next; }
  }
  // 行き先の列が無い（未知のステータス）ときは、消したままにせず元に戻す。
  return b;
}

/**
 * 応答が運ぶ board から、そのカード1枚だけを今の画面へ反映する。
 *
 * 応答の board は「サーバがその要求を処理した時点」のもので、後から確定した
 * 別カードの移動を含まない。到達順は保証されないため、全体を信じると
 * 取り消したはずの移動が復活する。変わったのは常にこの1枚だけである。
 */
function mergeOneCard(current, serverBoard, id) {
  var to = columnStatusOf(serverBoard, id);
  var card = findCard(serverBoard, id);
  if (to === null || !card) return boardWithCardRemoved(current, id);
  return boardWithCardUpserted(current, card, to);
}
```

- [ ] **Step 3: パネルの CSS を足す**

`<style>` の末尾に追加。**オーバーレイは作らない。**

```css
  #panel {
    flex: 0 0 380px; align-self: stretch;
    background: var(--card); border: 1px solid var(--line); border-radius: var(--radius);
    box-shadow: var(--shadow-1); padding: var(--sp-4);
    display: flex; flex-direction: column; gap: var(--sp-3);
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
  .field textarea { min-height: 76px; resize: vertical; }
  .field .hint { font-size: 11px; color: var(--ink-3); }
  .row { display: flex; gap: var(--sp-3); }
  .row > .field { flex: 1; min-width: 0; }
  .panel-foot { display: flex; gap: var(--sp-3); align-items: center; margin-top: auto; padding-top: var(--sp-3); }
  .panel-foot .spacer { flex: 1; }
  #panel-message { font-size: 12px; min-height: 18px; white-space: pre-line; }
  #panel-message.error { color: var(--danger); }
  @media (max-width: 900px) {
    #panel { flex: 1 1 auto; width: 100%; }
  }
```

- [ ] **Step 4: パネルの骨組みを足す**

`<div id="main">` の中、`<div id="board"></div>` の**直後**に置く:

```html
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

- [ ] **Step 5: パネルの開閉と保存を実装する**

`<script>` の `load()` の直前に追加:

```javascript
var STATUS_OPTIONS = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
var PRIORITY_OPTIONS = ['Critical', 'High', 'Medium', 'Low'];

// id が null なら新規作成モード。status は新規作成時の初期ステータス。
var panelState = { id: null, expectedUpdatedAt: '', status: STATUS_OPTIONS[0] };

function fillSelect(el, values) {
  el.innerHTML = '';
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

/** id が null なら新規作成。presetStatus は新規作成時の初期ステータス。 */
function openPanel(id, presetStatus) {
  var card = id ? findCard(board, id) : null;
  if (id && !card) return;
  var status = id ? columnStatusOf(board, id) : (presetStatus || STATUS_OPTIONS[0]);
  panelState = { id: id, expectedUpdatedAt: card ? card.updated_at : '', status: status };
  document.getElementById('panel-title').textContent = id ? id : '新しい PBI';
  document.getElementById('panel-delete').hidden = !id;
  writeForm(card, status);
  setPanelMessage('', 'info');
  document.getElementById('panel').hidden = false;
  render(board);   // 選択中のカードに印を付ける
  document.getElementById('f-title').focus();
}

function closePanel() {
  document.getElementById('panel').hidden = true;
  panelState = { id: null, expectedUpdatedAt: '', status: STATUS_OPTIONS[0] };
  render(board);
}

function setPanelBusy(busy) {
  document.getElementById('panel-save').disabled = busy;
  document.getElementById('panel-delete').disabled = busy;
}

/** 保存する。新規作成の分岐は Task 7 で足す。 */
function savePanel() {
  var id = panelState.id;
  if (!id) return;
  setPanelBusy(true);
  setPanelMessage('保存しています…', 'info');
  var trustWholeBoard = null;
  pendingIds[id] = true;
  if (Object.keys(pendingIds).length > 1) overlapped = true;

  google.script.run
    .withSuccessHandler(function (res) {
      setPanelBusy(false);
      delete pendingIds[id];
      trustWholeBoard = settleOverlap();
      if (res.ok) {
        render(trustWholeBoard ? res.board : mergeOneCard(board, res.board, id));
        closePanel();
        setMessage(id + ' を保存しました。', 'info');
      } else {
        // 検証エラーではパネルを閉じない。閉じると入力が消える。
        if (res.board) render(trustWholeBoard ? res.board : mergeOneCard(board, res.board, id));
        else render(board);
        setPanelMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      setPanelBusy(false);
      delete pendingIds[id];
      settleOverlap();
      render(board);
      setPanelMessage('保存に失敗しました: ' + err.message, 'error');
    })
    .apiUpdatePbi(id, readForm(), panelState.expectedUpdatedAt);
}
```

`renderCard` に、開いているカードへ印を付ける行を足す（`el.className` の組み立て）:

```javascript
  el.className = 'card' + (pendingIds[card.id] ? ' pending' : '')
    + (panelState.id === card.id ? ' selected' : '');
```

- [ ] **Step 6: 配線する**

`<script>` の末尾に追加:

```javascript
fillSelect(document.getElementById('f-status'), STATUS_OPTIONS);
fillSelect(document.getElementById('f-priority'), PRIORITY_OPTIONS);
document.getElementById('panel-close').appendChild(makeIcon('close'));
fillButton(document.getElementById('panel-save'), 'save', '保存');
fillButton(document.getElementById('panel-delete'), 'trash', '削除');
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('panel-save').addEventListener('click', savePanel);
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape' && !document.getElementById('panel').hidden) closePanel();
});
```

`renderCard` の `return el;` の直前にカードのクリックを足す:

```javascript
  el.addEventListener('click', function () {
    if (pendingIds[card.id]) return;
    openPanel(card.id, null);
  });
```

- [ ] **Step 7: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（174 件）

Run: `grep -c 'innerHTML' gas/kanban.html`
Expected: `2`（`root.innerHTML = ''` と `fillSelect` のクリアのみ）

```bash
git add gas/kanban.html gas/pure_board_view.js gas/tests/pure_board_view.test.js
git commit -m "feat: モードレスな詳細パネルで PBI を編集できるようにする"
```

---

### Task 7: 列から新規作成する

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `openPanel(id, presetStatus)` / `readForm()` / `panelState` / `setPanelBusy` /
  `setPanelMessage` / `closePanel` / `render` / `setMessage` / `mergeOneCard` / `settleOverlap`
- Produces: なし

**設計の拠りどころ:** 作成の起点をヘッダーに置くと動詞が起点になり、作ってから
ステータスを選ばせることになる。**列から生めばステータスが最初から決まり、操作が1つ減る。**

- [ ] **Step 1: 列の「＋」を実装する**

Task 5 で置いた空の `onAddClick` を次に置き換える:

```javascript
function onAddClick(status) {
  openPanel(null, status);
}
```

- [ ] **Step 2: 保存を作成にも対応させる**

`savePanel()` を次に置き換える:

```javascript
/** 保存する。panelState.id が null なら新規作成。 */
function savePanel() {
  var id = panelState.id;
  var fields = readForm();
  setPanelBusy(true);
  setPanelMessage(id ? '保存しています…' : '作成しています…', 'info');

  // 作成はまだ id が無いので、重なりの判定だけ先に立てる。
  if (Object.keys(pendingIds).length > 0) overlapped = true;
  if (id) pendingIds[id] = true;

  var runner = google.script.run
    .withSuccessHandler(function (res) {
      setPanelBusy(false);
      if (id) delete pendingIds[id];
      var trustWholeBoard = settleOverlap();
      var newId = id || res.id;
      if (res.ok) {
        render(trustWholeBoard || !newId ? res.board : mergeOneCard(board, res.board, newId));
        closePanel();
        setMessage((id ? id + ' を保存しました。' : res.id + ' を作成しました。'), 'info');
      } else {
        // 検証エラーではパネルを閉じない。閉じると入力が消える。
        if (res.board) render(trustWholeBoard ? res.board : board);
        setPanelMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      setPanelBusy(false);
      if (id) delete pendingIds[id];
      settleOverlap();
      render(board);
      setPanelMessage((id ? '保存' : '作成') + 'に失敗しました: ' + err.message, 'error');
    });

  if (id) runner.apiUpdatePbi(id, fields, panelState.expectedUpdatedAt);
  else runner.apiCreatePbi(fields);
}
```

- [ ] **Step 3: 確認してコミット**

タイトルを空にして保存すると、パネルが閉じずに `タイトルを入力してください。` が
赤字で出て、**入力が消えないこと**。

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（174 件）

```bash
git add gas/kanban.html
git commit -m "feat: 列の追加ボタンから PBI を新規作成できるようにする"
```

---

### Task 8: 削除と、取り消せる通知

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `panelState` / `setPanelBusy` / `setPanelMessage` / `closePanel` / `render` /
  `setMessage` / `makeIcon` / `fillButton` / `mergeOneCard` / `settleOverlap` /
  `boardWithCardRemoved`
- Produces: なし

**設計の拠りどころ:** モーダルの確認ダイアログは操作を制限し順序を固定する。
**確認を挟まず即実行し、取り消せる通知を出す**（フェイルセーフ）。
取り消しは `apiRestorePbi` を使う。`apiCreatePbi` で作り直すと ID が変わり、
ローカルの Claude Code が残した参照が切れる。

- [ ] **Step 1: 通知の CSS を足す**

`<style>` の末尾に追加:

```css
  #toast {
    position: fixed; left: 50%; bottom: var(--sp-5); transform: translateX(-50%);
    display: flex; align-items: center; gap: var(--sp-4);
    background: var(--ink); color: var(--bg);
    border-radius: var(--radius); box-shadow: var(--shadow-2);
    padding: var(--sp-3) var(--sp-4); font-size: 13px; max-width: min(560px, 92vw);
  }
  #toast button {
    background: transparent; border-color: transparent; color: var(--bg);
    text-decoration: underline; padding: var(--sp-1) var(--sp-2);
  }
  #toast button:hover { background: rgba(255,255,255,.12); }
```

`<body>` の `</div>`（`#main` の閉じ）の直後に追加:

```html
<div id="toast" hidden role="status">
  <span id="toast-text"></span>
  <span class="spacer"></span>
  <button id="toast-undo" type="button"></button>
</div>
```

- [ ] **Step 2: 通知を実装する**

`<script>` の `savePanel()` の直後に追加:

```javascript
var toastTimer = null;
var UNDO_SECONDS = 10;

/** 取り消せる通知を出す。時間が過ぎたら消える。 */
function showUndoToast(text, onUndo) {
  var el = document.getElementById('toast');
  document.getElementById('toast-text').textContent = text;
  var btn = document.getElementById('toast-undo');
  btn.onclick = function () { hideToast(); onUndo(); };
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, UNDO_SECONDS * 1000);
}

function hideToast() {
  if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
  document.getElementById('toast').hidden = true;
}
```

- [ ] **Step 3: 削除と取り消しを実装する**

```javascript
/**
 * 削除する。確認は挟まず、取り消せる通知を出す（モーダルは操作を制限するため使わない）。
 * 押した瞬間にカードを消し、失敗したら戻す。
 */
function deletePbi() {
  var id = panelState.id;
  if (!id) return;
  var title = document.getElementById('f-title').value;
  var before = board;

  setPanelBusy(true);
  if (Object.keys(pendingIds).length > 0) overlapped = true;
  pendingIds[id] = true;
  render(boardWithCardRemoved(board, id));   // 楽観的に消す

  google.script.run
    .withSuccessHandler(function (res) {
      setPanelBusy(false);
      delete pendingIds[id];
      var trustWholeBoard = settleOverlap();
      if (res.ok) {
        render(trustWholeBoard ? res.board : mergeOneCard(board, res.board, id));
        closePanel();
        showUndoToast(id + '「' + title + '」を削除しました。', function () { restorePbi(res.removed); });
      } else {
        render(trustWholeBoard && res.board ? res.board : before);
        setPanelMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      setPanelBusy(false);
      delete pendingIds[id];
      settleOverlap();
      render(before);
      setPanelMessage('削除に失敗しました: ' + err.message, 'error');
    })
    .apiDeletePbi(id, panelState.expectedUpdatedAt);
}

/** 削除を取り消す。元の ID と作成日を保ったまま戻す。 */
function restorePbi(row) {
  if (!row) { setMessage('取り消せませんでした。最新にしてから確認してください。', 'error'); return; }
  setMessage(row.id + ' を戻しています…', 'info');
  if (Object.keys(pendingIds).length > 0) overlapped = true;

  google.script.run
    .withSuccessHandler(function (res) {
      var trustWholeBoard = settleOverlap();
      if (res.ok) {
        render(trustWholeBoard ? res.board : mergeOneCard(board, res.board, row.id));
        setMessage(row.id + ' を戻しました。', 'info');
      } else {
        if (res.board) render(res.board);
        setMessage(res.message, 'error');
      }
    })
    .withFailureHandler(function (err) {
      settleOverlap();
      setMessage('取り消せませんでした: ' + err.message, 'error');
    })
    .apiRestorePbi(row);
}
```

- [ ] **Step 4: 配線する**

`<script>` の末尾に追加:

```javascript
fillButton(document.getElementById('toast-undo'), 'undo', '取り消す');
document.getElementById('panel-delete').addEventListener('click', deletePbi);
```

Task 6 で足した `keydown` に、通知を先に閉じる分岐を足す:

```javascript
document.addEventListener('keydown', function (ev) {
  if (ev.key !== 'Escape') return;
  if (!document.getElementById('toast').hidden) { hideToast(); return; }
  if (!document.getElementById('panel').hidden) closePanel();
});
```

- [ ] **Step 5: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（174 件）

Run: `grep -c 'innerHTML' gas/kanban.html`
Expected: `2`

```bash
git add gas/kanban.html
git commit -m "feat: PBI を削除し、通知から取り消せるようにする"
```

---
### Task 9: DOM シムで応答の到達順を検査する

**Files:**
- Create: `gas/tests/kanban_harness.js`, `gas/tests/kanban_flow.test.js`

**Interfaces:**
- Consumes: `gas/kanban.html` の `<script>`
- Produces: なし

第1段階で、応答の到達順により画面がサーバと食い違う不具合が見つかった。
**コードを読むだけでは見えず、実行して初めて分かった。** 作成・編集・削除・取り消しでも
同じ検査を行う。

- [ ] **Step 1: シムを、次の契約ちょうどに作る**

`gas/tests/kanban_harness.js` に、`kanban.html` の `<script>` を取り出して最小の DOM シムを
載せた `vm` コンテキストで走らせる仕組みを作る。**判定は内部変数ではなく、描画された DOM から読む。**

シムが備える DOM: `document.getElementById` / `createElement` / `createElementNS` /
`addEventListener`、要素の `appendChild` / `textContent` / `className` / `classList` /
`dataset` / `hidden` / `disabled` / `value` / `focus` / `style` / `draggable` / `onclick`、
`setTimeout` / `clearTimeout`、`innerHTML = ''`（**空文字の代入のみ許し、非空文字が来たら例外を投げること**）。

`createHarness(initialColumns)` が返すものの契約:

| 名前 | 意味 |
|---|---|
| `sandbox` | `vm` のコンテキスト。`sandbox.load()` で初期読み込みを起こす |
| `screen()` | 描画済み DOM から `[{status, cards:[id]}]` を読む |
| `drag(id, toStatus)` | 実ハンドラ経由で `dragstart` → `drop` を起こす |
| `click(elementId)` | 要素の `click` ハンドラを呼ぶ |
| `clickAdd(status)` | その列の「追加」ボタンを押す |
| `openCard(id)` | 描画済みカードの `click` を起こす |
| `setValue(fieldId, value)` / `valueOf(fieldId)` | 入力欄の読み書き |
| `hiddenOf(id)` / `disabledOf(id)` / `textOf(id)` | 属性とテキスト |
| `calls` | 未応答の呼び出し `[{method, args, handlers}]`。テスト側が任意の順で `handlers.success(res)` を呼ぶ |
| `boardOf(cols)` | `[{status, cards:[{id,...}]}]` から `{columns:[...]}` を作る |
| `columnsOf(cols)` | 同じものを `[{status, cards:[id]}]` に潰す |

`google.script.run` は呼び出しをキューに積むだけにする。**サーバでの処理順とブラウザへの
到達順を別々に制御できることが要点**で、これが無いと今回の検査は成立しない。

**シムを書いたら、意図的に壊して FAIL することを一度確認すること。**
失敗を検出できない検査は無いのと同じ。

- [ ] **Step 2: 検査を書く**

`gas/tests/kanban_flow.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const INITIAL = [
  { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                           { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
  { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
const fmt = (cols) => cols.map(c => c.status + ':' + c.cards.join(',')).join(' | ');

/** 初期読み込みを済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  h.calls.length = 0;
  return h;
}

test('編集の応答が、送信中の別カードの移動を巻き戻さない', () => {
  // 応答の board は「サーバがその要求を処理した時点」のもので、後から確定した
  // ドラッグの移動を含まない。全体を信じると取り消したはずの移動が復活する。
  const h = ready();
  h.drag('PBI-001', 'Ready');          // 送信中のまま置く
  h.openCard('PBI-002');
  h.setValue('f-title', 'B かいへん');
  h.click('panel-save');

  const save = h.calls[h.calls.length - 1];
  assert.equal(save.method, 'apiUpdatePbi');

  // 編集だけ先に返る。この board に PBI-001 の移動は入っていない。
  save.handlers.success({ ok: true, board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                             { id: 'PBI-002', title: 'B かいへん', updated_at: 'T2' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ]) });

  const cols = h.screen();
  assert.equal(cols[1].cards.indexOf('PBI-001') !== -1, true,
    'PBI-001 が New へ巻き戻された（送信中の移動が消えた）');
});

test('作成の応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.clickAdd('Done');
  h.setValue('f-title', 'あたらしい');
  h.click('panel-save');

  const create = h.calls[h.calls.length - 1];
  assert.equal(create.method, 'apiCreatePbi');
  assert.equal(create.args[0].status, 'Done', '列の文脈がステータスに入っていない');

  create.handlers.success({ ok: true, id: 'PBI-003', board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' },
                             { id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] },
    { status: 'Done', cards: [{ id: 'PBI-003', title: 'あたらしい', updated_at: 'T2' }] },
  ]) });

  const cols = h.screen();
  assert.ok(cols[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.ok(cols[4].cards.indexOf('PBI-003') !== -1, '作った PBI が出ていない');
});

test('削除の応答が、送信中の別カードの移動を巻き戻さない', () => {
  const h = ready();
  h.drag('PBI-001', 'Ready');
  h.openCard('PBI-002');
  h.click('panel-delete');

  const del = h.calls[h.calls.length - 1];
  assert.equal(del.method, 'apiDeletePbi');

  del.handlers.success({ ok: true, removed: { id: 'PBI-002', title: 'B' }, board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ]) });

  const cols = h.screen();
  assert.ok(cols[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 の移動が消えた');
  assert.equal(cols[0].cards.indexOf('PBI-002'), -1, '消したカードが残っている');
});

test('削除に確認ダイアログを挟まず、即座に送信する', () => {
  // モーダルは操作を制限し順序を固定するため置かない（フェイルセーフで受ける）。
  const h = ready();
  h.openCard('PBI-001');
  const before = h.calls.length;
  h.click('panel-delete');
  assert.equal(h.calls.length, before + 1, '削除が送信されていない');
  assert.equal(h.calls[before].method, 'apiDeletePbi');
});

test('削除のあと通知から取り消せ、元の ID のまま戻る', () => {
  const h = ready();
  h.openCard('PBI-002');
  h.click('panel-delete');
  const removed = { id: 'PBI-002', title: 'B', created_at: '2026-09-01', updated_at: 'T1' };
  h.calls[h.calls.length - 1].handlers.success({ ok: true, removed: removed, board: h.boardOf([
    { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1' }] },
    { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
    { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
  ]) });

  assert.equal(h.hiddenOf('toast'), false, '取り消しの通知が出ていない');
  assert.ok(h.textOf('toast-text').indexOf('PBI-002') !== -1);

  const before = h.calls.length;
  h.click('toast-undo');
  assert.equal(h.calls.length, before + 1);
  const restore = h.calls[before];
  assert.equal(restore.method, 'apiRestorePbi', 'apiCreatePbi では ID が変わってしまう');
  assert.equal(restore.args[0].id, 'PBI-002');
  assert.equal(restore.args[0].created_at, '2026-09-01', '作成日が失われている');
});

test('検証エラーではパネルが閉じず、入力が残る', () => {
  const h = ready();
  h.clickAdd('New');
  h.setValue('f-title', '');
  h.setValue('f-description', '書きかけの説明');
  h.click('panel-save');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: false, reason: 'invalid', message: 'タイトルを入力してください。', board: null });

  assert.equal(h.hiddenOf('panel'), false, 'パネルが閉じてしまった');
  assert.equal(h.valueOf('f-description'), '書きかけの説明', '入力が消えた');
  assert.ok(h.textOf('panel-message').indexOf('タイトル') !== -1);
});

test('送信中は保存と削除が押せない', () => {
  const h = ready();
  h.openCard('PBI-001');
  h.click('panel-save');
  assert.equal(h.disabledOf('panel-save'), true, '二重送信できてしまう');
  assert.equal(h.disabledOf('panel-delete'), true);
});

test('列の追加ボタンは、その列のステータスを初期値にする', () => {
  const h = ready();
  h.clickAdd('Review');
  assert.equal(h.hiddenOf('panel'), false);
  assert.equal(h.valueOf('f-status'), 'Review', '列の文脈が初期値に入っていない');
});

test('パネルを開いてもドラッグできる（モードレス）', () => {
  // オーバーレイで盤面を覆わない。操作を制限しない。
  const h = ready();
  h.openCard('PBI-001');
  const before = h.calls.length;
  h.drag('PBI-002', 'Done');
  assert.equal(h.calls.length, before + 1, 'パネルを開くとドラッグできなくなっている');
});
```

- [ ] **Step 3: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（174 + 9 = 183 件）

不一致が出たら、それは実装の不具合である。`mergeOneCard` / `settleOverlap` に
作成・編集・削除・取り消しを載せ切れていない可能性が高い。

- [ ] **Step 4: コミット**

```bash
git add gas/tests/kanban_flow.test.js gas/tests/kanban_harness.js
git commit -m "test: 作成・編集・削除・取り消しでも応答の到達順を検査する"
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

- 作成は各列の「追加」から。その列のステータスで作られる
- **削除に確認は出ない。消したあと通知から取り消せる**（一定時間で消える）
- 終わった PBI は削除ではなく Done へ移すこと
- 状態はドラッグでもプルダウンでも変えられること（タッチ端末ではプルダウンを使う）
- 詳細を開いたままドラッグできること

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
`node scripts/publish.js <配布先>` での再配布が必要。

- [ ] **Step 5: コミット**

```bash
git add README.md docs/setup.md CLAUDE.md docs/superpowers/specs/2026-09-04-web-app-design.md
git commit -m "docs: 第2段階でできるようになったことを反映する"
```

---

## 実装後に人が確かめること

自動テストが届かない。**実装の完了条件ではなく、リリース前の確認項目**である。

- 詳細パネルの開閉、作成・編集・削除の一連の流れ
- **削除したあと通知から取り消せること。戻した PBI の ID が変わっていないこと**
- **詳細を開いたままカードをドラッグできること**（モードレス）
- **幅の狭い画面（900px 未満）で列が縦に積まれること**
- 列の「追加」から作ると、その列のステータスで作られること
- ダークモードでの表示（OS の外観設定を切り替える）
- タッチ端末で、プルダウンから状態を変えられること
- ブラウザのコンソールで `google.script.run.withBacklogWrite_(function(){})` が
  **呼べない**こと（`_` 付きの内部関数がブラウザから届かないことの確認）
- 閲覧者権限のアカウントで作成・削除を試し、日本語の案内が出ること
- 画面の拡大（ブラウザのズーム 200%）でパネルが破綻しないこと
