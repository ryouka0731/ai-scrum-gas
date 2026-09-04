# AI Scrum GAS版 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `scrum/` の CSV / Markdown を Google Drive 経由で読み取り、共有スプレッドシート上にスクラム運営ダッシュボードを構築する GAS プロジェクトを作る。

**Architecture:** ロジックを GAS API 非依存の純関数（`pure_*.js`）に寄せ、`node --test` で検証する。GAS 依存層（`gas_*.js`）は DriveApp の読み取りと SpreadsheetApp の書き込みだけを担う薄い層に保つ。同期は GAS 側からのプル型で、メンバーのローカルには認証設定を置かない。

**Tech Stack:** Google Apps Script (V8), clasp 3.x, Node.js 22 の `node --test`（追加依存なし）

**Spec:** `docs/superpowers/specs/2026-09-02-ai-scrum-gas-design.md`

## Global Constraints

- 全ての成果物・コメント・UI 文言は **日本語** で記述する
- CSV の列構造を変更しない。文字コードは UTF-8
- 外部 npm 依存を追加しない。テストは Node 標準の `node:test` と `node:assert/strict` のみ使う
- 純関数ファイルは末尾に `if (typeof module !== 'undefined') { module.exports = { ... } }` を付ける。GAS では `module` が未定義のため無害で、Node からは `require` できる
- GAS ファイルは `const` / `let` と関数宣言のみ使う。`import` / `export` は使わない（GAS は ES modules 非対応）
- 例外として、Node と GAS の相互運用ガード（`if (typeof require !== 'undefined' && ...) { var { ... } = require(...) }`）
  でのみ `var` を使う。この位置では巻き上げが必要で `const` / `let` では代替できない
- シートへの書き込みは `setValues` で1シート1回にまとめる
- **テナント固有の値をリポジトリにコミットしない。** スプレッドシート ID / スクリプト ID /
  Drive フォルダ ID / ドメイン名は、`gas/.clasp.json`（gitignore 済み）かスクリプトプロパティに置く。
  このリポジトリは複数の Google Workspace テナントで使い回すため、clone 直後の状態から
  `scripts/setup.js` だけで新しいテナントに再現できることを要件とする
- `README.md` は **普段 Claude を使わない非エンジニア** を読者とする。専門用語を使うときは必ずその場で
  一言添え、コマンドは「どこに何を貼るか」まで書く。開発者向けの内容は `CLAUDE.md` と `docs/` に置き、
  README に混ぜない
- CSV の列順（変更禁止）
  - `product_backlog.csv` / `product_backlog_done.csv`: `id,title,description,acceptance_criteria,priority,size,status,sprint,created_at,updated_at`
  - `impediment_log.csv` / `impediment_log_resolved.csv`: `id,title,description,reported_by,reported_at,status,resolved_at,resolution,sprint`
  - `velocity.csv`: `sprint,planned_points,completed_points,carried_over_points,sprint_start,sprint_end,notes`

---

### Task 1: リポジトリ基盤と CSV パーサ

**Files:**
- Create: `package.json`
- Create: `gas/pure_csv.js`
- Test: `gas/tests/pure_csv.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `parseCsv(text: string): string[][]` — RFC4180 準拠。BOM 除去、CRLF 正規化、引用符内のカンマと改行を保持
  - `csvToObjects(text: string): Object[]` — 1行目をヘッダとして各行をオブジェクト化。列数が足りない行は空文字で埋める

- [ ] **Step 1: package.json を作る**

```json
{
  "name": "ai-scrum-gas",
  "private": true,
  "version": "0.1.0",
  "description": "AI Scrum の成果物を Google スプレッドシートのダッシュボードへ同期する GAS プロジェクト",
  "scripts": {
    "test": "node --test \"gas/tests/*.test.js\""
  }
}
```

- [ ] **Step 2: 失敗するテストを書く**

`gas/tests/pure_csv.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, csvToObjects } = require('../pure_csv.js');

test('単純な行を分解する', () => {
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('引用符内のカンマを保持する', () => {
  assert.deepEqual(parseCsv('a,b\n"x,y",2'), [['a', 'b'], ['x,y', '2']]);
});

test('引用符内の改行を保持する', () => {
  assert.deepEqual(parseCsv('a\n"1\n2"'), [['a'], ['1\n2']]);
});

test('二重引用符のエスケープを解く', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
});

test('BOM を除去する', () => {
  assert.deepEqual(parseCsv('﻿a,b'), [['a', 'b']]);
});

test('CRLF を正規化する', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('末尾の空行を無視する', () => {
  assert.deepEqual(parseCsv('a\n1\n\n'), [['a'], ['1']]);
});

test('ヘッダを使ってオブジェクト化する', () => {
  const objs = csvToObjects('id,title\nPBI-001,ログイン');
  assert.deepEqual(objs, [{ id: 'PBI-001', title: 'ログイン' }]);
});

test('列が足りない行は空文字で埋める', () => {
  const objs = csvToObjects('id,title,note\nPBI-001,ログイン');
  assert.deepEqual(objs, [{ id: 'PBI-001', title: 'ログイン', note: '' }]);
});

test('空文字を渡すと空配列を返す', () => {
  assert.deepEqual(csvToObjects(''), []);
});
```

- [ ] **Step 3: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_csv.js'`

- [ ] **Step 4: 最小の実装を書く**

`gas/pure_csv.js`:

```javascript
/**
 * CSV / オブジェクト変換。GAS API に依存しない純関数。
 */

/** RFC4180 準拠で CSV を2次元配列に分解する。 */
function parseCsv(text) {
  if (!text) return [];
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  row.push(field);
  rows.push(row);

  // 末尾の空行（空セル1個だけの行）を落とす
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop(); else break;
  }
  return rows;
}

/** 1行目をヘッダとして各行をオブジェクトにする。 */
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0];
  return rows.slice(1).map(function (r) {
    const obj = {};
    header.forEach(function (key, idx) { obj[key] = idx < r.length ? r[idx] : ''; });
    return obj;
  });
}

if (typeof module !== 'undefined') { module.exports = { parseCsv, csvToObjects }; }
```

- [ ] **Step 5: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 10 tests

- [ ] **Step 6: コミット**

```bash
git add package.json gas/pure_csv.js gas/tests/pure_csv.test.js
git commit -m "feat: CSV パーサを追加する"
```

---

### Task 2: ひな形行の判定とスプリント名の正規化

**Files:**
- Create: `gas/pure_filter.js`
- Test: `gas/tests/pure_filter.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `isPlaceholderRow(row: Object): boolean` — テンプレートのままの行を真と判定する
  - `normalizeSprint(name: string): string` — スプリント名を照合用に正規化する
  - `filterRealRows(rows: Object[]): Object[]` — ひな形行を除いた配列を返す
  - `pickLatestSprintName(names: string[]): string | null` — `sprint` + 連番のフォルダ名のうち連番が最大のもの。ひな形の `sprintSAMPLE` は対象外

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_filter.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPlaceholderRow, normalizeSprint, filterRealRows, pickLatestSprintName,
} = require('../pure_filter.js');

const real = {
  id: 'PBI-001', title: 'タスクの登録', priority: 'Critical',
  created_at: '2026-08-14', status: 'Ready', sprint: 'Sprint 001',
};

test('実データの行はひな形ではない', () => {
  assert.equal(isPlaceholderRow(real), false);
});

test('id が PBI-数字 でなければひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, id: '' }), true);
  assert.equal(isPlaceholderRow({ ...real, id: 'XXX-1' }), true);
});

test('タイトルが空ならひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, title: '' }), true);
});

test('全角括弧で囲まれたタイトルはひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, title: '（PBIタイトル）' }), true);
});

test('created_at が YYYY-MM-DD のままならひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, created_at: 'YYYY-MM-DD' }), true);
});

test('priority が複合値ならひな形とみなす', () => {
  assert.equal(isPlaceholderRow({ ...real, priority: 'Critical/High/Medium/Low' }), true);
});

test('欠けたキーがあっても例外にならない', () => {
  assert.equal(isPlaceholderRow({}), true);
});

test('スプリント名の表記揺れを同一視する', () => {
  const want = 'sprint001';
  ['Sprint 001', 'sprint001', 'sprint-1', 'SPRINT_1', 'sprint 1'].forEach((n) => {
    assert.equal(normalizeSprint(n), want, n);
  });
});

test('連番を3桁ゼロ埋めに揃える', () => {
  assert.equal(normalizeSprint('sprint 12'), 'sprint012');
  assert.equal(normalizeSprint('sprint0012'), 'sprint012');
});

test('空文字は空文字のまま返す', () => {
  assert.equal(normalizeSprint(''), '');
  assert.equal(normalizeSprint(null), '');
});

test('ひな形行を除外する', () => {
  const rows = [real, { ...real, id: 'PBI-002', title: '（PBIタイトル）' }];
  assert.deepEqual(filterRealRows(rows), [real]);
});

test('スプリントフォルダは連番の最大値で選ぶ', () => {
  assert.equal(pickLatestSprintName(['sprint001', 'sprint002', 'sprint010']), 'sprint010');
});

test('ひな形の sprintSAMPLE は選ばない', () => {
  assert.equal(
    pickLatestSprintName(['sprint001', 'sprint002', 'sprint010', 'sprintSAMPLE']),
    'sprint010');
});

test('桁数が不揃いでも数値として比較する', () => {
  assert.equal(pickLatestSprintName(['sprint9', 'sprint10']), 'sprint10');
  assert.equal(pickLatestSprintName(['sprint10', 'sprint9']), 'sprint10');
});

test('該当するフォルダが無ければ null', () => {
  assert.equal(pickLatestSprintName(['sprintSAMPLE', 'scrum', 'sprint', 'sprint001a']), null);
});

test('空配列や未指定でも null を返す', () => {
  assert.equal(pickLatestSprintName([]), null);
  assert.equal(pickLatestSprintName(null), null);
  assert.equal(pickLatestSprintName(undefined), null);
});

test('戻り値は引数に入っていた文字列そのもの（呼び出し側で対応づけられる）', () => {
  const names = ['sprintSAMPLE', 'sprint007'];
  assert.equal(pickLatestSprintName(names), names[1]);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_filter.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_filter.js`:

```javascript
/**
 * ひな形行の判定とスプリント名の正規化。GAS API に依存しない純関数。
 * 判定条件は現行の scripts/github_project/sync_backlog.py から移植したもの。
 */

const PBI_ID_RE = /^PBI-\d+$/;
// scrum/ 直下のスプリントフォルダ。ひな形の sprintSAMPLE を除くため連番までを必須にする。
const SPRINT_FOLDER_RE = /^sprint(\d+)$/;

/** テンプレートのままの行かどうかを判定する。 */
function isPlaceholderRow(row) {
  const r = row || {};
  const id = String(r.id || '').trim();
  if (!PBI_ID_RE.test(id)) return true;

  const title = String(r.title || '').trim();
  if (!title) return true;
  // 全角括弧で囲まれたひな形テキスト
  if (title.charAt(0) === '（' && title.charAt(title.length - 1) === '）') return true;

  if (String(r.created_at || '').trim() === 'YYYY-MM-DD') return true;
  if (String(r.priority || '').indexOf('/') !== -1) return true;  // "Critical/High/Medium/Low"
  return false;
}

/**
 * スプリント名を照合用に正規化する。
 * product_backlog.csv は "Sprint 001"、velocity.csv は "sprint001" と表記が揺れるため、
 * 区切り文字を落として小文字化し、末尾の連番を3桁ゼロ埋めに揃える。
 */
function normalizeSprint(name) {
  const key = String(name || '').trim().toLowerCase().replace(/[\s_\-]+/g, '');
  if (!key) return '';
  const m = key.match(/^(.*?)(\d+)$/);
  if (!m) return key;
  const num = String(parseInt(m[2], 10));
  const padded = num.length >= 3 ? num : ('00' + num).slice(-3);
  return m[1] + padded;
}

/**
 * フォルダ名の配列から最新のスプリントフォルダ名を返す。該当が無ければ null。
 * - `sprintSAMPLE` のようなひな形フォルダは連番を持たないため対象外にする
 * - 文字列比較では sprint9 が sprint10 より後ろに並ぶため、連番を数値として比較する
 * 戻り値は引数に含まれていた文字列そのものなので、呼び出し側で元の要素と対応づけられる。
 */
function pickLatestSprintName(names) {
  let latest = null;
  let latestNumber = -1;
  (names || []).forEach(function (name) {
    const m = SPRINT_FOLDER_RE.exec(String(name === undefined || name === null ? '' : name));
    if (!m) return;
    const num = parseInt(m[1], 10);
    if (num > latestNumber) { latestNumber = num; latest = name; }
  });
  return latest;
}

/** ひな形行を除いた配列を返す。 */
function filterRealRows(rows) {
  return (rows || []).filter(function (r) { return !isPlaceholderRow(r); });
}

if (typeof module !== 'undefined') {
  module.exports = { isPlaceholderRow, normalizeSprint, filterRealRows, pickLatestSprintName };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — Task 1 の10件と合わせて21件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_filter.js gas/tests/pure_filter.test.js
git commit -m "feat: ひな形行判定とスプリント名正規化を追加する"
```

---

### Task 3: Markdown の表とセクション抽出

**Files:**
- Create: `gas/pure_markdown.js`
- Test: `gas/tests/pure_markdown.test.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `extractMarkdownTable(text: string, heading: string): {headers: string[], rows: string[][]} | null` — 指定見出し直下の表を返す。無ければ `null`
  - `extractSection(text: string, heading: string): string` — 指定見出しから次の見出しまでの本文を返す。表（`|` 始まり）と引用（`>` 始まり）は落とす。無ければ空文字

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_markdown.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { extractMarkdownTable, extractSection } = require('../pure_markdown.js');

const MD = [
  '# スプリントバックログ - Sprint 001',
  '',
  '## スプリントゴール',
  '',
  'ログイン機能を使える状態にする。',
  '',
  '## スプリント情報',
  '| 項目 | 内容 |',
  '|------|------|',
  '| スプリント番号 | Sprint 001 |',
  '| 開始日 | 2026-09-08 |',
  '',
  '## バーンダウン',
  '| 日付 | 残タスク数 | 残ポイント |',
  '|------|------------|------------|',
  '| Day 1 | 8 | 21 |',
  '| Day 2 | 6 | 18 |',
  '',
  '## 次の見出し',
].join('\n');

test('見出し直下の表を抽出する', () => {
  const t = extractMarkdownTable(MD, 'バーンダウン');
  assert.deepEqual(t.headers, ['日付', '残タスク数', '残ポイント']);
  assert.deepEqual(t.rows, [['Day 1', '8', '21'], ['Day 2', '6', '18']]);
});

test('区切り行を行として扱わない', () => {
  const t = extractMarkdownTable(MD, 'スプリント情報');
  assert.deepEqual(t.rows, [['スプリント番号', 'Sprint 001'], ['開始日', '2026-09-08']]);
});

test('表が無い見出しでは null を返す', () => {
  assert.equal(extractMarkdownTable(MD, 'スプリントゴール'), null);
});

test('存在しない見出しでは null を返す', () => {
  assert.equal(extractMarkdownTable(MD, '存在しない'), null);
});

test('見出し直下の本文を抽出する', () => {
  assert.equal(extractSection(MD, 'スプリントゴール'), 'ログイン機能を使える状態にする。');
});

test('存在しない見出しでは空文字を返す', () => {
  assert.equal(extractSection(MD, '存在しない'), '');
});

test('空文字を渡しても壊れない', () => {
  assert.equal(extractMarkdownTable('', 'x'), null);
  assert.equal(extractSection('', 'x'), '');
});

test('セル内のエスケープされたパイプ（\\|）を分割せず復元する', () => {
  const md = [
    '## 表',
    '| a | b |',
    '|---|---|',
    '| x\\|y | z |',
  ].join('\n');
  const t = extractMarkdownTable(md, '表');
  assert.deepEqual(t.rows, [['x|y', 'z']]);
});

test('スプリントゴールの直下にある引用（スクラムガイド）は落とす', () => {
  const md = [
    '# スプリントバックログ - Sprint 001',
    '',
    '## スプリントゴール',
    'タスク登録を最短手数で終わらせる',
    '',
    '> スプリントゴールはスプリントの単一の目的である。',
    '> — スクラムガイド 2020',
    '',
    '## スプリント情報',
    '| 項目 | 内容 |',
  ].join('\n');
  assert.equal(extractSection(md, 'スプリントゴール'), 'タスク登録を最短手数で終わらせる');
});

test('引用が字下げされていても落とす', () => {
  const md = '## ゴール\n本文\n  > 引用\n';
  assert.equal(extractSection(md, 'ゴール'), '本文');
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_markdown.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_markdown.js`:

```javascript
/**
 * Markdown から表とセクション本文を取り出す。GAS API に依存しない純関数。
 * 行番号ではなく見出しテキストを起点にすることで、成果物の編集に追従できるようにする。
 */

/** 見出し行（# の数は問わない）にマッチし、その見出しテキストを返す。 */
function headingTextOf(line) {
  const m = String(line).match(/^#{1,6}\s+(.*?)\s*$/);
  return m ? m[1] : null;
}

/** 表の1行を解析してセル配列にする。セル内の `\|` はエスケープされたパイプとして扱う。 */
function splitTableRow(line) {
  // 半角スペース等は通常のセル内容（例: "Sprint 001"）で普通に使われるため、
  // 退避先には表の内容として現れない制御文字を使う。
  const PLACEHOLDER = '\u0000';
  return String(line)
    .replace(/\\\|/g, PLACEHOLDER)
    .replace(/^\s*\|/, '').replace(/\|\s*$/, '')
    .split('|')
    .map(function (c) { return c.split(PLACEHOLDER).join('|').trim(); });
}

/** 区切り行（|---|---|）かどうか。 */
function isSeparatorRow(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.indexOf('-') !== -1;
}

/** 指定見出しから次の見出しまでの行を返す。同名の見出しが複数ある場合は最初の一致を採用する。 */
function linesUnderHeading(text, heading) {
  const lines = String(text || '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingTextOf(lines[i]) === heading) { start = i + 1; break; }
  }
  if (start === -1) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (headingTextOf(lines[i]) !== null) break;
    out.push(lines[i]);
  }
  return out;
}

/** 指定見出しのセクション内にある表を返す。無ければ null。 */
function extractMarkdownTable(text, heading) {
  const lines = linesUnderHeading(text, heading);
  if (!lines) return null;
  const tableLines = lines.filter(function (l) { return l.trim().indexOf('|') === 0; });
  if (tableLines.length < 2) return null;
  const headers = splitTableRow(tableLines[0]);
  const rows = [];
  for (let i = 1; i < tableLines.length; i++) {
    if (isSeparatorRow(tableLines[i])) continue;
    rows.push(splitTableRow(tableLines[i]));
  }
  return { headers: headers, rows: rows };
}

/**
 * 指定見出し直下の本文を返す。無ければ空文字。
 * 表（`|` 始まり）と引用（`>` 始まり）は落とす。成果物のひな形はスプリントゴールの直下に
 * スクラムガイドの引用を置いており、そのままだとダッシュボードのゴール欄に混入するため。
 */
function extractSection(text, heading) {
  const lines = linesUnderHeading(text, heading);
  if (!lines) return '';
  return lines
    .filter(function (l) {
      const t = l.trim();
      if (t === '') return false;
      if (t.indexOf('|') === 0) return false;
      if (t.indexOf('>') === 0) return false;
      return true;
    })
    .join('\n').trim();
}

if (typeof module !== 'undefined') {
  module.exports = { extractMarkdownTable, extractSection };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計28件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_markdown.js gas/tests/pure_markdown.test.js
git commit -m "feat: Markdown の表とセクション抽出を追加する"
```

---

### Task 4: バックログのグリッド変換とメモ引き継ぎ

**Files:**
- Create: `gas/pure_grid_backlog.js`
- Test: `gas/tests/pure_grid_backlog.test.js`

**Interfaces:**
- Consumes: `filterRealRows` (Task 2)
- Produces:
  - `BACKLOG_HEADERS: string[]` — バックログシートの見出し行（メモ列を含む）
  - `buildBacklogGrid(rows: Object[], notesByKey: Object): string[][]` — 見出し行を含む2次元配列
  - `buildDoneBacklogGrid(rows: Object[]): string[][]` — メモ列なし
  - `BACKLOG_KEY_COL: number` / `BACKLOG_NOTE_COL: number` — 0 起点の列位置

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_grid_backlog.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BACKLOG_HEADERS, BACKLOG_KEY_COL, BACKLOG_NOTE_COL,
  buildBacklogGrid, buildDoneBacklogGrid,
} = require('../pure_grid_backlog.js');

function row(over) {
  return Object.assign({
    id: 'PBI-001', title: 'ログイン', description: '説明',
    acceptance_criteria: 'A; B', priority: 'High', size: '3',
    status: 'Ready', sprint: 'Sprint 001',
    created_at: '2026-08-14', updated_at: '2026-08-20',
  }, over || {});
}

test('見出し行の末尾がメモ列である', () => {
  assert.equal(BACKLOG_HEADERS[BACKLOG_NOTE_COL], 'メモ');
  assert.equal(BACKLOG_HEADERS[BACKLOG_KEY_COL], 'ID');
});

test('1行目が見出し行になる', () => {
  const g = buildBacklogGrid([row()], {});
  assert.deepEqual(g[0], BACKLOG_HEADERS);
});

test('CSV の値が列順どおりに並ぶ', () => {
  const g = buildBacklogGrid([row()], {});
  assert.deepEqual(g[1], [
    'PBI-001', 'ログイン', '説明', 'A; B', 'High', '3',
    'Ready', 'Sprint 001', '2026-08-14', '2026-08-20', '',
  ]);
});

test('ひな形行を除外する', () => {
  const g = buildBacklogGrid([row(), row({ id: 'PBI-002', title: '（PBIタイトル）' })], {});
  assert.equal(g.length, 2);
});

test('メモを ID で引き継ぐ', () => {
  const g = buildBacklogGrid([row()], { 'PBI-001': '要相談' });
  assert.equal(g[1][BACKLOG_NOTE_COL], '要相談');
});

test('並べ替えても ID が一致すればメモが付く', () => {
  const rows = [row({ id: 'PBI-002', title: '二番' }), row()];
  const g = buildBacklogGrid(rows, { 'PBI-001': 'A', 'PBI-002': 'B' });
  assert.equal(g[1][BACKLOG_NOTE_COL], 'B');
  assert.equal(g[2][BACKLOG_NOTE_COL], 'A');
});

test('対応する ID が無いメモは捨てる', () => {
  const g = buildBacklogGrid([row()], { 'PBI-999': '孤児' });
  assert.equal(g.length, 2);
  assert.equal(g[1][BACKLOG_NOTE_COL], '');
});

test('行が無ければ見出し行だけを返す', () => {
  assert.deepEqual(buildBacklogGrid([], {}), [BACKLOG_HEADERS]);
});

test('完了バックログにはメモ列が無い', () => {
  const g = buildDoneBacklogGrid([row({ status: 'Done' })]);
  assert.equal(g[0].indexOf('メモ'), -1);
  assert.equal(g[1].length, g[0].length);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_grid_backlog.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_grid_backlog.js`:

```javascript
/**
 * バックログシートの2次元配列を組み立てる。GAS API に依存しない純関数。
 */

// GAS 上では pure_filter.js が同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
}

const BACKLOG_FIELDS = [
  'id', 'title', 'description', 'acceptance_criteria', 'priority',
  'size', 'status', 'sprint', 'created_at', 'updated_at',
];
const BACKLOG_LABELS = [
  'ID', 'タイトル', '説明', '受入基準', '優先度',
  'サイズ', 'ステータス', 'スプリント', '作成日', '更新日',
];
const BACKLOG_HEADERS = BACKLOG_LABELS.concat(['メモ']);
const BACKLOG_KEY_COL = 0;
const BACKLOG_NOTE_COL = BACKLOG_HEADERS.length - 1;

/** 1行分の値を CSV の列順で取り出す。 */
function backlogValues(row) {
  return BACKLOG_FIELDS.map(function (f) { return String(row[f] === undefined ? '' : row[f]); });
}

/** バックログシート用の2次元配列を返す（メモ列付き）。 */
function buildBacklogGrid(rows, notesByKey) {
  const notes = notesByKey || {};
  const grid = [BACKLOG_HEADERS];
  filterRealRows(rows).forEach(function (row) {
    const id = String(row.id || '').trim();
    grid.push(backlogValues(row).concat([String(notes[id] || '')]));
  });
  return grid;
}

/** 完了バックログシート用の2次元配列を返す（メモ列なし）。 */
function buildDoneBacklogGrid(rows) {
  const grid = [BACKLOG_LABELS];
  filterRealRows(rows).forEach(function (row) { grid.push(backlogValues(row)); });
  return grid;
}

if (typeof module !== 'undefined') {
  module.exports = {
    BACKLOG_FIELDS, BACKLOG_LABELS, BACKLOG_HEADERS,
    BACKLOG_KEY_COL, BACKLOG_NOTE_COL,
    buildBacklogGrid, buildDoneBacklogGrid,
  };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計38件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_grid_backlog.js gas/tests/pure_grid_backlog.test.js
git commit -m "feat: バックログのグリッド変換とメモ引き継ぎを追加する"
```

---

### Task 5: カンバンとロードマップのグリッド変換

**Files:**
- Create: `gas/pure_grid_board.js`
- Test: `gas/tests/pure_grid_board.test.js`

**Interfaces:**
- Consumes: `filterRealRows`, `normalizeSprint` (Task 2)
- Produces:
  - `KANBAN_STATUSES: string[]` — `['New', 'Ready', 'In Progress', 'Review', 'Done']`
  - `buildKanbanGrid(rows: Object[]): string[][]` — ステータスを列に展開した2次元配列
  - `buildRoadmapGrid(rows: Object[], velocityRows: Object[]): {grid: string[][], marks: Array<{row: number, col: number}>}` — `marks` は帯を塗るセル位置（0 起点、`grid` の添字と同じ）

**設計上の判断:** ロードマップは日付軸ではなく**スプリント軸**にする。列は `velocity.csv` のスプリント順で、見出しに期間を併記する。日付軸のガントは列数が期間に比例して増え、GAS の書き込み量とシートの可読性が急に悪化するため、見通しという目的に対して割に合わない。

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_grid_board.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { KANBAN_STATUSES, buildKanbanGrid, buildRoadmapGrid } = require('../pure_grid_board.js');

function pbi(id, title, status, sprint) {
  return {
    id: id, title: title, status: status, sprint: sprint,
    priority: 'High', size: '3', created_at: '2026-08-14',
  };
}

const VELOCITY = [
  { sprint: 'sprint001', sprint_start: '2026-09-08', sprint_end: '2026-09-19' },
  { sprint: 'sprint002', sprint_start: '2026-09-22', sprint_end: '2026-10-03' },
];

test('カンバンの見出しがステータス並びになる', () => {
  const g = buildKanbanGrid([]);
  assert.deepEqual(g[0], KANBAN_STATUSES);
});

test('PBI が該当ステータスの列に入る', () => {
  const g = buildKanbanGrid([pbi('PBI-001', 'ログイン', 'Ready', 'Sprint 001')]);
  assert.equal(g[1][KANBAN_STATUSES.indexOf('Ready')], 'PBI-001 ログイン');
  assert.equal(g[1][KANBAN_STATUSES.indexOf('New')], '');
});

test('列ごとに上から詰めて並ぶ', () => {
  const g = buildKanbanGrid([
    pbi('PBI-001', 'A', 'Ready', ''), pbi('PBI-002', 'B', 'Ready', ''),
    pbi('PBI-003', 'C', 'Done', ''),
  ]);
  const ready = KANBAN_STATUSES.indexOf('Ready');
  assert.equal(g[1][ready], 'PBI-001 A');
  assert.equal(g[2][ready], 'PBI-002 B');
  assert.equal(g[2][KANBAN_STATUSES.indexOf('Done')], '');
});

test('未知のステータスは New 扱いにする', () => {
  const g = buildKanbanGrid([pbi('PBI-001', 'A', '謎', '')]);
  assert.equal(g[1][KANBAN_STATUSES.indexOf('New')], 'PBI-001 A');
});

test('ロードマップの見出しに期間を併記する', () => {
  const { grid } = buildRoadmapGrid([], VELOCITY);
  assert.deepEqual(grid[0], ['ID', 'タイトル', 'sprint001\n2026-09-08〜2026-09-19', 'sprint002\n2026-09-22〜2026-10-03']);
});

test('表記が揺れていても該当スプリント列に帯を置く', () => {
  const { grid, marks } = buildRoadmapGrid([pbi('PBI-001', 'A', 'Ready', 'Sprint 001')], VELOCITY);
  assert.equal(grid[1][2], '■');
  assert.equal(grid[1][3], '');
  assert.deepEqual(marks, [{ row: 1, col: 2 }]);
});

test('スプリント未割当の PBI は帯を持たない', () => {
  const { grid, marks } = buildRoadmapGrid([pbi('PBI-001', 'A', 'New', '')], VELOCITY);
  assert.deepEqual(grid[1], ['PBI-001', 'A', '', '']);
  assert.deepEqual(marks, []);
});

test('ひな形行を除外する', () => {
  const rows = [pbi('PBI-001', 'A', 'Ready', 'Sprint 001'), pbi('PBI-002', '（PBIタイトル）', 'New', '')];
  assert.equal(buildRoadmapGrid(rows, VELOCITY).grid.length, 2);
  assert.equal(buildKanbanGrid(rows).length, 2);
});

test('ひな形のスプリント行を列にしない', () => {
  const v = VELOCITY.concat([{ sprint: 'sprint003', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD' }]);
  assert.equal(buildRoadmapGrid([], v).grid[0].length, 4);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_grid_board.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_grid_board.js`:

```javascript
/**
 * カンバンとロードマップの2次元配列を組み立てる。GAS API に依存しない純関数。
 */

if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows, normalizeSprint } = require('./pure_filter.js');
}

const KANBAN_STATUSES = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
const ROADMAP_MARK = '■';
// GAS は全ファイルを1つのグローバル字句スコープで評価するため、
// トップレベルの const は他ファイルと衝突しない名前にする。
const ROADMAP_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ステータスを既知の値に丸める。未知の値は New に寄せる。 */
function normalizeStatus(status) {
  const s = String(status || '').trim();
  return KANBAN_STATUSES.indexOf(s) === -1 ? 'New' : s;
}

/** カンバンシート用の2次元配列を返す。 */
function buildKanbanGrid(rows) {
  const columns = KANBAN_STATUSES.map(function () { return []; });
  filterRealRows(rows).forEach(function (row) {
    const idx = KANBAN_STATUSES.indexOf(normalizeStatus(row.status));
    columns[idx].push(String(row.id || '').trim() + ' ' + String(row.title || '').trim());
  });
  const depth = columns.reduce(function (max, c) { return Math.max(max, c.length); }, 0);
  const grid = [KANBAN_STATUSES.slice()];
  for (let r = 0; r < depth; r++) {
    grid.push(columns.map(function (c) { return r < c.length ? c[r] : ''; }));
  }
  return grid;
}

/** 期間が実データとして埋まっているスプリント行だけを残す。 */
function realSprints(velocityRows) {
  return (velocityRows || []).filter(function (v) {
    return String(v.sprint || '').trim() !== '' &&
      ROADMAP_DATE_RE.test(String(v.sprint_start || '').trim()) &&
      ROADMAP_DATE_RE.test(String(v.sprint_end || '').trim());
  });
}

/** ロードマップシート用の2次元配列と、帯を塗るセル位置を返す。 */
function buildRoadmapGrid(rows, velocityRows) {
  const sprints = realSprints(velocityRows);
  const header = ['ID', 'タイトル'].concat(sprints.map(function (v) {
    return String(v.sprint).trim() + '\n' + String(v.sprint_start).trim() + '〜' + String(v.sprint_end).trim();
  }));
  const keys = sprints.map(function (v) { return normalizeSprint(v.sprint); });

  const grid = [header];
  const marks = [];
  filterRealRows(rows).forEach(function (row) {
    const target = normalizeSprint(row.sprint);
    const cells = keys.map(function (k) { return (k !== '' && k === target) ? ROADMAP_MARK : ''; });
    grid.push([String(row.id || '').trim(), String(row.title || '').trim()].concat(cells));
    const hit = keys.indexOf(target);
    if (target !== '' && hit !== -1) marks.push({ row: grid.length - 1, col: hit + 2 });
  });
  return { grid: grid, marks: marks };
}

if (typeof module !== 'undefined') {
  module.exports = { KANBAN_STATUSES, ROADMAP_MARK, buildKanbanGrid, buildRoadmapGrid };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計47件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_grid_board.js gas/tests/pure_grid_board.test.js
git commit -m "feat: カンバンとロードマップのグリッド変換を追加する"
```

---

### Task 6: ベロシティ・バーンダウン・障害物・ダッシュボードのグリッド変換

**Files:**
- Create: `gas/pure_grid_report.js`
- Test: `gas/tests/pure_grid_report.test.js`

**Interfaces:**
- Consumes: `filterRealRows` (Task 2)、`extractMarkdownTable`, `extractSection` (Task 3)
- Produces:
  - `buildVelocityGrid(velocityRows: Object[]): string[][]`
  - `buildBurndownGrid(sprintBacklogMd: string): string[][] | null` — 表が無ければ `null`
  - `buildImpedimentGrid(openRows: Object[], resolvedRows: Object[], notesByKey: Object): string[][]`
  - `IMPEDIMENT_KEY_COL: number` / `IMPEDIMENT_NOTE_COL: number`
  - `buildDashboardGrid(ctx: Object): string[][]` — `ctx = {syncedAt, sprintBacklogMd, backlogRows, warnings}`
  - `buildSyncLogGrid(syncedAt: string, readFiles: string[], warnings: string[]): string[][]`

- [ ] **Step 1: 失敗するテストを書く**

`gas/tests/pure_grid_report.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildVelocityGrid, buildBurndownGrid, buildImpedimentGrid,
  IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL, buildDashboardGrid, buildSyncLogGrid,
} = require('../pure_grid_report.js');

const VELOCITY = [
  { sprint: 'sprint001', planned_points: '21', completed_points: '18', carried_over_points: '3', sprint_start: '2026-09-08', sprint_end: '2026-09-19', notes: '' },
  { sprint: 'sprint002', planned_points: '0', completed_points: '0', carried_over_points: '0', sprint_start: 'YYYY-MM-DD', sprint_end: 'YYYY-MM-DD', notes: '（備考）' },
];

const SPRINT_MD = [
  '# スプリントバックログ - Sprint 001',
  '## スプリントゴール',
  'ログインを使える状態にする。',
  '## バーンダウン',
  '| 日付 | 残タスク数 | 残ポイント |',
  '|------|------------|------------|',
  '| Day 1 | 8 | 21 |',
  '| Day 2 | 6 | 18 |',
].join('\n');

test('ベロシティは期間が埋まった行だけを出す', () => {
  const g = buildVelocityGrid(VELOCITY);
  assert.deepEqual(g[0], ['スプリント', '計画', '完了', '持ち越し', '開始日', '終了日', '備考']);
  assert.equal(g.length, 2);
  assert.equal(g[1][0], 'sprint001');
});

test('バーンダウン表を抽出する', () => {
  const g = buildBurndownGrid(SPRINT_MD);
  assert.deepEqual(g[0], ['日付', '残タスク数', '残ポイント']);
  assert.deepEqual(g[1], ['Day 1', '8', '21']);
});

test('バーンダウン表が無ければ null を返す', () => {
  assert.equal(buildBurndownGrid('# 見出しだけ'), null);
  assert.equal(buildBurndownGrid(''), null);
});

test('障害物は未解決を先に並べる', () => {
  const open = [{ id: 'IMP-002', title: '未解決', status: 'Open', reported_by: 'A', reported_at: '2026-09-01', description: '', resolved_at: '', resolution: '', sprint: 'sprint001' }];
  const done = [{ id: 'IMP-001', title: '解決済', status: 'Resolved', reported_by: 'B', reported_at: '2026-08-01', description: '', resolved_at: '2026-08-05', resolution: '対応', sprint: 'sprint001' }];
  const g = buildImpedimentGrid(open, done, {});
  assert.equal(g[1][IMPEDIMENT_KEY_COL], 'IMP-002');
  assert.equal(g[2][IMPEDIMENT_KEY_COL], 'IMP-001');
});

test('障害物のメモを ID で引き継ぐ', () => {
  const open = [{ id: 'IMP-002', title: '未解決', status: 'Open', reported_by: 'A', reported_at: '2026-09-01', description: '', resolved_at: '', resolution: '', sprint: '' }];
  const g = buildImpedimentGrid(open, [], { 'IMP-002': 'SMへ相談' });
  assert.equal(g[1][IMPEDIMENT_NOTE_COL], 'SMへ相談');
});

test('障害物のひな形行を除外する', () => {
  const tpl = [{ id: 'IMP-001', title: '（障害物タイトル）', status: 'Open', reported_at: 'YYYY-MM-DD', reported_by: '', description: '', resolved_at: '', resolution: '', sprint: '' }];
  assert.equal(buildImpedimentGrid(tpl, [], {}).length, 1);
});

test('ダッシュボードにゴールと進捗を出す', () => {
  const rows = [
    { id: 'PBI-001', title: 'A', status: 'Done', size: '5', priority: 'High', created_at: '2026-08-14' },
    { id: 'PBI-002', title: 'B', status: 'Ready', size: '3', priority: 'High', created_at: '2026-08-14' },
  ];
  const g = buildDashboardGrid({ syncedAt: '2026-09-02 10:00', sprintBacklogMd: SPRINT_MD, backlogRows: rows, warnings: [] });
  const flat = g.map(function (r) { return r.join(' '); }).join('\n');
  assert.match(flat, /ログインを使える状態にする。/);
  assert.match(flat, /2026-09-02 10:00/);
  assert.match(flat, /Done 1 5/);
  assert.match(flat, /Ready 1 3/);
});

test('警告があれば列挙する', () => {
  const g = buildDashboardGrid({ syncedAt: 'x', sprintBacklogMd: '', backlogRows: [], warnings: ['velocity.csv が見つかりません'] });
  assert.match(g.map(function (r) { return r.join(' '); }).join('\n'), /velocity.csv が見つかりません/);
});

test('同期ログは見出し行と1行の記録を返す', () => {
  const grid = buildSyncLogGrid('2026-09-02 10:00:00', ['velocity.csv', 'sprint001/sprint_backlog.md'], []);
  assert.deepEqual(grid[0], ['同期時刻', '読み取ったファイル', '警告']);
  assert.equal(grid.length, 2);
  assert.equal(grid[1][0], '2026-09-02 10:00:00');
  assert.equal(grid[1][1], 'velocity.csv\nsprint001/sprint_backlog.md');
  assert.equal(grid[1][2], 'なし');
});

test('同期ログは警告を改行で連結する', () => {
  const grid = buildSyncLogGrid('2026-09-02 10:00:00', [], ['A が見つかりません', 'B の書き込みに失敗']);
  assert.equal(grid[1][1], 'なし');
  assert.equal(grid[1][2], 'A が見つかりません\nB の書き込みに失敗');
});

test('同期ログは引数が未指定でも落ちない', () => {
  const grid = buildSyncLogGrid(undefined, null, null);
  assert.deepEqual(grid[1], ['', 'なし', 'なし']);
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

Run: `npm test`
Expected: FAIL — `Cannot find module '../pure_grid_report.js'`

- [ ] **Step 3: 最小の実装を書く**

`gas/pure_grid_report.js`:

```javascript
/**
 * ベロシティ・バーンダウン・障害物・ダッシュボードの2次元配列を組み立てる。
 * GAS API に依存しない純関数。
 */

// GAS 上では pure_filter.js / pure_markdown.js が同じグローバルに読み込まれる。Node ではここで解決する。
if (typeof require !== 'undefined' && typeof filterRealRows === 'undefined') {
  var { filterRealRows } = require('./pure_filter.js');
  var { extractMarkdownTable, extractSection } = require('./pure_markdown.js');
}

const VELOCITY_HEADERS = ['スプリント', '計画', '完了', '持ち越し', '開始日', '終了日', '備考'];
const IMPEDIMENT_LABELS = ['ID', 'タイトル', '説明', '報告者', '報告日', 'ステータス', '解決日', '解決策', 'スプリント'];
const IMPEDIMENT_FIELDS = ['id', 'title', 'description', 'reported_by', 'reported_at', 'status', 'resolved_at', 'resolution', 'sprint'];
const IMPEDIMENT_HEADERS = IMPEDIMENT_LABELS.concat(['メモ']);
const IMPEDIMENT_KEY_COL = 0;
const IMPEDIMENT_NOTE_COL = IMPEDIMENT_HEADERS.length - 1;
const IMP_ID_RE = /^IMP-\d+$/;
// トップレベルの const は GAS 上で全ファイル共通のスコープに入るため、固有の名前にする。
const VELOCITY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** ベロシティシート用の2次元配列を返す。期間が埋まった行だけを出す。 */
function buildVelocityGrid(velocityRows) {
  const grid = [VELOCITY_HEADERS];
  (velocityRows || []).forEach(function (v) {
    if (!VELOCITY_DATE_RE.test(String(v.sprint_start || '').trim())) return;
    if (!VELOCITY_DATE_RE.test(String(v.sprint_end || '').trim())) return;
    grid.push([
      String(v.sprint || ''), String(v.planned_points || ''), String(v.completed_points || ''),
      String(v.carried_over_points || ''), String(v.sprint_start || ''),
      String(v.sprint_end || ''), String(v.notes || ''),
    ]);
  });
  return grid;
}

/** バーンダウンシート用の2次元配列を返す。表が無ければ null。 */
function buildBurndownGrid(sprintBacklogMd) {
  const table = extractMarkdownTable(sprintBacklogMd, 'バーンダウン');
  if (!table) return null;
  return [table.headers].concat(table.rows);
}

/** 障害物のひな形行かどうか。 */
function isImpedimentPlaceholder(row) {
  const r = row || {};
  if (!IMP_ID_RE.test(String(r.id || '').trim())) return true;
  const title = String(r.title || '').trim();
  if (!title) return true;
  if (title.charAt(0) === '（' && title.charAt(title.length - 1) === '）') return true;
  if (String(r.reported_at || '').trim() === 'YYYY-MM-DD') return true;
  return false;
}

/** 障害物シート用の2次元配列を返す。未解決を先に並べる。 */
function buildImpedimentGrid(openRows, resolvedRows, notesByKey) {
  const notes = notesByKey || {};
  const grid = [IMPEDIMENT_HEADERS];
  const push = function (rows) {
    (rows || []).forEach(function (row) {
      if (isImpedimentPlaceholder(row)) return;
      const values = IMPEDIMENT_FIELDS.map(function (f) {
        return String(row[f] === undefined ? '' : row[f]);
      });
      grid.push(values.concat([String(notes[String(row.id).trim()] || '')]));
    });
  };
  push(openRows);
  push(resolvedRows);
  return grid;
}

/** ダッシュボードシート用の2次元配列を返す。 */
function buildDashboardGrid(ctx) {
  const c = ctx || {};
  const goal = extractSection(c.sprintBacklogMd || '', 'スプリントゴール');
  const rows = filterRealRows(c.backlogRows || []);

  const order = ['New', 'Ready', 'In Progress', 'Review', 'Done'];
  const counts = {};
  const points = {};
  order.forEach(function (s) { counts[s] = 0; points[s] = 0; });
  rows.forEach(function (r) {
    const s = order.indexOf(String(r.status || '').trim()) === -1 ? 'New' : String(r.status).trim();
    counts[s] += 1;
    const size = parseFloat(r.size);
    points[s] += isNaN(size) ? 0 : size;
  });

  const grid = [
    ['AI Scrum ダッシュボード'],
    [''],
    ['最終同期', String(c.syncedAt || '')],
    [''],
    ['スプリントゴール'],
    [goal || '（未設定）'],
    [''],
    ['ステータス', '件数', 'ポイント'],
  ];
  order.forEach(function (s) { grid.push([s, String(counts[s]), String(points[s])]); });
  grid.push(['合計', String(rows.length), String(order.reduce(function (a, s) { return a + points[s]; }, 0))]);

  const warnings = c.warnings || [];
  grid.push(['']);
  grid.push(['警告']);
  if (warnings.length === 0) {
    grid.push(['なし']);
  } else {
    warnings.forEach(function (w) { grid.push([String(w)]); });
  }

  // setValues は全行の列数が揃っている必要があるため、最大列数に合わせて空文字で埋める
  const width = grid.reduce(function (max, r) { return Math.max(max, r.length); }, 0);
  return grid.map(function (r) {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
}

/** 同期ログシート用の2次元配列を返す。 */
function buildSyncLogGrid(syncedAt, readFiles, warnings) {
  const files = readFiles || [];
  const warns = warnings || [];
  return [
    ['同期時刻', '読み取ったファイル', '警告'],
    [
      String(syncedAt || ''),
      files.length === 0 ? 'なし' : files.join('\n'),
      warns.length === 0 ? 'なし' : warns.join('\n'),
    ],
  ];
}

if (typeof module !== 'undefined') {
  module.exports = {
    VELOCITY_HEADERS, IMPEDIMENT_HEADERS, IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL,
    buildVelocityGrid, buildBurndownGrid, buildImpedimentGrid, buildDashboardGrid,
    buildSyncLogGrid,
  };
}
```

- [ ] **Step 4: テストを実行して通ることを確認する**

Run: `npm test`
Expected: PASS — 累計69件

- [ ] **Step 5: コミット**

```bash
git add gas/pure_grid_report.js gas/tests/pure_grid_report.test.js
git commit -m "feat: ベロシティ・バーンダウン・障害物・ダッシュボードの変換を追加する"
```

---

### Task 7: GAS 設定層と Drive 読み取り層

**Files:**
- Create: `gas/gas_config.js`
- Create: `gas/gas_drive.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `FOLDER_ID_KEY: string` — `'SCRUM_FOLDER_ID'`
  - `getFolderId(): string` — 未設定なら空文字
  - `setFolderId(id: string): void`
  - `ConfigError` — 設定不備を表す例外に付ける名前（`Error` に `name` を設定して投げる）
  - `getScrumFolder(): Folder` — `<フォルダ>/scrum` を返す。未設定・不在なら例外
  - `readTextFile(folder: Folder, name: string): string | null` — 直下のファイル本文。無ければ `null`
  - `findLatestSprintFolder(scrumFolder: Folder): Folder | null` — 最新のスプリントフォルダ。判定は `pickLatestSprintName` (Task 2) に委ねる

**このタスクにテストはない。** GAS API に依存するため `node --test` では検証できない。Task 12 の手動確認で担保する。

- [ ] **Step 1: gas_config.js を書く**

```javascript
/**
 * スクリプトプロパティに保存する設定。フォルダ ID はコードに埋め込まない。
 */

const FOLDER_ID_KEY = 'SCRUM_FOLDER_ID';

/** 設定不備を表す例外を作る。 */
function configError(message) {
  const e = new Error(message);
  e.name = 'ConfigError';
  return e;
}

/** 設定済みのフォルダ ID を返す。未設定なら空文字。 */
function getFolderId() {
  return PropertiesService.getScriptProperties().getProperty(FOLDER_ID_KEY) || '';
}

/** フォルダ ID を保存する。 */
function setFolderId(id) {
  const value = String(id || '').trim();
  if (!value) throw configError('フォルダ ID が空です。');
  PropertiesService.getScriptProperties().setProperty(FOLDER_ID_KEY, value);
}
```

- [ ] **Step 2: gas_drive.js を書く**

```javascript
/**
 * Drive からスクラム成果物を読む。読み取りのみを行う薄い層。
 */

/** 共有フォルダ配下の scrum フォルダを返す。 */
function getScrumFolder() {
  const id = getFolderId();
  if (!id) {
    throw configError(
      'Drive フォルダが未設定です。メニュー「AI Scrum」→「設定」でフォルダ ID を登録してください。');
  }
  let root;
  try {
    root = DriveApp.getFolderById(id);
  } catch (e) {
    throw configError('フォルダ ID ' + id + ' にアクセスできません。ID と共有設定を確認してください。');
  }
  const it = root.getFoldersByName('scrum');
  if (!it.hasNext()) {
    throw configError('指定フォルダの直下に scrum フォルダがありません。');
  }
  return it.next();
}

/** フォルダ直下のファイル本文を返す。無ければ null。 */
function readTextFile(folder, name) {
  const it = folder.getFilesByName(name);
  if (!it.hasNext()) return null;
  return it.next().getBlob().getDataAsString('UTF-8');
}

/** 最新のスプリントフォルダを返す。無ければ null。判定は pickLatestSprintName に委ねる。 */
function findLatestSprintFolder(scrumFolder) {
  const names = [];
  const byName = {};
  const it = scrumFolder.getFolders();
  while (it.hasNext()) {
    const f = it.next();
    const n = f.getName();
    names.push(n);
    byName[n] = f;
  }
  const latest = pickLatestSprintName(names);
  return latest === null ? null : byName[latest];
}
```

- [ ] **Step 3: 構文を確認する**

Run: `node --check gas/gas_config.js && node --check gas/gas_drive.js`
Expected: 出力なし（終了コード 0）

- [ ] **Step 4: コミット**

```bash
git add gas/gas_config.js gas/gas_drive.js
git commit -m "feat: GAS の設定層と Drive 読み取り層を追加する"
```

---

### Task 8: GAS シート書き込み層

**Files:**
- Create: `gas/gas_sheets.js`

**Interfaces:**
- Consumes: なし
- Produces:
  - `readNotes(ss, sheetName: string, keyCol: number, noteCol: number): Object` — シートが無ければ `{}`
  - `writeGrid(ss, sheetName: string, grid: string[][]): Sheet` — シートを作成またはクリアして `setValues` する
  - `ensureSheetSize(sheet, numRows: number, numCols: number): void` — 既定サイズ（1000行 × 26列）を超える grid のために行・列を広げる
  - `paintMarks(sheet, marks: Array<{row, col}>, color: string): void`
  - `applyHeaderStyle(sheet, width: number): void`

**このタスクにテストはない。** SpreadsheetApp に依存する。Task 12 の手動確認で担保する。

- [ ] **Step 1: gas_sheets.js を書く**

```javascript
/**
 * スプレッドシートへの書き込み。setValues で1シート1回にまとめる。
 */

const HEADER_BACKGROUND = '#1a73e8';
const HEADER_FONT_COLOR = '#ffffff';
const ROADMAP_BAND_COLOR = '#a8c7fa';

/** 既存シートの「キー → メモ」を読み出す。シートが無ければ空の辞書。 */
function readNotes(ss, sheetName, keyCol, noteCol) {
  const sheet = ss.getSheetByName(sheetName);
  const notes = {};
  if (!sheet) return notes;
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol <= noteCol || lastCol <= keyCol) return notes;
  const values = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  values.forEach(function (row) {
    const key = String(row[keyCol] || '').trim();
    const note = String(row[noteCol] || '').trim();
    if (key && note) notes[key] = note;
  });
  return notes;
}

/**
 * setValues が範囲外にならないよう、シートの行数・列数を必要分まで広げる。
 * insertSheet の既定は 1000行 × 26列で、getRange は自動拡張しない。ロードマップの列数は
 * 2 + スプリント数なので、スプリントが増えると既定の列数を超える。
 */
function ensureSheetSize(sheet, numRows, numCols) {
  const maxRows = sheet.getMaxRows();
  if (maxRows < numRows) sheet.insertRowsAfter(maxRows, numRows - maxRows);
  const maxCols = sheet.getMaxColumns();
  if (maxCols < numCols) sheet.insertColumnsAfter(maxCols, numCols - maxCols);
}

/** シートを作成またはクリアして2次元配列を書き込む。 */
function writeGrid(ss, sheetName, grid) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();
  if (!grid || grid.length === 0) return sheet;

  const width = grid.reduce(function (max, r) { return Math.max(max, r.length); }, 0);
  if (width < 1) return sheet;
  const normalized = grid.map(function (r) {
    const copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  ensureSheetSize(sheet, normalized.length, width);
  sheet.getRange(1, 1, normalized.length, width).setValues(normalized);
  applyHeaderStyle(sheet, width);
  return sheet;
}

/** 1行目を見出しとして装飾し、固定する。 */
function applyHeaderStyle(sheet, width) {
  if (width < 1) return;
  const header = sheet.getRange(1, 1, 1, width);
  header.setBackground(HEADER_BACKGROUND).setFontColor(HEADER_FONT_COLOR).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

/**
 * ロードマップの帯を塗る。marks は 0 起点の {row, col}。
 * marks が外接する矩形を求め、setBackgrounds を1回だけ呼んで塗る（全体制約: セル単位の書き込み禁止）。
 */
function paintMarks(sheet, marks, color) {
  if (!marks || marks.length === 0) return;
  const fillColor = color || ROADMAP_BAND_COLOR;

  let minRow = Infinity, maxRow = -Infinity, minCol = Infinity, maxCol = -Infinity;
  marks.forEach(function (m) {
    if (m.row < minRow) minRow = m.row;
    if (m.row > maxRow) maxRow = m.row;
    if (m.col < minCol) minCol = m.col;
    if (m.col > maxCol) maxCol = m.col;
  });

  const numRows = maxRow - minRow + 1;
  const numCols = maxCol - minCol + 1;
  const matrix = [];
  for (let r = 0; r < numRows; r++) {
    matrix.push(new Array(numCols).fill(null));
  }
  marks.forEach(function (m) {
    matrix[m.row - minRow][m.col - minCol] = fillColor;
  });

  // matrix は 0 起点の矩形内インデックス。getRange は 1 起点なので +1 する。
  sheet.getRange(minRow + 1, minCol + 1, numRows, numCols).setBackgrounds(matrix);
}
```

- [ ] **Step 2: 構文を確認する**

Run: `node --check gas/gas_sheets.js`
Expected: 出力なし（終了コード 0）

- [ ] **Step 3: コミット**

```bash
git add gas/gas_sheets.js
git commit -m "feat: GAS のシート書き込み層を追加する"
```

---

### Task 9: 同期オーケストレーションと同期ログ

**Files:**
- Create: `gas/gas_sync.js`

**Interfaces:**
- Consumes: Task 1〜8 の全て
- Produces:
  - `SHEET_NAMES: Object` — シート名の定数
  - `syncAll(): Object` — `{ syncedAt, warnings, skipped }` を返す。スクリプトロックで多重実行を防ぎ、
    取れなければ `skipped: true` で何もせず戻る。シートごとの例外は投げず警告として記録する（設定不備を除く）
  - `rebuildAllSheets(): Object` — ロックを取得した状態で実際に全シートを再構築する

**このタスクにテストはない。** GAS API に依存する。Task 12 の手動確認で担保する。

- [ ] **Step 1: gas_sync.js を書く**

```javascript
/**
 * 同期の全体制御。部分的な失敗で全体を止めず、警告として同期ログに残す。
 */

const SHEET_NAMES = {
  dashboard: 'ダッシュボード',
  backlog: 'バックログ',
  done: '完了バックログ',
  kanban: 'カンバン',
  roadmap: 'ロードマップ',
  velocity: 'ベロシティ',
  burndown: 'バーンダウン',
  impediment: '障害物',
  log: '同期ログ',
};

// 手動同期と時間主導トリガーが重なったときに待つ上限。
const SYNC_LOCK_WAIT_MS = 1000;

/** 現在時刻を YYYY-MM-DD HH:mm:ss で返す。 */
function nowText() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

/** scrum 直下の CSV を読んでオブジェクト配列にする。読めなければ警告を積んで null。 */
function readCsvRows(folder, name, warnings) {
  const text = readTextFile(folder, name);
  if (text === null) {
    warnings.push(name + ' が見つかりません。該当シートはスキップしました。');
    return null;
  }
  try {
    return csvToObjects(text);
  } catch (e) {
    warnings.push(name + ' の解析に失敗しました: ' + e.message);
    return null;
  }
}

/**
 * 全シートを再構築する。
 * 30分トリガーと手動の「今すぐ同期」が重なると、メモの読み出しとシートのクリアが
 * 交差してメモを失う恐れがあるため、スクリプトロックで多重実行を防ぐ。
 */
function syncAll() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(SYNC_LOCK_WAIT_MS)) {
    return { syncedAt: '', warnings: [], skipped: true };
  }
  try {
    return rebuildAllSheets();
  } finally {
    lock.releaseLock();
  }
}

/**
 * ロックを取得した状態で全シートを再構築する。
 * シートごとに try/catch で囲み、1枚の失敗で残りが書けなくなることを避ける。
 * 書き込めなかったシートは前回の内容が残るため、必ず警告として同期ログに残す。
 */
function rebuildAllSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const warnings = [];
  const readFiles = [];
  const scrum = getScrumFolder();   // 設定不備はここで例外を投げて中断する
  const syncedAt = nowText();

  // --- バックログとカンバン ---
  let backlogRows = null;
  const backlog = readCsvRows(scrum, 'product_backlog.csv', warnings);
  if (backlog !== null) {
    readFiles.push('product_backlog.csv');
    backlogRows = backlog;
    try {
      const notes = readNotes(ss, SHEET_NAMES.backlog, BACKLOG_KEY_COL, BACKLOG_NOTE_COL);
      writeGrid(ss, SHEET_NAMES.backlog, buildBacklogGrid(backlogRows, notes));
      writeGrid(ss, SHEET_NAMES.kanban, buildKanbanGrid(backlogRows));
    } catch (e) {
      warnings.push(SHEET_NAMES.backlog + ' / ' + SHEET_NAMES.kanban + ' の書き込みに失敗: ' + e.message);
    }
  }

  // --- 完了バックログ ---
  const done = readCsvRows(scrum, 'product_backlog_done.csv', warnings);
  if (done !== null) {
    readFiles.push('product_backlog_done.csv');
    try {
      writeGrid(ss, SHEET_NAMES.done, buildDoneBacklogGrid(done));
    } catch (e) {
      warnings.push(SHEET_NAMES.done + ' の書き込みに失敗: ' + e.message);
    }
  }

  // --- ベロシティ ---
  let velocityRows = null;
  const velocity = readCsvRows(scrum, 'velocity.csv', warnings);
  if (velocity !== null) {
    readFiles.push('velocity.csv');
    velocityRows = velocity;
    try {
      writeGrid(ss, SHEET_NAMES.velocity, buildVelocityGrid(velocityRows));
    } catch (e) {
      warnings.push(SHEET_NAMES.velocity + ' の書き込みに失敗: ' + e.message);
    }
  }

  // --- ロードマップ（バックログとベロシティの両方が読めたときだけ再構築する） ---
  // 片方でも欠けた状態で作り直すと、スプリント列や PBI 行が消えた表になってしまう。
  if (backlogRows !== null && velocityRows !== null) {
    try {
      const roadmap = buildRoadmapGrid(backlogRows, velocityRows);
      const roadmapSheet = writeGrid(ss, SHEET_NAMES.roadmap, roadmap.grid);
      paintMarks(roadmapSheet, roadmap.marks, ROADMAP_BAND_COLOR);
    } catch (e) {
      warnings.push(SHEET_NAMES.roadmap + ' の書き込みに失敗: ' + e.message);
    }
  } else {
    warnings.push('ロードマップは更新できませんでした。前回の内容が残っています。');
  }

  // --- 障害物（未解決と解決済みの両方が読めたときだけ再構築する） ---
  // 片方だけで作り直すと、欠けた側の行とそのメモが恒久的に失われる。
  const impOpen = readCsvRows(scrum, 'impediment_log.csv', warnings);
  const impDone = readCsvRows(scrum, 'impediment_log_resolved.csv', warnings);
  if (impOpen !== null && impDone !== null) {
    readFiles.push('impediment_log.csv');
    readFiles.push('impediment_log_resolved.csv');
    try {
      const notes = readNotes(ss, SHEET_NAMES.impediment, IMPEDIMENT_KEY_COL, IMPEDIMENT_NOTE_COL);
      writeGrid(ss, SHEET_NAMES.impediment, buildImpedimentGrid(impOpen, impDone, notes));
    } catch (e) {
      warnings.push(SHEET_NAMES.impediment + ' の書き込みに失敗: ' + e.message);
    }
  } else {
    warnings.push(SHEET_NAMES.impediment + ' は更新できませんでした。前回の内容が残っています。');
  }

  // --- バーンダウン（最新スプリントの sprint_backlog.md から） ---
  let sprintMd = '';
  try {
    const sprintFolder = findLatestSprintFolder(scrum);
    if (!sprintFolder) {
      warnings.push('sprint と連番のフォルダ（例: sprint001）が見つかりません。バーンダウンはスキップしました。');
    } else {
      const md = readTextFile(sprintFolder, 'sprint_backlog.md');
      if (md === null) {
        warnings.push(sprintFolder.getName() + '/sprint_backlog.md が見つかりません。');
      } else {
        readFiles.push(sprintFolder.getName() + '/sprint_backlog.md');
        sprintMd = md;
        const burndown = buildBurndownGrid(md);
        if (burndown === null) {
          warnings.push('sprint_backlog.md に「## バーンダウン」の表がありません。');
        } else {
          writeGrid(ss, SHEET_NAMES.burndown, burndown);
        }
      }
    }
  } catch (e) {
    warnings.push(SHEET_NAMES.burndown + ' の書き込みに失敗: ' + e.message);
  }

  // --- ダッシュボードと同期ログ（他シートの結果をまとめるため最後に書く） ---
  try {
    writeGrid(ss, SHEET_NAMES.dashboard, buildDashboardGrid({
      syncedAt: syncedAt, sprintBacklogMd: sprintMd,
      backlogRows: backlogRows || [], warnings: warnings,
    }));
  } catch (e) {
    warnings.push(SHEET_NAMES.dashboard + ' の書き込みに失敗: ' + e.message);
  }

  try {
    writeGrid(ss, SHEET_NAMES.log, buildSyncLogGrid(syncedAt, readFiles, warnings));
  } catch (e) {
    // 同期ログにも書けないときは記録先が無いため、呼び出し元へ返す警告に積むだけにする
    warnings.push(SHEET_NAMES.log + ' の書き込みに失敗: ' + e.message);
  }

  return { syncedAt: syncedAt, warnings: warnings, skipped: false };
}
```

- [ ] **Step 2: 構文を確認する**

Run: `node --check gas/gas_sync.js`
Expected: 出力なし（終了コード 0）

- [ ] **Step 3: コミット**

```bash
git add gas/gas_sync.js
git commit -m "feat: 同期オーケストレーションと同期ログを追加する"
```

---

### Task 10: メニュー・トリガー・clasp 設定

**Files:**
- Create: `gas/gas_menu.js`
- Create: `gas/appsscript.json`
- Create: `gas/.clasp.json.example`
- Create: `gas/.claspignore`

**Interfaces:**
- Consumes: `syncAll` (Task 9)、`getFolderId` / `setFolderId` (Task 7)
- Produces:
  - `onOpen()` — カスタムメニューを登録する
  - `menuSyncNow()` / `menuConfigure()` / `menuInstallTrigger()` / `menuRemoveTrigger()`
  - `scheduledSync()` — トリガーから呼ばれるエントリポイント。例外は握って実行ログに出す（実行失敗メールを止めるため）

- [ ] **Step 1: gas_menu.js を書く**

```javascript
/**
 * スプレッドシートのカスタムメニューと時間主導トリガー。
 */

const TRIGGER_HANDLER = 'scheduledSync';
const TRIGGER_MINUTES = 30;

/** スプレッドシートを開いたときにメニューを登録する。 */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('AI Scrum')
    .addItem('今すぐ同期', 'menuSyncNow')
    .addSeparator()
    .addItem('設定（Drive フォルダ ID）', 'menuConfigure')
    .addItem('自動同期を有効にする（30分毎）', 'menuInstallTrigger')
    .addItem('自動同期を止める', 'menuRemoveTrigger')
    .addToUi();
}

/** メニューから同期する。結果はトーストで知らせる。 */
function menuSyncNow() {
  const ui = SpreadsheetApp.getUi();
  try {
    const result = syncAll();
    let message;
    if (result.skipped) {
      message = '別の同期が実行中のため、今回は見送りました。少し待ってからもう一度お試しください。';
    } else if (result.warnings.length === 0) {
      message = '同期しました（' + result.syncedAt + '）';
    } else {
      message = '同期しました。警告 ' + result.warnings.length + ' 件は「同期ログ」を確認してください。';
    }
    SpreadsheetApp.getActiveSpreadsheet().toast(message, 'AI Scrum', 10);
  } catch (e) {
    ui.alert('同期できませんでした', e.message, ui.ButtonSet.OK);
  }
}

/** フォルダ ID を入力して保存する。 */
function menuConfigure() {
  const ui = SpreadsheetApp.getUi();
  const current = getFolderId();
  const response = ui.prompt(
    'Drive フォルダ ID',
    'scrum フォルダを含む共有フォルダの ID を入力してください（scrum フォルダ自身の ID ではありません）。\n'
      + '現在の設定: ' + (current || '(未設定)'),
    ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return;
  try {
    setFolderId(response.getResponseText());
    ui.alert('保存しました', 'メニューから「今すぐ同期」を実行してください。', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('保存できませんでした', e.message, ui.ButtonSet.OK);
  }
}

/** 既存の同期トリガーを全て削除する。 */
function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === TRIGGER_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

/** 30分毎のトリガーを作り直す。 */
function menuInstallTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger(TRIGGER_HANDLER).timeBased().everyMinutes(TRIGGER_MINUTES).create();
  SpreadsheetApp.getUi().alert(
    '自動同期を有効にしました', TRIGGER_MINUTES + '分毎に同期します。', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** トリガーを削除する。 */
function menuRemoveTrigger() {
  removeSyncTriggers();
  SpreadsheetApp.getUi().alert(
    '自動同期を止めました', 'メニューの「今すぐ同期」は引き続き使えます。', SpreadsheetApp.getUi().ButtonSet.OK);
}

/** トリガーから呼ばれる。UI を触らないため toast も alert も使わない。 */
function scheduledSync() {
  try {
    syncAll();
  } catch (e) {
    // 例外をそのまま投げると30分毎に実行失敗メールが届く（フォルダ未設定なら鳴り止まない）。
    // 原因は Apps Script の実行ログに残す。
    console.error('自動同期に失敗しました: ' + e.message);
  }
}
```

- [ ] **Step 2: appsscript.json を書く**

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8",
  "oauthScopes": [
    "https://www.googleapis.com/auth/spreadsheets.currentonly",
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/script.scriptapp",
    "https://www.googleapis.com/auth/script.container.ui"
  ]
}
```

- [ ] **Step 3: clasp の設定ファイルを書く**

`gas/.clasp.json.example`:

```json
{
  "scriptId": "ここにスプレッドシートにバインドしたスクリプトの ID を書く",
  "rootDir": "."
}
```

`gas/.claspignore`:

```
tests/**
.clasp.json.example
.claspignore
```

- [ ] **Step 4: 別テナント向けのセットアップスクリプトを書く**

このリポジトリは複数の Google Workspace テナントで使い回します。新しいテナントで
スプレッドシートとスクリプトを手作業で作らずに済むよう、`clasp` で一括生成します。

`scripts/setup.js`（Node.js 製。Windows でも `npx` が使えれば動く。`shell: true` は使わず、
clasp の引数は `spawnSync` に配列で渡してコマンドインジェクションを避ける）:

```js
#!/usr/bin/env node
'use strict';

// 新しい Google Workspace テナントに AI Scrum のダッシュボードを一から作る。
//
// 前提: 実行前に https://script.google.com/home/usersettings で「Apps Script API」を
// オンにしておくこと（オフのままだと create が失敗する）。
//
// 使い方:
//   node scripts/setup.js ["スプレッドシートの名前"]
//
// 作られるもの:
//   - スプレッドシート（Google ドライブのマイドライブ直下。共有フォルダへの移動と
//     チームへの共有は、作成後に手作業で行う必要がある）
//   - それに紐づく Apps Script プロジェクト
//   - gas/.clasp.json（テナント固有。git 管理しない）
//
// clasp は 3 系に固定して呼んでいる（メジャーバージョンが上がると
// login/create/push のオプションが変わることがある実績あり）。
// バージョンを上げるときは `login` `create` `push` の各オプションが
// 変わっていないか `--help` で確認してから固定し直すこと。
//
// Mac / Windows どちらでも動く（`npx` は Windows では `npx.cmd` になる）。

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const ROOT_DIR = path.join(__dirname, '..');
const GAS_DIR = path.join(ROOT_DIR, 'gas');
const CLASP_JSON_PATH = path.join(GAS_DIR, '.clasp.json');

const TITLE = process.argv[2] || 'AI Scrum Board';
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// clasp をサブコマンドとその引数の配列で呼ぶ。shell を経由しないため、
// TITLE にどんな文字列が入ってもコマンドインジェクションにはならない。
function runClasp(args, { cwd = ROOT_DIR, allowFailure = false } = {}) {
  const result = spawnSync(NPX_BIN, ['--yes', '@google/clasp@3', ...args], {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error('npx が見つかりません。Node.js を入れてください。');
    } else {
      console.error(`npx の実行に失敗しました: ${result.error.message}`);
    }
    process.exit(1);
  }
  if (!allowFailure && result.status !== 0) {
    process.exit(result.status === null ? 1 : result.status);
  }
  return result.status === 0;
}

if (spawnSync(NPX_BIN, ['--version'], { stdio: 'ignore' }).error) {
  console.error('Node.js が見つかりません。先に Node.js を入れてください。');
  process.exit(1);
}

if (fs.existsSync(CLASP_JSON_PATH)) {
  console.error(
    'gas/.clasp.json が既にあります。別のテナントに作り直す場合は削除してから再実行してください。'
  );
  process.exit(1);
}

console.log('==> Google アカウントにログインします（ブラウザが開きます）');
const alreadyLoggedIn = runClasp(['show-authorized-user'], {
  allowFailure: true,
});
if (!alreadyLoggedIn) {
  runClasp(['login']);
}

console.log(`==> スプレッドシートと Apps Script プロジェクトを作ります: ${TITLE}`);
runClasp(['create', '--type', 'sheets', '--title', TITLE, '--rootDir', '.'], {
  cwd: GAS_DIR,
});

// .claspignore が効かずに gas/tests/*.test.js まで push されると、GAS 側で
// require('node:test') が評価されてプロジェクト全体が起動しなくなる。push 前に中身を見せる。
console.log('==> push されるファイルを確認します（tests/ が含まれていないこと）');
const shown = runClasp(['show-file-status'], { cwd: GAS_DIR, allowFailure: true });
if (!shown) {
  console.log('（一覧を取得できませんでした。clasp のバージョンとコマンド名を確認してください）');
}

console.log('==> コードを配置します');
runClasp(['push', '-f'], { cwd: GAS_DIR });

console.log(`
作成しました。続けて次を行ってください。

  1. 上に表示された Google スプレッドシートの URL を開く
  2. このスプレッドシートは「マイドライブ」直下に作られ、まだ誰にも共有されていません。
     Google ドライブでチームの共有フォルダへ移動し、「共有」からメンバーに
     閲覧権限（メモ列を書いてもらう場合は編集権限）を付けてください
  3. メニュー「AI Scrum」→「設定（Drive フォルダ ID）」で、
     scrum フォルダを含む共有フォルダの ID を登録する
     （scrum フォルダ自身の ID ではありません）
  4. 「今すぐ同期」を実行して9枚のシートができることを確認する
     （初回は Drive の読み取りを求める承認ダイアログが出ます）
  5. 「自動同期を有効にする（30分毎）」を実行する

メニューが出ないときはスプレッドシートを開き直してください。
`);
```

- [ ] **Step 5: 構文を確認する**

Run: `node --check gas/gas_menu.js && node --check scripts/setup.js && node -e "JSON.parse(require('fs').readFileSync('gas/appsscript.json','utf8')); JSON.parse(require('fs').readFileSync('gas/.clasp.json.example','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 6: 全テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 累計69件（純関数層は無傷）

- [ ] **Step 7: コミット**

```bash
git add gas/gas_menu.js gas/appsscript.json gas/.clasp.json.example gas/.claspignore scripts/setup.js
git commit -m "feat: カスタムメニューとトリガー、別テナント向けセットアップを追加する"
```

---

### Task 11: .claude と scrum の移植、運用ドキュメント

**Files:**
- Create: `.claude/`（`ai-scrum` から複製）
- Create: `scrum/`（`ai-scrum` から複製）
- Create: `CLAUDE.md`
- Create: `README.md`
- Create: `docs/setup.md`

**Interfaces:**
- Consumes: なし
- Produces: なし（ドキュメントと設定のみ）

- [ ] **Step 1: .claude と scrum を複製する**

```bash
SRC=/Users/nakai_ryoka/Documents/GitRepository/WORK/SATTO/ai-scrum
cp -R "$SRC/.claude" .
cp -R "$SRC/scrum" .
rm -f .claude/terminal-state.json
```

- [ ] **Step 2: 複製結果を確認する**

```bash
ls .claude/agents | wc -l   # 9 であること
ls .claude/skills | wc -l   # 20 であること
ls scrum/*.csv | wc -l      # 5 であること
```

Expected: `9` / `20` / `5`

- [ ] **Step 3: GitHub 前提の記述を洗い出す**

```bash
grep -rln "GitHub\|gh pr\|Projects\|worktree" .claude/ scrum/ | sort
```

洗い出した各ファイルについて、次の方針で書き換える。

- `scrum/git-operation-policy.md`: GitHub の PR / ラベル運用を削除し、「git 操作は管理者のみが行う」に差し替える
  （のちに fix/cross-platform-setup で `.git` を Drive の外に置く配置へ変更し、内容も追随した）
- スキル内の「PR を作成する」手順: 「変更をコミットし、管理者に共有する」に差し替える
- `ask-to-po-shuri` スキル: Issue コメント前提の記述を、バックログのメモ列前提に差し替える

- [ ] **Step 4: CLAUDE.md を書く**

````markdown
# AI Scrum GAS版 — Claude Code 運用ガイド

本リポジトリは AIスクラムチームがスクラム開発を進めるテンプレートの **Google Workspace 版**です。
GitHub と AI の API を使わず、Google Drive と Google Apps Script だけで運用します。

- **スクラムイベント**: `.claude/skills/<name>/SKILL.md`（`/<name>` で起動）
- **スクラムチームの各ロール**: `.claude/agents/<slug>.md`（Agent ツールの `subagent_type`）
- **可視化**: `gas/` の Apps Script が Drive の `scrum/` を読み、共有スプレッドシートを再構築する

## 最上位原則: 完了よりも誠実さを優先する
- **速く完了報告を出すことではなく、実際に実施した動く成果物を渡すことが成功である**。
- 完了できなかった場合は、何が完了し何が未完了かを正直に報告することが、虚偽の完了報告より常に高く評価される。
- この原則は他のすべてのルールに優先する。

## Team Working Agreement
[チームワーキングアグリーメント](scrum/team_working_agreement.md)を**最重要ルール**として遵守すること

## スクラムチームワーキングカルチャー
[スクラムチームカルチャー](scrum/scrum_team_culture.md)を**定着した文化として徹底**すること

## このフォルダについて
このファイルは、管理者のリポジトリから `.claude/` `scrum/` と一緒に Drive 共有フォルダへ配布されたものである。
`.git` はここには無い。メンバーは会社の制約で GitHub を使えず、git 操作は一切不要である。
- `scrum/` を書き換えると、数分以内に共有スプレッドシートへ反映される
- 変更は管理者のリポジトリで行われ、`node scripts/publish.js` でこのフォルダへ配布される。
  再配布されるまで、ここでの手作業の変更は次回配布で上書きされる
- スプレッドシート上の編集は次回同期で失われる。ただし「メモ」列だけは ID をキーに引き継がれる
- ダッシュボードの「配布日時」で、この内容がいつ配布されたものかを確認できる

（この節は当初「このフォルダは Drive 共有フォルダである」だったが、fix/cross-platform-setup で
`.git` を Drive の外に置く配置へ変更したのに伴い、上記へ書き換えた）

## GAS 側の開発
```bash
npm test                              # 純関数層のテスト
cd gas && npx @google/clasp@3 push    # デプロイ（管理者のみ）
```

`pure_*.js` は GAS API に依存しない。ロジックはここに書き、`gas_*.js` は
Drive の読み取りと Sheets の書き込みだけに留める。テストできる場所を増やすためである。

GAS は `gas/*.js` を1つのグローバルスコープで評価する。トップレベルの `const` 名が
他ファイルと衝突するとプロジェクト全体が起動しないため、`gas/tests/gas_load.test.js` で検査している。

コードレビュープラグインは既定で無効。使う場合は各自の環境で有効化すること。

## 全体ルール
- 全ての成果物は **日本語** で記述すること
- CSVファイルの列構造を変更しないこと。文字コードはUTF-8
- スクラムガイド2020に準拠して運用すること
- 全てのドキュメントへの記載は、簡潔でわかりやすく可能な限り短く記載すること
````

- [ ] **Step 5: docs/setup.md を書く**

````markdown
# セットアップ

## 管理者（テナントごとに1回）

このリポジトリは複数の Google Workspace テナントで使い回せます。テナント固有の値は
リポジトリに含まれないため、clone した状態から次の手順で一から作れます。

**このリポジトリ（`.git` を含む）は Google Drive の外に clone してください。**（当初はこのリポジトリ
ごと Drive 共有フォルダに置く設計だったが、fix/cross-platform-setup で `.git` を Drive の外へ出し、
`scripts/publish.js` で必要なファイルだけ配布する設計に変更した。理由は Git運用ルール参照）

パソコンに Node.js がインストールされている必要があります（`scripts/setup.js` `scripts/publish.js` の実行に使う）。
どちらも Node.js 製のため、Mac / Windows どちらの管理者でもそのまま動きます。

1. [Apps Script の設定](https://script.google.com/home/usersettings) を開き、「Apps Script API」を
   オンにする。このテナントで初めて使うときに必須で、オフのままだと次の手順が
   `User has not enabled the Apps Script API` で失敗する
2. Google Drive に共有フォルダを作る
3. `.claude` `scrum` `CLAUDE.md` `README.md` をその共有フォルダへ配布する

   ```bash
   node scripts/publish.js "<共有フォルダのパス>"
   ```

4. スプレッドシートと Apps Script プロジェクトを作る

   ```bash
   node scripts/setup.js "AI Scrum Board"
   ```

   ログインしていなければブラウザが開きます。完了すると
   スプレッドシートの URL が表示されます。

5. **作成されたスプレッドシートをチームへ共有する**。`scripts/setup.js` は
   マイドライブ直下に作るため、この操作をしないとメンバーは開けない
   1. 表示された URL を開く
   2. Google ドライブでそのファイルを手順2の共有フォルダへ移動する
      （ドライブの一覧で右クリック →「整理」→「移動」）
   3. 「共有」からチームのメンバーに**閲覧者**（メモ列を書いてもらう場合は**編集者**）を付ける

6. 表示された URL を開き、メニュー「AI Scrum」→「設定（Drive フォルダ ID）」で
   手順2の**共有フォルダ**の ID を登録する（`scrum` フォルダの ID ではない）
7. 「今すぐ同期」を実行し、9枚のシートができることを確認する。初回は Drive の
   読み取りを求める承認ダイアログが出るので、内容を確認して許可する
8. 「自動同期を有効にする（30分毎）」を実行する

メニューが出ないときはスプレッドシートを開き直してください。

### 既にあるスプレッドシートに載せる場合

`scripts/setup.js` は新規作成専用です。既存のスプレッドシートを使うときは、
そのスクリプト ID を `gas/.clasp.json` に書いて `cd gas && npx @google/clasp@3 push` します。
`gas/.clasp.json.example` を雛形として使ってください。このファイルは
テナント固有の値を含むため git 管理しません。

### 日本以外のテナントで使う場合

`gas/appsscript.json` の `timeZone` を、そのテナントのタイムゾーンに変更してから push する。
同期時刻の表示に使われる。

### コードを更新したとき

```bash
cd gas && npx @google/clasp@3 push
```

## メンバー

1. Google ドライブのデスクトップ アプリで共有フォルダを同期する
2. 同期されたフォルダで Claude Code を起動する
3. ダッシュボードは共有スプレッドシートを開くだけで見られる

見るだけならアカウント設定は不要である。ただし「今すぐ同期」を押した人には、
初回だけ Drive の読み取りを求める承認ダイアログが出る。

## 制限

- 同期は **ファイル → スプレッドシート** の一方向である。スプレッドシート側の編集は
  次回同期で失われる。ただし「バックログ」と「障害物」の**メモ列**だけは ID をキーに引き継がれる
- 反映までの時間は Drive デスクトップ同期のラグ + トリガー間隔（最大30分）になる。
  すぐ見たいときはメニューの「今すぐ同期」を使う
- **メモ列が引き継がれるのは、その ID が一覧に残っている間だけ**である。項目が完了バックログへ
  移るとメモ列自体が無くなり、元ファイルから行が消えた場合も引き継がれない。
  残したい内容はファイル側へ書き移す
- 「今すぐ同期」と自動同期は、**実行した人の Google ドライブ全体の読み取り権限**（`drive.readonly`）を
  求める。初回実行時に承認ダイアログが出る。フォルダ ID 指定で読むには `drive.file` では足りないため、
  スコープを絞ることはできない。書き込みは対象のスプレッドシートに限られる
- PO への相談はバックログのメモ列に書き、ローカルの Claude Code で `/ask-to-po-shuri` を実行する
````

- [ ] **Step 6: README.md を書く（非エンジニア向け）**

読者は普段 Claude を使わないメンバーである。「何ができるのか」「自分は何をすればいいのか」だけで
読み終われるようにする。開発者向けの内容は書かない。

````markdown
# ai-scrum-gas

AI のチームメンバーと一緒にスクラム開発を進めるための仕組みです。
チームの状況は **Google スプレッドシート**で見られます。

## これは何をするもの？

スクラムの記録（やることリスト、進み具合、困りごと）は、このフォルダの中に
ファイルとして置かれています。それを自動で読み取って、見やすい
スプレッドシートに作り直すのがこの仕組みです。

ファイルを直接読む必要はありません。**スプレッドシートを開くだけ**で、今どうなっているかが分かります。

## スプレッドシートで見られるもの

| シート | 何が見られるか |
|---|---|
| ダッシュボード | 今のスプリントの目標と、全体の進み具合 |
| バックログ | これからやることの一覧 |
| 完了バックログ | 終わったこと |
| カンバン | 付箋を貼った board のように、状態ごとに並べたもの |
| ロードマップ | どの項目をどのスプリントでやるかの予定表 |
| ベロシティ | スプリントごとに、どれだけ終わったかの推移 |
| バーンダウン | 今のスプリントの残りが減っていく様子 |
| 障害物 | 困っていること、詰まっていること |
| 同期ログ | 最後に読み込んだ時刻。うまくいかないときはここを見る |

## メンバーがやること

### 1. フォルダを自分のパソコンに取り込む

Google ドライブのデスクトップ アプリで、共有された Drive フォルダ（`.claude` `scrum` `CLAUDE.md` `README.md` が
入っています）を自分のパソコンに取り込みます。これで、自分のパソコンからフォルダの中身が見えるようになります
（後述の「同期」とは別の操作です）。

### 2. スプレッドシートを開く

チームで共有しているスプレッドシートを開きます。これだけで最新の状況が見られます。
見るだけなら、パスワードやアカウントの設定は必要ありません。

### 3. 最新にしたいとき

スプレッドシートの上のメニューに **「AI Scrum」** があります。
そこから **「今すぐ同期」** を押すと、その場で最新の内容に更新されます。

放っておいても30分ごとに自動で更新されます。

**はじめて「今すぐ同期」を押したときだけ、確認画面が出ます。**
この仕組みが Google ドライブのファイルを読むための確認です。画面の案内に沿って、
自分のアカウントを選び、内容を確かめて「許可」を押してください。壊れたわけではありません。
2回目からは出ません。求められるのはドライブの**読み取り**だけで、書き換えはしません。

## スプレッドシートに書き込んでいいの？

**「メモ」列だけ書き込めます。** バックログと障害物のシートにある一番右の列です。
ここに書いたことは、**その項目が一覧に残っている限り**、次の更新でも引き継がれます。

ただし、項目が「完了バックログ」へ移るとメモ列が無くなるため、そのメモは残りません。
元のファイル側から項目が消えた場合も同じです。長く残したい内容は、スクラムイベントで
ファイル側に書き移してください。

それ以外のセルに書いても、次の更新で消えてしまいます。内容を変えたいときは
ファイル側を直す必要があるので、チームのスクラムイベントで相談してください。

## プロダクトオーナーに相談したいとき

バックログの「メモ」列に相談内容を書いておきます。
そのうえで、パソコンで Claude Code を開き、次のように入力します。

```
/ask-to-po-shuri
```

プロダクトオーナー役の AI が相談に答えます。

## Claude Code の使いかた（はじめての人向け）

先ほどの `/ask-to-po-shuri` のように、スクラムのイベントを自分で進めたいときは
Claude Code というツールを使います。文章で指示すると作業してくれるツールです。
パソコンにまだ入っていない場合は、チームの管理者にインストールを依頼してください。

1. ターミナル（黒い画面のアプリ）を開きます
2. `cd` と入力してスペースを1つ入れます（Enter はまだ押しません）。続けて Finder で
   取り込んだ共有フォルダを探し、その場所からターミナルの画面へドラッグ＆ドロップします。
   フォルダのパスが自動で入力されるので、そこで Enter を押します
3. `claude` と入力して Enter を押します
4. あとは日本語で話しかけるだけです

スクラムのイベントは、次のように `/` から始まる短い言葉で呼び出せます。

| 入力する言葉 | 何が起きるか |
|---|---|
| `/backlog-refinement` | やることリストを整理する |
| `/sprint-planning` | スプリントの計画を立てる |
| `/one-day-in-scrum` | 1日分の作業を進める |
| `/sprint-review` | できたものを確認する |
| `/sprint-retrospective` | ふりかえりをする |

## うまくいかないとき

| 症状 | 見るところ |
|---|---|
| スプレッドシートが古いまま | メニュー「AI Scrum」→「今すぐ同期」を押す |
| それでも変わらない | 「同期ログ」シートの警告を読む |
| バックログが空っぽ | まだ内容が入っていません。`/backlog-refinement` で作ります |
| メニュー「AI Scrum」が出ない | スプレッドシートを開き直す |

## 困ったら

「同期ログ」シートの内容を添えて、チームの管理者に相談してください。

---

導入する人向けの手順は [docs/setup.md](docs/setup.md)、
開発者向けの情報は [CLAUDE.md](CLAUDE.md) にあります。
````

- [ ] **Step 7: テストが通ることを確認する**

Run: `npm test`
Expected: PASS — 累計69件

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: .claude と scrum を移植し、運用ドキュメントを追加する"
```

---

### Task 12: プライベートリポジトリの作成とプッシュ

**Files:**
- Modify: なし（リモート操作のみ）

**Interfaces:**
- Consumes: Task 1〜11 の全成果
- Produces: なし

- [ ] **Step 1: 全テストと構文チェックを通す**

```bash
npm test
for f in gas/*.js; do node --check "$f" || echo "SYNTAX NG: $f"; done
```

Expected: 69 tests PASS、`SYNTAX NG` の出力が無いこと

- [ ] **Step 2: 秘密情報が含まれていないことを確認する**

```bash
git ls-files | xargs grep -lE "gho_|github_pat_|ghp_|AIza|-----BEGIN" 2>/dev/null || echo "秘密情報なし"
git ls-files | grep -E "\.clasp\.json$|\.clasprc" || echo "clasp 認証ファイルなし"
```

Expected: `秘密情報なし` と `clasp 認証ファイルなし`

- [ ] **Step 3: プライベートリポジトリを作ってプッシュする**

```bash
gh repo create ai-scrum-gas --private --source=. --remote=origin \
  --description "AI スクラムチームのスクラム開発テンプレート（Google Workspace / GAS 版）"
git push -u origin main
```

- [ ] **Step 4: プライベートであることを確認する**

```bash
gh repo view ai-scrum-gas --json isPrivate,name,url --jq '"private=\(.isPrivate) \(.url)"'
```

Expected: `private=true`

- [ ] **Step 5: 実環境で動作確認する**

`docs/setup.md` の管理者手順に従い、次を確認する。

1. `clasp push` が成功する
2. メニュー「AI Scrum」が表示される
3. 「設定」でフォルダ ID を保存できる
4. 「今すぐ同期」で9枚のシートができる
5. `scrum/product_backlog.csv` がひな形のままなら、バックログは見出し行だけになり、
   同期ログに警告が出ないこと
6. バックログのメモ列に文字を書いて再同期し、値が保持されること
7. 「自動同期を有効にする」でトリガーが作られること

確認結果を報告する。動かない項目があれば、修正して Task 12 の Step 1 からやり直す。
