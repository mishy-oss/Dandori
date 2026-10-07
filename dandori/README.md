# Dandori

個人用スプリント管理 PWA。Structured 風の時間軸タイムラインと、Jira 風のボード/スプリント管理を組み合わせた、iPhone 中心の local-first アプリ。

## 技術スタック

React + TypeScript + Vite / vite-plugin-pwa / Tailwind CSS v4 / Zustand

(以降のフェーズで Dexie.js、dnd-kit、date-fns、rrule.js を追加予定)

## 開発

```bash
npm install
npm run dev            # 開発サーバー
npm run build          # 型チェック + 本番ビルド
npm run preview        # ビルド結果の確認(Service Worker はここで動作)
npm run lint
npm run generate-icons # public/icon.svg から PWA アイコンを再生成
```

Service Worker は開発サーバーでは無効です。オフライン動作は `build` → `preview` で確認します。

## 開発フェーズ

| フェーズ | 内容 | 状態 |
| --- | --- | --- |
| 0 | Vite + PWA 雛形、iOS 向け meta、オフライン起動、テーマ | 完了 |
| 1 | Dexie、Project/Workflow/Issue の CRUD | 未着手 |
| 2 | ボード | 未着手 |
| 3 | バックログとスプリント | 未着手 |
| 4 | Today タイムライン | 未着手 |
| 5 | サブタスク、Epic、バーンダウン | 未着手 |
| 6 | 繰り返し、アプリ内通知、バックアップ | 未着手 |
| 7 | Push 通知 | 未着手 |
| 8 | 実機テスト、a11y、Lighthouse | 未着手 |
