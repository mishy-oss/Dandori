import { useEffect, useState } from 'react'
import { BoardScreen } from '../features/board/BoardScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { useDataStore } from '../store/data'
import { TimelineScreen } from '../features/timeline/TimelineScreen'
import { PwaToast } from './PwaToast'
import { useThemeEffect } from './useThemeEffect'
import { useMonthlyPlanningEffect } from './useMonthlyPlanningEffect'
import { Icon } from './Icon'
import { initializeAccount, prepareAccountCache, useAccountStore } from '../features/account/accountStore'
import { useAccountSync } from '../features/account/useAccountSync'
import { readPushDeviceToken, syncPushSchedules, PUSH_SETTINGS_CHANGED_EVENT } from '../features/notifications/pushClient'

const TABS = [
  { id: 'today', label: '予定', icon: 'timeline', Screen: TimelineScreen },
  { id: 'board', label: 'ボード', icon: 'board', Screen: BoardScreen },
  { id: 'settings', label: '設定', icon: 'settings', Screen: SettingsScreen },
] as const

type TabId = (typeof TABS)[number]['id']

export function App() {
  useThemeEffect()
  useMonthlyPlanningEffect()
  useAccountSync()
  const [startupError, setStartupError] = useState<string | null>(null)
  const accountError = useAccountStore(state => state.error || state.calendarError)
  const init = useDataStore((s) => s.init)
  const ready = useDataStore((s) => s.ready)
  const issues = useDataStore((s) => s.issues)
  const workflows = useDataStore((s) => s.workflows)
  const projects = useDataStore((s) => s.projects)
  useEffect(() => {
    // 認証サーバーを待たず、保存済みのタスクを先に表示してオフライン起動を維持する。
    void prepareAccountCache().then(init).then(initializeAccount).catch(error => setStartupError(error instanceof Error ? error.message : String(error)))
  }, [init])
  useEffect(() => {
    if (!ready) return
    let timer: ReturnType<typeof setTimeout>
    const sync = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const token = readPushDeviceToken()
        if (!token || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
        const doneIds = new Set<string>()
        for (const project of projects) {
          for (const status of workflows[project.workflowId]?.statuses ?? []) {
            if (status.category === 'done') doneIds.add(status.id)
          }
        }
        const now = Date.now()
        const notifications = issues
          .filter((issue) => !issue.carryoverToId && !doneIds.has(issue.statusId) && issue.date && issue.startMin !== null && issue.reminderOffsetMin !== null)
          .map((issue) => {
            const [year, month, day] = issue.date!.split('-').map(Number)
            const at = new Date(year, month - 1, day, 0, issue.startMin!).getTime() - issue.reminderOffsetMin! * 60_000
            return { id: issue.id, at, title: issue.title }
          })
          .filter((item) => item.at > now)
          .sort((a, b) => a.at - b.at)
          .slice(0, 500)
        void syncPushSchedules(token, notifications).catch(() => undefined)
      }, 400)
    }
    sync()
    window.addEventListener(PUSH_SETTINGS_CHANGED_EVENT, sync)
    return () => {
      clearTimeout(timer)
      window.removeEventListener(PUSH_SETTINGS_CHANGED_EVENT, sync)
    }
  }, [ready, issues, workflows, projects])
  const [tab, setTab] = useState<TabId>(() => new URLSearchParams(location.search).has('google') ? 'settings' : 'today')
  const Active = TABS.find((t) => t.id === tab)!.Screen

  return (
    <div
      className="relative mx-auto flex h-full max-w-xl flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <main className={`min-h-0 flex-1 overflow-y-auto ${tab === 'today' ? '' : 'pb-24'}`}>
        {startupError && <p role="alert" className="p-3 text-sm text-red-500">{startupError}</p>}
        {accountError && tab !== 'settings' && <button className="w-full p-2 text-left text-xs text-red-500" onClick={() => setTab('settings')}>Google連携を確認してください：{accountError}</button>}
        <Active />
      </main>

      <nav
        aria-label="メイン"
        className="app-nav grid grid-cols-3 px-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-full text-[10px] ${
              tab === t.id ? 'font-semibold text-accent' : 'text-text'
            }`}
          >
            <Icon name={t.icon} className="size-5" />
            {t.label}
          </button>
        ))}
      </nav>

      <PwaToast />
    </div>
  )
}
