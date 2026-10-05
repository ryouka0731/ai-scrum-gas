const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyRecursive, KEEP_IF_EXISTS } = require('../../scripts/publish.js');

/** テスト用の一時ディレクトリを作り、後始末関数を返す。 */
function makeTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-scrum-publish-test-'));
  return { dir: dir, cleanup: function () { fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('シンボリックリンクはコピーせず、リンク先の内容が配布先に出ない', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  try {
    // リポジトリ外に「秘密情報」を用意し、配布元ディレクトリの中からリンクで指す。
    const secretPath = path.join(src.dir, '..', 'secret-outside-repo.txt');
    fs.writeFileSync(secretPath, '秘密情報', 'utf8');
    const srcRoot = path.join(src.dir, '.claude');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'normal.md'), '通常のファイル', 'utf8');
    fs.symlinkSync(secretPath, path.join(srcRoot, 'linked.md'));

    const destRoot = path.join(dest.dir, '.claude');
    const result = copyRecursive(srcRoot, destRoot);

    // 通常ファイルはコピーされる
    assert.equal(fs.readFileSync(path.join(destRoot, 'normal.md'), 'utf8'), '通常のファイル');
    // リンクはコピーされず、リンク先の実体（秘密情報）は配布先のどこにも出ない
    assert.equal(fs.existsSync(path.join(destRoot, 'linked.md')), false);
    const destFiles = fs.readdirSync(destRoot);
    destFiles.forEach(function (name) {
      const content = fs.readFileSync(path.join(destRoot, name), 'utf8');
      assert.notEqual(content, '秘密情報', name + ' に秘密情報が漏れています');
    });
    assert.deepEqual(result, { copiedCount: 1, skippedLinkCount: 1 });

    fs.rmSync(secretPath, { force: true });
  } finally {
    src.cleanup();
    dest.cleanup();
  }
});

test('通常ファイル・ディレクトリの再帰コピーは従来どおり動く', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    fs.mkdirSync(path.join(srcRoot, 'sprint001'), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'product_goal.md'), 'ゴール', 'utf8');
    fs.writeFileSync(path.join(srcRoot, 'sprint001', 'sprint_backlog.md'), 'バックログ', 'utf8');

    const destRoot = path.join(dest.dir, 'scrum');
    const result = copyRecursive(srcRoot, destRoot);

    assert.equal(fs.readFileSync(path.join(destRoot, 'product_goal.md'), 'utf8'), 'ゴール');
    assert.equal(fs.readFileSync(path.join(destRoot, 'sprint001', 'sprint_backlog.md'), 'utf8'), 'バックログ');
    assert.deepEqual(result, { copiedCount: 2, skippedLinkCount: 0 });
  } finally {
    src.cleanup();
    dest.cleanup();
  }
});

test('配布先にしか無いファイルは消さない', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'product_goal.md'), 'ゴール', 'utf8');

    const destRoot = path.join(dest.dir, 'scrum');
    fs.mkdirSync(destRoot, { recursive: true });
    fs.writeFileSync(path.join(destRoot, 'member_created.md'), 'メンバーの成果物', 'utf8');

    copyRecursive(srcRoot, destRoot);

    assert.equal(fs.readFileSync(path.join(destRoot, 'member_created.md'), 'utf8'), 'メンバーの成果物');
    assert.equal(fs.readFileSync(path.join(destRoot, 'product_goal.md'), 'utf8'), 'ゴール');
  } finally {
    src.cleanup();
    dest.cleanup();
  }
});

/** console.log を差し替えて、fn の間に出た行を集める。 */
function captureLog(fn) {
  const lines = [];
  const orig = console.log;
  console.log = function () { lines.push(Array.prototype.join.call(arguments, ' ')); };
  try { fn(); } finally { console.log = orig; }
  return lines;
}

const LIVE_FILES = ['product_backlog.csv', 'impediment_log.csv', 'impediment_log_resolved.csv', 'comments.csv'];

test('Web アプリが書き戻す4ファイルは一覧の定数にまとまっている', () => {
  assert.deepEqual(KEEP_IF_EXISTS.slice().sort(), LIVE_FILES.map(function (n) { return 'scrum/' + n; }).sort());
});

test('Web アプリが書き戻す4ファイルは、配布先にあれば残し、1行ずつ知らせる', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    const destRoot = path.join(dest.dir, 'scrum');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.mkdirSync(destRoot, { recursive: true });
    LIVE_FILES.forEach(function (n) {
      fs.writeFileSync(path.join(srcRoot, n), 'リポジトリの雛形', 'utf8');
      fs.writeFileSync(path.join(destRoot, n), 'Web アプリで書いた内容', 'utf8');
    });
    let result;
    const lines = captureLog(function () { result = copyRecursive(srcRoot, destRoot, 'scrum'); });
    LIVE_FILES.forEach(function (n) {
      assert.equal(fs.readFileSync(path.join(destRoot, n), 'utf8'), 'Web アプリで書いた内容', n + ' が上書きされた');
      assert.ok(lines.indexOf('scrum/' + n + ' は配布先の内容を残しました（Web アプリが書き戻すファイルのため）') !== -1,
        n + ' を残したことが出ていない: ' + JSON.stringify(lines));
    });
    assert.equal(result.copiedCount, 0);
  } finally {
    src.cleanup();
    dest.cleanup();
  }
});

test('Web アプリが書き戻す4ファイルも、配布先に無ければ作る。他の scrum/ のファイルは従来どおり上書きする', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    const destRoot = path.join(dest.dir, 'scrum');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.mkdirSync(destRoot, { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'comments.csv'), 'id,target_id\n', 'utf8');
    fs.writeFileSync(path.join(srcRoot, 'product_goal.md'), '新しいゴール', 'utf8');
    fs.writeFileSync(path.join(destRoot, 'product_goal.md'), '古いゴール', 'utf8');
    // 同じ名前でも scrum/ 直下でなければ対象外（上書きする）。
    fs.mkdirSync(path.join(srcRoot, 'sprint001'), { recursive: true });
    fs.mkdirSync(path.join(destRoot, 'sprint001'), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'sprint001', 'comments.csv'), '新', 'utf8');
    fs.writeFileSync(path.join(destRoot, 'sprint001', 'comments.csv'), '旧', 'utf8');

    const result = copyRecursive(srcRoot, destRoot, 'scrum');
    assert.equal(fs.readFileSync(path.join(destRoot, 'comments.csv'), 'utf8'), 'id,target_id\n');
    assert.equal(fs.readFileSync(path.join(destRoot, 'product_goal.md'), 'utf8'), '新しいゴール');
    assert.equal(fs.readFileSync(path.join(destRoot, 'sprint001', 'comments.csv'), 'utf8'), '新');
    assert.deepEqual(result, { copiedCount: 3, skippedLinkCount: 0 });
  } finally {
    src.cleanup();
    dest.cleanup();
  }
});

test('Web アプリが書き戻すファイルが配布先に空（0 バイト・空白のみ）であれば、雛形で置き直す。中身があれば残す', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    const destRoot = path.join(dest.dir, 'scrum');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.mkdirSync(destRoot, { recursive: true });
    LIVE_FILES.forEach(function (n) { fs.writeFileSync(path.join(srcRoot, n), '雛形\n', 'utf8'); });
    fs.writeFileSync(path.join(destRoot, 'product_backlog.csv'), '', 'utf8');
    fs.writeFileSync(path.join(destRoot, 'impediment_log.csv'), ' \n\t\n', 'utf8');
    fs.writeFileSync(path.join(destRoot, 'impediment_log_resolved.csv'), '書いた内容\n', 'utf8');
    const lines = captureLog(function () { copyRecursive(srcRoot, destRoot, 'scrum'); });
    assert.equal(fs.readFileSync(path.join(destRoot, 'product_backlog.csv'), 'utf8'), '雛形\n');
    assert.equal(fs.readFileSync(path.join(destRoot, 'impediment_log.csv'), 'utf8'), '雛形\n');
    assert.equal(fs.readFileSync(path.join(destRoot, 'impediment_log_resolved.csv'), 'utf8'), '書いた内容\n');
    assert.ok(lines.indexOf('scrum/product_backlog.csv は空だったので雛形で置き直しました') !== -1, JSON.stringify(lines));
    assert.ok(lines.indexOf('scrum/impediment_log.csv は空だったので雛形で置き直しました') !== -1, JSON.stringify(lines));
    assert.ok(lines.indexOf('scrum/impediment_log_resolved.csv は配布先の内容を残しました（Web アプリが書き戻すファイルのため）') !== -1);
  } finally {
    src.cleanup();
    dest.cleanup();
  }
});

test('Web アプリが書き戻すファイルの配布先がリンク（壊れたリンクも）なら、リンク先を読み書きせずに残す', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  const outside = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    const destRoot = path.join(dest.dir, 'scrum');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.mkdirSync(destRoot, { recursive: true });
    LIVE_FILES.forEach(function (n) { fs.writeFileSync(path.join(srcRoot, n), '雛形\n', 'utf8'); });
    // 空のファイルへのリンク（従来は空として雛形をリンク先へ書き込んでいた）と、壊れたリンク。
    const victim = path.join(outside.dir, 'victim.csv');
    fs.writeFileSync(victim, '', 'utf8');
    fs.symlinkSync(victim, path.join(destRoot, 'comments.csv'));
    fs.symlinkSync(path.join(outside.dir, 'missing.csv'), path.join(destRoot, 'product_backlog.csv'));
    copyRecursive(srcRoot, destRoot, 'scrum');
    assert.equal(fs.readFileSync(victim, 'utf8'), '', 'リンク先（配布フォルダの外）に書き込んだ');
    assert.equal(fs.existsSync(path.join(outside.dir, 'missing.csv')), false, '壊れたリンクを通して外にファイルを作った');
    assert.equal(fs.lstatSync(path.join(destRoot, 'comments.csv')).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(destRoot, 'product_backlog.csv')).isSymbolicLink(), true, '壊れたリンクを消した・置き換えた');
  } finally {
    src.cleanup();
    dest.cleanup();
    outside.cleanup();
  }
});

test('配布先のフォルダ自体がリンクなら、その下に書き込まない', () => {
  const src = makeTmpDir();
  const dest = makeTmpDir();
  const outside = makeTmpDir();
  try {
    const srcRoot = path.join(src.dir, 'scrum');
    fs.mkdirSync(srcRoot, { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'velocity.csv'), '雛形\n', 'utf8');
    fs.symlinkSync(outside.dir, path.join(dest.dir, 'scrum'));
    copyRecursive(srcRoot, path.join(dest.dir, 'scrum'), 'scrum');
    assert.equal(fs.existsSync(path.join(outside.dir, 'velocity.csv')), false, 'リンク先（配布フォルダの外）に書き込んだ');
  } finally {
    src.cleanup();
    dest.cleanup();
    outside.cleanup();
  }
});
