import { Screen } from '../../app/Screen'
import { useThemeStore, type ThemeSetting } from '../../store/theme'
import { ProjectSection } from './ProjectSection'
import { TimelineSettingsSection } from './TimelineSettingsSection'

const OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: 'システム' },
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

export function SettingsScreen() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <Screen title="設定">
      <ProjectSection />
      <TimelineSettingsSection />
      <div className="rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-muted">テーマ</h2>
        <div role="radiogroup" aria-label="テーマ" className="grid grid-cols-3 gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={theme === o.value}
              onClick={() => setTheme(o.value)}
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
