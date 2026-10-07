# 個人用スプリント管理 PWA 設計書(改訂版)

Structured風時間軸タイムラインと、Jira風のボード/スプリント管理を組み合わせた、iPhone中心の個人用PWA。

*対象:個人利用 / iPhone中心 / local-first*

## 1. コンセプトとスコープ

**コアバリュー:** Issue(タスク)をスプリントで管理し、今日やるものを時間軸のブロックとして配置する。「どの進捗か(ステータス)」と「いつやるか(スケジュール)」を別軸で持つ。

**v1に入れるもの**

- プロジェクト、カスタムステータス(ワークフロー)
- ボード(アクティブスプリントのカンバン)
- バックログとスプリント(開始/完了/持ち越し/バーンダウン)
- Todayタイムライン(時間配置、現在時刻線)
- サブタスク、Epic、繰り返し
- 通知(アプリ内 + Push)、バックアップ
- オフライン動作、ホーム画面インストール、ダーク/ライトテーマ

**v1から外すもの:** 担当者、コメント、Issueリンク、作業ログ、JQL風検索(単純フィルタのみ)、チーム共有、ネイティブアプリ化、AI自動スケジューリング。ただしデータモデルの `assigneeId` などは残し、将来の拡張に備える。

**v2以降:** 週ビュー、クラウド同期、カレンダー連携(ICS)、フォーカスタイマー、ワークフロー遷移ルール、統計

## 2. 技術スタック

| 領域 | 選定 | 理由 |
| --- | --- | --- |
| フレームワーク | React + TypeScript + Vite | PWAプラグインが成熟、軽量 |
| PWA | vite-plugin-pwa(Workbox) | Service Worker・manifest生成 |
| 状態管理 | Zustand | 小規模で十分 |
| 永続化 | IndexedDB(Dexie.js) | オフライン前提、クエリが書きやすい |
| スタイル | Tailwind CSS | テーマ変数との相性 |
| ドラッグ&ドロップ | dnd-kit(またはPointer Events自作) | タッチ対応 |
| 日付処理 | date-fns | 軽量 |
| 繰り返し | rrule.js | 標準的な実装 |
| 並び順 | LexoRank系の文字列 | 並べ替え時に1件だけ更新で済む |
| Push(v1後半) | Cloudflare Workers + Cron | 軽量・低コスト |

**方針:** v1は local-first。サーバーなしで完結させ、データは端末内のIndexedDBに保存する。将来の同期に備え、全エンティティに `updatedAt` / `deletedAt` を持たせ、IDはULIDにする。

## 3. データモデル

```ts
type ID = string; // ULID

interface Project {
  id: ID; key: string;          // "APP" → APP-12
  name: string; color: string;
  workflowId: ID; nextNumber: number;
}

interface Workflow {
  id: ID;
  statuses: { id: ID; name: string;
    category: 'todo' | 'doing' | 'done';
    wipLimit?: number }[];       // Doing列の既定は3
}

interface Issue {
  id: ID; projectId: ID; number: number;
  type: 'task' | 'bug' | 'story' | 'epic';
  title: string; description?: string;   // Markdown
  statusId: ID;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  parentId: ID | null;          // サブタスク / Epic配下
  labels: string[];
  dueDate: string | null;
  estimateMin: number | null;
  sprintId: ID | null;
  rank: string;                 // ボード/バックログ内の並び順
  // スケジュール(タイムライン用)
  date: string | null;
  startMin: number | null;      // 0:00からの分
  durationMin: number;          // 既定30
  icon: string; color: string;
  reminderOffsetMin: number | null;
  recurrenceId: ID | null;
  assigneeId: ID | null;        // v1では未使用
  completedAt: number | null;
  createdAt: number; updatedAt: number; deletedAt: number | null;
}

interface Sprint {
  id: ID; projectId: ID; name: string; goal?: string;
  startDate: string; endDate: string;
  state: 'planned' | 'active' | 'closed';
  // 完了時にバーンダウン用の日次スナップショットを保持
  snapshots: { date: string; remainingMin: number; remainingCount: number }[];
}

interface RecurrenceRule {
  id: ID; rrule: string;        // "FREQ=WEEKLY;BYDAY=MO,WE"
  template: Omit<Issue, 'id' | 'date' | 'completedAt' | 'recurrenceId'>;
  startDate: string; endDate: string | null;
  exceptions: string[];
}

interface Settings {
  dayStartHour: number;         // 既定6
  dayEndHour: number;           // 既定24
  theme: 'system' | 'light' | 'dark';
  defaultDuration: number;
  weekStartsOn: 0 | 1;
  lastBackupAt: number | null;
}
```

**設計上のポイント**

- **ステータスとスケジュールは独立。** ボードで動かしてもタイムライン上の位置は変わらない。タイムラインでブロックを完了すると、`done` カテゴリのステータスへ自動移動する。
- **繰り返しはその場で展開。** 表示範囲に対して rrule から展開し、完了や個別編集があった日だけ実体の Issue を保存する(`exceptions` に記録)。
- **バーンダウンは日次スナップショット方式。** 毎日の初回起動時に残量を記録する。アプリを開かない日は前回値で補間する。

## 4. 画面構成

ボトムナビは4タブ。

| タブ | 内容 |
| --- | --- |
| **Today** | タイムライン。今日のスプリントIssueを時間軸に配置。週ストリップで日付切替 |
| **Board** | アクティブスプリントのカンバン |
| **Backlog** | バックログとスプリントの2段リスト。上部に検索・フィルタ |
| **設定** | プロジェクト、ワークフロー、テーマ、通知、バックアップ |

**共通UI**

- Issue詳細: ボトムシート(簡易編集)と全画面ページ(説明、サブタスク、アクティビティ)の2段構え
- FAB(+)で新規作成。親指が届く画面下部に主要操作を集める
- オンボーディング: 初回のみ「ホーム画面に追加」の図解ガイド

## 4-2. 画面設計イメージ

操作が複雑な4画面のワイヤーフレームを示す。Issue名や数値などの表示内容はサンプルで、実装時に差し替える。

&#91;embedded content: Today と Board のワイヤーフレーム · 2画面\]

Todayは時刻の配置、Boardはステータスの移動を担当し、ステータスと時刻は互いに影響しない。

&#91;embedded content: Backlog と Issue編集シートのワイヤーフレーム · 2画面\]

Backlogは行のスワイプでスプリントへ移し、編集シートでは主要ボタンを画面下部に置く。

## 5. iPhone向け操作設計

**ボード**

- 上部にステータスのタブを置き、1列ずつ縦リストで表示する
- カードの左右スワイプで前後のステータスへ移動
- 長押しドラッグで列内の並べ替え。画面端に寄せると隣の列へ切替
- Doing列にWIP上限(既定3)。超過時は警告を出す(ブロックはしない)

**バックログ**

- スプリントへの移動は、スワイプアクションまたは長押しメニュー
- 2段リスト間のドラッグは、小画面での誤操作が多いため採用しない

**タイムライン**

- 空き枠のタップ/長押しで、その時刻に新規作成
- ブロックは長押しで掴んでドラッグ(15分スナップ)。下端ドラッグで所要時間変更
- 未配置のスプリントIssueの一覧から、タイムラインへドラッグして配置
- ドラッグ操作の代替として、編集シートに時刻入力を用意(a11y)

**フィードバック:** `navigator.vibrate` は iOS で動かないため、触覚の代わりに視覚アニメーション(バウンス、色変化)を使う。

## 6. タイムライン描画ロジック

- **座標変換:** `y = (startMin - dayStartMin) * PX_PER_MIN`(例: 1分=1.2px)
- **重複レイアウト:** 開始時刻でソート → 重なるタスクをクラスタ化 → 空いている最初の列に割り当て → 列数 `n` で幅を `100% / n`
- **現在時刻線:** 1分ごとの更新に加え、`visibilitychange` 復帰時に再計算
- **ドラッグ競合:** ブロックに `touch-action: none` を指定し、ロングプレスで掴む仕様にしてスクロールと衝突させない

## 7. スプリントの挙動

| 操作 | 挙動 |
| --- | --- |
| 作成 | 名前、期間(既定2週間)、ゴール |
| 開始 | 同時にアクティブにできるのは1つ。バックログからIssueを入れてから開始 |
| 完了 | 未完了Issueの扱いを選択(次のスプリントへ / バックログへ戻す) |
| バーンダウン | 見積合計(なければ件数)の理想線と実績線を表示 |
| 期間外 | 終了日を過ぎたら、完了を促すバナーを表示 |

## 8. PWA設計(iOS対応)

**manifest / meta**

- `display: standalone`、`start_url: /?source=pwa`
- アイコン: 192 / 512 / maskable、`apple-touch-icon`
- `viewport-fit=cover`、セーフエリア(`env(safe-area-inset-*)`)対応
- `apple-mobile-web-app-capable`、`apple-mobile-web-app-status-bar-style`

**Service Worker**

- アプリシェルを precache。更新は `registerType: 'prompt'` で「更新」トーストを出す
- データはすべてIndexedDBなので、ランタイムキャッシュは基本不要

**iOSの制約と対策**

| 項目 | 対策 |
| --- | --- |
| インストール | Safariの共有メニューから手動追加が必須。図解ガイドを表示 |
| Web Push | iOS 16.4以降、ホーム画面追加済みのみ可。許可はボタン操作を起点に要求 |
| データ消失 | `navigator.storage.persist()` を要求。JSONバックアップ(ファイルApp/iCloud)の定期促し |
| バッジ | Badging APIで未完了数を表示(インストール済みのみ) |
| 触覚 | 未対応。視覚アニメーションで代替 |

## 9. 通知設計

ローカル予約通知(Notification Triggers)は標準化されておらず信頼できない。時刻通りに通知するには、**サーバーからのWeb Pushが事実上必須**。

- **フェーズ6:** アプリ起動中のみのアプリ内通知とバッジ。設定画面に「確実ではない」旨を明記
- **フェーズ7:** Pushサーバー(Cloudflare Workers + Cron)を追加
  - 端末のPush購読と、通知予定(時刻と文言)のみを送信
  - **Issue本文・詳細はサーバーに送らない**
  - タスク変更時は予定を再送して置き換える
- iOSでは、通知設定の前に「ホーム画面に追加してください」のガイドを出す

## 10. ディレクトリ構成

```
src/
  app/            # ルーティング、プロバイダ、PWA登録
  features/
    board/        # ステータスタブ、カード、スワイプ
    backlog/      # 2段リスト、スプリント操作
    sprint/       # 開始/完了、バーンダウン
    timeline/     # Timeline, Block, NowLine, layout.ts
    issue-editor/ # ボトムシート、詳細ページ
    recurrence/
    settings/
    notifications/
  db/             # Dexieスキーマ、リポジトリ層
  store/          # Zustand
  lib/            # 日付、ID(ULID)、rank
  styles/         # テーマ変数
public/icons/
server/           # Pushサーバー(フェーズ7)
```

**レイヤー分離:** UI → store → repository → Dexie の一方向。将来クラウド同期を入れるときは repository 層のみ差し替える。

## 11. 開発フェーズ

| フェーズ | 内容 | 目安 |
| --- | --- | --- |
| 0 | Vite+PWA雛形、iOS向けmeta、オフライン起動、テーマ | 1〜2日 |
| 1 | Dexie、Project/Workflow/IssueのCRUD | 2〜3日 |
| 2 | ボード(ステータス切替、スワイプ移動、並べ替え) | 3〜4日 |
| 3 | バックログとスプリント(開始/完了/持ち越し) | 3〜4日 |
| 4 | Todayタイムライン、ドラッグ配置、リサイズ | 4〜5日 |
| 5 | サブタスク、Epic、バーンダウン | 3日 |
| 6 | 繰り返し、アプリ内通知、バックアップ | 3日 |
| 7 | Push通知(サーバー) | 3〜4日 |
| 8 | iPhone実機テスト、a11y、Lighthouse | 2〜3日 |

ボードを先に作るのは、Jira的な価値の中心であり、動くものを早く確認できるため。

## 12. 品質基準

- Lighthouse PWA / Performance 90以上
- 初回ロード後は機内モードでも全機能が動く
- タップ領域は44px以上。ドラッグ操作には必ず代替手段を用意
- バックアップを一定期間(例: 14日)取っていなければ促す
- 実機(iPhone Safari / ホーム画面追加後)で、スワイプ・ドラッグ・Push・オフラインを確認

## 13. リスクと未決事項

**リスク**

- iOSのPWAは、バックグラウンド動作やストレージの挙動がOS依存で変わり得る。実機検証を早めに行う
- ボードのスワイプとドラッグ、タイムラインのスクロールとドラッグは競合しやすい。フェーズ2・4で最優先の検証項目とする
- 個人用でも、端末紛失・機種変更に備えたバックアップ導線が必須

**未決事項**

1. 複数端末で使う場合のクラウド同期(v2)。バックエンド候補は Supabase / Firebase / 自前
2. 独自のアイコンセット、配色、アプリ名・ロゴ(既存アプリの意匠は流用しない)
3. スプリント期間の既定値(2週間か、1週間か)
4. 1人運用でのスプリントの扱い(「週」単位の軽い運用にするか)
