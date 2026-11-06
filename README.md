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
