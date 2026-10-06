# Web アプリ 第4段階 設計: 障害物の作成・編集・解決

## 背景

第3段階で「障害物」タブを足したが、閲覧のみだった。障害物を記録・解決するには、
今も人がローカルの Claude Code に頼むか、CSV を直接編集するしかない。
本段階で、Web アプリから障害物を作成・編集・解決できるようにする。

## 段階の位置づけ

| 段階 | 内容 | 状態 |
|---|---|---|
| 第1段階 | 双方向同期の基盤 + カンバン | 完了（PR #1） |
| 第2段階 | PBI の作成・編集・削除 + UI 刷新 | 完了（PR #2） |
| 第3段階 | 対象で分けるタブ + スプリント・障害物のビュー + 用語の整理 | 完了（PR #3） |
| **第4段階（本設計）** | **障害物の作成・編集・解決** | 本設計 |
| 第5段階 | コメント・議論のスレッド | 未着手 |
| 第6段階 | 変更履歴と差分表示 | 未着手 |

## 前提となる事実

- 列は `id,title,description,reported_by,reported_at,status,resolved_at,resolution,sprint`
  （`IMPEDIMENT_FIELDS`）。**`updated_at` が無い。** CSV の列構造は変えない決まりなので
  足せない。PBI と同じ競合判定は使えない
- **未解決と解決済はファイルで分かれる**（`impediment_log.csv` / `impediment_log_resolved.csv`）。
  `status` 列は雛形の `Open` しか使われておらず、解決済の値は決まっていない
- 両ファイルに雛形行（`IMP-001`「（障害物タイトル）」）がある。`isImpedimentPlaceholder` が除く
- 書き込み先は `WRITABLE_FILES` で `product_backlog.csv` だけに絞っている
- エージェント（ケンジ）も同じファイルを直接書く。解決時は resolved へ「移動」する運用

## できること

| 操作 | 対象 | 書き込み先 |
|---|---|---|
| 作成 | — | `impediment_log.csv` に追記 |
| 編集 | 未解決のみ | `impediment_log.csv` の該当行 |
| 解決 | 未解決のみ | `impediment_log_resolved.csv` に追記 → `impediment_log.csv` から削除 |
| 解決の取り消し | 直前に解決した行（通知から） | 上の逆 |

**やらないこと:** 削除、解決済の編集、`status` 列による絞り込み。
削除が要るのは「間違って作った」ときだけで、それは解決策に「誤登録」と書いて解決すれば足りる。

## 項目

| 列 | 作成 | 編集 | 解決 |
|---|---|---|---|
| `id` | サーバが採番（`IMP-NNN`） | 不可 | 不可 |
| `title` | 必須 | 必須 | — |
| `description` | 任意 | 可 | — |
| `reported_by` | 必須（自由入力） | 可 | — |
| `reported_at` | サーバが今日の日付（`YYYY-MM-DD`） | 不可 | — |
| `status` | サーバが `Open` | 不可 | サーバが `Resolved` |
| `resolved_at` | 空 | 不可 | サーバが今日の日付 |
| `resolution` | 空 | 不可 | **必須** |
| `sprint` | プルダウン（既定は最新スプリント） | 可 | — |

- 編集できる列は `IMPEDIMENT_EDITABLE_FIELDS = ['title','description','reported_by','sprint']`。
  それ以外が送られてきても捨てる（`pickEditableFields_` と同じ考え方）
- スプリントの選択肢は PBI と同じ `sprintChoices(velocityRows, rows)` で作り、
  障害物ビューの応答に `sprintChoices` として載せる
- 解決済の値を `Resolved` に決める。ファイルで分かれているので判定には使わないが、
  シートで見たときに `Open` のまま残ると読み手を誤らせる

## 採番

`IMP-NNN` の最大値（両ファイルを通して）の次。桁数は既存に合わせ、最低3桁。
雛形行の `IMP-001` も数に入れる（雛形を本物の行で上書きしない。次は `IMP-002`）。

**高水位の記録は持たない。** 削除の操作を作らないので、一度使った ID は必ずどちらかの
ファイルに残る。

## 競合の判定

`updated_at` が無いので、**行の中身で比べる。** 画面は描いた時点の行（全列）を
`expected` として送り、サーバはロック内で読み直した行と全列を比べる。
1列でも違えば `conflict` として止め、上書きしない。

- 比べるのは `IMPEDIMENT_FIELDS` の全列。前後の空白は比較前に落とさない
  （CSV 側の値そのものを比べる。落とすと「空白だけの変更」を見逃す）
- 見つからなければ `not_found`
- 文面は既存の `conflictMessage_` の流儀に揃える（何をすれば通るかを書く）

そのためビューの行は、表に出さない `status` も含めて全列を持つ。

## 2ファイルにまたがる書き戻し

Drive に複数ファイルのトランザクションは無い。**「足してから消す」順にする。**

- 解決: resolved に追記 → open から削除
- 取り消し: open に追記 → resolved から削除

途中で失敗すると、同じ ID が両方のファイルに残る。行が消えるよりは安全であり、
次の2点で自然に回復する。

1. **表示は「解決済を優先」する。** 両方にある ID は未解決側から隠す
   （`buildImpedimentView` と `summarizeImpediment` の両方で同じ規則）
2. **操作は冪等にする。** 解決しようとした ID が既に resolved にあれば、追記せず
   open から消すだけにする。取り消しも同じ

失敗時の通知は「途中で止まりました。もう一度押すと完了します」とする。

シートへの同期（`buildImpedimentGrid`）は両方の行を出す。シートは控えなので許容する。

### 取り消し

解決の応答は、移す前の行（`moved`）を返す。画面は通知の「取り消す」で
`apiUnresolveImpediment(moved, resolvedRow)` を呼ぶ。

- `resolvedRow` は解決で書いた行。resolved 側の今の行と全列が一致しなければ `conflict`
  （その間に誰かが書き換えた）
- `moved.id` が `IMP-\d+` でない、`moved.title` が空、`moved.id` と `resolvedRow.id` が違う、のいずれかなら `invalid`
- open に戻すのは `moved` のうち `IMPEDIMENT_FIELDS` の列だけ

> **追記（2026-10-07）**: 取り消しはブラウザが送る行を受け取らない形に変えた（PBI の削除の取り消しと同じ理由。
> 送られた `moved` をそのまま書くと、検証も履歴も通さずに任意の内容へ書き換えられた）。
> - 解決の応答は `moved` / `resolvedRow`（表示用）に加えて `undoToken` を返す。サーバは解決前の行を
>   `CacheService`（`impundo:` + 鍵、600 秒）に預ける。預けられなければ `undoToken: null`（取り消しの通知を出さない）
> - `apiUnresolveImpediment(arg)` の `arg` は `{ undoToken }` か `{ pendingId }` のどちらか1つだけ。それ以外の形は `invalid`
>   - `{ undoToken }`: 預かった行を戻す。鍵は書く前に捨て（捨てられなければ `error`）、書き終えられなければ
>     （失敗・`partial`）預け直す。`partial` の「完了する」は同じ鍵で送り直す。無い・期限切れは `expired`
>   - `{ pendingId }`: 「途中で止まった操作」の「未解決に戻す」。同じ障害物が両方のファイルにあるときだけ、
>     未解決側の行を正として解決済から消す。既に揃っていれば何も書かずに成功、それ以外は `conflict`

### 追記（2026-10-06）
未解決から隠すのは、解決済に ID と中身（id・タイトル・説明・報告者・報告日・スプリント）が同じ行があるときだけ。
その状態は「途中で止まった操作」として画面に出し、「解決済として完了」「未解決に戻す」で完了できる
（サーバが毎回見つけて返すので、開き直しても出る）。同じ ID で中身が違う行は押せない行として出し、CSV の修正を促す。

## API

`google.script.run` は全グローバル関数を公開するため、足すのは次の4つだけ。

```
apiCreateImpediment(fields)                     → { ok, view, summary, id }
apiUpdateImpediment(id, fields, expected)       → { ok, view, summary }
apiResolveImpediment(id, resolution, expected)  → { ok, view, summary, moved, resolvedRow, undoToken }
apiUnresolveImpediment({ undoToken } | { pendingId }) → { ok, view, summary }   （2026-10-07 から。上の追記）
```

失敗時は `{ ok:false, reason, message, view?, summary? }`。`reason` は
`busy` / `invalid` / `conflict` / `not_found` / `partial` / `error`。
成功・競合のどちらでも最新のビューを返し、画面はそれで描き直す。

## アーキテクチャ

| ファイル | 役割 |
|---|---|
| `pure_impediment_id.js`（新） | `nextImpedimentId(rows)` |
| `pure_impediment_validate.js`（新） | `IMPEDIMENT_EDITABLE_FIELDS`、`validateImpedimentFields`、`validateResolution` |
| `pure_impediment_merge.js`（新） | 追記・更新・移動の純関数。`rowsEqual` による競合判定、冪等の判定 |
| `pure_view_impediment.js` | 行に全列を持たせる。両方にある ID を未解決から隠す |
| `pure_summary.js` | `summarizeImpediment` に同じ隠す規則 |
| `pure_write_guard.js` | `WRITABLE_FILES` に2ファイルを足す |
| `web_app.js` | `withImpedimentWrite_(mutate)` と4つの API。障害物ビューに `sprintChoices` |
| `kanban.html` | 障害物タブに「障害物を追加」と、行を押すと開くパネル |

`withImpedimentWrite_` は `withBacklogWrite_` と同じ形にする。ロックを取り、2ファイルを
読み直し、**両方のヘッダーを `IMPEDIMENT_FIELDS` で検査してから** `mutate({open, resolved})` を
呼ぶ。`mutate` は書くべきファイルだけを返し、上の順序で書く。

`gas/*.js` は単一のグローバルスコープなので、新しいトップレベル名は既存と衝突させない
（`gas_load.test.js` が検査する）。

## 画面

- 障害物タブの要約の下に「障害物を追加」ボタン
- 未解決の表の行を押すと、**障害物用のパネル**（`#imp-panel`）が開く。
  PBI のパネルとは項目が違うので分ける。見た目・閉じ方・キーボード操作は PBI のパネルに揃える
- パネルの下部: 「保存」「解決する」。「解決する」を押すと解決策の入力欄が出て、
  もう一度押すと確定する（解決策は必須）
- 解決済の表の行は押せない（閲覧のみ）
- 解決後に「解決しました」＋「取り消す」の通知（PBI の削除と同じ部品）
- 閲覧者権限で書けないときは、既存の `writeScrumFile_` の案内がそのまま出る

## テスト

- 純関数: 採番（雛形込み・欠番・桁あふれ）、検証、全列一致の競合判定、
  解決・取り消しの冪等性（片方にだけ残った状態からの回復）、隠す規則
- `web_app_flow.test.js`: 2ファイルの書き込み順、2つ目で失敗したときの `partial`、
  ヘッダー不一致で書かないこと、許可リスト
- DOM シム: パネルの開閉、解決の2段階の確定、取り消しの通知、解決済の行が押せないこと
- 実ブラウザ: パネルの幅・重なり（既存の検査に障害物パネルを足す）

## 書き換える文書

「障害物は閲覧のみ」「Web アプリが読み書きするのは `product_backlog.csv` だけ」と書いた箇所を
`git grep` で全件拾って直す。少なくとも次の箇所がある。

- `CLAUDE.md`（冒頭の説明と「人がやること」の節）
- `README.md`（できることの表、よくある質問）
- `docs/setup.md`（手順9の説明）

## 実機で確かめること

- 作成 → 編集 → 解決 → 取り消し の一巡
- 閲覧者権限のアカウントで保存すると日本語の案内が出ること
- ローカルの Claude Code が同じ行を書き換えた直後に保存すると、競合で止まること

## 対象外

- 障害物の削除、解決済の編集
- `status` 列による絞り込み・並べ替え
- コメント・議論のスレッド（第5段階）
- 変更履歴と差分表示（第6段階）
