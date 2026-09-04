const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { copyRecursive } = require('../../scripts/publish.js');

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
