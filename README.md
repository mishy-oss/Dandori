# Dandori

タスク・スケジュール管理アプリ。Structured 風の時間軸タイムラインと、Jira 風のボード/スプリント管理を組み合わせた、iPhone 中心の個人用 local-first PWA。

アプリ本体は [dandori/](./dandori) にあります。

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
