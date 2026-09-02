#!/usr/bin/env node
'use strict';

// 管理者のリポジトリから、メンバー向け配布物一式を Drive 共有フォルダへコピーする。
//
// このリポジトリ（`.git` を含む）は Drive の外に置く。git の書き込み中に Drive が
// `.git` 配下を配りにいくと競合コピーができてリポジトリが壊れるうえ、メンバーは会社の制約で
// GitHub を使えず `.git` を一切必要としないため。Drive 共有フォルダへ渡すのはこのスクリプトで
// 配布する4点だけである。
//
// 使い方:
//   node scripts/publish.js <配布先フォルダのパス>
//
// 配布するもの: .claude/ scrum/ CLAUDE.md README.md の4つだけ。
//   gas/ scripts/ docs/ package.json は管理者の開発用のため配布しない
//   （GAS 側は clasp push で別途デプロイする）。
//
// 配布先にあってリポジトリに無いファイルは消さない。メンバーが scrum/ 配下に作った
// 成果物（sprintXXX/ など）を守るため。
//
// Mac / Windows どちらでも動く。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLISH_ITEMS = ['.claude', 'scrum', 'CLAUDE.md', 'README.md'];

const destArg = process.argv[2];
if (!destArg) {
  console.error('使い方: node scripts/publish.js <配布先フォルダのパス>');
  process.exit(1);
}
const DEST_DIR = path.resolve(destArg);

if (!fs.existsSync(DEST_DIR) || !fs.statSync(DEST_DIR).isDirectory()) {
  console.error('配布先フォルダが見つかりません: ' + DEST_DIR);
  console.error('Drive の共有フォルダを作ってから、そのパスを指定してください。');
  process.exit(1);
}

/** git コマンドを実行し、標準出力（trim 済み）を返す。取得できなければ null。 */
function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const out = String(result.stdout || '').trim();
  return out || null;
}

/** 現在時刻を YYYY-MM-DD HH:mm:ss で返す。 */
function nowText() {
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' '
    + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}

let copiedCount = 0;

/** src を dest へ再帰的にコピーする。dest 側にしか無いファイルには触れない（削除しない）。 */
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(function (name) {
      copyRecursive(path.join(src, name), path.join(dest, name));
    });
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    copiedCount += 1;
  }
}

console.log('==> 配布します: ' + DEST_DIR);
PUBLISH_ITEMS.forEach(function (item) {
  const src = path.join(ROOT_DIR, item);
  if (!fs.existsSync(src)) {
    console.error('リポジトリに ' + item + ' が見つかりません。スキップします。');
    return;
  }
  copyRecursive(src, path.join(DEST_DIR, item));
});

const record = {
  publishedAt: nowText(),
  commit: gitOutput(['rev-parse', '--short', 'HEAD']) || 'unknown',
  branch: gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
};
const recordPath = path.join(DEST_DIR, 'scrum', '.published.json');
fs.mkdirSync(path.dirname(recordPath), { recursive: true });
fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');

console.log('==> 完了しました（' + copiedCount + ' ファイルをコピー）');
console.log('配布記録: ' + recordPath + '（' + record.publishedAt + ' / ' + record.commit + ' / ' + record.branch + '）');
