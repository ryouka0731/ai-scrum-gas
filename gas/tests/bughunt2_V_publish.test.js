'use strict';
// 2巡目 V: scripts/publish.js の CLI 本体（main）。既存テストは copyRecursive だけで、main は未到達だった。
// 実際にプロセスとして走らせ、配布先・終了コード・配布記録を確かめる。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'publish.js');
const { parsePublished } = require('../pure_grid_report.js');

function tmp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bughunt2-V-publish-'));
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
function run(arg) {
  const args = [SCRIPT].concat(arg === undefined ? [] : [arg]);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

test('引数が無ければ使い方を出して終了コード 1', () => {
  const r = run();
  assert.equal(r.code, 1);
  assert.match(r.err, /使い方: node scripts\/publish\.js/);
});

test('配布先が無い・ファイルであれば終了コード 1 で、何も作らない', () => {
  const t = tmp();
  try {
    const missing = path.join(t.dir, 'nope');
    let r = run(missing);
    assert.equal(r.code, 1);
    assert.match(r.err, /配布先フォルダが見つかりません/);
    assert.equal(fs.existsSync(missing), false);
    const file = path.join(t.dir, 'afile');
    fs.writeFileSync(file, 'x');
    r = run(file);
    assert.equal(r.code, 1);
    assert.match(r.err, /配布先フォルダが見つかりません/);
  } finally { t.cleanup(); }
});

test('配布: 4点だけを配り（gas/ scripts/ docs/ は配らない）、配布記録は読める形で書く', () => {
  const t = tmp();
  try {
    const r = run(t.dir);
    assert.equal(r.code, 0, r.err + r.out);
    assert.deepEqual(fs.readdirSync(t.dir).sort(), ['.claude', 'CLAUDE.md', 'README.md', 'scrum'].sort());
    assert.ok(fs.existsSync(path.join(t.dir, 'scrum', 'product_backlog.csv')));
    assert.equal(fs.existsSync(path.join(t.dir, '.claude', 'worktrees')), false, 'worktrees（未追跡）を配った');
    assert.equal(fs.existsSync(path.join(t.dir, '.claude', 'settings.local.json')), false);
    const recText = fs.readFileSync(path.join(t.dir, 'scrum', '.published.json'), 'utf8');
    assert.ok(recText.endsWith('\n'));
    const rec = parsePublished(recText);
    assert.ok(rec, '配布記録を parsePublished が読めない: ' + recText);
    assert.match(rec.publishedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.notEqual(rec.commit, 'unknown');
    assert.notEqual(rec.branch, 'unknown');
    assert.match(r.out, /完了しました（\d+ ファイルをコピー/);
  } finally { t.cleanup(); }
});

test('再配布: Web アプリが書き戻すファイルは残し、空なら雛形で置き直し、他は更新する。配布先だけの成果物は消さない', () => {
  const t = tmp();
  try {
    assert.equal(run(t.dir).code, 0);
    const backlog = path.join(t.dir, 'scrum', 'product_backlog.csv');
    const comments = path.join(t.dir, 'scrum', 'comments.csv');
    const velocity = path.join(t.dir, 'scrum', 'velocity.csv');
    const mine = path.join(t.dir, 'scrum', 'sprint777', 'sprint_backlog.md');
    const template = fs.readFileSync(comments, 'utf8');
    fs.writeFileSync(backlog, '人が編集した内容\n');
    fs.writeFileSync(comments, '   \n');         // 空白だけ → 雛形で置き直す
    fs.writeFileSync(velocity, 'ローカルで壊した\n');   // 書き戻さないファイル → 配布で戻る
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, '成果物');
    const r = run(t.dir);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.readFileSync(backlog, 'utf8'), '人が編集した内容\n');
    assert.equal(fs.readFileSync(comments, 'utf8'), fs.readFileSync(path.join(ROOT, 'scrum', 'comments.csv'), 'utf8'));
    assert.equal(fs.readFileSync(comments, 'utf8'), template);
    assert.notEqual(fs.readFileSync(velocity, 'utf8'), 'ローカルで壊した\n');
    assert.equal(fs.readFileSync(mine, 'utf8'), '成果物');
    assert.match(r.out, /scrum\/product_backlog\.csv は配布先の内容を残しました/);
    assert.match(r.out, /scrum\/comments\.csv は空だったので雛形で置き直しました/);
  } finally { t.cleanup(); }
});

/**
 * 作業ツリーに触れないよう、publish.js を一時の git リポジトリへ写して走らせる（PR #11 cubic）。
 * 配布対象の4点は最小の中身で作ってコミットする。
 */
function isolatedRepo() {
  const t = tmp();
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: t.dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'git ' + args.join(' ') + ': ' + r.stderr);
  };
  fs.mkdirSync(path.join(t.dir, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(t.dir, 'scripts', 'publish.js'));
  fs.mkdirSync(path.join(t.dir, '.claude'));
  fs.writeFileSync(path.join(t.dir, '.claude', 'a.md'), 'a');
  fs.mkdirSync(path.join(t.dir, 'scrum'));
  fs.writeFileSync(path.join(t.dir, 'scrum', 'velocity.csv'), 'sprint\n');
  fs.writeFileSync(path.join(t.dir, 'CLAUDE.md'), 'c');
  fs.writeFileSync(path.join(t.dir, 'README.md'), 'r');
  git(['init', '-q']);
  git(['add', '-A']);
  git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init']);
  return Object.assign(t, {
    run: (dest) => {
      const r = spawnSync(process.execPath, [path.join(t.dir, 'scripts', 'publish.js'), dest], { cwd: t.dir, encoding: 'utf8' });
      return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
    },
  });
}

test('未追跡のファイルは配らず、1件ずつ警告して件数を知らせる（一時のリポジトリで走らせる）', () => {
  const repo = isolatedRepo();
  const out = tmp();
  try {
    fs.writeFileSync(path.join(repo.dir, 'scrum', 'zz_untracked.txt'), '未追跡');
    fs.writeFileSync(path.join(repo.dir, '.claude', 'zz_untracked2.txt'), '未追跡');
    const r = repo.run(out.dir);
    assert.equal(r.code, 0, r.err);
    assert.equal(fs.existsSync(path.join(out.dir, 'scrum', 'zz_untracked.txt')), false);
    assert.equal(fs.existsSync(path.join(out.dir, '.claude', 'zz_untracked2.txt')), false);
    assert.ok(fs.existsSync(path.join(out.dir, 'scrum', 'velocity.csv')), '追跡しているファイルは配る');
    assert.match(r.err, /git で追跡されていないため配布しません.*zz_untracked\.txt/);
    assert.match(r.err, /git で追跡されていないため配布しません.*zz_untracked2\.txt/);
    assert.match(r.out, /2 件の未追跡ファイルを配布せず/);
  } finally { repo.cleanup(); out.cleanup(); }
});

test('コピー中の失敗（配布先のファイルがフォルダ）は終了コード 1 で、配布記録は書かない', () => {
  const t = tmp();
  try {
    fs.mkdirSync(path.join(t.dir, 'README.md'));   // README.md の置き場がフォルダ
    fs.mkdirSync(path.join(t.dir, 'scrum'));
    const r = run(t.dir);
    assert.equal(r.code, 1);
    assert.match(r.err, /コピー中にエラーが発生しました/);
    assert.match(r.err, /配布記録 \.published\.json はコピー完了後にしか書かない/);
    assert.equal(fs.existsSync(path.join(t.dir, 'scrum', '.published.json')), false, '失敗したのに配布記録を書いた');
  } finally { t.cleanup(); }
});
