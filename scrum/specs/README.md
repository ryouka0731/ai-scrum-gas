# 仕様書ナレッジベース（scrum/specs/）

このディレクトリは、プロダクトの**現行仕様（真実の源泉）**を蓄積するナレッジベースです。
仕様書駆動スクラムの全体像は [docs/workflows/spec-driven-scrum.md](../../docs/workflows/spec-driven-scrum.md) を参照してください。

## ファイル

- `_TEMPLATE.md` — 仕様書ひな形。コピーして `PBI-XXX.md` を作成する（このファイル自体は編集しない）。
- `PBI-XXX.md` — PBI/機能単位の仕様。`status` で状態を管理する。

## status ライフサイクル

| status | 意味 | 遷移させるイベント |
|---|---|---|
| draft | 起票済み・未着手 | backlog-refinement で新規作成 |
| active | スプリントで作業中 | sprint-planning で `sprintXXX/specs/` へ複製し設定 |
| confirmed | 受入済み・現行仕様 | sprint-review の受入判定OK後に確定 |

- 起票時（draft）は `scrum/specs/PBI-XXX.md` に作成する。
- プランニング時は `scrum/sprintXXX/specs/PBI-XXX.md` へ複製して詳細化し active にする（凍結コピー）。
- 受入後は `scrum/specs/PBI-XXX.md` を実装実態に合わせて confirmed に更新する。

## 仕様ドリフト検査手順

実装が仕様書から逸脱（drift）していないかを、one-day-in-scrum と sprint-review の
ヒツギエージェントの監査工程で確認する。手順:

1. 対象スプリントの `scrum/sprintXXX/specs/PBI-XXX.md`（active）を開く。
2. 「受入基準」の各 AC 項目について、対応する実装（コード・画面・API）が存在するか確認する。
3. 「インターフェース / データ」の各項目が実装と一致しているか確認する。
4. 「Non-goals」に反する実装（スコープ外の作り込み）がないか確認する。
5. 逸脱を検出した場合:
   - 実装が正しく仕様が古い → 仕様書を更新し変更履歴に記録。
   - 仕様が正しく実装が逸脱 → 担当エージェントに修正させる。
6. 検査結果を daily_scrum.md / sprint_review.md の監査記録に残す。

> 生成プロダクト側で機械的なドリフト検知が必要な場合は、そのプロダクトの
> テスト/CIとして受入基準を自動検証するスクリプトを追加してよい（DoDに含める）。
