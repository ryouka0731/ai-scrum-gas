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
//
// このファイルは require() されたときは副作用（実際のコピーやプロセス終了）を起こさず、
// copyRecursive のみをテスト用に公開する（gas/tests/scripts_publish.test.js 参照）。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLISH_ITEMS = ['.claude', 'scrum', 'CLAUDE.md', 'README.md'];

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

/**
 * src を dest へ再帰的にコピーする。dest 側にしか無いファイルには触れない（削除しない）。
 *
 * シンボリックリンクはコピーしない（警告してスキップする）。配布先は全メンバーが
 * 閲覧できる Drive 共有フォルダのため、`.claude/` `scrum/` にリンクが紛れ込んだ状態で
 * 素朴に `fs.statSync` / `fs.copyFileSync` を使うとリンク先（リポジトリ外の任意の
 * ファイル）の実体が複製されてしまう。判定には必ずリンク自体を見る `fs.lstatSync` を使う。
 *
 * 戻り値: このコール（src 配下全体）分の集計 { copiedCount, skippedLinkCount }。
 */
function copyRecursive(src, dest) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    console.warn('シンボリックリンクのためコピーをスキップしました: ' + src);
    return { copiedCount: 0, skippedLinkCount: 1 };
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    let copiedCount = 0;
    let skippedLinkCount = 0;
    fs.readdirSync(src).forEach(function (name) {
      const result = copyRecursive(path.join(src, name), path.join(dest, name));
      copiedCount += result.copiedCount;
      skippedLinkCount += result.skippedLinkCount;
    });
    return { copiedCount: copiedCount, skippedLinkCount: skippedLinkCount };
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return { copiedCount: 1, skippedLinkCount: 0 };
}

/** CLI 本体。destArg（配布先フォルダのパス）を受け取り、失敗時は process.exit(1) する。 */
function main(destArg) {
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

  let copiedCount = 0;
  let skippedLinkCount = 0;

  console.log('==> 配布します: ' + DEST_DIR);
  try {
    PUBLISH_ITEMS.forEach(function (item) {
      const src = path.join(ROOT_DIR, item);
      if (!fs.existsSync(src)) {
        console.error('リポジトリに ' + item + ' が見つかりません。スキップします。');
        return;
      }
      const result = copyRecursive(src, path.join(DEST_DIR, item));
      copiedCount += result.copiedCount;
      skippedLinkCount += result.skippedLinkCount;
    });
  } catch (e) {
    const failedPath = e.path ? '（' + e.path + '）' : '';
    console.error('==> コピー中にエラーが発生しました' + failedPath + ': ' + e.message);
    console.error('配布は完了していません。配布先フォルダが中途半端な状態になっている可能性があります。');
    console.error('（配布記録 .published.json はコピー完了後にしか書かないため、メンバー側は古い配布日時のままです）');
    process.exit(1);
  }

  const record = {
    publishedAt: nowText(),
    commit: gitOutput(['rev-parse', '--short', 'HEAD']) || 'unknown',
    branch: gitOutput(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
  };
  const recordPath = path.join(DEST_DIR, 'scrum', '.published.json');
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');

  console.log('==> 完了しました（' + copiedCount + ' ファイルをコピー'
    + (skippedLinkCount > 0 ? '、' + skippedLinkCount + ' 件のシンボリックリンクをスキップ' : '') + '）');
  console.log('配布記録: ' + recordPath + '（' + record.publishedAt + ' / ' + record.commit + ' / ' + record.branch + '）');
}

if (require.main === module) {
  main(process.argv[2]);
}

module.exports = { copyRecursive };
