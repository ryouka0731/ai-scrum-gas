#!/usr/bin/env bash
# OCR auto-review on implementation finish (Claude Code Stop hook, delegation mode).
#
# 本リポジトリで実装が終わって Claude が応答を止めるたびに発火し、git 作業ツリーに
# 「前回レビュー以降の新しい未コミット変更」があるときだけ、open-code-review(OCR) の
# delegation モードによるコードレビューを Claude 自身に実行させる。
# delegation は OCR 側で LLM を呼ばない(APIキー不要)。前提: `ocr` CLI が導入済み
# (`npm install -g @alibaba-group/open-code-review`)。
#
# 発火条件をすべて満たしたときのみ {"decision":"block", "reason": ...} を出力して停止を差し戻す:
#   - jq / ocr / git が利用可能
#   - git 作業ツリー内で未コミット変更がある
#   - 変更セットのハッシュが当該セッションの前回レビュー時と異なる(重複抑止)
#   - stop_hook_active でない(ループ防止)
#
# 無効化: /hooks で本フックを外すか、.claude/settings.json の Stop 配列から該当エントリを削除。

input=$(cat 2>/dev/null || true)

command -v jq  >/dev/null 2>&1 || exit 0
command -v ocr >/dev/null 2>&1 || exit 0

# ループ防止: この停止が stop フックの継続によるものなら何もしない
active=$(printf '%s' "$input" | jq -r '.stop_hook_active // false' 2>/dev/null || echo false)
[ "$active" = "true" ] && exit 0

# git 作業ツリー内でなければ対象外
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# 未コミット変更(staged/unstaged/untracked)が無ければ対象外
[ -n "$(git status --porcelain 2>/dev/null)" ] || exit 0

# コード拡張子の変更が無ければ対象外(Markdown/CSV/docs等だけの変更ではOCRを起動しない)
changed=$( { git diff --name-only; git diff --cached --name-only; git ls-files --others --exclude-standard; } 2>/dev/null )
printf '%s\n' "$changed" | grep -qiE '\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cc|cpp|cxx|h|hpp|hh|cs|swift|kt|kts|scala|vue|svelte|sql|sh|bash|zsh|ps1|lua|pl|pm|dart|ex|exs|erl|r|m|mm|yml|yaml|json|toml|tf|proto)$' || exit 0

# セッション単位の重複抑止: 変更セットのハッシュが前回と同じならスキップ
sid=$(printf '%s' "$input" | jq -r '.session_id // "nosid"' 2>/dev/null || echo nosid)
state="${TMPDIR:-/tmp}/ocr-autoreview-${sid}.hash"
untracked=$(git ls-files --others --exclude-standard -z 2>/dev/null | while IFS= read -r -d '' f; do shasum "$f" 2>/dev/null; done)
cur=$( { git status --porcelain; git diff; git diff --cached; printf '%s' "$untracked"; } 2>/dev/null | shasum 2>/dev/null | awk '{print $1}')
[ -n "$cur" ] || exit 0
if [ -f "$state" ] && [ "$(cat "$state" 2>/dev/null)" = "$cur" ]; then
  exit 0
fi
printf '%s' "$cur" > "$state" 2>/dev/null || true

reason='実装後の自動コードレビュー（open-code-review / delegation・APIキー不要）。今回の未コミット変更を次の手順でレビューしてください: (1) `ocr delegate preview` でレビュー対象ファイルとモードを確認 (2) 必要なら `ocr delegate rule <files...>` で適用ルールを取得 (3) その spec に沿って変更をレビューし、high-confidence の欠陥のみ（NPE / 並行性 / XSS / SQLインジェクション / リソースリーク等）を簡潔に報告し、自明なものは修正 (4) 指摘が無い/軽微なら一言添えて完了してよい。open-code-review プラグイン導入済みなら `/open-code-review:delegate-review` を使ってもよい。これは自動レビューであり、必要なければ深追いしない。'

jq -n --arg r "$reason" '{decision:"block", reason:$r}'
exit 0
