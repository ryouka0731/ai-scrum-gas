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

// clasp をサブコマンドとその引数の配列で呼ぶ。POSIX (mac/Linux) では npx を
// shell を経由せず直接起動するため、TITLE にどんな文字列が入ってもコマンド
// インジェクションにはならない。Windows では NPX_BIN が npx.cmd になり、
// spawnSync が .cmd/.bat を実行する際は内部的に cmd.exe を経由する
// （CVE-2024-27980 のパターン）。TITLE は管理者本人がローカルで渡す引数であり、
// 現行の Node.js LTS ではこの CVE は修正済みのため実害はないが、Node.js は
// 常に最新の LTS に保つこと。
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
