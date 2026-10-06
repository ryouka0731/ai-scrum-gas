# Web アプリ 第6段階（変更履歴と差分表示）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web アプリからの変更を `scrum/change_log.csv` に項目単位で記録し、パネルの「履歴」で差分として見られるようにする。

**Architecture:** 差分と表示用の整形は純関数（`gas/pure_history.js`）。記録は3つの書き込み口
（`withBacklogWrite_` / `withImpedimentWrite_` / `withCommentWrite_`）が、本体の書き込みが成功した後に
同じロックの中で行う（失敗しても本体は成功のまま、`historyWarning` を返す）。読み取りは `apiGetHistory(targetId)` だけ。

**Tech Stack:** Google Apps Script（V8）、素の JS + HTML、`node --test`、DOM シム、実ブラウザ検査。

**Spec:** `docs/superpowers/specs/2026-10-07-web-app-phase6-design.md`

## Global Constraints

- 既存の CSV の列構造は変えない。新しいファイル `scrum/change_log.csv` の列は `id,at,actor,target_id,action,field,before,after`
- `action` は `create` / `update` / `delete` / `restore` / `resolve` / `unresolve` / `comment_add` / `comment_delete` / `comment_restore` のいずれか
- `updated_at` / `created_at` は記録しない。コメントの本文は記録しない
- 履歴の追記に失敗しても本体の書き込みは失敗にしない。応答に `historyWarning: '変更履歴を記録できませんでした（…）'` を載せる
- ブラウザへ公開する新しい関数は `apiGetHistory` の1つだけ。補助関数は末尾 `_`
- `gas/*.js` は1つのグローバルスコープ（`gas_load.test.js`）。const の取り込みは `globalThis.X = require(...).X`、関数は `var { fn } = require(...)`
- ユーザー由来の文字列は `textContent`。CSS は既存トークンのみ（新しいトークン・`var(--x, fallback)` を作らない）。消えた行は `--danger`、足した行は `--accent`
- 盤面の会計（`inflight` / `overlapped` / `pendingIds`）と `writeSeq` の意味を変えない
- 日本語。UTF-8

## Review Focus

1. **`change_log.csv` が Drive に無い（配布前）**: PBI・障害物・コメントの操作は普段どおり成功し、画面に「変更履歴を記録できませんでした」が出る（Task 2）
2. **障害物の解決が2ファイル目で止まった（`partial`）→「完了する」で完了**: `resolve` は1回だけ記録される（Task 2）
3. **ドラッグで状態だけ変えた**: `status` の `update` 1行だけで、`updated_at` は出ない（Task 2）
4. **履歴の応答が、別のパネルへ移った後に届く**: 今開いているパネルに他の対象の履歴を描かない（Task 3）
5. **説明を大きく書き換えた**: 行単位の差分で、消えた行と足した行が区別でき、パネルの操作部に届く（Task 3 / Task 4）

---

## File Structure

| ファイル | 種別 | 責務 |
|---|---|---|
| `scrum/change_log.csv` | 新規 | 雛形（ヘッダー行のみ） |
| `gas/pure_history.js` | 新規 | 列定義・`diffRows`・`historyRows`・`historyFor`・`groupHistory`・`lineDiff` |
| `gas/pure_write_guard.js` | 変更 | 許可リストに `change_log.csv` |
| `scripts/publish.js` | 変更 | `KEEP_IF_EXISTS` に `scrum/change_log.csv` |
| `gas/web_app.js` | 変更 | `appendHistory_`・3つの書き込み口での記録・`apiGetHistory` |
| `gas/kanban.html` | 変更 | 両パネルの「履歴」節 |
| `gas/tests/kanban_harness.js` | 変更 | `API_METHODS` に `apiGetHistory`、履歴節を操作するヘルパー |
| `CLAUDE.md` / `README.md` / `docs/setup.md` | 変更 | 案内 |

---

### Task 1: 履歴の純関数と雛形

**Files:**
- Create: `scrum/change_log.csv`（内容は `id,at,actor,target_id,action,field,before,after` と改行のみ）
- Create: `gas/pure_history.js`
- Test: `gas/tests/pure_history.test.js`

**Interfaces:**
- Produces:
  - `HISTORY_FIELDS = ['id','at','actor','target_id','action','field','before','after']`
  - `HISTORY_ACTIONS`（上の9つの配列）、`HISTORY_TARGET_RE = /^(PBI|IMP)-\d+$/`、`HISTORY_LIMIT = 200`、`LINE_DIFF_MAX = 500`
  - `diffRows(beforeRows, afterRows, fields, ignore) → [{ target_id, action:'create'|'delete'|'update', field?, before?, after? }]`
    （キーは `id`（trim）。`fields` のうち `ignore` に無い列だけ比べる。`update` は列ごとに1件。並びは after の行順、消えた行はその後に before の行順）
  - `historyRows(events, meta) → rows`（`meta = { at, actor, newId }`。`newId()` は呼ぶたびに新しい `CHG-xxxxxxxx` を返す関数。
    `create`/`delete`/`resolve` 等は `field`/`before`/`after` を空にする）
  - `historyFor(rows, targetId, limit) → entries`（`target_id` が一致する行を `at` の新しい順、同じ `at` は元の並びを保つ。最大 `limit` 件。
    各要素は `{ at, actor, action, field, before, after }`）
  - `groupHistory(entries) → [{ at, actor, items: [entry] }]`（連続する同じ `at`+`actor` をまとめる）
  - `lineDiff(before, after) → [{ op:'same'|'del'|'add', text }]`（`\n` で行に割り、LCS。どちらかが `LINE_DIFF_MAX` 行を超えたら
    before の全行を `del`、after の全行を `add` で返す）

- [ ] **Step 1: 失敗するテストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('../pure_history.js');

const F = ['id', 'title', 'status', 'updated_at'];
const r = (over) => Object.assign({ id: 'PBI-001', title: 'A', status: 'New', updated_at: 'T1' }, over || {});

test('列と操作の名前', () => {
  assert.deepEqual(h.HISTORY_FIELDS, ['id', 'at', 'actor', 'target_id', 'action', 'field', 'before', 'after']);
  assert.deepEqual(h.HISTORY_ACTIONS, ['create', 'update', 'delete', 'restore', 'resolve', 'unresolve',
    'comment_add', 'comment_delete', 'comment_restore']);
});

test('diffRows: 変わった列ごとに update。無視する列は出ない。変化なしは空', () => {
  assert.deepEqual(h.diffRows([r()], [r({ status: 'Ready', updated_at: 'T2' })], F, ['updated_at']),
    [{ target_id: 'PBI-001', action: 'update', field: 'status', before: 'New', after: 'Ready' }]);
  assert.deepEqual(h.diffRows([r()], [r({ updated_at: 'T2' })], F, ['updated_at']), []);
});

test('diffRows: 増えた行は create、消えた行は delete。id は trim して突き合わせる', () => {
  assert.deepEqual(h.diffRows([r()], [r({ id: ' PBI-001 ' }), r({ id: 'PBI-002' })], F, ['updated_at']),
    [{ target_id: 'PBI-002', action: 'create' }]);
  assert.deepEqual(h.diffRows([r(), r({ id: 'PBI-002' })], [r()], F, []), [{ target_id: 'PBI-002', action: 'delete' }]);
});

test('diffRows: undefined と空文字は同じ。複数列の変更は列の順', () => {
  assert.deepEqual(h.diffRows([r({ title: undefined })], [r({ title: '' })], F, []), []);
  assert.deepEqual(h.diffRows([r()], [r({ title: 'B', status: 'Done' })], F, []).map((e) => e.field), ['title', 'status']);
});

test('historyRows: 共通の時刻と書いた人、行ごとに新しい id', () => {
  let n = 0;
  const rows = h.historyRows(
    [{ target_id: 'PBI-001', action: 'update', field: 'title', before: 'A', after: 'B' }, { target_id: 'PBI-002', action: 'create' }],
    { at: '2026-10-07 10:00:00', actor: 'me@x.jp', newId: () => 'CHG-0000000' + (++n) });
  assert.deepEqual(rows, [
    { id: 'CHG-00000001', at: '2026-10-07 10:00:00', actor: 'me@x.jp', target_id: 'PBI-001', action: 'update', field: 'title', before: 'A', after: 'B' },
    { id: 'CHG-00000002', at: '2026-10-07 10:00:00', actor: 'me@x.jp', target_id: 'PBI-002', action: 'create', field: '', before: '', after: '' },
  ]);
});

test('historyFor: 対象で絞り、新しい順、同じ時刻は元の並び、上限', () => {
  const row = (id, at, field) => ({ id: id, at: at, actor: 'a', target_id: 'PBI-001', action: 'update', field: field, before: '', after: '' });
  const rows = [row('CHG-1', '2026-10-07 09:00:00', 'title'), row('CHG-2', '2026-10-07 10:00:00', 'title'),
    row('CHG-3', '2026-10-07 10:00:00', 'status'), Object.assign(row('CHG-4', '2026-10-07 11:00:00', 'x'), { target_id: 'PBI-002' })];
  assert.deepEqual(h.historyFor(rows, 'PBI-001', 200).map((e) => e.field), ['title', 'status', 'title']);
  assert.equal(h.historyFor(rows, 'PBI-001', 2).length, 2);
  assert.deepEqual(Object.keys(h.historyFor(rows, 'PBI-001', 1)[0]).sort(), ['action', 'actor', 'after', 'at', 'before', 'field']);
});

test('groupHistory: 連続する同じ時刻と書いた人をまとめる', () => {
  const e = (at, actor, field) => ({ at: at, actor: actor, action: 'update', field: field, before: '', after: '' });
  const g = h.groupHistory([e('T2', 'a', 'title'), e('T2', 'a', 'status'), e('T2', 'b', 'title'), e('T1', 'a', 'title')]);
  assert.deepEqual(g.map((x) => [x.at, x.actor, x.items.length]), [['T2', 'a', 2], ['T2', 'b', 1], ['T1', 'a', 1]]);
});

test('lineDiff: 同じ・足した・消した・入れ替え', () => {
  assert.deepEqual(h.lineDiff('a\nb', 'a\nb'), [{ op: 'same', text: 'a' }, { op: 'same', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a', 'a\nb'), [{ op: 'same', text: 'a' }, { op: 'add', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a\nb', 'b'), [{ op: 'del', text: 'a' }, { op: 'same', text: 'b' }]);
  assert.deepEqual(h.lineDiff('a\nx\nc', 'a\ny\nc'),
    [{ op: 'same', text: 'a' }, { op: 'del', text: 'x' }, { op: 'add', text: 'y' }, { op: 'same', text: 'c' }]);
  assert.deepEqual(h.lineDiff('', 'a'), [{ op: 'add', text: 'a' }]);
  assert.deepEqual(h.lineDiff('a', ''), [{ op: 'del', text: 'a' }]);
});

test('lineDiff: 上限を超えたら丸ごと del / add', () => {
  const big = Array.from({ length: 501 }, (_, i) => 'l' + i).join('\n');
  const d = h.lineDiff(big, 'x');
  assert.equal(d.filter((x) => x.op === 'del').length, 501);
  assert.deepEqual(d[d.length - 1], { op: 'add', text: 'x' });
});
```

`lineDiff('', 'a')` は空の前を「0行」とみなし `[{ op:'add', text:'a' }]` を返す（同様に後が空なら前の全行が `del`）。

- [ ] **Step 2: 失敗を確認** — `node --test gas/tests/pure_history.test.js` → FAIL

- [ ] **Step 3: 実装**（`gas/pure_history.js`。既存の `pure_comment.js` と同じ書き方。トップレベル名は `HISTORY_*` / `LINE_DIFF_MAX` / 関数名、補助は `hist*_`。
  `lineDiff` は行配列 a, b の LCS 表（(n+1)×(m+1)）を作り、末尾から辿って `same`/`del`/`add` を組み、逆順にして返す。
  同じ長さの選択では `del` を `add` より先に出す（上のテストの「入れ替え」の順）。空文字は0行として扱う）

- [ ] **Step 4: 通過を確認** — `node --test gas/tests/pure_history.test.js gas/tests/gas_load.test.js` → PASS
- [ ] **Step 5: コミット** — `feat: 変更履歴の純関数と change_log.csv の雛形を足す`

---

### Task 2: サーバで記録し、読めるようにする

**Files:**
- Modify: `gas/pure_write_guard.js`、`scripts/publish.js`、`gas/web_app.js`
- Test: `gas/tests/pure_write_guard.test.js`、`gas/tests/scripts_publish.test.js`、`gas/tests/web_app_flow.test.js`

**Interfaces:**
- Consumes: Task 1 の全関数
- Produces:
  - 成功した書き込みの応答に、記録に失敗したときだけ `historyWarning`（文字列）
  - `apiGetHistory(targetId) → { ok:true, entries } | { ok:false, reason:'invalid', message }`

設計（binding）:

```js
const HISTORY_CSV_NAME = 'change_log.csv';

function newHistoryId_() {
  return 'CHG-' + String(Utilities.getUuid()).replace(/-/g, '').slice(0, 8).toLowerCase();
}

/**
 * 履歴を追記する。呼び出し側のロックの中で呼ぶこと。失敗しても例外を投げず、
 * 画面に出す警告の文字列を返す（成功・記録なしは null）。本体の書き込みは既に済んでいる。
 */
function appendHistory_(events) {
  if (!events || events.length === 0) return null;
  try {
    const text = readTextFile_(getScrumFolder_(), HISTORY_CSV_NAME);
    if (text === null) return '変更履歴を記録できませんでした（scrum/' + HISTORY_CSV_NAME + ' が見つかりません。配布し直してください）';
    assertHeaderMatches(text, HISTORY_FIELDS);
    const rows = csvToObjects(text).concat(historyRows(events, { at: nowText_(), actor: currentUserEmail_(), newId: newHistoryId_ }));
    writeScrumFile_(HISTORY_CSV_NAME, toCsv(rows, HISTORY_FIELDS));
    return null;
  } catch (e) {
    return '変更履歴を記録できませんでした（' + e.message + '）';
  }
}
```

- `withBacklogWrite_`: 本体の `writeScrumFile_` の後で
  `events = diffRows(rows, result.rows, BACKLOG_FIELDS, ['updated_at', 'created_at'])`。
  `result.historyAction`（mutate が返す。`apiRestorePbi` は `'restore'`）があれば、`create` の event の action をそれに置き換える。
  `const warning = appendHistory_(events)`。成功の応答に `warning` があれば `historyWarning: warning`
- `withImpedimentWrite_`: mutate の結果に `historyKind`（`'diff'` / `'resolve'` / `'unresolve'`）と `historyId` を持たせる
  - `'diff'`（作成・編集）: 書いた後に `diffRows(openBefore, openAfter, IMPEDIMENT_FIELDS, [])`
  - `'resolve'`: **この呼び出しで解決済ファイルへの書き込みが成功したときだけ** `[{ target_id: historyId, action: 'resolve' }]`
    （`partial` でも1つ目＝解決済は書けているので記録する。完了の再送で解決済を書かなかったときは記録しない）
  - `'unresolve'`: この呼び出しで未解決ファイルへの書き込みが成功したときだけ `[{ target_id: historyId, action: 'unresolve' }]`
  - 記録は `ok` / `partial` のどちらの応答でも行い、`historyWarning` を載せる
- `withCommentWrite_`: mutate の結果に `history: [{ target_id, action }]` を持たせ、本体を書いたとき（`result.rows` があるとき）だけ記録する。
  追加 `comment_add`、削除 `comment_delete`（対象は消したコメントの `target_id`）、戻し `comment_restore`（`unchanged` のときは記録しない）
- `apiGetHistory(targetId)`: `String(targetId||'').trim()` が `HISTORY_TARGET_RE` に合わなければ `invalid`。
  `historyFor(readCsvRowsBestEffort_(HISTORY_CSV_NAME), id, HISTORY_LIMIT)` を返す。ロックは取らない（読み取りのみ）
- `pure_write_guard.js` の許可リストに `'change_log.csv'`。`scripts/publish.js` の `KEEP_IF_EXISTS` に `'scrum/change_log.csv'`

- [ ] **Step 1: 失敗するテストを書く**（`web_app_flow.test.js`。`createTestContext` の `Utilities.getUuid` / `opts.uuids` / `Session.getActiveUser` は第5段階で用意済み）
  1. `apiUpdateStatus` → `change_log.csv` に `status` の `update` 1行。`updated_at` の行は無い。`actor` はログイン中のメール
  2. `apiCreatePbi` → `create` 1行。`apiDeletePbi` → `delete`。`apiRestorePbi` → `restore`（`create` ではない）
  3. `apiUpdatePbi` で2項目変更 → 2行、同じ `at`
  4. 障害物: 作成 `create`、編集 `update`、解決 `resolve` 1行、取り消し `unresolve` 1行
  5. 障害物の解決が2ファイル目で失敗（`failWriteFile: 'impediment_log.csv'`）→ `resolve` 1行。続く完了の再送では行が増えない
  6. コメント: 追加 `comment_add`、削除 `comment_delete`、戻し `comment_restore`。どの行にも本文が無い（`before`/`after` が空）
  7. `change_log.csv` が無い → 本体は成功（盤面が変わる）し `historyWarning` に「配布し直してください」
  8. 履歴のヘッダーが違う → 本体は成功、`historyWarning`、`change_log.csv` は変わらない
  9. `apiGetHistory('PBI-001')` が新しい順の `entries`。`apiGetHistory('x')` は `invalid`。ファイルが無ければ `entries` は空
  - `pure_write_guard.test.js`: `change_log.csv` が書ける
  - `scripts_publish.test.js`: `KEEP_IF_EXISTS` の一覧の検査（第5段階の「4ファイル」）を5つに直し、`change_log.csv` も中身があれば残すことを確かめる

- [ ] **Step 2: 失敗を確認** — 該当テストが FAIL
- [ ] **Step 3: 実装**（上の設計どおり）
- [ ] **Step 4: 通過を確認** — `npm test` → PASS
- [ ] **Step 5: コミット** — `feat: Web アプリからの変更を change_log.csv に記録し、apiGetHistory で読めるようにする`

---

### Task 3: 画面（パネルの「履歴」節）

**Files:**
- Modify: `gas/kanban.html`、`gas/tests/kanban_harness.js`
- Test: `gas/tests/kanban_history.test.js`（新規）

**Interfaces:**
- Consumes: `apiGetHistory` と、書き込みの応答の `historyWarning`
- Produces（DOM）: `#panel-history` / `#imp-panel-history`（各パネルのコメント節の直前）。中に開閉ボタン `button.history-toggle`
  （`aria-expanded`）、本体 `.history-body`（初めは `hidden`）、注記「Web アプリからの変更だけを記録しています」、
  まとまり `.history-group`（見出し `.history-head`）、項目 `.history-item`、行差分 `.history-line.del` / `.history-line.add` / `.history-line.same`
- ハーネスに `historyToggle(hostId)`、`historyGroupsIn(hostId) → [{ head, items:[text] }]`、`historyLinesIn(hostId) → [{ op, text }]` を足す

設計:
- 新規作成中のパネルでは節を出さない（`hidden`）
- 開いたときに `apiGetHistory(targetId)` を呼ぶ（読み込み中は「読み込んでいます…」）。閉じて開き直したら取り直す。
  応答が届いたとき、その節がまだ同じ対象で開いていなければ描かない（`historyReq` の通し番号と対象で判定）
- パネルを開き直す・別の対象に移ると、節は閉じた状態に戻る
- 描き方: `groupHistory(entries)` 相当を画面側で行う（`pure_history.js` は GAS 側の関数なので、同じ規則の小さな関数を画面に置き、
  規則が1つであることをテストで縛る — 画面のまとまりと `groupHistory` の結果が同じ見本で一致すること）
  - 見出し: 日時・書いた人（`@` の前。空なら「不明」）・操作名（作成 / 変更 / 削除 / 削除の取り消し / 解決 / 解決の取り消し / コメント追加 / コメント削除 / コメント削除の取り消し）
  - `update`: 「項目名: 前 → 後」。項目名は画面の言葉（タイトル・説明・受入基準・ステータス・優先度・ポイント・スプリント・報告者・報告日・解決日・解決策）。空は「（空）」
  - 説明・受入基準・解決策（複数行になりうる列）は行差分。画面側の `lineDiff` も `pure_history.js` と同じ結果になることをテストで縛る
    （画面の関数を `scriptSource()` から取り出して同じ入力で比べる、等）
  - 消えた行は `--danger` と取り消し線と行頭「−」、足した行は `--accent` と行頭「＋」。`textContent` のみ
- 履歴が0件: 「まだ履歴がありません」
- 失敗: 節の中に「履歴を読み込めませんでした: …」
- 書き込みの応答に `historyWarning` があれば、全体メッセージ（`setMessage(..., 'error')`）に出す。PBI・障害物・コメントの全書き込みの成功分岐で
- 節が開いている対象に書き込みが成功したら、履歴を取り直す（開いていなければ何もしない）

- [ ] **Step 1: 失敗するテストを書く**（1テスト1振る舞い）
  1. カードのパネルに履歴の節があり閉じている。新規作成中は隠れている
  2. 開くと `apiGetHistory(id)` を1回だけ呼ぶ。応答でまとまりが新しい順に出る
  3. `update` の1行の値は「タイトル: A → B」。空は「（空）」
  4. 説明の差分で、消えた行と足した行が `del`/`add` で出る（行頭の記号つき）、`<b>` は文字のまま
  5. 応答が届く前に別のカードへ移ると、届いた応答を描かない
  6. 閉じて開き直すと取り直す
  7. 0件で「まだ履歴がありません」、失敗で「履歴を読み込めませんでした」
  8. 書き込みの応答の `historyWarning` が全体メッセージに出る（PBI 保存・障害物保存・コメント追加のそれぞれ）
  9. 履歴を開いたまま同じ対象を保存すると取り直す
  10. 障害物のパネルにも同じ節（`#imp-panel-history`）
  11. 画面の `lineDiff` / まとまりの規則が `pure_history.js` と同じ結果（同じ見本で比べる）

- [ ] **Step 2: 失敗を確認** → FAIL
- [ ] **Step 3: 実装**
- [ ] **Step 4: 通過を確認** — `npm test` → PASS（`[hidden]` を持つ要素の一覧などの静的検査は、守る内容を弱めずに更新）
- [ ] **Step 5: コミット** — `feat: パネルで変更履歴を差分として見られるようにする`

---

### Task 4: 実ブラウザの検査

**Files:**
- Modify: `gas/tests/browser/fixtures.js`、`gas/tests/browser/standalone_page.js`（`apiGetHistory` の応答を返せるようにする）、`gas/tests/browser/probe_source.js`、`gas/tests/browser/measure.js`、`gas/tests/browser/kanban_browser.test.js`

- [ ] **Step 1:** 見本に、ある PBI の長い履歴（`historyFor` で組み立てる。説明の大きな書き換え・長い URL を含む `update` を数十件）を用意し、`apiGetHistory` がそれを返すようにする
- [ ] **Step 2:** そのカードのパネルで履歴を開き、(a) `#panel-save` に届く（第5段階と同じ判定）、(b) `.history-line` の長い URL が節の幅を超えない、(c) ページが横に伸びない、を測る
- [ ] **Step 3:** 全幅・全配色で判定。わざと `.history-line` の `overflow-wrap` を消すと (b) が落ちることを確かめる（コミットしない）
- [ ] **Step 4:** `npm run test:browser` と `npm test` → PASS
- [ ] **Step 5:** コミット — `test: 長い変更履歴のパネルを実ブラウザで検査する`

---

### Task 5: 文書

**Files:** `CLAUDE.md`、`README.md`、`docs/setup.md`

- [ ] **Step 1:** `CLAUDE.md` — Web アプリが書くファイルに `change_log.csv` を足す（5ファイル。うち `change_log.csv` は追記のみ）。
  「Web アプリからの変更の履歴は `scrum/change_log.csv`。エージェントは読むだけでよく、書かない」を1行
- [ ] **Step 2:** `README.md` — パネルの「履歴」で、いつ・誰が・何を変えたかを差分で見られること。Web アプリからの変更だけが記録されること
- [ ] **Step 3:** `docs/setup.md` — 書き戻すファイルの一覧に足す。配布し直すまでは履歴が記録されず警告が出ること
- [ ] **Step 4:** `git grep -n -e "4ファイル" -e "4つ" -- CLAUDE.md README.md docs/setup.md` 等でファイル数を述べた箇所を全件揃える。`docs/superpowers/` は触らない
- [ ] **Step 5:** `npm test` → PASS。コミット — `docs: 変更履歴の案内を足す`

---

## 仕上げ

- `npm run test:all`
- PR → bot のレビューを triage → マージ
- `clasp push` と Web アプリの再デプロイ
- `node scripts/publish.js` で `scrum/change_log.csv` を配布（共有フォルダのパスが要る）
