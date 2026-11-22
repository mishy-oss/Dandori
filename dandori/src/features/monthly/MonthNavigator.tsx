import { useId, useState } from 'react'
import { DateJumpButton } from '../../app/DateJumpButton'
import { useDataStore } from '../../store/data'
import { currentMonth, shiftMonth } from '../../lib/month'

export function MonthNavigator() {
  const month = useDataStore((state) => state.selectedMonth)
  const select = useDataStore((state) => state.selectMonth)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputId = useId()

  async function change(value: string) {
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try { await select(value) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  return <div>
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem_auto] items-end gap-1.5 min-[360px]:gap-2">
      <button type="button" aria-label="前の月" disabled={busy} className="size-11 rounded-full border border-border bg-surface" onClick={() => void change(shiftMonth(month, -1))}>‹</button>
      <div className="min-w-0">
        <label htmlFor={inputId} className="block text-[10px] text-muted">対象月</label>
        {/* 標準の月入力が固有の最小幅を持つ端末でも、表示を矢印の領域へはみ出させない。 */}
        <div className="h-11 overflow-hidden rounded-xl border border-border bg-surface focus-within:ring-2 focus-within:ring-accent">
          <input id={inputId} aria-label="対象月" type="month" value={month} disabled={busy}
            className="month-nav-input block h-full w-full min-w-0 max-w-full appearance-none bg-transparent px-2 text-base font-semibold text-text outline-none sm:px-3"
            onChange={event => void change(event.target.value)} />
        </div>
      </div>
      <button type="button" aria-label="次の月" disabled={busy} className="size-11 rounded-full border border-border bg-surface" onClick={() => void change(shiftMonth(month, 1))}>›</button>
      <DateJumpButton disabled={busy || month === currentMonth()} onClick={() => void change(currentMonth())}>今月</DateJumpButton>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
  </div>
}
