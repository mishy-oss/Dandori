import { useState } from 'react'
import { useDataStore } from '../../store/data'
import { currentMonth, shiftMonth } from '../../lib/month'

/** 作成・開始操作なしで表示する月を切り替える。切替失敗時は理由を表示する。 */
export function MonthNavigator() {
  const month = useDataStore(/* 画面全体で共有する表示月を読む。 */ (state) => state.selectedMonth)
  const select = useDataStore(/* 月別タスクの準備と画面更新を行う操作を取得する。 */ (state) => state.selectMonth)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** 選択された月へ切り替え、同時操作を防ぎながらエラーを処理する。 */
  async function change(value: string) {
    if (!value || busy) return
    setBusy(true)
    setError(null)
    try { await select(value) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) }
  }

  return <div>
    <div className="flex items-center gap-2">
      <button type="button" aria-label="前の月" disabled={busy} className="min-h-11 min-w-11 rounded-full border border-border bg-surface" onClick={/* 前月の計画を表示する。 */ () => void change(shiftMonth(month, -1))}>‹</button>
      <label className="min-w-0 flex-1 text-[10px] text-muted">対象月<input aria-label="対象月" type="month" value={month} disabled={busy} className="block min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm font-semibold text-text" onChange={/* 入力された月へ切り替える。 */ (event) => void change(event.target.value)} /></label>
      <button type="button" aria-label="次の月" disabled={busy} className="min-h-11 min-w-11 rounded-full border border-border bg-surface" onClick={/* 翌月の計画を表示する。 */ () => void change(shiftMonth(month, 1))}>›</button>
      <button type="button" disabled={busy || month === currentMonth()} className="min-h-11 rounded-full px-3 text-xs text-accent disabled:text-muted" onClick={/* 今日を含む月へ戻る。 */ () => void change(currentMonth())}>今月</button>
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-red-500">{error}</p>}
  </div>
}
