import { useEffect, useState } from 'react'
import { BacklogScreen } from '../features/backlog/BacklogScreen'
import { BoardScreen } from '../features/board/BoardScreen'
import { SettingsScreen } from '../features/settings/SettingsScreen'
import { useDataStore } from '../store/data'
import { TimelineScreen } from '../features/timeline/TimelineScreen'
import { PwaToast } from './PwaToast'
import { useThemeEffect } from './useThemeEffect'
import { Icon } from './Icon'
import { readPushDeviceToken, syncPushSchedules, PUSH_SETTINGS_CHANGED_EVENT } from '../features/notifications/pushClient'

const TABS = [
  { id: 'today', label: '予定', icon: 'timeline', Screen: TimelineScreen },
  { id: 'board', label: 'ボード', icon: 'board', Screen: BoardScreen },
  { id: 'backlog', label: 'タスク', icon: 'inbox', Screen: BacklogScreen },
  { id: 'settings', label: '設定', icon: 'settings', Screen: SettingsScreen },
] as const

type TabId = (typeof TABS)[number]['id']

/** アプリのデータとテーマを初期化し、タブに応じた画面を表示する。タスクや通知設定の変更に合わせて通知予定も同期する。 */
export function App() {
  useThemeEffect()
  const init = useDataStore(/* ストアからinit（保存・状態変更の操作）を取得する。 */ (s) => s.init)
  const ready = useDataStore(/* ストアから初期化の完了状態を取得する。 */ (s) => s.ready)
  const issues = useDataStore(/* ストアからIssueを取得する。 */ (s) => s.issues)
  const workflows = useDataStore(/* ストアからワークフローを取得する。 */ (s) => s.workflows)
  const projects = useDataStore(/* ストアからプロジェクトを取得する。 */ (s) => s.projects)
  useEffect(/* 初回表示時にアプリの保存データを初期化・読み込みする。 */ () => {
    void init()
  }, [init])
  useEffect(/* タスクと通知設定の変更を監視して予定を再同期し、再実行時や画面破棄時には待機中の同期を取り消す。 */ () => {
    if (!ready) return
    let timer: ReturnType<typeof setTimeout>
    /** 直前の同期予約を取り消し、400ミリ秒後に未完了タスクの未来の通知予定をまとめてサーバーへ送る。 */
    const sync = () => {
      clearTimeout(timer)
      timer = setTimeout(/* 未来の通知対象を時刻順に最大500件にまとめ、この端末の予定としてサーバーへ同期する。 */ () => {
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
          .filter(/* 未完了・開始時刻が設定済み・通知が有効という条件を満たす要素だけを残す。 */ (issue) => !doneIds.has(issue.statusId) && issue.date && issue.startMin !== null && issue.reminderOffsetMin !== null)
          .map(/* 予定のローカル日時から事前通知の分数を引き、IssueのID・通知時刻・タイトルをまとめる。 */ (issue) => {
            const [year, month, day] = issue.date!.split('-').map(Number)
            const at = new Date(year, month - 1, day, 0, issue.startMin!).getTime() - issue.reminderOffsetMin! * 60_000
            return { id: issue.id, at, title: issue.title }
          })
          .filter(/* 通知時刻が現在より後という条件を満たす要素だけを残す。 */ (item) => item.at > now)
          .sort(/* 通知予定の時刻を比較し、早いものから順に並べる。 */ (a, b) => a.at - b.at)
          .slice(0, 500)
        void syncPushSchedules(token, notifications).catch(/* 通知予定の同期失敗をここで受け止め、画面の他の操作へ例外が伝わらないようにする。 */ () => undefined)
      }, 400)
    }
    sync()
    window.addEventListener(PUSH_SETTINGS_CHANGED_EVENT, sync)
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => {
      clearTimeout(timer)
      window.removeEventListener(PUSH_SETTINGS_CHANGED_EVENT, sync)
    }
  }, [ready, issues, workflows, projects])
  const [tab, setTab] = useState<TabId>('today')
  const Active = TABS.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (t) => t.id === tab)!.Screen

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
        {TABS.map(/* 各ナビゲーションのタブの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (t) => (
          <button
            key={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={/* 操作内容に合わせて表示するタブを更新する。 */ () => setTab(t.id)}
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
