#!/usr/bin/env bash
# 新しい Google Workspace テナントに AI Scrum のダッシュボードを一から作る。
#
# 前提: 実行前に https://script.google.com/home/usersettings で「Apps Script API」を
# オンにしておくこと（オフのままだと create が失敗する）。
#
# 使い方:
#   scripts/setup.sh ["スプレッドシートの名前"]
#
# 作られるもの:
#   - スプレッドシート（Google ドライブのマイドライブ直下。共有フォルダへの移動と
#     チームへの共有は、作成後に手作業で行う必要がある）
#   - それに紐づく Apps Script プロジェクト
#   - gas/.clasp.json（テナント固有。git 管理しない）
#
# clasp は 3 系に固定して呼んでいる（メジャーバージョンが上がると
# login/create/push のオプションが変わることがある実績あり）。
# バージョンを上げるときは `login` `create` `push` の各オプションが
# 変わっていないか `--help` で確認してから固定し直すこと。
set -euo pipefail

TITLE="${1:-AI Scrum Board}"
cd "$(dirname "$0")/.."

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js が見つかりません。先に Node.js を入れてください。" >&2
  exit 1
fi

if [[ -f gas/.clasp.json ]]; then
  echo "gas/.clasp.json が既にあります。別のテナントに作り直す場合は削除してから再実行してください。" >&2
  exit 1
fi

CLASP="npx --yes @google/clasp@3"

echo "==> Google アカウントにログインします（ブラウザが開きます）"
$CLASP show-authorized-user >/dev/null 2>&1 || $CLASP login

echo "==> スプレッドシートと Apps Script プロジェクトを作ります: ${TITLE}"
( cd gas && $CLASP create --type sheets --title "$TITLE" --rootDir . )

# .claspignore が効かずに gas/tests/*.test.js まで push されると、GAS 側で
# require('node:test') が評価されてプロジェクト全体が起動しなくなる。push 前に中身を見せる。
echo "==> push されるファイルを確認します（tests/ が含まれていないこと）"
( cd gas && $CLASP show-file-status ) \
  || echo "（一覧を取得できませんでした。clasp のバージョンとコマンド名を確認してください）"

echo "==> コードを配置します"
( cd gas && $CLASP push -f )

cat <<'MSG'

作成しました。続けて次を行ってください。

  1. 上に表示された Google スプレッドシートの URL を開く
  2. このスプレッドシートは「マイドライブ」直下に作られ、まだ誰にも共有されていません。
     Google ドライブでチームの共有フォルダへ移動し、「共有」からメンバーに
     閲覧権限（メモ列を書いてもらう場合は編集権限）を付けてください
  3. メニュー「AI Scrum」→「設定（Drive フォルダ ID）」で、
     scrum フォルダを含むプロジェクトフォルダの ID を登録する
  4. 「今すぐ同期」を実行して9枚のシートができることを確認する
     （初回は Drive の読み取りを求める承認ダイアログが出ます）
  5. 「自動同期を有効にする（30分毎）」を実行する

メニューが出ないときはスプレッドシートを開き直してください。
MSG
