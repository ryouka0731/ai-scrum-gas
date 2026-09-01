---
name: sprint-review
description: スプリントレビューを実施する。インクリメントの検査、ステークホルダーフィードバック収集、受入判定、プロダクトバックログの調整を行う。スプリント終了時のレビューイベントに使用する。
---

# スプリントレビュー実施

"準備"で起動した各サブエージェントを下記の指示通りに利用し、スプリントレビューを実施してください。

## 準備
- シュリエージェントは Agent ツールで `subagent_type: product-owner-shuri`(`.claude/agents/product-owner-shuri.md`)として起動します。
- マヤエージェントは Agent ツールで `subagent_type: developer-maya`(`.claude/agents/developer-maya.md`)として起動します。
- ダイチエージェントは Agent ツールで `subagent_type: developer-daichi`(`.claude/agents/developer-daichi.md`)として起動します。
- ケンジエージェントは Agent ツールで `subagent_type: scrum-master-kenji`(`.claude/agents/scrum-master-kenji.md`)として起動します。
- イツキエージェントは Agent ツールで `subagent_type: customer-itsuki`(`.claude/agents/customer-itsuki.md`)として起動します。
- ヒツギエージェントは Agent ツールで `subagent_type: reviewer-hitsugi`(`.claude/agents/reviewer-hitsugi.md`)として起動します。

ヨミとサキトは契約の都合でレビューには参加できませんが、ダイチ・マヤ経由でフィードバックがあれば提供している前提で進めます。

## 対象スプリント
スプリント番号が引数で指定された場合はそのスプリントを対象とします。
指定がない場合は、scrumフォルダから最新のsprintXXX(XXXは連番)を対象とします。

## 事前確認
1. `scrum/${sprint_number}/sprint_backlog.md` を読み、完了したPBIと未完了のPBIを確認する
2. `scrum/product_goal.md` を読み、プロダクトゴールへの進捗を確認する
3. `scrum/definition_of_done.md` を読み、完成の定義を確認する

## スプリントレビューの実施

### 1. スプリントゴール達成状況の共有
- ケンジエージェントを使い、スプリントゴールの達成状況をまとめてください

### 2. インクリメントのデモと検査
- マヤエージェント、ダイチエージェントを使い、完了したPBIのデモ内容を説明してください
- 完成の定義を満たしていることを確認してください

### 3. ステークホルダーフィードバック
- イツキエージェントを使い、以下の観点でフィードバックを提供してください：
  - 機能性: 要求通りに動作するか
  - ユーザビリティ: 使いやすいか
  - ビジネス価値: 期待する価値を提供しているか
  - 改善提案: より良くするためのアイデア

### 4. 受入判定
- シュリエージェントを使い、各PBIの受入判定を行ってください
  - 受入: 完成の定義を満たし、受入基準をクリア
  - 差戻: プロダクトバックログに戻す

### 4.5 仕様ナレッジの同期
- シュリエージェントを使い、受入判定の結果を `scrum/specs/` に反映してください
  - **同期前の仕様ドリフト検査**: confirmed 化する前に、ヒツギエージェントが active change spec（`scrum/sprintXXX/specs/PBI-XXX.md`）と実装の仕様ドリフト検査（`scrum/specs/README.md` の手順）を行う。逸脱があれば README の分岐に従い、差戻とするか実装を修正してから同期する
  - 受入OKのPBI: `scrum/specs/PBI-XXX.md` を、実装された実態（`scrum/sprintXXX/specs/PBI-XXX.md`）に合わせて更新し `status: confirmed` にする。変更履歴に受入日を追記する
  - 差戻のPBI: `scrum/specs/PBI-XXX.md` は `status: draft` のまま残し、差戻理由を変更履歴に追記する

### 5. 環境変化の共有
- ビジネス環境や市場の変化、技術的な変化があれば共有する

### 6. プロダクトバックログの調整
- シュリエージェントを使い、レビュー結果に基づいてプロダクトバックログを調整してください
- 新たな機会や要望をPBIとして追加する

### 7. レビュー結果監査
- ヒツギエージェントを使い、スプリントレビューの結果を監査してください
  - 更新すべきファイルがきちんと更新されているか、抜け漏れが無いかをチェックします。
  - 手順4.5の仕様ドリフト検査（active change spec と実装の比較）が実施され、PBIごとの結果・仕様更新/実装修正/差戻の判断・未解決事項が `sprint_review.md` に記録されているかを確認します。

### 8. リポジトリへの反映
- ケンジエージェントを使い、必要なファイルをマージして、全てmainリポジトリに反映させます。
 - 最後に git pull origin main を実行し、差分を確認・取得します。

## 記録
- 受入OKのPBIの `scrum/specs/PBI-XXX.md` を status: confirmed に更新する
- PBIごとの仕様ドリフト検査結果と、confirmed/差戻の判断・未解決事項を `scrum/${sprint_number}/sprint_review.md` に記録する
- `scrum/${sprint_number}/sprint_review.md` にレビュー結果を記録する
- `scrum/product_backlog.csv` を更新する（完了PBIのステータス変更、新規PBI追加）
- `scrum/velocity.csv` にスプリント実績を記録する
- `scrum/${sprint_number}/ask_user.md` にユーザへの確認事項・質問事項を記録する（必要に応じて）

## 注意事項
- レビューはプレゼンテーションに限定せず、ワーキングセッションとして実施する
- 次に何をすべきかについて参加者全員で協力して議論する
- 記録は必要な要素を落とさずに、一方でできるだけ簡潔に短く記載すること
