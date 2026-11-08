import { Screen } from '../../app/Screen'
import { useThemeStore, type ThemeSetting } from '../../store/theme'
import { TimelineSettingsSection } from './TimelineSettingsSection'
import { PushNotificationsSettings } from '../notifications/PushNotificationsSettings'

const OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

/** タイムライン設定・PWA通知設定・テーマ選択をまとめて表示する。 */
export function SettingsScreen() {
  const theme = useThemeStore(/* ストアからテーマを取得する。 */ (s) => s.theme)
  const setTheme = useThemeStore(/* ストアからsetTheme（保存・状態変更の操作）を取得する。 */ (s) => s.setTheme)

  return (
    <Screen title="設定">
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
    </Screen>
  )
}
