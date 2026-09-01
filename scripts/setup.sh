#!/usr/bin/env bash
# 新しい Google Workspace テナントに AI Scrum のダッシュボードを一から作る。
#
# 使い方:
#   scripts/setup.sh ["スプレッドシートの名前"]
#
# 作られるもの:
#   - スプレッドシート（Google ドライブのマイドライブ直下）
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

echo "==> コードを配置します"
( cd gas && $CLASP push -f )

cat <<'MSG'

作成しました。続けて次を行ってください。

  1. 上に表示された Google スプレッドシートの URL を開く
  2. メニュー「AI Scrum」→「設定（Drive フォルダ ID）」で、
     scrum フォルダを含むプロジェクトフォルダの ID を登録する
  3. 「今すぐ同期」を実行して9枚のシートができることを確認する
  4. 「自動同期を有効にする（30分毎）」を実行する

メニューが出ないときはスプレッドシートを開き直してください。
MSG
