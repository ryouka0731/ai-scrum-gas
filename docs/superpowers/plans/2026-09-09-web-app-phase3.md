# Web アプリ第3段階（対象で分けるタブ + スプリント・障害物のビュー）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** カンバン1枚だけだったアプリに、やること・スプリント・障害物の3タブと各ビューを足し、
「人はアプリだけを見る」を成立させる。

**Architecture:** 概念モデルの3つの対象でタブを立て、その中でビューを切り替える。
ビューのデータ組み立ては `pure_view_*.js` に置き、既存の `pure_grid_*.js`（シート用）は触らない。
読み取り API は `apiGetView(name)` 1本に集約する。

**Tech Stack:** Google Apps Script (V8), HTML Service, 素の JavaScript（ES5 相当の書き方）,
`node --test` + 自前の DOM シム

**Spec:** `docs/superpowers/specs/2026-09-09-web-app-phase3-design.md`
**概念モデル:** `docs/superpowers/specs/2026-09-09-concept-model.md`

## Global Constraints

- **GAS は全 `.js` を単一のグローバル字句スコープで評価する。** トップレベルの `const` を
  2ファイルで同名宣言するとプロジェクト全体がロードに失敗する。`gas/tests/gas_load.test.js` が検出する。
- **既存の `const`（`KANBAN_STATUSES` / `BACKLOG_FIELDS` / `BOARD_CARD_FIELDS` など）を
  `var { X } = require(...)` で受けてはならない。** `var` 再宣言が `const` と衝突する。
  新しい純関数は必要な定数を**引数で受け取る**（既存の `toCsv(rows, fields)` と同じ形）。
- **`google.script.run` はプロジェクト内の全グローバル関数をブラウザへ公開する。** 末尾 `_` の
  関数だけが呼べない。**公開してよいのは次の13個のみ**（本計画で `apiGetBoard` → `apiGetView` に
  入れ替わるが、総数は変わらない）:
  `doGet` / `apiGetView` / `apiUpdateStatus` / `apiCreatePbi` / `apiUpdatePbi` / `apiDeletePbi` /
  `apiRestorePbi` / `onOpen` / `menuSyncNow` / `menuConfigure` / `menuInstallTrigger` /
  `menuRemoveTrigger` / `scheduledSync`
- **`function f(){}` を `const f = function(){}` に書き換えない。** トップレベル `const` は
  グローバル解決に乗らず、名前で呼ばれる関数が動かなくなる。
- **外部 CDN を読み込まない。**
- **`innerHTML` にユーザー由来の文字列を入れない。** 完了時に
  `grep -c 'innerHTML' gas/kanban.html` が **3**（`render` のクリア、`fillSelect` のクリア、
  本計画で足すビュー領域のクリア1つ）であること。
- **モーダルを作らない。** `grep -c 'overlay' gas/kanban.html` と `grep -c 'confirm' gas/kanban.html`
  が **0** のまま。補足もモーダルにしない。
- **既存の `pure_grid_*.js` は触らない。** シートの同期が使い続ける。
- テストは `node --test "gas/tests/*.test.js"`（**クォート必須**。外すと Node 22 で MODULE_NOT_FOUND）。
  着手時 **290 件**。
- ドキュメントとコメントとテスト名は日本語。簡潔に、短く。

## この画面で繰り返し起きてきたこと

**応答の到達順により画面とサーバが永続的に食い違う不具合を、この画面で5回踏んでいる。**
いずれも成功メッセージが出て送信中の印も消えるため、利用者に手がかりが一切ない。
**5回ともコードを読むだけでは見えず、実行して初めて分かった。**

`gas/kanban.html` には次の仕組みがある。**意味を変えないこと。**

- `inflight`（送信中の要求数）/ `overlapped` / `settleOverlap()` → `trustWholeBoard`
- `pendingIds`（**カードの見た目と操作抑止**専用。会計には使わない）
- `panelSeq` / `seq` / `mine`（応答時に「まだ同じパネルを開いているか」を見る）
- `mergeOneCard(current, serverBoard, id)`
- `writeSeq`（`load()` の応答が、その発行後に確定した書き込みを含まない古い board かを見分ける）
- **board の反映は必ず行い、パネルに触る操作だけを `mine` に限る**

**さらに、5回のシムレビューが全て見逃した Critical が実ブラウザで見つかっている**
（`#panel { display: flex }` が UA スタイルの `[hidden] { display: none }` を打ち消した）。
**DOM シムは CSS を評価しない。** 表示に関わる欠陥は静的検査か実ブラウザで確かめる。

## File Structure

| ファイル | 責務 |
|---|---|
| `gas/pure_glossary.js`（新規） | 用語と説明。1か所の真実の源泉 |
| `gas/pure_sprint_options.js`（新規） | スプリントの選択肢の組み立て |
| `gas/pure_view_backlog.js`（新規） | 一覧・完了のビューのデータ |
| `gas/pure_view_sprint.js`（新規） | バーンダウン・ベロシティ・ロードマップのビューのデータ |
| `gas/pure_view_impediment.js`（新規） | 障害物の一覧のビューのデータ |
| `gas/pure_summary.js`（新規） | 各タブの要約 |
| `gas/pure_grid_board.js`（変更） | `realSprints` を `module.exports` に足すだけ |
| `gas/web_app.js`（変更） | `apiGetBoard` → `apiGetView(name)`。各ビューの読み取り |
| `gas/kanban.html`（変更） | タブ、ビューの切り替え、表の描画、補足、用語の差し替え、スプリントのプルダウン |
| `gas/tests/pure_glossary.test.js` ほか（新規） | 各純関数の検査 |
| `gas/tests/kanban_view.test.js`（新規） | タブとビューの切り替え、補足 |

---

### Task 1: 用語集

**Files:**
- Create: `gas/pure_glossary.js`
- Test: `gas/tests/pure_glossary.test.js`

**Interfaces:**
- Consumes: なし
- Produces: `GLOSSARY`（`{ [term: string]: string }`）、`glossaryOf(term)` → `string`（無ければ `''`）

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_glossary.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { GLOSSARY, glossaryOf } = require('../pure_glossary.js');

// 画面で使う語。ここに挙げたものは必ず説明を持つこと。
const USED_IN_UI = [
  'ストーリーポイント', 'ベロシティ', 'バーンダウン', 'ロードマップ',
  'スプリント', '障害物', '受入基準',
  'New', 'Ready', 'In Progress', 'Review', 'Done',
  'Critical', 'High', 'Medium', 'Low',
];

test('画面で使う語はすべて説明を持つ', () => {
  USED_IN_UI.forEach((t) => {
    assert.ok(GLOSSARY[t], t + ' の説明が無い');
  });
});

test('説明は空でなく、用語そのものの言い換えで終わらない', () => {
  Object.keys(GLOSSARY).forEach((t) => {
    const d = GLOSSARY[t];
    assert.ok(d.trim().length >= 10, t + ' の説明が短すぎる: ' + d);
    assert.notEqual(d.trim(), t, t + ' の説明が用語そのもの');
  });
});

test('ストーリーポイントの説明がベロシティとの関係に触れる', () => {
  // 同じ数字に見えて別物なので、ここを外すと混乱する。
  assert.ok(GLOSSARY['ストーリーポイント'].indexOf('ベロシティ') !== -1);
});

test('ベロシティの説明がスプリント単位であることに触れる', () => {
  assert.ok(GLOSSARY['ベロシティ'].indexOf('スプリント') !== -1);
});

test('glossaryOf は知らない語に空文字を返す', () => {
  assert.equal(glossaryOf('しらない語'), '');
  assert.equal(glossaryOf(''), '');
  assert.equal(glossaryOf(null), '');
  assert.equal(glossaryOf(undefined), '');
});

test('glossaryOf は前後の空白を無視する', () => {
  assert.equal(glossaryOf('  ベロシティ  '), GLOSSARY['ベロシティ']);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_glossary.test.js"`
Expected: FAIL（`Cannot find module '../pure_glossary.js'`）

- [ ] **Step 3: 実装する**

`gas/pure_glossary.js`:

```javascript
/**
 * 用語と説明。GAS API に依存しない純関数。
 *
 * スクラムには専門用語が多い。同じ言葉の説明が画面ごとに違うと、それ自体が
 * 混乱のもとになるため、ここを唯一の源泉にする。
 */

const GLOSSARY = {
  'ストーリーポイント':
    'その項目1つの相対的な大きさ。時間ではない。ベロシティは、完了したストーリーポイントの合計。',
  'ベロシティ':
    'チームが1スプリントで完了できたストーリーポイントの合計。次のスプリントで積める量の目安になる。',
  'バーンダウン':
    'スプリントの残り作業が日を追ってどう減ったかの記録。線が下がりきればスプリントの目標に届く。',
  'ロードマップ':
    'どのやることを、どのスプリントで扱う予定かの一覧。帯の位置が期間を表す。',
  'スプリント':
    '区切られた作業期間。この単位で計画し、終わりに成果を確かめる。',
  '障害物':
    'チームの進みを妨げているもの。気づいた人が書き出し、取り除けたら解決済みにする。',
  '受入基準':
    'そのやることが「終わった」と言える条件。セミコロン（;）で区切って複数書く。',
  'New': 'まだ着手していない段階。',
  'Ready': '着手できる状態まで内容が定まった段階。',
  'In Progress': '誰かが手をつけている段階。',
  'Review': '受入基準を満たしたかを確かめている段階。',
  'Done': '受入基準を満たし、完了と認められた段階。',
  'Critical': '最優先。これが止まると他が進まない。',
  'High': '最優先ではないが、早く着手すべきもの。',
  'Medium': '通常の優先度。',
  'Low': '手が空いたときに扱うもの。',
};

/** 用語の説明を返す。知らない語なら空文字。 */
function glossaryOf(term) {
  const key = String(term === null || term === undefined ? '' : term).trim();
  if (!key) return '';
  return Object.prototype.hasOwnProperty.call(GLOSSARY, key) ? GLOSSARY[key] : '';
}

if (typeof module !== 'undefined') { module.exports = { GLOSSARY, glossaryOf }; }
```

- [ ] **Step 4: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（290 + 6 = 296 件）

- [ ] **Step 5: コミット**

```bash
git add gas/pure_glossary.js gas/tests/pure_glossary.test.js
git commit -m "feat: 用語集を1か所に持つ"
```

---

### Task 2: スプリントの選択肢

**Files:**
- Create: `gas/pure_sprint_options.js`
- Modify: `gas/pure_grid_board.js`（`module.exports` に `realSprints` を足すだけ）
- Test: `gas/tests/pure_sprint_options.test.js`

**Interfaces:**
- Consumes: `realSprints(velocityRows)`（`pure_grid_board.js`。**現在 `module.exports` に無いので足す**）
- Produces: `sprintOptions(velocityRows, currentValue)` →
  `[{ value: string, label: string, unknown: boolean }]`

**なぜ要るか:** 現在 PBI のスプリントは自由入力で、打ち間違いが幽霊スプリントを作り、
`velocity.csv` に無い名前を書くと**その PBI はロードマップから消える**（エラーは出ない）。
真実の源泉は `velocity.csv` にある。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_sprint_options.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { sprintOptions } = require('../pure_sprint_options.js');

const VEL = [
  { sprint: 'sprint002', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  { sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
  { sprint: '（未設定）', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' },
];

test('先頭は必ず未割り当て（空文字）', () => {
  const o = sprintOptions(VEL, '');
  assert.equal(o[0].value, '');
  assert.ok(o[0].label.length > 0);
  assert.equal(o[0].unknown, false);
});

test('velocity.csv の行順に従う（名前で並べ替えない）', () => {
  // realSprints は絞り込むだけで並べ替えない。行順はスプリントの時系列そのもの。
  const o = sprintOptions(VEL, '');
  assert.deepEqual(o.slice(1).map((x) => x.value), ['sprint002', 'sprint001']);
});

test('日付が埋まっていない雛形行は選択肢に出ない', () => {
  const o = sprintOptions(VEL, '');
  assert.equal(o.some((x) => x.value === '（未設定）'), false);
});

test('velocity.csv に無い今の値は末尾に足され、unknown が立つ', () => {
  const o = sprintOptions(VEL, 'sprint 003');
  const last = o[o.length - 1];
  assert.equal(last.value, 'sprint 003');
  assert.equal(last.unknown, true);
  assert.ok(last.label.indexOf('sprint 003') !== -1);
});

test('velocity.csv にある今の値は重複して足されない', () => {
  const o = sprintOptions(VEL, 'sprint001');
  assert.equal(o.filter((x) => x.value === 'sprint001').length, 1);
  assert.equal(o.some((x) => x.unknown), false);
});

test('今の値が空なら余計な選択肢は増えない', () => {
  assert.equal(sprintOptions(VEL, '').length, 3);
  assert.equal(sprintOptions(VEL, null).length, 3);
  assert.equal(sprintOptions(VEL, undefined).length, 3);
});

test('今の値の前後の空白は無視して比較する', () => {
  const o = sprintOptions(VEL, '  sprint001  ');
  assert.equal(o.some((x) => x.unknown), false);
});

test('velocity.csv が空でも未割り当てだけは出る', () => {
  assert.deepEqual(sprintOptions([], '').map((x) => x.value), ['']);
  assert.deepEqual(sprintOptions(null, '').map((x) => x.value), ['']);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_sprint_options.test.js"`
Expected: FAIL（`Cannot find module '../pure_sprint_options.js'`）

- [ ] **Step 3: `realSprints` を公開する**

`gas/pure_grid_board.js` の `module.exports` を次に変える。**他は触らない。**

```javascript
  module.exports = { KANBAN_STATUSES, ROADMAP_MARK, realSprints, buildKanbanGrid, buildRoadmapGrid };
```

- [ ] **Step 4: 実装する**

`gas/pure_sprint_options.js`:

```javascript
/**
 * スプリントの選択肢。GAS API に依存しない純関数。
 *
 * 自由入力だと打ち間違いが幽霊スプリントを作り、velocity.csv に無い名前を書くと
 * その PBI はロードマップから消える（しかもエラーは出ない）。真実の源泉は
 * velocity.csv なので、そこから選ばせる。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof realSprints === 'undefined') {
  var { realSprints } = require('./pure_grid_board.js');
}

const SPRINT_UNASSIGNED_LABEL = '（未割り当て）';

/**
 * 選択肢を返す。並び順は velocity.csv の行順に従う（realSprints は絞り込むだけで
 * 並べ替えない。行順はスプリントの時系列そのものなので、そのほうが読みやすい）。
 *
 * 今の値が velocity.csv に無い場合は末尾に足す。既存値を黙って失わせないため。
 */
function sprintOptions(velocityRows, currentValue) {
  const options = [{ value: '', label: SPRINT_UNASSIGNED_LABEL, unknown: false }];
  const seen = {};
  realSprints(velocityRows || []).forEach(function (v) {
    const name = String(v.sprint || '').trim();
    if (!name || Object.prototype.hasOwnProperty.call(seen, name)) return;
    seen[name] = true;
    options.push({ value: name, label: name, unknown: false });
  });

  const current = String(currentValue === null || currentValue === undefined ? '' : currentValue).trim();
  if (current && !Object.prototype.hasOwnProperty.call(seen, current)) {
    options.push({ value: current, label: current + '（velocity.csv に無い）', unknown: true });
  }
  return options;
}

if (typeof module !== 'undefined') { module.exports = { SPRINT_UNASSIGNED_LABEL, sprintOptions }; }
```

- [ ] **Step 5: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（296 + 8 = 304 件）

- [ ] **Step 6: コミット**

```bash
git add gas/pure_sprint_options.js gas/pure_grid_board.js gas/tests/pure_sprint_options.test.js
git commit -m "feat: スプリントの選択肢を velocity.csv から組み立てる"
```

**実装時の変更**（計画は書き換えず、判明した順に記録する）:

1. 出荷した `sprintOptions` は第2引数を取らない（`sprintOptions(velocityRows)`）。
   「今の値が選択肢に無ければ足す」規則は、サーバ側の
   `sprintChoices(velocityRows, backlogRows)`（PBI 側に付いている名前を `unknown`
   付きで足す）と、画面側の「（選択肢に無い値）」の2つに分かれた。**画面が今そこに
   持っている値**は、サーバが CSV を読んだ時点の値とは別物（読み込みの後に別の
   書き手が付けたスプリントには、サーバ側の規則は届かない）で、注記の意味も違うため。
   Task 8 Step 5 の `sprintOptions(velocityRows, card ? card.sprint : '')` と、
   本 Task の Interfaces / テスト片の第2引数はいずれも出荷物には存在しない。
2. 盤面の応答に載せるのは `velocityRows` ではなく、組み立て済みの `sprintChoices`
   （Task 6 の実装時の変更を参照）。
3. `velocity.csv` に在るかどうかの判定は生の文字列ではなく `normalizeSprint`
   （ロードマップと同じ鍵）で行う。`product_backlog.csv` は "Sprint 001"、
   `velocity.csv` は "sprint001" と表記が揺れるため、生で比べると
   **ロードマップには帯が出ている PBI に「velocity.csv に無い」と書く**
   （PR #3 のレビュー指摘。選択肢の `value` は `<select>` の照合に要るので生のまま）。
4. 重複を控える入れ物は `{}` ではなく `Object.create(null)`。スプリント名が
   `__proto__` のとき、`{}` では own property にならず同じ選択肢が並ぶ（同上）。

---

---

### Task 3: やることのビュー（一覧・完了）と要約

**Files:**
- Create: `gas/pure_view_backlog.js`, `gas/pure_summary.js`
- Test: `gas/tests/pure_view_backlog.test.js`, `gas/tests/pure_summary.test.js`

**Interfaces:**
- Consumes: `filterRealRows(rows)`（`pure_filter.js`）
- Produces:
  - `LIST_COLUMNS` = `[{ field, label }]`
  - `buildListView(rows, fields)` → `{ columns: [{field,label}], rows: [{...}] }`
  - `buildDoneView(rows, fields)` → 同じ形
  - `summarizeBacklog(rows, statuses)` →
    `{ byStatus: [{ status, count, points }], total: { count, points } }`

**注意:** `buildDashboardGrid` は使わない。あれはスプレッドシートの2次元配列を作るもので、
**シートの同期が使い続ける**。同じ関数に2つの出力形式を持たせると、どちらかを変えたときに
もう一方が壊れる。集計の考え方だけ揃える。

- [ ] **Step 1: 失敗するテストを書く（一覧・完了）**

`gas/tests/pure_view_backlog.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { LIST_COLUMNS, buildListView, buildDoneView } = require('../pure_view_backlog.js');
const real = (over) => Object.assign({
  id: 'PBI-001', title: 'やること', description: 'せつめい',
  acceptance_criteria: 'きじゅん', priority: 'High', size: '5',
  status: 'New', sprint: 'sprint001', created_at: '2026-09-01', updated_at: '2026-09-01',
}, over || {});

test('列は field と label の対で、id が先頭', () => {
  assert.equal(LIST_COLUMNS[0].field, 'id');
  LIST_COLUMNS.forEach((c) => {
    assert.ok(c.field, '列に field が無い');
    assert.ok(c.label, c.field + ' に label が無い');
  });
});

test('列の label に「サイズ」を使わない（ストーリーポイント）', () => {
  // ベロシティとは別物なので「ベロシティ」も使わない。
  const labels = LIST_COLUMNS.map((c) => c.label).join(' ');
  assert.equal(labels.indexOf('サイズ'), -1);
  assert.equal(labels.indexOf('ベロシティ'), -1);
  assert.ok(labels.indexOf('ポイント') !== -1);
});

test('雛形行は除かれる', () => {
  const rows = [real(), { id: 'PBI-002', title: '（PBIタイトル）', created_at: 'YYYY-MM-DD' }];
  assert.equal(buildListView(rows).rows.length, 1);
});

test('行は列の field をすべて持ち、値は文字列になる', () => {
  const v = buildListView([real({ size: 5 })]);
  LIST_COLUMNS.forEach((c) => {
    assert.equal(typeof v.rows[0][c.field], 'string', c.field + ' が文字列でない');
  });
  assert.equal(v.rows[0].size, '5');
});

test('元の配列を書き換えない', () => {
  const rows = [real()];
  buildListView(rows);
  assert.equal(rows[0].title, 'やること');
  assert.equal(Object.keys(rows[0]).length, 10);   // 元の行の項目数が変わっていない
});

test('完了のビューも同じ形を返す', () => {
  const v = buildDoneView([real({ status: 'Done' })]);
  assert.deepEqual(v.columns.map((c) => c.field), LIST_COLUMNS.map((c) => c.field));
  assert.equal(v.rows.length, 1);
});

test('空でも columns は返る', () => {
  assert.deepEqual(buildListView([]).rows, []);
  assert.ok(buildListView(null).columns.length > 0);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_view_backlog.test.js"`
Expected: FAIL（`Cannot find module '../pure_view_backlog.js'`）

- [ ] **Step 3: 実装する（一覧・完了）**

`gas/pure_view_backlog.js`:

```javascript
/**
 * 一覧・完了のビューのデータ。GAS API に依存しない純関数。
 *
 * pure_grid_backlog.js とは別に持つ。あちらはスプレッドシートの2次元配列を作るもので、
 * シートの同期が使い続ける。同じ関数に2つの出力形式を持たせると、どちらかを変えたときに
 * もう一方が壊れる。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

// 「サイズ」では何を指すか伝わらない。「ベロシティ」はスプリント単位の消化量で別物。
const LIST_COLUMNS = [
  { field: 'id', label: 'ID' },
  { field: 'title', label: 'タイトル' },
  { field: 'status', label: 'ステータス' },
  { field: 'priority', label: '優先度' },
  { field: 'size', label: 'ポイント' },
  { field: 'sprint', label: 'スプリント' },
  { field: 'acceptance_criteria', label: '受入基準' },
  { field: 'updated_at', label: '更新日' },
];

function viewRows_(rows) {
  return filterRealRows(rows || []).map(function (row) {
    const out = {};
    LIST_COLUMNS.forEach(function (c) {
      const v = row[c.field];
      out[c.field] = (v === undefined || v === null) ? '' : String(v);
    });
    return out;
  });
}

/** 一覧のビュー。 */
function buildListView(rows) {
  return { columns: LIST_COLUMNS, rows: viewRows_(rows) };
}

/** 完了のビュー。列は一覧と同じにする（同じ対象の見え方なので揃える）。 */
function buildDoneView(rows) {
  return { columns: LIST_COLUMNS, rows: viewRows_(rows) };
}

if (typeof module !== 'undefined') {
  module.exports = { LIST_COLUMNS, buildListView, buildDoneView };
}
```

**注意:** `LIST_COLUMNS` は `BACKLOG_FIELDS`（`const`）を参照しない。**列を自前で持つ。**
一覧に出す列と CSV の列は同じでなくてよく（`description` と `created_at` は一覧に出さない）、
`const` を `var` で受けると GAS の単一グローバルスコープで衝突する。

- [ ] **Step 4: 失敗するテストを書く（要約）**

`gas/tests/pure_summary.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { summarizeBacklog } = require('../pure_summary.js');

const ST = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const real = (over) => Object.assign({
  id: 'PBI-001', title: 'a', priority: 'High', size: '5',
  status: 'New', created_at: '2026-09-01', updated_at: '2026-09-01',
}, over || {});

test('ステータス別の件数とポイントを数える', () => {
  const s = summarizeBacklog([
    real({ id: 'PBI-001', status: 'New', size: '5' }),
    real({ id: 'PBI-002', status: 'New', size: '3' }),
    real({ id: 'PBI-003', status: 'Done', size: '8' }),
  ], ST);
  const byStatus = {};
  s.byStatus.forEach((x) => { byStatus[x.status] = x; });
  assert.equal(byStatus['New'].count, 2);
  assert.equal(byStatus['New'].points, 8);
  assert.equal(byStatus['Done'].count, 1);
  assert.equal(byStatus['Ready'].count, 0);
  assert.equal(s.total.count, 3);
  assert.equal(s.total.points, 16);
});

test('語彙外のステータスは先頭のステータスに数える', () => {
  // buildBoardData が語彙外を New 列に入れるのと揃える。
  const s = summarizeBacklog([real({ status: 'Backlog', size: '2' })], ST);
  const first = s.byStatus[0];
  assert.equal(first.status, 'New');
  assert.equal(first.count, 1);
  assert.equal(first.points, 2);
});

test('ポイントが空や数値でない行は 0 として数える', () => {
  const s = summarizeBacklog([
    real({ id: 'PBI-001', size: '' }),
    real({ id: 'PBI-002', size: 'M' }),
  ], ST);
  assert.equal(s.total.count, 2);
  assert.equal(s.total.points, 0);
});

test('雛形行は数えない', () => {
  const s = summarizeBacklog([
    real(),
    { id: 'PBI-999', title: '（PBIタイトル）', created_at: 'YYYY-MM-DD' },
  ], ST);
  assert.equal(s.total.count, 1);
});

test('空でも全ステータスが 0 で並ぶ', () => {
  const s = summarizeBacklog([], ST);
  assert.equal(s.byStatus.length, ST.length);
  assert.equal(s.total.count, 0);
  assert.equal(s.total.points, 0);
});
```

- [ ] **Step 5: 実装する（要約）**

`gas/pure_summary.js`:

```javascript
/**
 * 各タブの要約。GAS API に依存しない純関数。
 *
 * buildDashboardGrid は使わない。あれが集計するのはスプリントゴールと PBI の
 * ステータス別件数・ポイントと警告だけで、スプリントの計画/完了/持ち越しも
 * 障害物の件数も集計していない。あちらはシートの同期が使い続ける。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

/** やることの要約。ステータスの語彙は引数で受け取る（KANBAN_STATUSES は const のため）。 */
function summarizeBacklog(rows, statuses) {
  const order = statuses || [];
  const counts = {};
  const points = {};
  order.forEach(function (s) { counts[s] = 0; points[s] = 0; });

  const real = filterRealRows(rows || []);
  real.forEach(function (r) {
    const raw = String(r.status || '').trim();
    const s = order.indexOf(raw) === -1 ? order[0] : raw;
    if (s === undefined) return;
    counts[s] += 1;
    const n = parseFloat(r.size);
    points[s] += isNaN(n) ? 0 : n;
  });

  const byStatus = order.map(function (s) {
    return { status: s, count: counts[s], points: points[s] };
  });
  const total = byStatus.reduce(function (a, x) {
    return { count: a.count + x.count, points: a.points + x.points };
  }, { count: 0, points: 0 });
  return { byStatus: byStatus, total: total };
}

if (typeof module !== 'undefined') { module.exports = { summarizeBacklog }; }
```

- [ ] **Step 6: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（304 + 7 + 5 = 316 件）

- [ ] **Step 7: コミット**

```bash
git add gas/pure_view_backlog.js gas/pure_summary.js gas/tests/pure_view_backlog.test.js gas/tests/pure_summary.test.js
git commit -m "feat: 一覧・完了のビューと、やることの要約を足す"
```

---

### Task 4: スプリントのビューと要約

**Files:**
- Create: `gas/pure_view_sprint.js`
- Modify: `gas/pure_summary.js`（`summarizeSprint` を足す）
- Test: `gas/tests/pure_view_sprint.test.js`, `gas/tests/pure_summary.test.js`（追記）

**Interfaces:**
- Consumes: `buildBurndownGrid(sprintBacklogMd)` / `buildVelocityGrid(velocityRows)` /
  `buildRoadmapGrid(rows, velocityRows)`（既存。**そのまま使う。触らない**）,
  `extractSection(md, title)`（`pure_markdown.js`）, `realSprints(velocityRows)`
- Produces:
  - `buildBurndownView(sprintBacklogMd)` → `{ table: {headers, rows} } | null`
  - `buildVelocityView(velocityRows)` → `{ table: {headers, rows} }`
  - `buildRoadmapView(rows, velocityRows)` → `{ table: {headers, rows}, marks: [[r,c]] }`
  - `summarizeSprint(velocityRows, sprintBacklogMd)` →
    `{ goal: string, sprint: string, planned: number, completed: number, carriedOver: number } | null`

**注意:** 既存の `build*Grid` は2次元配列（先頭行がヘッダー）を返す。ビューでは
`{ headers, rows }` に分けて渡す。**null を返す経路をそのまま保つこと**
（`buildBurndownGrid` は元データが無ければ `null`）。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_view_sprint.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildBurndownView, buildVelocityView, buildRoadmapView,
} = require('../pure_view_sprint.js');

const VEL = [
  { sprint: 'sprint001', planned_points: '20', completed_points: '18',
    carried_over_points: '2', sprint_start: '2026-08-18', sprint_end: '2026-08-31', notes: '' },
];
const MD = [
  '# スプリントバックログ',
  '',
  '## バーンダウン',
  '',
  '| 日付 | 残り |',
  '| --- | --- |',
  '| 2026-08-18 | 20 |',
  '| 2026-08-19 | 15 |',
  '',
].join('\n');

test('バーンダウンは見出しと行に分かれる', () => {
  const v = buildBurndownView(MD);
  assert.deepEqual(v.table.headers, ['日付', '残り']);
  assert.equal(v.table.rows.length, 2);
});

test('バーンダウンは元データが無ければ null', () => {
  // 「まだありません」と出すため。エラーにしない。
  assert.equal(buildBurndownView(''), null);
  assert.equal(buildBurndownView(null), null);
  assert.equal(buildBurndownView('# 見出しだけ'), null);
});

test('ベロシティは見出しと行に分かれる', () => {
  const v = buildVelocityView(VEL);
  assert.ok(v.table.headers.length > 0);
  assert.equal(v.table.rows.length, 1);
});

test('ベロシティは空でも表の形を返す', () => {
  const v = buildVelocityView([]);
  assert.ok(v.table.headers.length > 0);
  assert.deepEqual(v.table.rows, []);
});

test('ロードマップは帯を塗る位置を返す', () => {
  const rows = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: 'sprint001',
                  created_at: '2026-08-18', updated_at: '2026-08-18' }];
  const v = buildRoadmapView(rows, VEL);
  assert.ok(v.table.headers.length > 0);
  assert.ok(Array.isArray(v.marks));
});

test('ロードマップは velocity.csv にスプリントが無ければ行が出ない', () => {
  const rows = [{ id: 'PBI-001', title: 'a', status: 'New', sprint: 'sprint001',
                  created_at: '2026-08-18', updated_at: '2026-08-18' }];
  const v = buildRoadmapView(rows, []);
  assert.equal(v.table.rows.length, 0);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_view_sprint.test.js"`
Expected: FAIL（`Cannot find module '../pure_view_sprint.js'`）

- [ ] **Step 3: 実装する**

`gas/pure_view_sprint.js`:

```javascript
/**
 * スプリントのビューのデータ。GAS API に依存しない純関数。
 *
 * 既存の build*Grid（pure_grid_report.js / pure_grid_board.js）は2次元配列を返す。
 * シートの同期が使い続けるので触らず、ここで表の形に組み替えるだけにする。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof buildBurndownGrid === 'undefined') {
  var { buildBurndownGrid, buildVelocityGrid } = require('./pure_grid_report.js');
}
if (typeof require !== 'undefined' && typeof buildRoadmapGrid === 'undefined') {
  var { buildRoadmapGrid } = require('./pure_grid_board.js');
}

/** 2次元配列（先頭行がヘッダー）を { headers, rows } に分ける。 */
function splitGrid_(grid) {
  const g = grid || [];
  if (g.length === 0) return { headers: [], rows: [] };
  return { headers: g[0], rows: g.slice(1) };
}

/** バーンダウン。元データが無ければ null（「まだありません」と出すため）。 */
function buildBurndownView(sprintBacklogMd) {
  const grid = buildBurndownGrid(sprintBacklogMd || '');
  if (!grid) return null;
  return { table: splitGrid_(grid) };
}

/** ベロシティ。空でも表の形は返す。 */
function buildVelocityView(velocityRows) {
  return { table: splitGrid_(buildVelocityGrid(velocityRows || [])) };
}

/** ロードマップ。marks は帯を塗るセルの位置。 */
function buildRoadmapView(rows, velocityRows) {
  const out = buildRoadmapGrid(rows || [], velocityRows || []);
  return { table: splitGrid_(out.grid), marks: out.marks || [] };
}

if (typeof module !== 'undefined') {
  module.exports = { buildBurndownView, buildVelocityView, buildRoadmapView };
}
```

**`buildRoadmapGrid` は `{ grid, marks }` を返す**（`pure_grid_board.js` で確認済み）。
`buildBurndownGrid` と `buildVelocityGrid` は2次元配列を返す。上のコードはその前提で書いてある。

- [ ] **Step 4: スプリントの要約を足す**

`gas/pure_summary.js` に追加。`gas/tests/pure_summary.test.js` に追記。

```javascript
/**
 * スプリントの要約。velocity.csv の最新行（realSprints の最後）と、
 * sprint_backlog.md のゴールから作る。
 * buildDashboardGrid はこれらを集計していないので、ここで作る。
 */
function summarizeSprint(velocityRows, sprintBacklogMd) {
  const real = realSprints(velocityRows || []);
  if (real.length === 0) return null;
  const v = real[real.length - 1];
  const num = function (x) { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
  return {
    sprint: String(v.sprint || '').trim(),
    goal: extractSection(sprintBacklogMd || '', 'スプリントゴール') || '',
    planned: num(v.planned_points),
    completed: num(v.completed_points),
    carriedOver: num(v.carried_over_points),
  };
}
```

`pure_summary.js` の先頭に、`realSprints` と `extractSection` の解決を足すこと
（`pure_filter.js` と同じ形）。`module.exports` に `summarizeSprint` を足す。

テスト（`pure_summary.test.js` に追記）:

```javascript
const { summarizeSprint } = require('../pure_summary.js');

test('スプリントの要約は velocity.csv の最新行から作る', () => {
  const vel = [
    { sprint: 'sprint001', planned_points: '20', completed_points: '18',
      carried_over_points: '2', sprint_start: '2026-08-18', sprint_end: '2026-08-31' },
    { sprint: 'sprint002', planned_points: '25', completed_points: '0',
      carried_over_points: '0', sprint_start: '2026-09-01', sprint_end: '2026-09-14' },
  ];
  const s = summarizeSprint(vel, '## スプリントゴール\n\n動くものを出す\n');
  assert.equal(s.sprint, 'sprint002');
  assert.equal(s.planned, 25);
  assert.ok(s.goal.indexOf('動くものを出す') !== -1);
});

test('スプリントの要約は日付が埋まった行が無ければ null', () => {
  assert.equal(summarizeSprint([{ sprint: 'sprint001', sprint_start: 'YYYY-MM-DD' }], ''), null);
  assert.equal(summarizeSprint([], ''), null);
});

test('ポイントが空でも 0 になる', () => {
  const s = summarizeSprint(
    [{ sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }], '');
  assert.equal(s.planned, 0);
  assert.equal(s.completed, 0);
  assert.equal(s.carriedOver, 0);
});
```

- [ ] **Step 5: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（316 + 6 + 3 = 325 件）

- [ ] **Step 6: コミット**

```bash
git add gas/pure_view_sprint.js gas/pure_summary.js gas/tests/pure_view_sprint.test.js gas/tests/pure_summary.test.js
git commit -m "feat: スプリントのビューと要約を足す"
```

**実装時の変更**（計画は書き換えず、判明した順に記録する）:

1. Step 1 のテスト「ロードマップは velocity.csv にスプリントが無ければ行が出ない」
   （`v.table.rows.length === 0`）は成立しない。`buildRoadmapGrid`（計画どおり
   **触らない**）は、velocity にスプリントが無くても実 PBI ごとに行を残す
   （スプリントの列が無くなるだけ）ので、実測は `rows.length === 1`。
   出荷したテストは「帯を塗る位置が無い」ことを見る形に変えてある
   （`ロードマップは velocity.csv にスプリントが無ければ帯を塗らない`）。
2. `summarizeSprint` は、`sprint_backlog.md` が「スプリント情報」の表で名乗る
   スプリント番号が velocity.csv の最新行と食い違うときはゴールを空にする
   （PR #3 のレビュー指摘）。数字は velocity.csv、ゴールは**最新のスプリント
   フォルダ**の md と出所が違い、ずれると別々のスプリントの数字と目的が1行に混ざる。

---

---

### Task 5: 障害物のビューと要約

**Files:**
- Create: `gas/pure_view_impediment.js`
- Modify: `gas/pure_summary.js`（`summarizeImpediment` を足す）
- Test: `gas/tests/pure_view_impediment.test.js`, `gas/tests/pure_summary.test.js`（追記）

**Interfaces:**
- Consumes: `IMPEDIMENT_FIELDS` / `isImpedimentPlaceholder(row)`（`pure_grid_report.js`。
  **どちらも現在 `module.exports` に無い。足すこと**）
- Produces:
  - `IMPEDIMENT_COLUMNS` = `[{ field, label }]`
  - `buildImpedimentView(openRows, resolvedRows)` →
    `{ columns, open: [{...}], resolved: [{...}] }`
  - `summarizeImpediment(openRows, resolvedRows)` → `{ open: number, resolved: number }`

**注意:** 未解決と解決済は `status` 列ではなく**ファイルで分かれている**
（`impediment_log.csv` / `impediment_log_resolved.csv`）。第4段階で「解決」を作るときは
2ファイルにまたがる書き戻しになるが、本段階は読むだけ。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_view_impediment.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { IMPEDIMENT_COLUMNS, buildImpedimentView } = require('../pure_view_impediment.js');

const imp = (over) => Object.assign({
  id: 'IMP-001', title: '止まっている', description: 'せつめい',
  reported_by: 'マヤ', reported_at: '2026-09-01', status: 'Open',
  resolved_at: '', resolution: '', sprint: 'sprint001',
}, over || {});

test('列は field と label の対で、id が先頭', () => {
  assert.equal(IMPEDIMENT_COLUMNS[0].field, 'id');
  IMPEDIMENT_COLUMNS.forEach((c) => {
    assert.ok(c.field && c.label, c.field + ' の対が不完全');
  });
});

test('未解決と解決済がファイル別に分かれる', () => {
  const v = buildImpedimentView(
    [imp({ id: 'IMP-001' })],
    [imp({ id: 'IMP-002', status: 'Resolved', resolved_at: '2026-09-05' })]);
  assert.deepEqual(v.open.map((r) => r.id), ['IMP-001']);
  assert.deepEqual(v.resolved.map((r) => r.id), ['IMP-002']);
});

test('雛形行は両方から除かれる', () => {
  const v = buildImpedimentView(
    [imp(), { id: 'メモ', title: '' }],
    [{ id: '', title: '' }]);
  assert.equal(v.open.length, 1);
  assert.equal(v.resolved.length, 0);
});

test('値は文字列になり、欠けた項目は空文字', () => {
  const v = buildImpedimentView([{ id: 'IMP-001', title: 'a', reported_at: '2026-09-01' }], []);
  IMPEDIMENT_COLUMNS.forEach((c) => {
    assert.equal(typeof v.open[0][c.field], 'string', c.field + ' が文字列でない');
  });
});

test('どちらも無ければ空で返る', () => {
  const v = buildImpedimentView(null, null);
  assert.deepEqual(v.open, []);
  assert.deepEqual(v.resolved, []);
  assert.ok(v.columns.length > 0);
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `node --test "gas/tests/pure_view_impediment.test.js"`
Expected: FAIL（`Cannot find module '../pure_view_impediment.js'`）

- [ ] **Step 3: 既存の定数と関数を公開する**

`gas/pure_grid_report.js` の `module.exports` に `IMPEDIMENT_FIELDS` と
`isImpedimentPlaceholder` を足す。**他は触らない。**

```javascript
  module.exports = {
    VELOCITY_HEADERS, IMPEDIMENT_HEADERS, IMPEDIMENT_FIELDS,
    IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL, isImpedimentPlaceholder,
    buildVelocityGrid, buildBurndownGrid, buildImpedimentGrid, buildDashboardGrid,
    buildSyncLogGrid, parsePublished,
  };
```

- [ ] **Step 4: 実装する**

`gas/pure_view_impediment.js`:

```javascript
/**
 * 障害物のビューのデータ。GAS API に依存しない純関数。
 *
 * 未解決と解決済は status 列ではなくファイルで分かれている
 * （impediment_log.csv / impediment_log_resolved.csv）。
 */

// GAS 上では同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof isImpedimentPlaceholder === 'undefined') {
  var { isImpedimentPlaceholder } = require('./pure_grid_report.js');
}

const IMPEDIMENT_COLUMNS = [
  { field: 'id', label: 'ID' },
  { field: 'title', label: 'タイトル' },
  { field: 'description', label: '説明' },
  { field: 'reported_by', label: '報告者' },
  { field: 'reported_at', label: '報告日' },
  { field: 'sprint', label: 'スプリント' },
  { field: 'resolved_at', label: '解決日' },
  { field: 'resolution', label: '解決策' },
];

function impedimentRows_(rows) {
  return (rows || []).filter(function (r) {
    return !isImpedimentPlaceholder(r);
  }).map(function (row) {
    const out = {};
    IMPEDIMENT_COLUMNS.forEach(function (c) {
      const v = row[c.field];
      out[c.field] = (v === undefined || v === null) ? '' : String(v);
    });
    return out;
  });
}

/** 障害物の一覧。未解決と解決済を分けて返す。 */
function buildImpedimentView(openRows, resolvedRows) {
  return {
    columns: IMPEDIMENT_COLUMNS,
    open: impedimentRows_(openRows),
    resolved: impedimentRows_(resolvedRows),
  };
}

if (typeof module !== 'undefined') {
  module.exports = { IMPEDIMENT_COLUMNS, buildImpedimentView };
}
```

- [ ] **Step 5: 障害物の要約を足す**

`gas/pure_summary.js` に追加し、`module.exports` に足す。

```javascript
/** 障害物の要約。件数はファイル別に数える（status 列では分かれていない）。 */
function summarizeImpediment(openRows, resolvedRows) {
  const count = function (rows) {
    return (rows || []).filter(function (r) { return !isImpedimentPlaceholder(r); }).length;
  };
  return { open: count(openRows), resolved: count(resolvedRows) };
}
```

テスト（`pure_summary.test.js` に追記）:

```javascript
const { summarizeImpediment } = require('../pure_summary.js');

test('障害物の要約はファイル別に数え、雛形行を除く', () => {
  const s = summarizeImpediment(
    [{ id: 'IMP-001', title: 'a' }, { id: 'メモ', title: '' }],
    [{ id: 'IMP-002', title: 'b' }]);
  assert.equal(s.open, 1);
  assert.equal(s.resolved, 1);
});

test('障害物の要約は空でも 0 で返る', () => {
  assert.deepEqual(summarizeImpediment(null, null), { open: 0, resolved: 0 });
});
```

- [ ] **Step 6: 通ることを確認する**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（325 + 5 + 2 = 332 件）

- [ ] **Step 7: コミット**

```bash
git add gas/pure_view_impediment.js gas/pure_summary.js gas/pure_grid_report.js gas/tests/pure_view_impediment.test.js gas/tests/pure_summary.test.js
git commit -m "feat: 障害物のビューと要約を足す"
```

---

### Task 6: `apiGetView` に集約する

**Files:**
- Modify: `gas/web_app.js`, `gas/kanban.html`（`load()` の呼び出しのみ）
- Test: `gas/tests/web_app_flow.test.js`（追記）

**Interfaces:**
- Consumes: Task 1〜5 の純関数すべて、既存の `readBacklogText_` / `readDoneBacklogRowsBestEffort_` /
  `getScrumFolder_` / `readTextFile_` / `findLatestSprintFolder_` / `csvToObjects` /
  `assertHeaderMatches` / `BACKLOG_FIELDS` / `KANBAN_STATUSES` / `buildBoardData`
- Produces: `apiGetView(name)` →
  `{ ok: true, name, view, summary } | { ok: false, name, message }`

**設計の拠りどころ:** タブごとに API を増やすと公開関数が7つ増える。`google.script.run` は
**全グローバル関数をブラウザへ公開する**ため、公開面は小さいほどよい。

**読み取りの失敗はビューごとに独立させる。** どれも他のタブを巻き添えにしない。

- [ ] **Step 1: 読み取りのヘルパーを足す**

`gas/web_app.js` の `apiGetBoard` の直前に追加。**すべて `_` を付けること**
（`google.script.run` から呼ばれてはいけない）。

```javascript
const VELOCITY_CSV_NAME = 'velocity.csv';
const IMPEDIMENT_CSV_NAME = 'impediment_log.csv';
const IMPEDIMENT_RESOLVED_CSV_NAME = 'impediment_log_resolved.csv';

/** scrum 直下の CSV を読む。無い・壊れているときは空配列（ビューごとに独立して失敗させる）。 */
function readCsvRowsBestEffort_(name) {
  try {
    const text = readTextFile_(getScrumFolder_(), name);
    if (text === null) return [];
    return csvToObjects(text);
  } catch (e) {
    return [];
  }
}

/** 最新のスプリントフォルダの sprint_backlog.md を読む。無ければ空文字。 */
function readSprintBacklogMdBestEffort_() {
  try {
    const folder = findLatestSprintFolder_(getScrumFolder_());
    if (!folder) return '';
    return readTextFile_(folder, 'sprint_backlog.md') || '';
  } catch (e) {
    return '';
  }
}
```

**`findLatestSprintFolder_(scrumFolder)` は `scrum` フォルダを引数に取る**
（`gas/gas_drive.js` で確認済み）。`extractSection` は `pure_markdown.js` にある。

- [ ] **Step 2: `apiGetView` を実装する**

既存の `apiGetBoard` を**削除し**、次に置き換える。

```javascript
/**
 * ビューの内容を返す。読み取りのみ。
 *
 * タブごとに API を増やすと公開関数が増える。google.script.run は全グローバル関数を
 * ブラウザへ公開するため、公開面は小さいほどよい。
 *
 * 読み取りの失敗はビューごとに独立させる。どれも他のタブを巻き添えにしない。
 */
function apiGetView(name) {
  const key = String(name || 'board');
  try {
    if (key === 'board' || key === 'list') {
      const text = readBacklogText_();
      assertHeaderMatches(text, BACKLOG_FIELDS);
      const rows = csvToObjects(text);
      const summary = summarizeBacklog(rows, KANBAN_STATUSES);
      const view = key === 'board' ? buildBoardData(rows) : buildListView(rows);
      return { ok: true, name: key, view: view, summary: summary };
    }
    if (key === 'done') {
      const rows = readDoneBacklogRowsBestEffort_();
      return { ok: true, name: key, view: buildDoneView(rows), summary: null };
    }
    if (key === 'burndown') {
      const md = readSprintBacklogMdBestEffort_();
      const vel = readCsvRowsBestEffort_(VELOCITY_CSV_NAME);
      return {
        ok: true, name: key,
        view: buildBurndownView(md),   // 元データが無ければ null
        summary: summarizeSprint(vel, md),
      };
    }
    if (key === 'velocity' || key === 'roadmap') {
      const vel = readCsvRowsBestEffort_(VELOCITY_CSV_NAME);
      const md = readSprintBacklogMdBestEffort_();
      const view = key === 'velocity'
        ? buildVelocityView(vel)
        : buildRoadmapView(csvToObjects(readBacklogText_()), vel);
      return { ok: true, name: key, view: view, summary: summarizeSprint(vel, md) };
    }
    if (key === 'impediment') {
      const open = readCsvRowsBestEffort_(IMPEDIMENT_CSV_NAME);
      const done = readCsvRowsBestEffort_(IMPEDIMENT_RESOLVED_CSV_NAME);
      return {
        ok: true, name: key,
        view: buildImpedimentView(open, done),
        summary: summarizeImpediment(open, done),
      };
    }
    return { ok: false, name: key, message: '不明なビューです: ' + key };
  } catch (e) {
    return { ok: false, name: key, message: e.message };
  }
}
```

- [ ] **Step 3: クライアントの呼び出しを直す**

`gas/kanban.html` の `load()` にある `.apiGetBoard()` を `.apiGetView('board')` に変える。

**`load()` の周辺には `writeSeq` による会計のコメントが2箇所ある。** 読み取り中に書き込みが
確定したら古い board を描かない、という第2段階の修正である。**この仕組みを壊さないこと。**
応答の受け取りは `res.board` から `res.view` に変わるので、そこだけ直す。

- [ ] **Step 4: 検査を足す**

`gas/tests/web_app_flow.test.js` に追記。既存のシムの形に合わせること。

```javascript
test('apiGetView は不明な名前を拒否する', () => {
  const res = callApi('apiGetView', ['しらないビュー']);
  assert.equal(res.ok, false);
  assert.ok(res.message.indexOf('不明なビュー') !== -1);
});

test('apiGetView は読み取りに失敗したビューが他を巻き添えにしない', () => {
  // velocity.csv が無くても board は読める。
  const board = callApi('apiGetView', ['board']);
  assert.equal(board.ok, true);
  const velocity = callApi('apiGetView', ['velocity']);
  assert.equal(velocity.ok, true);
  assert.deepEqual(velocity.view.table.rows, []);
});

test('apiGetView はバーンダウンの元データが無ければ view を null で返す', () => {
  const res = callApi('apiGetView', ['burndown']);
  assert.equal(res.ok, true);
  assert.equal(res.view, null);
});

test('apiGetView(board) は要約を一緒に返す', () => {
  // タブを開いた時点で1往復で済ませるため。
  const res = callApi('apiGetView', ['board']);
  assert.equal(res.ok, true);
  assert.ok(res.summary);
  assert.ok(Array.isArray(res.summary.byStatus));
});
```

- [ ] **Step 5: 公開範囲を確認する**

Run:
```bash
grep -h '^function ' gas/gas_*.js gas/web_app.js | grep -v '_('
```
Expected: `_` が付かないのは **13個**。`apiGetBoard` が消え、`apiGetView` が入っていること。

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（332 + 4 = 336 件）

- [ ] **Step 6: コミット**

```bash
git add gas/web_app.js gas/kanban.html gas/tests/web_app_flow.test.js
git commit -m "feat: 読み取りの API を apiGetView に集約する"
```

**実装時の変更**（計画は書き換えず、判明した順に記録する）:

1. `apiGetView` の盤面（`board`）の応答には `sprintChoices` を足した。本 Task の
   契約・コード片（`{ ok, name, view, summary }`）にはスプリントのプルダウンの
   データ源が無く、そのままでは Task 8 Step 5 の選択肢が作れない。計画は
   `velocityRows` をそのまま載せる形だったが、組み立て（重複排除・並び順・
   `unknown` の判定）を画面側へ写すとサーバ側だけを直したときに黙ってずれるため、
   **完成した選択肢**を載せる形にした（Task 2 の実装時の変更を参照）。

---

---

### Task 7: タブとビューの切り替え

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `apiGetView(name)`, 既存の `render(b)` / `board` / `writeSeq` / `setMessage`
- Produces: `TABS`（タブとビューの定義）、`switchTab(tabId)` / `switchView(viewId)`、
  `currentView()` → `string`

**設計の拠りどころ:** タブは**対象の名前**にする。動作はボタンにする。
ダッシュボードはタブにしない（「全部の要約」は対象ではないので、対象と同じ階層に置くと
非 MECE になる）。同期ログもタブにしない（運用の記録であり、利用者の関心事ではない）。

- [ ] **Step 1: タブの定義を置く**

`<script>` の `STATUS_OPTIONS` の付近に追加。

```javascript
// タブは対象の名前。ビューはその対象の見え方。
var TABS = [
  { id: 'pbi', label: 'やること', views: [
    { id: 'board', label: '盤面' },
    { id: 'list', label: '一覧' },
    { id: 'done', label: '完了' },
  ] },
  { id: 'sprint', label: 'スプリント', views: [
    { id: 'burndown', label: 'バーンダウン' },
    { id: 'velocity', label: 'ベロシティ' },
    { id: 'roadmap', label: 'ロードマップ' },
  ] },
  { id: 'impediment', label: '障害物', views: [
    { id: 'impediment', label: '一覧' },
  ] },
];

var activeTab = 'pbi';
var activeView = 'board';
```

- [ ] **Step 2: CSS を足す**

`<style>` の末尾に追加。**`[hidden]` の規則は既にあるので触らない。**

```css
  .tabs { display: flex; gap: var(--sp-1); border-bottom: 1px solid var(--line); }
  .tabs button {
    border: none; border-bottom: 2px solid transparent; border-radius: 0;
    background: transparent; color: var(--ink-2); padding: var(--sp-2) var(--sp-3);
  }
  .tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); }
  .views { display: flex; gap: var(--sp-1); margin: var(--sp-3) 0; }
  .views button { font-size: 12px; padding: var(--sp-1) var(--sp-3); }
  .views button[aria-selected="true"] { background: var(--card-2); border-color: var(--accent); }
  #summary {
    font-size: 12px; color: var(--ink-2); padding: var(--sp-3) 0;
    display: flex; gap: var(--sp-4); flex-wrap: wrap;
  }
  .table-wrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 12px; }
  th, td {
    border-bottom: 1px solid var(--line); padding: var(--sp-2) var(--sp-3);
    text-align: left; vertical-align: top;
  }
  th { color: var(--ink-2); font-weight: normal; white-space: nowrap; }
  td { overflow-wrap: anywhere; }
  .table-empty { color: var(--ink-2); font-size: 12px; padding: var(--sp-4) 0; }
```

- [ ] **Step 3: 骨組みを足す**

`<div id="main">` の**直前**に置く。

```html
<div class="tabs" id="tabs" role="tablist"></div>
<div class="views" id="views" role="tablist"></div>
<div id="summary"></div>
```

`<div id="main">` の中、`<div id="board"></div>` の直後に置く。

```html
  <div id="table-view" class="table-wrap" hidden></div>
```

- [ ] **Step 4: 切り替えを実装する**

`<script>` の `load()` の直前に追加。

```javascript
function renderTabs() {
  var tabs = document.getElementById('tabs');
  tabs.innerHTML = '';
  TABS.forEach(function (t) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', t.id === activeTab ? 'true' : 'false');
    b.addEventListener('click', function () { switchTab(t.id); });
    tabs.appendChild(b);
  });

  var views = document.getElementById('views');
  views.innerHTML = '';
  var tab = TABS.filter(function (t) { return t.id === activeTab; })[0];
  // ビューが1つだけのタブでは切り替えを出さない（押せる先が無いものを見せない）。
  if (!tab || tab.views.length <= 1) return;
  tab.views.forEach(function (v) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = v.label;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', v.id === activeView ? 'true' : 'false');
    b.addEventListener('click', function () { switchView(v.id); });
    views.appendChild(b);
  });
}

function switchTab(tabId) {
  var tab = TABS.filter(function (t) { return t.id === tabId; })[0];
  if (!tab) return;
  activeTab = tabId;
  activeView = tab.views[0].id;
  closePanel();
  loadView();
}

function switchView(viewId) {
  activeView = viewId;
  closePanel();
  loadView();
}

function currentView() { return activeView; }
```

- [ ] **Step 5: `load()` を `loadView()` に広げる**

既存の `load()` の中身を `loadView()` に移し、`activeView` を渡す形にする。

**`writeSeq` の仕組みを保つこと。** 読み取り中に書き込みが確定したら古い内容を描かない、
という第2段階の修正である。**盤面だけでなく、表のビューでも同じ扱いにする**
（読み取り中に別の人が書き込めば、表も古くなる）。

盤面のときは今までどおり `render(res.view)`、表のときは `renderTable(res.view)` を呼ぶ。
要約は `renderSummary(res.summary)`。

**`#board` と `#table-view` の `hidden` を切り替えること。** 盤面のときは `#board` を出し
`#table-view` を隠す。表のときは逆。

- [ ] **Step 6: 表の描画を実装する**

```javascript
/** 表を描く。ユーザー由来の文字列は textContent で入れる。 */
function renderTable(view) {
  var host = document.getElementById('table-view');
  host.innerHTML = '';
  if (!view) {
    var none = document.createElement('div');
    none.className = 'table-empty';
    none.textContent = 'まだありません。';
    host.appendChild(none);
    return;
  }
  // 障害物は未解決と解決済の2つの表になる。
  if (view.open !== undefined && view.resolved !== undefined) {
    host.appendChild(tableSection('未解決', view.columns, view.open));
    host.appendChild(tableSection('解決済', view.columns, view.resolved));
    return;
  }
  if (view.table) {
    host.appendChild(gridTable(view.table.headers, view.table.rows));
    return;
  }
  host.appendChild(objectTable(view.columns, view.rows));
}
```

`tableSection(title, columns, rows)` / `gridTable(headers, rows)` /
`objectTable(columns, rows)` を、いずれも `createElement` と `textContent` で組み立てること。
**`innerHTML` はクリア（空文字の代入）以外に使わない。**

行が0件のときは「ありません。」と出す（表のヘッダーだけを出さない）。

- [ ] **Step 7: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（336 件）

Run: `grep -c 'innerHTML' gas/kanban.html`
Expected: **3**（`render` のクリア、`fillSelect` のクリア、`renderTable` のクリア）
— `renderTabs` も `innerHTML = ''` を使うので、**実際の数を数えて Global Constraints と
食い違えば、この計画の数のほうを疑うこと**。すべて空文字の代入であることを確認する。

Run: `grep -c 'overlay' gas/kanban.html` と `grep -c 'confirm' gas/kanban.html`
Expected: **0**

```bash
git add gas/kanban.html
git commit -m "feat: 対象で分けるタブとビューの切り替えを足す"
```

**実装時の変更**（計画は書き換えず、判明した順に記録する）:

1. `switchTab` / `switchView` には `renderTabs()` の再呼び出しが要った。計画の
   コード片には無いが、無いと押したタブの選択表示（`aria-selected`）が変わらない。
2. `renderTable` は `gridTable(headers, rows)` だけでなく、第3引数 `marks`
   （ロードマップの帯）も渡して描く。計画の定義にはこの引数が無かった。
3. `innerHTML` の個数の見積もり「3」は誤りで、Task 7 完了時点（本 Step 7 に加え、
   直後の表示確定・`viewSeq` 周りの修正まで含む）で実測 8 だった。ただし
   **本質は個数ではなく「すべて空文字の代入であること」**であり、この趣旨に変更は
   ない（後に `clearHost()` へ集約し、現在は 5）。
4. 表示の切替は応答ではなくクリック時点で確定させる（`showView()`）。計画は
   応答ハンドラの中で `hidden` を切り替える形だったが、それだと読み取りが
   失敗したときに選んだタブと違う（操作可能な）盤面が残り、ドラッグして
   書き込みが誤ったビューへ飛ぶ不具合をレビューが実測した。
5. 応答の取り違えは名前比較ではなく通し番号（`viewSeq`）で見る。計画には
   判定そのものが無かった。名前比較では同じビューへの2回の読み直しが逆順に
   届くと古いほうが勝つ。この判定は `writeSeq` の判定より**先**に置く
   （既に描き終えた別ビューの上に、遠いビューのエラー文言が被さるのを防ぐため）。
6. `#table-view` の「読み込んでいます…」表示は `tableLoading` という状態で
   管理する。「捨てるべき応答か」で畳むと、`showView()` を経由しない
   「最新にする」が失敗したときに描画済みの表を消してしまう。

---

### Task 8: 用語の差し替えと補足

**Files:**
- Modify: `gas/kanban.html`

**Interfaces:**
- Consumes: `GLOSSARY` / `glossaryOf(term)`（Task 1）、`sprintOptions(velocityRows, current)`（Task 2）
- Produces: `makeHelp(term)` → `HTMLElement`（補足のボタンと本文）

**設計の拠りどころ:** 補足は**押しても、カーソルを当てても、キーボードでも開く**。
第2段階でタッチ端末に対応したので、カーソルだけに頼る形は採らない。
**モーダルにしない** — 開いている間も盤面は操作できる。

- [ ] **Step 1: 用語を差し替える**

`gas/kanban.html` の次を直す。

- カードの `.meta`: `'サイズ ' + card.size` → `card.size + ' pt'`
- パネルの `<label for="f-size">`: `サイズ` → `ポイント`
- `f-size` の下に `.hint` を足す: 「相対見積り。ベロシティは完了したポイントの合計」

**`f-size` の `input` はそのまま**（CSV の列名 `size` は変えない）。

- [ ] **Step 2: 補足の CSS を足す**

```css
  .help { position: relative; display: inline-flex; }
  .help > button {
    border: none; background: transparent; color: var(--ink-2);
    padding: 0 var(--sp-1); font-size: 11px; line-height: 1;
  }
  .help > button:hover, .help > button:focus-visible { color: var(--accent); }
  .help-body {
    position: absolute; top: 100%; left: 0; z-index: 20;
    width: max-content; max-width: min(280px, 80vw);
    background: var(--card); color: var(--ink);
    border: 1px solid var(--line); border-radius: 8px;
    box-shadow: var(--shadow-2); padding: var(--sp-3);
    font-size: 12px; line-height: 1.7; font-weight: normal; text-align: left;
  }
```

**`z-index: 20`** は、通知（`#toast` の `z-index: 10`）より上に出すため。

- [ ] **Step 3: 補足を実装する**

```javascript
/**
 * 用語の補足。押しても、カーソルを当てても、キーボードでも開く。
 * 第2段階でタッチ端末に対応したので、カーソルだけに頼る形は採らない。
 * モーダルにしない（開いている間も盤面は操作できる）。
 */
function makeHelp(term) {
  var text = glossaryOf(term);
  var wrap = document.createElement('span');
  wrap.className = 'help';
  if (!text) return wrap;   // 用語集に無ければ何も出さない

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '?';
  btn.setAttribute('aria-label', term + 'とは');
  btn.setAttribute('aria-expanded', 'false');

  var body = document.createElement('div');
  body.className = 'help-body';
  body.textContent = text;
  body.hidden = true;

  var open = function () { body.hidden = false; btn.setAttribute('aria-expanded', 'true'); };
  var close = function () { body.hidden = true; btn.setAttribute('aria-expanded', 'false'); };

  btn.addEventListener('click', function () { body.hidden ? open() : close(); });
  btn.addEventListener('mouseenter', open);
  wrap.addEventListener('mouseleave', close);
  btn.addEventListener('focus', open);
  btn.addEventListener('blur', close);

  wrap.appendChild(btn);
  wrap.appendChild(body);
  return wrap;
}
```

Escape で閉じる分岐を、既存の `keydown` ハンドラに足すこと。**通知 → パネルの順に見ている
既存の並びを崩さず、補足を最初に閉じる**（一番手前にあるものから閉じる）。

- [ ] **Step 4: 補足を置く**

- 列の見出し（`renderColumn` の `h2`）: ステータス名の補足
- カードの優先度（`renderCard` の `.prio`）: 優先度の補足
- 表のヘッダー（`objectTable` / `gridTable`）: 列の label が用語集にあれば補足
- パネルの `受入基準` の label: 補足

**パネルの入力欄は `.hint` で常に見せる**（余白があるので押させない）。

- [ ] **Step 5: スプリントをプルダウンにする**

`gas/kanban.html` の `f-sprint` を `<input>` から `<select>` に変える。

`openPanel` で `sprintOptions(velocityRows, card ? card.sprint : '')` を使って選択肢を作る。
`velocityRows` は `apiGetView` の応答に含めて渡す（**盤面のビューの応答に足すこと**。
パネルを開くたびに往復させない）。

**`unknown` が立った選択肢は、視覚的にも区別すること**（`(velocity.csv に無い)` の
label がそのまま出るので、追加の CSS は不要）。

- [ ] **Step 6: 確認してコミット**

Run: `node --test "gas/tests/*.test.js"`
Expected: PASS（336 件）

Run: `grep -c 'サイズ' gas/kanban.html`
Expected: **0**

```bash
git add gas/kanban.html
git commit -m "feat: 用語を整理し、専門用語に補足を付ける"
```

---

### Task 9: DOM シムでの検査

**Files:**
- Create: `gas/tests/kanban_view.test.js`
- Modify: `gas/tests/kanban_harness.js`（必要なら手段を足す）

**Interfaces:**
- Consumes: `gas/kanban.html` の `<script>`、既存の `createHarness`
- Produces: なし

**なぜ要るか:** この画面では**応答の到達順により画面とサーバが永続的に食い違う不具合を
5回踏んでいる**。5回ともコードを読むだけでは見えず、実行して初めて分かった。

- [ ] **Step 1: シムの契約を確かめてから検査を書く**

**まず `gas/tests/kanban_harness.js` を読み、`createHarness` が返すものを確認すること。**
第2段階では `sandbox` / `screen()` / `drag(id,toStatus)` / `click(elementId)` / `clickAdd(status)` /
`openCard(id)` / `setValue` / `valueOf` / `hiddenOf` / `disabledOf` / `textOf` / `calls` /
`boardOf(cols)` / `columnsOf(cols)` / `flushTimers()` / `pressKey(key)` を備えていた。
**足りない手段（要素の一覧を取る、`mouseenter` を起こす等）は足してよい。**

`gas/tests/kanban_view.test.js`:

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

/** 初期読み込み（apiGetView('board')）まで済ませたハーネスを返す。 */
function ready() {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  const first = h.calls[0];
  assert.equal(first.method, 'apiGetView', '初期読み込みが apiGetView になっていない');
  assert.equal(first.args[0], 'board');
  first.handlers.success({
    ok: true, name: 'board', view: h.boardOf(INITIAL),
    summary: { byStatus: [], total: { count: 2, points: 0 } },
  });
  h.calls.length = 0;
  return h;
}

test('タブを切り替えても、送信中のドラッグの結果が失われない', () => {
  // ドラッグを送信中のまま一覧へ切り替え、盤面へ戻したあとにドラッグの応答が届く経路。
  const h = ready();
  h.drag('PBI-001', 'Ready');
  const move = h.calls[h.calls.length - 1];
  assert.equal(move.method, 'apiUpdateStatus');

  h.clickTab('pbi'); h.clickView('list');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'list', view: { columns: [{ field: 'id', label: 'ID' }], rows: [] }, summary: null,
  });
  h.clickView('board');
  const back = h.calls[h.calls.length - 1];
  back.handlers.success({
    ok: true, name: 'board',
    view: h.boardOf([
      { status: 'New', cards: [{ id: 'PBI-002', title: 'B', updated_at: 'T1' }] },
      { status: 'Ready', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T2' }] },
      { status: 'In Progress', cards: [] }, { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
    ]),
    summary: null,
  });

  // 最後にドラッグの応答が届く。古い board を丸ごと信じると PBI-001 が New へ戻る。
  move.handlers.success({ ok: true, board: h.boardOf(INITIAL) });
  const cols = h.screen();
  assert.ok(cols[1].cards.indexOf('PBI-001') !== -1, 'PBI-001 が New へ巻き戻された');
});

test('ビューの読み取りに失敗しても、他のタブが開ける', () => {
  const h = ready();
  h.clickTab('sprint');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: false, name: 'burndown', message: '読めません' });
  assert.ok(h.textOf('message').length > 0, '失敗が知らされていない');

  h.clickTab('pbi');
  const again = h.calls[h.calls.length - 1];
  assert.equal(again.args[0], 'board', '他のタブが開けなくなっている');
  again.handlers.success({ ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  assert.equal(h.hiddenOf('board'), false);
});

test('バーンダウンの元データが無いとき「まだありません」と出る', () => {
  const h = ready();
  h.clickTab('sprint');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: true, name: 'burndown', view: null, summary: null });
  assert.ok(h.textOf('table-view').indexOf('まだありません') !== -1);
  assert.equal(h.hiddenOf('table-view'), false);
  assert.equal(h.hiddenOf('board'), true);
});

test('補足は押しても、カーソルを当てても、キーボードでも開く', () => {
  const h = ready();
  const help = h.helpIn('board');   // 列見出しかカードの補足ボタン
  assert.ok(help, '補足が描かれていない');

  h.fire(help.button, 'click');
  assert.equal(help.body.hidden, false, '押しても開かない');
  h.fire(help.button, 'click');
  assert.equal(help.body.hidden, true, '押しても閉じない');

  h.fire(help.button, 'mouseenter');
  assert.equal(help.body.hidden, false, 'カーソルで開かない');
  h.fire(help.wrap, 'mouseleave');
  assert.equal(help.body.hidden, true);

  h.fire(help.button, 'focus');
  assert.equal(help.body.hidden, false, 'キーボードで開かない');
  assert.equal(help.button.getAttribute('aria-expanded'), 'true');
});

test('補足を開いている間も盤面のカードはドラッグできる', () => {
  // モーダルにしない、という方針の検査。
  const h = ready();
  h.fire(h.helpIn('board').button, 'click');
  const before = h.calls.length;
  h.drag('PBI-001', 'Ready');
  assert.equal(h.calls.length, before + 1, '補足を開くとドラッグできなくなっている');
});

test('Escape は補足を先に閉じ、パネルは閉じない', () => {
  const h = ready();
  h.openCard('PBI-001');
  const help = h.helpIn('panel');
  h.fire(help.button, 'click');
  assert.equal(help.body.hidden, false);

  h.pressKey('Escape');
  assert.equal(help.body.hidden, true, '補足が閉じない');
  assert.equal(h.hiddenOf('panel'), false, 'パネルまで閉じた');

  h.pressKey('Escape');
  assert.equal(h.hiddenOf('panel'), true, '2回目でパネルが閉じない');
});

test('スプリントの選択肢に velocity.csv に無い今の値が出る', () => {
  const h = createHarness(INITIAL);
  h.sandbox.load();
  h.calls[0].handlers.success({
    ok: true, name: 'board',
    view: h.boardOf([
      { status: 'New', cards: [{ id: 'PBI-001', title: 'A', updated_at: 'T1', sprint: 'sprint 003' }] },
      { status: 'Ready', cards: [] }, { status: 'In Progress', cards: [] },
      { status: 'Review', cards: [] }, { status: 'Done', cards: [] },
    ]),
    summary: null,
    velocityRows: [{ sprint: 'sprint001', sprint_start: '2026-08-18', sprint_end: '2026-08-31' }],
  });
  h.openCard('PBI-001');
  const values = h.optionsOf('f-sprint').map((o) => o.value);
  assert.ok(values.indexOf('sprint 003') !== -1, '既存値が選択肢から消えている');
  assert.equal(h.valueOf('f-sprint'), 'sprint 003');
});

test('表のビューでは盤面が隠れ、盤面のビューでは表が隠れる', () => {
  const h = ready();
  assert.equal(h.hiddenOf('board'), false);
  assert.equal(h.hiddenOf('table-view'), true);

  h.clickView('list');
  h.calls[h.calls.length - 1].handlers.success({
    ok: true, name: 'list',
    view: { columns: [{ field: 'id', label: 'ID' }], rows: [{ id: 'PBI-001' }] }, summary: null,
  });
  assert.equal(h.hiddenOf('board'), true);
  assert.equal(h.hiddenOf('table-view'), false);

  h.clickView('board');
  h.calls[h.calls.length - 1].handlers.success(
    { ok: true, name: 'board', view: h.boardOf(INITIAL), summary: null });
  assert.equal(h.hiddenOf('board'), false);
  assert.equal(h.hiddenOf('table-view'), true);
});
```

**シムに足す手段**（無ければ作ること）:

| 名前 | 意味 |
|---|---|
| `clickTab(tabId)` / `clickView(viewId)` | タブ・ビューのボタンを押す |
| `helpIn(hostId)` | その領域の最初の補足を `{ wrap, button, body }` で返す |
| `fire(el, type)` | 任意のイベントを起こす（`mouseenter` / `mouseleave` / `focus` / `blur`） |
| `optionsOf(selectId)` | `select` の選択肢を `[{ value, label }]` で返す |

**シムは `mouseenter` / `focus` を実際にハンドラへ届けること。** 届かないと、この検査は
「通るだけで何も守っていない」ものになる。

- [ ] **Step 2: 検出力を確かめる**

**書いた検査を1つずつ壊して、本当に落ちるかを確認すること。** 最低限:

- `switchTab` の `closePanel()` を消す → パネルが開いたままタブが変わる検査が落ちる
- `makeHelp` の `mouseenter` を消す → カーソルの経路の検査が落ちる
- `makeHelp` の `click` を消す → 押す経路の検査が落ちる
- `#board` / `#table-view` の `hidden` の切り替えを消す → 表示の検査が落ちる

**この案件では「通るだけで何も守っていないテスト」が2回見つかっている**（title ガード、
`created_at`）。**失敗を検出できない検査は無いのと同じ。** 確認したら必ず元に戻し、
`git status --short` が空であることを確かめる。

- [ ] **Step 3: 静的検査を足す**

**DOM シムは CSS を評価しない。** `[hidden]` の件と同じ性質の欠陥に備え、
`gas/tests/kanban_ui_structure.test.js` に足す。

```javascript
test('補足は通知より手前に出る', () => {
  // #toast の z-index より .help-body の z-index が大きいこと。
  // 逆だと、通知が出ている間に補足が読めない。
});
```

- [ ] **Step 4: コミット**

```bash
git add gas/tests/kanban_view.test.js gas/tests/kanban_harness.js gas/tests/kanban_ui_structure.test.js
git commit -m "test: タブとビューの切り替え、補足を検査する"
```

---

### Task 10: ドキュメントを実態に合わせる

**Files:**
- Modify: `README.md`, `docs/setup.md`, `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-04-web-app-design.md`

- [ ] **Step 1: できることを書き直す**

`README.md` に次を反映する。

- **アプリで見られるものが3つのタブに分かれた**（やること / スプリント / 障害物）
- **ベロシティ・バーンダウン・ロードマップ・障害物がアプリで見られる**
- **スプリントは選ぶもの**になった（`velocity.csv` が源泉）
- **「サイズ」は「ストーリーポイント」**。ベロシティとは別物
- **専門用語には補足が付く**（`?` を押すか、カーソルを当てるか、キーボードで開く）
- **メモ列はアプリに出ない**（バックログと障害物のシートにしかなく、Web アプリからは読めない）
- 障害物の作成・編集・解決は**まだできない**（次の段階）

- [ ] **Step 2: 第1段階の設計書に追記する**

`docs/superpowers/specs/2026-09-04-web-app-design.md` の「人はアプリだけを見る」という記述に、
**第3段階で他のビューを足して成立したこと**を追記する。**当時の記述は残す**
（遡って書き換えると、最初からそう設計していたように見える）。

- [ ] **Step 3: 配布の必要性を確認する**

Run:
```bash
git diff --name-only main..HEAD | grep -E '^(\.claude/|scrum/|CLAUDE\.md|README\.md)' || echo '(配布不要)'
```

変わっていれば、マージ後に `node scripts/publish.js <配布先>` が必要。

- [ ] **Step 4: コミット**

```bash
git add README.md docs/setup.md CLAUDE.md docs/superpowers/specs/2026-09-04-web-app-design.md
git commit -m "docs: 第3段階でできるようになったことを反映する"
```

---

## 実装後に人が確かめること

自動テストが届かない。**実装の完了条件ではなく、リリース前の確認項目**である。

- 3つのタブとビューの切り替え
- **補足が押しても、カーソルを当てても、キーボードでも開くこと**
- **タッチ端末で補足が開くこと**（`mouseenter` が無い環境）
- **補足を開いている間も盤面が操作できること**
- 通知が出ている間に補足を開いて、**補足が手前に出ること**
- スプリントのプルダウンに `velocity.csv` のスプリントが並ぶこと
- `velocity.csv` に無い値を持つ PBI で、その値が選択肢に残ること
- **`velocity.csv` が雛形のままの状態で、各ビューが「まだありません」を出すこと**
- 幅の狭い画面（900px 未満）でタブと表が破綻しないこと
- ダークモードでの表示
- ブラウザのコンソールで `google.script.run.readCsvRowsBestEffort_('x')` が**呼べない**こと
