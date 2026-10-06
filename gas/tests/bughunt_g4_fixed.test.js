'use strict';
// G4（同期・配布）のバグ探しで見つかった不具合の修正確認。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GAS_DIR = path.join(__dirname, '..');
const md = require('../pure_markdown.js');
const { buildRoadmapGrid } = require('../pure_grid_board.js');
const { buildBurndownGrid } = require('../pure_grid_report.js');
const { escapeSheetCell } = require('../pure_sheet_escape.js');

test('A3: タブ・LF で始まる数値文字列も無害化する', () => {
  assert.equal(escapeSheetCell('\t1'), "'\t1");
  assert.equal(escapeSheetCell('\n1'), "'\n1");
  assert.equal(escapeSheetCell('-3'), '-3');
});

test('F1: 「- | - | -」だけの行はデータ行として残る', () => {
  const text = '## バーンダウン\n| 日付 | 残タスク数 | 残ポイント |\n|---|---|---|\n| - | - | - |\n| Day 2 | 3 | 5 |\n';
  assert.deepEqual(buildBurndownGrid(text), [['日付', '残タスク数', '残ポイント'], ['-', '-', '-'], ['Day 2', '3', '5']]);
});

test('F2: 同じセクションに表が2つあっても最初の表だけを返す', () => {
  const text = '## バーンダウン\n| 日 | 残 |\n|---|---|\n| 1 | 2 |\n\n補足\n\n| 凡例 | 意味 |\n|---|---|\n| a | b |\n';
  assert.deepEqual(md.extractMarkdownTable(text, 'バーンダウン').rows, [['1', '2']]);
});

test('F3: CRLF でも LF と同じ結果になる', () => {
  const lf = md.extractSection('## スプリントゴール\nA\nB\n', 'スプリントゴール');
  assert.equal(md.extractSection('## スプリントゴール\r\nA\r\nB\r\n', 'スプリントゴール'), lf);
});

test('F4: 表記違いの同一スプリントは1列にまとめ、■ と帯の位置が一致する', () => {
  const vel = [
    { sprint: 'Sprint 1', sprint_start: '2026-01-01', sprint_end: '2026-01-07' },
    { sprint: 'sprint001', sprint_start: '2026-01-08', sprint_end: '2026-01-14' },
  ];
  const r = buildRoadmapGrid([{ id: 'PBI-001', title: 'a', sprint: 'Sprint 1' },
    { id: 'PBI-002', title: 'b', sprint: 'sprint001' }, { id: 'PBI-003', title: 'c', sprint: '' }], vel);
  const squares = r.grid.reduce((n, row) => n + row.filter((c) => c === '■').length, 0);
  assert.equal(r.marks.length, squares);
  assert.ok(r.marks.length >= 2, '前提: 帯が2つ以上ある');
  // 帯は1つずつ ■ のセルを指す（数が同じでも、ずれた位置を指していれば落とす）。
  r.marks.forEach((m) => assert.equal(r.grid[m.row][m.col], '■', JSON.stringify(m) + ' が ■ を指していない'));
  assert.equal(r.grid[0].length, 3);
});

// 一時リポジトリを作る。setup はコミット対象に入れるファイルを作る。
function makeRepo(setup) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-g4-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.copyFileSync(path.join(GAS_DIR, '..', 'scripts', 'publish.js'), path.join(root, 'scripts', 'publish.js'));
  fs.mkdirSync(path.join(root, 'scrum'));
  fs.mkdirSync(path.join(root, '.claude'));
  if (setup) setup(root);
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  run(['init', '-q']);
  run(['add', '-A', '-f', '--', '.claude', 'scrum', 'scripts']);
  return root;
}
function runPublish(root, dest) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'publish.js'), dest], { encoding: 'utf8' });
}
function cleanup(...dirs) { dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })); }

test('F5: 追跡されたファイルだけを配布し、未追跡の個人用ファイル・worktree は配らない', () => {
  const root = makeRepo((r) => {
    fs.writeFileSync(path.join(r, '.claude', 'settings.json'), '{}');
  });
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-g4-dest-'));
  try {
    // 追跡の後に作る（= 未追跡）
    fs.writeFileSync(path.join(root, '.claude', 'settings.local.json'), '{"x":1}');
    fs.mkdirSync(path.join(root, '.claude', 'worktrees', 'agent-x'), { recursive: true });
    fs.writeFileSync(path.join(root, '.claude', 'worktrees', 'agent-x', 'a.js'), 'x');
    fs.writeFileSync(path.join(root, 'scrum', '.DS_Store'), 'junk');
    const r = runPublish(root, dest);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.existsSync(path.join(dest, '.claude', 'settings.json')), true);
    assert.equal(fs.existsSync(path.join(dest, '.claude', 'settings.local.json')), false);
    assert.equal(fs.existsSync(path.join(dest, '.claude', 'worktrees')), false);
    assert.equal(fs.existsSync(path.join(dest, 'scrum', '.DS_Store')), false);
  } finally { cleanup(root, dest); }
});

test('F5: 配布物の中の未追跡ファイル（無視されていないもの）は1件ずつ警告し、要約に件数を出す。無視されたものは黙って配らない', () => {
  const root = makeRepo((r) => {
    fs.writeFileSync(path.join(r, 'scrum', 'tracked.md'), 't');
    fs.writeFileSync(path.join(r, '.gitignore'), 'scrum/ignored.tmp\n');
  });
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-g4-dest-'));
  try {
    // 追跡の後に作る（= git add を忘れた新しいファイル）
    fs.mkdirSync(path.join(root, 'scrum', 'sprint009'));
    fs.writeFileSync(path.join(root, 'scrum', 'sprint009', 'sprint_backlog.md'), 'new');
    fs.writeFileSync(path.join(root, 'scrum', 'forgot.md'), 'new');
    fs.writeFileSync(path.join(root, 'scrum', 'ignored.tmp'), 'junk');
    const r = runPublish(root, dest);
    assert.equal(r.status, 0, r.stderr);
    const out = r.stdout + r.stderr;
    assert.match(out, /scrum\/sprint009\/sprint_backlog\.md/, '未追跡のファイルを警告していない: ' + out);
    assert.match(out, /scrum\/forgot\.md/);
    assert.doesNotMatch(out, /ignored\.tmp/, '無視されたファイルまで警告している');
    assert.match(out, /完了しました（[^）]*2 件の未追跡ファイルを配布せず/, '要約に未追跡の件数が無い: ' + out);
    assert.equal(fs.existsSync(path.join(dest, 'scrum', 'forgot.md')), false, '未追跡のファイルを配った');
    assert.equal(fs.existsSync(path.join(dest, 'scrum', 'sprint009', 'sprint_backlog.md')), false, '未追跡のフォルダの中のファイルを配った');
    assert.equal(fs.existsSync(path.join(dest, 'scrum', 'ignored.tmp')), false, '無視されたファイルを配った');
  } finally { cleanup(root, dest); }
});

test('F5: git リポジトリでないときは明確なメッセージで失敗する', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-g4-nogit-'));
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-g4-dest-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.copyFileSync(path.join(GAS_DIR, '..', 'scripts', 'publish.js'), path.join(root, 'scripts', 'publish.js'));
    const r = runPublish(root, dest);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /git/);
  } finally { cleanup(root, dest); }
});

test('F6: 読み取り専用のファイルも2回目の配布で上書きできる', () => {
  const f = (r) => path.join(r, 'scrum', 'ro.md');
  const root = makeRepo((r) => {
    fs.writeFileSync(f(r), 'v1');
    fs.chmodSync(f(r), 0o444);
  });
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt-g4-dest-'));
  try {
    assert.equal(runPublish(root, dest).status, 0);
    assert.equal(fs.readFileSync(f(dest), 'utf8'), 'v1');
    // 追跡しているファイルを v2 にして配り直す（読み取り専用のまま）。
    fs.chmodSync(f(root), 0o644);
    fs.writeFileSync(f(root), 'v2');
    fs.chmodSync(f(root), 0o444);
    const r = runPublish(root, dest);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(f(dest), 'utf8'), 'v2', '2回目の配布で上書きされていない');
  } finally { cleanup(root, dest); }
});
