import { useState, type FormEvent } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Sheet } from '../../app/Sheet'
import type { Sprint } from '../../db/types'
import { DEFAULT_SPRINT_DAYS } from '../../db/sprintRepo'
import { addDaysStr, todayStr } from '../../lib/date'
import { useDataStore } from '../../store/data'

export function SprintFormSheet({ sprint, onClose }: { sprint: Sprint | null; onClose: () => void }) {
  const createSprint = useDataStore((s) => s.createSprint)
  const updateSprint = useDataStore((s) => s.updateSprint)

  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [startDate, setStartDate] = useState(sprint?.startDate ?? todayStr())
  const [endDate, setEndDate] = useState(
    sprint?.endDate ?? addDaysStr(todayStr(), DEFAULT_SPRINT_DAYS - 1),
  )
  const [endTouched, setEndTouched] = useState(sprint !== null)
  const [error, setError] = useState<string | null>(null)

  function onStartChange(value: string) {
    setStartDate(value)
    if (!endTouched && value) setEndDate(addDaysStr(value, DEFAULT_SPRINT_DAYS - 1))
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      if (sprint) {
        await updateSprint(sprint.id, { name, goal, startDate, endDate })
      } else {
        await createSprint({ name: name.trim() || undefined, goal, startDate, endDate })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Sheet label={sprint ? 'スプリントを編集' : 'スプリントを作成'} onClose={onClose}>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">{sprint ? 'スプリントを編集' : '新規スプリント'}</h2>
        <label className="flex flex-col gap-1 text-sm text-muted">
          名前{!sprint && '(空欄なら自動で番号を付けます)'}
          <input className={FIELD_CLASS} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          ゴール
          <textarea
            className={`${FIELD_CLASS} min-h-20 py-2`}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            開始日
            <input
              type="date"
              className={FIELD_CLASS}
              value={startDate}
              onChange={(e) => onStartChange(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            終了日
            <input
              type="date"
              className={FIELD_CLASS}
              value={endDate}
              onChange={(e) => {
                setEndTouched(true)
                setEndDate(e.target.value)
              }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            className="min-h-11 flex-1 rounded-lg border border-border text-sm"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className="min-h-11 flex-1 rounded-lg bg-accent text-sm font-semibold text-accent-text"
          >
            保存
          </button>
        </div>
      </form>
    </Sheet>
  )
}
