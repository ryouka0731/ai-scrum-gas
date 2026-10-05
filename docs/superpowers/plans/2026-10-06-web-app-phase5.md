# Web アプリ 第5段階（コメント・議論のスレッド）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PBI と障害物にコメントを付け、読み・書き・自分のものを消せるようにする。保存先は `scrum/comments.csv`。

**Architecture:** ロジックは `gas/pure_comment.js`（純関数）。`web_app.js` はロック・読み直し・ヘッダー検査・書き込みと、
ログイン中のメール・UUID の取得だけを担う。読み取りは既存の `apiGetView` の応答に `comments` を載せる。
画面はパネル（PBI・障害物）に共通のコメント節を描く。

**Tech Stack:** Google Apps Script（V8）、素の JS + HTML（`kanban.html`）、`node --test`、DOM シム、実ブラウザ検査（Chrome + CDP）。

**Spec:** `docs/superpowers/specs/2026-10-06-web-app-phase5-design.md`

## Global Constraints

- 既存の CSV の列構造は変えない。新しいファイル `scrum/comments.csv` の列は `id,target_id,author,created_at,body`
- 成果物・コメント・メッセージは日本語。UTF-8
- `gas/*.js` は1つのグローバルスコープ（`gas_load.test.js`）。新しいトップレベル名は衝突させない。const の取り込みは `globalThis.X = require(...).X`（同名の `var` を作らない）、関数は `var { fn } = require(...)`
- `pure_*.js` は GAS API に依存しない
- 書き込みは `LockService` のスクリプトロック内で、読み直した内容に対して行う。書く前にヘッダーを検査する
- ブラウザへ公開する新しい関数は `apiAddComment` / `apiDeleteComment` / `apiRestoreComment` の3つだけ。補助関数は末尾 `_`
- 本文は 1〜2000 字（前後の空白を除いて1字以上）。`target_id` は `^(PBI|IMP)-\d+$`
- 削除はサーバ側で `author` とログイン中のメールの一致を確かめる（画面の `mine` を信じない）
- ユーザー由来の文字列は `textContent`。新しい CSS は既存トークンのみ（`var(--x, fallback)` を書かない）
- 盤面の会計（`inflight` / `overlapped` / `pendingIds`）に触らない

## Review Focus

1. **`comments.csv` が Drive に無い（配布前）**: 盤面・障害物は今までどおり出る（コメントは空）。書き込みは「scrum/comments.csv が見つかりません。配布し直してください」で止まる（Task 2）
2. **他人のコメントの削除を、ブラウザのコンソールから直接呼ぶ**: `forbidden` で拒否し、ファイルを変えない（Task 1 / Task 2）
3. **コメントが多いとパネルが縦に伸び、保存・解決ボタンが押せなくなる**: パネルは自分の中で縦にスクロールし、ボタンに届く（Task 3 / Task 4）
4. **コメントの書き込み中に別のパネルへ移る／応答が逆順で届く**: 古い応答で表示が戻らず、今開いているパネルのコメントが正しく出る（Task 3）
5. **改行や `<script>` を含む本文**: 改行を保ったまま文字として出る（Task 3）

---

## File Structure

| ファイル | 種別 | 責務 |
|---|---|---|
| `scrum/comments.csv` | 新規 | 雛形（ヘッダー行のみ） |
| `gas/pure_comment.js` | 新規 | 列定義・検証・追記・削除・戻し・対象ごとのまとめ |
| `gas/pure_write_guard.js` | 変更 | 許可リストに `comments.csv` |
| `gas/web_app.js` | 変更 | `withCommentWrite_`・3 API・ビューの応答に `comments` |
| `gas/kanban.html` | 変更 | パネルのコメント節・カードと障害物一覧の件数 |
| `gas/tests/kanban_harness.js` | 変更 | `API_METHODS` に3つ |
| `CLAUDE.md` / `README.md` / `docs/setup.md` / `.claude/skills/sprint-review/SKILL.md` / `.claude/skills/backlog-refinement/SKILL.md` | 変更 | 案内 |

---

### Task 1: コメントの純関数と雛形

**Files:**
- Create: `scrum/comments.csv`（内容は `id,target_id,author,created_at,body` と改行のみ）
- Create: `gas/pure_comment.js`
- Test: `gas/tests/pure_comment.test.js`

**Interfaces:**
- Produces:
  - `COMMENT_FIELDS = ['id','target_id','author','created_at','body']`
  - `COMMENT_TARGET_RE = /^(PBI|IMP)-\d+$/`、`COMMENT_ID_RE = /^CMT-[0-9a-f]{8}$/`、`COMMENT_BODY_MAX = 2000`
  - `validateComment(targetId, body) → { ok, errors }`
  - `appendComment(rows, id, targetId, author, body, nowText) → { ok:true, rows, comment }`
  - `deleteComment(rows, id, me) → { ok:true, rows, removed } | { ok:false, reason:'not_found'|'forbidden' }`
  - `restoreComment(rows, row) → { ok:true, rows } | { ok:false, reason:'invalid' }`（同じ id があれば `rows` は変えずに ok:true・`unchanged:true`）
  - `groupComments(rows, me) → { [target_id]: [{ id, target_id, author, created_at, body, mine }] }`（各対象の中は `created_at` 昇順、同じなら元の並び。`target_id` が形に合わない行は捨てる）

- [ ] **Step 1: 失敗するテストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../pure_comment.js');

const row = (over) => Object.assign({ id: 'CMT-0000000a', target_id: 'PBI-001', author: 'a@x.jp',
  created_at: '2026-10-06 10:00:00', body: 'はじめ' }, over || {});

test('列は5つ', () => {
  assert.deepEqual(c.COMMENT_FIELDS, ['id', 'target_id', 'author', 'created_at', 'body']);
});

test('検証: 対象の形・空・2000字超', () => {
  assert.equal(c.validateComment('PBI-001', 'よい').ok, true);
  assert.equal(c.validateComment('IMP-002', 'よい').ok, true);
  assert.deepEqual(c.validateComment('PBI-001', '  ').errors, ['コメントを入力してください。']);
  assert.deepEqual(c.validateComment('PBI-001', 'あ'.repeat(2001)).errors, ['コメントは2000字以内で入力してください。']);
  assert.equal(c.validateComment('PBI-001', 'あ'.repeat(2000)).ok, true);
  assert.deepEqual(c.validateComment('X-1', 'よい').errors, ['コメントの対象が不正です: X-1']);
  assert.equal(c.validateComment(null, null).ok, false);
});

test('追記: 末尾に足し、引数を変えない', () => {
  const rows = [row()];
  const r = c.appendComment(rows, 'CMT-0000000b', 'PBI-001', 'b@x.jp', '次', '2026-10-06 11:00:00');
  assert.equal(r.ok, true);
  assert.deepEqual(r.comment, { id: 'CMT-0000000b', target_id: 'PBI-001', author: 'b@x.jp', created_at: '2026-10-06 11:00:00', body: '次' });
  assert.equal(r.rows.length, 2);
  assert.equal(rows.length, 1);
});

test('削除: 本人だけ。他人は forbidden、無ければ not_found', () => {
  const r = c.deleteComment([row()], 'CMT-0000000a', 'a@x.jp');
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.removed, row());
  assert.equal(c.deleteComment([row()], 'CMT-0000000a', 'b@x.jp').reason, 'forbidden');
  assert.equal(c.deleteComment([row()], 'CMT-0000000a', '').reason, 'forbidden');
  assert.equal(c.deleteComment([row()], 'CMT-ffffffff', 'a@x.jp').reason, 'not_found');
});

test('戻し: 元の id と日時のまま末尾へ。既にあれば変えない。形が不正なら invalid', () => {
  const r = c.restoreComment([], row());
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, [row()]);
  const again = c.restoreComment([row()], row());
  assert.equal(again.ok, true);
  assert.equal(again.unchanged, true);
  assert.equal(again.rows.length, 1);
  assert.equal(c.restoreComment([], row({ id: 'x' })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ target_id: 'x' })).reason, 'invalid');
  assert.equal(c.restoreComment([], row({ body: ' ' })).reason, 'invalid');
  assert.equal(c.restoreComment([], null).reason, 'invalid');
  assert.deepEqual(Object.keys(c.restoreComment([], Object.assign(row(), { evil: 1 })).rows[0]).sort(),
    ['author', 'body', 'created_at', 'id', 'target_id']);
});

test('まとめ: 対象ごと・古い順・mine 付き・不正な対象は捨てる', () => {
  const g = c.groupComments([
    row({ id: 'CMT-00000003', created_at: '2026-10-06 12:00:00', author: 'b@x.jp' }),
    row({ id: 'CMT-00000001', created_at: '2026-10-06 09:00:00' }),
    row({ id: 'CMT-00000002', target_id: 'IMP-002' }),
    row({ id: 'CMT-00000004', target_id: 'メモ' }),
  ], 'a@x.jp');
  assert.deepEqual(Object.keys(g).sort(), ['IMP-002', 'PBI-001']);
  assert.deepEqual(g['PBI-001'].map((x) => x.id), ['CMT-00000001', 'CMT-00000003']);
  assert.deepEqual(g['PBI-001'].map((x) => x.mine), [true, false]);
  assert.equal(c.groupComments([row()], '')['PBI-001'][0].mine, false, 'ログインが取れないときは誰のものでもない');
});
```

- [ ] **Step 2: 失敗を確認** — `node --test gas/tests/pure_comment.test.js` → FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

```js
/**
 * コメント（scrum/comments.csv）。GAS API に依存しない純関数。
 *
 * PBI・障害物に紐づく（target_id）。追記が主で、競合判定は要らない。削除は本人だけ。
 * ID はサーバが UUID から作って渡す（ここでは作らない。テストで固定できるように）。
 */

const COMMENT_FIELDS = ['id', 'target_id', 'author', 'created_at', 'body'];
const COMMENT_TARGET_RE = /^(PBI|IMP)-\d+$/;
const COMMENT_ID_RE = /^CMT-[0-9a-f]{8}$/;
const COMMENT_BODY_MAX = 2000;

function cmtText_(v) { return v === undefined || v === null ? '' : String(v); }

function cmtPick_(row) {
  const out = {};
  COMMENT_FIELDS.forEach(function (f) { out[f] = cmtText_((row || {})[f]); });
  return out;
}

function validateComment(targetId, body) {
  const errors = [];
  const t = cmtText_(targetId).trim();
  const b = cmtText_(body);
  if (!COMMENT_TARGET_RE.test(t)) errors.push('コメントの対象が不正です: ' + t);
  if (!b.trim()) errors.push('コメントを入力してください。');
  else if (b.length > COMMENT_BODY_MAX) errors.push('コメントは' + COMMENT_BODY_MAX + '字以内で入力してください。');
  return { ok: errors.length === 0, errors: errors };
}

function cmtIndex_(rows, id) {
  const key = cmtText_(id).trim();
  for (let i = 0; i < rows.length; i++) if (cmtText_(rows[i].id).trim() === key) return i;
  return -1;
}

function appendComment(rows, id, targetId, author, body, nowText) {
  const comment = { id: id, target_id: cmtText_(targetId).trim(), author: cmtText_(author), created_at: nowText, body: cmtText_(body) };
  return { ok: true, rows: (rows || []).map(cmtPick_).concat([comment]), comment: comment };
}

function deleteComment(rows, id, me) {
  const list = rows || [];
  const i = cmtIndex_(list, id);
  if (i === -1) return { ok: false, reason: 'not_found' };
  // ログインが取れない（空）ときは誰のものでもない。空どうしを一致とみなさない。
  if (!cmtText_(me) || cmtText_(list[i].author) !== cmtText_(me)) return { ok: false, reason: 'forbidden' };
  const removed = cmtPick_(list[i]);
  return { ok: true, rows: list.filter(function (_, k) { return k !== i; }).map(cmtPick_), removed: removed };
}

function restoreComment(rows, row) {
  const src = cmtPick_(row);
  if (!row || !COMMENT_ID_RE.test(src.id) || !COMMENT_TARGET_RE.test(src.target_id) || !src.body.trim()) {
    return { ok: false, reason: 'invalid' };
  }
  const list = (rows || []).map(cmtPick_);
  if (cmtIndex_(list, src.id) !== -1) return { ok: true, rows: list, unchanged: true };
  return { ok: true, rows: list.concat([src]) };
}

function groupComments(rows, me) {
  const out = {};
  const who = cmtText_(me);
  (rows || []).map(cmtPick_).forEach(function (r, i) {
    const t = r.target_id.trim();
    if (!COMMENT_TARGET_RE.test(t)) return;
    (out[t] = out[t] || []).push({ row: r, i: i });
  });
  Object.keys(out).forEach(function (t) {
    out[t] = out[t].sort(function (a, b) {
      if (a.row.created_at < b.row.created_at) return -1;
      if (a.row.created_at > b.row.created_at) return 1;
      return a.i - b.i;
    }).map(function (x) {
      const c = x.row;
      return { id: c.id, target_id: c.target_id, author: c.author, created_at: c.created_at, body: c.body,
        mine: !!who && c.author === who };
    });
  });
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { COMMENT_FIELDS, COMMENT_TARGET_RE, COMMENT_ID_RE, COMMENT_BODY_MAX,
    validateComment, appendComment, deleteComment, restoreComment, groupComments };
}
```

- [ ] **Step 4: 通過を確認** — `node --test gas/tests/pure_comment.test.js gas/tests/gas_load.test.js gas/tests/scripts_publish.test.js` → PASS
- [ ] **Step 5: コミット** — `feat: コメントの純関数と comments.csv の雛形を足す`

---

### Task 2: サーバの API とビューへの同梱

**Files:**
- Modify: `gas/pure_write_guard.js`、`gas/web_app.js`
- Test: `gas/tests/pure_write_guard.test.js`、`gas/tests/web_app_flow.test.js`

**Interfaces:**
- Consumes: Task 1 の全関数
- Produces:
  - `apiGetView('board'|'list'|'impediment')` の応答に `comments`（`groupComments` の結果）
  - `apiAddComment(targetId, body) → { ok, comments, comment }`
  - `apiDeleteComment(commentId) → { ok, comments, removed }`
  - `apiRestoreComment(row) → { ok, comments }`
  - 失敗: `{ ok:false, reason, message, comments? }`

- [ ] **Step 1: テストの偽環境を広げる** — `web_app_flow.test.js` の `createTestContext` に足す:

```js
// opts.user: getActiveUser().getEmail() が返す値（既定 'me@example.com'）。
Session: {
  getScriptTimeZone: function () { return 'UTC'; },
  getActiveUser: function () { return { getEmail: function () { return opts.user === undefined ? 'me@example.com' : opts.user; } }; },
},
// Utilities に追加: 呼ぶたびに決まった並びの UUID を返す。
getUuid: (function () { let n = 0; return function () { n++; return ('0000000' + n.toString(16)).slice(-8) + '-0000-4000-8000-000000000000'; }; })(),
```

- [ ] **Step 2: 失敗するテストを書く**（`web_app_flow.test.js` の末尾）

```js
const CMT_HEADER = 'id,target_id,author,created_at,body\n';
function cmtFiles(body) {
  return { 'product_backlog.csv': headerOnlyCsv(), 'comments.csv': CMT_HEADER + (body || '') };
}

test('apiGetView(board) は comments を載せ、mine を付ける', () => {
  const { ctx } = createTestContext(cmtFiles(
    'CMT-0000000a,PBI-001,me@example.com,2026-10-06 10:00:00,はじめ\nCMT-0000000b,PBI-001,you@example.com,2026-10-06 11:00:00,つぎ\n'));
  const res = ctx.apiGetView('board');
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.comments)['PBI-001'].map((c) => [c.id, c.mine]), [['CMT-0000000a', true], ['CMT-0000000b', false]]);
});

test('comments.csv が無くても盤面は読め、comments は空', () => {
  const { ctx } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const res = ctx.apiGetView('board');
  assert.equal(res.ok, true);
  assert.deepEqual(plain(res.comments), {});
});

test('追加: UUID から ID を作り、ログイン中のメールと時刻で末尾に足す', () => {
  const { ctx, files } = createTestContext(cmtFiles());
  const res = ctx.apiAddComment('PBI-001', '一行目\n二行目');
  assert.equal(res.ok, true, res.message);
  assert.equal(res.comment.id, 'CMT-00000001');
  assert.equal(res.comment.author, 'me@example.com');
  assert.match(files['comments.csv'], /^id,target_id,author,created_at,body\nCMT-00000001,PBI-001,me@example\.com,\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},"一行目\n二行目"\n$/);
  assert.equal(plain(res.comments)['PBI-001'][0].mine, true);
});

test('追加: comments.csv が無ければ案内付きで失敗し、何も作らない', () => {
  const { ctx, files } = createTestContext({ 'product_backlog.csv': headerOnlyCsv() });
  const res = ctx.apiAddComment('PBI-001', 'x');
  assert.equal(res.ok, false);
  assert.ok(res.message.indexOf('配布し直してください') !== -1, res.message);
  assert.equal(Object.prototype.hasOwnProperty.call(files, 'comments.csv'), false);
});

test('追加: 検証に落ちたら書かない。ヘッダーが違えば書かない', () => {
  const f = cmtFiles();
  const { ctx, files } = createTestContext(f);
  assert.equal(ctx.apiAddComment('PBI-001', ' ').reason, 'invalid');
  assert.equal(files['comments.csv'], CMT_HEADER);
  f['comments.csv'] = 'id,body\n';
  assert.equal(createTestContext(f).ctx.apiAddComment('PBI-001', 'x').ok, false);
  assert.equal(f['comments.csv'], 'id,body\n');
});

test('削除: 自分のものだけ消せる。他人のものは forbidden でファイルを変えない', () => {
  const f = cmtFiles('CMT-0000000a,PBI-001,me@example.com,2026-10-06 10:00:00,はじめ\nCMT-0000000b,PBI-001,you@example.com,2026-10-06 11:00:00,つぎ\n');
  const { ctx, files } = createTestContext(f);
  const ng = ctx.apiDeleteComment('CMT-0000000b');
  assert.equal(ng.reason, 'forbidden');
  assert.ok(files['comments.csv'].indexOf('CMT-0000000b') !== -1);
  const ok = ctx.apiDeleteComment('CMT-0000000a');
  assert.equal(ok.ok, true, ok.message);
  assert.equal(files['comments.csv'].indexOf('CMT-0000000a'), -1);
  const back = ctx.apiRestoreComment(plain(ok.removed));
  assert.equal(back.ok, true, back.message);
  assert.ok(files['comments.csv'].indexOf('CMT-0000000a') !== -1);
});

test('ログインが取れないと、誰のコメントも消せない', () => {
  const { ctx } = createTestContext(cmtFiles('CMT-0000000a,PBI-001,,2026-10-06 10:00:00,はじめ\n'), { user: '' });
  assert.equal(ctx.apiDeleteComment('CMT-0000000a').reason, 'forbidden');
});
```

`pure_write_guard.test.js` に `assertWritableFileName('comments.csv')` が通る検査を足す。

- [ ] **Step 3: 失敗を確認** — `node --test gas/tests/web_app_flow.test.js gas/tests/pure_write_guard.test.js` → FAIL

- [ ] **Step 4: 実装**

`pure_write_guard.js` の `WRITABLE_FILES` に `'comments.csv'` を足す（コメントで第5段階と書く）。

`web_app.js`:

```js
const COMMENT_CSV_NAME = 'comments.csv';

/** ログイン中のメール。取れなければ空文字（誰のコメントも消せない側に倒す）。 */
function currentUserEmail_() {
  try { return String(Session.getActiveUser().getEmail() || ''); } catch (e) { return ''; }
}

/** 全対象のコメント。ファイルが無い・壊れていても空にする（他の表示を巻き添えにしない）。 */
function commentsPayload_() {
  return groupComments(readCsvRowsBestEffort_(COMMENT_CSV_NAME), currentUserEmail_());
}

/** CMT- + UUID の先頭8桁。 */
function newCommentId_() {
  return 'CMT-' + String(Utilities.getUuid()).replace(/-/g, '').slice(0, 8).toLowerCase();
}

/**
 * コメントの書き込みの共通手順。ロックを取り、読み直し、ヘッダーを検査してから mutate(rows) を呼ぶ。
 * mutate は { ok:true, rows, extra? } か { ok:false, reason, message } を返す。rows が null なら書かない。
 */
function withCommentWrite_(mutate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。' };
  }
  try {
    const text = readTextFile_(getScrumFolder_(), COMMENT_CSV_NAME);
    if (text === null) {
      return { ok: false, reason: 'error', message: 'scrum/' + COMMENT_CSV_NAME + ' が見つかりません。配布し直してください。' };
    }
    assertHeaderMatches(text, COMMENT_FIELDS);
    const rows = csvToObjects(text);
    const me = currentUserEmail_();
    const result = mutate(rows, me);
    if (!result.ok) return { ok: false, reason: result.reason, message: result.message, comments: groupComments(rows, me) };
    if (result.rows) writeScrumFile_(COMMENT_CSV_NAME, toCsv(result.rows, COMMENT_FIELDS));
    return Object.assign({ ok: true, comments: groupComments(result.rows || rows, me) }, result.extra || {});
  } catch (e) {
    return { ok: false, reason: 'error', message: e.message };
  } finally {
    lock.releaseLock();
  }
}

/** コメントを足す。ID・書いた人・時刻はサーバが決める。 */
function apiAddComment(targetId, body) {
  return withCommentWrite_(function (rows, me) {
    const v = validateComment(targetId, body);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const r = appendComment(rows, newCommentId_(), targetId, me, String(body), nowText_());
    return { ok: true, rows: r.rows, extra: { comment: r.comment } };
  });
}

/** 自分のコメントを消す。取り消しに使うため、消した行を返す。 */
function apiDeleteComment(commentId) {
  return withCommentWrite_(function (rows, me) {
    const r = deleteComment(rows, commentId, me);
    if (!r.ok) {
      return { ok: false, reason: r.reason,
        message: r.reason === 'forbidden' ? '自分のコメントだけ削除できます。' : 'このコメントが見つかりません。' };
    }
    return { ok: true, rows: r.rows, extra: { removed: r.removed } };
  });
}

/**
 * 削除したコメントを戻す。通知の「取り消す」から呼ばれる。
 * 戻せるのは自分のコメントだけ（他人の名前で行を作らせない）。
 */
function apiRestoreComment(row) {
  return withCommentWrite_(function (rows, me) {
    if (!me || String((row || {}).author || '') !== me) {
      return { ok: false, reason: 'forbidden', message: '自分のコメントだけ戻せます。' };
    }
    const r = restoreComment(rows, row);
    if (!r.ok) return { ok: false, reason: 'invalid', message: '戻す内容が不正です。' };
    return { ok: true, rows: r.unchanged ? null : r.rows };
  });
}
```

`apiGetView` の `board` / `list` の応答（`out`）と、`impedimentPayload_` の返り値に `comments: commentsPayload_()` を足す
（障害物の書き込み応答にも載るので、パネルの描き直しで食い違わない）。

`gas_load.test.js` 等で `api*` の一覧を照合している検査があれば3つを足す。`grep -rn "apiUnresolveImpediment" gas/tests` で探す。

`apiRestoreComment` の forbidden を検査するテストを1件足す（他人の `author` の行を戻そうとすると forbidden で書かない）。

- [ ] **Step 5: 通過を確認** — `npm test` → 全件 PASS
- [ ] **Step 6: コミット** — `feat: コメントの追加・削除・取り消しの API を足し、ビューの応答に載せる`

---

### Task 3: 画面（パネルのコメント節と件数）

**Files:**
- Modify: `gas/kanban.html`、`gas/tests/kanban_harness.js`（`API_METHODS` に3つ）
- Test: `gas/tests/kanban_comment.test.js`（新規）

**Interfaces:**
- Consumes: Task 2 の応答
- Produces（DOM の id）: PBI パネル用 `#panel-comments`、障害物パネル用 `#imp-panel-comments`。
  それぞれの中に、コメント一覧 `ul.comment-list`（各 `li` に `data-id`）、入力 `textarea.comment-input`、
  送信ボタン `button.comment-send`、自分のコメントの `button.comment-delete`。
  ハーネスに `commentsIn(hostId) → [{ id, author, body, canDelete }]`、`setCommentInput(hostId, text)`、
  `clickCommentSend(hostId)`、`clickCommentDelete(hostId, id)` を足す（動的要素を `collect` で探し `fireVisible` で押す。隠れていれば例外）。

設計:
- 全コメントは `commentsByTarget`（応答の `comments`）を1つだけ持つ。`board` / `list` / `impediment` の読み込み応答と、
  コメント・障害物の書き込み応答に `comments` があれば差し替える（`res.comments` が無い応答では触らない）
- コメント節を描く関数は1つ: `renderComments(hostId, targetId)`。`hostId` の中身を作り直す。
  `targetId` が空（新規作成中）なら節全体を `hidden` にする
- `openPanel` / `openImpPanel` の最後で、対象の節を描く。`commentsByTarget` を差し替えたら、開いているパネル（PBI か障害物のどちらか）の節を描き直す
- 各コメント: 書いた人（`author` の `@` より前。空なら「不明」）、日時、本文（`white-space: pre-wrap` のクラスで改行を保つ。`textContent` で入れる）。
  `mine` のときだけ「削除」
- 送信: 入力が空白だけなら押せない（`input` イベントで `disabled` を切り替える）。送信中は入力とボタンを塞ぐ。
  成功で入力を空にする。失敗は節の中のメッセージ（`.comment-message`）に出す
- 削除: 押すとすぐ送る。成功で `showUndoToast('コメントを削除しました。', function () { restoreComment(res.removed); })`
  （既存の通知を使う。sticky ではない）
- 応答の順序: コメントの書き込みごとに `commentWriteIssued` を進め、`lastAppliedComment` より新しい応答のときだけ
  `commentsByTarget` を差し替える。`loadView` が `comments` を受け取ったら `lastAppliedComment = commentWriteIssued`
  （障害物の `lastAppliedImp` と同じ考え方）。`writeSeq` も成功時に進める
- 件数: 盤面のカード（`renderCard` の `.prio` の並び、ID の手前）に、コメントがあれば `span.comment-count` で「コメント N」。
  障害物の未解決・解決済の表では、タイトルのセルの末尾に同じ `span.comment-count` を足す
- パネルの縦: `.side-panel` に `overflow-y: auto` と `max-height`（画面の高さから上の帯を引いた値。既存の
  レイアウトの値を確かめて決める）を足し、コメントが多くてもパネルの中でスクロールして保存・解決ボタンに届くようにする。
  コメント節はパネル下部（`.panel-foot` の後ろ）に置く
- CSS: `.comment-list`（余白・区切り線は `--line`）、`.comment-body { white-space: pre-wrap; overflow-wrap: anywhere; }`、
  `.comment-meta`（`--ink-2`、12px）、`.comment-count`（`--ink-2`、11px）

- [ ] **Step 1: 失敗するテストを書く**（`kanban_comment.test.js`）。次の振る舞いを1テストずつ:
  1. 盤面の応答に `comments` があり、カードを開くと `#panel-comments` に古い順で出る。自分のものだけ削除が出る
  2. 新規作成のパネルでは `#panel-comments` が隠れている
  3. 入力が空白だけだと送信ボタンが `disabled`。文字を入れると押せる。押すと `apiAddComment(cardId, 本文)` を呼び、送信中は入力が塞がる
  4. 追加の応答で一覧が増え、入力が空になる。失敗の応答では `.comment-message` に文言が出て入力は残る
  5. 削除で `apiDeleteComment(id)` を呼び、成功で通知が出る。「取り消す」で `apiRestoreComment(removed)` を呼ぶ
  6. 書き込みが2つ飛んで、新しい応答→古い応答の順に届くと、新しい方の一覧のまま
  7. 障害物のパネルでも同じ節が出る（`#imp-panel-comments`、対象は `IMP-...`）
  8. カードに「コメント 2」が出る。コメントが無いカードには出ない。障害物の表のタイトルにも出る
  9. 本文の改行が保たれ（`textContent` に `\n` が残る）、`<b>x</b>` が文字のまま
  10. `res.comments` の無い応答（`done` など）では一覧が消えない

- [ ] **Step 2: 失敗を確認** — `node --test gas/tests/kanban_comment.test.js` → FAIL

- [ ] **Step 3: 実装**（上の設計どおり。マークアップは両パネルの `.panel-foot` の直後に
  `<div id="panel-comments" class="comments" hidden></div>` / `<div id="imp-panel-comments" class="comments" hidden></div>` を置き、中身はスクリプトで作る）

- [ ] **Step 4: 通過を確認** — `npm test` → 全件 PASS。静的検査（`[hidden]` を持つ要素の一覧など）に足した要素が引っかかれば、守る内容を弱めずに一覧を更新する
- [ ] **Step 5: コミット** — `feat: パネルでコメントを読み書きし、カードと一覧に件数を出す`

---

### Task 4: 実ブラウザの検査

**Files:**
- Modify: `gas/tests/browser/fixtures.js`、`gas/tests/browser/probe_source.js`、`gas/tests/browser/measure.js`、`gas/tests/browser/kanban_browser.test.js`

- [ ] **Step 1: 見本に `comments` を足す** — 盤面の応答に、ある PBI へ長いコメント20件（改行・長い URL を含む）を
  `groupComments` で組み立てて載せる（手書きの JSON にしない）。既存の件数の固定値（補足の数など）が変わらないことを確かめる
- [ ] **Step 2: 測る** — そのカードのパネルを開き、(a) `#panel-save` が `.side-panel` の中でスクロールして見える位置まで
  届くこと（`scrollIntoView` 後に `getBoundingClientRect` が画面内）、(b) `.comment-body` の長い URL が節の幅を超えないこと、
  (c) ページ全体が横に伸びないこと、を測る
- [ ] **Step 3: 検査を足す** — 全幅・全配色で (a)(b)(c) を判定する。わざと `.side-panel` の `overflow-y` を消すと (a) が落ちることを確かめる（コミットしない）
- [ ] **Step 4: 通過を確認** — `npm run test:browser` と `npm test` → PASS
- [ ] **Step 5: コミット** — `test: コメントの多いパネルとはみ出しを実ブラウザで検査する`

---

### Task 5: 文書とエージェントへの案内

**Files:**
- Modify: `CLAUDE.md`、`README.md`、`docs/setup.md`、`.claude/skills/sprint-review/SKILL.md`、`.claude/skills/backlog-refinement/SKILL.md`

- [ ] **Step 1:** `CLAUDE.md`
  - Web アプリが書き戻すファイルに `comments.csv` を足す（4ファイル）
  - 1行足す: 「人のコメントは `scrum/comments.csv`（`target_id` で PBI・障害物に紐づく）。PBI や障害物を扱う前に該当コメントを読む。返答を書くときは `author` に自分のエージェント名を入れて追記する（列は `id,target_id,author,created_at,body`。`id` は `CMT-` + 8桁の16進で重複させない）」
- [ ] **Step 2:** `README.md` — できることの表と障害物・PBI の節に、パネルでコメントを読み書きでき、自分のものだけ消せることを短く足す
- [ ] **Step 3:** `docs/setup.md` — 書き戻すファイルの一覧に `comments.csv` を足す。既存の Drive では `node scripts/publish.js` で配布し直すまでコメントが書けないことを1行
- [ ] **Step 4:** 2つのスキルの、PBI を読む手順の直後に「`scrum/comments.csv` から該当 PBI（`target_id`）のコメントを読む」を1行ずつ
- [ ] **Step 5:** `git grep -n -e "3ファイル" -e "impediment_log_resolved.csv\` の" -- CLAUDE.md README.md docs/setup.md` 等で、書き戻しのファイル数を述べた箇所を全件揃える。`docs/superpowers/` の過去の設計書・計画は触らない
- [ ] **Step 6:** `npm test` → PASS。コミット — `docs: コメントの読み書きとエージェントへの案内を足す`

---

## 仕上げ

- `npm run test:all` が通ること
- PR を作り、bot のレビューを triage してからマージする
- `clasp push` と Web アプリの再デプロイ（`create-deployment -i <第2段階から使っているデプロイ ID>`）
- `node scripts/publish.js` で `scrum/comments.csv` を配布する（共有フォルダのパスが要る）
