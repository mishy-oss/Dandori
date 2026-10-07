import { useState } from 'react'
import { BacklogScreen } from '../features/backlog/BacklogScreen'
import { BoardScreen } from '../features/board/BoardScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { TimelineScreen } from '../features/timeline/TimelineScreen'
import { PwaToast } from './PwaToast'
import { useThemeEffect } from './useThemeEffect'

const TABS = [
  { id: 'today', label: 'Today', icon: '🗓', Screen: TimelineScreen },
  { id: 'board', label: 'Board', icon: '🗂', Screen: BoardScreen },
  { id: 'backlog', label: 'Backlog', icon: '📋', Screen: BacklogScreen },
  { id: 'settings', label: '設定', icon: '⚙️', Screen: SettingsScreen },
] as const

type TabId = (typeof TABS)[number]['id']

export function App() {
  useThemeEffect()
  const [tab, setTab] = useState<TabId>('today')
  const Active = TABS.find((t) => t.id === tab)!.Screen

  return (
    <div
      className="mx-auto flex h-full max-w-xl flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <main className="flex-1 overflow-y-auto">
        <Active />
      </main>

      <nav
        aria-label="メイン"
        className="grid grid-cols-4 border-t border-border bg-surface"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${
              tab === t.id ? 'font-semibold text-accent' : 'text-muted'
            }`}
          >
            <span aria-hidden className="text-lg leading-none">
              {t.icon}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      <PwaToast />
    </div>
  )
}
