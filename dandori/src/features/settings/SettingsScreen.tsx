import { Screen } from '../../app/Screen'
import { useState } from 'react'
import { Icon } from '../../app/Icon'
import { ReleaseNotesDialog } from './ReleaseNotesDialog'
import { useThemeStore, type ThemeSetting } from '../../store/theme'
import { TimelineSettingsSection } from './TimelineSettingsSection'
import { PushNotificationsSettings } from '../notifications/PushNotificationsSettings'

const OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

/** 各種設定と、種別・ステータスの簡単な使い方を表示する。 */
export function SettingsScreen() {
  const [showReleaseNotes, setShowReleaseNotes] = useState(false)
  const theme = useThemeStore(/* ストアからテーマを取得する。 */ (s) => s.theme)
  const setTheme = useThemeStore(/* ストアからsetTheme（保存・状態変更の操作）を取得する。 */ (s) => s.setTheme)

  return (
    <Screen title="設定" headerAction={
      <button type="button" aria-label="リリースノートを開く" title="リリースノート" aria-haspopup="dialog"
        onClick={/* 情報ボタンからリリースノートを表示する。 */ () => setShowReleaseNotes(true)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-accent">
        <Icon name="info" className="size-6" />
      </button>
    }>
      <TimelineSettingsSection />
      <PushNotificationsSettings />
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted">テーマ</h2>
        <div role="radiogroup" aria-label="テーマ" className="grid grid-cols-3 gap-2">
          {OPTIONS.map(/* 各テーマの選択肢の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={theme === o.value}
              onClick={/* 操作内容に合わせてテーマを更新する。 */ () => setTheme(o.value)}
              className={`min-h-11 rounded-lg border text-sm font-medium ${
                theme === o.value
                  ? 'border-accent bg-accent text-accent-text'
                  : 'border-border bg-surface-2'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <section aria-labelledby="task-guide-heading" className="rounded-xl border border-border bg-surface p-4">
        <h2 id="task-guide-heading" className="mb-3 text-sm font-semibold text-muted">種別とステータスの使い方</h2>
        <h3 className="mb-2 text-sm font-semibold">種別：何の作業か</h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="font-medium">task</dt><dd className="text-muted">普段の作業や予定。資料作成・会議など。</dd>
          <dt className="font-medium">bug</dt><dd className="text-muted">不具合の修正。</dd>
          <dt className="font-medium">story</dt><dd className="text-muted">実現したい機能や目的。</dd>
          <dt className="font-medium">epic</dt><dd className="text-muted">複数の子タスクをまとめる大きなテーマ。</dd>
        </dl>
        <p className="mt-2 text-xs text-muted">迷ったらtaskで大丈夫です。</p>
        <h3 className="mb-2 mt-4 text-sm font-semibold">ステータス：作業の状態</h3>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="font-medium">To Do</dt><dd className="text-muted">未着手・未配置の作業。</dd>
          <dt className="font-medium">In Progress</dt><dd className="text-muted">進行中の作業。通常タスクを予定に配置すると切り替わります。</dd>
          <dt className="font-medium">Recurring</dt><dd className="text-muted">会議など決まった時間の予定。必要なら繰り返しも設定します。</dd>
          <dt className="font-medium">Done</dt><dd className="text-muted">完了した作業。</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">例：定例会議は「task」＋「Recurring」にします。</p>
      </section>
      {showReleaseNotes && <ReleaseNotesDialog onClose={/* リリースノートを閉じ、設定画面へ戻る。 */ () => setShowReleaseNotes(false)} />}
    </Screen>
  )
}
