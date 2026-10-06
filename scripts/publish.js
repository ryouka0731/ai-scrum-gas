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
// Web アプリが書き戻すファイル（KEEP_IF_EXISTS）は、配布先に既にあれば上書きしない。
//
// Mac / Windows どちらでも動く。
//
// このファイルは require() されたときは副作用（実際のコピーやプロセス終了）を起こさず、
// copyRecursive と KEEP_IF_EXISTS のみをテスト用に公開する（gas/tests/scripts_publish.test.js 参照）。

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT_DIR = path.join(__dirname, '..');
const PUBLISH_ITEMS = ['.claude', 'scrum', 'CLAUDE.md', 'README.md'];

// 配布先に既にあればコピーしないファイル（配布物の中での相対パス、区切りは /）。
// Web アプリが配布先（Drive）のこれらへ直接書き戻すため、上書きすると人の編集やコメントが
// 消える（comments.csv はリポジトリ側がヘッダーだけなので、全件が消える）。配布先に無いときだけ
// 雛形として作る。雛形を変えたときは、Drive 側へ手で反映する。
const KEEP_IF_EXISTS = [
  'scrum/product_backlog.csv',
  'scrum/impediment_log.csv',
  'scrum/impediment_log_resolved.csv',
  'scrum/comments.csv',
  'scrum/change_log.csv',
];

/** git コマンドを実行し、標準出力（trim 済み）を返す。取得できなければ null。 */
function gitOutput(args) {
  const result = spawnSync('git', args, { cwd: ROOT_DIR, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const out = String(result.stdout || '').trim();
  return out || null;
}

/**
 * 配布対象（PUBLISH_ITEMS）のうち git で追跡されているファイルの相対パス集合を返す。
 * 未追跡・無視されたファイル（settings.local.json、worktrees、.DS_Store 等）を配らないため。
 * git が使えない・リポジトリでないときは null。
 */
function trackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z', '--'].concat(PUBLISH_ITEMS), { cwd: ROOT_DIR, encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const set = new Set();
  String(result.stdout || '').split('\0').forEach(function (f) { if (f) set.add(f); });
  return set;
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
 * relPath（配布物の中での src の相対パス。例: 'scrum'）を渡すと、KEEP_IF_EXISTS に当たる
 * ファイルは dest に既にあればコピーせず、残したことを1行出す。
 *
 * 戻り値: このコール（src 配下全体）分の集計 { copiedCount, skippedLinkCount }。
 */
function copyRecursive(src, dest, relPath, tracked) {
  const stat = fs.lstatSync(src);
  // tracked（追跡ファイルの集合）が渡されたときは、追跡されていないものを配らない。
  if (tracked && relPath !== undefined) {
    if (stat.isDirectory()) {
      const prefix = relPath + '/';
      let any = false;
      tracked.forEach(function (f) { if (f.indexOf(prefix) === 0) any = true; });
      if (!any) return { copiedCount: 0, skippedLinkCount: 0 };
    } else if (!tracked.has(relPath)) {
      return { copiedCount: 0, skippedLinkCount: 0 };
    }
  }
  if (stat.isSymbolicLink()) {
    console.warn('シンボリックリンクのためコピーをスキップしました: ' + src);
    return { copiedCount: 0, skippedLinkCount: 1 };
  }
  if (stat.isDirectory()) {
    // 配布先のフォルダ自体がリンクだと、その下のファイル単位の検査（lstat は最終要素しか見ない）を
    // すり抜けて、リンク先（配布フォルダの外）に書き込んでしまう。フォルダごと触らない。
    let destDirStat = null;
    try { destDirStat = fs.lstatSync(dest); } catch (e) { destDirStat = null; }
    if (destDirStat && !destDirStat.isDirectory()) {
      console.warn('配布先が通常のフォルダではないため、触らずに残しました: ' + dest);
      return { copiedCount: 0, skippedLinkCount: 1 };
    }
    fs.mkdirSync(dest, { recursive: true });
    let copiedCount = 0;
    let skippedLinkCount = 0;
    fs.readdirSync(src).forEach(function (name) {
      const childRel = relPath === undefined ? undefined : relPath + '/' + name;
      const result = copyRecursive(path.join(src, name), path.join(dest, name), childRel, tracked);
      copiedCount += result.copiedCount;
      skippedLinkCount += result.skippedLinkCount;
    });
    return { copiedCount: copiedCount, skippedLinkCount: skippedLinkCount };
  }
  // 配布先は existsSync ではなく lstat で見る。existsSync はリンクを辿るため、配布先に
  // 置かれたリンク（壊れたリンクも含む）を通して、配布フォルダの外のファイルを読み書きしてしまう。
  let destStat = null;
  if (relPath !== undefined && KEEP_IF_EXISTS.indexOf(relPath) !== -1) {
    try { destStat = fs.lstatSync(dest); } catch (e) { destStat = null; }
  }
  if (destStat && !destStat.isFile()) {
    console.warn(relPath + ' は配布先が通常のファイルではないため、触らずに残しました: ' + dest);
    return { copiedCount: 0, skippedLinkCount: 1 };
  }
  if (destStat) {
    // 空（0 バイト・空白のみ）のファイルは残す価値がない。雛形で置き直す。
    if (fs.readFileSync(dest, 'utf8').trim() !== '') {
      console.log(relPath + ' は配布先の内容を残しました（Web アプリが書き戻すファイルのため）');
      return { copiedCount: 0, skippedLinkCount: 0 };
    }
    console.log(relPath + ' は空だったので雛形で置き直しました');
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // 読み取り専用のファイルは、コピーで配布先も読み取り専用になり次回の上書きが EACCES で失敗する。
  // 先に書き込み可にする。失敗しても copyFileSync のエラーで、対象ファイル付きで報告される。
  try { fs.chmodSync(dest, fs.statSync(dest).mode | 0o200); } catch (e) { /* 配布先に無い等は無視 */ }
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

  const tracked = trackedFiles();
  if (!tracked) {
    console.error('git の追跡ファイル一覧を取得できません。git リポジトリ内で実行してください（未追跡・個人用ファイルを配らないため）。');
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
      const result = copyRecursive(src, path.join(DEST_DIR, item), item, tracked);
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
    + (skippedLinkCount > 0 ? '、' + skippedLinkCount + ' 件のリンク・通常でないファイルをスキップ' : '') + '）');
  console.log('配布記録: ' + recordPath + '（' + record.publishedAt + ' / ' + record.commit + ' / ' + record.branch + '）');
}

if (require.main === module) {
  main(process.argv[2]);
}

module.exports = { copyRecursive, KEEP_IF_EXISTS };
