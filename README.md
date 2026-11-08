# Dandori

タスク・スケジュール管理アプリ。時間軸タイムライン、ステータス別ボード、月単位のタスク計画とバーンダウンを組み合わせた、iPhone 中心の個人用 local-first PWA。

アプリ本体は [dandori/](./dandori) にあります。

## 月単位のタスク管理

- スプリントの作成・開始・完了操作は廃止し、1日から末日までのカレンダー月を選んで管理します。
- 「タスク」画面では月次バーンダウンを表示し、「ボード」からも展開して確認できます。タスクの作成・編集・移動時に対象月を選択できます。
- 未完了タスクは、月が変わった後の起動・画面復帰・保存時に今月へ自動で繰り越します。起動したまま日付をまたぐ場合も更新します。予定日と開始時刻は勝手に変更しません。
- 繰り返しの予定は、今月と選択した月の範囲内で自動生成します。ボードでは同じ繰り返しを1枚へまとめます。
- バーンダウンはEpicと子を持つ親を除いた作業タスクの件数で集計します。日別実績は変更適用後から記録し、記録開始前の履歴は作りません。過去月の記録は繰り越し後も残ります。
- 既存タスクは予定日、期限、作成日の順に対象月を補完し、未完了の過去月分は今月へ移します。旧スプリントの記録は互換用に保持します。「すべての月のタスクを表示」で過去や未来のタスクも検索できます。

## 親子タスク

- 子がある親のステータスは子の進捗から自動計算します。すべて未着手ならTo Do、一部が進行中または完了ならIn Progress、すべて完了ならDoneになります。孫から祖先にも反映し、親だけを変更しても子の進捗が優先されます。
- 月をまたいだ子も集計します。子の作成・親の付け替え・削除・予定の追加や解除でも再計算し、既存データは読み込み時に整合させます。子がなくなったタスクは手動管理に戻り、最後の状態を保持します。
- ボードには親の名前と子の完了件数を表示します。編集画面では子のタイトルや「親タスクを編集」から関連タスクを開けます。閉じると元の入力内容へ戻ります。

## 技術スタック

React + TypeScript + Vite / vite-plugin-pwa / Tailwind CSS v4 / Zustand / Dexie.js (IndexedDB) / date-fns / Vitest

(以降のフェーズで dnd-kit、rrule.js を追加予定)

## PWA Push 通知

通知を使うには VAPID キーを生成し、`dandori/.dev.vars` に `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` を設定してください。ひな形は `dandori/.dev.vars.example` にあります。キーはリポジトリへコミットせず、Cloudflare では `wrangler secret put` で登録します。本番 Worker の更新は `cd dandori; npm run deploy` です。

Push 通知は HTTPS と通知許可が必要です。iPhone/iPad は iOS 16.4 以降で、Safari の共有メニューからホーム画面に追加した PWA を開き、設定画面の「PWA通知を有効にする」を押してください。タスク通知には日付・開始時刻と通知タイミングを設定します。サーバーには通知時刻とタスク名のみを送信します。

## 開発

```bash
cd dandori
npm install
npm run dev            # 開発サーバー
npm run build          # 型チェック + 本番ビルド
npm run preview        # ビルド結果の確認(Service Worker はここで動作)
npm run lint
npm test               # リポジトリ層のテスト(fake-indexeddb)
npm run generate-icons # public/icon.svg から PWA アイコンを再生成
```

Service Worker は開発サーバーでは無効です。オフライン動作は `build` → `preview` で確認します。

## Cloudflare Workers Builds の設定

GitHub 連携の自動ビルドでは、Cloudflare の Worker → Settings → Build で次を設定してください。

| 設定 | 値 |
| --- | --- |
| Root directory | `dandori` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

依存関係と `package-lock.json` は `dandori/` にあります。リポジトリ直下の `package.json` はローカル操作用のコマンド転送のみです。Root directory がリポジトリ直下のままだと、ビルド環境に TypeScript がインストールされず、`tsc: not found` で失敗します。

Root directory を変更したら、Cloudflare で失敗したビルドを再実行してください。VAPID キーはビルド変数ではなく、デプロイ先 Worker の Secret に設定します。

### 作業ブランチのプレビュー

Cloudflare の「プレビューのベース」側も Root directory を `dandori`、Build command を `npm run build` に設定し、プレビューのデプロイコマンドには `npx wrangler preview` を使います。本番側のデプロイコマンドは `npx wrangler deploy` です。

`dandori/wrangler.jsonc` の `previews.durable_objects.bindings` に通知用の `PUSH_DEVICES` を定義しています。同じ Worker 内の `PushDevice` クラスを参照し、プレビューごとに専用の保存領域が作られます。本番の通知購読や予定は共有しません。

プレビューで通知も試す場合は、`dandori/` で以下を実行し、入力を求められたときにプレビュー用のVAPIDキーと `mailto:メールアドレス` を入力してください。秘密鍵を設定ファイルへ書かないでください。

```bash
npx wrangler preview base-config secret put VAPID_PUBLIC_KEY
npx wrangler preview base-config secret put VAPID_PRIVATE_KEY
npx wrangler preview base-config secret put VAPID_SUBJECT
```

ベースのSecretは、その後に新しく作成されるプレビューへ適用されます。すでに作成済みのプレビューには `npx wrangler preview secret put VAPID_PUBLIC_KEY --name <プレビュー名>` のように3項目を個別登録してください。通知を使用しないプレビューではVAPIDキーは不要で、通知設定画面には未設定と表示されます。

設定の変更を対象ブランチへ反映した後、Cloudflareで失敗したビルドを再実行してください。将来のブランチでも設定が引き継がれるよう、通常のマージ手順で `develop` と `main` にも取り込みます。

参考: [Cloudflare Previews の設定](https://developers.cloudflare.com/workers/previews/configuration/)、[Durable Objects の分離](https://developers.cloudflare.com/workers/previews/resources/#durable-objects)。

## 開発フェーズ

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 0 | Vite + PWA 雛形、iOS 向け meta、オフライン起動、テーマ | 完了 |
| 1 | Dexie、Project/Workflow/Issue の CRUD | 完了 |
| 2 | ボード | 完了(実機タッチ操作は未確認) |
| 3 | バックログとスプリント | 完了(実機タッチ操作は未確認) |
| 4 | Today タイムライン | 完了(実機タッチ操作は未確認) |
| 5 | サブタスク、Epic、バーンダウン | 完了 |
| 6 | 繰り返し、アプリ内通知、バックアップ | 一部完了(繰り返し) |
| 7 | Push 通知 | 実装済み(Worker の VAPID Secret 設定とデプロイが必要) |
| 8 | 実機テスト、a11y、Lighthouse | 未着手 |
