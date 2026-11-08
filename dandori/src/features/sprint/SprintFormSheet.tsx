import { useState, type FormEvent } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { Sheet } from '../../app/Sheet'
import type { Sprint } from '../../db/types'
import { DEFAULT_SPRINT_DAYS } from '../../db/sprintRepo'
import { addDaysStr, todayStr } from '../../lib/date'
import { useDataStore } from '../../store/data'

/** スプリントの名前・ゴール・期間を入力し、新規作成または編集するフォームを表示する。 */
export function SprintFormSheet({ sprint, onClose }: { sprint: Sprint | null; onClose: () => void }) {
  const createSprint = useDataStore(/* ストアからcreateSprint（保存・状態変更の操作）を取得する。 */ (s) => s.createSprint)
  const updateSprint = useDataStore(/* ストアからupdateSprint（保存・状態変更の操作）を取得する。 */ (s) => s.updateSprint)

  const [name, setName] = useState(sprint?.name ?? '')
  const [goal, setGoal] = useState(sprint?.goal ?? '')
  const [startDate, setStartDate] = useState(sprint?.startDate ?? todayStr())
  const [endDate, setEndDate] = useState(
    sprint?.endDate ?? addDaysStr(todayStr(), DEFAULT_SPRINT_DAYS - 1),
  )
  const [endTouched, setEndTouched] = useState(sprint !== null)
  const [error, setError] = useState<string | null>(null)

  /** 開始日の入力を更新し、終了日がまだ手動変更されていなければ既定の14日間になるよう終了日も合わせる。 */
  function onStartChange(value: string) {
    setStartDate(value)
    if (!endTouched && value) setEndDate(addDaysStr(value, DEFAULT_SPRINT_DAYS - 1))
  }

  /** 標準のフォーム送信を止め、入力値からスプリントを新規作成または更新する。成功時はフォームを閉じる。 */
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
          <input className={FIELD_CLASS} value={name} onChange={/* 入力された値に合わせて名前を更新する。 */ (e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          ゴール
          <textarea
            className={`${FIELD_CLASS} min-h-20 py-2`}
            value={goal}
            onChange={/* 入力された値に合わせてスプリントのゴールを更新する。 */ (e) => setGoal(e.target.value)}
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm text-muted">
            開始日
            <input
              type="date"
              className={FIELD_CLASS}
              value={startDate}
              onChange={/* 入力された開始日を受け取り、必要に応じて終了日も連動更新する。 */ (e) => onStartChange(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            終了日
            <input
              type="date"
              className={FIELD_CLASS}
              value={endDate}
              onChange={/* 入力された値に合わせて終了日を手動変更した状態と終了日を更新する。 */ (e) => {
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
