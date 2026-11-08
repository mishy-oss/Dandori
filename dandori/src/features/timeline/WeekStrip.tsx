import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale/ja'

/** 1週間の日付と予定のある日を表示し、日付選択および前後の週への切替を受け付ける。 */
export function WeekStrip({
  days,
  selected,
  today,
  marked,
  onSelect,
  onShiftWeek,
}: {
  days: string[]
  selected: string
  today: string
  marked: Set<string>
  onSelect: (date: string) => void
  onShiftWeek: (delta: -1 | 1) => void
}) {
  return (
    <div className="flex items-center gap-1 px-3 pb-4" role="group" aria-label="週">
      <button
        aria-label="前の週"
        onClick={/* 表示する週を1週前へ移動する。 */ () => onShiftWeek(-1)}
        className="min-h-14 w-6 shrink-0 rounded-full text-xl text-muted hover:bg-surface"
      >
        ‹
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map(/* 各週の日付の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (d) => {
          const date = parseISO(d)
          const isSelected = d === selected
          return (
            <button
              key={d}
              aria-label={format(date, 'M月d日(E)', { locale: ja })}
              aria-pressed={isSelected}
              onClick={/* クリックした日付を選択するよう、呼び出し元へ通知する。 */ () => onSelect(d)}
              className="relative flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-full text-xs"
            >
              <span className="text-[10px] font-normal text-muted">{format(date, 'E', { locale: ja })}</span>
              <span className={`flex size-8 items-center justify-center rounded-full text-[14px] font-semibold ${isSelected ? 'bg-accent text-accent-text' : d === today ? 'text-accent ring-1 ring-accent/40' : 'text-text'}`}>{format(date, 'd')}</span>
              {marked.has(d) && (
                <span
                  aria-hidden
                  className="absolute bottom-0.5 h-1 w-3 rounded-full bg-accent/65"
                />
              )}
            </button>
          )
        })}
      </div>
      <button
        aria-label="次の週"
        onClick={/* 表示する週を1週後へ移動する。 */ () => onShiftWeek(1)}
        className="min-h-14 w-6 shrink-0 rounded-full text-xl text-muted hover:bg-surface"
      >
        ›
      </button>
    </div>
  )
}
