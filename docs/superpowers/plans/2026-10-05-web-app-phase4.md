# Web アプリ 第4段階（障害物の作成・編集・解決）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web アプリの「障害物」タブから、障害物を作成・編集・解決（と取り消し）できるようにする。

**Architecture:** ロジックは新しい `pure_impediment_*.js` に置き、Node のテストで固める。
`web_app.js` は2つの CSV の読み直し・ヘッダー検査・「足してから消す」順の書き込みだけを担う。
画面は既存の PBI パネルと同じ見た目の障害物パネル（`#imp-panel`）を足す。

**Tech Stack:** Google Apps Script（V8）、素の JS + HTML（`kanban.html`）、`node --test`、
DOM シム（`gas/tests/kanban_harness.js`）、実ブラウザ検査（Chrome + CDP）。

**Spec:** `docs/superpowers/specs/2026-10-05-web-app-phase4-design.md`

## Global Constraints

- CSV の列構造を変えない。障害物の列は `IMPEDIMENT_FIELDS`（`pure_grid_report.js`）のまま
- 成果物・コメント・メッセージは日本語。文字コードは UTF-8
- `gas/*.js` は1つのグローバルスコープで評価される。新しいトップレベル名は既存と衝突させない（`gas_load.test.js`）
- `pure_*.js` は GAS API に依存しない。Node では `module.exports`、GAS ではグローバル
- 書き込みは `LockService` のスクリプトロック内で、読み直した内容に対して行う
- ブラウザへ公開する関数は増やす API の4つだけ（`apiCreateImpediment` / `apiUpdateImpediment` / `apiResolveImpediment` / `apiUnresolveImpediment`）。補助関数は末尾 `_`
- ユーザー由来の文字列は `textContent` で入れる（`innerHTML` を使わない）
- 解決済の `status` は `Resolved`、作成時は `Open`。日付は `YYYY-MM-DD`
- 2ファイルの書き込みは必ず「足す側 → 消す側」の順
- 新しい CSS で `var(--x, fallback)` を書かない。既存トークン（`--card` / `--card-2` / `--line` / `--accent` / `--ink-*` / `--danger` / `--sp-*`）を使う

## Review Focus

1. **2つ目の書き込みだけ失敗した**: 同じ ID が両ファイルに残る。画面は解決済にだけ出し、もう一度「解決」を押すと未解決側から消えて完了する（Task 3 / Task 5 のテスト）
2. **ローカルの Claude Code が同じ行を書き換えた直後に保存・解決**: 全列比較で `conflict` になり上書きしない。パネルは閉じず、もう一度押せば最新を基準に通る（Task 3 / Task 6）
3. **雛形行だけの CSV で最初の障害物を作る**: `IMP-002` になり、雛形の `IMP-001` を上書きしない（Task 1）
4. **解決の取り消しの前に、誰かが解決済の行を書き換えた**: `conflict` で止まり、書き換えを消さない（Task 3）
5. **応答待ちの間に別タブへ移った**: 障害物の応答が他タブの表を上書きしない（Task 6）

---

## File Structure

| ファイル | 種別 | 責務 |
|---|---|---|
| `gas/pure_impediment_id.js` | 新規 | `nextImpedimentId(rows)` |
| `gas/pure_impediment_validate.js` | 新規 | 編集可能な列、入力検証 |
| `gas/pure_impediment_merge.js` | 新規 | 行の比較・追記・更新・解決/取り消しの計画（どのファイルに何を書くか） |
| `gas/pure_view_impediment.js` | 変更 | 行に全列を持たせる、両方にある ID を未解決から隠す |
| `gas/pure_summary.js` | 変更 | `summarizeImpediment` に同じ隠す規則 |
| `gas/pure_write_guard.js` | 変更 | 許可リストに2ファイル |
| `gas/web_app.js` | 変更 | `withImpedimentWrite_` と4 API、障害物ビューに `sprintChoices` |
| `gas/kanban.html` | 変更 | 障害物パネル、追加ボタン、行クリック、通知の文言の一般化 |
| `gas/tests/kanban_harness.js` | 変更 | 動的な行・ボタンを押すヘルパー |
| `CLAUDE.md` / `README.md` / `docs/setup.md` | 変更 | 「障害物は閲覧のみ」の記述を直す |

---

### Task 1: 障害物の採番

**Files:**
- Create: `gas/pure_impediment_id.js`
- Test: `gas/tests/pure_impediment_id.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `nextImpedimentId(rows) → string`（例 `'IMP-002'`）

- [ ] **Step 1: 失敗するテストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { nextImpedimentId } = require('../pure_impediment_id.js');

test('行が無ければ IMP-001', () => {
  assert.equal(nextImpedimentId([]), 'IMP-001');
  assert.equal(nextImpedimentId(null), 'IMP-001');
});

test('雛形の IMP-001 も数に入れる（雛形を上書きしない）', () => {
  assert.equal(nextImpedimentId([{ id: 'IMP-001', title: '（障害物タイトル）' }]), 'IMP-002');
});

test('最大値の次。欠番は埋めない', () => {
  assert.equal(nextImpedimentId([{ id: 'IMP-001' }, { id: 'IMP-007' }, { id: 'IMP-003' }]), 'IMP-008');
});

test('前後の空白は無視し、形の違う ID は数えない', () => {
  assert.equal(nextImpedimentId([{ id: ' IMP-004 ' }, { id: 'imp-099' }, { id: 'IMP-x' }, {}]), 'IMP-005');
});

test('3桁を超えたらそのまま伸ばす', () => {
  assert.equal(nextImpedimentId([{ id: 'IMP-999' }]), 'IMP-1000');
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test gas/tests/pure_impediment_id.test.js` / Expected: FAIL（`Cannot find module`）

- [ ] **Step 3: 実装**

```js
/**
 * 障害物の採番。GAS API に依存しない純関数。
 *
 * 未解決と解決済の両ファイルを通した最大値の次を返す。削除の操作を作らないので、
 * 一度使った ID は必ずどちらかに残る（PBI のような高水位の記録は要らない）。
 * 雛形の IMP-001 も数に入れる（雛形を本物の行で上書きしない）。
 */

const IMPEDIMENT_ID_NUM_RE = /^IMP-(\d+)$/;

function nextImpedimentId(rows) {
  let max = 0;
  (rows || []).forEach(function (r) {
    const m = IMPEDIMENT_ID_NUM_RE.exec(String((r && r.id) || '').trim());
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  const n = String(max + 1);
  return 'IMP-' + (n.length < 3 ? ('000' + n).slice(-3) : n);
}

if (typeof module !== 'undefined') { module.exports = { IMPEDIMENT_ID_NUM_RE, nextImpedimentId }; }
```

- [ ] **Step 4: 通過を確認** — Run: `node --test gas/tests/pure_impediment_id.test.js gas/tests/gas_load.test.js` / Expected: PASS
- [ ] **Step 5: コミット** — `git add gas/pure_impediment_id.js gas/tests/pure_impediment_id.test.js && git commit -m "feat: 障害物の採番を足す"`

---

### Task 2: 障害物の入力検証

**Files:**
- Create: `gas/pure_impediment_validate.js`
- Test: `gas/tests/pure_impediment_validate.test.js`

**Interfaces:**
- Produces:
  - `IMPEDIMENT_EDITABLE_FIELDS = ['title','description','reported_by','sprint']`
  - `validateImpedimentFields(fields) → { ok, errors: string[] }`（タイトル・報告者が必須。常に全項目を見る）
  - `validateResolution(text) → { ok, errors }`

- [ ] **Step 1: 失敗するテストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { IMPEDIMENT_EDITABLE_FIELDS, validateImpedimentFields, validateResolution } =
  require('../pure_impediment_validate.js');

test('編集できる列は4つだけ（id / 日付 / status / 解決の列は含まない）', () => {
  assert.deepEqual(IMPEDIMENT_EDITABLE_FIELDS, ['title', 'description', 'reported_by', 'sprint']);
});

test('タイトルと報告者が揃えば通る', () => {
  assert.deepEqual(validateImpedimentFields({ title: 'A', reported_by: 'マヤ' }), { ok: true, errors: [] });
});

test('空白だけのタイトル・報告者は、両方の誤りを一度に返す', () => {
  const r = validateImpedimentFields({ title: '  ', reported_by: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['タイトルを入力してください。', '報告者を入力してください。']);
});

test('fields が無くても落ちない', () => {
  assert.equal(validateImpedimentFields(null).ok, false);
});

test('解決策は空白だけでは通らない', () => {
  assert.equal(validateResolution('  ').ok, false);
  assert.deepEqual(validateResolution('  ').errors, ['解決策を入力してください。']);
  assert.equal(validateResolution(null).ok, false);
  assert.equal(validateResolution('再起動した').ok, true);
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test gas/tests/pure_impediment_validate.test.js` / Expected: FAIL

- [ ] **Step 3: 実装**

```js
/**
 * 障害物の入力検証。GAS API に依存しない純関数。
 *
 * パネルは編集でも常に全項目を送る（競合判定を行の全列で行うため、差分送信の利点が無い）。
 * そのため部分更新を考えず、毎回全項目を検証する。
 */

// id / reported_at / status / resolved_at / resolution はサーバが決める。
const IMPEDIMENT_EDITABLE_FIELDS = ['title', 'description', 'reported_by', 'sprint'];

function blank_(v) {
  return String(v === undefined || v === null ? '' : v).trim() === '';
}

function validateImpedimentFields(fields) {
  const f = fields || {};
  const errors = [];
  if (blank_(f.title)) errors.push('タイトルを入力してください。');
  if (blank_(f.reported_by)) errors.push('報告者を入力してください。');
  return { ok: errors.length === 0, errors: errors };
}

function validateResolution(text) {
  return blank_(text)
    ? { ok: false, errors: ['解決策を入力してください。'] }
    : { ok: true, errors: [] };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_EDITABLE_FIELDS, validateImpedimentFields, validateResolution };
}
```

注意: `blank_` が既存のトップレベル名と衝突しないか `grep -n "function blank_" gas/*.js` で確かめ、衝突するなら `impedimentBlank_` に改名する。

- [ ] **Step 4: 通過を確認** — Run: `node --test gas/tests/pure_impediment_validate.test.js gas/tests/gas_load.test.js` / Expected: PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 障害物の入力検証を足す"`

---

### Task 3: 障害物の行の操作（追記・更新・解決・取り消しの計画）

**Files:**
- Create: `gas/pure_impediment_merge.js`
- Test: `gas/tests/pure_impediment_merge.test.js`

**Interfaces:**
- Consumes: `IMPEDIMENT_FIELDS`（`pure_grid_report.js`）、`IMPEDIMENT_EDITABLE_FIELDS`（Task 2）、`IMPEDIMENT_ID_NUM_RE`（Task 1）
- Produces（rows はすべて `{列名: 文字列}` の配列。引数は書き換えない）:
  - `impedimentRowsEqual(a, b) → boolean` — `IMPEDIMENT_FIELDS` の全列を文字列で比較（`undefined`/`null` は `''`、trim しない）
  - `appendImpediment(rows, id, fields, todayText) → { ok:true, rows, row } | { ok:false, reason:'duplicate_id' }`
  - `updateImpediment(rows, id, fields, expected) → { ok:true, rows } | { ok:false, reason:'not_found'|'conflict' }`
  - `planResolve(openRows, resolvedRows, id, resolution, expected, todayText) → { ok:true, open, resolved, moved, resolvedRow } | { ok:false, reason }`
  - `planUnresolve(openRows, resolvedRows, moved, resolvedRow) → { ok:true, open, resolved } | { ok:false, reason }`
  - `open` / `resolved` は**書くべき新しい配列、書かなくてよければ `null`**

- [ ] **Step 1: 失敗するテストを書く**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../pure_impediment_merge.js');

const imp = (over) => Object.assign({
  id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001',
}, over || {});
const ids = (rows) => rows.map((r) => r.id);

test('全列が同じなら等しい。undefined は空文字と同じ。前後の空白は区別する', () => {
  assert.equal(m.impedimentRowsEqual(imp(), imp()), true);
  assert.equal(m.impedimentRowsEqual(imp({ description: undefined }), imp({ description: '' })), true);
  assert.equal(m.impedimentRowsEqual(imp({ title: 'A ' }), imp({ title: 'A' })), false);
  assert.equal(m.impedimentRowsEqual(imp({ sprint: 'x' }), imp()), false);
});

test('追記はサーバの値で id / 報告日 / status を決め、編集できない列は捨てる', () => {
  const r = m.appendImpediment([imp()], 'IMP-003',
    { title: 'B', reported_by: 'ダイチ', status: 'Resolved', resolution: 'ずる', id: 'IMP-999' }, '2026-10-05');
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r.rows), ['IMP-002', 'IMP-003']);
  assert.deepEqual(r.row, {
    id: 'IMP-003', title: 'B', description: '', reported_by: 'ダイチ', reported_at: '2026-10-05',
    status: 'Open', resolved_at: '', resolution: '', sprint: '',
  });
});

test('追記は同じ ID があれば拒否する', () => {
  assert.equal(m.appendImpediment([imp()], 'IMP-002', { title: 'B' }, '2026-10-05').reason, 'duplicate_id');
});

test('更新は全列一致のときだけ、編集できる列だけを書き換える', () => {
  const rows = [imp()];
  const r = m.updateImpediment(rows, 'IMP-002', { title: '新', reported_at: '1999-01-01' }, imp());
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].title, '新');
  assert.equal(r.rows[0].reported_at, '2026-10-01');
  assert.equal(rows[0].title, '止まっている', '引数を書き換えた');
});

test('更新は1列でも違えば conflict、無ければ not_found', () => {
  assert.equal(m.updateImpediment([imp({ description: '誰かが追記' })], 'IMP-002', { title: '新' }, imp()).reason, 'conflict');
  assert.equal(m.updateImpediment([imp()], 'IMP-404', { title: '新' }, imp()).reason, 'not_found');
});

test('解決: resolved に足し、open から消す。足す行は Resolved / 今日 / 解決策', () => {
  const r = m.planResolve([imp(), imp({ id: 'IMP-003' })], [], 'IMP-002', '再起動した', imp(), '2026-10-05');
  assert.equal(r.ok, true);
  assert.deepEqual(ids(r.open), ['IMP-003']);
  assert.deepEqual(ids(r.resolved), ['IMP-002']);
  assert.deepEqual(r.resolvedRow, imp({ status: 'Resolved', resolved_at: '2026-10-05', resolution: '再起動した' }));
  assert.deepEqual(r.moved, imp());
});

test('解決: 途中で止まって両方にある状態からは、resolved を書かず open から消すだけ（冪等）', () => {
  const done = imp({ status: 'Resolved', resolved_at: '2026-10-04', resolution: '前回の分' });
  const r = m.planResolve([imp()], [done], 'IMP-002', '再起動した', imp(), '2026-10-05');
  assert.equal(r.ok, true);
  assert.equal(r.resolved, null);
  assert.deepEqual(r.open, []);
  assert.deepEqual(r.resolvedRow, done, '既に書いた行を、取り消しの照合に使う');
});

test('解決: 画面が見た行と違えば conflict、既に解決済なら conflict、どこにも無ければ not_found', () => {
  assert.equal(m.planResolve([imp({ title: '変わった' })], [], 'IMP-002', 'x', imp(), 'd').reason, 'conflict');
  assert.equal(m.planResolve([], [imp({ status: 'Resolved' })], 'IMP-002', 'x', imp(), 'd').reason, 'conflict');
  assert.equal(m.planResolve([], [], 'IMP-002', 'x', imp(), 'd').reason, 'not_found');
});

const resolvedRow = imp({ status: 'Resolved', resolved_at: '2026-10-05', resolution: '再起動した' });

test('取り消し: open に元の行を戻し、resolved から消す', () => {
  const r = m.planUnresolve([], [resolvedRow], imp(), resolvedRow);
  assert.equal(r.ok, true);
  assert.deepEqual(r.open, [imp()]);
  assert.deepEqual(r.resolved, []);
});

test('取り消し: 戻すのは IMPEDIMENT_FIELDS の列だけ', () => {
  const r = m.planUnresolve([], [resolvedRow], Object.assign(imp(), { evil: 'x' }), resolvedRow);
  assert.deepEqual(Object.keys(r.open[0]).sort(), Object.keys(imp()).sort());
});

test('取り消し: 両方にある状態からは open を書かず resolved から消すだけ', () => {
  const r = m.planUnresolve([imp()], [resolvedRow], imp(), resolvedRow);
  assert.equal(r.open, null);
  assert.deepEqual(r.resolved, []);
});

test('取り消し: 既に戻っていれば何も書かずに成功、どこにも無ければ not_found', () => {
  const r = m.planUnresolve([imp()], [], imp(), resolvedRow);
  assert.equal(r.ok, true);
  assert.equal(r.open, null);
  assert.equal(r.resolved, null);
  assert.equal(m.planUnresolve([], [], imp(), resolvedRow).reason, 'not_found');
});

test('取り消し: 解決済の行が書き換えられていれば conflict', () => {
  assert.equal(m.planUnresolve([], [imp(Object.assign({}, resolvedRow, { resolution: '直した' }))], imp(), resolvedRow).reason, 'conflict');
});

test('取り消し: 不正な入力は invalid（ID の形・空タイトル・ID の食い違い）', () => {
  assert.equal(m.planUnresolve([], [resolvedRow], imp({ id: 'PBI-001' }), resolvedRow).reason, 'invalid');
  assert.equal(m.planUnresolve([], [resolvedRow], imp({ title: ' ' }), resolvedRow).reason, 'invalid');
  assert.equal(m.planUnresolve([], [resolvedRow], imp({ id: 'IMP-009' }), resolvedRow).reason, 'invalid');
  assert.equal(m.planUnresolve([], [resolvedRow], null, resolvedRow).reason, 'invalid');
});
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test gas/tests/pure_impediment_merge.test.js` / Expected: FAIL

- [ ] **Step 3: 実装**

```js
/**
 * 障害物の行の操作。GAS API に依存しない純関数。
 *
 * 障害物の CSV には updated_at が無く、列は足せない。競合は「画面が見た行」と
 * 「今の行」を全列で比べて判定する。
 *
 * 未解決と解決済はファイルで分かれる。解決・取り消しは2ファイルにまたがるため、
 * ここでは「どのファイルに何を書くか」だけを決め、書く順序は呼び出し側
 * （足す側 → 消す側）に任せる。書かなくてよいファイルは null で返す。
 */

if (typeof require !== 'undefined' && typeof IMPEDIMENT_FIELDS === 'undefined') {
  var { IMPEDIMENT_FIELDS } = require('./pure_grid_report.js');
  var { IMPEDIMENT_EDITABLE_FIELDS } = require('./pure_impediment_validate.js');
  var { IMPEDIMENT_ID_NUM_RE } = require('./pure_impediment_id.js');
}

function impText_(v) { return v === undefined || v === null ? '' : String(v); }

function impedimentRowsEqual(a, b) {
  const x = a || {};
  const y = b || {};
  return IMPEDIMENT_FIELDS.every(function (f) { return impText_(x[f]) === impText_(y[f]); });
}

function impIndex_(rows, id) {
  const key = String(id || '').trim();
  if (!key) return -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].id || '').trim() === key) return i;
  }
  return -1;
}

function impCopy_(row) {
  const out = {};
  Object.keys(row || {}).forEach(function (k) { out[k] = row[k]; });
  return out;
}

/** IMPEDIMENT_FIELDS の列だけを持つ行を作る。それ以外のキーは捨てる。 */
function impPick_(row) {
  const out = {};
  IMPEDIMENT_FIELDS.forEach(function (f) { out[f] = impText_((row || {})[f]); });
  return out;
}

function impWithout_(rows, index) {
  const out = [];
  rows.forEach(function (r, i) { if (i !== index) out.push(impCopy_(r)); });
  return out;
}

function appendImpediment(rows, id, fields, todayText) {
  const list = rows || [];
  if (impIndex_(list, id) !== -1) return { ok: false, reason: 'duplicate_id' };
  const row = impPick_({});
  IMPEDIMENT_EDITABLE_FIELDS.forEach(function (f) { row[f] = impText_((fields || {})[f]); });
  row.id = String(id).trim();
  row.reported_at = todayText;
  row.status = 'Open';
  return { ok: true, rows: list.map(impCopy_).concat([row]), row: row };
}

function updateImpediment(rows, id, fields, expected) {
  const list = rows || [];
  const i = impIndex_(list, id);
  if (i === -1) return { ok: false, reason: 'not_found' };
  if (!impedimentRowsEqual(list[i], expected)) return { ok: false, reason: 'conflict' };
  const next = list.map(impCopy_);
  IMPEDIMENT_EDITABLE_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(fields || {}, f)) next[i][f] = impText_(fields[f]);
  });
  return { ok: true, rows: next };
}

function planResolve(openRows, resolvedRows, id, resolution, expected, todayText) {
  const open = openRows || [];
  const resolved = resolvedRows || [];
  const oi = impIndex_(open, id);
  const ri = impIndex_(resolved, id);
  if (oi === -1) return { ok: false, reason: ri === -1 ? 'not_found' : 'conflict' };
  if (!impedimentRowsEqual(open[oi], expected)) return { ok: false, reason: 'conflict' };
  const moved = impPick_(open[oi]);
  if (ri !== -1) {
    // 前回の解決が「resolved に足した」ところで止まっている。足し直さず、消すだけで完了させる。
    return { ok: true, open: impWithout_(open, oi), resolved: null, moved: moved, resolvedRow: impPick_(resolved[ri]) };
  }
  const resolvedRow = impPick_(open[oi]);
  resolvedRow.status = 'Resolved';
  resolvedRow.resolved_at = todayText;
  resolvedRow.resolution = impText_(resolution);
  return {
    ok: true,
    open: impWithout_(open, oi),
    resolved: resolved.map(impCopy_).concat([resolvedRow]),
    moved: moved,
    resolvedRow: resolvedRow,
  };
}

function planUnresolve(openRows, resolvedRows, moved, resolvedRow) {
  const open = openRows || [];
  const resolved = resolvedRows || [];
  const src = moved || {};
  const id = String(src.id || '').trim();
  if (!IMPEDIMENT_ID_NUM_RE.test(id) || !impText_(src.title).trim() ||
      id !== String((resolvedRow || {}).id || '').trim()) {
    return { ok: false, reason: 'invalid' };
  }
  const oi = impIndex_(open, id);
  const ri = impIndex_(resolved, id);
  if (ri === -1) {
    // 既に戻っている（前回の取り消しが完了済み）なら、何も書かずに成功とする。
    if (oi !== -1) return { ok: true, open: null, resolved: null };
    return { ok: false, reason: 'not_found' };
  }
  if (!impedimentRowsEqual(resolved[ri], resolvedRow)) return { ok: false, reason: 'conflict' };
  return {
    ok: true,
    // 前回の取り消しが「open に足した」ところで止まっていれば、足し直さない。
    open: oi !== -1 ? null : open.map(impCopy_).concat([impPick_(src)]),
    resolved: impWithout_(resolved, ri),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { impedimentRowsEqual, appendImpediment, updateImpediment, planResolve, planUnresolve };
}
```

- [ ] **Step 4: 通過を確認** — Run: `node --test gas/tests/pure_impediment_merge.test.js gas/tests/gas_load.test.js` / Expected: PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 障害物の追記・更新・解決・取り消しを純関数で組み立てる"`

---

### Task 4: ビューと要約を書き込みに備える

**Files:**
- Modify: `gas/pure_view_impediment.js`（`impedimentRows_` / `buildImpedimentView`）
- Modify: `gas/pure_summary.js`（`summarizeImpediment`）
- Test: `gas/tests/pure_view_impediment.test.js`、`gas/tests/pure_summary.test.js`

**Interfaces:**
- Consumes: `IMPEDIMENT_FIELDS`、`isImpedimentPlaceholder`（`pure_grid_report.js`）
- Produces:
  - `buildImpedimentView(open, resolved)` の各行は `IMPEDIMENT_FIELDS` の全列を持つ（表の列 `IMPEDIMENT_COLUMNS` は変えない）
  - `openImpedimentsShown(openRows, resolvedRows) → rows` — 雛形と「解決済にも在る ID」を除いた未解決
  - `summarizeImpediment` の `open` は `openImpedimentsShown` の件数

- [ ] **Step 1: 失敗するテストを足す**（`pure_view_impediment.test.js` の末尾）

```js
const { openImpedimentsShown } = require('../pure_view_impediment.js');

test('行は表に出さない status も含めて全列を持つ（画面が競合判定の基準として送り返す）', () => {
  const v = buildImpedimentView([imp()], []);
  assert.deepEqual(Object.keys(v.open[0]).sort(),
    ['description', 'id', 'reported_at', 'reported_by', 'resolution', 'resolved_at', 'sprint', 'status', 'title']);
  assert.equal(v.open[0].status, 'Open');
});

test('両方にある ID は未解決から隠し、解決済にだけ出す（書き込みが途中で止まった状態）', () => {
  const v = buildImpedimentView([imp({ id: 'IMP-002' }), imp({ id: 'IMP-003' })],
    [imp({ id: ' IMP-002 ', status: 'Resolved' })]);
  assert.deepEqual(v.open.map((r) => r.id), ['IMP-003']);
  assert.deepEqual(v.resolved.map((r) => r.id.trim()), ['IMP-002']);
  assert.deepEqual(openImpedimentsShown([imp({ id: 'IMP-002' })], [imp({ id: 'IMP-002' })]), []);
});
```

`pure_summary.test.js` に足す（既存の `imp` 相当の見本が無ければ同じ形で定義する）:

```js
test('障害物の要約は、両方にある ID を未解決に数えない', () => {
  const row = (id) => ({ id: id, title: 'T', reported_at: '2026-10-01' });
  assert.deepEqual(summarizeImpediment([row('IMP-002'), row('IMP-003')], [row('IMP-002')]),
    { open: 1, resolved: 1 });
});
```

既存テスト「値は文字列になり、欠けた項目は空文字」がキーの集合を `IMPEDIMENT_COLUMNS` で照合しているなら、`IMPEDIMENT_FIELDS` 基準へ直す（列の表示順のテストは変えない）。

- [ ] **Step 2: 失敗を確認** — Run: `node --test gas/tests/pure_view_impediment.test.js gas/tests/pure_summary.test.js` / Expected: FAIL

- [ ] **Step 3: 実装** — `pure_view_impediment.js` を次のように変える

```js
if (typeof require !== 'undefined' && typeof isImpedimentPlaceholder === 'undefined') {
  var { isImpedimentPlaceholder, IMPEDIMENT_FIELDS } = require('./pure_grid_report.js');
}

// （IMPEDIMENT_COLUMNS は変えない）

function impedimentRows_(rows) {
  return (rows || []).filter(function (r) {
    return !isImpedimentPlaceholder(r);
  }).map(function (row) {
    // 表に出す列だけでなく全列を持たせる。画面はこの行をそのまま「見た行」として
    // 送り返し、サーバは全列で競合を判定する（障害物の CSV には updated_at が無い）。
    const out = {};
    IMPEDIMENT_FIELDS.forEach(function (f) {
      const v = row[f];
      out[f] = (v === undefined || v === null) ? '' : String(v);
    });
    return out;
  });
}

/**
 * 画面に出す未解決。雛形と、解決済にも在る ID を除く。
 * 解決は「resolved に足す → open から消す」の順で書くため、途中で止まると両方に残る。
 * そのときは解決済を正とする（もう一度「解決」を押すと open から消えて揃う）。
 */
function openImpedimentsShown(openRows, resolvedRows) {
  const done = Object.create(null);
  (resolvedRows || []).forEach(function (r) {
    if (!isImpedimentPlaceholder(r)) done[String(r.id || '').trim()] = true;
  });
  return (openRows || []).filter(function (r) {
    return !isImpedimentPlaceholder(r) && !done[String(r.id || '').trim()];
  });
}

function buildImpedimentView(openRows, resolvedRows) {
  return {
    columns: IMPEDIMENT_COLUMNS,
    open: impedimentRows_(openImpedimentsShown(openRows, resolvedRows)),
    resolved: impedimentRows_(resolvedRows),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_COLUMNS, buildImpedimentView, openImpedimentsShown };
}
```

`pure_summary.js` の `summarizeImpediment`:

```js
// ファイル先頭の require 群に足す（既存の書き方に合わせる）:
// if (typeof require !== 'undefined' && typeof openImpedimentsShown === 'undefined') {
//   var { openImpedimentsShown } = require('./pure_view_impediment.js');
// }

/** 障害物の要約。件数はファイル別。両方にある ID は解決済として数える（ビューと同じ規則）。 */
function summarizeImpediment(openRows, resolvedRows) {
  const resolved = (resolvedRows || []).filter(function (r) { return !isImpedimentPlaceholder(r); });
  return { open: openImpedimentsShown(openRows, resolvedRows).length, resolved: resolved.length };
}
```

- [ ] **Step 4: 通過を確認** — Run: `npm test` / Expected: 全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 障害物のビューに全列を持たせ、両方にある ID を解決済として扱う"`

---

### Task 5: サーバの書き込み API

**Files:**
- Modify: `gas/pure_write_guard.js`（`WRITABLE_FILES`）
- Modify: `gas/web_app.js`（`apiGetView` の `impediment` 枝、新しい関数群は `apiRestorePbi` の後ろ）
- Test: `gas/tests/pure_write_guard.test.js`、`gas/tests/web_app_flow.test.js`

**Interfaces:**
- Consumes: Task 1〜4 の全関数、`sprintChoices`、`assertHeaderMatches`、`writeScrumFile_`、`nowText_`
- Produces（画面が使う形）:
  - `apiGetView('impediment') → { ok, name, view, summary, sprintChoices }`
  - `apiCreateImpediment(fields) → { ok, view, summary, sprintChoices, id }`
  - `apiUpdateImpediment(id, fields, expected) → { ok, view, summary, sprintChoices }`
  - `apiResolveImpediment(id, resolution, expected) → { ok, view, summary, sprintChoices, moved, resolvedRow }`
  - `apiUnresolveImpediment(moved, resolvedRow) → { ok, view, summary, sprintChoices }`
  - 失敗: `{ ok:false, reason, message, view?, summary?, sprintChoices? }`。`reason` ∈ `busy|invalid|conflict|not_found|partial|error`

- [ ] **Step 1: 失敗するテストを書く**

`pure_write_guard.test.js` に足す:

```js
test('障害物の2ファイルにも書ける', () => {
  assert.doesNotThrow(() => assertWritableFileName('impediment_log.csv'));
  assert.doesNotThrow(() => assertWritableFileName('impediment_log_resolved.csv'));
  assert.throws(() => assertWritableFileName('velocity.csv'));
});
```

既存テストが `WRITABLE_FILES` を `['product_backlog.csv']` と完全一致で照合していれば、3件の配列へ直す。

`web_app_flow.test.js` の `createTestContext` の `makeFile` に失敗の注入を足す:

```js
// opts.failWriteFile: その名前の setContent だけ例外にする（2ファイル目の書き込み失敗を再現する）。
setContent: function (content) {
  if (opts.failWriteFile && name === opts.failWriteFile) {
    throw new Error('setContent はテストで意図的に失敗させています: ' + name);
  }
  files[name] = content;
},
```

末尾に足す:

```js
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

test('解決: 2つ目（未解決から消す）で失敗すると partial。もう一度押すと完了する', () => {
  const f = impFiles(IMP2);
  const first = createTestContext(f, { failWriteFile: 'impediment_log.csv' });
  const res = first.ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(res.reason, 'partial');
  assert.ok(res.message.indexOf('もう一度') !== -1);
  assert.ok(f['impediment_log.csv'].indexOf('IMP-002') !== -1, '未解決に残っている前提');
  assert.ok(f['impediment_log_resolved.csv'].indexOf('IMP-002') !== -1, '解決済に足された前提');
  assert.deepEqual(plain(res.view.open).map((r) => r.id), [], '両方にある間は未解決に出さない');

  const retry = createTestContext(f).ctx.apiResolveImpediment('IMP-002', '再起動した', IMP2_ROW);
  assert.equal(retry.ok, true, retry.message);
  assert.equal(f['impediment_log.csv'], IMP_HEADER + IMP_TEMPLATE);
  assert.equal(f['impediment_log_resolved.csv'].split('IMP-002').length - 1, 1, '解決済に二重に足した');
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
```

- [ ] **Step 2: 失敗を確認** — Run: `node --test gas/tests/web_app_flow.test.js gas/tests/pure_write_guard.test.js` / Expected: FAIL

- [ ] **Step 3: 実装**

`pure_write_guard.js`:

```js
// 障害物の2ファイルは第4段階で足した（作成・編集・解決）。
const WRITABLE_FILES = Object.freeze(['product_backlog.csv', 'impediment_log.csv', 'impediment_log_resolved.csv']);
```

`web_app.js` の `apiGetView` の `impediment` 枝を差し替える:

```js
    if (key === 'impediment') {
      const open = readCsvRowsBestEffort_(IMPEDIMENT_CSV_NAME);
      const done = readCsvRowsBestEffort_(IMPEDIMENT_RESOLVED_CSV_NAME);
      return Object.assign({ ok: true, name: key }, impedimentPayload_(open, done));
    }
```

`apiRestorePbi` の後ろに足す:

```js
/** 今日の日付（YYYY-MM-DD）。報告日・解決日に使う。 */
function todayText_() {
  return nowText_().slice(0, 10);
}

/** 障害物の応答の共通部分。パネルのスプリント欄の選択肢も載せる（盤面と同じ作り）。 */
function impedimentPayload_(openRows, resolvedRows) {
  return {
    view: buildImpedimentView(openRows, resolvedRows),
    summary: summarizeImpediment(openRows, resolvedRows),
    sprintChoices: sprintChoices(readCsvRowsBestEffort_(VELOCITY_CSV_NAME), openRows.concat(resolvedRows)),
  };
}

function readImpedimentRows_(name) {
  const text = readTextFile_(getScrumFolder_(), name);
  if (text === null) {
    throw new Error('scrum/' + name + ' が見つかりません。配布が済んでいるか確認してください。');
  }
  // 未知の列を持つ CSV へ書き戻すと列が消えるため、書く前に必ず検査する。
  assertHeaderMatches(text, IMPEDIMENT_FIELDS);
  return csvToObjects(text);
}

/**
 * 障害物の書き込みの共通手順。withBacklogWrite_ と同じく、ロックを取ってから2ファイルを
 * 読み直す。mutate(open, resolved) は { ok:true, open, resolved, extra? } を返す。
 * open / resolved は書くべき新しい配列か null（書かない）。
 *
 * Drive に複数ファイルのトランザクションは無い。書く順は呼び出し側が first で決める
 * （'resolved' か 'open'）。「足す側 → 消す側」にしておけば、途中で止まっても行は失われず、
 * 同じ ID が両方に残るだけになる（画面は解決済を正として出し、もう一度押せば揃う）。
 */
function withImpedimentWrite_(first, mutate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { ok: false, reason: 'busy', message: '他の更新が実行中です。少し待って再試行してください。' };
  }
  let open = null;
  let resolved = null;
  try {
    open = readImpedimentRows_(IMPEDIMENT_CSV_NAME);
    resolved = readImpedimentRows_(IMPEDIMENT_RESOLVED_CSV_NAME);
    const result = mutate(open, resolved);
    if (!result.ok) {
      return Object.assign({ ok: false, reason: result.reason, message: result.message }, impedimentPayload_(open, resolved));
    }
    const writes = [
      { name: IMPEDIMENT_CSV_NAME, key: 'open', rows: result.open },
      { name: IMPEDIMENT_RESOLVED_CSV_NAME, key: 'resolved', rows: result.resolved },
    ].filter(function (w) { return w.rows; });
    writes.sort(function (a, b) { return (a.key === first ? 0 : 1) - (b.key === first ? 0 : 1); });
    for (let i = 0; i < writes.length; i++) {
      try {
        writeScrumFile_(writes[i].name, toCsv(writes[i].rows, IMPEDIMENT_FIELDS));
      } catch (e) {
        if (i === 0) throw e;
        // 1つ目は書けている。画面には書けた側を反映して返す。
        if (writes[0].key === 'open') open = writes[0].rows; else resolved = writes[0].rows;
        return Object.assign({
          ok: false, reason: 'partial',
          message: '途中で止まりました。もう一度押すと完了します。（' + e.message + '）',
        }, impedimentPayload_(open, resolved));
      }
    }
    if (result.open) open = result.open;
    if (result.resolved) resolved = result.resolved;
    return Object.assign({ ok: true }, impedimentPayload_(open, resolved), result.extra || {});
  } catch (e) {
    const out = { ok: false, reason: 'error', message: e.message };
    if (open && resolved) Object.assign(out, impedimentPayload_(open, resolved));
    return out;
  } finally {
    lock.releaseLock();
  }
}

/** 障害物の競合・不在の定型文。 */
function impedimentMessage_(reason, retryHint) {
  if (reason === 'conflict') return '他の変更が先に入っています。最新の内容に更新しました。' + (retryHint || '');
  if (reason === 'not_found') return 'この障害物が見つかりません。最新の内容に更新しました。';
  return '入力が不正です。';
}

/** 編集を許した項目だけを取り出す。 */
function pickImpedimentFields_(fields) {
  const src = fields || {};
  const out = {};
  IMPEDIMENT_EDITABLE_FIELDS.forEach(function (f) {
    if (Object.prototype.hasOwnProperty.call(src, f)) out[f] = String(src[f] === null || src[f] === undefined ? '' : src[f]);
  });
  return out;
}

/** 障害物を作る。ID・報告日・status はサーバが決める。 */
function apiCreateImpediment(fields) {
  return withImpedimentWrite_('open', function (open, resolved) {
    const picked = pickImpedimentFields_(fields);
    const v = validateImpedimentFields(picked);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const id = nextImpedimentId(open.concat(resolved));
    const r = appendImpediment(open, id, picked, todayText_());
    if (!r.ok) return { ok: false, reason: r.reason, message: 'ID が重複しました。もう一度お試しください。' };
    return { ok: true, open: r.rows, resolved: null, extra: { id: id } };
  });
}

/** 未解決の障害物を書き換える。expected は画面が描いた時点の行（全列）。 */
function apiUpdateImpediment(id, fields, expected) {
  return withImpedimentWrite_('open', function (open) {
    const picked = pickImpedimentFields_(fields);
    const v = validateImpedimentFields(picked);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const r = updateImpediment(open, id, picked, expected);
    if (!r.ok) return { ok: false, reason: r.reason, message: impedimentMessage_(r.reason, '内容を確認し、もう一度保存すると上書きします。') };
    return { ok: true, open: r.rows, resolved: null };
  });
}

/** 解決する。解決済へ足してから、未解決から消す。 */
function apiResolveImpediment(id, resolution, expected) {
  return withImpedimentWrite_('resolved', function (open, resolved) {
    const v = validateResolution(resolution);
    if (!v.ok) return { ok: false, reason: 'invalid', message: v.errors.join('\n') };
    const r = planResolve(open, resolved, id, String(resolution), expected, todayText_());
    if (!r.ok) {
      const message = (r.reason === 'conflict' && !open.some(function (x) { return String(x.id || '').trim() === String(id || '').trim(); }))
        ? 'この障害物は既に解決済みです。最新の内容に更新しました。'
        : impedimentMessage_(r.reason, '内容を確認し、もう一度押すと解決します。');
      return { ok: false, reason: r.reason, message: message };
    }
    return { ok: true, open: r.open, resolved: r.resolved, extra: { moved: r.moved, resolvedRow: r.resolvedRow } };
  });
}

/** 解決を取り消す。未解決へ戻してから、解決済から消す。通知の「取り消す」から呼ばれる。 */
function apiUnresolveImpediment(moved, resolvedRow) {
  return withImpedimentWrite_('open', function (open, resolved) {
    const r = planUnresolve(open, resolved, moved, resolvedRow);
    if (!r.ok) {
      const message = r.reason === 'invalid' ? '取り消す内容が不正です。'
        : r.reason === 'conflict' ? '解決したあとに他の変更が入っています。取り消しはしません。'
        : impedimentMessage_(r.reason);
      return { ok: false, reason: r.reason, message: message };
    }
    return { ok: true, open: r.open, resolved: r.resolved };
  });
}
```

`gas_load.test.js` が公開面を数えている検査（`api` で始まる関数の一覧等）があれば、4つを足す。
`grep -n "apiRestorePbi" gas/tests/*.js` で一覧を持つ検査を探して揃える。

- [ ] **Step 4: 通過を確認** — Run: `npm test` / Expected: 全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "feat: 障害物の作成・編集・解決・取り消しの API を足す"`

---

### Task 6: 画面（障害物パネル）

**Files:**
- Modify: `gas/kanban.html`
- Modify: `gas/tests/kanban_harness.js`（動的要素を押すヘルパー）
- Test: `gas/tests/kanban_impediment.test.js`（新規）

**Interfaces:**
- Consumes: Task 5 の応答の形
- Produces（ハーネス）:
  - `h.clickImpRow(id)` — `#table-view` の中の `tr[data-id=id]` を押す（隠れていれば例外）
  - `h.clickImpAdd()` — `#imp-add` を押す

- [ ] **Step 1: ハーネスにヘルパーを足す**（`createHarness` の返り値、`clickView` の後ろ）

```js
    /** #table-view の中の、data-id がその値の行を押す（障害物の未解決の行）。 */
    clickImpRow: function (id) {
      const hit = collect(byId['table-view'], function (e) { return e.tagName === 'tr' && e.dataset.id === id; });
      if (hit.length !== 1) throw new Error('行 ' + id + ' が ' + hit.length + ' 件見つかりました');
      fireVisible(hit[0], 'click', {}, '行 ' + id);
    },

    /** 障害物タブの「障害物を追加」を押す。 */
    clickImpAdd: function () {
      const hit = collect(byId['table-view'], function (e) { return e.id === 'imp-add'; });
      if (hit.length !== 1) throw new Error('「障害物を追加」が ' + hit.length + ' 件見つかりました');
      fireVisible(hit[0], 'click', {}, '「障害物を追加」');
    },
```

`collect` が `e.dataset` を持たない要素で落ちないことを確かめる（`Element` は `dataset = {}` を持つので可）。

- [ ] **Step 2: 失敗するテストを書く**（`gas/tests/kanban_impediment.test.js`）

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHarness } = require('./kanban_harness.js');

const INITIAL = [
  { status: 'New', cards: [] }, { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
  { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
];
const ROW = { id: 'IMP-002', title: '止まっている', description: '', reported_by: 'マヤ',
  reported_at: '2026-10-01', status: 'Open', resolved_at: '', resolution: '', sprint: 'sprint001' };
const COLUMNS = [{ field: 'id', label: 'ID' }, { field: 'title', label: 'タイトル' }];
const CHOICES = [{ value: '', label: '（未割り当て）' }, { value: 'sprint001', label: 'sprint001' }];

function impResponse(open, resolved) {
  return { ok: true, name: 'impediment',
    view: { columns: COLUMNS, open: open, resolved: resolved || [] },
    summary: { open: open.length, resolved: (resolved || []).length }, sprintChoices: CHOICES };
}

const latest = (h) => h.calls[h.calls.length - 1];

/** 障害物タブを開き、ROW が1件ある状態にする。 */
function onImpediment() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 0, points: 0 } }, sprintChoices: CHOICES });
  h.clickTab('障害物');
  latest(h).handlers.success(impResponse([ROW]));
  return h;
}

test('未解決の行を押すとパネルが開き、値が入る', () => {
  const h = onImpediment();
  assert.equal(h.hiddenOf('imp-panel'), true);
  h.clickImpRow('IMP-002');
  assert.equal(h.hiddenOf('imp-panel'), false);
  assert.equal(h.textOf('imp-panel-title'), 'IMP-002');
  assert.equal(h.valueOf('i-title'), '止まっている');
  assert.equal(h.valueOf('i-reported-by'), 'マヤ');
  assert.equal(h.valueOf('i-sprint'), 'sprint001');
  assert.equal(h.hiddenOf('i-resolution-field'), true, '解決策は「解決する」を押すまで出さない');
});

test('保存は、見た行（全列）を expected として送る', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.setValue('i-title', '新しい題');
  h.click('imp-panel-save');
  const c = latest(h);
  assert.equal(c.method, 'apiUpdateImpediment');
  assert.equal(c.args[0], 'IMP-002');
  assert.equal(c.args[1].title, '新しい題');
  assert.deepEqual(c.args[2], ROW);
  c.handlers.success(impResponse([Object.assign({}, ROW, { title: '新しい題' })]));
  assert.equal(h.hiddenOf('imp-panel'), true, '成功したら閉じる');
  assert.equal(h.tableRowsOf('table-view')[0][1].text, '新しい題');
});

test('競合したらパネルは開いたまま、次の保存は最新の行を基準にする', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const changed = Object.assign({}, ROW, { description: '誰かが追記' });
  latest(h).handlers.success(Object.assign(impResponse([changed]), { ok: false, reason: 'conflict', message: '他の変更が先に入っています。' }));
  assert.equal(h.hiddenOf('imp-panel'), false);
  assert.ok(h.classOf('imp-panel-message').indexOf('error') !== -1);
  h.click('imp-panel-save');
  assert.deepEqual(latest(h).args[2], changed);
});

test('「障害物を追加」で空のパネルが開き、作成を呼ぶ。解決するボタンは出さない', () => {
  const h = onImpediment();
  h.clickImpAdd();
  assert.equal(h.textOf('imp-panel-title'), '新しい障害物');
  assert.equal(h.valueOf('i-title'), '');
  assert.equal(h.hiddenOf('imp-panel-resolve'), true);
  h.setValue('i-title', 'A');
  h.setValue('i-reported-by', 'B');
  h.click('imp-panel-save');
  assert.equal(latest(h).method, 'apiCreateImpediment');
  assert.equal(latest(h).args[0].title, 'A');
});

test('解決は2段階。1回目で解決策の欄が出て、2回目で確定する', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  const before = h.calls.length;
  h.click('imp-panel-resolve');
  assert.equal(h.calls.length, before, '1回目で送ってしまった');
  assert.equal(h.hiddenOf('i-resolution-field'), false);
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  const c = latest(h);
  assert.equal(c.method, 'apiResolveImpediment');
  assert.deepEqual(c.args, ['IMP-002', '再起動した', ROW]);
});

test('解決したら通知が出て、取り消すと apiUnresolveImpediment を呼ぶ', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-resolve');
  h.setValue('i-resolution', '再起動した');
  h.click('imp-panel-resolve');
  const resolvedRow = Object.assign({}, ROW, { status: 'Resolved', resolution: '再起動した' });
  latest(h).handlers.success(Object.assign(impResponse([], [resolvedRow]), { moved: ROW, resolvedRow: resolvedRow }));
  assert.equal(h.hiddenOf('imp-panel'), true);
  assert.equal(h.hiddenOf('toast'), false);
  h.click('toast-undo');
  const c = latest(h);
  assert.equal(c.method, 'apiUnresolveImpediment');
  assert.deepEqual(c.args, [ROW, resolvedRow]);
});

test('解決済の行は押せない（data-id を持たない）', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  h.clickTab('障害物');
  latest(h).handlers.success(impResponse([], [Object.assign({}, ROW, { status: 'Resolved' })]));
  assert.throws(() => h.clickImpRow('IMP-002'), /0 件/);
});

test('応答待ちの間に別タブへ移ったら、障害物の応答で表を描き直さない', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.click('imp-panel-save');
  const pending = latest(h);
  h.clickTab('やること');
  latest(h).handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 0, points: 0 } } });
  pending.handlers.success(impResponse([ROW]));
  assert.equal(h.hiddenOf('table-view'), true, '盤面のタブなのに表が出た');
  assert.ok(h.textTreeOf('summary').indexOf('未解決') === -1, '盤面の要約が障害物のものに置き換わった');
});

test('Escape で障害物パネルが閉じる。タブを移っても閉じる', () => {
  const h = onImpediment();
  h.clickImpRow('IMP-002');
  h.pressKey('Escape');
  assert.equal(h.hiddenOf('imp-panel'), true);
  h.clickImpRow('IMP-002');
  h.clickTab('やること');
  assert.equal(h.hiddenOf('imp-panel'), true);
});
```

- [ ] **Step 3: 失敗を確認** — Run: `node --test gas/tests/kanban_impediment.test.js` / Expected: FAIL（`imp-panel` が無い）

- [ ] **Step 4: マークアップを足す** — `<aside id="panel"` に `class="side-panel"` を足し、その `</aside>` の直後に置く:

```html
  <aside id="imp-panel" class="side-panel" hidden aria-label="障害物の詳細">
    <div class="panel-head">
      <h2 id="imp-panel-title">障害物</h2>
      <span class="spacer"></span>
      <button id="imp-panel-close" class="icon-only" type="button" aria-label="閉じる"></button>
    </div>
    <div class="field">
      <label for="i-title">タイトル</label>
      <input id="i-title" type="text">
    </div>
    <div class="field">
      <label for="i-description">説明</label>
      <textarea id="i-description"></textarea>
    </div>
    <div class="row">
      <div class="field">
        <label for="i-reported-by">報告者</label>
        <input id="i-reported-by" type="text">
      </div>
      <div class="field">
        <label for="i-sprint">スプリント</label>
        <select id="i-sprint"></select>
      </div>
    </div>
    <div id="i-resolution-field" class="field" hidden>
      <label for="i-resolution">解決策</label>
      <textarea id="i-resolution"></textarea>
    </div>
    <div id="imp-panel-message" class="info"></div>
    <div class="panel-foot">
      <button id="imp-panel-save" class="primary" type="button"></button>
      <span class="spacer"></span>
      <button id="imp-panel-resolve" type="button"></button>
    </div>
  </aside>
```

- [ ] **Step 5: CSS を共有にする** — `<style>` の中で次を置き換える（`grep -n "#panel" gas/kanban.html` で全件を確認）:
  - `#panel {` → `.side-panel {`、`#panel h2` → `.side-panel h2`
  - `@media (max-width: 900px) { #panel { flex: 1 1 auto; width: 100%; } }` → `.side-panel`
  - `#main:has(#panel:not([hidden])) ~ #toast` → `#main:has(.side-panel:not([hidden])) ~ #toast`
  - `#panel-message { … }` / `#panel-message.error { … }` → `#panel-message, #imp-panel-message { … }` / `#panel-message.error, #imp-panel-message.error { … }`
  - `[hidden]` を打ち消す規則に `#panel` が列挙されていれば `.side-panel` を足す
  - 足す:

```css
  /* 障害物の未解決の行は押すとパネルが開く。解決済の行は押せない（閲覧のみ）。 */
  tr.clickable { cursor: pointer; }
  tr.clickable:hover td, tr.clickable:focus td { background: var(--card-2); }
  tr.clickable:focus { outline: 2px solid var(--accent); outline-offset: -2px; }
  .table-actions { margin: var(--sp-3) 0; }
```

  静的検査（`kanban_ui_structure.test.js` / `kanban_contrast.test.js` / `gas/tests/browser/probe_source.js`）が `#panel` のセレクタ文字列を探していれば、`.side-panel` へ揃える。

- [ ] **Step 6: スクリプトを足す**

`objectTable` に行の押下を受ける引数を足す:

```js
/** columns と rows から表を作る。onRow があれば各行を押せる行にする（障害物の未解決）。 */
function objectTable(columns, rows, onRow) {
  if (!rows || rows.length === 0) return emptyTableRow('ありません。');
  var table = document.createElement('table');
  table.appendChild(tableHead(columns.map(function (c) { return c.label; })));
  var tbody = document.createElement('tbody');
  rows.forEach(function (row) {
    var tr = document.createElement('tr');
    columns.forEach(function (c) {
      var td = document.createElement('td');
      var v = row[c.field];
      td.textContent = (v === null || v === undefined) ? '' : String(v);
      tr.appendChild(td);
    });
    if (onRow) {
      tr.className = 'clickable';
      tr.dataset.id = row.id;
      tr.setAttribute('tabindex', '0');
      tr.addEventListener('click', function () { onRow(row); });
      tr.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { if (ev.preventDefault) ev.preventDefault(); onRow(row); }
      });
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function tableSection(title, columns, rows, onRow) {
  var section = document.createElement('div');
  var h = document.createElement('h3');
  h.textContent = title;
  section.appendChild(h);
  section.appendChild(objectTable(columns, rows, onRow));
  return section;
}
```

`renderTable` の障害物の枝を差し替える:

```js
  // 障害物は未解決と解決済の2つの表になる。未解決の行だけ押せる。
  if (view.open !== undefined && view.resolved !== undefined) {
    impView = view;
    var actions = document.createElement('div');
    actions.className = 'table-actions';
    var add = document.createElement('button');
    add.id = 'imp-add';
    add.type = 'button';
    fillButton(add, 'plus', '障害物を追加');
    add.addEventListener('click', function () { openImpPanel(null); });
    actions.appendChild(add);
    host.appendChild(actions);
    host.appendChild(tableSection('未解決', view.columns, view.open, function (row) { openImpPanel(row.id); }));
    host.appendChild(tableSection('解決済', view.columns, view.resolved));
    return;
  }
```

`fillButton` のアイコン名 `plus` が無ければ、盤面の「追加」ボタンが使っている名前（`grep -n "fillButton(" gas/kanban.html`）に揃える。

`restorePbi` の後ろに障害物パネルの関数群を足す:

```js
// --- 障害物パネル -----------------------------------------------------------
// PBI のパネルとは項目も競合判定も違う（障害物の CSV には updated_at が無く、
// 見た行の全列を送り返して比べる）ため、状態を分けて持つ。
var impView = null;   // 最後に描いた障害物のビュー（パネルの値の出どころ）
var impPanelState = { id: null, expected: null, resolving: false };
var impPanelSeq = 0;
var IMP_FORM_FIELD_IDS = ['i-title', 'i-description', 'i-reported-by', 'i-sprint', 'i-resolution'];

function findImpRow(id) {
  var rows = (impView && impView.open) || [];
  for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i];
  return null;
}

function setImpPanelMessage(text, kind) {
  var el = document.getElementById('imp-panel-message');
  el.textContent = text || '';
  el.className = kind || 'info';
}

function setImpPanelBusy(busy) {
  document.getElementById('imp-panel-save').disabled = busy;
  document.getElementById('imp-panel-resolve').disabled = busy;
  IMP_FORM_FIELD_IDS.forEach(function (id) { document.getElementById(id).disabled = busy; });
}

function fillImpSprintSelect(value) {
  var el = document.getElementById('i-sprint');
  clearHost(el);
  var seen = false;
  sprintChoices.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c.value;
    o.textContent = c.label;
    if (c.value === value) seen = true;
    el.appendChild(o);
  });
  // 今の値が選択肢に無くても失わない（PBI の fillSprintSelect と同じ考え方）。
  if (!seen && value) {
    var extra = document.createElement('option');
    extra.value = value;
    extra.textContent = value;
    el.appendChild(extra);
  }
  el.value = value;
}

function setImpResolving(on) {
  impPanelState.resolving = on;
  document.getElementById('i-resolution-field').hidden = !on;
  fillButton(document.getElementById('imp-panel-resolve'), 'check', on ? '解決を確定' : '解決する');
}

/** id が null なら新規作成。 */
function openImpPanel(id) {
  var row = id ? findImpRow(id) : null;
  if (id && !row) return;
  closePanel();   // PBI のパネルと同時には開かない
  impPanelSeq++;
  impPanelState = { id: id, expected: row, resolving: false };
  document.getElementById('imp-panel-title').textContent = id ? id : '新しい障害物';
  document.getElementById('i-title').value = (row && row.title) || '';
  document.getElementById('i-description').value = (row && row.description) || '';
  document.getElementById('i-reported-by').value = (row && row.reported_by) || '';
  document.getElementById('i-resolution').value = '';
  // 既定は最新のスプリント（選択肢の末尾）。既存の行はその値のまま。
  var latestSprint = sprintChoices.length ? sprintChoices[sprintChoices.length - 1].value : '';
  fillImpSprintSelect(row ? String(row.sprint || '').trim() : latestSprint);
  document.getElementById('imp-panel-resolve').hidden = !id;
  setImpResolving(false);
  setImpPanelMessage('', 'info');
  setImpPanelBusy(false);
  document.getElementById('imp-panel').hidden = false;
  document.getElementById('i-title').focus();
}

function closeImpPanel() {
  document.getElementById('imp-panel').hidden = true;
  impPanelSeq++;
  impPanelState = { id: null, expected: null, resolving: false };
}

function readImpForm() {
  return {
    title: document.getElementById('i-title').value,
    description: document.getElementById('i-description').value,
    reported_by: document.getElementById('i-reported-by').value,
    sprint: document.getElementById('i-sprint').value,
  };
}

/**
 * 障害物の書き込みの応答を受ける共通部分。表と要約は、今も障害物のビューを見ているときだけ
 * 描き直す（応答待ちの間に別タブへ移っていれば、そのタブの表と要約を上書きしない）。
 */
function applyImpResponse(res) {
  if (res.sprintChoices) sprintChoices = res.sprintChoices;
  if (!res.view) return;
  impView = res.view;
  if (activeView === 'impediment') {
    renderTable(res.view);
    renderSummary(res.summary);
  }
}

/** 書き込みを送る。after(res) は成功時にパネルが同じものなら呼ばれる。 */
function sendImpWrite(method, args, label, after) {
  var seq = impPanelSeq;
  setImpPanelBusy(true);
  var runner = google.script.run
    .withSuccessHandler(function (res) {
      var mine = (seq === impPanelSeq);
      if (mine) setImpPanelBusy(false);
      if (res.ok) writeSeq++;
      applyImpResponse(res);
      if (res.ok) { after(res, mine); return; }
      // 競合のあとは、次に送る基準を最新の行へ進める（PBI の syncPanelExpectedUpdatedAt と同じ理由）。
      if (mine && impPanelState.id) {
        var latest = findImpRow(impPanelState.id);
        if (latest) impPanelState.expected = latest;
      }
      if (mine) setImpPanelMessage(res.message, 'error');
      else setMessage(res.message, 'error');
    })
    .withFailureHandler(function (err) {
      if (seq === impPanelSeq) {
        setImpPanelBusy(false);
        setImpPanelMessage(label + 'に失敗しました: ' + err.message, 'error');
      } else {
        setMessage(label + 'に失敗しました: ' + err.message, 'error');
      }
    });
  runner[method].apply(runner, args);
}

function saveImpPanel() {
  var id = impPanelState.id;
  var fields = readImpForm();
  if (id) {
    sendImpWrite('apiUpdateImpediment', [id, fields, impPanelState.expected], '保存', function (res, mine) {
      if (mine) closeImpPanel();
      setMessage(id + ' を保存しました。', 'info');
    });
  } else {
    sendImpWrite('apiCreateImpediment', [fields], '作成', function (res, mine) {
      if (mine) closeImpPanel();
      setMessage(res.id + ' を作成しました。', 'info');
    });
  }
}

/** 1回目は解決策の欄を出すだけ。2回目で送る（取り消せるが、誤って押しただけで解決させない）。 */
function resolveImp() {
  var id = impPanelState.id;
  if (!id) return;
  if (!impPanelState.resolving) {
    setImpResolving(true);
    document.getElementById('i-resolution').focus();
    return;
  }
  var title = document.getElementById('i-title').value;
  var resolution = document.getElementById('i-resolution').value;
  sendImpWrite('apiResolveImpediment', [id, resolution, impPanelState.expected], '解決', function (res, mine) {
    if (mine) closeImpPanel();
    showUndoToast(id + '「' + title + '」を解決しました。', function () { unresolveImp(res.moved, res.resolvedRow); });
  });
}

function unresolveImp(moved, resolvedRow) {
  if (!moved || !resolvedRow) { setMessage('取り消せませんでした。最新にしてから確認してください。', 'error'); return; }
  setMessage(moved.id + ' を戻しています…', 'info');
  google.script.run
    .withSuccessHandler(function (res) {
      if (res.ok) writeSeq++;
      applyImpResponse(res);
      setMessage(res.ok ? moved.id + ' を未解決に戻しました。' : res.message, res.ok ? 'info' : 'error');
    })
    .withFailureHandler(function (err) {
      setMessage('取り消せませんでした: ' + err.message, 'error');
    })
    .apiUnresolveImpediment(moved, resolvedRow);
}
```

`inflight` / `overlapped` / `pendingIds` は盤面のカードの会計（`settleOverlap` が「board 全体を信じてよいか」を
決める）なので、障害物側では触らない。`writeSeq` だけは進める（`loadView()` が発行後の書き込みを見分けるため）。

`ICON_PATHS` に解決ボタン用の `check` を足す（既存は `plus save trash close reload undo` のみ）:

```js
  check:  ['M3 8.4 6.4 11.6 13 4.8'],
```

`openPanel` の先頭（`var card = …` の前）に `closeImpPanel();` を足す（両パネルを同時に開かない）。
`switchTab` / `switchView` の `closePanel();` の直後に `closeImpPanel();` を足す。
Escape の処理の最後を次にする:

```js
  if (!document.getElementById('panel').hidden) { closePanel(); return; }
  if (!document.getElementById('imp-panel').hidden) closeImpPanel();
```

初期化（`fillButton(document.getElementById('panel-delete') …` の並び）に足す:

```js
fillButton(document.getElementById('imp-panel-save'), 'save', '保存');
document.getElementById('imp-panel-close').addEventListener('click', closeImpPanel);
document.getElementById('imp-panel-save').addEventListener('click', saveImpPanel);
document.getElementById('imp-panel-resolve').addEventListener('click', resolveImp);
```

`imp-panel-close` のアイコンは `panel-close` と同じ入れ方（`grep -n "panel-close" gas/kanban.html`）に揃える。
アイコン名 `save` / `check` が無ければ既存の `panel-save` が使っている名前に揃える。

`showUndoToast` の上書き時の文面を操作に依らない形にする:

```js
    setMessage(activeToastText + '（もう取り消せません）', 'info');
```

`grep -rn "この削除はもう取り消せません" gas/tests` で照合している検査があれば同じ文面へ直す。

- [ ] **Step 7: 通過を確認** — Run: `npm test` / Expected: 全件 PASS（`kanban_impediment.test.js` を含む）
- [ ] **Step 8: コミット** — `git commit -m "feat: 障害物タブから作成・編集・解決できるようにする"`

---

### Task 7: 実ブラウザの検査を足す

**Files:**
- Modify: `gas/tests/browser/fixtures.js`（障害物の応答に `sprintChoices` と全列）
- Modify: `gas/tests/browser/probe_source.js` / `gas/tests/browser/kanban_browser.test.js`

**Interfaces:**
- Consumes: Task 6 の `#imp-panel`、`.side-panel`

- [ ] **Step 1: 見本を合わせる** — `fixtures.js` の障害物の応答を `impedimentPayload_` と同じ形（`view` / `summary` / `sprintChoices`）にする。未解決が1件以上あることを確かめる（無ければ1件足す）。

- [ ] **Step 2: 測定を足す** — `probe_source.js` の、`#panel` の幅を測っている処理（`panelWidth` を組み立てている箇所）の後ろで、障害物タブへ切り替え → 未解決の最初の `tr.clickable` を押す → `#imp-panel` の `getBoundingClientRect().width` を `impPanelWidth` として返す。測り終えたら Escape で閉じる。

- [ ] **Step 3: 検査を足す** — `kanban_browser.test.js` の「パネルの幅は、宣言どおり（380px）になる」の直後:

```js
        test('障害物パネルの幅も、宣言どおり（380px）になる', () => {
          if (width <= 900) return;   // 900px 以下は全幅にする設計
          assert.equal(measured[where].toast.impPanelWidth, 380,
            where + ': 障害物パネルの実測幅が宣言と違う（.side-panel の規則が効いていない）');
        });
```

- [ ] **Step 4: 通過を確認** — Run: `npm run test:browser` / Expected: 全件 PASS
- [ ] **Step 5: コミット** — `git commit -m "test: 障害物パネルの幅を実ブラウザで検査する"`

---

### Task 8: 文書を直す

**Files:**
- Modify: `CLAUDE.md`、`README.md`、`docs/setup.md`

- [ ] **Step 1: 対象を全件拾う**

Run: `git grep -n -e "閲覧専用" -e "見るだけ" -e "未対応" -e "次の段階" -e "この1ファイルだけ" -e "product_backlog.csv\` 以外" -- CLAUDE.md README.md docs/setup.md`

- [ ] **Step 2: 書き換える**（短く。全体ルール「簡潔に」）
  - `CLAUDE.md` 冒頭: 「障害物」タブは閲覧専用 → 「障害物」タブでは障害物の作成・編集・解決ができる（スプリントは閲覧のみ）
  - `CLAUDE.md`「人がやること」: Web アプリが書くのは `product_backlog.csv` と `impediment_log.csv` / `impediment_log_resolved.csv` の3ファイル。解決は未解決から解決済へ行を移す
  - `README.md` の表: 「障害物を見る」→「障害物を記録・解決する」、「作成・編集・解決」可。FAQ の「障害物を追加・編集・解決したい」の行を、手順（障害物タブ →「障害物を追加」／行を押す →「解決する」）に置き換える
  - `docs/setup.md` 手順9: 「障害物」タブの閲覧のみの注記を外す
  - 第3段階の設計書の段階表の「第4段階 未着手」は過去の記録なので触らない

- [ ] **Step 3: 確認** — Run: `npm test` / Expected: PASS（`scripts_publish.test.js` 等が文書を読んでいても壊れない）
- [ ] **Step 4: コミット** — `git commit -m "docs: 障害物を Web アプリから記録・解決できることを反映する"`

---

## 仕上げ

- `npm run test:all` が通ること
- PR を作り、bot のレビューを triage してからマージする
- `clasp push` と Web アプリの再デプロイ（`create-deployment -i <第2段階から使っているデプロイ ID>`）
- 実機で、設計書「実機で確かめること」の3点を確かめる
