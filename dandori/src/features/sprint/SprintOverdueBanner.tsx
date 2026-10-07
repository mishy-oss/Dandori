import { useState } from 'react'
import { todayStr } from '../../lib/date'
import { selectActiveSprint, useDataStore } from '../../store/data'
import { CompleteSprintDialog } from './CompleteSprintDialog'

// 終了日を過ぎたアクティブスプリントがあるとき、完了を促す
export function SprintOverdueBanner() {
  const sprint = useDataStore(selectActiveSprint)
  const [open, setOpen] = useState(false)

  if (!sprint || sprint.endDate >= todayStr()) return null

  return (
    <>
      <div
        role="status"
        className="flex items-center gap-3 rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm"
      >
        <p className="flex-1">
          ⏰ {sprint.name} は終了日({sprint.endDate})を過ぎています
        </p>
        <button
          className="min-h-11 shrink-0 rounded-lg bg-amber-500 px-4 font-semibold text-black"
          onClick={() => setOpen(true)}
        >
          完了する
        </button>
      </div>
      {open && <CompleteSprintDialog sprint={sprint} onClose={() => setOpen(false)} />}
    </>
  )
}
