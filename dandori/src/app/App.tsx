import { useEffect, useState } from 'react'
import { BacklogScreen } from '../features/backlog/BacklogScreen'
import { BoardScreen } from '../features/board/BoardScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { useDataStore } from '../store/data'
import { TimelineScreen } from '../features/timeline/TimelineScreen'
import { PwaToast } from './PwaToast'
import { useThemeEffect } from './useThemeEffect'
import { useMonthlyPlanningEffect } from './useMonthlyPlanningEffect'
import { Icon } from './Icon'
import { readPushDeviceToken, syncPushSchedules, PUSH_SETTINGS_CHANGED_EVENT } from '../features/notifications/pushClient'

const TABS = [
  { id: 'today', label: '予定', icon: 'timeline', Screen: TimelineScreen },
  { id: 'board', label: 'ボード', icon: 'board', Screen: BoardScreen },
  { id: 'backlog', label: 'タスク', icon: 'inbox', Screen: BacklogScreen },
  { id: 'settings', label: '設定', icon: 'settings', Screen: SettingsScreen },
] as const

type TabId = (typeof TABS)[number]['id']

export function App() {
  useThemeEffect()
  useMonthlyPlanningEffect()
  const init = useDataStore((s) => s.init)
  const ready = useDataStore((s) => s.ready)
  const issues = useDataStore((s) => s.issues)
  const workflows = useDataStore((s) => s.workflows)
  const projects = useDataStore((s) => s.projects)
  useEffect(() => {
    void init()
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
          .filter((issue) => !doneIds.has(issue.statusId) && issue.date && issue.startMin !== null && issue.reminderOffsetMin !== null)
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
  const [tab, setTab] = useState<TabId>('today')
  const Active = TABS.find((t) => t.id === tab)!.Screen

  return (
    <div
      className="relative mx-auto flex h-full max-w-xl flex-col"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <main className={`min-h-0 flex-1 overflow-y-auto ${tab === 'today' ? '' : 'pb-24'}`}>
        <Active />
      </main>

      <nav
        aria-label="メイン"
        className="app-nav grid grid-cols-4 px-1"
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
